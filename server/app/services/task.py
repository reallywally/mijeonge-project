"""작업 쓰기 — 등록 · 부분 수정 · 본문 줄 · 안건 링크.

작업 ↔ 안건 링크(`task_thread_link`)는 멱등이다: PUT 을 두 번 눌러도 결과가 같고,
없는 링크를 DELETE 해도 성공이다. 읽기 쪽(`services/snapshot.py`)이 쓰는 `to_task` 도
여기 둔다 — 변환을 두 벌 갖지 않는다.
"""

from collections.abc import Collection, Sequence
from datetime import datetime
from typing import NamedTuple

from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import (
    Project,
    Task,
    TaskComment,
    TaskLine,
    TaskLog,
    TaskThreadLink,
    Thread,
    new_id,
)
from app.schemas.task import (
    PROPOSAL_MAX,
    BatchTaskIn,
    ProposedTask,
    TaskBatchInput,
    TaskBatchResult,
    TaskCreate,
    TaskLineOut,
    TaskLinePatchIn,
    TaskOut,
    TaskPatch,
    TaskThreadLinkOut,
)
from app.services import access
from app.services import history as history_service
from app.services import part as part_service
from app.services import project as project_service
from app.time import now

# 최상위가 1단이다. 넘는 지난 데이터는 그대로 두고 새로 쌓는 것만 막는다 (Q64)
MAX_TASK_DEPTH = 4
DEPTH_EXCEEDED = "작업은 4단까지만 쌓을 수 있습니다."


def _depth_exceeded() -> ApiError:
    return bad_request("TASK_DEPTH_EXCEEDED", DEPTH_EXCEEDED)


class StatusSince(NamedTuple):
    """지금 상태가 된 시각 — task_log 의 마지막 줄 (docs/api/task-flow.md)."""

    changed_at: datetime
    backfilled: bool


def to_task(row: Task, comment_count: int, since: StatusSince) -> TaskOut:
    """개수 · 상태 시각을 따로 받는다 — 작업마다 세면 목록 하나가 쿼리 수십 개가 된다
    (`comment_counts` · `status_since_map`)."""
    return TaskOut(
        id=row.id,
        project_id=row.project_id,
        key=row.key,
        title=row.title,
        parent_id=row.parent_id,
        body=[TaskLineOut.model_validate(line) for line in row.lines],
        status=row.status,
        owner_id=row.owner_id,
        start=row.start,
        due=row.due,
        priority=row.priority,
        part_id=row.part_id,
        created_at=row.created_at,
        comment_count=comment_count,
        minutes_id=row.minutes_id,
        status_changed_at=since.changed_at,
        status_since_backfill=since.backfilled,
    )


def record_status(
    session: AsyncSession,
    task: Task,
    from_status: str | None,
    changed_by: str | None,
    at: datetime,
) -> StatusSince:
    """상태가 바뀐 줄 하나 — **상태가 바뀌는 길은 전부 이것을 부른다**(등록 · PATCH · 일괄 · 회의록)

    같은 상태로의 '바뀜' 은 부르는 쪽이 거른다. 커밋하지 않는다.
    """
    session.add(
        TaskLog(
            id=new_id(),
            project_id=task.project_id,
            task_id=task.id,
            from_status=from_status,
            to_status=task.status,
            changed_by=changed_by,
            changed_at=at,
            backfilled=False,
        )
    )
    return StatusSince(at, False)


def _last_logs() -> Select[tuple[str, datetime, bool]]:
    last = (
        select(TaskLog.task_id, func.max(TaskLog.seq).label("seq"))
        .group_by(TaskLog.task_id)
        .subquery()
    )
    return select(TaskLog.task_id, TaskLog.changed_at, TaskLog.backfilled).join(
        last, (last.c.task_id == TaskLog.task_id) & (last.c.seq == TaskLog.seq)
    )


async def status_since_map(session: AsyncSession, project_id: str) -> dict[str, StatusSince]:
    """그 프로젝트 작업들의 '지금 상태가 된 시각' 을 한 번에 — 순서는 seq 가 정한다 (API.md Q15)."""
    rows = await session.execute(_last_logs().where(TaskLog.project_id == project_id))
    return {task_id: StatusSince(at, backfilled) for task_id, at, backfilled in rows.tuples()}


async def status_since(session: AsyncSession, task: Task) -> StatusSince:
    found = (await session.execute(_last_logs().where(TaskLog.task_id == task.id))).one_or_none()
    if found is None:
        # 줄이 없을 수 없지만(backfill) 비었으면 등록 시각으로 본다 — 500 을 내지 않는다
        return StatusSince(task.created_at, True)
    return StatusSince(found.changed_at, found.backfilled)


def since_or_created(found: dict[str, StatusSince], task: Task) -> StatusSince:
    return found.get(task.id) or StatusSince(task.created_at, True)


async def comment_counts(session: AsyncSession, project_id: str) -> dict[str, int]:
    """그 프로젝트 작업들의 댓글 수를 한 번에 센다. 댓글이 없는 작업은 키가 없다(0 으로 읽는다)."""
    rows = await session.execute(
        select(TaskComment.task_id, func.count())
        .join(Task, Task.id == TaskComment.task_id)
        .where(Task.project_id == project_id)
        .group_by(TaskComment.task_id)
    )
    return {task_id: count for task_id, count in rows.tuples().all()}


async def comment_count(session: AsyncSession, task_id: str) -> int:
    counted = await session.scalar(
        select(func.count()).select_from(TaskComment).where(TaskComment.task_id == task_id)
    )
    return counted or 0


async def load_task(session: AsyncSession, task_id: str) -> Task:
    found = await session.execute(select(Task).where(Task.id == task_id))
    task = found.scalar_one_or_none()
    if task is None:
        raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")
    return task


async def _load_thread(session: AsyncSession, thread_id: str) -> Thread:
    found = await session.execute(select(Thread).where(Thread.id == thread_id))
    thread = found.scalar_one_or_none()
    if thread is None:
        raise not_found("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다.")
    return thread


async def _next_key(session: AsyncSession, project: Project) -> str:
    """작업 번호를 발번한다.

    최댓값+1 로 세지 않는다 — 지운 뒤 번호가 재사용되고, 두 사람이 동시에 등록하면 같은 번호가
    둘 나온다. 프로젝트 행의 카운터를 한 문장으로 올려 뽑으면 그 행의 잠금이 순서를 지켜 준다.
    """
    bumped = await session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(last_task_no=Project.last_task_no + 1)
        .returning(Project.last_task_no)
    )
    return f"{project.task_key_prefix}-{bumped.scalar_one()}"


async def _guard_parent(
    session: AsyncSession, project_id: str, task_id: str | None, parent_id: str | None
) -> int:
    """고리 금지 — 자기 자신이나 자손을 부모로 두면 조상을 타고 올라갈 때 돌아 나온다.

    등록할 때는 아직 id 가 없어(`task_id=None`) 고리가 생길 수 없고, 상위 작업이 있는지만 본다.
    돌려주는 값은 상위의 단(최상위면 1, 상위가 없으면 0) — 같은 걸음에서 센다.
    """
    if parent_id is None:
        return 0
    if parent_id == task_id:
        raise bad_request("TASK_PARENT_SELF", "작업을 자기 자신의 상위로 둘 수 없습니다.")

    parent = await session.execute(select(Task).where(Task.id == parent_id))
    found = parent.scalar_one_or_none()
    if found is None:
        raise bad_request("TASK_PARENT_NOT_FOUND", "상위 작업을 찾을 수 없습니다.")
    if found.project_id != project_id:
        raise bad_request("TASK_PARENT_OTHER_PROJECT", "상위 작업이 다른 프로젝트에 있습니다.")

    depth = 1
    seen: set[str] = set()
    walker: str | None = found.parent_id
    while walker is not None:
        if walker == task_id:
            raise bad_request("TASK_PARENT_DESCENDANT", "하위 작업을 상위로 둘 수 없습니다.")
        if walker in seen:  # 이미 망가진 데이터를 만나도 여기서 멈춘다
            return depth
        seen.add(walker)
        depth += 1
        walker = await session.scalar(select(Task.parent_id).where(Task.id == walker))
    return depth


async def _subtree_height(session: AsyncSession, task_id: str, limit: int) -> int:
    """자기만 있으면 1. `limit` 을 넘는 줄 알면 더 내려가지 않는다 — 단마다 쿼리 하나."""
    height = 1
    seen = {task_id}
    frontier = [task_id]
    while height <= limit:
        children = [
            child
            for child in (
                await session.scalars(select(Task.id).where(Task.parent_id.in_(frontier)))
            ).all()
            if child not in seen  # 망가진 고리는 한 번만 센다
        ]
        if not children:
            break
        seen.update(children)
        frontier = children
        height += 1
    return height


async def _insert_task(
    session: AsyncSession, project: Project, payload: TaskCreate, actor_id: str | None
) -> Task:
    """작업 하나를 넣는다 — 상태 기록 첫 줄(`null → 상태`) · 이력 '등록' 줄까지.
    커밋하지 않는다 — 일괄 등록 · 회의록 apply 가 여럿을 한 트랜잭션에 묶는다."""
    if await _guard_parent(session, project.id, None, payload.parent_id) + 1 > MAX_TASK_DEPTH:
        raise _depth_exceeded()
    part_id = await _part_for_new_task(session, project.id, payload)

    task = Task(
        id=new_id(),
        project_id=project.id,
        key=await _next_key(session, project),
        title=payload.title,
        parent_id=payload.parent_id,
        status=payload.status,
        owner_id=payload.owner_id,
        start=payload.start,
        due=payload.due,
        priority=payload.priority,
        part_id=part_id,
        created_at=now(),
        # 화면이 보낸 줄 id 는 화면 안에서만 쓰던 값이다 — 서버가 새로 붙인다
        lines=[
            TaskLine(
                id=new_id(),
                kind=line.kind,
                text=line.text,
                done=line.done,
                level=line.level,
                sort_order=order,
            )
            for order, line in enumerate(payload.body)
        ],
    )
    session.add(task)
    await session.flush()
    record_status(session, task, None, actor_id, task.created_at)
    # 같이 건 안건은 '등록' 에 든 것으로 본다 — 링크 줄을 따로 안 만든다 (docs/api/history.md)
    history_service.record_task(session, task, history_service.created(), actor_id, task.created_at)

    for thread_id in dict.fromkeys(payload.thread_ids):
        await _attach_thread(session, task, thread_id)
    return task


async def _part_for_new_task(
    session: AsyncSession, project_id: str, payload: TaskCreate
) -> str | None:
    """새 작업의 파트. **키를 안 보냈으면 상위 작업의 파트를 따른다**(최상위면 null) —
    null 을 보낸 것(공통)과 가른다. 따라온 파트도 새로 다는 것이라 보관이면 400 이다."""
    if "part_id" in payload.model_fields_set:
        part_id = payload.part_id
    elif payload.parent_id is not None:
        part_id = await session.scalar(select(Task.part_id).where(Task.id == payload.parent_id))
    else:
        part_id = None
    await part_service.guard_part(session, project_id, part_id)
    return part_id


async def _guard_owner(session: AsyncSession, project_id: str, owner_id: str | None) -> None:
    """새로 지정하는 담당자는 그 프로젝트의 활성 멤버여야 한다 (docs/api/auth.md).

    없는 멤버면 FK 가 500 을 내므로 400 으로 먼저 거른다 — 일괄 등록은 `missing_owners`.
    """
    if owner_id is not None and not await access.is_assignable(session, project_id, owner_id):
        raise ApiError(
            400,
            "TASK_OWNER_NOT_FOUND",
            "담당자를 찾을 수 없습니다.",
            {"ownerId": "담당자를 찾을 수 없습니다."},
        )


async def create_task(
    session: AsyncSession, project_id: str, payload: TaskCreate, actor_id: str
) -> TaskOut:
    project = await project_service.load_project(session, project_id)
    await _guard_owner(session, project.id, payload.owner_id)
    task = await _insert_task(session, project, payload, actor_id)
    await session.commit()
    # 방금 만든 작업이라 댓글이 있을 수 없다
    return to_task(task, 0, StatusSince(task.created_at, False))


def proposal_problems(tasks: Sequence[ProposedTask]) -> dict[str, str]:
    """초안 검사 규칙(API.md '작업 초안'). 챗봇의 propose_tasks 와 일괄 등록이 이 하나를 같이 쓴다.

    DB 를 안 보는 것만 여기서 본다 — 멤버가 있는지는 `missing_owners`.
    """
    if not tasks:
        return {"tasks": "작업이 하나도 없습니다."}
    if len(tasks) > PROPOSAL_MAX:
        return {"tasks": f"작업은 한 번에 {PROPOSAL_MAX}개까지입니다."}
    return task_problems(tasks)


def task_problems(
    tasks: Sequence[ProposedTask], *, taken: Collection[str] = frozenset()
) -> dict[str, str]:
    """작업 줄마다의 규칙 — 개수는 부르는 쪽이 본다. 회의록 초안도 이것을 같이 쓴다.

    `taken` 은 같은 초안의 다른 줄(새 안건 · 이력)이 쓴 tempId 다.
    겹치면 안 되지만 상위는 될 수 없다.
    """
    problems: dict[str, str] = {}
    seen: set[str] = set()
    for index, item in enumerate(tasks):
        at = f"tasks.{index}"
        if not item.temp_id.strip():
            problems[f"{at}.tempId"] = "값을 입력해 주세요."
        elif item.temp_id in seen:
            problems[f"{at}.tempId"] = "앞의 작업과 tempId 가 겹칩니다."
        elif item.temp_id in taken:
            problems[f"{at}.tempId"] = "초안의 다른 줄과 tempId 가 겹칩니다."
        # 앞에 있는 것만 상위가 될 수 있다 — 자기 자신 · 뒤의 것을 가리키면 고리가 생길 수 있다
        if item.parent_temp_id is not None and item.parent_temp_id not in seen:
            problems[f"{at}.parentTempId"] = "상위 작업은 이 작업보다 앞에 있어야 합니다."
        if item.parent_temp_id is not None and item.parent_id is not None:
            problems[f"{at}.parentId"] = "상위는 parentTempId 와 parentId 중 하나만 둡니다."
        if not item.title.strip():
            problems[f"{at}.title"] = "제목을 입력해 주세요."
        if item.start is not None and item.due is not None and item.start > item.due:
            problems[f"{at}.due"] = "마감이 시작보다 빠릅니다."
        seen.add(item.temp_id)
    return problems


async def missing_owners(
    session: AsyncSession, project_id: str, tasks: Sequence[ProposedTask]
) -> dict[str, str]:
    """그 프로젝트의 활성 멤버가 아닌 담당자를 가리키는 자리. 없는 멤버도 여기 걸린다."""
    wanted = {item.owner_id for item in tasks if item.owner_id is not None}
    if not wanted:
        return {}
    found = await access.active_project_members(session, project_id, wanted)
    return {
        f"tasks.{index}.ownerId": "담당자를 찾을 수 없습니다."
        for index, item in enumerate(tasks)
        if item.owner_id is not None and item.owner_id not in found
    }


async def missing_parents(
    session: AsyncSession, project_id: str, tasks: Sequence[ProposedTask]
) -> dict[str, str]:
    """`parentId` 가 그 프로젝트의 작업이 아닌 자리. 다른 프로젝트의 작업도 '없다' 로 본다."""
    wanted = {item.parent_id for item in tasks if item.parent_id is not None}
    if not wanted:
        return {}
    found = set(
        (
            await session.scalars(
                select(Task.id).where(Task.project_id == project_id, Task.id.in_(wanted))
            )
        ).all()
    )
    return {
        f"tasks.{index}.parentId": "상위 작업을 찾을 수 없습니다."
        for index, item in enumerate(tasks)
        if item.parent_id is not None and item.parent_id not in found
    }


async def too_deep(
    session: AsyncSession, project_id: str, tasks: Sequence[ProposedTask]
) -> dict[str, str]:
    """넣으면 4단을 넘는 자리 — `tasks.N.parentTempId` · `tasks.N.parentId`.

    없는 상위 · 뒤를 가리키는 상위는 앞의 검사가 짚으니 여기서는 건너뛴다.
    """
    if not any(item.parent_id is not None for item in tasks):
        parent_of: dict[str, str | None] = {}
    else:
        rows = await session.execute(
            select(Task.id, Task.parent_id).where(Task.project_id == project_id)
        )
        parent_of = dict(rows.tuples().all())

    def depth_of(task_id: str) -> int:
        depth, seen = 0, set[str]()
        walker: str | None = task_id
        while walker is not None and walker not in seen:  # 망가진 고리에서도 멈춘다
            seen.add(walker)
            depth += 1
            walker = parent_of.get(walker)
        return depth

    problems: dict[str, str] = {}
    depth_by_temp: dict[str, int] = {}
    for index, item in enumerate(tasks):
        if item.parent_temp_id is not None:
            if item.parent_temp_id not in depth_by_temp:
                continue
            depth, at = depth_by_temp[item.parent_temp_id] + 1, "parentTempId"
        elif item.parent_id is not None:
            if item.parent_id not in parent_of:
                continue
            depth, at = depth_of(item.parent_id) + 1, "parentId"
        else:
            depth, at = 1, ""
        if depth > MAX_TASK_DEPTH:
            problems[f"tasks.{index}.{at}"] = DEPTH_EXCEEDED
        depth_by_temp.setdefault(item.temp_id, depth)
    return problems


async def create_tasks(
    session: AsyncSession, project_id: str, payload: TaskBatchInput, actor_id: str
) -> TaskBatchResult:
    """초안을 한 트랜잭션에 넣는다. 하나라도 틀리면 아무것도 안 남는다 — 발번한 번호까지."""
    project = await project_service.load_project(session, project_id)
    problems = proposal_problems(payload.tasks)
    if problems:
        raise ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", problems)
    missing = await missing_owners(session, project.id, payload.tasks)
    if missing:
        raise ApiError(400, "TASK_OWNER_NOT_FOUND", "담당자를 찾을 수 없습니다.", missing)
    orphans = await missing_parents(session, project.id, payload.tasks)
    if orphans:
        raise ApiError(400, "TASK_PARENT_NOT_FOUND", "상위 작업을 찾을 수 없습니다.", orphans)
    deep = await too_deep(session, project.id, payload.tasks)
    if deep:
        raise ApiError(400, "TASK_DEPTH_EXCEEDED", DEPTH_EXCEEDED, deep)
    await _guard_batch_parts(session, project.id, payload.tasks)

    id_by_temp: dict[str, str] = {}
    created: list[Task] = []
    try:
        # 배열 순서대로 넣는다 — 번호가 그 순서로 나가고, 상위가 늘 먼저 들어가 있다
        for item in payload.tasks:
            fields = {
                "title": item.title.strip(),
                "parent_id": (
                    id_by_temp[item.parent_temp_id]
                    if item.parent_temp_id is not None
                    else item.parent_id
                ),
                "owner_id": item.owner_id,
                "start": item.start,
                "due": item.due,
                "priority": item.priority,
            }
            # 보낸 줄만 partId 를 넘긴다 — 안 보낸 줄은 앞의 상위를 따른다
            if "part_id" in item.model_fields_set:
                fields["part_id"] = item.part_id
            task = await _insert_task(session, project, TaskCreate.model_validate(fields), actor_id)
            id_by_temp[item.temp_id] = task.id
            created.append(task)
        await session.commit()
    except Exception:
        # 세션을 누가 닫든 여기서 되돌린다 — 반쯤 들어간 작업이 다음 쿼리에 끌려 나가지 않게
        await session.rollback()
        raise
    return TaskBatchResult(
        tasks=[to_task(task, 0, StatusSince(task.created_at, False)) for task in created],
        task_id_by_temp_id=id_by_temp,
    )


async def _guard_batch_parts(
    session: AsyncSession, project_id: str, tasks: Sequence[BatchTaskIn]
) -> None:
    """일괄 등록이 보낸 `partId` 를 넣기 전에 다 본다 — 몇 번째 줄인지 `tasks.1.partId` 로 짚는다.

    안 보낸 줄은 앞의 줄(또는 공통)을 따르니 따로 볼 것이 없다.
    """
    for index, item in enumerate(tasks):
        if "part_id" in item.model_fields_set:
            await part_service.guard_part(
                session, project_id, item.part_id, field=f"tasks.{index}.partId"
            )


async def patch_task(
    session: AsyncSession, task_id: str, payload: TaskPatch, actor_id: str
) -> TaskOut:
    task = await load_task(session, task_id)
    before = task.status
    snapshot = _history_fields(task)
    body_before = _body_shape(task.lines)
    # exclude_unset — 안 보낸 것과 null 로 보낸 것을 가른다. ownerId: null 은 담당자 지우기다
    changes = payload.model_dump(exclude_unset=True, exclude={"body"})
    if "body" in payload.model_fields_set:
        _replace_body(task, payload.body)
    if "parent_id" in changes:
        depth = await _guard_parent(session, task.project_id, task.id, changes["parent_id"])
        # 상위를 그대로 두는 수정은 지난 깊은 데이터여도 막지 않는다. 최상위로 올리면 depth 는 0
        if changes["parent_id"] != task.parent_id and depth > 0:
            limit = MAX_TASK_DEPTH - depth
            if await _subtree_height(session, task.id, limit) > limit:
                raise _depth_exceeded()
    # 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다 — 프로젝트에서 빠진 사람이어도
    if "owner_id" in changes and changes["owner_id"] != task.owner_id:
        await _guard_owner(session, task.project_id, changes["owner_id"])
    # 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다. 하위 작업은 따라 바뀌지 않는다
    if "part_id" in changes and changes["part_id"] != task.part_id:
        await part_service.guard_part(session, task.project_id, changes["part_id"])
    for field, value in changes.items():
        setattr(task, field, value)
    at = now()
    # 상태가 그대로인 수정은 남기지 않는다 — '진행 중이 된 지 며칠' 이 다시 0 이 되면 안 된다
    if task.status != before:
        record_status(session, task, before, actor_id, at)
    after = dict(_history_fields(task))
    changed = history_service.diff((field, old, after[field]) for field, old in snapshot)
    # 본문은 바뀌었다는 것만 남긴다 — 줄 단위 비교는 나중 (docs/api/history.md '긴 글')
    if _body_shape(task.lines) != body_before:
        changed.append(history_service.change("body", None, None))
    history_service.record_task(session, task, changed, actor_id, at)
    await session.commit()
    return to_task(task, await comment_count(session, task.id), await status_since(session, task))


def _history_fields(task: Task) -> list[tuple[str, object]]:
    """PATCH 가 남기는 칸 — 계약 '칸' 표의 순서다. 본문은 따로 본다."""
    return [
        ("title", task.title),
        ("status", task.status),
        ("priority", task.priority),
        ("ownerId", task.owner_id),
        ("partId", task.part_id),
        ("parentId", task.parent_id),
        ("start", task.start),
        ("due", task.due),
    ]


def _body_shape(lines: Sequence[TaskLine]) -> list[tuple[str, str, bool, int]]:
    """본문이 바뀌었나를 가르는 값 — 줄 글 · 종류 · 체크 · 들여쓰기 · 순서. 줄 id 는 안 본다."""
    return [(line.text, line.kind, line.done, line.level) for line in lines]


def _replace_body(task: Task, body: list[TaskLinePatchIn]) -> None:
    """본문을 통째로 갈아끼운다. 기존 줄 id 는 행을 그대로 고쳐 써서 유지하고,
    빠진 줄은 delete-orphan 이 지운다. 남의 작업 줄 id 는 이 작업의 줄 목록에 없으니 새 id 다."""
    existing = {line.id: line for line in task.lines}
    used: set[str] = set()
    lines: list[TaskLine] = []
    for order, item in enumerate(body):
        line = existing.get(item.id) if item.id is not None and item.id not in used else None
        if line is None:
            line = TaskLine(id=new_id())
        used.add(line.id)
        line.kind = item.kind
        line.text = item.text
        line.done = item.done
        line.level = item.level
        line.sort_order = order
        lines.append(line)
    task.lines = lines


async def set_line_done(
    session: AsyncSession, task_id: str, line_id: str, done: bool, actor_id: str
) -> TaskOut:
    task = await load_task(session, task_id)
    line = next((each for each in task.lines if each.id == line_id), None)
    if line is None:
        raise not_found("TASK_LINE_NOT_FOUND", "그 본문 줄을 찾을 수 없습니다.")
    if line.kind != "check":
        raise bad_request("TASK_LINE_NOT_CHECKABLE", "체크박스가 아닌 줄은 켜고 끌 수 없습니다.")
    if line.done != done:
        history_service.record_task(
            session,
            task,
            [history_service.change("lineDone", line.done, done, subject=line.text)],
            actor_id,
            now(),
        )
    line.done = done
    await session.commit()
    return to_task(task, await comment_count(session, task.id), await status_since(session, task))


async def _attach_thread(session: AsyncSession, task: Task, thread_id: str) -> bool:
    """같은 프로젝트인지 보고 링크를 건다. 이미 있으면 아무것도 하지 않는다(멱등).
    새로 걸었으면 True — 이력은 새로 건 것만 남긴다."""
    thread = await _load_thread(session, thread_id)
    if thread.project_id != task.project_id:
        raise bad_request(
            "TASK_THREAD_LINK_OTHER_PROJECT", "작업과 안건이 서로 다른 프로젝트에 있습니다."
        )
    found = await session.execute(
        select(TaskThreadLink).where(
            TaskThreadLink.task_id == task.id, TaskThreadLink.thread_id == thread_id
        )
    )
    if found.scalar_one_or_none() is not None:
        return False
    session.add(TaskThreadLink(task_id=task.id, thread_id=thread_id, project_id=task.project_id))
    return True


async def link_thread(
    session: AsyncSession, task_id: str, thread_id: str, actor_id: str
) -> TaskThreadLinkOut:
    task = await load_task(session, task_id)
    if await _attach_thread(session, task, thread_id):
        history_service.record_task(
            session, task, [history_service.change("thread", None, thread_id)], actor_id, now()
        )
    await session.commit()
    return TaskThreadLinkOut(task_id=task_id, thread_id=thread_id)


async def unlink_thread(session: AsyncSession, task_id: str, thread_id: str, actor_id: str) -> None:
    task = await load_task(session, task_id)
    linked = await session.scalar(
        select(TaskThreadLink.thread_id).where(
            TaskThreadLink.task_id == task_id, TaskThreadLink.thread_id == thread_id
        )
    )
    # 없는 링크를 떼는 것도 성공이지만 이력은 있던 것을 뗄 때만 남긴다
    if linked is None:
        return
    await session.execute(
        delete(TaskThreadLink).where(
            TaskThreadLink.task_id == task_id, TaskThreadLink.thread_id == thread_id
        )
    )
    history_service.record_task(
        session, task, [history_service.change("thread", thread_id, None)], actor_id, now()
    )
    await session.commit()

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
    TaskRelation,
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
        related_ids=row.related_ids,
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


async def _found_tasks(session: AsyncSession, project_id: str, ids: Collection[str]) -> set[str]:
    """그 프로젝트에 있는 작업 id 만. 다른 프로젝트의 작업도 '없다' 로 본다."""
    if not ids:
        return set()
    rows = await session.scalars(
        select(Task.id).where(Task.project_id == project_id, Task.id.in_(set(ids)))
    )
    return set(rows.all())


async def _replace_related(session: AsyncSession, task: Task, related_ids: list[str]) -> None:
    """연관 작업을 통째로 갈아끼운다 (Q61). 중복은 스키마가 이미 뺐다.

    그대로 남는 줄은 행을 지켜 건 시각(= 순서)이 안 흔들린다. 새로 건 것은 뒤에 붙는다 —
    한 번에 건 것끼리는 시각이 같아 id 순이다(읽을 때의 order_by 와 같게 맞춘다).
    """
    if task.id in related_ids:
        raise bad_request("TASK_RELATED_SELF", "자기 자신은 연관 작업으로 걸 수 없습니다.")
    found = await _found_tasks(session, task.project_id, related_ids)
    if any(related_id not in found for related_id in related_ids):
        raise bad_request("TASK_RELATED_NOT_FOUND", "연관 작업을 찾을 수 없습니다.")
    wanted = set(related_ids)
    kept = [relation for relation in task.relations if relation.related_id in wanted]
    have = {relation.related_id for relation in kept}
    at = now()
    added = [
        TaskRelation(
            task_id=task.id, related_id=related_id, project_id=task.project_id, created_at=at
        )
        for related_id in sorted(wanted - have)
    ]
    task.relations = kept + added


async def _insert_task(
    session: AsyncSession,
    project: Project,
    payload: TaskCreate,
    actor_id: str | None,
    related_id: str | None = None,
) -> Task:
    """작업 하나를 넣는다 — 상태 기록 첫 줄(`null → 상태`) · 이력 '등록' 줄까지.
    커밋하지 않는다 — 일괄 등록 · 회의록 apply 가 여럿을 한 트랜잭션에 묶는다."""
    # 안 보내거나 null 이면 공통 — 상위를 따르는 규칙은 없어졌다 (Q61)
    await part_service.guard_part(session, project.id, payload.part_id)

    task = Task(
        id=new_id(),
        project_id=project.id,
        key=await _next_key(session, project),
        title=payload.title,
        status=payload.status,
        owner_id=payload.owner_id,
        start=payload.start,
        due=payload.due,
        priority=payload.priority,
        part_id=payload.part_id,
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
        relations=[],
    )
    if related_id is not None:
        # 초안의 relatedId — 새 작업 → 그 작업 한 줄. 있는지는 부르는 쪽이 이미 봤다
        task.relations = [
            TaskRelation(
                task_id=task.id,
                related_id=related_id,
                project_id=project.id,
                created_at=task.created_at,
            )
        ]
    session.add(task)
    await session.flush()
    record_status(session, task, None, actor_id, task.created_at)
    # 같이 건 안건은 '등록' 에 든 것으로 본다 — 링크 줄을 따로 안 만든다 (docs/api/history.md)
    history_service.record_task(session, task, history_service.created(), actor_id, task.created_at)

    for thread_id in dict.fromkeys(payload.thread_ids):
        await _attach_thread(session, task, thread_id)
    return task


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

    `taken` 은 같은 초안의 다른 줄(새 안건 · 이력)이 쓴 tempId 다. 겹치면 안 된다.
    초안은 평평해서(Q61) 줄끼리 가리키는 칸이 없다.
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


RELATED_MISSING = "연관 작업을 찾을 수 없습니다."


async def missing_related(
    session: AsyncSession, project_id: str, tasks: Sequence[ProposedTask]
) -> dict[str, str]:
    """`relatedId` 가 그 프로젝트의 작업이 아닌 자리. 다른 프로젝트의 작업도 '없다' 로 본다."""
    wanted = {item.related_id for item in tasks if item.related_id is not None}
    found = await _found_tasks(session, project_id, wanted)
    return {
        f"tasks.{index}.relatedId": RELATED_MISSING
        for index, item in enumerate(tasks)
        if item.related_id is not None and item.related_id not in found
    }


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
    orphans = await missing_related(session, project.id, payload.tasks)
    if orphans:
        raise ApiError(400, "TASK_RELATED_NOT_FOUND", RELATED_MISSING, orphans)
    await _guard_batch_parts(session, project.id, payload.tasks)

    id_by_temp: dict[str, str] = {}
    created: list[Task] = []
    try:
        # 배열 순서대로 넣는다 — 번호가 그 순서로 나간다
        for item in payload.tasks:
            fields = {
                "title": item.title.strip(),
                "owner_id": item.owner_id,
                "start": item.start,
                "due": item.due,
                "priority": item.priority,
                "part_id": item.part_id,
            }
            task = await _insert_task(
                session, project, TaskCreate.model_validate(fields), actor_id, item.related_id
            )
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

    안 보낸 줄 · null 은 공통이라 볼 것이 없다.
    """
    for index, item in enumerate(tasks):
        if item.part_id is not None:
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
    changes = payload.model_dump(exclude_unset=True, exclude={"body", "related_ids"})
    if "body" in payload.model_fields_set:
        _replace_body(task, payload.body)
    if "related_ids" in payload.model_fields_set:
        await _replace_related(session, task, payload.related_ids)
    # 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다 — 프로젝트에서 빠진 사람이어도
    if "owner_id" in changes and changes["owner_id"] != task.owner_id:
        await _guard_owner(session, task.project_id, changes["owner_id"])
    # 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다
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
        # 건 순서의 id 목록 — 남는 줄은 순서를 지키므로 같은 집합이면 같은 목록이다
        ("relatedIds", task.related_ids),
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

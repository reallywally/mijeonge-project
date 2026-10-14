"""작업 쓰기 — 등록 · 부분 수정 · 본문 줄 · 안건 링크.

작업 ↔ 안건 링크(`task_thread_link`)는 멱등이다: PUT 을 두 번 눌러도 결과가 같고,
없는 링크를 DELETE 해도 성공이다. 읽기 쪽(`services/snapshot.py`)이 쓰는 `to_task` 도
여기 둔다 — 변환을 두 벌 갖지 않는다.
"""

from collections.abc import Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import (
    Project,
    Task,
    TaskComment,
    TaskLine,
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
from app.services import part as part_service
from app.services import project as project_service
from app.time import now


def to_task(row: Task, comment_count: int) -> TaskOut:
    """개수를 따로 받는다 — 작업마다 세면 목록 하나가 쿼리 수십 개가 된다(`comment_counts`)."""
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
    )


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
) -> None:
    """고리 금지 — 자기 자신이나 자손을 부모로 두면 조상을 타고 올라갈 때 돌아 나온다.

    등록할 때는 아직 id 가 없어(`task_id=None`) 고리가 생길 수 없고, 상위 작업이 있는지만 본다.
    """
    if parent_id is None:
        return
    if parent_id == task_id:
        raise bad_request("TASK_PARENT_SELF", "작업을 자기 자신의 상위로 둘 수 없습니다.")

    parent = await session.execute(select(Task).where(Task.id == parent_id))
    found = parent.scalar_one_or_none()
    if found is None:
        raise bad_request("TASK_PARENT_NOT_FOUND", "상위 작업을 찾을 수 없습니다.")
    if found.project_id != project_id:
        raise bad_request("TASK_PARENT_OTHER_PROJECT", "상위 작업이 다른 프로젝트에 있습니다.")

    seen: set[str] = set()
    walker: str | None = found.parent_id
    while walker is not None:
        if walker == task_id:
            raise bad_request("TASK_PARENT_DESCENDANT", "하위 작업을 상위로 둘 수 없습니다.")
        if walker in seen:  # 이미 망가진 데이터를 만나도 여기서 멈춘다
            return
        seen.add(walker)
        walker = await session.scalar(select(Task.parent_id).where(Task.id == walker))


async def _insert_task(session: AsyncSession, project: Project, payload: TaskCreate) -> Task:
    """작업 하나를 넣는다. 커밋하지 않는다 — 일괄 등록이 여럿을 한 트랜잭션에 묶는다."""
    await _guard_parent(session, project.id, None, payload.parent_id)
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


async def create_task(session: AsyncSession, project_id: str, payload: TaskCreate) -> TaskOut:
    project = await project_service.load_project(session, project_id)
    await _guard_owner(session, project.id, payload.owner_id)
    task = await _insert_task(session, project, payload)
    await session.commit()
    # 방금 만든 작업이라 댓글이 있을 수 없다
    return to_task(task, comment_count=0)


def proposal_problems(tasks: Sequence[ProposedTask]) -> dict[str, str]:
    """초안 검사 규칙(API.md '작업 초안'). 챗봇의 propose_tasks 와 일괄 등록이 이 하나를 같이 쓴다.

    DB 를 안 보는 것만 여기서 본다 — 멤버가 있는지는 `missing_owners`.
    """
    if not tasks:
        return {"tasks": "작업이 하나도 없습니다."}
    if len(tasks) > PROPOSAL_MAX:
        return {"tasks": f"작업은 한 번에 {PROPOSAL_MAX}개까지입니다."}

    problems: dict[str, str] = {}
    seen: set[str] = set()
    for index, item in enumerate(tasks):
        at = f"tasks.{index}"
        if not item.temp_id.strip():
            problems[f"{at}.tempId"] = "값을 입력해 주세요."
        elif item.temp_id in seen:
            problems[f"{at}.tempId"] = "앞의 작업과 tempId 가 겹칩니다."
        # 앞에 있는 것만 상위가 될 수 있다 — 자기 자신 · 뒤의 것을 가리키면 고리가 생길 수 있다
        if item.parent_temp_id is not None and item.parent_temp_id not in seen:
            problems[f"{at}.parentTempId"] = "상위 작업은 이 작업보다 앞에 있어야 합니다."
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


async def create_tasks(
    session: AsyncSession, project_id: str, payload: TaskBatchInput
) -> TaskBatchResult:
    """초안을 한 트랜잭션에 넣는다. 하나라도 틀리면 아무것도 안 남는다 — 발번한 번호까지."""
    project = await project_service.load_project(session, project_id)
    problems = proposal_problems(payload.tasks)
    if problems:
        raise ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", problems)
    missing = await missing_owners(session, project.id, payload.tasks)
    if missing:
        raise ApiError(400, "TASK_OWNER_NOT_FOUND", "담당자를 찾을 수 없습니다.", missing)
    await _guard_batch_parts(session, project.id, payload.tasks)

    id_by_temp: dict[str, str] = {}
    created: list[Task] = []
    try:
        # 배열 순서대로 넣는다 — 번호가 그 순서로 나가고, 상위가 늘 먼저 들어가 있다
        for item in payload.tasks:
            fields = {
                "title": item.title.strip(),
                "parent_id": (
                    id_by_temp[item.parent_temp_id] if item.parent_temp_id is not None else None
                ),
                "owner_id": item.owner_id,
                "start": item.start,
                "due": item.due,
                "priority": item.priority,
            }
            # 보낸 줄만 partId 를 넘긴다 — 안 보낸 줄은 앞의 상위를 따른다
            if "part_id" in item.model_fields_set:
                fields["part_id"] = item.part_id
            task = await _insert_task(session, project, TaskCreate.model_validate(fields))
            id_by_temp[item.temp_id] = task.id
            created.append(task)
        await session.commit()
    except Exception:
        # 세션을 누가 닫든 여기서 되돌린다 — 반쯤 들어간 작업이 다음 쿼리에 끌려 나가지 않게
        await session.rollback()
        raise
    return TaskBatchResult(
        tasks=[to_task(task, comment_count=0) for task in created],
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


async def patch_task(session: AsyncSession, task_id: str, payload: TaskPatch) -> TaskOut:
    task = await load_task(session, task_id)
    # exclude_unset — 안 보낸 것과 null 로 보낸 것을 가른다. ownerId: null 은 담당자 지우기다
    changes = payload.model_dump(exclude_unset=True, exclude={"body"})
    if "body" in payload.model_fields_set:
        _replace_body(task, payload.body)
    if "parent_id" in changes:
        await _guard_parent(session, task.project_id, task.id, changes["parent_id"])
    # 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다 — 프로젝트에서 빠진 사람이어도
    if "owner_id" in changes and changes["owner_id"] != task.owner_id:
        await _guard_owner(session, task.project_id, changes["owner_id"])
    # 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다. 하위 작업은 따라 바뀌지 않는다
    if "part_id" in changes and changes["part_id"] != task.part_id:
        await part_service.guard_part(session, task.project_id, changes["part_id"])
    for field, value in changes.items():
        setattr(task, field, value)
    await session.commit()
    return to_task(task, await comment_count(session, task.id))


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


async def set_line_done(session: AsyncSession, task_id: str, line_id: str, done: bool) -> TaskOut:
    task = await load_task(session, task_id)
    line = next((each for each in task.lines if each.id == line_id), None)
    if line is None:
        raise not_found("TASK_LINE_NOT_FOUND", "그 본문 줄을 찾을 수 없습니다.")
    if line.kind != "check":
        raise bad_request("TASK_LINE_NOT_CHECKABLE", "체크박스가 아닌 줄은 켜고 끌 수 없습니다.")
    line.done = done
    await session.commit()
    return to_task(task, await comment_count(session, task.id))


async def _attach_thread(session: AsyncSession, task: Task, thread_id: str) -> None:
    """같은 프로젝트인지 보고 링크를 건다. 이미 있으면 아무것도 하지 않는다(멱등)."""
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
    if found.scalar_one_or_none() is None:
        session.add(
            TaskThreadLink(task_id=task.id, thread_id=thread_id, project_id=task.project_id)
        )


async def link_thread(session: AsyncSession, task_id: str, thread_id: str) -> TaskThreadLinkOut:
    task = await load_task(session, task_id)
    await _attach_thread(session, task, thread_id)
    await session.commit()
    return TaskThreadLinkOut(task_id=task_id, thread_id=thread_id)


async def unlink_thread(session: AsyncSession, task_id: str, thread_id: str) -> None:
    await load_task(session, task_id)
    await session.execute(
        delete(TaskThreadLink).where(
            TaskThreadLink.task_id == task_id, TaskThreadLink.thread_id == thread_id
        )
    )
    await session.commit()

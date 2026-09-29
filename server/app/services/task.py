"""작업 쓰기 — 등록 · 부분 수정 · 본문 줄 · 링크 둘.

링크 테이블 둘 다 작업에 걸린다(`task_thread_link` · `meeting_task_link`) — 회의 쪽 라우트도
여기 함수를 부른다. 링크는 멱등이다: PUT 을 두 번 눌러도 결과가 같고, 없는 링크를 DELETE 해도
성공이다. 읽기 쪽(`services/snapshot.py`)이 쓰는 `to_task` 도 여기 둔다 — 변환을 두 벌 갖지 않는다.
"""

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import bad_request, not_found
from app.models import (
    Meeting,
    MeetingTaskLink,
    Project,
    Task,
    TaskLine,
    TaskThreadLink,
    Thread,
    new_id,
)
from app.schemas.task import (
    MeetingTaskLinkOut,
    TaskCreate,
    TaskLineOut,
    TaskOut,
    TaskPatch,
    TaskThreadLinkOut,
)
from app.services import project as project_service
from app.time import now


def to_task(row: Task) -> TaskOut:
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
        created_at=row.created_at,
    )


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


async def _load_meeting(session: AsyncSession, meeting_id: str) -> Meeting:
    found = await session.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = found.scalar_one_or_none()
    if meeting is None:
        raise not_found("MEETING_NOT_FOUND", "회의를 찾을 수 없습니다.")
    return meeting


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


async def create_task(session: AsyncSession, project_id: str, payload: TaskCreate) -> TaskOut:
    project = await project_service.load_project(session, project_id)
    await _guard_parent(session, project_id, None, payload.parent_id)

    task = Task(
        id=new_id(),
        project_id=project_id,
        key=await _next_key(session, project),
        title=payload.title,
        parent_id=payload.parent_id,
        status=payload.status,
        owner_id=payload.owner_id,
        start=payload.start,
        due=payload.due,
        priority=payload.priority,
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
    await session.commit()
    return to_task(task)


async def patch_task(session: AsyncSession, task_id: str, payload: TaskPatch) -> TaskOut:
    task = await load_task(session, task_id)
    # exclude_unset — 안 보낸 것과 null 로 보낸 것을 가른다. ownerId: null 은 담당자 지우기다
    changes = payload.model_dump(exclude_unset=True)
    if "parent_id" in changes:
        await _guard_parent(session, task.project_id, task.id, changes["parent_id"])
    for field, value in changes.items():
        setattr(task, field, value)
    await session.commit()
    return to_task(task)


async def set_line_done(session: AsyncSession, task_id: str, line_id: str, done: bool) -> TaskOut:
    task = await load_task(session, task_id)
    line = next((each for each in task.lines if each.id == line_id), None)
    if line is None:
        raise not_found("TASK_LINE_NOT_FOUND", "그 본문 줄을 찾을 수 없습니다.")
    if line.kind != "check":
        raise bad_request("TASK_LINE_NOT_CHECKABLE", "체크박스가 아닌 줄은 켜고 끌 수 없습니다.")
    line.done = done
    await session.commit()
    return to_task(task)


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


async def link_meeting(session: AsyncSession, task_id: str, meeting_id: str) -> MeetingTaskLinkOut:
    task = await load_task(session, task_id)
    meeting = await _load_meeting(session, meeting_id)
    if meeting.project_id != task.project_id:
        raise bad_request(
            "MEETING_TASK_LINK_OTHER_PROJECT", "작업과 회의가 서로 다른 프로젝트에 있습니다."
        )
    found = await session.execute(
        select(MeetingTaskLink).where(
            MeetingTaskLink.task_id == task_id, MeetingTaskLink.meeting_id == meeting_id
        )
    )
    if found.scalar_one_or_none() is None:
        session.add(
            MeetingTaskLink(meeting_id=meeting_id, task_id=task_id, project_id=task.project_id)
        )
    await session.commit()
    return MeetingTaskLinkOut(meeting_id=meeting_id, task_id=task_id)


async def unlink_meeting(session: AsyncSession, task_id: str, meeting_id: str) -> None:
    await load_task(session, task_id)
    await session.execute(
        delete(MeetingTaskLink).where(
            MeetingTaskLink.task_id == task_id, MeetingTaskLink.meeting_id == meeting_id
        )
    )
    await session.commit()

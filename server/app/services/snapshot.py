"""프로젝트 스냅샷 — 그 프로젝트의 레코드 전부를 한 번에 준다.

지금 프론트 스토어가 "레코드를 다 들고 화면에서 계산"하는 구조라 그 모양대로 주는 것이
제일 적게 고친다. 목록 페이징 · 필터를 서버로 옮기는 건 5단계다.

**배열 순서까지가 계약이다.** 안건 목록(`stores/thread.ts` 의 `rows`)과 작업 목록에는
정렬이 아예 없어서 배열 순서가 곧 화면 순서고, 안건 이력은 같은 날짜의 줄을 배열 인덱스로
가른다(`stores/thread.ts` 의 seqNo). 그래서 **등록 순서(`seq`)** 로 내보낸다 —
`created_at` 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다.
"""

from collections.abc import Sequence

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, Meeting, MeetingTaskLink, Task, TaskThreadLink, Thread
from app.schemas.meeting import MeetingMemoOut, MeetingOut
from app.schemas.snapshot import SnapshotOut
from app.schemas.task import MeetingTaskLinkOut, TaskLineOut, TaskOut, TaskThreadLinkOut
from app.schemas.thread import EntryOut, ThreadOut


def _to_entry(row: Entry) -> EntryOut:
    return EntryOut(
        id=row.id,
        thread_id=row.thread_id,
        meeting_id=row.meeting_id,
        kind=row.kind,
        text=row.text,
        # entry_detail 행을 문자열 배열로 편다
        detail=[d.text for d in row.details],
        note=row.note,
        owner_id=row.owner_id,
        created_at=row.created_at,
    )


def _to_meeting(row: Meeting) -> MeetingOut:
    return MeetingOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        date=row.date,
        attendee_ids=sorted(a.member_id for a in row.attendees),
        memos=[
            MeetingMemoOut(id=m.id, text=m.text, promoted_thread_id=m.promoted_thread_id)
            for m in row.memos
        ],
    )


def _to_task(row: Task) -> TaskOut:
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


async def _all[T](session: AsyncSession, query: Select[tuple[T]]) -> Sequence[T]:
    return (await session.execute(query)).scalars().all()


async def load_snapshot(session: AsyncSession, project_id: str) -> SnapshotOut:
    threads = await _all(
        session,
        select(Thread).where(Thread.project_id == project_id).order_by(Thread.seq),
    )
    entries = await _all(
        session,
        select(Entry)
        .join(Thread, Thread.id == Entry.thread_id)
        .where(Thread.project_id == project_id)
        .order_by(Entry.seq),
    )
    meetings = await _all(
        session,
        select(Meeting).where(Meeting.project_id == project_id).order_by(Meeting.seq),
    )
    tasks = await _all(
        session, select(Task).where(Task.project_id == project_id).order_by(Task.seq)
    )
    task_threads = await _all(
        session,
        select(TaskThreadLink)
        .join(Task, Task.id == TaskThreadLink.task_id)
        .where(Task.project_id == project_id)
        .order_by(TaskThreadLink.task_id, TaskThreadLink.thread_id),
    )
    meeting_tasks = await _all(
        session,
        select(MeetingTaskLink)
        .join(Meeting, Meeting.id == MeetingTaskLink.meeting_id)
        .where(Meeting.project_id == project_id)
        .order_by(MeetingTaskLink.meeting_id, MeetingTaskLink.task_id),
    )

    return SnapshotOut(
        threads=[ThreadOut.model_validate(row) for row in threads],
        entries=[_to_entry(row) for row in entries],
        meetings=[_to_meeting(row) for row in meetings],
        tasks=[_to_task(row) for row in tasks],
        task_thread_links=[TaskThreadLinkOut.model_validate(row) for row in task_threads],
        meeting_task_links=[MeetingTaskLinkOut.model_validate(row) for row in meeting_tasks],
    )

"""회의 쓰기 — 새 회의 저장과 작업 링크.

**새 회의 저장 하나가 안건 등록 + 회의 + 줄 여럿 + 안건 상태 변경을 한꺼번에 한다.**
전부 한 트랜잭션이다 — 중간 커밋이 없어 하나가 틀어지면 회의가 통째로 없던 일이 된다.
안건 상태 전이는 `services/thread.py` 의 `apply_entry_to_thread` 가 혼자 갖는다.

회의 ↔ 작업 링크는 작업 상세에서 거는 것과 **같은 링크**다. 방향만 다르므로
`services/task.py` 의 함수를 그대로 부른다 — 두 벌로 갈리면 한쪽만 고치는 날이 온다.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meeting, MeetingAttendee, MeetingMemo, Member, Thread, new_id
from app.schemas.meeting import (
    MeetingCreate,
    MeetingMemoOut,
    MeetingOut,
    MeetingSaved,
    NewThreadIn,
)
from app.schemas.task import MeetingTaskLinkOut
from app.schemas.thread import ThreadOut
from app.services import project as project_service
from app.services import task as task_service
from app.services import thread as thread_service
from app.time import at_day_start


def to_meeting(row: Meeting) -> MeetingOut:
    return MeetingOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        date=row.date,
        attendee_ids=sorted(attendee.member_id for attendee in row.attendees),
        memos=[
            MeetingMemoOut(id=memo.id, text=memo.text, promoted_thread_id=memo.promoted_thread_id)
            for memo in row.memos
        ],
    )


def _temp_ids(new_threads: list[NewThreadIn]) -> dict[str, str]:
    """회의 중에 만든 안건의 실제 id 를 **미리** 만들어 둔다.

    하위 안건의 부모가 같은 회의에서 만든 안건일 수 있어, 만들기 전에 표가 다 서 있어야 한다.
    """
    mapped: dict[str, str] = {}
    for new_thread in new_threads:
        if new_thread.temp_id in mapped:
            raise HTTPException(status_code=400, detail=f"tempId 가 겹친다: {new_thread.temp_id}")
        mapped[new_thread.temp_id] = new_id()
    return mapped


def _resolve(value: str, temp_ids: dict[str, str], known: dict[str, Thread], what: str) -> str:
    """tempId 표에 있으면 실제 id 로, 없으면 그 값을 이미 있는 안건의 id 로 본다.

    `stores/meeting.ts` 의 resolve 와 같은 규칙이다 — 픽스처 mm7 처럼 이미 있는 안건(`t4`)을
    바로 가리키는 메모가 있다.
    """
    if value in temp_ids:
        return temp_ids[value]
    if value not in known:
        raise HTTPException(status_code=400, detail=f"{what}: {value}")
    return value


async def _check_members(session: AsyncSession, ids: set[str]) -> None:
    """회의 저장은 한 번에 많은 멤버를 받는 자리라 FK 가 터지기 전에 여기서 막는다."""
    if not ids:
        return
    found = (await session.execute(select(Member.id).where(Member.id.in_(ids)))).scalars().all()
    missing = sorted(ids - set(found))
    if missing:
        raise HTTPException(status_code=400, detail=f"그런 멤버가 없다: {', '.join(missing)}")


async def save_meeting(
    session: AsyncSession, project_id: str, payload: MeetingCreate
) -> MeetingSaved:
    """회의 하나를 그날 안건에 남긴 줄과 함께 저장한다.

    **검증을 다 마친 뒤에 만들기 시작한다** — 중간에 400 이 나면 세션에 아무것도 안 남는다.
    회의에서 생긴 것은 안건도 줄도 그 회의 날짜로 앉힌다(`stores/meeting.ts` 와 같다).
    """
    await project_service.load_project(session, project_id)
    created_at = at_day_start(payload.date.isoformat())

    temp_ids = _temp_ids(payload.new_threads)
    rows = (
        (
            await session.execute(
                select(Thread).where(Thread.project_id == project_id).order_by(Thread.seq)
            )
        )
        .scalars()
        .all()
    )
    known = {row.id: row for row in rows}

    parent_ids = [
        _resolve(new_thread.parent_thread_id, temp_ids, known, "그런 상위 안건이 없다")
        if new_thread.parent_thread_id
        else None
        for new_thread in payload.new_threads
    ]
    entry_thread_ids = [
        _resolve(line.thread_id, temp_ids, known, "그런 안건이 없다") for line in payload.entries
    ]
    promoted_ids = [
        _resolve(memo.promoted_temp_id, temp_ids, known, "그런 안건이 없다")
        if memo.promoted_temp_id
        else None
        for memo in payload.memos
    ]
    await _check_members(
        session,
        set(payload.attendee_ids)
        | {new_thread.owner_id for new_thread in payload.new_threads if new_thread.owner_id}
        | {line.owner_id for line in payload.entries if line.owner_id},
    )

    # 어느 기존 안건이 이 회의로 바뀌었는지 보려고 먼저 적어 둔다
    before = {row.id: (row.state, row.owner_id) for row in rows}

    created: list[Thread] = []
    for new_thread, parent_id in zip(payload.new_threads, parent_ids, strict=True):
        thread = Thread(
            id=temp_ids[new_thread.temp_id],
            project_id=project_id,
            title=new_thread.title,
            state="queued",
            owner_id=new_thread.owner_id,
            parent_thread_id=parent_id,
            created_at=created_at,
        )
        session.add(thread)
        created.append(thread)
        known[thread.id] = thread

    meeting = Meeting(
        id=new_id(),
        project_id=project_id,
        title=payload.title,
        date=payload.date,
        created_at=created_at,
        # 같은 사람을 두 번 보내도 참석자는 한 줄이다(PK 가 둘이다)
        attendees=[
            MeetingAttendee(member_id=member_id)
            for member_id in dict.fromkeys(payload.attendee_ids)
        ],
        memos=[
            MeetingMemo(
                id=new_id(), text=memo.text, promoted_thread_id=promoted_id, sort_order=order
            )
            for order, (memo, promoted_id) in enumerate(
                zip(payload.memos, promoted_ids, strict=True)
            )
        ],
    )
    session.add(meeting)

    entries = []
    for line, thread_id in zip(payload.entries, entry_thread_ids, strict=True):
        entry = thread_service.build_entry(line, thread_id, meeting.id, created_at)
        session.add(entry)
        entries.append(entry)
        thread_service.apply_entry_to_thread(known[thread_id], line.kind, line.owner_id)

    await session.commit()

    changed = [row for row in rows if before[row.id] != (row.state, row.owner_id)]
    return MeetingSaved(
        meeting=to_meeting(meeting),
        threads=[ThreadOut.model_validate(row) for row in created + changed],
        entries=[thread_service.to_entry(row) for row in entries],
        thread_id_by_temp_id=temp_ids,
    )


async def link_task(session: AsyncSession, meeting_id: str, task_id: str) -> MeetingTaskLinkOut:
    return await task_service.link_meeting(session, task_id, meeting_id)


async def unlink_task(session: AsyncSession, meeting_id: str, task_id: str) -> None:
    await task_service.unlink_meeting(session, task_id, meeting_id)

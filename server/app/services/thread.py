"""안건 쓰기 — 등록과 회의 밖 줄.

**Entry 를 붙이면 안건 상태가 따라 바뀐다.** 그 규칙은 `apply_entry_to_thread` 하나뿐이다 —
회의 저장(3-1)도 회의에서 남긴 줄마다 같은 함수를 부른다. 지금 `stores/thread.ts` 와
`stores/meeting.ts` 가 각자 들고 있는 계산을 서버에서는 한 자리로 모은다.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import Entry, EntryDetail, Thread, new_id
from app.schemas.thread import EntryAdded, EntryCreate, EntryOut, ThreadCreate, ThreadOut
from app.services import project as project_service
from app.time import KST

# 이 둘은 '정해졌다'로 친다. 그 밖의 kind 는 다뤘다는 뜻일 뿐이다
DECIDING_KINDS = ("decide", "change")


def to_entry(row: Entry) -> EntryOut:
    return EntryOut(
        id=row.id,
        thread_id=row.thread_id,
        meeting_id=row.meeting_id,
        kind=row.kind,
        text=row.text,
        # entry_detail 행을 문자열 배열로 편다
        detail=[detail.text for detail in row.details],
        note=row.note,
        owner_id=row.owner_id,
        created_at=row.created_at,
    )


async def load_thread(session: AsyncSession, thread_id: str) -> Thread:
    found = await session.execute(select(Thread).where(Thread.id == thread_id))
    thread = found.scalar_one_or_none()
    if thread is None:
        raise not_found("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다.")
    return thread


def apply_entry_to_thread(thread: Thread, kind: str, owner_id: str | None) -> None:
    """줄 하나가 안건에 남기는 흔적. 회의 저장도 줄마다 이 함수를 부른다.

    - decide · change → decided, ownerId 가 있으면 안건 담당자도 그 사람으로
    - 그 밖의 kind → queued 였으면 open, 이미 decided 면 그대로(한 번 정해진 것은
      미룸 한 줄로 되돌아가지 않는다)
    """
    if kind in DECIDING_KINDS:
        thread.state = "decided"
        if owner_id:
            thread.owner_id = owner_id
    elif thread.state == "queued":
        thread.state = "open"


async def create_thread(session: AsyncSession, project_id: str, payload: ThreadCreate) -> ThreadOut:
    await project_service.load_project(session, project_id)
    thread = Thread(
        id=new_id(),
        project_id=project_id,
        title=payload.title,
        state="queued",
        owner_id=payload.owner_id,
        parent_thread_id=None,
        created_at=datetime.now(KST),
    )
    session.add(thread)
    await session.commit()
    return ThreadOut.model_validate(thread)


def build_entry(
    payload: EntryCreate, thread_id: str, meeting_id: str | None, created_at: datetime
) -> Entry:
    """줄 하나를 만든다. 회의 안팎이 `meeting_id` 하나만 다르다 — 회의 저장도 이 함수를 부른다."""
    return Entry(
        id=new_id(),
        thread_id=thread_id,
        meeting_id=meeting_id,
        kind=payload.kind,
        text=payload.text,
        note=payload.note,
        owner_id=payload.owner_id,
        created_at=created_at,
        # detail 은 배열 순서가 뜻을 갖는다
        details=[
            EntryDetail(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.detail)
        ],
    )


async def add_outside_entry(
    session: AsyncSession, thread_id: str, payload: EntryCreate
) -> EntryAdded:
    """회의 없이 담당자 확인만으로 처리한 줄. meeting_id 는 null 로 고정한다."""
    thread = await load_thread(session, thread_id)
    entry = build_entry(payload, thread_id, None, datetime.now(KST))
    session.add(entry)
    apply_entry_to_thread(thread, payload.kind, payload.owner_id)
    await session.commit()
    return EntryAdded(entry=to_entry(entry), thread=ThreadOut.model_validate(thread))

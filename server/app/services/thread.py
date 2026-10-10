"""안건 쓰기 — 등록 · 부분 수정 · 이력 한 줄.

**Entry 를 붙이면 안건 상태가 따라 바뀐다.** 그 규칙은 `apply_entry_to_thread` 하나뿐이다.
부분 수정(PATCH)은 상태를 건드리지 않는다 — 상태는 이력으로만 바뀐다.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import Entry, EntryDetail, Thread, ThreadOption, new_id
from app.schemas.thread import (
    EntryAdded,
    EntryCreate,
    EntryOut,
    ThreadCreate,
    ThreadOut,
    ThreadPatch,
)
from app.services import project as project_service
from app.time import now

# 이 둘은 '정해졌다'로 친다. 그 밖의 kind 는 다뤘다는 뜻일 뿐이다
DECIDING_KINDS = ("decide", "change")


def to_thread(row: Thread) -> ThreadOut:
    return ThreadOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        state=row.state,
        owner_id=row.owner_id,
        parent_thread_id=row.parent_thread_id,
        created_at=row.created_at,
        description=row.description,
        # thread_option 행을 문자열 배열로 편다
        options=[option.text for option in row.options],
        due_date=row.due_date,
    )


def to_entry(row: Entry) -> EntryOut:
    return EntryOut(
        id=row.id,
        thread_id=row.thread_id,
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
    """줄 하나가 안건에 남기는 흔적.

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
        description=payload.description,
        state="queued",
        owner_id=payload.owner_id,
        due_date=payload.due_date,
        parent_thread_id=None,
        created_at=now(),
        # 후보는 배열 순서가 뜻을 갖는다
        options=[
            ThreadOption(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.options)
        ],
    )
    session.add(thread)
    await session.commit()
    return to_thread(thread)


async def patch_thread(session: AsyncSession, thread_id: str, payload: ThreadPatch) -> ThreadOut:
    thread = await load_thread(session, thread_id)
    # 보낸 것만 바꾼다. ownerId · dueDate 의 null 은 '비우기'다
    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        thread.title = payload.title
    if "owner_id" in sent:
        thread.owner_id = payload.owner_id
    if "description" in sent and payload.description is not None:
        thread.description = payload.description
    if "due_date" in sent:
        thread.due_date = payload.due_date
    if "options" in sent and payload.options is not None:
        # 통째로 갈아끼운다 — delete-orphan 이 옛 줄을 지운다
        thread.options = [
            ThreadOption(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.options)
        ]
    await session.commit()
    return to_thread(thread)


def build_entry(payload: EntryCreate, thread_id: str, created_at: datetime) -> Entry:
    return Entry(
        id=new_id(),
        thread_id=thread_id,
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


async def add_entry(session: AsyncSession, thread_id: str, payload: EntryCreate) -> EntryAdded:
    thread = await load_thread(session, thread_id)
    entry = build_entry(payload, thread_id, now())
    session.add(entry)
    apply_entry_to_thread(thread, payload.kind, payload.owner_id)
    await session.commit()
    return EntryAdded(entry=to_entry(entry), thread=to_thread(thread))

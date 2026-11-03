"""안건 쓰기 — 등록 · 부분 수정 · 삭제 · 이력 한 줄 · 이력 글 고치기 · 이력 줄 지우기.

**Entry 를 붙이면 안건 상태가 따라 바뀐다.** 그 규칙은 `apply_entry_to_thread` 하나뿐이다.
줄을 지우면 남은 줄로 다시 센다(`_recount_state`). 부분 수정(PATCH)은 상태를 건드리지 않는다.
고치기 · 지우기 권한은 `access.can_edit_thread` · `can_edit_entry` 하나로 본다.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Entry, EntryDetail, Thread, ThreadCc, ThreadOption, new_id
from app.schemas.thread import (
    EntryAdded,
    EntryCreate,
    EntryOut,
    EntryPatch,
    EntryRemoved,
    ThreadCreate,
    ThreadOut,
    ThreadPatch,
)
from app.services import access
from app.services import history as history_service
from app.services import part as part_service
from app.services import project as project_service
from app.services.access import Scope
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
        creator_id=row.creator_id,
        parent_thread_id=row.parent_thread_id,
        created_at=row.created_at,
        description=row.description,
        # thread_option 행을 문자열 배열로 편다
        options=[option.text for option in row.options],
        due_date=row.due_date,
        part_id=row.part_id,
        cc_ids=[cc.member_id for cc in row.cc],
        minutes_id=row.minutes_id,
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
        creator_id=row.creator_id,
        created_at=row.created_at,
        minutes_id=row.minutes_id,
    )


async def load_thread(session: AsyncSession, thread_id: str) -> Thread:
    """지운 안건은 없는 것과 같다 — 다시 지우기 · 고치기 · 이력 줄이 다 404 다."""
    found = await session.execute(
        select(Thread).where(Thread.id == thread_id, Thread.is_deleted.is_(False))
    )
    thread = found.scalar_one_or_none()
    if thread is None:
        raise not_found("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다.")
    return thread


async def _guard_owner(
    session: AsyncSession, project_id: str, owner_id: str | None, code: str
) -> None:
    """새로 지정하는 담당자는 그 프로젝트의 활성 멤버여야 한다 (docs/api/auth.md).

    없는 멤버를 FK 에 맡기면 500 이다 — 화면이 고칠 수 있는 400 으로 먼저 거른다.
    """
    if owner_id is not None and not await access.is_assignable(session, project_id, owner_id):
        raise ApiError(
            400, code, "담당자를 찾을 수 없습니다.", {"ownerId": "담당자를 찾을 수 없습니다."}
        )


async def _cc_rows(
    session: AsyncSession,
    project_id: str,
    cc_ids: list[str],
    *,
    keep: frozenset[str] = frozenset(),
) -> list[ThreadCc]:
    """참조 배열 → 행. 겹친 사람은 처음 자리 하나로 합친다.

    새로 넣는 사람은 그 프로젝트의 활성 멤버여야 한다 — 걸린 자리를 전부 짚는다.
    `keep` 은 이미 참조로 걸려 있던 사람이다. 담당자처럼 그대로 두는 것은 막지 않는다.
    """
    granted = await access.active_project_members(session, project_id, set(cc_ids))
    missing = {
        f"ccIds.{index}": "이 프로젝트에 부여되지 않았거나 비활성인 사람입니다."
        for index, member_id in enumerate(cc_ids)
        if member_id not in granted and member_id not in keep
    }
    if missing:
        raise ApiError(
            400, "MEMBER_NOT_IN_PROJECT", "이 프로젝트에 부여되지 않은 사람입니다.", missing
        )
    unique = list(dict.fromkeys(cc_ids))
    return [
        ThreadCc(project_id=project_id, member_id=member_id, sort_order=order)
        for order, member_id in enumerate(unique)
    ]


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


async def create_thread(
    session: AsyncSession, project_id: str, payload: ThreadCreate, actor_id: str
) -> ThreadOut:
    await project_service.load_project(session, project_id)
    await _guard_owner(session, project_id, payload.owner_id, "THREAD_OWNER_NOT_FOUND")
    await part_service.guard_part(session, project_id, payload.part_id)
    cc = await _cc_rows(session, project_id, payload.cc_ids)
    thread = Thread(
        id=new_id(),
        project_id=project_id,
        title=payload.title,
        description=payload.description,
        state="queued",
        owner_id=payload.owner_id,
        creator_id=actor_id,
        due_date=payload.due_date,
        parent_thread_id=None,
        part_id=payload.part_id,
        created_at=now(),
        # 후보는 배열 순서가 뜻을 갖는다
        options=[
            ThreadOption(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.options)
        ],
        cc=cc,
    )
    session.add(thread)
    # 이력의 복합 FK 가 안건을 보니 안건이 먼저 들어가야 한다
    await session.flush()
    history_service.record_thread(
        session, thread, history_service.created(), actor_id, thread.created_at
    )
    await session.commit()
    return to_thread(thread)


def _options_text(thread: Thread) -> str | None:
    # 이력에는 후보를 한 칸의 글로 남긴다 — 비면 null (docs/api/history.md '칸 — 안건')
    return "\n".join(option.text for option in thread.options) or None


def _history_fields(thread: Thread) -> dict[str, object]:
    """이력에 남기는 칸의 지금 값 — 계약 표의 순서대로."""
    return {
        "title": thread.title,
        "description": thread.description,
        "options": _options_text(thread),
        "ownerId": thread.owner_id,
        "partId": thread.part_id,
        "dueDate": thread.due_date,
        "ccIds": [cc.member_id for cc in thread.cc],
    }


def _guard_edit(scope: Scope, thread: Thread) -> None:
    if not access.can_edit_thread(scope, thread):
        raise access.forbidden()


async def patch_thread(
    session: AsyncSession, thread_id: str, payload: ThreadPatch, scope: Scope
) -> ThreadOut:
    thread = await load_thread(session, thread_id)
    # 고치기 전 안건으로 본다 — 담당자를 남에게 넘긴 뒤의 모양으로 보지 않는다
    _guard_edit(scope, thread)
    before = _history_fields(thread)
    # 보낸 것만 바꾼다. ownerId · dueDate 의 null 은 '비우기'다
    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        thread.title = payload.title
    if "owner_id" in sent:
        # 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다
        if payload.owner_id != thread.owner_id:
            await _guard_owner(
                session, thread.project_id, payload.owner_id, "THREAD_OWNER_NOT_FOUND"
            )
        thread.owner_id = payload.owner_id
    if "description" in sent and payload.description is not None:
        thread.description = payload.description
    if "due_date" in sent:
        thread.due_date = payload.due_date
    if "part_id" in sent:
        # 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다
        if payload.part_id != thread.part_id:
            await part_service.guard_part(session, thread.project_id, payload.part_id)
        thread.part_id = payload.part_id
    if "options" in sent and payload.options is not None:
        # 통째로 갈아끼운다 — delete-orphan 이 옛 줄을 지운다
        thread.options = [
            ThreadOption(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.options)
        ]
    if "cc_ids" in sent and payload.cc_ids is not None:
        keep = frozenset(cc.member_id for cc in thread.cc)
        rows = await _cc_rows(session, thread.project_id, payload.cc_ids, keep=keep)
        # 통째로 갈아끼운다. pk 가 (thread_id, member_id) 라 옛 줄을 먼저 지워야
        # 같은 사람을 다시 넣을 때 부딪히지 않는다
        thread.cc = []
        await session.flush()
        thread.cc = rows
    after = _history_fields(thread)
    changes = history_service.diff((field, before[field], after[field]) for field in before)
    history_service.record_thread(session, thread, changes, scope.actor.id, now())
    await session.commit()
    return to_thread(thread)


async def delete_thread(session: AsyncSession, thread_id: str, scope: Scope) -> None:
    """논리 삭제 — 세 칸을 찍고 이력에 '삭제' 줄. 이력 줄 · 후보 · 참조 · 링크 · 확인 요청은
    그대로 두고 읽는 쪽이 거른다.

    떼어낸 하위 안건이 남아 있으면 지우지 않는다 — 작업의 하위와 같은 이유다.
    """
    thread = await load_thread(session, thread_id)
    _guard_edit(scope, thread)
    child = await session.scalar(
        select(Thread.id)
        .where(Thread.parent_thread_id == thread.id, Thread.is_deleted.is_(False))
        .limit(1)
    )
    if child is not None:
        raise ApiError(
            409,
            "THREAD_HAS_CHILDREN",
            "떼어낸 하위 안건이 있어 지울 수 없습니다. 하위 안건을 먼저 지우세요.",
        )
    at = now()
    thread.is_deleted = True
    thread.deleted_at = at
    thread.deleted_by = scope.actor.id
    history_service.record_thread(session, thread, history_service.deleted(), scope.actor.id, at)
    await session.commit()


def build_entry(
    payload: EntryCreate, thread_id: str, created_at: datetime, creator_id: str | None
) -> Entry:
    return Entry(
        id=new_id(),
        thread_id=thread_id,
        kind=payload.kind,
        text=payload.text,
        note=payload.note,
        owner_id=payload.owner_id,
        # 줄을 남기는 길은 전부 여기를 지난다 — 이력 남기기 · 회의록 반영
        creator_id=creator_id,
        created_at=created_at,
        # detail 은 배열 순서가 뜻을 갖는다
        details=[
            EntryDetail(id=new_id(), text=text, sort_order=order)
            for order, text in enumerate(payload.detail)
        ],
    )


async def add_entry(
    session: AsyncSession, thread_id: str, payload: EntryCreate, actor_id: str
) -> EntryAdded:
    """프로젝트 멤버 누구나 남긴다 — 회의에서 누구든 결정을 적는다. 변경 이력에는 안 남긴다."""
    thread = await load_thread(session, thread_id)
    # 안건 담당자를 그대로 적는 줄은 새로 지정하는 것이 아니다
    if payload.owner_id != thread.owner_id:
        await _guard_owner(session, thread.project_id, payload.owner_id, "ENTRY_OWNER_NOT_FOUND")
    entry = build_entry(payload, thread_id, now(), actor_id)
    session.add(entry)
    apply_entry_to_thread(thread, payload.kind, payload.owner_id)
    await session.commit()
    return EntryAdded(entry=to_entry(entry), thread=to_thread(thread))


async def _load_entry(session: AsyncSession, thread: Thread, entry_id: str) -> Entry:
    """지운 줄 · 다른 안건의 줄은 없는 것과 같다."""
    entry = await session.scalar(
        select(Entry).where(
            Entry.id == entry_id, Entry.thread_id == thread.id, Entry.is_deleted.is_(False)
        )
    )
    if entry is None:
        raise not_found("ENTRY_NOT_FOUND", "이력을 찾을 수 없습니다.")
    return entry


async def patch_entry(
    session: AsyncSession, thread_id: str, entry_id: str, payload: EntryPatch, scope: Scope
) -> EntryOut:
    """이력 한 줄의 글만 고친다 — 안건 상태는 그대로다(kind 를 안 바꾸므로)."""
    thread = await load_thread(session, thread_id)
    entry = await _load_entry(session, thread, entry_id)
    if not access.can_edit_entry(scope, thread, entry):
        raise access.forbidden()
    before = (entry.text, entry.note)
    sent = payload.model_fields_set
    if "text" in sent and payload.text is not None:
        entry.text = payload.text
    if "note" in sent and payload.note is not None:
        entry.note = payload.note
    changes = [
        history_service.change(field, old, new, entry.kind)
        for field, old, new in (
            ("entryText", before[0], entry.text),
            # 메모는 비면 null 로 남긴다
            ("entryNote", before[1] or None, entry.note or None),
        )
        if old != new
    ]
    history_service.record_thread(session, thread, changes, scope.actor.id, now())
    await session.commit()
    return to_entry(entry)


async def _recount_state(session: AsyncSession, thread: Thread) -> None:
    """남은 줄로 상태를 다시 센다 — decide · change 가 있으면 decided, 줄이 있으면 open,
    없으면 queued. 담당자는 되돌리지 않는다(누가 맡았는지는 줄이 아니라 안건의 기록이다)."""
    kinds = set(
        (
            await session.scalars(
                select(Entry.kind).where(Entry.thread_id == thread.id, Entry.is_deleted.is_(False))
            )
        ).all()
    )
    if kinds & set(DECIDING_KINDS):
        thread.state = "decided"
    elif kinds:
        thread.state = "open"
    else:
        thread.state = "queued"


async def delete_entry(
    session: AsyncSession, thread_id: str, entry_id: str, scope: Scope
) -> EntryRemoved:
    """이력 한 줄 논리 삭제 — 안건 상태를 남은 줄로 다시 센다."""
    thread = await load_thread(session, thread_id)
    entry = await _load_entry(session, thread, entry_id)
    if not access.can_edit_entry(scope, thread, entry):
        raise access.forbidden()
    at = now()
    entry.is_deleted = True
    entry.deleted_at = at
    entry.deleted_by = scope.actor.id
    await session.flush()
    await _recount_state(session, thread)
    history_service.record_thread(
        session,
        thread,
        [history_service.change("entryDeleted", entry.text, None, entry.kind)],
        scope.actor.id,
        at,
    )
    await session.commit()
    return EntryRemoved(thread=to_thread(thread))

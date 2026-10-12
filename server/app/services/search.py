from collections.abc import Iterable, Sequence
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    Float,
    Select,
    String,
    case,
    cast,
    func,
    literal,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.errors import ApiError, not_found
from app.models import Entry, EntryDetail, Task, TaskLine, TaskThreadLink, Thread, ThreadOption
from app.schemas.search import (
    LinkedTask,
    LinkedThread,
    SearchResult,
    TaskDoc,
    TaskHit,
    TaskPlace,
    ThreadDoc,
    ThreadHit,
    ThreadPlace,
)
from app.services import project as project_service
from app.services.task import comment_count, to_task
from app.services.thread import DECIDING_KINDS, to_entry, to_thread

ThreadState = Literal["queued", "open", "decided"]
TaskStatus = Literal["todo", "doing", "blocked", "done"]

# word_similarity 가 이보다 낮으면 안 낸다. 0.5 면 한 글자 틀린 세 글자(우분트 ↔ 우분투)까지 걸리고
# 낱말이 겹치지 않는 것(MySQL ↔ PostgreSQL 0.33)은 빠진다
THRESHOLD = 0.5
# 글 안에 그대로 들어 있으면 이만큼은 준다 — 한국어는 조사가 붙어(미룸이다)
# 낱말 유사도가 0.67 에 그친다. 1 보다 낮게 둬서 낱말째 맞은 것이 앞에 선다
CONTAINS_SCORE = 0.9
SNIPPET_WIDTH = 80
QUERY_MAX = 200

# 같은 점수면 이 순서로 고른다 (API.md '검색')
_THREAD_PLACES: tuple[ThreadPlace, ...] = ("title", "description", "option", "entry")
_TASK_PLACES: tuple[TaskPlace, ...] = ("title", "body")


def clean_query(query: str) -> str:
    """빈 검색어로 '전부' 를 내지 않는다 — 목록은 스냅샷이 준다. 도구로 불려도 같은 규칙이다."""
    cleaned = query.strip()
    if not cleaned:
        raise _bad_query("검색어를 입력해 주세요.")
    if len(cleaned) > QUERY_MAX:
        raise _bad_query("너무 깁니다.")
    return cleaned


def _bad_query(reason: str) -> ApiError:
    # 경계의 422 와 같은 모양이다 — 화면이 detail 의 필드 이름으로 가른다
    return ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {"q": reason})


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _match(
    column: InstrumentedAttribute[str], query: str
) -> tuple[ColumnElement[bool], ColumnElement[float]]:
    """(거르는 조건, 점수). 둘 다 GIN trigram 인덱스를 탈 수 있는 모양(`<%` · ILIKE)으로 쓴다."""
    q = literal(query, String)
    contains = column.ilike(_like_pattern(query), escape="\\")
    condition = q.op("<%", is_comparison=True)(column) | contains
    score = func.greatest(
        cast(func.word_similarity(q, column), Float),
        case((contains, CONTAINS_SCORE), else_=0.0),
    )
    return condition, score


async def _pin_threshold(session: AsyncSession) -> None:
    # `<%` 는 서버 설정(pg_trgm.word_similarity_threshold)을 본다.
    # 이 트랜잭션에서만 우리 값으로 둔다
    await session.execute(
        select(func.set_config("pg_trgm.word_similarity_threshold", str(THRESHOLD), True))
    )


def snippet(text: str, query: str) -> str:
    """한 줄 발췌. 길면 맞은 자리 둘레를 자른다."""
    line = " ".join(text.split())
    if len(line) <= SNIPPET_WIDTH:
        return line
    at = line.lower().find(query.lower())
    start = 0 if at < 0 else max(0, min(at - SNIPPET_WIDTH // 3, len(line) - SNIPPET_WIDTH))
    end = start + SNIPPET_WIDTH
    return ("…" if start > 0 else "") + line[start:end] + ("…" if end < len(line) else "")


def _best[P: str](rows: Iterable[Any], places: tuple[P, ...]) -> dict[str, tuple[float, P, str]]:
    """한 레코드가 여러 자리에서 맞으면 하나만 남긴다 — 점수 · 자리 순서 · 그 자리 안의 순서로."""
    best: dict[str, tuple[tuple[float, int, int], P, str]] = {}
    for row in rows:
        place: P = row.place
        key = (-float(row.score), places.index(place), int(row.sub))
        held = best.get(row.owner_id)
        if held is None or key < held[0]:
            best[row.owner_id] = (key, place, row.text)
    return {owner: (-key[0], place, text) for owner, (key, place, text) in best.items()}


def _place[T: tuple[Any, ...]](
    query: Select[T],
    place: str,
    text: InstrumentedAttribute[str],
    score: ColumnElement[float],
    sub: Any,
) -> Select[Any]:
    return query.add_columns(
        literal(place, String).label("place"),
        text.label("text"),
        score.label("score"),
        cast(sub, Float).label("sub"),
    )


async def search_threads(
    session: AsyncSession,
    project_id: str,
    query: str,
    state: ThreadState | None = None,
    limit: int = 10,
) -> list[ThreadHit]:
    query = clean_query(query)
    await _pin_threshold(session)

    def scoped(owner: Select[Any]) -> Select[Any]:
        # 프로젝트로 먼저 거른다 — 도구가 다른 프로젝트 id 를 넣어도 못 읽는다
        owner = owner.where(Thread.project_id == project_id)
        return owner.where(Thread.state == state) if state is not None else owner

    title_hit, title_score = _match(Thread.title, query)
    desc_hit, desc_score = _match(Thread.description, query)
    option_hit, option_score = _match(ThreadOption.text, query)
    text_hit, text_score = _match(Entry.text, query)
    note_hit, note_score = _match(Entry.note, query)
    detail_hit, detail_score = _match(EntryDetail.text, query)

    owner = select(Thread.id.label("owner_id"))
    by_entry = owner.join(Entry, Entry.thread_id == Thread.id)
    parts = [
        _place(scoped(owner).where(title_hit), "title", Thread.title, title_score, 0),
        _place(scoped(owner).where(desc_hit), "description", Thread.description, desc_score, 0),
        _place(
            scoped(owner.join(ThreadOption, ThreadOption.thread_id == Thread.id)).where(option_hit),
            "option",
            ThreadOption.text,
            option_score,
            ThreadOption.sort_order,
        ),
        _place(scoped(by_entry).where(text_hit), "entry", Entry.text, text_score, Entry.seq),
        _place(scoped(by_entry).where(note_hit), "entry", Entry.note, note_score, Entry.seq),
        _place(
            scoped(by_entry.join(EntryDetail, EntryDetail.entry_id == Entry.id)).where(detail_hit),
            "entry",
            EntryDetail.text,
            detail_score,
            Entry.seq,
        ),
    ]
    found = _best((await session.execute(union_all(*parts))).all(), _THREAD_PLACES)
    if not found:
        return []

    threads = (await session.execute(select(Thread).where(Thread.id.in_(found)))).scalars().all()
    ranked = sorted(threads, key=lambda row: (-found[row.id][0], row.seq))[:limit]
    decisions = await _decisions(session, [row.id for row in ranked])
    return [
        ThreadHit(
            id=row.id,
            title=row.title,
            state=row.state,
            matched=found[row.id][1],
            snippet=snippet(found[row.id][2], query),
            decision=decisions.get(row.id, ""),
        )
        for row in ranked
    ]


async def _decisions(session: AsyncSession, thread_ids: Sequence[str]) -> dict[str, str]:
    """안건마다 마지막 decide · change 줄의 text — 결정이 바뀐 안건은 이것이 지금의 결정이다."""
    rows = await session.execute(
        select(Entry.thread_id, Entry.text)
        .where(Entry.thread_id.in_(thread_ids), Entry.kind.in_(DECIDING_KINDS))
        .order_by(Entry.seq)
    )
    # seq 오름차순으로 덮어쓰면 마지막 줄이 남는다
    return {thread_id: text for thread_id, text in rows.all()}


async def search_tasks(
    session: AsyncSession,
    project_id: str,
    query: str,
    status: TaskStatus | None = None,
    limit: int = 10,
) -> list[TaskHit]:
    query = clean_query(query)
    await _pin_threshold(session)

    def scoped(owner: Select[Any]) -> Select[Any]:
        owner = owner.where(Task.project_id == project_id)
        return owner.where(Task.status == status) if status is not None else owner

    title_hit, title_score = _match(Task.title, query)
    line_hit, line_score = _match(TaskLine.text, query)

    owner = select(Task.id.label("owner_id"))
    parts = [
        _place(scoped(owner).where(title_hit), "title", Task.title, title_score, 0),
        _place(
            scoped(owner.join(TaskLine, TaskLine.task_id == Task.id)).where(line_hit),
            "body",
            TaskLine.text,
            line_score,
            TaskLine.sort_order,
        ),
    ]
    found = _best((await session.execute(union_all(*parts))).all(), _TASK_PLACES)
    if not found:
        return []

    tasks = (await session.execute(select(Task).where(Task.id.in_(found)))).scalars().all()
    ranked = sorted(tasks, key=lambda row: (-found[row.id][0], row.seq))[:limit]
    return [
        TaskHit(
            id=row.id,
            key=row.key,
            title=row.title,
            status=row.status,
            matched=found[row.id][1],
            snippet=snippet(found[row.id][2], query),
        )
        for row in ranked
    ]


async def search(session: AsyncSession, project_id: str, query: str, limit: int) -> SearchResult:
    # 없는 프로젝트는 404 다 — 빈 결과와 구분한다
    await project_service.load_project(session, project_id)
    query = clean_query(query)
    return SearchResult(
        threads=await search_threads(session, project_id, query, limit=limit),
        tasks=await search_tasks(session, project_id, query, limit=limit),
    )


async def get_thread(session: AsyncSession, project_id: str, thread_id: str) -> ThreadDoc:
    found = await session.execute(
        select(Thread).where(Thread.id == thread_id, Thread.project_id == project_id)
    )
    thread = found.scalar_one_or_none()
    if thread is None:
        raise not_found("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다.")

    entries = await session.execute(
        select(Entry).where(Entry.thread_id == thread.id).order_by(Entry.seq)
    )
    tasks = await session.execute(
        select(Task.id, Task.key, Task.title, Task.status)
        .join(TaskThreadLink, TaskThreadLink.task_id == Task.id)
        .where(TaskThreadLink.thread_id == thread.id, TaskThreadLink.project_id == project_id)
        .order_by(Task.seq)
    )
    return ThreadDoc(
        thread=to_thread(thread),
        entries=[to_entry(row) for row in entries.scalars().all()],
        tasks=[
            LinkedTask(id=id_, key=key, title=title, status=status)
            for id_, key, title, status in tasks.all()
        ],
    )


async def get_task(session: AsyncSession, project_id: str, task_id: str) -> TaskDoc:
    found = await session.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = found.scalar_one_or_none()
    if task is None:
        raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")

    threads = await session.execute(
        select(Thread.id, Thread.title, Thread.state)
        .join(TaskThreadLink, TaskThreadLink.thread_id == Thread.id)
        .where(TaskThreadLink.task_id == task.id, TaskThreadLink.project_id == project_id)
        .order_by(Thread.seq)
    )
    return TaskDoc(
        task=to_task(task, await comment_count(session, task.id)),
        threads=[
            LinkedThread(id=id_, title=title, state=state) for id_, title, state in threads.all()
        ],
    )

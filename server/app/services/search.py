import re
from collections.abc import Iterable, Sequence
from datetime import date
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
    or_,
    select,
    true,
    union_all,
)
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, aliased

from app.errors import ApiError, not_found
from app.models import Agenda, Member, Task, TaskAgendaLink, TaskLine, TestCase, TestComment
from app.schemas.search import (
    AgendaDoc,
    AgendaHit,
    AgendaPlace,
    LinkedAgenda,
    LinkedTask,
    LinkedTest,
    SearchResult,
    SimilarPair,
    TaskBrief,
    TaskDoc,
    TaskHit,
    TaskList,
    TaskPlace,
    TestDoc,
    TestNote,
    TestTag,
)
from app.schemas.test import TestRefOut, TestSignal
from app.services import project as project_service
from app.services import test as test_service
from app.services.agenda import to_agenda
from app.services.task import comment_count, status_since, to_task

AgendaState = Literal["queued", "open", "decided"]
TaskStatus = Literal["todo", "doing", "blocked", "done"]

# word_similarity 가 이보다 낮으면 안 낸다. 0.5 면 한 글자 틀린 세 글자(우분트 ↔ 우분투)까지 걸리고
# 낱말이 겹치지 않는 것(MySQL ↔ PostgreSQL 0.33)은 빠진다
THRESHOLD = 0.5
# 글 안에 그대로 들어 있으면 이만큼은 준다 — 한국어는 조사가 붙어(정의가)
# 낱말 유사도가 0.67 에 그친다. 1 보다 낮게 둬서 낱말째 맞은 것이 앞에 선다
CONTAINS_SCORE = 0.9
SNIPPET_WIDTH = 80
QUERY_MAX = 200

# 챗봇의 작업 전체 목록 상한. 넘으면 번호 순으로 앞에서 자르고 truncated 로 알린다
TASK_LIST_MAX = 300
# 비슷한 작업 쌍 — 이보다 낮으면 안 낸다. 0.3 이면 '설계' ↔ '데이터 설계'(0.43),
# '초기 스키마 DDL 작성' ↔ '초기 스키마 반영 및 검증'(0.32)까지 걸린다
SIMILAR_THRESHOLD = 0.3

# 챗봇 get_test 가 싣는 조치 내역 — 최근 것만
TEST_COMMENTS_MAX = 20
# 테스트 키(HW-T3) — 작업 키(HW-3)와 '-T' 로 갈린다
TEST_KEY = re.compile(r"^[A-Z][A-Z0-9]{0,7}-T\d+$")

# 같은 점수면 이 순서로 고른다 (API.md '검색')
_AGENDA_PLACES: tuple[AgendaPlace, ...] = ("title", "description", "decision")
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


async def search_agendas(
    session: AsyncSession,
    project_id: str,
    query: str,
    state: AgendaState | None = None,
    limit: int = 10,
) -> list[AgendaHit]:
    query = clean_query(query)
    await _pin_threshold(session)

    def scoped(owner: Select[Any]) -> Select[Any]:
        # 프로젝트로 먼저 거른다 — 도구가 다른 프로젝트 id 를 넣어도 못 읽는다
        owner = owner.where(Agenda.project_id == project_id, Agenda.is_deleted.is_(False))
        return owner.where(Agenda.state == state) if state is not None else owner

    title_hit, title_score = _match(Agenda.title, query)
    desc_hit, desc_score = _match(Agenda.description, query)
    decision_hit, decision_score = _match(Agenda.decision, query)

    owner = select(Agenda.id.label("owner_id"))
    parts = [
        _place(scoped(owner).where(title_hit), "title", Agenda.title, title_score, 0),
        _place(scoped(owner).where(desc_hit), "description", Agenda.description, desc_score, 0),
        _place(scoped(owner).where(decision_hit), "decision", Agenda.decision, decision_score, 0),
    ]
    found = _best((await session.execute(union_all(*parts))).all(), _AGENDA_PLACES)
    if not found:
        return []

    agendas = (await session.execute(select(Agenda).where(Agenda.id.in_(found)))).scalars().all()
    ranked = sorted(agendas, key=lambda row: (-found[row.id][0], row.seq))[:limit]
    return [
        AgendaHit(
            id=row.id,
            title=row.title,
            state=row.state,
            matched=found[row.id][1],
            snippet=snippet(found[row.id][2], query),
            decision=row.decision,
        )
        for row in ranked
    ]


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
        owner = owner.where(Task.project_id == project_id, Task.is_deleted.is_(False))
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
        agendas=await search_agendas(session, project_id, query, limit=limit),
        tasks=await search_tasks(session, project_id, query, limit=limit),
    )


async def get_agenda(session: AsyncSession, project_id: str, agenda_id: str) -> AgendaDoc:
    found = await session.execute(
        select(Agenda).where(
            Agenda.id == agenda_id,
            Agenda.project_id == project_id,
            Agenda.is_deleted.is_(False),
        )
    )
    agenda = found.scalar_one_or_none()
    if agenda is None:
        raise not_found("AGENDA_NOT_FOUND", "안건을 찾을 수 없습니다.")

    tasks = await session.execute(
        select(Task.id, Task.key, Task.title, Task.status)
        .join(TaskAgendaLink, TaskAgendaLink.task_id == Task.id)
        .where(
            TaskAgendaLink.agenda_id == agenda.id,
            TaskAgendaLink.project_id == project_id,
            Task.is_deleted.is_(False),
        )
        .order_by(Task.seq)
    )
    out = to_agenda(agenda)
    names = await session.execute(select(Member.id, Member.name).where(Member.id.in_(out.cc_ids)))
    name_of = dict(names.tuples().all())
    return AgendaDoc(
        agenda=out,
        cc_names=[name_of[member_id] for member_id in out.cc_ids if member_id in name_of],
        tasks=[
            LinkedTask(id=id_, key=key, title=title, status=status)
            for id_, key, title, status in tasks.all()
        ],
    )


async def tasks_by_key(
    session: AsyncSession, project_id: str, keys: Iterable[str]
) -> dict[str, Task]:
    """작업 키(HW-4) → 작업. 키는 대문자로 맞춰 찾는다 — 없는 키는 빠진다."""
    wanted = {key.upper() for key in keys}
    if not wanted:
        return {}
    found = await session.scalars(
        select(Task).where(
            Task.project_id == project_id, Task.key.in_(wanted), Task.is_deleted.is_(False)
        )
    )
    return {task.key: task for task in found.all()}


async def get_task(session: AsyncSession, project_id: str, task_id: str) -> TaskDoc:
    """task_id 에 작업 키(HW-4)를 넣어도 찾는다 — 사용자가 키로 가리키면 Claude 가 그대로 넘긴다."""
    found = await session.execute(
        select(Task).where(
            Task.project_id == project_id,
            or_(Task.id == task_id, Task.key == task_id.strip().upper()),
            Task.is_deleted.is_(False),
        )
    )
    task = found.scalar_one_or_none()
    if task is None:
        raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")

    agendas = await session.execute(
        select(Agenda.id, Agenda.title, Agenda.state)
        .join(TaskAgendaLink, TaskAgendaLink.agenda_id == Agenda.id)
        .where(
            TaskAgendaLink.task_id == task.id,
            TaskAgendaLink.project_id == project_id,
            Agenda.is_deleted.is_(False),
        )
        .order_by(Agenda.seq)
    )
    children = await session.execute(
        select(Task.id, Task.key, Task.title, Task.status)
        .where(
            Task.parent_id == task.id,
            Task.project_id == project_id,
            Task.is_deleted.is_(False),
        )
        .order_by(Task.seq)
    )
    return TaskDoc(
        task=to_task(
            task, await comment_count(session, task.id), await status_since(session, task)
        ),
        children=[
            LinkedTask(id=id_, key=key, title=title, status=status)
            for id_, key, title, status in children.all()
        ],
        agendas=[
            LinkedAgenda(id=id_, title=title, state=state) for id_, title, state in agendas.all()
        ],
    )


def is_test_key(key: str) -> bool:
    return TEST_KEY.match(key.strip().upper()) is not None


async def tests_by_key(
    session: AsyncSession, project_id: str, keys: Iterable[str]
) -> dict[str, tuple[TestCase, str]]:
    """테스트 키(HW-T3) → (테스트, 화면이 보이는 상태). 묶음은 하위에서 모은 상태다.
    없는 키 · 다른 프로젝트의 키는 빠진다."""
    wanted = {key.upper() for key in keys}
    if not wanted:
        return {}
    found = (
        await session.scalars(
            select(TestCase).where(TestCase.project_id == project_id, TestCase.key.in_(wanted))
        )
    ).all()
    if not found:
        return {}
    rolled = await _rolled_status(session, project_id)
    return {test.key: (test, rolled.get(test.id, (test.status, []))[0]) for test in found}


async def _rolled_status(
    session: AsyncSession, project_id: str
) -> dict[str, tuple[str, list[TestSignal]]]:
    """신호 없이 상태만 모은다 — 언급 한 줄에는 상태만 싣는다."""
    rows = await session.execute(
        select(TestCase.id, TestCase.parent_id, TestCase.status).where(
            TestCase.project_id == project_id
        )
    )
    return test_service.roll_up(
        {
            test_id: test_service.RollNode(parent_id, status, [])
            for test_id, parent_id, status in rows.tuples()
        }
    )


async def get_test(session: AsyncSession, project_id: str, test_id: str, *, today: date) -> TestDoc:
    """test_id 에 테스트 키(HW-T3)를 넣어도 찾는다. 다른 프로젝트의 것은 없는 것과 같다."""
    found = await session.scalar(
        select(TestCase.id).where(
            TestCase.project_id == project_id,
            or_(TestCase.id == test_id, TestCase.key == test_id.strip().upper()),
        )
    )
    if found is None:
        raise not_found("TEST_NOT_FOUND", "테스트를 찾을 수 없습니다.")

    # 묶음의 상태 · 신호는 하위 전부에서 모으니 프로젝트의 테스트를 한 번에 센다
    tests = await test_service.list_tests(session, project_id, today=today)
    by_id = {test.id: test for test in tests}
    test = by_id[found]
    rolled = test_service.roll_up(
        {t.id: test_service.RollNode(t.parent_id, t.status, list(t.signals)) for t in tests}
    )
    children = [t for t in tests if t.parent_id == test.id]
    status, signals = rolled[test.id]

    member_ids = {test.owner_id, *test.cc_ids} - {None}
    comments = (
        await session.execute(
            select(TestComment.author_id, TestComment.body, TestComment.created_at)
            .where(TestComment.test_id == test.id)
            .order_by(TestComment.seq.desc())
            .limit(TEST_COMMENTS_MAX)
        )
    ).all()
    member_ids |= {author for author, _, _ in comments if author is not None}
    names = await session.execute(select(Member.id, Member.name).where(Member.id.in_(member_ids)))
    name_of = dict(names.tuples().all())

    return TestDoc(
        id=test.id,
        key=test.key,
        title=test.title,
        content=test.content,
        test_data=test.test_data,
        status=status,
        status_days=None if children else test.status_days,
        signals=signals,
        parent_key=by_id[test.parent_id].key if test.parent_id in by_id else None,
        owner=name_of.get(test.owner_id) if test.owner_id else None,
        cc_names=[name_of[member_id] for member_id in test.cc_ids if member_id in name_of],
        start=test.start,
        due=test.due,
        tags=await _test_tags(session, project_id, test.refs),
        children=[
            LinkedTest(id=t.id, key=t.key, title=t.title, status=rolled[t.id][0]) for t in children
        ],
        result_note=test.result_note.strip() or None,
        comments=[
            TestNote(author=name_of.get(author) if author else None, created_at=at, body=body)
            for author, body, at in reversed(comments)
        ],
    )


async def _test_tags(
    session: AsyncSession, project_id: str, refs: Sequence[TestRefOut]
) -> list[TestTag]:
    """태그 순서는 TestCaseOut.refs 그대로(작업 먼저, 그 안은 등록 순)."""
    task_ids = [ref.id for ref in refs if ref.kind == "task"]
    agenda_ids = [ref.id for ref in refs if ref.kind == "agenda"]
    tasks = await session.execute(
        select(Task.id, Task.key, Task.title).where(
            Task.id.in_(task_ids), Task.project_id == project_id, Task.is_deleted.is_(False)
        )
    )
    task_of = {id_: (key, title) for id_, key, title in tasks.tuples()}
    agendas = await session.execute(
        select(Agenda.id, Agenda.title).where(
            Agenda.id.in_(agenda_ids),
            Agenda.project_id == project_id,
            Agenda.is_deleted.is_(False),
        )
    )
    agenda_of = dict(agendas.tuples().all())
    tags: list[TestTag] = []
    for ref in refs:
        if ref.kind == "task" and ref.id in task_of:
            key, title = task_of[ref.id]
            tags.append(TestTag(kind="task", id=ref.id, key=key, title=title))
        elif ref.kind == "agenda" and ref.id in agenda_of:
            tags.append(TestTag(kind="agenda", id=ref.id, key=None, title=agenda_of[ref.id]))
    return tags


def _brief(task: Task, key_of: dict[str, str], name_of: dict[str, str]) -> TaskBrief:
    return TaskBrief(
        id=task.id,
        key=task.key,
        title=task.title,
        status=task.status,
        parent_key=key_of.get(task.parent_id) if task.parent_id else None,
        owner=name_of.get(task.owner_id) if task.owner_id else None,
    )


async def _owner_names(session: AsyncSession, tasks: Sequence[Task]) -> dict[str, str]:
    owners = {t.owner_id for t in tasks if t.owner_id is not None}
    if not owners:
        return {}
    rows = await session.execute(select(Member.id, Member.name).where(Member.id.in_(owners)))
    return {id_: name for id_, name in rows.tuples().all()}


async def list_tasks(
    session: AsyncSession, project_id: str, status: TaskStatus | None = None
) -> TaskList:
    """프로젝트 작업 전체 — 번호 순. 본문은 싣지 않는다(필요하면 get_task)."""
    tasks = (
        (
            await session.execute(
                select(Task)
                .where(Task.project_id == project_id, Task.is_deleted.is_(False))
                .order_by(Task.seq)
            )
        )
        .scalars()
        .all()
    )
    # 상위 키는 거르기 전 전체에서 찾는다 — 상위가 다른 상태여도 이름이 보이게
    key_of = {t.id: t.key for t in tasks}
    picked = [t for t in tasks if status is None or t.status == status][: TASK_LIST_MAX + 1]
    name_of = await _owner_names(session, picked)
    total = sum(1 for t in tasks if status is None or t.status == status)
    return TaskList(
        total=total,
        truncated=total > TASK_LIST_MAX,
        tasks=[_brief(t, key_of, name_of) for t in picked[:TASK_LIST_MAX]],
    )


async def similar_tasks(
    session: AsyncSession, project_id: str, task_id: str | None = None, limit: int = 20
) -> list[SimilarPair]:
    """제목끼리 · (제목 + 본문)끼리 trigram 유사도가 높은 작업 쌍. Postgres(pg_trgm) 전용.

    task_id(id 또는 키)를 주면 그 작업이 낀 쌍만. 모든 쌍을 견주므로 작업 수의 제곱으로 는다 —
    수백 개까지를 생각한 것이다.
    """
    target: str | None = None
    if task_id is not None:
        target = (await get_task(session, project_id, task_id)).task.id

    body = (
        select(
            TaskLine.task_id.label("task_id"),
            func.string_agg(
                TaskLine.text, aggregate_order_by(literal(" "), TaskLine.sort_order)
            ).label("body"),
        )
        .group_by(TaskLine.task_id)
        .subquery()
    )
    docs = (
        select(
            Task.id.label("id"),
            Task.title.label("title"),
            (Task.title + " " + func.coalesce(body.c.body, "")).label("doc"),
        )
        .outerjoin(body, body.c.task_id == Task.id)
        .where(Task.project_id == project_id, Task.is_deleted.is_(False))
        .cte("docs")
    )
    a, b = aliased(docs), aliased(docs)
    title_score = cast(func.similarity(a.c.title, b.c.title), Float)
    doc_score = cast(func.similarity(a.c.doc, b.c.doc), Float)
    best = func.greatest(title_score, doc_score)
    rows = (
        await session.execute(
            select(a.c.id, b.c.id, title_score, doc_score)
            .where(
                a.c.id < b.c.id,
                best >= SIMILAR_THRESHOLD,
                or_(a.c.id == target, b.c.id == target) if target is not None else true(),
            )
            .order_by(best.desc(), a.c.id, b.c.id)
            .limit(limit)
        )
    ).all()
    if not rows:
        return []

    tasks = (
        (
            await session.execute(
                select(Task).where(Task.project_id == project_id, Task.is_deleted.is_(False))
            )
        )
        .scalars()
        .all()
    )
    by_id = {t.id: t for t in tasks}
    key_of = {t.id: t.key for t in tasks}
    name_of = await _owner_names(session, [by_id[i] for row in rows for i in row[:2]])
    pairs: list[SimilarPair] = []
    for a_id, b_id, t_score, d_score in rows:
        x, y = by_id[a_id], by_id[b_id]
        relation: Literal["parent_child", "siblings"] | None = None
        if x.parent_id == y.id or y.parent_id == x.id:
            relation = "parent_child"
        elif x.parent_id is not None and x.parent_id == y.parent_id:
            relation = "siblings"
        pairs.append(
            SimilarPair(
                a=_brief(x, key_of, name_of),
                b=_brief(y, key_of, name_of),
                score=round(max(t_score, d_score), 2),
                matched="title" if t_score >= d_score else "body",
                relation=relation,
            )
        )
    return pairs

"""프로젝트 진행 계산 — `services/progress.py` (`docs/api/report.md` 'ProgressFacts').

시드 p3(경영지원 파트)은 작업이 없다 — 신호마다 작업을 손으로 세워 본다. 시드 p1 은 계약의 예
(HW-20 오래 걸림 · HW-22 풀어도 됨)를 본다. '오늘' 은 2026-10-20(화) 로 고정한다.
"""

from datetime import date
from itertools import count

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Entry,
    ProjectReport,
    RiskSetting,
    Task,
    TaskLine,
    TaskLog,
    TaskThreadLink,
    Thread,
)
from app.schemas.report import ProgressFacts, TaskAttention
from app.services import progress
from app.time import at
from scripts.seed import seed

TODAY = date(2026, 10, 20)
P = "p3"
_numbers = count(1)


@pytest.fixture
async def db(session: AsyncSession) -> AsyncSession:
    await seed(session)
    return session


def add_task(
    session: AsyncSession,
    id_: str,
    status: str = "todo",
    *,
    start: str | None = None,
    due: str | None = None,
    parent: str | None = None,
    owner: str | None = None,
    created: str = "2026-10-01T00:00:00Z",
    since: str | None = None,
    backfilled: bool = False,
    priority: str = "normal",
    checks: tuple[bool, ...] = (),
) -> None:
    """작업 하나와 '지금 상태가 된' 기록 한 줄. since 가 없으면 등록 시각이다."""
    session.add(
        Task(
            id=id_,
            project_id=P,
            key=f"MG-{next(_numbers)}",
            title=f"작업 {id_}",
            parent_id=parent,
            status=status,
            owner_id=owner,
            start=date.fromisoformat(start) if start else None,
            due=date.fromisoformat(due) if due else None,
            priority=priority,
            created_at=at(created),
            lines=[
                TaskLine(
                    task_id=id_, kind="check", text=f"줄 {i}", done=done, level=0, sort_order=i
                )
                for i, done in enumerate(checks)
            ]
            + [
                TaskLine(
                    task_id=id_, kind="bullet", text="메모", done=False, level=0, sort_order=99
                )
            ],
        )
    )
    session.add(
        TaskLog(
            project_id=P,
            task_id=id_,
            from_status=None,
            to_status=status,
            changed_by=None,
            changed_at=at(since or created),
            backfilled=backfilled,
        )
    )


async def facts(session: AsyncSession, project_id: str = P) -> ProgressFacts:
    await session.flush()
    return await progress.progress_facts(session, project_id, today=TODAY)


def attention(found: ProgressFacts) -> dict[str, TaskAttention]:
    return {a.task_id: a for a in found.attention}


def signals(found: ProgressFacts, task_id: str) -> list[str]:
    hit = attention(found).get(task_id)
    return list(hit.signals) if hit else []


# --- 신호 -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("since", "hit"),
    [("2026-10-13T00:00:00Z", True), ("2026-10-14T00:00:00Z", False)],
    ids=["7일-계획4일", "6일-계획4일"],
)
async def test_long_running_with_plan(db: AsyncSession, since: str, hit: bool) -> None:
    """계획(start ~ due 4일)의 1.5배(6일)를 넘어야 — 6일은 아니다."""
    add_task(db, "a", "doing", start="2026-10-20", due="2026-10-23", since=since)
    found = await facts(db)
    assert ("longRunning" in signals(found, "a")) is hit
    if hit:
        assert attention(found)["a"].planned_days == 4
        assert attention(found)["a"].status_days == 7


@pytest.mark.parametrize(
    ("since", "hit"),
    [("2026-10-12T00:00:00Z", True), ("2026-10-13T00:00:00Z", False)],
    ids=["8일", "7일"],
)
async def test_long_running_without_plan(db: AsyncSession, since: str, hit: bool) -> None:
    """계획이 없으면 staleDays(7)를 넘어야."""
    add_task(db, "a", "doing", start="2026-10-01", since=since)
    found = await facts(db)
    assert ("longRunning" in signals(found, "a")) is hit
    if hit:
        assert attention(found)["a"].planned_days is None


async def test_long_running_follows_project_stale_days(db: AsyncSession) -> None:
    """문턱값은 리스크 기준 그대로다 — 프로젝트가 바꾸면 따라간다."""
    db.add(
        RiskSetting(
            project_id=P,
            due_soon_days=3,
            defer_count=2,
            stale_days=3,
            high_score=6,
            medium_score=3,
        )
    )
    add_task(db, "a", "doing", since="2026-10-16T00:00:00Z")
    found = await facts(db)
    assert found.settings.stale_days == 3
    assert signals(found, "a") == ["longRunning"]


@pytest.mark.parametrize(
    ("since", "hit"),
    [("2026-10-12T15:00:00Z", False), ("2026-10-12T14:59:00Z", True)],
    ids=["KST-13일-7일째", "KST-12일-8일째"],
)
async def test_long_blocked_counts_kst_days(db: AsyncSession, since: str, hit: bool) -> None:
    """날 수는 KST 날짜끼리 — 10-12 15:00Z 는 한국의 10-13 이다."""
    add_task(db, "a", "blocked", since=since)
    found = await facts(db)
    assert signals(found, "a") == (["longBlocked"] if hit else [])


async def test_overdue_and_not_started_together(db: AsyncSession) -> None:
    add_task(db, "both", start="2026-10-10", due="2026-10-19")
    add_task(
        db, "due_today", "doing", start="2026-10-20", due="2026-10-20", since="2026-10-20T00:00:00Z"
    )
    add_task(
        db,
        "doing_late",
        "doing",
        start="2026-10-10",
        due="2026-10-19",
        since="2026-10-15T00:00:00Z",
    )
    found = await facts(db)
    assert signals(found, "both") == ["overdue", "notStarted"]
    assert "due_today" not in attention(found)
    assert signals(found, "doing_late") == ["overdue"]


@pytest.mark.parametrize(
    ("start", "due", "hit"),
    [
        ("2026-10-19", None, True),
        ("2026-10-20", None, False),
        (None, "2026-10-23", True),
        (None, "2026-10-24", False),
    ],
    ids=["시작일-지남", "시작일-오늘", "기한-3일-안", "기한-4일-뒤"],
)
async def test_not_started(db: AsyncSession, start: str | None, due: str | None, hit: bool) -> None:
    add_task(db, "a", start=start, due=due)
    found = await facts(db)
    assert signals(found, "a") == (["notStarted"] if hit else [])


async def test_decided_but_blocked(db: AsyncSession) -> None:
    """막힘인데 걸린 안건이 전부 결정됨 — risk.md 의 계산을 그대로 쓴다."""
    db.add(
        Thread(
            id="h1",
            project_id=P,
            title="정해진 안건",
            state="decided",
            owner_id=None,
            created_at=at("2026-10-01T00:00:00Z"),
        )
    )
    add_task(db, "a", "blocked", since="2026-10-19T00:00:00Z")
    await db.flush()
    db.add(TaskThreadLink(task_id="a", thread_id="h1", project_id=P))
    found = await facts(db)
    assert signals(found, "a") == ["decidedButBlocked"]
    assert attention(found)["a"].weight.thread_count == 1
    assert attention(found)["a"].score == 3


async def test_backfill_is_at_least(db: AsyncSession) -> None:
    """backfill 줄은 '적어도 이때부터' — 날 수는 세되 표시를 단다. 기간 안의 바뀜으로는 안 센다."""
    add_task(db, "a", "blocked", since="2026-10-01T00:00:00Z", backfilled=True)
    add_task(db, "b", "done", since="2026-10-18T00:00:00Z", backfilled=True)
    add_task(db, "c", "doing", since="2026-10-18T00:00:00Z", backfilled=True)
    found = await facts(db)
    a = attention(found)["a"]
    assert (a.status_days, a.status_since_backfill) == (19, True)
    assert found.progress.completed_task_ids == []
    assert found.progress.started_task_ids == []


async def test_done_tasks_get_no_signals(db: AsyncSession) -> None:
    add_task(db, "a", "done", start="2026-09-01", due="2026-09-02", since="2026-09-01T00:00:00Z")
    found = await facts(db)
    assert found.attention == []


# --- 점수 · 정렬 -------------------------------------------------------------------------


async def test_score_and_order(db: AsyncSession) -> None:
    """점수 내림차순 → 기한 이른 순(없으면 뒤) → 등록 순."""
    add_task(db, "late_nodue", "blocked", since="2026-10-01T00:00:00Z")  # 2
    add_task(db, "due_later", start="2026-10-01", due="2026-10-24")  # notStarted 1
    add_task(db, "due_sooner", start="2026-10-01", due="2026-10-22")
    add_task(db, "same_a", "doing", due="2026-10-19", since="2026-10-19T00:00:00Z")  # overdue 2
    add_task(db, "same_b", "doing", due="2026-10-19", since="2026-10-19T00:00:00Z")  # overdue 2
    found = await facts(db)
    order = [a.task_id for a in found.attention]
    assert order == ["same_a", "same_b", "late_nodue", "due_sooner", "due_later"]
    assert [a.score for a in found.attention] == [2, 2, 2, 1, 1]


async def test_attention_keeps_thirty(db: AsyncSession) -> None:
    for n in range(35):
        add_task(db, f"a{n:02}", "doing", due="2026-10-19", since="2026-10-19T00:00:00Z")
    found = await facts(db)
    assert len(found.attention) == 30
    assert found.attention[-1].task_id == "a29"


async def test_weight(db: AsyncSession) -> None:
    add_task(db, "top", "doing", due="2026-10-19", priority="high", checks=(True, False, False))
    add_task(db, "child", parent="top")
    add_task(db, "grandchild", parent="child")
    add_task(db, "done_child", "done", parent="top")
    found = await facts(db)
    w = attention(found)["top"].weight
    assert (w.open_children, w.open_lines, w.total_lines, w.priority) == (2, 2, 3, "high")
    assert w.thread_count == 0


# --- 진척 · 결정 · 사람 · 앞 리포트 -------------------------------------------------------


async def test_progress_counts_and_period(db: AsyncSession) -> None:
    """기간은 오늘(KST)을 끝으로 7일 — 10-14 ~ 10-20. 기록의 날짜도 KST 다."""
    add_task(db, "in", "done", since="2026-10-13T15:00:00Z")  # KST 10-14 00:00
    add_task(db, "out", "done", since="2026-10-13T14:59:00Z")  # KST 10-13 23:59
    add_task(db, "started", "doing", created="2026-10-02T00:00:00Z", since="2026-10-20T01:00:00Z")
    add_task(db, "new", created="2026-10-15T00:00:00Z")
    for n in range(4):
        add_task(db, f"t{n}", start="2026-11-01")
    found = await facts(db)

    assert (found.period_start, found.period_end) == (date(2026, 10, 14), TODAY)
    p = found.progress
    assert (p.todo, p.doing, p.blocked, p.done) == (5, 1, 0, 2)
    # 2 / 8 = 0.25
    assert p.done_rate == 0.25
    assert p.completed_task_ids == ["in"]
    assert p.started_task_ids == ["started"]
    assert p.created_task_ids == ["new"]


def test_done_rate_rounds_half_up() -> None:
    assert progress.done_rate(1, 8) == 0.13
    assert progress.done_rate(1, 3) == 0.33
    assert progress.done_rate(2, 3) == 0.67
    assert progress.done_rate(0, 0) == 0


async def test_decisions_in_period(db: AsyncSession) -> None:
    for id_, state in (("h1", "decided"), ("h2", "open"), ("h3", "decided")):
        db.add(
            Thread(
                id=id_,
                project_id=P,
                title=id_,
                state=state,
                owner_id=None,
                created_at=at("2026-09-01T00:00:00Z"),
            )
        )
    await db.flush()
    rows = [
        ("h1", "decide", "2026-10-15T00:00:00Z"),
        ("h2", "defer", "2026-10-16T00:00:00Z"),
        ("h3", "decide", "2026-10-01T00:00:00Z"),
        ("h3", "change", "2026-10-19T00:00:00Z"),
        ("h1", "defer", "2026-10-02T00:00:00Z"),
    ]
    for thread_id, kind, when in rows:
        db.add(Entry(thread_id=thread_id, kind=kind, text="", note="", created_at=at(when)))
    add_task(db, "a", start="2026-11-01")
    found = await facts(db)
    assert found.decisions.decided_thread_ids == ["h1", "h3"]
    assert found.decisions.deferred_thread_ids == ["h2"]


async def test_people(db: AsyncSession) -> None:
    add_task(db, "a", "doing", owner="u2", due="2026-10-19")
    add_task(db, "b", "blocked", owner="u2", since="2026-10-19T00:00:00Z")
    add_task(db, "c", "done", owner="u3", since="2026-10-18T00:00:00Z")
    add_task(db, "d", start="2026-11-01")
    found = await facts(db)
    people = {p.member_id: p for p in found.people}
    # 손쓸 작업 수 → 멤버 id → 담당자 없음은 뒤
    assert list(people) == ["u2", "u3", None]
    u2 = people["u2"]
    assert (u2.doing, u2.blocked, u2.overdue, u2.completed) == (1, 1, 1, 0)
    assert u2.attention_task_ids == ["a"]
    assert people["u3"].completed == 1
    assert people[None].attention_task_ids == []


async def test_previous_is_the_latest_report(db: AsyncSession) -> None:
    for n, rate in enumerate((0.1, 0.25)):
        db.add(
            ProjectReport(
                id=f"r{n}",
                project_id=P,
                period_start=date(2026, 10, 7 + n),
                period_end=date(2026, 10, 13 + n),
                facts={"progress": {"doneRate": rate, "blocked": n + 2}},
                body="",
                created_by="u1",
                created_at=at("2026-10-14T00:00:00Z"),
            )
        )
    # 다른 프로젝트의 리포트는 안 본다
    db.add(
        ProjectReport(
            id="other",
            project_id="p1",
            period_start=TODAY,
            period_end=TODAY,
            facts={"progress": {"doneRate": 0.9, "blocked": 0}},
            body="",
            created_by="u1",
            created_at=at("2026-10-20T00:00:00Z"),
        )
    )
    found = await facts(db)
    assert found.previous is not None
    assert (found.previous.report_id, found.previous.done_rate, found.previous.blocked) == (
        "r1",
        0.25,
        3,
    )
    assert found.previous.period_end == date(2026, 10, 14)


async def test_no_previous(db: AsyncSession) -> None:
    assert (await facts(db)).previous is None


# --- 시드 p1 — 계약의 예 -----------------------------------------------------------------


async def test_seed_hw20_is_first(db: AsyncSession) -> None:
    """HW-20 이 진행 중이 된 지 12일째(계획 3일). 계약의 예와 같다."""
    found = await facts(db, "p1")
    first = found.attention[0]
    assert first.task_id == "k20"
    assert first.signals == ["longRunning", "overdue"]
    assert (first.status_days, first.planned_days, first.status_since_backfill) == (12, 3, False)
    # 신호 점수의 합만이다 — 선행을 걷고(Q63) 뒤를 막는 덤이 없다
    assert first.score == 4

    k22 = attention(found)["k22"]
    assert k22.signals == ["decidedButBlocked"]
    assert k22.status_days == 7
    # 오래 막힘은 staleDays(7) 를 '넘어야' 한다
    assert "longBlocked" not in k22.signals
    assert found.decisions.risky_thread_ids == ["t5", "t3", "t8", "t9"]
    # 다른 프로젝트의 작업은 섞이지 않는다
    assert not {"x1", "x2"} & {a.task_id for a in found.attention}
    # 새 리포트는 지난 리포트의 선행 칸을 키째 싣지 않는다
    dumped = found.model_dump(mode="json", by_alias=True)
    for row in dumped["attention"]:
        assert "waitingOnTaskIds" not in row and "blockingTaskIds" not in row


async def test_unknown_project_is_404(db: AsyncSession) -> None:
    from app.errors import ApiError

    with pytest.raises(ApiError) as caught:
        await progress.progress_facts(db, "nope", today=TODAY)
    assert caught.value.code == "PROJECT_NOT_FOUND"

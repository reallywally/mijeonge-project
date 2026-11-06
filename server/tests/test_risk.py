"""결정 병목 리스크 — `docs/api/risk.md`. 규칙 점수라 같은 데이터 · 기준이면 늘 같은 결과다.

신호 하나하나는 빈 프로젝트 p3 에 줄을 손으로 세워 서비스에 바로 묻는다 —
`today` 를 넘겨 날짜에 안 흔들린다. API 는 경계(권한 · 422 · 모양)만 본다.
시드 p1 의 보고서는 통째로 대조한다 — 웹 목업(`fixtures/risks.ts`)과 같은 셈이다.
"""

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Agenda,
    AgendaHistory,
    Member,
    Task,
    TaskAgendaLink,
    TaskHistory,
    TaskLog,
    TestCase,
    TestHistory,
    TestRef,
)
from app.schemas.risk import AgendaRisk, DecisionRiskReport, TaskRisk, TestRisk
from app.services import risk as risk_service
from app.time import at, today_kst
from scripts.seed import seed
from tests.conftest import AsMember

TODAY = date(2026, 10, 15)
DEFAULTS = {
    "dueSoonDays": 3,
    "staleDays": 7,
    "highScore": 6,
    "mediumScore": 3,
    "churnDays": 14,
    "churnCount": 5,
    "slipCount": 2,
}
# KST 로 오늘 0시 조금 넘어서 — idleDays 0
FRESH = "2026-10-15T00:00:00Z"


def day(offset: int) -> date:
    return TODAY + timedelta(days=offset)


@pytest.fixture
async def db(session: AsyncSession) -> AsyncSession:
    """시드(프로젝트 · 멤버)만 깔고 p3 는 비어 있다."""
    await seed(session)
    return session


async def add_agenda(
    s: AsyncSession,
    id_: str,
    *,
    state: str = "open",
    owner: str | None = "u1",
    due: date | None = None,
    created: str = FRESH,
    project: str = "p3",
) -> None:
    s.add(
        Agenda(
            id=id_,
            project_id=project,
            title=f"안건 {id_}",
            state=state,
            owner_id=owner,
            due_date=due,
            created_at=at(created),
        )
    )
    await s.flush()  # 한 줄씩 넣어야 seq 가 넣은 순서다


async def touch(s: AsyncSession, agenda_id: str, changed: str, project: str = "p3") -> None:
    """변경 이력 한 줄 — '마지막으로 손댄 날' 이 이것으로 바뀐다."""
    s.add(
        AgendaHistory(
            project_id=project,
            agenda_id=agenda_id,
            changed_by=None,
            changed_at=at(changed),
            changes=[{"field": "description", "from": "", "to": "고침", "subject": ""}],
        )
    )
    await s.flush()


async def add_task(
    s: AsyncSession,
    id_: str,
    *,
    status: str = "todo",
    parent: str | None = None,
    due: date | None = None,
    owner: str | None = "u2",
    project: str = "p3",
) -> None:
    s.add(
        Task(
            id=id_,
            project_id=project,
            key=f"MG-{id_}",
            title=f"작업 {id_}",
            parent_id=parent,
            status=status,
            owner_id=owner,
            due=due,
            created_at=at(FRESH),
        )
    )
    await s.flush()


async def link(s: AsyncSession, task_id: str, agenda_id: str, project: str = "p3") -> None:
    s.add(TaskAgendaLink(task_id=task_id, agenda_id=agenda_id, project_id=project))
    await s.flush()


async def report(s: AsyncSession, project: str = "p3", today: date = TODAY) -> DecisionRiskReport:
    return await risk_service.decision_risks(s, project, today=today)


async def one(s: AsyncSession, agenda_id: str) -> AgendaRisk | None:
    return next((t for t in (await report(s)).agendas if t.agenda_id == agenda_id), None)


async def signals(s: AsyncSession, agenda_id: str) -> list[str]:
    found = await one(s, agenda_id)
    return [] if found is None else list(found.signals)


# --- 시드 p1 — 화면 목업과 같은 셈 ---------------------------------------------------


async def test_seed_report_as_of_2026_10_15(db: AsyncSession) -> None:
    body = (await report(db, "p1")).model_dump(by_alias=True, mode="json")
    assert body["asOf"] == "2026-10-15"
    assert body["settings"] == DEFAULTS
    rows = [
        (t["agendaId"], t["signals"], t["score"], t["level"], t["idleDays"], t["overdueDays"])
        for t in body["agendas"]
    ]
    assert rows == [
        # 미룸 신호를 걷었다 — 멈춤 1 + 막는 중 3 + 막힌 일 1. 마지막으로 손댄 날은
        # 이행이 채운 '결정내용' 줄(09-10)
        ("t5", ["stale", "blocking"], 5, "medium", 35, 0),
        ("t3", ["overdue", "stale"], 4, "medium", 36, 15),
        # 같은 점수 · 같은 overdueDays 는 등록 순 — t8 이 t9 보다 먼저다
        ("t8", ["stale", "decisionAfterTaskDue", "noDueDate"], 4, "medium", 33, 0),
        ("t9", ["stale", "decisionAfterTaskDue", "noDueDate"], 4, "medium", 30, 0),
        ("t4", ["stale", "noOwner"], 2, "low", 35, 0),
        ("t7", ["stale"], 1, "low", 33, 0),
    ]
    t5 = body["agendas"][0]
    assert t5["blockedTaskIds"] == ["k18"] and t5["impactTaskCount"] == 1
    assert "deferCount" not in t5 and "lastDeferNote" not in t5
    # 사람별 — 막는 일 · 기한 넘김 뒤에 맡은 작업 · 테스트 리스크(high · medium) 합이 온다.
    # 담당자 없음(작업 9건)이 u2 · u3 보다 앞이다
    assert [
        (o["memberId"], o["openAgendas"], o["overdueAgendas"], o["blockedTasks"],
         o["blockingImpact"], o["riskyTasks"], o["riskyTests"])
        for o in body["owners"]
    ] == [
        ("u4", 2, 0, 1, 1, 3, 1),
        ("u1", 2, 1, 0, 0, 2, 1),
        (None, 1, 0, 0, 0, 9, 0),
        ("u2", 1, 0, 0, 0, 2, 1),
        ("u3", 0, 0, 1, 0, 2, 1),
    ]  # fmt: skip


# 2026-10-15 시드 p1 의 작업 · 테스트 리스크 — risk-dashboard.md '구현에서 메운 것 (서버)' 의 표.
# 목업(fixtures/risks.ts)이 이 표에 맞춘다
SEED_TASK_RISKS = [
    # (id, 신호, 점수, 등급, overdueDays, statusDays)
    ("k3", ["overdue", "longRunning", "ownerChurn"], 7, "high", 23, 30),
    ("k20", ["overdue", "longRunning"], 6, "high", 33, 7),
    ("k4", ["overdue", "longRunning"], 6, "high", 30, 37),
    ("k21", ["overdue", "dueSlipped"], 6, "high", 30, 33),
    ("k9", ["overdue", "longRunning"], 6, "high", 24, 26),
    ("k1", ["overdue", "longRunning"], 6, "high", 23, 38),
    ("k7", ["overdue", "longRunning"], 6, "high", 20, 29),
    ("k10", ["overdue"], 4, "medium", 22, 23),
    ("k11", ["overdue"], 4, "medium", 20, 21),
    ("k15", ["overdue"], 4, "medium", 16, 19),
    ("k12", ["overdue"], 4, "medium", 15, 22),
    ("k13", ["overdue"], 4, "medium", 15, 22),
    ("k5", ["overdue"], 4, "medium", 11, 29),
    ("k6", ["overdue"], 4, "medium", 11, 29),
    ("k14", ["overdue"], 4, "medium", 11, 19),
    ("k17", ["overdue"], 4, "medium", 11, 17),
    ("k16", ["overdue"], 4, "medium", 11, 15),
    ("k18", ["longBlocked"], 3, "medium", 0, 41),
    ("k22", ["contentChurn"], 1, "low", 0, 2),
]
SEED_TEST_RISKS = [
    # (id, 신호, 점수, 등급, overdueDays, statusDays)
    ("tc3", ["overdue", "longRunning", "dueSlipped"], 8, "high", 7, 12),
    ("tc4", ["basisChanged", "notStarted"], 3, "medium", 0, 14),
    ("tc6", ["longBlocked"], 3, "medium", 0, 13),
    ("tc7", ["failedIdle"], 3, "medium", 0, 10),
    # 지금 성공이어도 뒤집혀 왔다
    ("tc2", ["flaky"], 2, "low", 0, 5),
]


async def test_seed_task_and_test_risks_as_of_2026_10_15(db: AsyncSession) -> None:
    body = await report(db, "p1")
    assert [
        (t.task_id, t.signals, t.score, t.level, t.overdue_days, t.status_days) for t in body.tasks
    ] == SEED_TASK_RISKS
    assert [
        (t.test_id, t.signals, t.score, t.level, t.overdue_days, t.status_days) for t in body.tests
    ] == SEED_TEST_RISKS
    k21 = next(t for t in body.tasks if t.task_id == "k21")
    assert (k21.slip_count, k21.due_flow) == (2, ["2026-09-13", "2026-09-14", "2026-09-15"])
    k3 = next(t for t in body.tasks if t.task_id == "k3")
    assert (k3.owner_changes, k3.open_agenda_ids, k3.planned_days) == (2, ["t9"], 8)
    k22 = next(t for t in body.tasks if t.task_id == "k22")
    assert (k22.content_changes, k22.slip_count, k22.due_flow) == (5, 0, [])
    tc2 = next(t for t in body.tests if t.test_id == "tc2")
    assert (tc2.status, tc2.flips, tc2.refs[0].id) == ("pass", 2, "k4")
    tc3 = next(t for t in body.tests if t.test_id == "tc3")
    assert tc3.slip_count == 2 and [r.id for r in tc3.refs] == ["t3"]
    # 묶음(tc1 · tc5)은 안 나온다
    assert not {"tc1", "tc5"} & {t.test_id for t in body.tests}


async def test_project_without_records_is_empty(db: AsyncSession) -> None:
    body = await report(db)
    assert body.agendas == [] and body.tasks == [] and body.tests == [] and body.owners == []


async def test_other_project_does_not_leak(db: AsyncSession) -> None:
    """p2 의 보고서에는 p2 의 것만 — p1 의 막힌 작업 · 안건이 안 섞인다."""
    body = await report(db, "p2")
    assert [t.agenda_id for t in body.agendas] == ["t10"]
    assert [(o.member_id, o.open_agendas, o.blocked_tasks) for o in body.owners] == [("u2", 1, 0)]


# --- 기한 ----------------------------------------------------------------------------


async def test_overdue_counts_days(db: AsyncSession) -> None:
    await add_agenda(db, "a", due=day(-1))
    found = await one(db, "a")
    assert found is not None
    assert found.signals == ["overdue"] and found.overdue_days == 1 and found.score == 3


async def test_due_today_is_due_soon_not_overdue(db: AsyncSession) -> None:
    await add_agenda(db, "a", due=TODAY)
    found = await one(db, "a")
    assert found is not None
    assert found.signals == ["dueSoon"] and found.overdue_days == 0


@pytest.mark.parametrize(("offset", "expected"), [(3, ["dueSoon"]), (4, [])])
async def test_due_soon_boundary(db: AsyncSession, offset: int, expected: list[str]) -> None:
    """3일째까지 임박, 4일째는 아니다."""
    await add_agenda(db, "a", due=day(offset))
    assert await signals(db, "a") == expected


async def test_quiet_agenda_is_not_listed(db: AsyncSession) -> None:
    await add_agenda(db, "a", due=day(10))
    assert (await report(db)).agendas == []


# --- 멈춤 -----------------------------------------------------------------------------


async def test_no_defer_signal_anymore(db: AsyncSession) -> None:
    """미룸은 이력 줄이었다 — 걷었으니 신호도 없다 (docs/api/agenda.md)."""
    await add_agenda(db, "a", due=day(10))
    assert await one(db, "a") is None
    assert "deferredRepeatedly" not in str(risk_service.SIGNAL_SCORES)


async def test_idle_follows_the_latest_history_line(db: AsyncSession) -> None:
    """마지막으로 손댄 날 = 변경 이력에서 가장 늦은 날(없으면 등록) — 시각이 거꾸로 적혀도."""
    await add_agenda(db, "a", due=day(10), created="2026-09-01T00:00:00Z")
    await touch(db, "a", "2026-10-10T00:00:00Z")
    await touch(db, "a", "2026-10-05T00:00:00Z")
    found = await one(db, "a")
    assert found is None or "stale" not in found.signals
    await add_agenda(db, "b", due=day(10), created="2026-09-01T00:00:00Z")
    await touch(db, "b", "2026-10-07T00:00:00Z")
    b = await one(db, "b")
    assert b is not None and b.signals == ["stale"] and b.idle_days == 8


async def test_stale_boundary_and_kst_day(db: AsyncSession) -> None:
    # 2026-10-07T15:30Z 는 KST 로 10-08 — 7일 지났지만 '넘게' 가 아니다
    await add_agenda(db, "a", due=day(10), created="2026-10-07T15:30:00Z")
    # 2026-10-07T14:30Z 는 KST 로 10-07 — 8일
    await add_agenda(db, "b", due=day(10), created="2026-10-07T14:30:00Z")
    a, b = await one(db, "a"), await one(db, "b")
    assert a is None
    assert b is not None and b.signals == ["stale"] and b.idle_days == 8


async def test_stale_counts_from_last_history_line(db: AsyncSession) -> None:
    await add_agenda(db, "a", due=day(10), created="2026-09-01T00:00:00Z")
    await touch(db, "a", "2026-10-12T00:00:00Z")
    assert await one(db, "a") is None


# --- 막는 작업 · 연쇄 -----------------------------------------------------------------


async def test_blocking_counts_chain_without_duplicates(db: AsyncSession) -> None:
    """막힌 상위와 막힌 하위가 둘 다 걸려도 하위는 한 번만 센다. 완료는 안 센다."""
    await add_agenda(db, "a", due=day(10))
    await add_task(db, "q1", status="blocked")
    await add_task(db, "q2", status="blocked", parent="q1")
    await add_task(db, "q3", status="todo", parent="q2")
    await add_task(db, "q4", status="done", parent="q1")
    await add_task(db, "q5", status="doing", parent="q4")  # 완료 밑이라도 완료가 아니면 센다
    await add_task(db, "w1", status="doing")
    await link(db, "q1", "a")
    await link(db, "q2", "a")
    await link(db, "w1", "a")
    found = await one(db, "a")
    assert found is not None
    assert found.blocked_task_ids == ["q1", "q2"]
    assert found.waiting_task_ids == ["w1"]
    assert found.impact_task_count == 4  # q1 · q2 · q3 · q5
    assert found.signals == ["blocking"]
    assert found.score == 3 + 3  # 연쇄 가산은 3 에서 멈춘다
    assert found.level == "high"


async def test_impact_survives_a_parent_cycle(db: AsyncSession) -> None:
    """고리는 작업 서비스가 막지만, DB 에 들어와 버린 고리에도 계산이 멈춘다."""
    await add_agenda(db, "a", due=day(10))
    await add_task(db, "q1", status="blocked")
    await add_task(db, "q2", parent="q1")
    task = await db.get(Task, "q1")
    assert task is not None
    task.parent_id = "q2"
    await db.flush()
    await link(db, "q1", "a")
    found = await one(db, "a")
    assert found is not None and found.impact_task_count == 2


async def test_decision_after_task_due(db: AsyncSession) -> None:
    await add_agenda(db, "a", due=day(10))
    await add_task(db, "q1", due=day(5))
    await add_task(db, "q2", due=day(1), status="done")  # 완료는 기한을 안 본다
    await link(db, "q1", "a")
    await link(db, "q2", "a")
    found = await one(db, "a")
    assert found is not None
    assert found.signals == ["decisionAfterTaskDue"] and found.nearest_task_due == day(5)


@pytest.mark.parametrize(
    ("task_due", "expected"),
    [(day(3), ["decisionAfterTaskDue", "noDueDate"]), (day(4), ["noDueDate"])],
)
async def test_no_due_agenda_with_task_due_soon(
    db: AsyncSession, task_due: date, expected: list[str]
) -> None:
    await add_agenda(db, "a")
    await add_task(db, "q1", due=task_due)
    await link(db, "q1", "a")
    assert await signals(db, "a") == expected


async def test_no_due_date_only_with_linked_tasks(db: AsyncSession) -> None:
    await add_agenda(db, "lonely")
    await add_agenda(db, "linked")
    await add_task(db, "q1")
    await link(db, "q1", "linked")
    assert await one(db, "lonely") is None
    assert await signals(db, "linked") == ["noDueDate"]


async def test_no_owner(db: AsyncSession) -> None:
    await add_agenda(db, "a", owner=None, due=day(10))
    found = await one(db, "a")
    assert found is not None and found.signals == ["noOwner"] and found.level == "low"


async def test_decided_agendas_are_not_listed(db: AsyncSession) -> None:
    await add_agenda(db, "a", state="decided", owner=None, due=day(-5))
    assert (await report(db)).agendas == []


# --- 정렬 --------------------------------------------------------------------------


async def test_order_is_score_then_overdue_days_then_seq(db: AsyncSession) -> None:
    await add_agenda(db, "late1", due=day(-1))  # 3
    await add_agenda(db, "late5", due=day(-5))  # 3, 더 오래
    await add_agenda(db, "noown", owner=None, due=day(-1))  # 4
    await add_agenda(db, "late5b", due=day(-5))  # 3, late5 와 같다 → 등록 순
    assert [t.agenda_id for t in (await report(db)).agendas] == [
        "noown",
        "late5",
        "late5b",
        "late1",
    ]


# --- 사람별 --------------------------------------------------------------------------


async def test_owner_loads(db: AsyncSession) -> None:
    # u1 의 두 안건이 같은 막힌 작업을 막는다 — blockingImpact 는 한 번만 센다
    await add_agenda(db, "a", owner="u1", due=day(-1))
    await add_agenda(db, "b", owner="u1", due=day(10))
    await add_agenda(db, "c", owner="u2", due=day(10))  # 신호 없음 — 그래도 openAgendas 다
    await add_task(db, "q1", status="blocked", owner="u3")
    await add_task(db, "q2", status="todo", parent="q1", owner=None)
    await link(db, "q1", "a")
    await link(db, "q1", "b")
    owners = [
        (o.member_id, o.open_agendas, o.overdue_agendas, o.blocked_tasks, o.blocking_impact)
        for o in (await report(db)).owners
    ]
    assert owners == [
        ("u1", 2, 1, 0, 2),
        ("u2", 1, 0, 0, 0),
        ("u3", 0, 0, 1, 0),
    ]


# --- 기준 --------------------------------------------------------------------------


@pytest.fixture
def pinned_today(monkeypatch: pytest.MonkeyPatch) -> None:
    """API 가 보는 '오늘' 을 TODAY 에 묶는다 — 시드 기한이 고정이라 날이 지나면 신호가 바뀐다."""
    monkeypatch.setattr("app.api.risk.today_kst", lambda: TODAY)


@pytest.mark.usefixtures("pinned_today")
async def test_settings_change_the_result(client: httpx.AsyncClient) -> None:
    before = (await client.get("/api/projects/p1/risks")).json()
    t5 = next(t for t in before["agendas"] if t["agendaId"] == "t5")
    assert t5["level"] == "medium" and "stale" in t5["signals"]

    res = await client.put(
        "/api/projects/p1/risk-settings",
        json=DEFAULTS | {"staleDays": 60},
    )
    assert res.status_code == 200

    after = (await client.get("/api/projects/p1/risks")).json()
    assert after["settings"]["staleDays"] == 60
    t5 = next(t for t in after["agendas"] if t["agendaId"] == "t5")
    # 35일은 멈춤이 아니다 — 3 + 1 = 4
    assert t5["signals"] == ["blocking"] and t5["score"] == 4 and t5["level"] == "medium"
    # 다른 프로젝트의 기준은 그대로다
    other = (await client.get("/api/projects/p2/risk-settings")).json()
    assert other["staleDays"] == 7


@pytest.mark.usefixtures("pinned_today")
async def test_level_follows_score_thresholds(client: httpx.AsyncClient) -> None:
    res = await client.put(
        "/api/projects/p1/risk-settings",
        json=DEFAULTS | {"highScore": 5, "mediumScore": 4},
    )
    assert res.status_code == 200
    body = (await client.get("/api/projects/p1/risks")).json()
    levels = {t["agendaId"]: (t["score"], t["level"]) for t in body["agendas"]}
    assert levels["t5"] == (5, "high")
    assert levels["t4"] == (2, "low")
    assert levels["t3"] == (4, "medium")


# --- API ---------------------------------------------------------------------------


async def test_risks_shape(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/p1/risks")
    assert res.status_code == 200
    body: dict[str, Any] = res.json()
    assert set(body) == {"asOf", "settings", "agendas", "tasks", "tests", "owners"}
    assert body["asOf"] == today_kst().isoformat()
    assert set(body["agendas"][0]) == {
        "agendaId", "title", "state", "ownerId", "partId", "dueDate", "overdueDays",
        "idleDays", "blockedTaskIds", "waitingTaskIds",
        "impactTaskCount", "nearestTaskDue", "signals", "score", "level",
    }  # fmt: skip
    assert set(body["owners"][0]) == {
        "memberId", "openAgendas", "overdueAgendas", "blockedTasks", "blockingImpact",
        "riskyTasks", "riskyTests",
    }  # fmt: skip


async def test_any_member_reads(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    assert (await u2.get("/api/projects/p1/risks")).status_code == 200
    assert (await u2.get("/api/projects/p1/risk-settings")).status_code == 200


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    for url in ("/api/projects/nope/risks", "/api/projects/nope/risk-settings"):
        res = await client.get(url)
        assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_ungranted_member_sees_nothing(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """부여받지 않은 프로젝트는 없는 것처럼 — 403 이 아니라 404 다 (docs/api/auth.md)."""
    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    await session.commit()
    u9 = await as_member("u9")
    for url in ("/api/projects/p1/risks", "/api/projects/p1/risk-settings"):
        res = await u9.get(url)
        assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_settings_default_without_row(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/p2/risk-settings")
    assert res.status_code == 200
    assert res.json() == DEFAULTS


GOOD = {
    "dueSoonDays": 5,
    "staleDays": 14,
    "highScore": 7,
    "mediumScore": 4,
    "churnDays": 30,
    "churnCount": 8,
    "slipCount": 3,
}


async def test_project_admin_puts_and_reads_back(as_member: AsMember) -> None:
    u1 = await as_member("u1")  # p1 의 프로젝트 관리자
    res = await u1.put("/api/projects/p1/risk-settings", json=GOOD)
    assert res.status_code == 200 and res.json() == GOOD
    # 두 번째는 덮어쓴다(upsert)
    again = GOOD | {"staleDays": 30}
    assert (await u1.put("/api/projects/p1/risk-settings", json=again)).json() == again
    assert (await u1.get("/api/projects/p1/risk-settings")).json() == again


async def test_plain_user_cannot_put(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    res = await u2.put("/api/projects/p1/risk-settings", json=GOOD)
    assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN"
    # u1 도 관리자가 아닌 프로젝트에서는 못 바꾼다
    u1 = await as_member("u1")
    assert (await u1.put("/api/projects/p2/risk-settings", json=GOOD)).status_code == 403


@pytest.mark.parametrize(
    ("patch", "field"),
    [
        ({"dueSoonDays": 0}, "dueSoonDays"),
        ({"dueSoonDays": 31}, "dueSoonDays"),
        ({"staleDays": 91}, "staleDays"),
        ({"highScore": 31}, "highScore"),
        ({"mediumScore": 0}, "mediumScore"),
        ({"staleDays": "7"}, "staleDays"),
        ({"staleDays": 7.5}, "staleDays"),
        ({"staleDays": None}, "staleDays"),
        ({"highScore": 4, "mediumScore": 4}, "highScore"),
        ({"highScore": 3, "mediumScore": 4}, "highScore"),
        # 흔들림 기준 (risk-dashboard.md '기준')
        ({"churnDays": 0}, "churnDays"),
        ({"churnDays": 91}, "churnDays"),
        ({"churnCount": 1}, "churnCount"),
        ({"churnCount": 51}, "churnCount"),
        ({"slipCount": 0}, "slipCount"),
        ({"slipCount": 11}, "slipCount"),
        ({"slipCount": "2"}, "slipCount"),
        ({"churnDays": 14.5}, "churnDays"),
        ({"churnCount": None}, "churnCount"),
    ],
)
async def test_put_rejects(client: httpx.AsyncClient, patch: dict[str, Any], field: str) -> None:
    res = await client.put("/api/projects/p1/risk-settings", json=GOOD | patch)
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR" and field in body["detail"]
    # 바뀌지 않았다
    assert (await client.get("/api/projects/p1/risk-settings")).json()["staleDays"] == 7


async def test_put_ignores_the_removed_defer_count(client: httpx.AsyncClient) -> None:
    """미룸 문턱은 걷었다 — 옛 화면이 실어 보내도 버린다."""
    res = await client.put("/api/projects/p1/risk-settings", json=GOOD | {"deferCount": 3})
    assert res.status_code == 200 and res.json() == GOOD


@pytest.mark.parametrize("missing", sorted(GOOD))
async def test_put_needs_all_seven(client: httpx.AsyncClient, missing: str) -> None:
    """일곱 값이 한 묶음이다 — 새 셋이 빠져도(옛 화면) 422."""
    partial = {k: v for k, v in GOOD.items() if k != missing}
    res = await client.put("/api/projects/p1/risk-settings", json=partial)
    assert res.status_code == 422 and missing in res.json()["detail"]


@pytest.mark.parametrize(
    "edge",
    [
        {"churnDays": 1, "churnCount": 2, "slipCount": 1},
        {"churnDays": 90, "churnCount": 50, "slipCount": 10},
    ],
)
async def test_put_accepts_churn_bounds(client: httpx.AsyncClient, edge: dict[str, int]) -> None:
    res = await client.put("/api/projects/p1/risk-settings", json=GOOD | edge)
    assert res.status_code == 200 and res.json() == GOOD | edge


async def test_risk_settings_go_with_the_project(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """프로젝트를 지우면 기준도 같이 지워진다 — 시드를 다시 돌려도 남지 않는다."""
    assert (await client.put("/api/projects/p1/risk-settings", json=GOOD)).status_code == 200
    await seed(session)
    assert (await risk_service.load_settings(session, "p1")).stale_days == 7


# --- Postgres -----------------------------------------------------------------------


async def test_report_on_postgres(pg_session: AsyncSession) -> None:
    """sqlite 만으로는 진짜 쿼리를 못 믿는다 — 시드 보고서가 같은지 Postgres 에서 한 번 본다."""
    body = await risk_service.decision_risks(pg_session, "p1", today=TODAY)
    assert [t.agenda_id for t in body.agendas] == ["t5", "t3", "t8", "t9", "t4", "t7"]
    assert [o.member_id for o in body.owners] == ["u4", "u1", None, "u2", "u3"]
    assert [t.task_id for t in body.tasks] == [row[0] for row in SEED_TASK_RISKS]
    assert [t.test_id for t in body.tests] == [row[0] for row in SEED_TEST_RISKS]


# --- 작업 리스크 (risk-dashboard.md '작업 리스크') ----------------------------------


async def add_work(
    s: AsyncSession,
    id_: str,
    *,
    status: str = "todo",
    start: date | None = None,
    due: date | None = None,
    since: str | None = None,
    owner: str | None = "u2",
) -> None:
    """작업 한 줄 + 지금 상태가 된 때(task_log). since 가 없으면 등록 시각(FRESH)이다."""
    await add_task(s, id_, status=status, due=due, owner=owner)
    task = await s.get(Task, id_)
    assert task is not None
    task.start = start
    if since is not None:
        s.add(
            TaskLog(
                project_id="p3",
                task_id=id_,
                from_status="todo",
                to_status=status,
                changed_at=at(since),
            )
        )
    await s.flush()


def ago(days: int) -> str:
    """KST 로 오늘에서 days 일 전 정오."""
    return f"{day(-days).isoformat()}T03:00:00Z"


async def changed(
    s: AsyncSession, task_id: str, when: str, *changes: tuple[str, object, object]
) -> None:
    s.add(
        TaskHistory(
            project_id="p3",
            task_id=task_id,
            changed_at=at(when),
            changes=[{"field": f, "from": a, "to": b, "subject": ""} for f, a, b in changes],
        )
    )
    await s.flush()


async def task_risk(s: AsyncSession, task_id: str) -> TaskRisk | None:
    return next((t for t in (await report(s)).tasks if t.task_id == task_id), None)


async def task_signals(s: AsyncSession, task_id: str) -> list[str]:
    found = await task_risk(s, task_id)
    return [] if found is None else list(found.signals)


@pytest.mark.parametrize(
    ("offset", "score"),
    # 3점 + min(넘긴 날, 7) ÷ 7 반올림 — 4일부터 +1, 오래 넘겨도 +1 에서 멈춘다
    [(-1, 3), (-3, 3), (-4, 4), (-30, 4)],
)
async def test_task_overdue_and_bonus(db: AsyncSession, offset: int, score: int) -> None:
    await add_work(db, "w", status="doing", due=day(offset))
    found = await task_risk(db, "w")
    assert found is not None
    assert found.signals == ["overdue"] and found.score == score
    assert found.overdue_days == -offset and found.level == ("medium" if score >= 3 else "low")


async def test_due_today_is_not_overdue(db: AsyncSession) -> None:
    await add_work(db, "w", status="doing", due=TODAY)
    assert await task_risk(db, "w") is None


async def test_done_and_deleted_tasks_are_not_listed(db: AsyncSession) -> None:
    await add_work(db, "done", status="done", due=day(-5))
    await add_work(db, "gone", status="todo", due=day(-5))
    gone = await db.get(Task, "gone")
    assert gone is not None
    gone.is_deleted = True
    await db.flush()
    assert (await report(db)).tasks == []


@pytest.mark.parametrize(
    ("start", "due", "expected"),
    [
        (day(-1), None, ["notStarted"]),
        (TODAY, None, []),
        (None, day(3), ["notStarted"]),
        (None, day(4), []),
        # 기한을 넘겼으면 기한 넘김만 — 둘이 같이 안 나온다
        (day(-5), day(-1), ["overdue"]),
    ],
)
async def test_task_not_started(
    db: AsyncSession, start: date | None, due: date | None, expected: list[str]
) -> None:
    await add_work(db, "w", start=start, due=due)
    assert await task_signals(db, "w") == expected


async def test_not_started_only_for_todo(db: AsyncSession) -> None:
    await add_work(db, "w", status="doing", start=day(-1), since=ago(0))
    assert await task_risk(db, "w") is None


@pytest.mark.parametrize(("days", "expected"), [(7, []), (8, ["longBlocked"])])
async def test_task_long_blocked_boundary(db: AsyncSession, days: int, expected: list[str]) -> None:
    await add_work(db, "w", status="blocked", since=ago(days))
    assert await task_signals(db, "w") == expected


async def test_status_days_without_log_counts_from_creation(db: AsyncSession) -> None:
    """task_log 줄이 없으면 등록 시각부터 센다."""
    await add_work(db, "w", status="blocked")
    assert await task_risk(db, "w") is None
    task = await db.get(Task, "w")
    assert task is not None
    task.created_at = at(ago(8))
    await db.flush()
    risk = await task_risk(db, "w")
    assert risk is not None and risk.status_days == 8 and risk.signals == ["longBlocked"]


@pytest.mark.parametrize(("days", "expected"), [(21, []), (22, ["longRunning"])])
async def test_task_long_running_with_plan(
    db: AsyncSession, days: int, expected: list[str]
) -> None:
    # 계획 14일(오늘 −3 ~ +10) × 1.5 = 21 — 넘어야 한다
    await add_work(db, "w", status="doing", start=day(-3), due=day(10), since=ago(days))
    assert await task_signals(db, "w") == expected
    found = await task_risk(db, "w")
    assert found is None or found.planned_days == 14


@pytest.mark.parametrize(("days", "expected"), [(7, []), (8, ["longRunning"])])
async def test_task_long_running_without_plan(
    db: AsyncSession, days: int, expected: list[str]
) -> None:
    await add_work(db, "w", status="doing", due=day(10), since=ago(days))
    assert await task_signals(db, "w") == expected


async def test_long_running_only_for_doing(db: AsyncSession) -> None:
    await add_work(db, "w", status="todo", since=ago(30))
    assert await task_risk(db, "w") is None


async def test_due_slipped_counts_only_later_dates(db: AsyncSession) -> None:
    await add_work(db, "w", status="doing", due=day(10), since=ago(0))
    # 비웠다 채운 것 · 당긴 것은 미룸이 아니다 — 기간 제한 없이 센다
    await changed(db, "w", ago(90), ("due", None, day(5).isoformat()))
    await changed(db, "w", ago(60), ("due", day(5).isoformat(), day(3).isoformat()))
    await changed(db, "w", ago(40), ("due", day(3).isoformat(), day(8).isoformat()))
    assert await task_signals(db, "w") == []
    await changed(db, "w", ago(1), ("due", day(8).isoformat(), day(10).isoformat()))
    found = await task_risk(db, "w")
    assert found is not None
    assert found.signals == ["dueSlipped"] and found.score == 2 and found.slip_count == 2
    assert found.due_flow == [day(n).isoformat() for n in (5, 3, 8, 10)]


@pytest.mark.parametrize(("lines", "expected"), [(4, []), (5, ["contentChurn"])])
async def test_task_content_churn_boundary(
    db: AsyncSession, lines: int, expected: list[str]
) -> None:
    await add_work(db, "w", status="doing", due=day(10), since=ago(0))
    for n in range(lines):
        # 한 줄에 제목 · 본문이 같이 있어도 한 줄로 센다
        await changed(db, "w", ago(n), ("title", f"a{n}", f"b{n}"), ("body", None, f"c{n}"))
    # 다른 칸만 바뀐 줄은 안 센다
    await changed(db, "w", ago(1), ("priority", "normal", "high"))
    assert await task_signals(db, "w") == expected
    found = await task_risk(db, "w")
    assert found is None or found.content_changes == lines


@pytest.mark.parametrize(("days", "counted"), [(14, True), (15, False)])
async def test_churn_window_includes_the_first_day(
    db: AsyncSession, days: int, counted: bool
) -> None:
    """최근 churnDays(14) 일 안 = 오늘 − 14 일(그날 포함)부터."""
    await add_work(db, "w", status="doing", due=day(10), since=ago(0))
    for n in range(4):
        await changed(db, "w", ago(n), ("title", "a", "b"))
    await changed(db, "w", ago(days), ("title", "a", "b"))
    assert (await task_signals(db, "w") == ["contentChurn"]) is counted


async def test_task_owner_churn(db: AsyncSession) -> None:
    await add_work(db, "w", status="doing", due=day(10), since=ago(0))
    await changed(db, "w", ago(20), ("ownerId", "u1", "u3"))
    await changed(db, "w", ago(3), ("ownerId", "u3", "u2"))
    assert await task_signals(db, "w") == []
    await changed(db, "w", ago(1), ("ownerId", "u2", "u1"), ("title", "a", "b"))
    found = await task_risk(db, "w")
    assert found is not None
    assert found.signals == ["ownerChurn"] and found.owner_changes == 2 and found.score == 1
    assert found.level == "low"


async def test_task_open_agenda_ids_are_undecided_links(db: AsyncSession) -> None:
    await add_agenda(db, "open1", due=day(10))
    await add_agenda(db, "done1", state="decided")
    await add_agenda(db, "open0", state="queued", due=day(10))
    await add_work(db, "w", due=day(-1))
    for agenda_id in ("open0", "done1", "open1"):
        await link(db, "w", agenda_id)
    found = await task_risk(db, "w")
    assert found is not None and found.open_agenda_ids == ["open1", "open0"]


async def test_task_order_is_score_overdue_status_days_then_seq(db: AsyncSession) -> None:
    await add_work(db, "a", status="blocked", since=ago(8))  # 3
    await add_work(db, "b", due=day(-1))  # 3, 넘김 1일
    await add_work(db, "c", status="blocked", since=ago(9))  # 3, 막힌 지 더 오래
    await add_work(db, "d", status="blocked", since=ago(9))  # c 와 같다 → 등록 순
    await add_work(db, "e", status="doing", due=day(-5), since=ago(0))  # 3 + 1
    assert [t.task_id for t in (await report(db)).tasks] == ["e", "b", "c", "d", "a"]


# --- 테스트 리스크 (risk-dashboard.md '테스트 리스크') -------------------------------


async def add_test(
    s: AsyncSession,
    id_: str,
    *,
    status: str = "testing",
    since: str = FRESH,
    start: date | None = None,
    due: date | None = None,
    parent: str | None = None,
    owner: str | None = "u2",
) -> None:
    s.add(
        TestCase(
            id=id_,
            project_id="p3",
            key=f"MG-T{id_}",
            title=f"테스트 {id_}",
            parent_id=parent,
            status=status,
            status_changed_at=at(since),
            start=start,
            due=due,
            owner_id=owner,
            created_at=at(FRESH),
        )
    )
    await s.flush()


async def log_test_change(
    s: AsyncSession, test_id: str, when: str, *changes: tuple[str, object, object]
) -> None:
    s.add(
        TestHistory(
            project_id="p3",
            test_id=test_id,
            changed_at=at(when),
            changes=[{"field": f, "from": a, "to": b, "subject": ""} for f, a, b in changes],
        )
    )
    await s.flush()


async def find_test_risk(s: AsyncSession, test_id: str) -> TestRisk | None:
    return next((t for t in (await report(s)).tests if t.test_id == test_id), None)


async def test_test_signals_reuse_the_test_list(db: AsyncSession) -> None:
    """build_tests 의 신호 그대로 — 점수는 risk-dashboard.md 의 표."""
    await add_test(db, "f", status="fail", since=ago(8))
    await add_test(db, "b", status="blocked", since=ago(8))
    await add_test(db, "o", status="testing", due=day(-4), since=ago(0))
    await add_test(db, "n", status="ready", start=day(-1))
    await add_test(db, "quiet", status="testing", since=ago(0))
    got = {t.test_id: (t.signals, t.score) for t in (await report(db)).tests}
    assert got == {
        "f": (["failedIdle"], 3),
        "b": (["longBlocked"], 3),
        # 3 + 넘김 4일 가산 1
        "o": (["overdue"], 4),
        "n": (["notStarted"], 1),
    }


async def test_test_flaky_even_when_passed(db: AsyncSession) -> None:
    await add_test(db, "t", status="pass", due=day(-5), since=ago(1))
    await log_test_change(db, "t", ago(5), ("status", "testing", "fail"))  # 뒤집힘이 아니다
    await log_test_change(db, "t", ago(3), ("status", "fail", "pass"))
    assert await find_test_risk(db, "t") is None
    await log_test_change(db, "t", ago(2), ("status", "pass", "fail"))
    await log_test_change(db, "t", ago(1), ("status", "fail", "pass"))
    found = await find_test_risk(db, "t")
    assert found is not None
    # 성공한 테스트는 '결과 뒤집힘' 만 — 기간 지남 · 넘긴 날 가산이 없다
    assert found.signals == ["flaky"] and found.flips == 3 and found.score == 2
    assert found.overdue_days == 0 and found.status == "pass"


async def test_test_flips_outside_the_window_do_not_count(db: AsyncSession) -> None:
    await add_test(db, "t", status="fail", since=ago(0))
    await log_test_change(db, "t", ago(15), ("status", "pass", "fail"))
    await log_test_change(db, "t", ago(1), ("status", "fail", "pass"))
    await log_test_change(db, "t", ago(0), ("status", "pass", "fail"))
    found = await find_test_risk(db, "t")
    assert found is None or "flaky" in found.signals
    assert found is not None and found.flips == 2


async def test_test_due_slipped(db: AsyncSession) -> None:
    await add_test(db, "t", status="testing", due=day(10), since=ago(0))
    await log_test_change(db, "t", ago(40), ("due", day(1).isoformat(), day(5).isoformat()))
    await log_test_change(db, "t", ago(2), ("due", day(5).isoformat(), day(10).isoformat()))
    found = await find_test_risk(db, "t")
    assert found is not None and found.signals == ["dueSlipped"] and found.slip_count == 2


async def test_test_groups_are_left_out(db: AsyncSession) -> None:
    await add_test(db, "g", status="fail", since=ago(30))
    await add_test(db, "kid", status="blocked", since=ago(30), parent="g")
    assert [t.test_id for t in (await report(db)).tests] == ["kid"]


async def test_owner_counts_risky_tasks_and_tests(db: AsyncSession) -> None:
    await add_work(db, "hi", status="doing", due=day(-5), since=ago(0), owner="u3")  # 4 medium
    await add_work(db, "lo", status="doing", due=day(10), since=ago(0), owner="u3")
    await changed(db, "lo", ago(1), ("ownerId", "u1", "u2"))
    await changed(db, "lo", ago(0), ("ownerId", "u2", "u3"))  # 1 low — 안 센다
    await add_test(db, "t", status="fail", since=ago(8), owner="u3")  # 3 medium
    assert [
        (o.member_id, o.risky_tasks, o.risky_tests, o.blocked_tasks)
        for o in (await report(db)).owners
    ] == [("u3", 1, 1, 0)]


@pytest.mark.usefixtures("pinned_today")
async def test_churn_settings_change_the_result(client: httpx.AsyncClient) -> None:
    def rows(body: dict[str, Any]) -> dict[str, list[str]]:
        return {
            **{t["taskId"]: t["signals"] for t in body["tasks"]},
            **{t["testId"]: t["signals"] for t in body["tests"]},
        }

    before = rows((await client.get("/api/projects/p1/risks")).json())
    assert before["k22"] == ["contentChurn"] and "dueSlipped" in before["k21"]
    res = await client.put(
        "/api/projects/p1/risk-settings", json=DEFAULTS | {"churnCount": 6, "slipCount": 3}
    )
    assert res.status_code == 200
    after = rows((await client.get("/api/projects/p1/risks")).json())
    assert "k22" not in after and after["k21"] == ["overdue"]
    assert "dueSlipped" not in after["tc3"]
    # 창을 줄이면 HW-T2 의 뒤집힘(10-08 · 10-10)이 빠진다 — 10-08 은 7일 전
    await client.put("/api/projects/p1/risk-settings", json=DEFAULTS | {"churnDays": 7})
    assert "tc2" in rows((await client.get("/api/projects/p1/risks")).json())
    await client.put("/api/projects/p1/risk-settings", json=DEFAULTS | {"churnDays": 6})
    assert "tc2" not in rows((await client.get("/api/projects/p1/risks")).json())


async def test_report_runs_a_fixed_number_of_queries(db: AsyncSession) -> None:
    """N+1 이 없다 — 작업 · 테스트 · 이력이 늘어도 select 수가 같다."""
    assert db.bind is not None
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(args[2])

    async def grow(n: int) -> None:
        await add_agenda(db, f"a{n}", due=day(-1))
        await add_work(db, f"w{n}", status="blocked", since=ago(9))
        await link(db, f"w{n}", f"a{n}")
        await changed(db, f"w{n}", ago(1), ("ownerId", "u1", "u2"))
        await add_test(db, f"s{n}", status="fail", since=ago(9))
        await log_test_change(db, f"s{n}", ago(1), ("status", "pass", "fail"))
        db.add(TestRef(test_id=f"s{n}", project_id="p3", task_id=f"w{n}"))
        await db.flush()

    await grow(0)
    event.listen(db.bind.sync_engine, "before_cursor_execute", count)
    try:
        await report(db)
        before = len(statements)
        for n in range(1, 6):
            await grow(n)
        statements.clear()
        body = await report(db)
        assert (len(body.tasks), len(body.tests)) == (6, 6)
        assert len(statements) == before
    finally:
        event.remove(db.bind.sync_engine, "before_cursor_execute", count)

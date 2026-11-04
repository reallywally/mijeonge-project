"""결정 병목 리스크 — `docs/api/risk.md`. 규칙 점수라 같은 데이터 · 기준이면 늘 같은 결과다.

신호 하나하나는 빈 프로젝트 p3 에 줄을 손으로 세워 서비스에 바로 묻는다 —
`today` 를 넘겨 날짜에 안 흔들린다. API 는 경계(권한 · 422 · 모양)만 본다.
시드 p1 의 보고서는 통째로 대조한다 — 웹 목업(`fixtures/risks.ts`)과 같은 셈이다.
"""

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agenda, AgendaHistory, Member, Task, TaskAgendaLink
from app.schemas.risk import AgendaRisk, DecisionRiskReport
from app.services import risk as risk_service
from app.time import at, today_kst
from scripts.seed import seed
from tests.conftest import AsMember

TODAY = date(2026, 10, 15)
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
    assert body["settings"] == {
        "dueSoonDays": 3,
        "staleDays": 7,
        "highScore": 6,
        "mediumScore": 3,
    }
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
    assert [(t["taskId"], t["signal"], t["agendaIds"]) for t in body["tasks"]] == [
        ("k22", "decidedButBlocked", ["t2"]),
        ("k3", "dueBeforeDecision", ["t9"]),
        ("k13", "dueBeforeDecision", ["t8"]),
    ]
    assert body["owners"] == [
        {"memberId": "u4", "openAgendas": 2, "overdueAgendas": 0, "blockedTasks": 1,
         "blockingImpact": 1},
        {"memberId": "u1", "openAgendas": 2, "overdueAgendas": 1, "blockedTasks": 0,
         "blockingImpact": 0},
        {"memberId": "u2", "openAgendas": 1, "overdueAgendas": 0, "blockedTasks": 0,
         "blockingImpact": 0},
        {"memberId": "u3", "openAgendas": 0, "overdueAgendas": 0, "blockedTasks": 1,
         "blockingImpact": 0},
        {"memberId": None, "openAgendas": 1, "overdueAgendas": 0, "blockedTasks": 0,
         "blockingImpact": 0},
    ]  # fmt: skip


async def test_project_without_records_is_empty(db: AsyncSession) -> None:
    body = await report(db)
    assert body.agendas == [] and body.tasks == [] and body.owners == []


async def test_other_project_does_not_leak(db: AsyncSession) -> None:
    """p2 의 보고서에는 p2 의 것만 — p1 의 막힌 작업 · 안건이 안 섞인다."""
    body = await report(db, "p2")
    assert [t.agenda_id for t in body.agendas] == ["t10"]
    assert body.tasks == []
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


# --- 작업 신호 ------------------------------------------------------------------------


async def test_task_signals_and_order(db: AsyncSession) -> None:
    await add_agenda(db, "done", state="decided")
    await add_agenda(db, "open", due=day(10))
    # 정해졌는데 막힘 — 기한 없는 것은 같은 신호 안에서 뒤로
    await add_task(db, "dbb_nodue", status="blocked")
    await add_task(db, "dbb_due", status="blocked", due=day(20))
    await link(db, "dbb_nodue", "done")
    await link(db, "dbb_due", "done")
    # 막혔는데 걸린 안건이 없다
    await add_task(db, "bare", status="blocked")
    # 안건 기한(10일 뒤)이 작업 기한(5일 뒤)보다 늦다
    await add_task(db, "early", status="doing", due=day(5))
    await link(db, "early", "open")
    # 안 정해진 안건이 하나라도 걸리면 '정해졌는데 막힘' 이 아니다
    await add_task(db, "mixed", status="blocked", due=day(30))
    await link(db, "mixed", "done")
    await link(db, "mixed", "open")
    # 완료는 안 본다
    await add_task(db, "fin", status="done", due=day(1))
    await link(db, "fin", "open")

    rows = [(t.task_id, t.signal, t.agenda_ids) for t in (await report(db)).tasks]
    assert rows == [
        ("dbb_due", "decidedButBlocked", ["done"]),
        ("dbb_nodue", "decidedButBlocked", ["done"]),
        ("bare", "blockedWithoutAgenda", []),
        ("early", "dueBeforeDecision", ["open"]),
    ]


async def test_due_before_decision_when_decision_already_overdue(db: AsyncSession) -> None:
    await add_agenda(db, "late", due=day(-2))
    await add_task(db, "q1", due=day(30))
    await link(db, "q1", "late")
    rows = [(t.task_id, t.signal) for t in (await report(db)).tasks]
    assert rows == [("q1", "dueBeforeDecision")]


async def test_one_signal_per_task_first_wins(db: AsyncSession) -> None:
    """막혀 있고 기한도 먼저 오지만, 안 정해진 안건이 걸려 있으면 dueBeforeDecision 하나만."""
    await add_agenda(db, "open", due=day(10))
    await add_task(db, "q1", status="blocked", due=day(1))
    await link(db, "q1", "open")
    rows = [(t.task_id, t.signal) for t in (await report(db)).tasks]
    assert rows == [("q1", "dueBeforeDecision")]


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
        json={"dueSoonDays": 3, "staleDays": 60, "highScore": 6, "mediumScore": 3},
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
        json={"dueSoonDays": 3, "staleDays": 7, "highScore": 5, "mediumScore": 4},
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
    assert set(body) == {"asOf", "settings", "agendas", "tasks", "owners"}
    assert body["asOf"] == today_kst().isoformat()
    assert set(body["agendas"][0]) == {
        "agendaId", "title", "state", "ownerId", "partId", "dueDate", "overdueDays",
        "idleDays", "blockedTaskIds", "waitingTaskIds",
        "impactTaskCount", "nearestTaskDue", "signals", "score", "level",
    }  # fmt: skip
    assert set(body["tasks"][0]) == {
        "taskId", "key", "title", "status", "ownerId", "partId", "due", "agendaIds", "signal",
    }  # fmt: skip
    assert set(body["owners"][0]) == {
        "memberId", "openAgendas", "overdueAgendas", "blockedTasks", "blockingImpact",
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
    assert res.json() == {
        "dueSoonDays": 3,
        "staleDays": 7,
        "highScore": 6,
        "mediumScore": 3,
    }


GOOD = {"dueSoonDays": 5, "staleDays": 14, "highScore": 7, "mediumScore": 4}


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


async def test_put_needs_all_four(client: httpx.AsyncClient) -> None:
    partial = {k: v for k, v in GOOD.items() if k != "mediumScore"}
    res = await client.put("/api/projects/p1/risk-settings", json=partial)
    assert res.status_code == 422 and "mediumScore" in res.json()["detail"]


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
    assert [t.task_id for t in body.tasks] == ["k22", "k3", "k13"]

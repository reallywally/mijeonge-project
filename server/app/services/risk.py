"""결정 병목 리스크 — 안 정해진 안건이 막는(막을) 일, 작업 · 테스트의 지연 · 흔들림을 규칙 점수로.

계약은 `docs/api/risk.md` · `risk-dashboard.md`(작업 · 테스트, 2026-11-06).
'집계는 프론트가 한다' 의 예외다(Q35) — 챗봇 도구가 같은 함수를 부른다.
한 프로젝트가 수백 줄 규모라 몇 번의 select 로 다 읽고 계산은 파이썬에서 한다
(`server/PLAN.md` 10단계).
`today` 를 인자로 받는다 — 검사가 날짜에 흔들리지 않게.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import (
    Agenda,
    AgendaHistory,
    Member,
    Part,
    ProjectMember,
    Task,
    TaskAgendaLink,
    TaskHistory,
    TestCase,
    TestHistory,
)
from app.schemas.risk import (
    AgendaRisk,
    AgendaRiskSignal,
    DecisionRiskReport,
    OwnerLoad,
    RiskAgendaState,
    RiskLevel,
    RiskSettings,
    RiskTaskStatus,
    TaskRisk,
    TaskRiskSignal,
    TestRisk,
    TestRiskSignal,
)
from app.schemas.test import TestStatus
from app.services import project as project_service
from app.services import task as task_service
from app.services import test as test_service
from app.services.access import live_agenda_ids, live_task_ids
from app.services.progress import kst_day
from app.services.risk_settings import default_settings, load_settings, save_settings
from app.time import KST, as_utc

__all__ = [
    "decision_risks",
    "decision_risks_for",
    "default_settings",
    "load_settings",
    "save_settings",
]

# 신호 점수는 고정이다 — 바꿀 수 있는 것은 문턱값뿐이다. 순서가 곧 signals 배열의 순서다
SIGNAL_SCORES: dict[AgendaRiskSignal, int] = {
    "overdue": 3,
    "dueSoon": 1,
    "stale": 1,
    "blocking": 3,
    "decisionAfterTaskDue": 2,
    "noOwner": 1,
    "noDueDate": 1,
}
# 작업 · 테스트 리스크 (docs/api/risk-dashboard.md). 순서가 곧 signals 배열의 순서다
TASK_SIGNAL_SCORES: dict[TaskRiskSignal, int] = {
    "overdue": 3,
    "longBlocked": 3,
    "longRunning": 2,
    "dueSlipped": 2,
    "notStarted": 1,
    "contentChurn": 1,
    "ownerChurn": 1,
}
TEST_SIGNAL_SCORES: dict[TestRiskSignal, int] = {
    "overdue": 3,
    "failedIdle": 3,
    "longBlocked": 3,
    "basisChanged": 2,
    "longRunning": 2,
    "flaky": 2,
    "dueSlipped": 2,
    "notStarted": 1,
}
# 신호의 화면 말 — 화면 · 챗봇 · Claude 가 같은 말을 쓴다 (risk-dashboard.md '신호의 화면 말')
TASK_SIGNAL_LABELS: dict[TaskRiskSignal, str] = {
    "overdue": "기한 넘김",
    "longBlocked": "오래 막힘",
    "longRunning": "오래 걸림",
    "dueSlipped": "기한 거듭 미룸",
    "notStarted": "시작 안 함",
    "contentChurn": "내용 자주 바뀜",
    "ownerChurn": "담당자 자주 바뀜",
}
TEST_SIGNAL_LABELS: dict[TestRiskSignal, str] = {
    "overdue": "기간 지남",
    "failedIdle": "실패 그대로",
    "longBlocked": "오래 막힘",
    "basisChanged": "기준 바뀜",
    "longRunning": "오래 걸림",
    "flaky": "결과 뒤집힘",
    "dueSlipped": "기한 거듭 미룸",
    "notStarted": "시작 안 함",
}
NO_OWNER = "담당자 없음"
COMMON_PART = "공통"
UNKNOWN = "알 수 없음"
# 막는 일이 많을수록 위로 오되 그것만으로 다른 신호를 덮지 않는다
IMPACT_CAP = 3
# 기한을 오래 넘긴 것이 위로 — min(overdueDays, 7) ÷ 7 을 반올림한 0 · 1
OVERDUE_CAP = 7
# 담당자가 이 횟수 이상 바뀌면 '담당자 자주 바뀜' · 결과가 이만큼 뒤집히면 '결과 뒤집힘'
OWNER_CHURN_MIN = 2
FLIP_MIN = 2
FLIPS = {("pass", "fail"), ("fail", "pass")}
CONTENT_FIELDS = ("title", "body")
UNDECIDED = ("queued", "open")
# DB 의 글자를 응답의 Literal 로 — 완료 · 결정은 여기까지 오기 전에 걸러진다
UNDECIDED_STATE: dict[str, RiskAgendaState] = {"queued": "queued", "open": "open"}
OPEN_TASK_STATE: dict[str, RiskTaskStatus] = {
    "todo": "todo",
    "doing": "doing",
    "blocked": "blocked",
}
RISKY: tuple[RiskLevel, ...] = ("high", "medium")


@dataclass
class _Task:
    id: str
    key: str
    title: str
    parent_id: str | None
    status: str
    owner_id: str | None
    part_id: str | None
    start: date | None
    due: date | None
    seq: int
    created_at: datetime


@dataclass
class _Agenda:
    id: str
    title: str
    state: str
    owner_id: str | None
    part_id: str | None
    due_date: date | None
    seq: int
    # 마지막 변경 이력(없으면 등록)의 KST 날짜
    last_touched: date
    task_ids: list[str] = field(default_factory=list)


def _impact(
    blocked_ids: Iterable[str], children: dict[str, list[str]], tasks: dict[str, _Task]
) -> set[str]:
    """막힌 작업과 그 하위 중 완료가 아닌 것. 고리는 방문 집합으로 한 번 더 막는다."""
    seen: set[str] = set()
    stack = list(blocked_ids)
    while stack:
        task_id = stack.pop()
        if task_id in seen:
            continue
        seen.add(task_id)
        stack.extend(children.get(task_id, ()))
    return {task_id for task_id in seen if tasks[task_id].status != "done"}


def _level(score: int, rule: RiskSettings) -> RiskLevel:
    if score >= rule.high_score:
        return "high"
    if score >= rule.medium_score:
        return "medium"
    return "low"


async def _read(
    session: AsyncSession, project_id: str
) -> tuple[dict[str, _Agenda], dict[str, _Task], list[tuple[str, str]]]:
    # 열만 고른다 — 선택지 · 본문 같은 selectin 관계를 끌고 오지 않게
    agenda_rows = await session.execute(
        select(
            Agenda.id,
            Agenda.title,
            Agenda.state,
            Agenda.owner_id,
            Agenda.part_id,
            Agenda.due_date,
            Agenda.seq,
            Agenda.created_at,
        )
        .where(Agenda.project_id == project_id, Agenda.is_deleted.is_(False))
        .order_by(Agenda.seq)
    )
    agendas = {
        row.id: _Agenda(
            id=row.id,
            title=row.title,
            state=row.state,
            owner_id=row.owner_id,
            part_id=row.part_id,
            due_date=row.due_date,
            seq=row.seq,
            last_touched=as_utc(row.created_at).astimezone(KST).date(),
        )
        for row in agenda_rows
    }
    # 마지막 손댄 날 = 변경 이력의 마지막 줄. 이력은 seq 순서가 정답이다 (API.md Q15)
    history_rows = await session.execute(
        select(AgendaHistory.agenda_id, AgendaHistory.changed_at)
        .join(Agenda, Agenda.id == AgendaHistory.agenda_id)
        .where(
            Agenda.project_id == project_id,
            Agenda.is_deleted.is_(False),
            Agenda.state.in_(UNDECIDED),
        )
        .order_by(AgendaHistory.seq)
    )
    for row in history_rows:
        owner = agendas[row.agenda_id]
        owner.last_touched = max(owner.last_touched, as_utc(row.changed_at).astimezone(KST).date())
    task_rows = await session.execute(
        select(
            Task.id,
            Task.key,
            Task.title,
            Task.parent_id,
            Task.status,
            Task.owner_id,
            Task.part_id,
            Task.start,
            Task.due,
            Task.seq,
            Task.created_at,
        )
        .where(Task.project_id == project_id, Task.is_deleted.is_(False))
        .order_by(Task.seq)
    )
    tasks = {row.id: _Task(**row._asdict()) for row in task_rows}
    # 링크는 양쪽이 같은 프로젝트라 project_id 하나로 갈린다 (API.md Q13)
    link_rows = await session.execute(
        select(TaskAgendaLink.task_id, TaskAgendaLink.agenda_id).where(
            TaskAgendaLink.project_id == project_id,
            # 지운 작업의 링크는 남아 있다 — 위 tasks 에 없는 id 를 끌고 오지 않게
            TaskAgendaLink.task_id.in_(live_task_ids()),
            TaskAgendaLink.agenda_id.in_(live_agenda_ids()),
        )
    )
    links = [(row.task_id, row.agenda_id) for row in link_rows]
    return agendas, tasks, links


def _by_seq(ids: Iterable[str], tasks: dict[str, _Task]) -> list[str]:
    return sorted(ids, key=lambda task_id: tasks[task_id].seq)


async def decision_risks(
    session: AsyncSession, project_id: str, *, today: date
) -> DecisionRiskReport:
    """API(`GET .../risks`)와 챗봇 도구가 같이 부른다. 같은 데이터 · 기준이면 늘 같은 결과다."""
    await project_service.load_project(session, project_id)
    rule = await load_settings(session, project_id)
    agendas, tasks, links = await _read(session, project_id)

    children: dict[str, list[str]] = defaultdict(list)
    for task in tasks.values():
        if task.parent_id is not None:
            children[task.parent_id].append(task.id)
    for task_id, agenda_id in links:
        agendas[agenda_id].task_ids.append(task_id)

    agenda_risks: list[tuple[AgendaRisk, int]] = []
    impacts: dict[str, set[str]] = {}
    for agenda in agendas.values():
        if agenda.state not in UNDECIDED:
            continue
        linked = _by_seq(agenda.task_ids, tasks)
        blocked = [t for t in linked if tasks[t].status == "blocked"]
        waiting = [t for t in linked if tasks[t].status in ("todo", "doing")]
        impact = _impact(blocked, children, tasks)
        impacts[agenda.id] = impact
        task_dues = [
            due for t in linked if tasks[t].status != "done" and (due := tasks[t].due) is not None
        ]
        nearest = min(task_dues, default=None)
        due = agenda.due_date
        overdue_days = max((today - due).days, 0) if due is not None else 0
        idle_days = max((today - agenda.last_touched).days, 0)

        signals: list[AgendaRiskSignal] = []
        if due is not None and due < today:
            signals.append("overdue")
        elif due is not None and (due - today).days <= rule.due_soon_days:
            signals.append("dueSoon")
        if idle_days > rule.stale_days:
            signals.append("stale")
        if blocked:
            signals.append("blocking")
        if nearest is not None and (
            nearest < due if due is not None else (nearest - today).days <= rule.due_soon_days
        ):
            signals.append("decisionAfterTaskDue")
        if agenda.owner_id is None:
            signals.append("noOwner")
        if due is None and linked:
            signals.append("noDueDate")
        if not signals:
            continue

        score = sum(SIGNAL_SCORES[s] for s in signals) + min(len(impact), IMPACT_CAP)
        risk = AgendaRisk(
            agenda_id=agenda.id,
            title=agenda.title,
            state=UNDECIDED_STATE[agenda.state],
            owner_id=agenda.owner_id,
            part_id=agenda.part_id,
            due_date=due,
            overdue_days=overdue_days,
            idle_days=idle_days,
            blocked_task_ids=blocked,
            waiting_task_ids=waiting,
            impact_task_count=len(impact),
            nearest_task_due=nearest,
            signals=signals,
            score=score,
            level=_level(score, rule),
        )
        agenda_risks.append((risk, agenda.seq))
    agenda_risks.sort(key=lambda pair: (-pair[0].score, -pair[0].overdue_days, pair[1]))

    task_risks = await _task_risks(session, project_id, agendas, tasks, links, rule, today)
    test_risks = await _test_risks(session, project_id, rule, today)
    return DecisionRiskReport(
        as_of=today,
        settings=rule,
        agendas=[risk for risk, _ in agenda_risks],
        tasks=task_risks,
        tests=test_risks,
        owners=_owner_loads(agendas, tasks, impacts, task_risks, test_risks, today),
    )


def _overdue_bonus(overdue_days: int) -> int:
    """min(overdueDays, 7) ÷ 7 을 반올림 — 4일 이상 넘기면 1. 정수로만 비교한다."""
    return 1 if 2 * min(overdue_days, OVERDUE_CAP) >= OVERDUE_CAP else 0


def _in_window(moment: datetime, today: date, rule: RiskSettings) -> bool:
    """최근 churnDays 일 안 — 한국 날짜로 오늘에서 churnDays 일 전(그날 포함)부터.
    dueSoonDays 의 '안' 과 같은 셈이다."""
    return (today - kst_day(moment)).days <= rule.churn_days


@dataclass
class _Churn:
    """이력에서 센 흔들림 — 작업 · 테스트가 같이 쓴다."""

    slips: int = 0
    # 기한 줄의 흐름(첫 옛 값 → 줄마다 새 값). 비운 값(null)은 건너뛴다
    due_flow: list[str] = field(default_factory=list)
    content: int = 0
    owner: int = 0
    flips: int = 0


async def _churns(
    session: AsyncSession,
    model: type[TaskHistory] | type[TestHistory],
    project_id: str,
    ids: set[str],
    today: date,
    rule: RiskSettings,
) -> dict[str, _Churn]:
    """이력을 한 번에 읽어 셈한다. 줄 순서는 seq 다 (API.md Q15). 기한 미룸은 기간 없이 전부 센다.

    JSON 칸을 DB 마다 다르게 읽지 않으려고 파이썬에서 거른다.
    """
    if not ids:
        return {}
    parent = TaskHistory.task_id if model is TaskHistory else TestHistory.test_id
    rows = await session.execute(
        select(parent, model.changed_at, model.changes)
        .where(model.project_id == project_id, parent.in_(ids))
        .order_by(model.seq)
    )
    found: dict[str, _Churn] = defaultdict(_Churn)
    for owner_id, changed_at, changes in rows.tuples():
        churn = found[owner_id]
        recent = _in_window(changed_at, today, rule)
        fields = {str(change.get("field")) for change in changes}
        if recent and fields & set(CONTENT_FIELDS):
            churn.content += 1
        if recent and "ownerId" in fields:
            churn.owner += 1
        for change in changes:
            before, after = change.get("from"), change.get("to")
            if change.get("field") == "due":
                if not churn.due_flow and isinstance(before, str):
                    churn.due_flow.append(before)
                if isinstance(after, str):
                    churn.due_flow.append(after)
                if isinstance(before, str) and isinstance(after, str) and after > before:
                    churn.slips += 1
            elif recent and change.get("field") == "status" and (before, after) in FLIPS:
                churn.flips += 1
    return found


async def _task_risks(
    session: AsyncSession,
    project_id: str,
    agendas: dict[str, _Agenda],
    tasks: dict[str, _Task],
    links: list[tuple[str, str]],
    rule: RiskSettings,
    today: date,
) -> list[TaskRisk]:
    """작업 자체의 지연 · 흔들림 (docs/api/risk-dashboard.md '작업 리스크')."""
    live = {task_id for task_id, task in tasks.items() if task.status in OPEN_TASK_STATE}
    since = await task_service.status_since_map(session, project_id)
    churns = await _churns(session, TaskHistory, project_id, live, today, rule)
    open_agendas: dict[str, list[str]] = defaultdict(list)
    for task_id, agenda_id in links:
        if agendas[agenda_id].state in UNDECIDED:
            open_agendas[task_id].append(agenda_id)

    risks: list[tuple[TaskRisk, int]] = []
    for task_id in live:
        task = tasks[task_id]
        found = since.get(task_id)
        status_days = max((today - kst_day(found.changed_at if found else task.created_at)).days, 0)
        planned = (
            (task.due - task.start).days + 1
            if task.start is not None and task.due is not None
            else None
        )
        overdue_days = max((today - task.due).days, 0) if task.due is not None else 0
        churn = churns.get(task_id, _Churn())
        if task.status != "doing":
            long_running = False
        elif planned is not None:
            # 계획의 1.5배를 넘음 — 정수로만 비교한다(테스트 신호와 같은 셈)
            long_running = 2 * status_days > 3 * planned
        else:
            long_running = status_days > rule.stale_days
        overdue = task.due is not None and task.due < today
        hits: dict[TaskRiskSignal, bool] = {
            "overdue": overdue,
            "longBlocked": task.status == "blocked" and status_days > rule.stale_days,
            "longRunning": long_running,
            "dueSlipped": churn.slips >= rule.slip_count,
            # 기한 넘김이 먼저다 — 둘이 같이 나오지 않는다
            "notStarted": not overdue
            and task.status == "todo"
            and (
                (task.start is not None and task.start < today)
                or (task.due is not None and (task.due - today).days <= rule.due_soon_days)
            ),
            "contentChurn": churn.content >= rule.churn_count,
            "ownerChurn": churn.owner >= OWNER_CHURN_MIN,
        }
        signals = [signal for signal in TASK_SIGNAL_SCORES if hits[signal]]
        if not signals:
            continue
        score = sum(TASK_SIGNAL_SCORES[s] for s in signals) + _overdue_bonus(overdue_days)
        linked = sorted(open_agendas.get(task_id, []), key=lambda i: agendas[i].seq)
        risk = TaskRisk(
            task_id=task.id,
            key=task.key,
            title=task.title,
            status=OPEN_TASK_STATE[task.status],
            owner_id=task.owner_id,
            part_id=task.part_id,
            start=task.start,
            due=task.due,
            overdue_days=overdue_days,
            status_days=status_days,
            planned_days=planned,
            slip_count=churn.slips,
            due_flow=churn.due_flow if churn.slips else [],
            content_changes=churn.content,
            owner_changes=churn.owner,
            open_agenda_ids=linked,
            signals=signals,
            score=score,
            level=_level(score, rule),
        )
        risks.append((risk, task.seq))
    return _sorted(risks)


async def _test_risks(
    session: AsyncSession, project_id: str, rule: RiskSettings, today: date
) -> list[TestRisk]:
    """테스트 목록의 신호(`build_tests`) 그대로 + 흔들림 둘 (risk-dashboard.md '테스트 리스크').

    묶음(하위가 있는 것)은 빼고 하위가 들어간다. 성공한 테스트는 '결과 뒤집힘' 만 본다.
    """
    rows = list(
        (
            await session.scalars(
                select(TestCase).where(TestCase.project_id == project_id).order_by(TestCase.seq)
            )
        ).all()
    )
    groups = {row.parent_id for row in rows if row.parent_id is not None}
    leaves = [row for row in rows if row.id not in groups]
    if not leaves:
        return []
    built = await test_service.build_tests(session, project_id, leaves, today=today)
    churns = await _churns(
        session, TestHistory, project_id, {row.id for row in leaves}, today, rule
    )
    risks: list[tuple[TestRisk, int]] = []
    for row, out in zip(leaves, built, strict=True):
        churn = churns.get(row.id, _Churn())
        passed = out.status == "pass"
        listed = set(out.signals)
        hits: dict[TestRiskSignal, bool] = {
            "overdue": "overdue" in listed,
            "failedIdle": "failedIdle" in listed,
            "longBlocked": "longBlocked" in listed,
            "basisChanged": "basisChanged" in listed,
            "longRunning": "longRunning" in listed,
            "flaky": churn.flips >= FLIP_MIN,
            "dueSlipped": churn.slips >= rule.slip_count,
            "notStarted": "notStarted" in listed,
        }
        # 지금 성공이어도 뒤집혀 왔으면 위험 — 성공한 것은 그것만 본다
        signals = [
            signal
            for signal in TEST_SIGNAL_SCORES
            if hits[signal] and (not passed or signal == "flaky")
        ]
        if not signals:
            continue
        overdue_days = max((today - row.due).days, 0) if row.due is not None and not passed else 0
        score = sum(TEST_SIGNAL_SCORES[s] for s in signals) + _overdue_bonus(overdue_days)
        risk = TestRisk(
            test_id=row.id,
            key=row.key,
            title=row.title,
            # 모델이 CHECK 로 지키는 값이다 — 응답 모델이 한 번 더 본다
            status=cast(TestStatus, out.status),
            owner_id=row.owner_id,
            part_id=row.part_id,
            due=row.due,
            overdue_days=overdue_days,
            status_days=out.status_days,
            slip_count=churn.slips,
            flips=churn.flips,
            refs=out.refs,
            signals=signals,
            score=score,
            level=_level(score, rule),
        )
        risks.append((risk, row.seq))
    return _sorted(risks)


def _sorted[R: (TaskRisk, TestRisk)](risks: list[tuple[R, int]]) -> list[R]:
    """score ↓ → overdueDays ↓ → statusDays ↓ → 등록 순. 같은 데이터면 늘 같은 순서다."""
    risks.sort(
        key=lambda pair: (-pair[0].score, -pair[0].overdue_days, -pair[0].status_days, pair[1])
    )
    return [risk for risk, _ in risks]


def _owner_loads(
    agendas: dict[str, _Agenda],
    tasks: dict[str, _Task],
    impacts: dict[str, set[str]],
    task_risks: list[TaskRisk],
    test_risks: list[TestRisk],
    today: date,
) -> list[OwnerLoad]:
    open_agendas: dict[str | None, int] = defaultdict(int)
    overdue: dict[str | None, int] = defaultdict(int)
    blocked: dict[str | None, int] = defaultdict(int)
    impact: dict[str | None, set[str]] = defaultdict(set)
    risky_tasks: dict[str | None, int] = defaultdict(int)
    risky_tests: dict[str | None, int] = defaultdict(int)
    for agenda in agendas.values():
        if agenda.state not in UNDECIDED:
            continue
        open_agendas[agenda.owner_id] += 1
        if agenda.due_date is not None and agenda.due_date < today:
            overdue[agenda.owner_id] += 1
        impact[agenda.owner_id] |= impacts[agenda.id]
    for task in tasks.values():
        if task.status == "blocked":
            blocked[task.owner_id] += 1
    for task_risk in task_risks:
        if task_risk.level in RISKY:
            risky_tasks[task_risk.owner_id] += 1
    for test_risk in test_risks:
        if test_risk.level in RISKY:
            risky_tests[test_risk.owner_id] += 1

    loads = [
        OwnerLoad(
            member_id=member_id,
            open_agendas=open_agendas[member_id],
            overdue_agendas=overdue[member_id],
            blocked_tasks=blocked[member_id],
            blocking_impact=len(impact[member_id]),
            risky_tasks=risky_tasks[member_id],
            risky_tests=risky_tests[member_id],
        )
        for member_id in {*open_agendas, *blocked, *risky_tasks, *risky_tests}
    ]
    loads = [
        load
        for load in loads
        if load.open_agendas
        or load.overdue_agendas
        or load.blocked_tasks
        or load.blocking_impact
        or load.risky_tasks
        or load.risky_tests
    ]
    # 계약의 키 뒤에 멤버 id 를 둔다 — 같은 숫자면 늘 같은 순서로(담당자 없음은 맨 뒤)
    loads.sort(
        key=lambda load: (
            -load.blocking_impact,
            -load.overdue_agendas,
            -(load.risky_tasks + load.risky_tests),
            load.member_id is None,
            load.member_id or "",
        )
    )
    return loads


async def decision_risks_for(
    session: AsyncSession,
    project_id: str,
    *,
    today: date,
    member_id: str | None = None,
    part: str | None = None,
) -> DecisionRiskReport:
    """챗봇 도구 `get_decision_risks`. 같은 계산을 사람 · 파트로 좁힌다 — `owners` 는 그대로 둔다.
    안건 · 작업 · 테스트 모두 담당자 · 파트로 거른다.

    `part` 는 파트 id 나 이름이다 — Claude 가 파트 id 를 알 길이 없어 이름도 받는다.
    없는 · 다른 프로젝트의 멤버 · 파트는 '못 찾았다' 로 낸다(있는지조차 알리지 않는다).
    """
    report = await decision_risks(session, project_id, today=today)
    member_id = (member_id or "").strip() or None
    part = (part or "").strip() or None
    part_id = await _resolve_part(session, project_id, part) if part is not None else None
    if member_id is not None and not await _member_in(session, project_id, member_id, report):
        raise not_found("MEMBER_NOT_FOUND", "멤버를 찾을 수 없습니다.")

    def keep(owner_id: str | None, item_part: str | None) -> bool:
        return (member_id is None or owner_id == member_id) and (
            part_id is None or item_part == part_id
        )

    return report.model_copy(
        update={
            "agendas": [t for t in report.agendas if keep(t.owner_id, t.part_id)],
            "tasks": [t for t in report.tasks if keep(t.owner_id, t.part_id)],
            "tests": [t for t in report.tests if keep(t.owner_id, t.part_id)],
        }
    )


async def tool_payload(session: AsyncSession, report: DecisionRiskReport) -> dict[str, Any]:
    """챗봇 도구 결과 — 보고서에 작업 · 테스트 줄마다 담당자 · 파트 이름과 신호의 화면 말을 단다.

    id 는 남긴다 — 근거 칩([[task:ID]])을 달아야 해서다.
    """
    body: dict[str, Any] = report.model_dump(mode="json", by_alias=True)
    rows: list[TaskRisk | TestRisk] = [*report.tasks, *report.tests]
    member_ids = {t.owner_id for t in rows if t.owner_id is not None}
    part_ids = {t.part_id for t in rows if t.part_id is not None}
    names = await _names(session, Member, member_ids)
    parts = await _names(session, Part, part_ids)

    def named(row: dict[str, Any], labels: dict[Any, str]) -> None:
        owner, part = row["ownerId"], row["partId"]
        row["owner"] = NO_OWNER if owner is None else names.get(owner, UNKNOWN)
        row["part"] = COMMON_PART if part is None else parts.get(part, UNKNOWN)
        row["signalLabels"] = [labels[s] for s in row["signals"]]

    for row in body["tasks"]:
        named(row, TASK_SIGNAL_LABELS)
    for row in body["tests"]:
        named(row, TEST_SIGNAL_LABELS)
    return body


async def _names(
    session: AsyncSession, model: type[Member] | type[Part], ids: set[str]
) -> dict[str, str]:
    if not ids:
        return {}
    rows = await session.execute(select(model.id, model.name).where(model.id.in_(ids)))
    return {row.id: row.name for row in rows}


async def _resolve_part(session: AsyncSession, project_id: str, part: str) -> str:
    # 보관한 파트도 찾는다 — 지난 작업 · 안건이 아직 가리킨다
    found = await session.scalar(
        select(Part.id)
        .where(Part.project_id == project_id, or_(Part.id == part, Part.name == part))
        .order_by(Part.id != part)
        .limit(1)
    )
    if found is None:
        raise not_found("PART_NOT_FOUND", "파트를 찾을 수 없습니다.")
    return found


async def _member_in(
    session: AsyncSession, project_id: str, member_id: str, report: DecisionRiskReport
) -> bool:
    """부여된 멤버이거나, 빠졌어도 이 프로젝트의 안건 · 작업을 아직 맡고 있는 사람."""
    if await session.get(ProjectMember, (project_id, member_id)) is not None:
        return True
    owners = {t.owner_id for t in report.agendas}
    owners |= {t.owner_id for t in report.tasks} | {t.owner_id for t in report.tests}
    return member_id in owners | {o.member_id for o in report.owners}

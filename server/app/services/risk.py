"""결정 병목 리스크 — 안 정해진 안건이 막는(막을) 일을 규칙 점수로 낸다.

계약은 `docs/api/risk.md`. '집계는 프론트가 한다' 의 예외다(Q35) — 챗봇 도구가 같은 함수를 부른다.
한 프로젝트가 수백 줄 규모라 몇 번의 select 로 다 읽고 계산은 파이썬에서 한다
(`server/PLAN.md` 10단계).
`today` 를 인자로 받는다 — 검사가 날짜에 흔들리지 않게.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.errors import ApiError, not_found
from app.models import Agenda, AgendaHistory, Part, ProjectMember, RiskSetting, Task, TaskAgendaLink
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
)
from app.services import project as project_service
from app.services.access import live_agenda_ids, live_task_ids
from app.time import KST, as_utc, now

# 신호 점수는 고정이다 — 바꿀 수 있는 것은 문턱값 넷뿐이다. 순서가 곧 signals 배열의 순서다
SIGNAL_SCORES: dict[AgendaRiskSignal, int] = {
    "overdue": 3,
    "dueSoon": 1,
    "stale": 1,
    "blocking": 3,
    "decisionAfterTaskDue": 2,
    "noOwner": 1,
    "noDueDate": 1,
}
# 막는 일이 많을수록 위로 오되 그것만으로 다른 신호를 덮지 않는다
IMPACT_CAP = 3
TASK_SIGNAL_ORDER: tuple[TaskRiskSignal, ...] = (
    "decidedButBlocked",
    "blockedWithoutAgenda",
    "dueBeforeDecision",
)
UNDECIDED = ("queued", "open")
# DB 의 글자를 응답의 Literal 로 — 완료 · 결정은 여기까지 오기 전에 걸러진다
UNDECIDED_STATE: dict[str, RiskAgendaState] = {"queued": "queued", "open": "open"}
ACTIVE_STATUS: dict[str, RiskTaskStatus] = {"todo": "todo", "doing": "doing", "blocked": "blocked"}


def default_settings() -> RiskSettings:
    return RiskSettings(
        due_soon_days=app_settings.risk_due_soon_days,
        stale_days=app_settings.risk_stale_days,
        high_score=app_settings.risk_high_score,
        medium_score=app_settings.risk_medium_score,
    )


async def load_settings(session: AsyncSession, project_id: str) -> RiskSettings:
    row = await session.get(RiskSetting, project_id)
    return default_settings() if row is None else RiskSettings.model_validate(row)


async def save_settings(
    session: AsyncSession, project_id: str, payload: RiskSettings
) -> RiskSettings:
    """네 값을 통째로 덮는다(upsert). 부분 수정은 없다."""
    if payload.high_score <= payload.medium_score:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "요청 값이 올바르지 않습니다.",
            {"highScore": "medium 점수보다 커야 합니다."},
        )
    row = await session.get(RiskSetting, project_id)
    if row is None:
        row = RiskSetting(project_id=project_id)
        session.add(row)
    row.due_soon_days = payload.due_soon_days
    row.stale_days = payload.stale_days
    row.high_score = payload.high_score
    row.medium_score = payload.medium_score
    row.updated_at = now()
    await session.commit()
    return RiskSettings.model_validate(row)


@dataclass
class _Task:
    id: str
    key: str
    title: str
    parent_id: str | None
    status: str
    owner_id: str | None
    part_id: str | None
    due: date | None
    seq: int


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
            Task.due,
            Task.seq,
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
    task_agendas: dict[str, list[str]] = defaultdict(list)
    for task_id, agenda_id in links:
        agendas[agenda_id].task_ids.append(task_id)
        task_agendas[task_id].append(agenda_id)

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

    return DecisionRiskReport(
        as_of=today,
        settings=rule,
        agendas=[risk for risk, _ in agenda_risks],
        tasks=_task_risks(agendas, tasks, task_agendas, rule, today),
        owners=_owner_loads(agendas, tasks, impacts, today),
    )


def _task_signal(
    task: _Task, linked: list[_Agenda], rule: RiskSettings, today: date
) -> tuple[TaskRiskSignal, list[str]] | None:
    """앞의 신호 하나만 낸다 — decidedButBlocked → blockedWithoutAgenda → dueBeforeDecision."""
    if task.status == "blocked":
        if not linked:
            return "blockedWithoutAgenda", []
        if all(t.state == "decided" for t in linked):
            return "decidedButBlocked", [t.id for t in linked]
    due = task.due
    if due is None:
        return None
    late = [
        t.id
        for t in linked
        if t.state in UNDECIDED and _decision_late(t.due_date, due, rule, today)
    ]
    return ("dueBeforeDecision", late) if late else None


def _decision_late(
    decision_due: date | None, task_due: date, rule: RiskSettings, today: date
) -> bool:
    """결정이 작업 기한에 못 댄다. 안건 기한이 없으면 안건 쪽 decisionAfterTaskDue 와 같은 잣대 —
    작업 기한이 dueSoonDays 안(이미 지난 것 포함)이면 늦은 것으로 본다."""
    if decision_due is None:
        return (task_due - today).days <= rule.due_soon_days
    return decision_due > task_due or decision_due < today


def _task_risks(
    agendas: dict[str, _Agenda],
    tasks: dict[str, _Task],
    task_agendas: dict[str, list[str]],
    rule: RiskSettings,
    today: date,
) -> list[TaskRisk]:
    found: list[tuple[TaskRisk, int]] = []
    for task in tasks.values():
        if task.status == "done":
            continue
        linked = sorted((agendas[t] for t in task_agendas.get(task.id, ())), key=lambda t: t.seq)
        hit = _task_signal(task, linked, rule, today)
        if hit is None:
            continue
        signal, agenda_ids = hit
        risk = TaskRisk(
            task_id=task.id,
            key=task.key,
            title=task.title,
            status=ACTIVE_STATUS[task.status],
            owner_id=task.owner_id,
            part_id=task.part_id,
            due=task.due,
            agenda_ids=agenda_ids,
            signal=signal,
        )
        found.append((risk, task.seq))
    # 기한 없는 것은 같은 신호 안에서 뒤로
    found.sort(
        key=lambda pair: (
            TASK_SIGNAL_ORDER.index(pair[0].signal),
            pair[0].due is None,
            pair[0].due or date.min,
            pair[1],
        )
    )
    return [risk for risk, _ in found]


def _owner_loads(
    agendas: dict[str, _Agenda],
    tasks: dict[str, _Task],
    impacts: dict[str, set[str]],
    today: date,
) -> list[OwnerLoad]:
    open_agendas: dict[str | None, int] = defaultdict(int)
    overdue: dict[str | None, int] = defaultdict(int)
    blocked: dict[str | None, int] = defaultdict(int)
    impact: dict[str | None, set[str]] = defaultdict(set)
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

    loads = [
        OwnerLoad(
            member_id=member_id,
            open_agendas=open_agendas[member_id],
            overdue_agendas=overdue[member_id],
            blocked_tasks=blocked[member_id],
            blocking_impact=len(impact[member_id]),
        )
        for member_id in {*open_agendas, *blocked}
    ]
    loads = [
        load
        for load in loads
        if load.open_agendas or load.overdue_agendas or load.blocked_tasks or load.blocking_impact
    ]
    # 계약의 두 키 뒤에 멤버 id 를 둔다 — 같은 숫자면 늘 같은 순서로(담당자 없음은 맨 뒤)
    loads.sort(
        key=lambda load: (
            -load.blocking_impact,
            -load.overdue_agendas,
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
        }
    )


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
    owners = {t.owner_id for t in report.agendas} | {t.owner_id for t in report.tasks}
    return member_id in owners | {o.member_id for o in report.owners}

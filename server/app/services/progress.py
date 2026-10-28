"""프로젝트 진행 — 지난 7일을 규칙으로 센다 (`docs/api/report.md` 'ProgressFacts').

판정은 여기 한 곳이다 — 리포트와 나중의 챗봇 도구가 같이 부른다.
같은 데이터면 같은 신호가 나와야 믿는다.
`today` 를 인자로 받는다 — 검사가 날짜에 흔들리지 않게. 날 수는 KST 날짜끼리 뺀다.
한 프로젝트가 수백 줄 규모라 몇 번의 select 로 다 읽고 계산은 파이썬에서 한다(리스크와 같다).
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Entry,
    ProjectReport,
    Task,
    TaskLine,
    TaskLog,
    TaskThreadLink,
    Thread,
)
from app.schemas.report import (
    DecisionFacts,
    PersonProgress,
    PreviousReport,
    ProgressCounts,
    ProgressFacts,
    TaskAttention,
    TaskAttentionSignal,
    TaskPriority,
    TaskWeight,
)
from app.schemas.risk import DecisionRiskReport, RiskSettings
from app.services import risk as risk_service
from app.services import task as task_service
from app.time import KST, as_utc

PERIOD_DAYS = 7
ATTENTION_MAX = 30
RISKY_MAX = 10
# 신호 점수는 고정이다. 순서가 곧 signals 배열의 순서다(계약의 타입 순서)
SIGNAL_SCORES: dict[TaskAttentionSignal, int] = {
    "longRunning": 2,
    "longBlocked": 2,
    "overdue": 2,
    "notStarted": 1,
    "decidedButBlocked": 3,
}
PRIORITIES: dict[str, TaskPriority] = {"low": "low", "normal": "normal", "high": "high"}


def kst_day(moment: datetime) -> date:
    return as_utc(moment).astimezone(KST).date()


def done_rate(done: int, total: int) -> float:
    """소수 셋째 자리에서 반올림(둘째 자리까지). 반은 올린다 — 화면의 Math.round 와 같게."""
    if total == 0:
        return 0.0
    rate = (Decimal(done) / Decimal(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(rate)


@dataclass
class _Task:
    id: str
    parent_id: str | None
    status: str
    owner_id: str | None
    start: date | None
    due: date | None
    priority: str
    created_at: datetime
    seq: int


@dataclass
class _Graph:
    tasks: dict[str, _Task]
    children: dict[str, list[str]]

    def by_seq(self, ids: Iterable[str]) -> list[str]:
        return sorted(ids, key=lambda task_id: self.tasks[task_id].seq)

    def open(self, task_id: str) -> bool:
        return self.tasks[task_id].status != "done"

    def open_descendants(self, task_id: str) -> int:
        seen: set[str] = set()
        stack = list(self.children.get(task_id, ()))
        while stack:
            child = stack.pop()
            if child in seen:
                continue
            seen.add(child)
            stack.extend(self.children.get(child, ()))
        return sum(1 for child in seen if self.open(child))


async def _read_graph(session: AsyncSession, project_id: str) -> _Graph:
    rows = await session.execute(
        select(
            Task.id,
            Task.parent_id,
            Task.status,
            Task.owner_id,
            Task.start,
            Task.due,
            Task.priority,
            Task.created_at,
            Task.seq,
        )
        .where(Task.project_id == project_id)
        .order_by(Task.seq)
    )
    tasks = {row.id: _Task(**row._asdict()) for row in rows}
    children: dict[str, list[str]] = defaultdict(list)
    for task in tasks.values():
        if task.parent_id is not None and task.parent_id in tasks:
            children[task.parent_id].append(task.id)
    return _Graph(tasks=tasks, children=children)


async def _lines(session: AsyncSession, project_id: str) -> dict[str, tuple[int, int]]:
    """작업마다 (안 끝난 체크 줄, 체크 줄 전체). 불릿은 세지 않는다."""
    rows = await session.execute(
        select(TaskLine.task_id, TaskLine.done, func.count())
        .join(Task, Task.id == TaskLine.task_id)
        .where(Task.project_id == project_id, TaskLine.kind == "check")
        .group_by(TaskLine.task_id, TaskLine.done)
    )
    found: dict[str, tuple[int, int]] = {}
    for task_id, done, count in rows.tuples():
        open_lines, total = found.get(task_id, (0, 0))
        found[task_id] = (open_lines + (0 if done else count), total + count)
    return found


async def _thread_counts(session: AsyncSession, project_id: str) -> dict[str, int]:
    rows = await session.execute(
        select(TaskThreadLink.task_id, func.count())
        .where(TaskThreadLink.project_id == project_id)
        .group_by(TaskThreadLink.task_id)
    )
    return dict(rows.tuples().all())


async def _period_logs(
    session: AsyncSession, project_id: str, start: date, end: date
) -> tuple[set[str], set[str]]:
    """기간 안에 완료가 된 · 진행 중이 된 작업. backfill 줄은 바뀐 때가 아니라 '적어도 이때부터'
    라서 세지 않는다."""
    rows = await session.execute(
        select(TaskLog.task_id, TaskLog.to_status, TaskLog.changed_at).where(
            TaskLog.project_id == project_id,
            TaskLog.backfilled.is_(False),
            TaskLog.to_status.in_(("done", "doing")),
        )
    )
    completed: set[str] = set()
    started: set[str] = set()
    for task_id, to_status, changed_at in rows.tuples():
        if not start <= kst_day(changed_at) <= end:
            continue
        (completed if to_status == "done" else started).add(task_id)
    return completed, started


async def _period_decisions(
    session: AsyncSession, project_id: str, start: date, end: date
) -> tuple[list[str], list[str]]:
    rows = await session.execute(
        select(Entry.thread_id, Entry.kind, Entry.created_at, Thread.seq)
        .join(Thread, Thread.id == Entry.thread_id)
        .where(Thread.project_id == project_id, Entry.kind.in_(("decide", "change", "defer")))
    )
    decided: dict[str, int] = {}
    deferred: dict[str, int] = {}
    for thread_id, kind, created_at, seq in rows.tuples():
        if not start <= kst_day(created_at) <= end:
            continue
        (deferred if kind == "defer" else decided)[thread_id] = seq
    return sorted(decided, key=decided.__getitem__), sorted(deferred, key=deferred.__getitem__)


async def _previous(session: AsyncSession, project_id: str) -> PreviousReport | None:
    row = (
        await session.execute(
            select(ProjectReport.id, ProjectReport.period_end, ProjectReport.facts)
            .where(ProjectReport.project_id == project_id)
            .order_by(ProjectReport.seq.desc())
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        return None
    progress = row.facts.get("progress", {})
    return PreviousReport(
        report_id=row.id,
        period_end=row.period_end,
        done_rate=float(progress.get("doneRate", 0)),
        blocked=int(progress.get("blocked", 0)),
    )


def _signals(
    task: _Task,
    *,
    status_days: int,
    planned_days: int | None,
    decided_but_blocked: bool,
    rule: RiskSettings,
    today: date,
) -> list[TaskAttentionSignal]:
    overdue = task.due is not None and task.due < today
    start_passed = task.status == "todo" and task.start is not None and task.start < today
    due_soon = (
        task.status == "todo"
        and task.due is not None
        and ((task.due - today).days <= rule.due_soon_days)
    )
    if task.status != "doing":
        long_running = False
    elif planned_days is not None:
        # 계획의 1.5배를 넘음 — 정수로만 비교한다
        long_running = 2 * status_days > 3 * planned_days
    else:
        long_running = status_days > rule.stale_days
    long_blocked = task.status == "blocked" and status_days > rule.stale_days

    hits: dict[TaskAttentionSignal, bool] = {
        "longRunning": long_running,
        "longBlocked": long_blocked,
        "overdue": overdue,
        "notStarted": start_passed or due_soon,
        "decidedButBlocked": decided_but_blocked,
    }
    return [signal for signal in SIGNAL_SCORES if hits[signal]]


async def progress_facts(session: AsyncSession, project_id: str, *, today: date) -> ProgressFacts:
    """같은 데이터 · 기준 · 날이면 늘 같은 결과다."""
    facts, _ = await progress_with_risks(session, project_id, today=today)
    return facts


async def progress_with_risks(
    session: AsyncSession, project_id: str, *, today: date
) -> tuple[ProgressFacts, DecisionRiskReport]:
    """리포트는 병목 안건의 등급 · 신호도 Claude 에 넣는다 — 리스크를 두 번 세지 않게 같이 낸다."""
    # 프로젝트가 있는지 · 기준 · 결정 병목을 같이 얻는다 — 문턱값을 두 벌 두지 않는다
    risks = await risk_service.decision_risks(session, project_id, today=today)
    rule = risks.settings
    start = today - timedelta(days=PERIOD_DAYS - 1)

    graph = await _read_graph(session, project_id)
    tasks = graph.tasks
    lines = await _lines(session, project_id)
    thread_counts = await _thread_counts(session, project_id)
    since_map = await task_service.status_since_map(session, project_id)
    completed, started = await _period_logs(session, project_id, start, today)
    decided, deferred = await _period_decisions(session, project_id, start, today)
    previous = await _previous(session, project_id)
    decided_but_blocked = {t.task_id for t in risks.tasks if t.signal == "decidedButBlocked"}

    counts = {status: 0 for status in ("todo", "doing", "blocked", "done")}
    for task in tasks.values():
        counts[task.status] += 1

    attention: list[tuple[TaskAttention, _Task]] = []
    for task in tasks.values():
        if task.status == "done":
            continue
        changed_at, backfilled = since_map.get(task.id) or (task.created_at, True)
        status_days = max((today - kst_day(changed_at)).days, 0)
        planned = (
            (task.due - task.start).days + 1
            if task.start is not None and task.due is not None
            else None
        )
        signals = _signals(
            task,
            status_days=status_days,
            planned_days=planned,
            decided_but_blocked=task.id in decided_but_blocked,
            rule=rule,
            today=today,
        )
        if not signals:
            continue
        open_lines, total_lines = lines.get(task.id, (0, 0))
        score = sum(SIGNAL_SCORES[s] for s in signals)
        item = TaskAttention(
            task_id=task.id,
            signals=list(signals),
            status_days=status_days,
            status_since_backfill=backfilled,
            planned_days=planned,
            weight=TaskWeight(
                open_children=graph.open_descendants(task.id),
                open_lines=open_lines,
                total_lines=total_lines,
                thread_count=thread_counts.get(task.id, 0),
                priority=PRIORITIES.get(task.priority, "normal"),
            ),
            score=score,
        )
        attention.append((item, task))
    # 점수 → 기한 이른 순(없으면 뒤) → 등록 순
    attention.sort(
        key=lambda pair: (
            -pair[0].score,
            pair[1].due is None,
            pair[1].due or date.min,
            pair[1].seq,
        )
    )
    picked = [item for item, _ in attention[:ATTENTION_MAX]]

    facts = ProgressFacts(
        period_start=start,
        period_end=today,
        settings=rule,
        progress=ProgressCounts(
            todo=counts["todo"],
            doing=counts["doing"],
            blocked=counts["blocked"],
            done=counts["done"],
            done_rate=done_rate(counts["done"], len(tasks)),
            completed_task_ids=graph.by_seq(completed & tasks.keys()),
            started_task_ids=graph.by_seq(started & tasks.keys()),
            created_task_ids=[
                t.id for t in tasks.values() if start <= kst_day(t.created_at) <= today
            ],
        ),
        previous=previous,
        decisions=DecisionFacts(
            decided_thread_ids=decided,
            deferred_thread_ids=deferred,
            risky_thread_ids=[t.thread_id for t in risks.threads if t.level in ("high", "medium")][
                :RISKY_MAX
            ],
        ),
        attention=picked,
        people=_people(tasks, completed, picked, today),
    )
    return facts, risks


def _people(
    tasks: dict[str, _Task], completed: set[str], attention: list[TaskAttention], today: date
) -> list[PersonProgress]:
    """담당 작업이 하나라도 있는 사람만.

    손쓸 작업이 몰린 사람이 위로 → 멤버 id 순, 담당자 없음은 뒤.
    목업(`web/src/lib/progress.ts`)과 같은 순서다.
    """
    owned: dict[str | None, list[_Task]] = defaultdict(list)
    for task in tasks.values():
        owned[task.owner_id].append(task)
    picked = [item.task_id for item in attention]
    people = [
        PersonProgress(
            member_id=member_id,
            doing=sum(1 for t in rows if t.status == "doing"),
            blocked=sum(1 for t in rows if t.status == "blocked"),
            overdue=sum(
                1 for t in rows if t.status != "done" and t.due is not None and t.due < today
            ),
            completed=sum(1 for t in rows if t.id in completed),
            attention_task_ids=[i for i in picked if tasks[i].owner_id == member_id],
        )
        for member_id, rows in owned.items()
    ]
    people.sort(key=lambda p: (-len(p.attention_task_ids), p.member_id is None, p.member_id or ""))
    return people

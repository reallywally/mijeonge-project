from datetime import date, datetime
from typing import Literal

from app.schemas.base import Schema, Utc
from app.schemas.chat import ChatRef, DeltaEvent, ErrorEvent
from app.schemas.risk import RiskSettings

TaskAttentionSignal = Literal[
    "waitingOnPredecessor",
    "lateBlocker",
    "longRunning",
    "longBlocked",
    "overdue",
    "notStarted",
    "decidedButBlocked",
]
TaskPriority = Literal["low", "normal", "high"]


class ProgressCounts(Schema):
    todo: int
    doing: int
    blocked: int
    done: int
    done_rate: float
    completed_task_ids: list[str]
    started_task_ids: list[str]
    created_task_ids: list[str]


class PreviousReport(Schema):
    report_id: str
    period_end: date
    done_rate: float
    blocked: int


class DecisionFacts(Schema):
    decided_thread_ids: list[str]
    deferred_thread_ids: list[str]
    risky_thread_ids: list[str]


class TaskWeight(Schema):
    open_lines: int
    total_lines: int
    thread_count: int
    priority: TaskPriority


class TaskAttention(Schema):
    task_id: str
    signals: list[TaskAttentionSignal]
    status_days: int
    status_since_backfill: bool
    planned_days: int | None
    waiting_on_task_ids: list[str]
    blocking_task_ids: list[str]
    weight: TaskWeight
    score: int


class PersonProgress(Schema):
    # null 은 '담당자 없음'
    member_id: str | None
    doing: int
    blocked: int
    overdue: int
    completed: int
    attention_task_ids: list[str]


class ProgressFacts(Schema):
    """docs/api/report.md 'ProgressFacts'. 저장할 때도 이 모양(camelCase) 그대로 jsonb 에 넣는다."""

    period_start: date
    period_end: date
    settings: RiskSettings
    progress: ProgressCounts
    previous: PreviousReport | None
    decisions: DecisionFacts
    attention: list[TaskAttention]
    people: list[PersonProgress]


class ReportItem(Schema):
    id: str
    project_id: str
    period_start: date
    period_end: date
    created_by: str
    created_at: Utc
    done_rate: float
    attention_count: int


class Report(ReportItem):
    facts: ProgressFacts
    body: str


# 아래 넷이 만드는 스트림의 data 다. event 줄과 같은 값을 type 에도 싣는다
# (delta · error 는 챗봇의 것을 그대로 쓴다)


class ReportFactsEvent(Schema):
    type: Literal["facts"] = "facts"
    facts: ProgressFacts


class ReportDoneEvent(Schema):
    type: Literal["done"] = "done"
    report: ReportItem
    refs: list[ChatRef]


ReportEvent = ReportFactsEvent | DeltaEvent | ReportDoneEvent | ErrorEvent


def report_item(
    *,
    id_: str,
    project_id: str,
    facts: ProgressFacts,
    created_by: str,
    created_at: datetime,
) -> ReportItem:
    """목록에 찍을 숫자는 facts 에서 — 따로 열을 두지 않는다."""
    return ReportItem(
        id=id_,
        project_id=project_id,
        period_start=facts.period_start,
        period_end=facts.period_end,
        created_by=created_by,
        created_at=created_at,
        done_rate=facts.progress.done_rate,
        attention_count=len(facts.attention),
    )

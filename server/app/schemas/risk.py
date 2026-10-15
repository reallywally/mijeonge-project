from datetime import date
from typing import Annotated, Literal

from pydantic import Field

from app.models.risk import RISK_RANGES
from app.schemas.base import Schema

ThreadRiskSignal = Literal[
    "overdue",
    "dueSoon",
    "deferredRepeatedly",
    "stale",
    "blocking",
    "decisionAfterTaskDue",
    "noOwner",
    "noDueDate",
]
TaskRiskSignal = Literal["decidedButBlocked", "blockedWithoutThread", "dueBeforeDecision"]
RiskLevel = Literal["high", "medium", "low"]
RiskThreadState = Literal["queued", "open"]
RiskTaskStatus = Literal["todo", "doing", "blocked"]


def _bounded(column: str) -> object:
    low, high = RISK_RANGES[column]
    # strict — "3" · 3.0 · true 를 정수로 받아 주지 않는다 (docs/api/risk.md '정수가 아니면 422')
    return Field(strict=True, ge=low, le=high)


class RiskSettings(Schema):
    """문턱값 다섯. PUT 은 다섯 값을 통째로 받는다 — 빠진 키는 422 다.

    `high_score > medium_score` 는 둘을 같이 봐야 해서 서비스가 본다 —
    detail 키를 `highScore` 로 짚으려고.
    """

    due_soon_days: Annotated[int, _bounded("due_soon_days")]
    defer_count: Annotated[int, _bounded("defer_count")]
    stale_days: Annotated[int, _bounded("stale_days")]
    high_score: Annotated[int, _bounded("high_score")]
    medium_score: Annotated[int, _bounded("medium_score")]


class ThreadRisk(Schema):
    thread_id: str
    title: str
    state: RiskThreadState
    owner_id: str | None
    part_id: str | None
    due_date: date | None
    overdue_days: int
    defer_count: int
    last_defer_note: str
    idle_days: int
    blocked_task_ids: list[str]
    waiting_task_ids: list[str]
    impact_task_count: int
    nearest_task_due: date | None
    signals: list[ThreadRiskSignal]
    score: int
    level: RiskLevel


class TaskRisk(Schema):
    task_id: str
    key: str
    title: str
    status: RiskTaskStatus
    owner_id: str | None
    part_id: str | None
    due: date | None
    thread_ids: list[str]
    signal: TaskRiskSignal


class OwnerLoad(Schema):
    # null 은 '담당자 없음'
    member_id: str | None
    open_threads: int
    overdue_threads: int
    blocked_tasks: int
    blocking_impact: int


class DecisionRiskReport(Schema):
    as_of: date
    settings: RiskSettings
    threads: list[ThreadRisk]
    tasks: list[TaskRisk]
    owners: list[OwnerLoad]


# AI 요약이 한 번에 받는 줄 수 — 화면 한 장에 보이는 만큼이다 (docs/api/risk.md 'AI 요약')
SUMMARY_IDS_MAX = 100


class RiskSummaryInput(Schema):
    """POST .../risks/summary. 화면에 지금 보이는 줄 — 키는 둘 다 있어야 한다(빈 배열은 된다)."""

    thread_ids: list[str] = Field(max_length=SUMMARY_IDS_MAX)
    task_ids: list[str] = Field(max_length=SUMMARY_IDS_MAX)

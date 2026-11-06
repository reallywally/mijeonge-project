from datetime import date
from typing import Annotated, Literal

from pydantic import Field

from app.models.risk import RISK_RANGES
from app.schemas.base import Schema
from app.schemas.test import TestRefOut, TestStatus

AgendaRiskSignal = Literal[
    "overdue",
    "dueSoon",
    "stale",
    "blocking",
    "decisionAfterTaskDue",
    "noOwner",
    "noDueDate",
]
# 작업 · 테스트 리스크 (docs/api/risk-dashboard.md, 2026-11-06). 순서가 곧 signals 배열의 순서다
TaskRiskSignal = Literal[
    "overdue",
    "longBlocked",
    "longRunning",
    "dueSlipped",
    "notStarted",
    "contentChurn",
    "ownerChurn",
]
TestRiskSignal = Literal[
    "overdue",
    "failedIdle",
    "longBlocked",
    "basisChanged",
    "longRunning",
    "flaky",
    "dueSlipped",
    "notStarted",
]
RiskLevel = Literal["high", "medium", "low"]
RiskAgendaState = Literal["queued", "open"]
RiskTaskStatus = Literal["todo", "doing", "blocked"]


def _bounded(column: str) -> object:
    low, high = RISK_RANGES[column]
    # strict — "3" · 3.0 · true 를 정수로 받아 주지 않는다 (docs/api/risk.md '정수가 아니면 422')
    return Field(strict=True, ge=low, le=high)


class RiskSettings(Schema):
    """문턱값 일곱. PUT 은 일곱 값을 통째로 받는다 — 빠진 키는 422 다.

    `high_score > medium_score` 는 둘을 같이 봐야 해서 서비스가 본다 —
    detail 키를 `highScore` 로 짚으려고.
    """

    due_soon_days: Annotated[int, _bounded("due_soon_days")]
    stale_days: Annotated[int, _bounded("stale_days")]
    high_score: Annotated[int, _bounded("high_score")]
    medium_score: Annotated[int, _bounded("medium_score")]
    # 흔들림 기준 (docs/api/risk-dashboard.md '기준')
    churn_days: Annotated[int, _bounded("churn_days")]
    churn_count: Annotated[int, _bounded("churn_count")]
    slip_count: Annotated[int, _bounded("slip_count")]


class AgendaRisk(Schema):
    agenda_id: str
    title: str
    state: RiskAgendaState
    owner_id: str | None
    part_id: str | None
    due_date: date | None
    overdue_days: int
    idle_days: int
    blocked_task_ids: list[str]
    waiting_task_ids: list[str]
    impact_task_count: int
    nearest_task_due: date | None
    signals: list[AgendaRiskSignal]
    score: int
    level: RiskLevel


class TaskRisk(Schema):
    """작업 자체의 지연 · 흔들림 — 2026-11-05 에 걷은 '안건과 어긋난 작업' 과 이름만 같다."""

    task_id: str
    key: str
    title: str
    status: RiskTaskStatus
    owner_id: str | None
    part_id: str | None
    start: date | None
    due: date | None
    overdue_days: int
    status_days: int
    planned_days: int | None
    slip_count: int
    due_flow: list[str]
    content_changes: int
    owner_changes: int
    open_agenda_ids: list[str]
    signals: list[TaskRiskSignal]
    score: int
    level: RiskLevel


class TestRisk(Schema):
    __test__ = False  # pytest 가 검사 클래스로 모으지 않게

    test_id: str
    key: str
    title: str
    status: TestStatus
    owner_id: str | None
    part_id: str | None
    due: date | None
    overdue_days: int
    status_days: int
    slip_count: int
    flips: int
    refs: list[TestRefOut]
    signals: list[TestRiskSignal]
    score: int
    level: RiskLevel


class OwnerLoad(Schema):
    # null 은 '담당자 없음'
    member_id: str | None
    open_agendas: int
    overdue_agendas: int
    blocked_tasks: int
    blocking_impact: int
    # 맡은 작업 · 테스트 중 리스크 high · medium 수 (2026-11-06)
    risky_tasks: int
    risky_tests: int


class DecisionRiskReport(Schema):
    as_of: date
    settings: RiskSettings
    agendas: list[AgendaRisk]
    tasks: list[TaskRisk]
    tests: list[TestRisk]
    owners: list[OwnerLoad]


# AI 요약이 한 번에 받는 줄 수 — 화면 한 장에 보이는 만큼이다 (docs/api/risk.md 'AI 요약')
SUMMARY_IDS_MAX = 100


class RiskSummaryInput(Schema):
    """POST .../risks/summary. 화면에 지금 보이는 줄 — `agendaIds` 키는 있어야 한다(빈 배열은 된다).

    `taskIds` · `testIds` 는 2026-11-06 에 더했다 — 옛 화면이 안 보내면 `[]` 로 본다.
    """

    agenda_ids: list[str] = Field(max_length=SUMMARY_IDS_MAX)
    task_ids: list[str] = Field(default_factory=list, max_length=SUMMARY_IDS_MAX)
    test_ids: list[str] = Field(default_factory=list, max_length=SUMMARY_IDS_MAX)

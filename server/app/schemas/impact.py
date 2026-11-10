from typing import Any, Literal

from pydantic import SerializerFunctionWrapHandler, model_serializer

from app.schemas.base import Schema, Utc
from app.schemas.task import TaskLineKindIn, TaskOut
from app.schemas.test import TestCaseOut

ImpactVerdict = Literal["update", "check", "ok"]
ConflictVerdict = Literal["conflict", "check"]
# 진행 한 줄의 이름 — 앞 둘은 서버가 근거를 모은 차례, 마지막이 Claude 의 도구다
ImpactToolName = Literal["read_tasks", "compare_decisions", "propose_impact"]

# 고친 안이 아닌 줄(check · ok)과 안 바꾸는 칸은 키째 없다 — null 로 내지 않는다
_FIX_KEYS = ("title", "body", "content", "testData", "test_data")


def _drop_unset_fixes(data: Any) -> Any:
    if isinstance(data, dict):
        for key in _FIX_KEYS:
            if key in data and data[key] is None:
                del data[key]
    return data


class ImpactLine(Schema):
    """작업 본문 한 줄 — PATCH body 와 같은 모양에서 id 만 없다."""

    kind: TaskLineKindIn
    text: str
    done: bool = False
    level: int = 0


class ImpactTaskBefore(Schema):
    title: str
    body: list[ImpactLine]


class ImpactTask(Schema):
    task_id: str
    verdict: ImpactVerdict
    reason: str
    # update 일 때만 — 바꿀 칸만
    title: str | None = None
    body: list[ImpactLine] | None = None
    # 분석 때의 값. 서버가 DB 에서 찍는다
    before: ImpactTaskBefore
    applied_at: Utc | None = None

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return _drop_unset_fixes(handler(self))  # type: ignore[no-any-return]


class ImpactTestBefore(Schema):
    title: str
    content: str
    test_data: str


class ImpactTest(Schema):
    test_id: str
    verdict: ImpactVerdict
    reason: str
    title: str | None = None
    content: str | None = None
    test_data: str | None = None
    before: ImpactTestBefore
    applied_at: Utc | None = None

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return _drop_unset_fixes(handler(self))  # type: ignore[no-any-return]


class ImpactConflict(Schema):
    agenda_id: str
    verdict: ConflictVerdict
    reason: str
    # 분석 때 그 안건의 결정내용
    decision: str


class AgendaImpactOut(Schema):
    id: str
    project_id: str
    agenda_id: str
    # 지금 agenda.decisionRev 와 다르면 '이전 판 분석'
    decision_rev: int
    decision_before: str | None
    decision_after: str
    summary: str
    tasks: list[ImpactTask]
    tests: list[ImpactTest]
    conflicts: list[ImpactConflict]
    created_by: str | None
    created_at: Utc


class AgendaImpactState(Schema):
    latest: AgendaImpactOut | None
    # AI 없이 지금 센 것 — 상한 없이 다 센다
    task_count: int
    test_count: int
    decided_agenda_count: int


# --- Claude 가 propose_impact 로 내는 모양. 판정 · 고친 안만 — before 는 서버가 붙인다 ---


class ProposedImpactTask(Schema):
    task_id: str
    verdict: ImpactVerdict
    reason: str
    title: str | None = None
    body: list[ImpactLine] | None = None


class ProposedImpactTest(Schema):
    test_id: str
    verdict: ImpactVerdict
    reason: str
    title: str | None = None
    content: str | None = None
    test_data: str | None = None


class ProposedImpactConflict(Schema):
    agenda_id: str
    verdict: ConflictVerdict
    reason: str


class ProposedImpact(Schema):
    summary: str
    tasks: list[ProposedImpactTask] = []
    tests: list[ProposedImpactTest] = []
    conflicts: list[ProposedImpactConflict] = []


# --- 반영 ---


class ImpactApplyTask(Schema):
    task_id: str
    # 안 보내거나 null 이면 그 칸은 그대로다
    title: str | None = None
    body: list[ImpactLine] | None = None


class ImpactApplyTest(Schema):
    test_id: str
    title: str | None = None
    content: str | None = None
    test_data: str | None = None


class ImpactApplyInput(Schema):
    tasks: list[ImpactApplyTask] = []
    tests: list[ImpactApplyTest] = []


class ImpactApplyResult(Schema):
    # 요청 순서
    tasks: list[TaskOut]
    tests: list[TestCaseOut]
    # appliedAt 이 찍힌 뒤의 분석
    impact: AgendaImpactOut


# 아래 넷이 SSE 의 data 다. event 줄과 같은 값을 type 에도 싣는다


class ImpactToolEvent(Schema):
    type: Literal["tool"] = "tool"
    name: ImpactToolName
    label: str


class ImpactResultEvent(Schema):
    """결과 — 꼭 한 번, done 보다 먼저. 이미 남긴 것이라 id 가 있다."""

    type: Literal["impact"] = "impact"
    impact: AgendaImpactOut


class ImpactDoneEvent(Schema):
    type: Literal["done"] = "done"


class ImpactErrorEvent(Schema):
    type: Literal["error"] = "error"
    code: str
    message: str


ImpactEvent = ImpactToolEvent | ImpactResultEvent | ImpactDoneEvent | ImpactErrorEvent

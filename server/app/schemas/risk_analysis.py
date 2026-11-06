from datetime import date
from typing import Annotated, Literal

from pydantic import (
    SerializationInfo,
    SerializerFunctionWrapHandler,
    StringConstraints,
    model_serializer,
)

from app.models.risk_analysis import ANALYSIS_TITLE_MAX
from app.schemas.base import Schema, Utc
from app.schemas.chat import ChatRef, DoneEvent
from app.schemas.risk import RiskLevel, RiskSettings

# 게시판 한 쪽 — 기본 50, 최대 200 (docs/api/risk-analysis.md '엔드포인트')
ANALYSES_LIMIT = 50
ANALYSES_LIMIT_MAX = 200


class RiskSummaryDoneEvent(DoneEvent):
    """risks/summary 의 done — Claude 를 불러 임시로 남겼을 때만 이것이 나간다.

    안 남겼으면 키째 없어야 해서(`analysisId?`) null 칸 대신 챗봇과 같은 `DoneEvent` 를 낸다.
    """

    type: Literal["done"] = "done"
    analysis_id: str


class AnalyzedAgenda(Schema):
    """그때의 리스크 줄 한 줄 — 스냅샷이라 지금 값이 아니다."""

    agenda_id: str
    # 안건에는 아직 키가 없다 — 지금은 늘 null
    key: str | None
    title: str
    level: RiskLevel
    score: int
    signals: list[str]
    owner_name: str | None


class AnalyzedTask(Schema):
    """그때의 작업 리스크 줄 (risk-dashboard.md, 2026-11-06)."""

    task_id: str
    key: str
    title: str
    level: RiskLevel
    score: int
    signals: list[str]
    owner_name: str | None


class AnalyzedTest(Schema):
    """그때의 테스트 리스크 줄 (risk-dashboard.md, 2026-11-06)."""

    __test__ = False  # pytest 가 검사 클래스로 모으지 않게

    test_id: str
    key: str
    title: str
    level: RiskLevel
    score: int
    signals: list[str]
    owner_name: str | None


RiskKind = Literal["agenda", "task", "test"]


class ComparedRef(Schema):
    """지난 분석 대비의 한 줄 — 종류를 단다 (2026-11-06)."""

    kind: RiskKind
    id: str


class KeptRef(ComparedRef):
    level_from: str
    level_to: str


class KeptAgenda(Schema):
    """2026-11-06 전에 저장한 분석의 옛 모양 — 읽기만 한다(옛 줄은 고치지 않는다)."""

    agenda_id: str
    level_from: str
    level_to: str


class AnalysisCompare(Schema):
    """바로 앞 저장 분석 대비 — 분석을 돌린 때의 것이라 다시 세지 않는다.

    새로 남기는 것은 `{kind, id}` 모양. 옛 줄의 문자열(= 안건 id) · `agendaId` 도 그대로 읽어 낸다.
    """

    previous_id: str
    previous_title: str
    previous_saved_at: Utc
    added: list[ComparedRef | str]
    removed: list[ComparedRef | str]
    kept: list[KeptRef | KeptAgenda]


class AnalysisSettings(RiskSettings):
    """분석 때의 기준. 2026-11-06 전에 저장한 분석에는 흔들림 셋이 없다 — 없으면 키째 안 낸다
    (옛 줄은 고치지 않는다 · 지금 기본값으로 메우면 그때 쓰지 않은 기준을 쓴 것처럼 보인다)."""

    churn_days: int | None = None  # type: ignore[assignment]
    churn_count: int | None = None  # type: ignore[assignment]
    slip_count: int | None = None  # type: ignore[assignment]

    @model_serializer(mode="wrap")
    def _drop_missing(
        self, handler: SerializerFunctionWrapHandler, info: SerializationInfo
    ) -> dict[str, object]:
        dumped: dict[str, object] = handler(self)
        return {key: value for key, value in dumped.items() if value is not None}


class RiskAnalysisFacts(Schema):
    as_of: date
    settings: AnalysisSettings
    agendas: list[AnalyzedAgenda]
    # 옛 줄에는 없다 — 빈 배열로 읽는다
    tasks: list[AnalyzedTask] = []
    tests: list[AnalyzedTest] = []
    compare: AnalysisCompare | None


class RiskAnalysisListItem(Schema):
    id: str
    # 상세 경로에 프로젝트가 없어 화면이 어느 프로젝트 것인지 알게 (API.md Q70)
    project_id: str
    seq: int
    title: str
    created_by: str | None
    created_at: Utc
    saved_at: Utc
    agenda_count: int
    # 옛 줄은 0 (2026-11-06)
    task_count: int
    test_count: int
    # 세 종류의 high 합
    high_count: int


class RiskAnalysisOut(RiskAnalysisListItem):
    """domain.ts 의 `RiskAnalysis`."""

    body: str
    refs: list[ChatRef]
    facts: RiskAnalysisFacts
    title_edited_at: Utc | None


class RiskAnalysisPage(Schema):
    items: list[RiskAnalysisListItem]
    total: int


# 앞뒤 공백을 떼고 센다 — 비거나 넘으면 422 (detail.title)
AnalysisTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ANALYSIS_TITLE_MAX)
]


class RiskAnalysisSave(Schema):
    analysis_id: str
    title: AnalysisTitle


class RiskAnalysisPatch(Schema):
    title: AnalysisTitle

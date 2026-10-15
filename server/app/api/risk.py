from typing import Annotated

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.chat import get_chat_client, get_rate_limiter, sse_response
from app.api.deps import ProjectAdmin, ProjectScope, Session
from app.config import settings
from app.errors import ApiError
from app.schemas.risk import DecisionRiskReport, RiskSettings, RiskSummaryInput
from app.services import project as project_service
from app.services import risk as risk_service
from app.services import risk_summary
from app.services.ratelimit import RateLimiter
from app.time import today_kst

# 읽기는 그 프로젝트 멤버 누구나, 기준 바꾸기는 프로젝트 관리자 · 시스템 관리자 (docs/api/risk.md)
router = APIRouter(tags=["risk"])


@router.get("/projects/{project_id}/risks")
async def get_risks(project_id: str, scope: ProjectScope, session: Session) -> DecisionRiskReport:
    """'오늘' 은 한국 시간이다 — 기한은 사람이 고른 날짜라서."""
    return await risk_service.decision_risks(session, scope.project_id, today=today_kst())


@router.post(
    "/projects/{project_id}/risks/summary",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def summarize_risks(
    project_id: str,
    payload: RiskSummaryInput,
    request: Request,
    scope: ProjectScope,
    session: Session,
    client: Annotated[AsyncAnthropic | None, Depends(get_chat_client)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> StreamingResponse:
    """[AI 요약]. 챗봇과 같은 클라이언트 · 분당 제한 · SSE 다. 스트림 전 실패는 JSON 이다."""
    if client is None:
        raise ApiError(503, "CHAT_UNAVAILABLE", "AI 챗봇이 아직 설정되지 않았습니다.")
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        raise ApiError(
            429, "CHAT_RATE_LIMITED", "질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요."
        )
    # 이름은 먼저 떠 둔다 — 근거를 모은 뒤 rollback 이 ORM 객체를 만료시킨다
    project_name = (await project_service.load_project(session, scope.project_id)).name
    today = today_kst()
    context = await risk_summary.build_context(session, scope.project_id, payload, today=today)
    if context is None:
        return sse_response(risk_summary.nothing())
    return sse_response(
        risk_summary.summarize(client, settings, project_name, context, today=today)
    )


@router.get("/projects/{project_id}/risk-settings")
async def get_risk_settings(project_id: str, scope: ProjectScope, session: Session) -> RiskSettings:
    """바꾼 적이 없으면 기본값 — 404 를 내지 않는다."""
    return await risk_service.load_settings(session, scope.project_id)


@router.put("/projects/{project_id}/risk-settings")
async def put_risk_settings(
    project_id: str, payload: RiskSettings, scope: ProjectAdmin, session: Session
) -> RiskSettings:
    return await risk_service.save_settings(session, scope.project_id, payload)

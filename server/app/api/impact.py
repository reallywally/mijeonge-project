from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.chat import get_llm, get_rate_limiter, ready_llm, sse_response
from app.api.deps import ProjectScope, Session
from app.config import settings
from app.llm import LLMProvider
from app.schemas.impact import AgendaImpactState, ImpactApplyInput, ImpactApplyResult
from app.services import impact as impact_service
from app.services import project as project_service
from app.services.ratelimit import RateLimiter
from app.time import today_kst

# 보기 · 분석은 그 프로젝트 멤버 누구나, 반영은 줄마다 그 작업 · 테스트의 고치기 권한 (impact.md)
router = APIRouter(tags=["impact"])


@router.get("/agendas/{agenda_id}/impact")
async def get_impact(agenda_id: str, scope: ProjectScope, session: Session) -> AgendaImpactState:
    """가장 최근 분석 + 지금 세는 것(AI 없이). 분석한 적이 없으면 latest 가 null."""
    return await impact_service.impact_state(session, agenda_id)


@router.post(
    "/agendas/{agenda_id}/impact",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def analyze_impact(
    agenda_id: str,
    request: Request,
    scope: ProjectScope,
    session: Session,
    llm: Annotated[LLMProvider | None, Depends(get_llm)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> StreamingResponse:
    """[AI 영향도 분석]. 본문 없음. 챗봇과 같은 클라이언트 · 분당 제한 · SSE 다.

    결정내용이 빈 안건은 분당 제한을 먹기 전에 409 로 돌려보낸다.
    """
    agenda = await impact_service.load_for_analysis(session, agenda_id)
    ready = ready_llm(request, llm, limiter)
    # 이름은 먼저 떠 둔다 — 근거를 모은 뒤 rollback 이 ORM 객체를 만료시킨다
    project_name = (await project_service.load_project(session, scope.project_id)).name
    context = await impact_service.build_context(session, agenda, project_name)
    return sse_response(
        impact_service.analyze(
            ready, session, settings, context, actor_id=scope.actor.id, today=today_kst()
        )
    )


@router.post("/agenda-impacts/{impact_id}/apply")
async def apply_impact(
    impact_id: str, payload: ImpactApplyInput, scope: ProjectScope, session: Session
) -> ImpactApplyResult:
    """고른 고칠 안만 한 트랜잭션에 — 하나라도 틀리면 아무것도 안 바뀐다."""
    return await impact_service.apply_impact(session, impact_id, payload, scope, today=today_kst())

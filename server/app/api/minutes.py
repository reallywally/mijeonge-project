from typing import Annotated

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.chat import get_chat_client, get_rate_limiter, sse_response
from app.api.deps import ProjectScope, Session
from app.config import settings
from app.errors import ApiError
from app.schemas.minutes import (
    MinutesApplyInput,
    MinutesApplyResult,
    MinutesCreate,
    MinutesItem,
    MinutesOut,
    MinutesPatch,
)
from app.services import minutes as minutes_service
from app.services import minutes_draft
from app.services import project as project_service
from app.services.ratelimit import RateLimiter
from app.time import today_kst

# 쓰기 · 읽기 · AI 정리 · 등록은 그 프로젝트 멤버 누구나. 고치기 · 지우기만 좁다(minutes.md)
router = APIRouter(tags=["minutes"])


@router.get("/projects/{project_id}/minutes")
async def list_minutes(project_id: str, scope: ProjectScope, session: Session) -> list[MinutesItem]:
    """본문 · 요약 없이. 거르기 · 찾기는 화면이 한다."""
    return await minutes_service.list_minutes(session, scope.project_id)


@router.post("/projects/{project_id}/minutes", status_code=201)
async def create_minutes(
    project_id: str, payload: MinutesCreate, scope: ProjectScope, session: Session
) -> MinutesOut:
    """작성자는 로그인한 사람이다."""
    return await minutes_service.create_minutes(session, scope.project_id, scope.actor.id, payload)


@router.get("/minutes/{minutes_id}")
async def get_minutes(minutes_id: str, session: Session) -> MinutesOut:
    return await minutes_service.get_minutes(session, minutes_id)


@router.patch("/minutes/{minutes_id}")
async def edit_minutes(
    minutes_id: str, payload: MinutesPatch, scope: ProjectScope, session: Session
) -> MinutesOut:
    """고치기는 작성자만."""
    return await minutes_service.edit_minutes(session, minutes_id, scope, payload)


@router.delete("/minutes/{minutes_id}", status_code=204)
async def delete_minutes(minutes_id: str, scope: ProjectScope, session: Session) -> None:
    """지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자. 나온 줄은 남고 출처만 빈다."""
    await minutes_service.delete_minutes(session, minutes_id, scope)


@router.post(
    "/minutes/{minutes_id}/draft",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def draft_minutes(
    minutes_id: str,
    request: Request,
    scope: ProjectScope,
    session: Session,
    client: Annotated[AsyncAnthropic | None, Depends(get_chat_client)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> StreamingResponse:
    """저장된 회의록 → 초안. 본문을 받지 않고 저장하지 않는다.

    챗봇과 같은 클라이언트 · 분당 제한 · SSE 다.
    """
    if client is None:
        raise ApiError(503, "CHAT_UNAVAILABLE", "AI 챗봇이 아직 설정되지 않았습니다.")
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        raise ApiError(
            429, "CHAT_RATE_LIMITED", "질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요."
        )
    minutes = await minutes_service.load_minutes(session, minutes_id)
    # build_context 가 rollback 해 ORM 객체가 만료된다 — 그 전에 떠 둔다
    source = minutes_draft.MinutesSource(
        title=minutes.title, meeting_date=minutes.meeting_date, body=minutes.body
    )
    project_name = (await project_service.load_project(session, scope.project_id)).name
    context = await minutes_draft.build_context(session, scope.project_id, project_name)
    return sse_response(
        minutes_draft.draft(client, session, settings, context, source, today=today_kst())
    )


@router.post("/minutes/{minutes_id}/apply", status_code=201)
async def apply_minutes(
    minutes_id: str, payload: MinutesApplyInput, scope: ProjectScope, session: Session
) -> MinutesApplyResult:
    """고른 초안을 한 번에 등록한다. 한 트랜잭션 — 하나라도 틀리면 아무것도 안 남는다."""
    return await minutes_service.apply_minutes(session, minutes_id, payload)

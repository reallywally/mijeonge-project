from collections.abc import AsyncIterator
from typing import Annotated

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.schemas.chat import ChatEvent, ChatInput
from app.services import chat as chat_service
from app.services import project as project_service
from app.services.ratelimit import RateLimiter

router = APIRouter(tags=["chat"])

Session = Annotated[AsyncSession, Depends(get_session)]

_client: AsyncAnthropic | None = None
_client_built = False
_limiter = RateLimiter(settings.chat_rate_per_minute)


def get_chat_client() -> AsyncAnthropic | None:
    # 첫 요청에 한 번 만든다 — 키가 없으면 None 이고 앱은 그대로 뜬다
    global _client, _client_built
    if not _client_built:
        _client = chat_service.make_client(settings)
        _client_built = True
    return _client


def get_rate_limiter() -> RateLimiter:
    return _limiter


def _sse(event: ChatEvent) -> str:
    # 프론트는 event 줄로 가른다. data 는 한 줄 JSON 이라 줄바꿈이 끼지 않는다
    return f"event: {event.type}\ndata: {event.model_dump_json(by_alias=True)}\n\n"


def sse_response(events: AsyncIterator[ChatEvent]) -> StreamingResponse:
    """챗봇과 리스크 요약이 같이 쓴다 — 화면이 같은 스트림 읽기를 쓴다."""

    async def body() -> AsyncIterator[str]:
        async for event in events:
            yield _sse(event)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        # 프록시가 모아 두었다 한꺼번에 내보내지 않게
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/projects/{project_id}/chat",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def chat(
    project_id: str,
    payload: ChatInput,
    request: Request,
    session: Session,
    client: Annotated[AsyncAnthropic | None, Depends(get_chat_client)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> StreamingResponse:
    """저장된 안건 · 작업을 근거로 답한다. 스트림 전 실패는 JSON, 뒤 실패는 error 이벤트다."""
    project = await project_service.load_project(session, project_id)
    if client is None:
        raise ApiError(503, "CHAT_UNAVAILABLE", "AI 챗봇이 아직 설정되지 않았습니다.")
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        raise ApiError(
            429, "CHAT_RATE_LIMITED", "질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요."
        )

    return sse_response(
        chat_service.answer(client, session, settings, project.id, project.name, payload.messages)
    )

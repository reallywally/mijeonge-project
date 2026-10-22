import logging
from collections.abc import AsyncIterator

from anthropic import (
    AnthropicError,
    APIConnectionError,
    APIStatusError,
    AsyncAnthropic,
    RateLimitError,
)

from app.config import Settings
from app.llm.base import Finished, LLMError, LLMEvent, StopReason, TextDelta

log = logging.getLogger(__name__)

# 거절에 대비해 서버 쪽 대체 모델을 켠다 — fallbacks 는 이 베타가 있어야 받는다
FALLBACK_BETA = "server-side-fallback-2026-07-01"

_STOPS: dict[str, StopReason] = {
    "refusal": "refused",
    "max_tokens": "max_tokens",
    "model_context_window_exceeded": "max_tokens",
}


def make_client(settings: Settings) -> AsyncAnthropic | None:
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else ""
    if not key.strip():
        return None
    return AsyncAnthropic(api_key=key, timeout=settings.chat_timeout_seconds)


def to_llm_error(exc: AnthropicError) -> LLMError:
    if isinstance(exc, RateLimitError):
        return LLMError(
            "CHAT_RATE_LIMITED",
            "지금 질문이 많아 답하지 못했습니다. 잠시 뒤에 다시 물어 주세요.",
        )
    if isinstance(exc, APIStatusError):
        # 키 · 요청 내용은 싣지 않는다. 상태만 로그에 남긴다
        log.warning("Claude API 오류 status=%s request_id=%s", exc.status_code, exc.request_id)
    elif isinstance(exc, APIConnectionError):
        log.warning("Claude API 에 닿지 않음: %s", type(exc).__name__)
    else:
        log.warning("Claude SDK 오류: %s", type(exc).__name__)
    return LLMError("CHAT_UNAVAILABLE", "AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 물어 주세요.")


class AnthropicProvider:
    def __init__(self, client: AsyncAnthropic, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def stream(self, *, system: str, user_text: str) -> AsyncIterator[LLMEvent]:
        try:
            async with self.client.beta.messages.stream(
                model=self.settings.chat_model,
                max_tokens=self.settings.chat_max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_text}],
                # thinking 은 넘기지 않는다 — Sonnet 5.5 는 끌 수 없다(disabled 는 400)
                output_config={"effort": self.settings.chat_effort},
                fallbacks="default",
                betas=[FALLBACK_BETA],
            ) as stream:
                async for chunk in stream:
                    if chunk.type == "text" and chunk.text:
                        yield TextDelta(chunk.text)
                final = await stream.get_final_message()
        except AnthropicError as exc:
            raise to_llm_error(exc) from exc
        yield Finished(_STOPS.get(final.stop_reason or "", "end"))

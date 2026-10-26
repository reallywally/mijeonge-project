import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from anthropic import (
    AnthropicError,
    APIConnectionError,
    APIStatusError,
    AsyncAnthropic,
    RateLimitError,
)
from anthropic.types.beta import (
    BetaContentBlockParam,
    BetaMessage,
    BetaMessageParam,
    BetaToolUseBlock,
    BetaToolUseBlockParam,
)

from app.config import Settings
from app.llm.base import (
    AssistantMessage,
    Finished,
    LLMError,
    LLMEvent,
    Message,
    Reply,
    StopReason,
    TextDelta,
    ToolCall,
    ToolSpec,
    TurnEvent,
    UserMessage,
)

log = logging.getLogger(__name__)

# 거절에 대비해 서버 쪽 대체 모델을 켠다 — fallbacks 는 이 베타가 있어야 받는다
FALLBACK_BETA = "server-side-fallback-2026-07-01"

_STOPS: dict[str, StopReason] = {
    "tool_use": "tool_use",
    "pause_turn": "paused",
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


def to_param(message: Message) -> BetaMessageParam:
    if isinstance(message, AssistantMessage):
        if isinstance(message.native, BetaMessage):
            # thinking 블록 · 서명까지 받은 그대로 돌려줘야 도구 루프가 이어진다
            return message.native.to_param()
        if not message.calls:
            return {"role": "assistant", "content": message.text}
        blocks: list[BetaContentBlockParam] = (
            [{"type": "text", "text": message.text}] if message.text else []
        )
        blocks += [
            BetaToolUseBlockParam(
                type="tool_use", id=call.id, name=call.name, input=cast(dict[str, Any], call.input)
            )
            for call in message.calls
        ]
        return {"role": "assistant", "content": blocks}
    if message.results:
        content: list[BetaContentBlockParam] = [
            {
                "type": "tool_result",
                "tool_use_id": result.call_id,
                "content": result.content,
                "is_error": result.is_error,
            }
            for result in message.results
        ]
        if message.text:
            content.append({"type": "text", "text": message.text})
        return {"role": "user", "content": content}
    if message.cache:
        return {
            "role": "user",
            "content": [
                {"type": "text", "text": message.text, "cache_control": {"type": "ephemeral"}}
            ],
        }
    return {"role": "user", "content": message.text}


def from_message(final: BetaMessage) -> AssistantMessage:
    return AssistantMessage(
        text="".join(block.text for block in final.content if block.type == "text"),
        calls=[
            ToolCall(id=block.id, name=block.name, input=block.input)
            for block in final.content
            if isinstance(block, BetaToolUseBlock)
        ],
        native=final,
    )


class AnthropicProvider:
    def __init__(self, client: AsyncAnthropic, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def stream(self, *, system: str, user_text: str) -> AsyncIterator[LLMEvent]:
        async for event in self.turn(system=system, messages=[UserMessage(user_text)]):
            yield event if isinstance(event, TextDelta) else Finished(event.stop)

    async def turn(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec] = (),
        max_tokens: int | None = None,
    ) -> AsyncIterator[TurnEvent]:
        params: dict[str, Any] = {
            "model": self.settings.chat_model,
            "max_tokens": max_tokens or self.settings.chat_max_tokens,
            "system": system,
            "messages": [to_param(message) for message in messages],
        }
        if tools:
            params["tools"] = list(tools)
            # Sonnet 5.5 는 강제 호출(any · tool)이 400 이다 — 프롬프트로 도구를 쓰게 한다
            params["tool_choice"] = {"type": "auto"}
        try:
            async with self.client.beta.messages.stream(
                **params,
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
        yield Reply(from_message(final), _STOPS.get(final.stop_reason or "", "end"))

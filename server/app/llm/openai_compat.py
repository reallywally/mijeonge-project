"""GPT · Groq — 둘 다 OpenAI 의 Chat Completions 모양이다. Groq 는 base_url 만 다르다.

Claude 전용 기능(effort · 서버 쪽 대체 모델 · 캐시 표시)은 여기 없다 — 받은 표시는 건너뛴다.
"""

import json
import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    OpenAIError,
    RateLimitError,
)
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolParam

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

GROQ_BASE_URL = "https://api.groq.com/openai/v1"

_STOPS: dict[str, StopReason] = {
    "tool_calls": "tool_use",
    "length": "max_tokens",
    "content_filter": "refused",
}


def make_provider(settings: Settings) -> "OpenAICompatProvider | None":
    """고른 공급자의 키 · 모델이 둘 다 있을 때만 만든다."""
    if settings.llm_provider == "openai":
        secret, model, base_url, name = (
            settings.openai_api_key,
            settings.openai_model,
            None,
            "OpenAI",
        )
    elif settings.llm_provider == "groq":
        secret, model, base_url, name = (
            settings.groq_api_key,
            settings.groq_model,
            GROQ_BASE_URL,
            "Groq",
        )
    else:
        return None
    key = secret.get_secret_value() if secret else ""
    if not key.strip() or not (model or "").strip():
        return None
    client = AsyncOpenAI(api_key=key, base_url=base_url, timeout=settings.chat_timeout_seconds)
    return OpenAICompatProvider(client, settings, model=(model or "").strip(), name=name)


def to_llm_error(exc: OpenAIError, name: str) -> LLMError:
    if isinstance(exc, RateLimitError):
        return LLMError(
            "CHAT_RATE_LIMITED",
            "지금 질문이 많아 답하지 못했습니다. 잠시 뒤에 다시 물어 주세요.",
        )
    if isinstance(exc, APIStatusError):
        # 키 · 요청 내용은 싣지 않는다. 상태만 로그에 남긴다
        log.warning("%s API 오류 status=%s request_id=%s", name, exc.status_code, exc.request_id)
    elif isinstance(exc, APIConnectionError):
        log.warning("%s API 에 닿지 않음: %s", name, type(exc).__name__)
    else:
        log.warning("%s SDK 오류: %s", name, type(exc).__name__)
    return LLMError("CHAT_UNAVAILABLE", "AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 물어 주세요.")


def to_params(system: str, messages: Sequence[Message]) -> list[ChatCompletionMessageParam]:
    params: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}]
    for message in messages:
        if isinstance(message, AssistantMessage):
            if not message.calls:
                params.append({"role": "assistant", "content": message.text})
                continue
            params.append(
                {
                    "role": "assistant",
                    "content": message.text or None,
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.input, ensure_ascii=False),
                            },
                        }
                        for call in message.calls
                    ],
                }
            )
            continue
        # 도구 결과는 한 건씩 tool 메시지다. 오류 표시 칸이 없다 — 결과 JSON 의 error 로 안다
        for result in message.results:
            params.append(
                {"role": "tool", "tool_call_id": result.call_id, "content": result.content}
            )
        if message.text or not message.results:
            params.append({"role": "user", "content": message.text})
    return params


def to_tools(tools: Sequence[ToolSpec]) -> list[ChatCompletionToolParam]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"],
            },
        }
        for tool in tools
    ]


@dataclass
class _PartialCall:
    """스트림에서 조각으로 오는 도구 호출 하나 — 이름 · 입력 JSON 이 나뉘어 온다."""

    id: str = ""
    name: str = ""
    arguments: list[str] = field(default_factory=list)

    def done(self, index: int) -> ToolCall:
        raw = "".join(self.arguments)
        parsed: object
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except ValueError:
            # 깨진 JSON 은 그대로 넘긴다 — 도구의 입력 검사가 오류 결과로 모델에 돌려준다
            parsed = raw
        return ToolCall(id=self.id or f"call_{index}", name=self.name, input=parsed)


class OpenAICompatProvider:
    def __init__(
        self, client: AsyncOpenAI, settings: Settings, *, model: str, name: str = "OpenAI"
    ) -> None:
        self.client = client
        self.settings = settings
        self.model = model
        self.name = name

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
            "model": self.model,
            "messages": to_params(system, messages),
            # max_tokens 는 추론 모델이 받지 않는다 — 새 이름을 쓴다(Groq 도 받는다)
            "max_completion_tokens": max_tokens or self.settings.chat_max_tokens,
            "stream": True,
        }
        if tools:
            params["tools"] = to_tools(tools)
            params["tool_choice"] = "auto"
        written: list[str] = []
        calls: dict[int, _PartialCall] = {}
        finish: str | None = None
        refused = False
        try:
            stream = await self.client.chat.completions.create(**params)
            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta
                if delta.content:
                    written.append(delta.content)
                    yield TextDelta(delta.content)
                if delta.refusal:
                    refused = True
                for piece in delta.tool_calls or []:
                    partial = calls.setdefault(piece.index, _PartialCall())
                    if piece.id:
                        partial.id = piece.id
                    if piece.function and piece.function.name:
                        partial.name = piece.function.name
                    if piece.function and piece.function.arguments:
                        partial.arguments.append(piece.function.arguments)
                if choice.finish_reason:
                    finish = choice.finish_reason
        except OpenAIError as exc:
            raise to_llm_error(exc, self.name) from exc
        message = AssistantMessage(
            text="".join(written),
            calls=[calls[index].done(index) for index in sorted(calls)],
        )
        stop: StopReason = "refused" if refused else _STOPS.get(finish or "", "end")
        if stop == "end" and message.calls:
            # 도구를 불러 놓고 stop 으로 끝내는 모델이 있다 — 부른 것을 버리지 않는다
            stop = "tool_use"
        yield Reply(message, stop)

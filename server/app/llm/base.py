"""LLM 공급자의 경계 — 서비스는 이 모양만 본다. 공급자 SDK 는 `app/llm` 밖으로 새지 않는다."""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypedDict

# 공급자마다 이름이 다른 멈춘 이유를 하나로 맞춘다. paused 는 공급자 쪽에서 멈춘 차례 —
# 그 답을 그대로 이어 붙여 다시 부른다
StopReason = Literal["end", "tool_use", "max_tokens", "refused", "paused"]
ErrorCode = Literal["CHAT_RATE_LIMITED", "CHAT_UNAVAILABLE"]


class ToolSpec(TypedDict):
    """도구 하나. input_schema 는 JSON Schema 다 — 공급자마다 받는 자리만 다르다."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    input: object


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: str
    is_error: bool


@dataclass(frozen=True)
class UserMessage:
    """사람의 말 · 도구 결과. results 가 있으면 text 는 그 뒤에 붙는 덧말이다.

    cache 는 '여기까지는 차례마다 똑같이 실려 간다' 는 표시 — 받는 공급자만 쓴다.
    """

    text: str = ""
    results: Sequence[ToolResult] = ()
    cache: bool = False


@dataclass(frozen=True)
class AssistantMessage:
    """모델의 답. native 는 공급자가 그대로 되돌려 받아야 하는 원본이다(Claude 의 thinking 서명 등).

    화면이 보낸 지난 답처럼 원본이 없으면 None — 공급자가 text · calls 로 다시 만든다.
    """

    text: str = ""
    calls: Sequence[ToolCall] = ()
    native: object = None


Message = UserMessage | AssistantMessage


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class Finished:
    stop: StopReason


@dataclass(frozen=True)
class Reply:
    """한 차례의 끝 — 다음 차례에는 message 를 대화에 그대로 이어 붙인다."""

    message: AssistantMessage
    stop: StopReason


LLMEvent = TextDelta | Finished
TurnEvent = TextDelta | Reply


class LLMError(Exception):
    """공급자 SDK 오류를 접은 것. code · message 가 그대로 화면의 error 이벤트가 된다."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(code)
        self.code: ErrorCode = code
        self.message = message


class LLMProvider(Protocol):
    def stream(self, *, system: str, user_text: str) -> AsyncIterator[LLMEvent]:
        """도구 없이 한 번 부른다. 글 조각을 흘리고 마지막에 Finished 하나. 실패는 LLMError."""
        ...

    def turn(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec] = (),
        max_tokens: int | None = None,
    ) -> AsyncIterator[TurnEvent]:
        """도구 루프의 한 차례. 글 조각을 흘리고 마지막에 Reply 하나. 도구는 늘 모델이 고른다.

        max_tokens 를 안 주면 공급자의 기본값이다. 실패는 LLMError.
        """
        ...

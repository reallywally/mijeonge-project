"""LLM 공급자의 경계 — 서비스는 이 모양만 본다. 공급자 SDK 는 `app/llm` 밖으로 새지 않는다."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

# 공급자마다 이름이 다른 멈춘 이유를 하나로 맞춘다
StopReason = Literal["end", "max_tokens", "refused"]
ErrorCode = Literal["CHAT_RATE_LIMITED", "CHAT_UNAVAILABLE"]


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class Finished:
    stop: StopReason


LLMEvent = TextDelta | Finished


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

from typing import Literal

from pydantic import Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema

# API.md '## AI 챗봇' — 화면이 들고 있는 대화 크기의 상한
MESSAGES_MAX = 20
TEXT_MAX = 2000

ToolName = Literal["search_threads", "get_thread", "search_tasks", "get_task"]


class ChatMessage(Schema):
    role: Literal["user", "assistant"]
    # 화면에 보인 글 그대로 — 근거 표시([[thread:ID]])도 지우지 않고 돌아온다
    text: str = Field(max_length=TEXT_MAX)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise PydanticCustomError("blank_text", "내용을 입력해 주세요.")
        return value


class ChatInput(Schema):
    """POST /api/projects/{projectId}/chat. 서버는 대화를 저장하지 않는다 (Q26)."""

    messages: list[ChatMessage] = Field(min_length=1, max_length=MESSAGES_MAX)

    @field_validator("messages")
    @classmethod
    def _ends_with_user(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if value and value[-1].role != "user":
            raise PydanticCustomError("last_not_user", "마지막 메시지는 질문이어야 합니다.")
        return value


class ChatRef(Schema):
    kind: Literal["thread", "task"]
    id: str


# 아래 넷이 SSE 의 data 다. event 줄과 같은 값을 type 에도 싣는다


class DeltaEvent(Schema):
    type: Literal["delta"] = "delta"
    text: str


class ToolEvent(Schema):
    type: Literal["tool"] = "tool"
    name: ToolName
    label: str


class DoneEvent(Schema):
    type: Literal["done"] = "done"
    refs: list[ChatRef]


class ErrorEvent(Schema):
    type: Literal["error"] = "error"
    code: str
    message: str


ChatEvent = DeltaEvent | ToolEvent | DoneEvent | ErrorEvent


# 도구 입력. Claude 가 넣는 값이라 경계처럼 검증한다 — 키는 도구 정의와 같은 snake_case 로 받는다


class SearchThreadsInput(Schema):
    query: str
    state: Literal["queued", "open", "decided"] | None = None
    limit: int = Field(default=10, ge=1, le=20)


class SearchTasksInput(Schema):
    query: str
    status: Literal["todo", "doing", "blocked", "done"] | None = None
    limit: int = Field(default=10, ge=1, le=20)


class GetThreadInput(Schema):
    thread_id: str


class GetTaskInput(Schema):
    task_id: str

from typing import Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema
from app.schemas.task import PROPOSAL_MAX, ProposedTask

# API.md '## AI 챗봇' — 화면이 들고 있는 대화 크기의 상한
MESSAGES_MAX = 20
TEXT_MAX = 2000
# 답은 chat_max_tokens 만큼 길어지고 화면이 그대로 돌려보낸다
# — 질문 상한을 걸면 긴 답 뒤로 다 막힌다
ANSWER_MAX = 20000

ToolName = Literal[
    "search_threads",
    "get_thread",
    "search_tasks",
    "get_task",
    "list_tasks",
    "find_similar_tasks",
    "list_members",
    "propose_tasks",
]


class TaskProposal(Schema):
    """작업 초안. 배열 순서 = 등록 순서 = 화면 순서. 검사는 `services/task.proposal_problems`."""

    tasks: list[ProposedTask]


class ChatProposal(TaskProposal):
    """화면이 돌려보내는 지난 초안과 그 결과. 서버가 대화를 저장하지 않아서다 (Q26)."""

    # 글로 풀어 Claude 에게 넘기는 것이라 크기를 막는다 — 초안 상한과 같다
    tasks: list[ProposedTask] = Field(max_length=PROPOSAL_MAX)
    status: Literal["pending", "registered", "cancelled"]
    # registered 일 때만 — tempId → 저장된 작업 key
    key_by_temp_id: dict[str, str] | None = None


class ChatMessage(Schema):
    role: Literal["user", "assistant"]
    # 화면에 보인 글 그대로 — 근거 표시([[thread:ID]])도 지우지 않고 돌아온다
    text: str
    # assistant 에만. 그 답이 낸 초안과 화면에서의 결과
    proposal: ChatProposal | None = None

    @field_validator("text")
    @classmethod
    def _check_text(cls, value: str, info: ValidationInfo) -> str:
        if not value.strip():
            raise PydanticCustomError("blank_text", "내용을 입력해 주세요.")
        limit = ANSWER_MAX if info.data.get("role") == "assistant" else TEXT_MAX
        if len(value) > limit:
            raise PydanticCustomError("string_too_long", "너무 깁니다.")
        return value

    @field_validator("proposal")
    @classmethod
    def _proposal_on_answer(
        cls, value: ChatProposal | None, info: ValidationInfo
    ) -> ChatProposal | None:
        if value is not None and info.data.get("role") != "assistant":
            raise PydanticCustomError("proposal_on_user", "초안은 답에만 실을 수 있습니다.")
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


# 아래 다섯이 SSE 의 data 다. event 줄과 같은 값을 type 에도 싣는다


class DeltaEvent(Schema):
    type: Literal["delta"] = "delta"
    text: str


class ToolEvent(Schema):
    type: Literal["tool"] = "tool"
    name: ToolName
    label: str


class ProposalEvent(Schema):
    """작업 초안. 한 답에 많아야 하나, done 바로 앞에 온다."""

    type: Literal["proposal"] = "proposal"
    proposal: TaskProposal


class DoneEvent(Schema):
    type: Literal["done"] = "done"
    refs: list[ChatRef]


class ErrorEvent(Schema):
    type: Literal["error"] = "error"
    code: str
    message: str


ChatEvent = DeltaEvent | ToolEvent | ProposalEvent | DoneEvent | ErrorEvent


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


class ListTasksInput(Schema):
    status: Literal["todo", "doing", "blocked", "done"] | None = None


class FindSimilarTasksInput(Schema):
    # id 나 작업 키. 없으면 프로젝트 전체에서 쌍을 찾는다
    task_id: str | None = None
    limit: int = Field(default=20, ge=1, le=30)

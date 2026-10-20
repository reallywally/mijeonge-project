from datetime import date
from typing import Annotated, Literal

from pydantic import StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc
from app.schemas.task import ProposedTask, TaskOut, TaskThreadLinkOut
from app.schemas.thread import EntryOut, ThreadOut

# docs/api/minutes.md — 60,000자면 대략 1시간 반 회의다
MINUTES_TEXT_MAX = 60000
MINUTES_TITLE_MAX = 200
# 초안 검사 규칙의 개수 상한
MINUTES_THREADS_MAX = 20
MINUTES_ENTRIES_MAX = 20
MINUTES_TASKS_MAX = 30

# 화면이 이력에 쓰는 셋뿐이다 — 결정을 바꾼 것도 decide 다
MinutesEntryKind = Literal["decide", "defer", "refine"]

MinutesToolName = Literal[
    "search_threads", "get_thread", "search_tasks", "list_members", "propose_minutes"
]


class MinutesItem(Schema):
    """게시판 목록 한 줄 — 본문 · 요약 없이."""

    id: str
    project_id: str
    title: str
    meeting_date: date | None
    author_id: str
    created_at: Utc
    updated_at: Utc


class MinutesOut(MinutesItem):
    """domain.ts 의 `Minutes`."""

    body: str
    summary: str


# 앞뒤 공백을 떼고 센다 — 비거나 넘으면 422 (string_too_short · string_too_long)
MinutesTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MINUTES_TITLE_MAX)
]
MinutesBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MINUTES_TEXT_MAX)
]


class MinutesCreate(Schema):
    """domain.ts 의 `MinutesInput`. 작성자는 로그인한 사람이다 — authorId 를 실어 와도 버린다."""

    title: MinutesTitle
    meeting_date: date | None = None
    body: MinutesBody


class MinutesPatch(Schema):
    """보낸 칸만 바꾼다 — 서비스가 `model_fields_set` 으로 읽는다."""

    title: MinutesTitle | None = None
    # null 로 보내면 비운다
    meeting_date: date | None = None
    body: MinutesBody | None = None

    @field_validator("title", "body")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class ProposedEntryBody(Schema):
    kind: MinutesEntryKind
    text: str
    detail: list[str] = []
    note: str = ""
    owner_id: str | None = None
    # ownerId 를 못 정했을 때 회의록에서 부른 말. 등록할 때는 버린다
    owner_hint: str = ""


class ProposedThread(Schema):
    """새 안건. 검사 규칙은 `services/minutes.py` 의 `minutes_problems` 가 자리를 짚어 본다."""

    temp_id: str
    title: str
    description: str = ""
    options: list[str] = []
    owner_id: str | None = None
    owner_hint: str = ""
    due_date: date | None = None
    # 이 회의에서 정해졌거나 미뤄졌으면 그 이력. 등록만 된 안건이면 null
    entry: ProposedEntryBody | None = None
    # 근거 원문. 등록할 때는 버린다
    quote: str = ""


class ProposedEntry(ProposedEntryBody):
    """이미 있는 안건에 붙일 이력."""

    temp_id: str
    thread_id: str
    quote: str = ""


class ProposedMinutesTask(ProposedTask):
    """챗봇의 ProposedTask 에 안건 연결 · 근거가 붙었다."""

    owner_hint: str = ""
    # 이 초안의 새 안건(tempId)
    thread_temp_ids: list[str] = []
    # 이미 있는 안건(id)
    thread_ids: list[str] = []
    quote: str = ""


class MinutesDraft(Schema):
    # 못 읽으면 null — 날짜 기준이 오늘이었다는 표시
    meeting_date: date | None
    summary: str
    threads: list[ProposedThread]
    entries: list[ProposedEntry]
    tasks: list[ProposedMinutesTask]


class MinutesApplyInput(Schema):
    """화면에서 고르고 고친 것만. quote · ownerHint 는 실어 와도 버린다."""

    # 회의록에 저장할 요약 — 안 보내면(null 도) 지금 요약 그대로
    summary: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=MINUTES_TEXT_MAX)] | None
    ) = None
    threads: list[ProposedThread] = []
    entries: list[ProposedEntry] = []
    tasks: list[ProposedMinutesTask] = []


class MinutesApplyResult(Schema):
    # 요청 순서 그대로
    threads: list[ThreadOut]
    # 새 안건의 이력 먼저, 그다음 기존 안건의 이력 — 각각 요청 순서
    entries: list[EntryOut]
    # 이력 때문에 바뀐 기존 안건
    updated_threads: list[ThreadOut]
    tasks: list[TaskOut]
    links: list[TaskThreadLinkOut]
    thread_id_by_temp_id: dict[str, str]
    task_id_by_temp_id: dict[str, str]


# 아래 넷이 SSE 의 data 다. event 줄과 같은 값을 type 에도 싣는다


class MinutesToolEvent(Schema):
    type: Literal["tool"] = "tool"
    name: MinutesToolName
    label: str


class MinutesDraftEvent(Schema):
    """초안. 꼭 한 번, done 보다 먼저."""

    type: Literal["draft"] = "draft"
    draft: MinutesDraft


class MinutesDoneEvent(Schema):
    type: Literal["done"] = "done"


class MinutesErrorEvent(Schema):
    type: Literal["error"] = "error"
    code: str
    message: str


MinutesEvent = MinutesToolEvent | MinutesDraftEvent | MinutesDoneEvent | MinutesErrorEvent

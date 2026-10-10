from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

EntryKindIn = Literal["raise", "defer", "decide", "refine", "change", "split"]


class ThreadOut(Schema):
    id: str
    project_id: str
    title: str
    state: str
    owner_id: str | None
    parent_thread_id: str | None
    created_at: Utc
    description: str = ""
    # thread_option 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    options: list[str] = Field(default_factory=list)
    due_date: date | None = None


class EntryOut(Schema):
    """안건 이력 한 줄."""

    id: str
    thread_id: str
    kind: str
    text: str
    # entry_detail 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    detail: list[str]
    note: str
    owner_id: str | None
    created_at: Utc


class ThreadCreate(Schema):
    """먼저 등록해 두는 안건. 등록만 된 상태가 'queued' 다."""

    title: str
    owner_id: str | None = None
    description: str = ""
    # 받은 순서대로 저장한다. 빈 줄 거르기는 화면 몫이다
    options: list[str] = []
    due_date: date | None = None


class EntryCreate(Schema):
    """이력 한 줄. 화면은 decide · refine · defer 셋만 보내지만 kind 전부를 받는다."""

    kind: EntryKindIn
    text: str
    detail: list[str] = []
    note: str = ""
    owner_id: str | None = None


class ThreadPatch(Schema):
    """부분 수정. 보낸 필드만 바꾼다 — 서비스가 `model_fields_set` 으로 읽는다.

    state 는 받지 않는다. 상태는 이력(Entry)으로만 바뀐다 — 보내도 무시된다.
    """

    # 앞뒤 공백을 떼고 비면 422 다(string_too_short)
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    # null 로 보내면 비운다
    owner_id: str | None = None
    description: str | None = None
    # 통째로 갈아끼운다. 받은 순서가 곧 sort_order 다
    options: list[str] | None = None
    # null 로 보내면 비운다
    due_date: date | None = None

    @field_validator("title", "description", "options")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다.
        # 이 셋은 빈 값이 '' · [] 라 null 을 '비우기'로 받아 주면 계약이 두 벌이 된다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class EntryAdded(Schema):
    """줄 하나가 안건 상태까지 바꾼다 — 바뀐 둘을 같이 돌려준다(스냅샷을 다시 받지 않게)."""

    entry: EntryOut
    thread: ThreadOut

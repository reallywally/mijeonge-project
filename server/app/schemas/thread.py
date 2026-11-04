from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

# 참조는 0 ~ 20명 (docs/api/check.md '참조')
CC_MAX = 20

EntryKindIn = Literal["raise", "defer", "decide", "refine", "change", "split"]

# 결정 항목 이름 — 한 줄 · 1 ~ 200자. 앞뒤 공백을 떼고 센다(string_too_short · string_too_long)
ITEM_TITLE_MAX = 200
ItemTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ITEM_TITLE_MAX)
]


class ThreadOut(Schema):
    id: str
    project_id: str
    title: str
    state: str
    owner_id: str | None
    # 등록한 사람. 기록이 없던 지난 안건은 null — 수정 · 삭제 권한의 근거다
    creator_id: str | None
    parent_thread_id: str | None
    created_at: Utc
    description: str = ""
    # thread_option 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    options: list[str] = Field(default_factory=list)
    due_date: date | None = None
    # null 이면 프로젝트 공통 (docs/api/part.md)
    part_id: str | None = None
    # 참조 — thread_cc 행을 순서대로 편다. 없으면 [] (docs/api/check.md)
    cc_ids: list[str] = Field(default_factory=list)
    # AI 정리로 등록한 회의록. 손으로 만든 것은 null (docs/api/minutes.md)
    minutes_id: str | None = None


class DecisionItemOut(Schema):
    """결정 항목 하나. 정했는지는 싣지 않는다 — 화면이 이력에서 센다."""

    id: str
    thread_id: str
    title: str
    created_at: Utc
    # 등록한 사람. 이행으로 만든 지난 항목은 null
    creator_id: str | None


class EntryOut(Schema):
    """안건 이력 한 줄."""

    id: str
    thread_id: str
    # decide · change · refine 은 늘 있다. defer 는 null 이면 안건 전체, raise · split 은 늘 null
    item_id: str | None
    kind: str
    text: str
    # entry_detail 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    detail: list[str]
    note: str
    owner_id: str | None
    # 줄을 남긴 사람. 기록이 없던 지난 줄은 null — 그 줄을 고치고 지울 수 있다
    creator_id: str | None
    created_at: Utc
    minutes_id: str | None = None


class ThreadCreate(Schema):
    """먼저 등록해 두는 안건. 등록만 된 상태가 'queued' 다."""

    title: str
    owner_id: str | None = None
    description: str = ""
    # 받은 순서대로 저장한다. 빈 줄 거르기는 화면 몫이다
    options: list[str] = []
    due_date: date | None = None
    # 안 보내면 공통(null)이다 — 작업과 달리 따를 상위가 없다
    part_id: str | None = None
    # 개수는 겹친 것을 합치기 전에 센다 — 오류 detail 의 자리(`ccIds.1`)가 보낸 배열을 짚는다
    cc_ids: list[str] = Field(default=[], max_length=CC_MAX)


class EntryCreate(Schema):
    """이력 한 줄. 화면은 decide · refine · defer 셋만 보내지만 kind 전부를 받는다."""

    kind: EntryKindIn
    # kind 와 짝이 맞는지는 서비스가 본다 — 오류 code 를 나눠 내야 해서다
    item_id: str | None = None
    text: str
    detail: list[str] = []
    note: str = ""
    owner_id: str | None = None


class DecisionItemCreate(Schema):
    """항목은 안건 끝에 붙는다."""

    title: ItemTitle


class DecisionItemPatch(Schema):
    """이름 바꾸기."""

    title: ItemTitle


class DecisionItemAdded(Schema):
    """정해진 안건에 항목이 붙으면 open 으로 돌아간다 — 안건도 같이 준다."""

    item: DecisionItemOut
    thread: ThreadOut


class DecisionItemRemoved(Schema):
    """항목을 지우면 상태를 다시 센다 — 바뀐 안건을 돌려준다."""

    thread: ThreadOut


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
    # null 로 보내면 공통
    part_id: str | None = None
    # 통째로 갈아끼운다. 안 보내면 그대로
    cc_ids: list[str] | None = Field(default=None, max_length=CC_MAX)

    @field_validator("title", "description", "options", "cc_ids")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다.
        # 이 넷은 빈 값이 '' · [] 라 null 을 '비우기'로 받아 주면 계약이 두 벌이 된다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class EntryPatch(Schema):
    """이력 한 줄의 글 고치기 — 실수로 남긴 결정 · 메모를 바로잡는다. 보낸 필드만 바꾼다.

    kind · 처리한 사람은 못 바꾼다 — 줄이 안건 상태를 바꿨으니 바꾸려면 새 줄을 남긴다.
    """

    # 앞뒤 공백을 떼고 비면 422 다(string_too_short)
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    # 빈 값은 '' 다
    note: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None

    @field_validator("text", "note")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # ThreadPatch 와 같다 — 명시적으로 보낸 null 만 걸린다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class EntryRemoved(Schema):
    """줄을 지우면 안건 상태를 다시 센다 — 바뀐 안건을 돌려준다(화면이 갈아끼운다)."""

    thread: ThreadOut


class EntryAdded(Schema):
    """줄 하나가 안건 상태까지 바꾼다 — 바뀐 둘을 같이 돌려준다(스냅샷을 다시 받지 않게)."""

    entry: EntryOut
    thread: ThreadOut

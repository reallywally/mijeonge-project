from datetime import date
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

# 회의에서 'HW-4' 한 마디로 가리키는 값이라 대문자 영숫자로만 받는다 (API.md Q20)
TASK_KEY_PREFIX_PATTERN = r"^[A-Z][A-Z0-9]{0,7}$"


def _blank_is_none(value: object) -> object:
    """빈 문자열은 '안 넣은 것' 과 같이 본다 (API.md Q24).

    등록 폼은 입력칸을 비워 두는 것이 정상 경로다 — 그 값을 그대로 실어 보냈다고 해서
    '형식이 틀렸습니다' 가 뜨면 안 된다. 앞뒤 공백도 떼어 준다(접두사에 공백은 못 들어간다).
    """
    if isinstance(value, str):
        return value.strip() or None
    return value


TaskKeyPrefixIn = Annotated[str | None, BeforeValidator(_blank_is_none)]

DESCRIPTION_MAX = 2000
# 앞뒤 공백을 떼고, 비면 null(설명 없음)이다 — 빈 칸으로 저장해 두 벌이 되지 않게
DescriptionIn = Annotated[
    Annotated[str, Field(max_length=DESCRIPTION_MAX)] | None, BeforeValidator(_blank_is_none)
]
ProjectStatus = Literal["active", "closed"]
NameIn = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class ProjectOut(Schema):
    id: str
    name: str
    # 프로젝트 목록 화면이 이 값을 찍는다 — domain.ts 의 Project 와 같은 모양이다 (API.md Q9 · Q22)
    task_key_prefix: str
    description: str | None
    start_date: date | None
    end_date: date | None
    # 종료는 표시만 한다 — 쓰기를 막지 않는다
    status: ProjectStatus
    closed_at: Utc | None


class MemberOut(Schema):
    id: str
    name: str
    # 고르는 자리에서 비활성 멤버를 빼고, 이름 옆에 '(비활성)' 을 찍는다
    active: bool


class ProjectCreate(Schema):
    """프로젝트 등록. 빈 상태에서 앱을 여는 유일한 길이다 (API.md Q18).

    `taskKeyPrefix` 는 **선택**이다 — 안 넣으면(키가 없거나 빈 문자열이면) 서버가 겹치지 않는
    값을 만들어 응답에 실어 준다 (API.md Q20 · Q24). 적었는데 형식이 틀렸을 때만 422 다.
    """

    name: str = Field(min_length=1, max_length=200)
    task_key_prefix: TaskKeyPrefixIn = Field(default=None, pattern=TASK_KEY_PREFIX_PATTERN)
    description: DescriptionIn = None
    start_date: date | None = None
    end_date: date | None = None


class ProjectPatch(Schema):
    """부분 수정. 보낸 필드만 바꾼다 — 서비스가 `model_fields_set` 으로 읽는다.

    `description` · `startDate` · `endDate` 의 null 은 '비우기'다.
    날짜 범위는 바뀐 뒤의 값으로 본다.
    """

    name: NameIn | None = None
    description: DescriptionIn = None
    start_date: date | None = None
    end_date: date | None = None
    status: ProjectStatus | None = None

    @field_validator("name", "status")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value

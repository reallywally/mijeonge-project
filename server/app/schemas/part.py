from typing import Annotated

from pydantic import StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.models.part import PART_NAME_MAX
from app.schemas.base import Schema

# 앞뒤 공백을 떼고 1 ~ 50자 (docs/api/part.md)
PartName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=PART_NAME_MAX)
]


class PartOut(Schema):
    id: str
    project_id: str
    name: str
    # false 면 보관 — 새 작업 · 안건에 고를 수 없다
    active: bool


class PartMemberOut(Schema):
    part_id: str
    member_id: str
    # 보기는 목록의 기본 거르기, 등록 · 수정 · 삭제는 그 파트 작업 · 테스트의 권한
    can_view: bool
    can_create: bool
    can_update: bool
    can_delete: bool


class PartMemberIn(Schema):
    """보낸 것만 바꾼다 — 새 소속이면 안 보낸 것은 보기 · 등록 · 수정 켬, 삭제 끔.
    서버가 삭제 ⇒ 수정, 등록 · 수정 ⇒ 보기로 맞춘다."""

    can_view: bool | None = None
    can_create: bool | None = None
    can_update: bool | None = None
    can_delete: bool | None = None

    @field_validator("can_view", "can_create", "can_update", "can_delete")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value


class PartCreate(Schema):
    name: PartName


class PartPatch(Schema):
    """보낸 것만 바꾼다 — 서비스가 `model_fields_set` 으로 읽는다."""

    name: PartName | None = None
    active: bool | None = None

    @field_validator("name", "active")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 둘 다 비울 수 있는 값이 아니다 — null 을 '안 바꿈' 으로 받아 주면 계약이 두 벌이 된다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value

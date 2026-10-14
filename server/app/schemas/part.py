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

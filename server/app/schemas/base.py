"""프론트와 맞닿는 경계. 모든 응답 · 요청 스키마가 여기서 내려온다."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer
from pydantic.alias_generators import to_camel

from app.time import iso_z

Utc = Annotated[
    datetime,
    # 계약은 ISO 8601 UTC 하나다 — 늘 `Z` 로 끝나고 오프셋(+09:00)을 섞지 않는다 (API.md Q3).
    # naive 가 와도 UTC 로 보고 Z 를 붙인다. 시각 없이 날짜만 내보내면 같은 날 여러 줄의
    # 순서를 잃는다 — 화면은 `lib/date.ts` 의 localDay 로 한국 날짜를 뽑아 쓴다
    PlainSerializer(iso_z, return_type=str),
]


class Schema(BaseModel):
    """파이썬 안은 snake_case, JSON 은 camelCase. 이름을 두 벌로 적지 않는다."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

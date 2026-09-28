"""프론트와 맞닿는 경계. 모든 응답 · 요청 스키마가 여기서 내려온다."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer
from pydantic.alias_generators import to_camel

from app.time import day_of

DayStamp = Annotated[
    datetime,
    # 저장은 timestamptz 인데 내보낼 때는 날짜로 자른다. 프론트 `lib/date.ts` 의 monthDay 가
    # split('-') 로 읽어서, 시각을 실어 보내면 화면에 '9월 NaN일' 이 찍힌다
    PlainSerializer(lambda moment: day_of(moment).isoformat(), return_type=str),
]


class Schema(BaseModel):
    """파이썬 안은 snake_case, JSON 은 camelCase. 이름을 두 벌로 적지 않는다."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.models.check import CHECK_TEXT_MAX
from app.schemas.base import Schema, Utc

CheckTargetType = Literal["task", "thread"]

# 한 번에 보낼 수 있는 사람 수 (docs/api/check.md 'CheckRequestInput')
RECIPIENTS_MAX = 20

CheckText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=CHECK_TEXT_MAX)
]


class CheckRequestOut(Schema):
    """domain.ts 의 `CheckRequest`. 부하 네 칸은 2차 분석만 쓰므로 내보내지 않는다."""

    id: str
    project_id: str
    # DB 의 두 칸(task_id · thread_id)을 그대로 내면 null 이 하나 더 는다
    target_type: CheckTargetType
    target_id: str
    sender_id: str
    recipient_id: str
    text: str
    created_at: Utc
    # null 이면 대기
    confirmed_at: Utc | None


class CheckRequestInput(Schema):
    # 보낸 사람은 로그인한 사람이다 — senderId 를 실어 와도 받지 않는다(모르는 키는 버린다).
    # 개수는 겹친 것을 합치기 전에 센다 — 오류 detail 의 자리(`recipientIds.1`)가 보낸 배열을 짚는다
    target_type: CheckTargetType
    target_id: str
    recipient_ids: list[str] = Field(min_length=1, max_length=RECIPIENTS_MAX)
    text: CheckText


class CheckPendingCount(Schema):
    # 내가 받은 대기 수 — 지금 부여된 프로젝트 전부의 합
    total: int
    # 대기가 하나라도 있는 프로젝트만
    by_project: dict[str, int]

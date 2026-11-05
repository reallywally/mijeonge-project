from datetime import date
from typing import Annotated, Literal

from pydantic import StringConstraints, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

AgendaState = Literal["queued", "open", "decided"]

# 앞뒤 공백을 떼고 비면 422 다(string_too_short)
AgendaTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class AgendaOut(Schema):
    id: str
    project_id: str
    title: str
    # 배경 — 왜 정해야 하나. 빈 값은 ''
    description: str
    # 결정내용 — 여러 줄 글. 빈 값은 ''
    decision: str
    state: str
    owner_id: str | None
    # 참조 — 알아야 하는 사람. 고른 순서, 빈 값은 [] (docs/api/cc.md)
    cc_ids: list[str]
    # 등록한 사람. 기록이 없던 지난 안건은 null — 수정 · 삭제 권한의 근거다
    creator_id: str | None
    due_date: date | None
    # null 이면 프로젝트 공통 (docs/api/part.md)
    part_id: str | None
    created_at: Utc
    # state 가 decided 로 바뀐 시각. decided 가 아니면 null
    decided_at: Utc | None
    # 결정 판 — 확인 요청이 가리키는 자리 (docs/api/agenda.md '결정 판')
    decision_rev: int
    # AI 정리로 등록한 회의록. 손으로 만든 것은 null (docs/api/minutes.md)
    minutes_id: str | None


class AgendaCreate(Schema):
    """등록. 제목만 필수다. `creatorId` · `decidedAt` · `decisionRev` 는 서버가 정한다."""

    title: AgendaTitle
    description: str = ""
    decision: str = ""
    state: AgendaState = "queued"
    owner_id: str | None = None
    # 겹치면 앞의 하나만 남긴다 — 서비스가 본다
    cc_ids: list[str] = []
    due_date: date | None = None
    # 안 보내면 공통(null)이다 — 작업과 달리 따를 상위가 없다
    part_id: str | None = None


class AgendaPatch(Schema):
    """부분 수정. 보낸 필드만 바꾼다 — 서비스가 `model_fields_set` 으로 읽는다."""

    title: AgendaTitle | None = None
    description: str | None = None
    decision: str | None = None
    state: AgendaState | None = None
    # null 로 보내면 비운다
    owner_id: str | None = None
    # 통째로 갈아끼운다. 비우기는 [] 다
    cc_ids: list[str] | None = None
    # null 로 보내면 비운다
    due_date: date | None = None
    # null 로 보내면 공통
    part_id: str | None = None

    @field_validator("title", "description", "decision", "state", "cc_ids")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # 기본값(None)에는 안 돈다 — 화면이 명시적으로 null 을 보낸 경우만 걸린다.
        # 이 다섯은 빈 값이 '' · [] 이거나 비울 수 없어 null 을 '비우기'로 받아 주면
        # 계약이 두 벌이 된다
        if value is None:
            raise PydanticCustomError("null_not_allowed", "null 로 비울 수 없는 값입니다.")
        return value

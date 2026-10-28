from pydantic import Field

from app.schemas.base import Schema, Utc

# bool 을 int 보다 앞에 둔다 — 검사 결과가 true/false 로 그대로 나가게.
# list[str] 는 지난 연관 작업(`relatedIds`, Q61 → Q62 로 걷음) 줄을 읽을 때만
HistoryValue = bool | int | str | list[str] | None


class HistoryChange(Schema):
    """칸 하나의 바뀜 — docs/api/history.md '칸' 표의 이름 · 값."""

    field: str
    # `from` 은 파이썬 예약어라 이름만 바꾸고 JSON 키는 그대로 둔다
    from_: HistoryValue = Field(alias="from")
    to: HistoryValue
    subject: str = ""


class HistoryEntry(Schema):
    """이력 한 줄 = 요청 하나."""

    id: str
    changed_at: Utc
    changed_by: str | None
    backfilled: bool
    changes: list[HistoryChange]

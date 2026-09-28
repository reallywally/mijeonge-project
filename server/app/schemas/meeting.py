from datetime import date

from app.schemas.base import Schema


class MeetingMemoOut(Schema):
    id: str
    text: str
    promoted_thread_id: str | None


class MeetingOut(Schema):
    id: str
    project_id: str
    title: str
    date: date
    attendee_ids: list[str]
    memos: list[MeetingMemoOut]

from app.schemas.base import DayStamp, Schema


class ThreadOut(Schema):
    id: str
    project_id: str
    title: str
    state: str
    owner_id: str | None
    parent_thread_id: str | None
    created_at: DayStamp


class EntryOut(Schema):
    """(회의 × 안건) 한 줄. meeting_id 가 null 이면 회의 밖에서 처리한 줄이다."""

    id: str
    thread_id: str
    meeting_id: str | None
    kind: str
    text: str
    # entry_detail 행을 문자열 배열로 편다 — 화면이 string[] 로 들고 있다
    detail: list[str]
    note: str
    owner_id: str | None
    created_at: DayStamp

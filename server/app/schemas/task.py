from datetime import date

from app.schemas.base import DayStamp, Schema


class TaskLineOut(Schema):
    id: str
    kind: str
    text: str
    done: bool
    level: int


class TaskOut(Schema):
    id: str
    project_id: str
    key: str
    title: str
    parent_id: str | None
    body: list[TaskLineOut]
    status: str
    owner_id: str | None
    # 둘 다 null 이면 기간 미정이다
    start: date | None
    due: date | None
    priority: str
    created_at: DayStamp


class TaskThreadLinkOut(Schema):
    task_id: str
    thread_id: str


class MeetingTaskLinkOut(Schema):
    meeting_id: str
    task_id: str

from datetime import date
from typing import Literal

from app.schemas.base import DayStamp, Schema

# 입력에서만 좁힌다 — 화면이 보낸 값이 셋 넷 중 하나인지 경계에서 걸러야 400 이 아니라 422 로 나간다
TaskStatusIn = Literal["todo", "doing", "blocked", "done"]
TaskPriorityIn = Literal["low", "normal", "high"]
TaskLineKindIn = Literal["check", "bullet"]


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


class TaskLineIn(Schema):
    """본문 한 줄. 화면이 실어 보내는 id 는 받지 않는다 — 서버가 새로 붙인다."""

    kind: TaskLineKindIn
    text: str
    done: bool = False
    level: int = 0


class TaskCreate(Schema):
    """`domain.ts` 의 TaskInput. key 는 서버가 발번한다."""

    title: str
    parent_id: str | None = None
    body: list[TaskLineIn] = []
    status: TaskStatusIn = "todo"
    owner_id: str | None = None
    start: date | None = None
    due: date | None = None
    priority: TaskPriorityIn = "normal"
    thread_ids: list[str] = []


class TaskPatch(Schema):
    """부분 수정. 안 보낸 것과 null 로 보낸 것을 가르려고 `exclude_unset` 으로 읽는다 —
    `{"ownerId": null}`(담당자 지우기)이 무시되면 화면이 조용히 안 먹는다."""

    title: str | None = None
    parent_id: str | None = None
    status: TaskStatusIn | None = None
    owner_id: str | None = None
    # 한쪽만 채우는 것도 받는다. '둘 다 있을 때만'은 간트 화면의 규칙이지 모델의 제약이 아니다
    start: date | None = None
    due: date | None = None
    priority: TaskPriorityIn | None = None


class TaskLinePatch(Schema):
    done: bool


class TaskThreadLinkOut(Schema):
    task_id: str
    thread_id: str


class MeetingTaskLinkOut(Schema):
    meeting_id: str
    task_id: str

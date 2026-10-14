from typing import Literal

from app.schemas.base import Schema
from app.schemas.task import TaskOut
from app.schemas.thread import EntryOut, ThreadOut

ThreadPlace = Literal["title", "description", "option", "entry"]
TaskPlace = Literal["title", "body"]


class ThreadHit(Schema):
    id: str
    title: str
    state: str
    matched: ThreadPlace
    snippet: str
    # 마지막 decide · change 줄의 text. 결정이 바뀐 안건은 이것이 지금의 결정이다
    decision: str


class TaskHit(Schema):
    id: str
    key: str
    title: str
    status: str
    matched: TaskPlace
    snippet: str


class SearchResult(Schema):
    threads: list[ThreadHit]
    tasks: list[TaskHit]


class LinkedTask(Schema):
    id: str
    key: str
    title: str
    status: str


class LinkedThread(Schema):
    id: str
    title: str
    state: str


# 아래 둘은 챗봇 도구(get_thread · get_task)의 결과다.
# HTTP 로는 열지 않는다 — JSON 으로 Claude 에 넘긴다


class ThreadDoc(Schema):
    """안건 하나를 읽을 때 필요한 것 전부 — 후보는 `thread.options`, 이력은 등록 순서(seq)다."""

    thread: ThreadOut
    entries: list[EntryOut]
    tasks: list[LinkedTask]


class TaskDoc(Schema):
    """작업 하나 — 본문은 `task.body`, 걸어 둔 안건은 제목 · 상태까지."""

    task: TaskOut
    threads: list[LinkedThread]
    # 바로 아래 하위 작업 — 챗봇이 하위 작업을 더할 때 이미 있는 것과 겹치지 않게 본다
    children: list[LinkedTask]

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


class ItemDoc(Schema):
    """결정 항목 하나와 그 항목의 지금 결정. 이력 줄은 `itemId` 로 이 항목을 가리킨다."""

    id: str
    title: str
    # 지우지 않은 decide · change 줄이 있으면 정해진 것이다
    decided: bool
    # 마지막 decide · change 줄의 text — 결정이 바뀐 항목은 이것이 지금의 결정이다. 없으면 ''
    decision: str


class ThreadDoc(Schema):
    """안건 하나를 읽을 때 필요한 것 전부 — 후보는 `thread.options`, 이력은 등록 순서(seq)다."""

    thread: ThreadOut
    # 지우지 않은 결정 항목 — 안건 안의 순서. 전부 정해져야 안건이 decided 다
    items: list[ItemDoc]
    entries: list[EntryOut]
    tasks: list[LinkedTask]


class TaskDoc(Schema):
    """작업 하나 — 본문은 `task.body`, 걸어 둔 안건은 제목 · 상태까지."""

    task: TaskOut
    threads: list[LinkedThread]
    # 바로 아래 하위 작업 — 챗봇이 하위 작업을 더할 때 이미 있는 것과 겹치지 않게 본다
    children: list[LinkedTask]


# 아래 둘은 챗봇의 list_tasks · find_similar_tasks 결과다 — 화면 계약이 아니다


class TaskBrief(Schema):
    """작업 한 줄 요약 — 본문 없이. 전체를 훑는 데 쓴다."""

    id: str
    key: str
    title: str
    status: str
    # 상위 작업의 키. 같은 프로젝트 안이라 키로 충분하다
    parent_key: str | None
    # 담당자 이름 — 답에 id 가 새지 않게 이름으로 준다
    owner: str | None


class TaskList(Schema):
    total: int
    # 상한을 넘어 잘렸으면 true — 앞(번호 순)에서부터 실린다
    truncated: bool
    tasks: list[TaskBrief]


class SimilarPair(Schema):
    a: TaskBrief
    b: TaskBrief
    # 0 ~ 1. 제목끼리 · (제목 + 본문)끼리의 trigram 유사도 중 큰 것
    score: float
    matched: TaskPlace
    # 계층 관계면 원래 범위가 겹친다 — 중복으로 보기 전에 본다
    relation: Literal["parent_child", "siblings"] | None

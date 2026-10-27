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
    # 이 작업이 건 연관 작업 · 이 작업을 건 작업 — 챗봇이 이어진 작업을 더할 때
    # 이미 있는 것과 겹치지 않게 본다 (Q61). 건 순서 · 등록 순
    related: list[LinkedTask]
    related_by: list[LinkedTask]


# 아래 둘은 챗봇의 list_tasks · find_similar_tasks 결과다 — 화면 계약이 아니다


class TaskBrief(Schema):
    """작업 한 줄 요약 — 본문 없이. 전체를 훑는 데 쓴다."""

    id: str
    key: str
    title: str
    status: str
    # 이 작업이 건 연관 작업의 키 — 건 순서. 같은 프로젝트 안이라 키로 충분하다
    related_keys: list[str]
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
    # 어느 한쪽이 다른 쪽을 연관으로 걸었으면 related — 사람이 이미 이어 둔 쌍이다
    relation: Literal["related"] | None

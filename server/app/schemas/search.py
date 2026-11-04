from typing import Literal

from app.schemas.agenda import AgendaOut
from app.schemas.base import Schema
from app.schemas.task import TaskOut

AgendaPlace = Literal["title", "description", "decision"]
TaskPlace = Literal["title", "body"]


class AgendaHit(Schema):
    id: str
    title: str
    state: str
    matched: AgendaPlace
    snippet: str
    # 안건의 결정내용 그대로. 없으면 ''
    decision: str


class TaskHit(Schema):
    id: str
    key: str
    title: str
    status: str
    matched: TaskPlace
    snippet: str


class SearchResult(Schema):
    agendas: list[AgendaHit]
    tasks: list[TaskHit]


class LinkedTask(Schema):
    id: str
    key: str
    title: str
    status: str


class LinkedAgenda(Schema):
    id: str
    title: str
    state: str


# 아래 둘은 챗봇 도구(get_agenda · get_task)의 결과다.
# HTTP 로는 열지 않는다 — JSON 으로 Claude 에 넘긴다


class AgendaDoc(Schema):
    """안건 하나를 읽을 때 필요한 것 전부 — 결정내용은 `agenda.decision`, 연결 작업은 등록 순."""

    agenda: AgendaOut
    tasks: list[LinkedTask]


class TaskDoc(Schema):
    """작업 하나 — 본문은 `task.body`, 걸어 둔 안건은 제목 · 상태까지."""

    task: TaskOut
    agendas: list[LinkedAgenda]
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

from datetime import date
from typing import Literal

from app.schemas.agenda import AgendaOut
from app.schemas.base import Schema, Utc
from app.schemas.task import TaskOut
from app.schemas.test import TestRefKind, TestSignal

AgendaPlace = Literal["title", "description", "decision"]
TaskPlace = Literal["title", "body"]
TestPlace = Literal["title", "content", "testData"]


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


class TestHit(Schema):
    id: str
    key: str
    title: str
    # 테스트 자체의 상태 — 묶음도 하위에서 모으지 않는다
    status: str
    matched: TestPlace
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
    # 참조의 이름 — `agenda.ccIds` 순. 챗봇이 id 대신 이름으로 말하게 (docs/api/cc.md)
    cc_names: list[str]


class TaskDoc(Schema):
    """작업 하나 — 본문은 `task.body`, 걸어 둔 안건은 제목 · 상태까지."""

    task: TaskOut
    agendas: list[LinkedAgenda]
    # 바로 아래 하위 작업 — 챗봇이 하위 작업을 더할 때 이미 있는 것과 겹치지 않게 본다
    children: list[LinkedTask]


class LinkedTest(Schema):
    id: str
    key: str
    title: str
    # 묶음이면 하위에서 모은 상태 — 화면이 보이는 것과 같다
    status: str


class TestTag(Schema):
    """테스트에 건 태그. id 는 근거 표시([[task:ID]] · [[agenda:ID]])에 쓴다."""

    kind: TestRefKind
    id: str
    # 작업이면 작업 키, 안건이면 null
    key: str | None
    title: str


class TestNote(Schema):
    """조치 내역 한 줄 — 작성자는 이름으로."""

    author: str | None
    created_at: Utc
    body: str


class TestDoc(Schema):
    """챗봇 get_test 의 결과 — 테스트 하나 (docs/api/chat.md '테스트 언급')."""

    id: str
    key: str
    title: str
    content: str
    test_data: str
    # 묶음이면 하위에서 모은 상태 · 신호, 묶음의 statusDays 는 null — 화면과 같다
    status: str
    status_days: int | None
    signals: list[TestSignal]
    parent_key: str | None
    owner: str | None
    cc_names: list[str]
    start: date | None
    due: date | None
    tags: list[TestTag]
    children: list[LinkedTest]
    # 지난 결과 메모 — 비었으면 null
    result_note: str | None
    # 등록 순, 최근 것만 (COMMENTS_MAX)
    comments: list[TestNote]


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


# 아래는 챗봇 도구 get_my_work 의 결과다 — 묻는 사람이 맡은 것만 모은다.
# daysLeft 는 오늘부터 기한까지 날 수(지났으면 음수), 기한이 없으면 null


class MyTask(Schema):
    id: str
    key: str
    title: str
    status: str
    due: date | None
    days_left: int | None


class MyTest(Schema):
    id: str
    key: str
    title: str
    status: str
    due: date | None
    days_left: int | None


class MyAgenda(Schema):
    id: str
    title: str
    state: str
    due_date: date | None
    days_left: int | None


class ChangedDecision(Schema):
    """내 작업이 걸린 안건 중 결정이 다시 바뀐 것 — 작업을 다시 봐야 할 수 있다."""

    id: str
    title: str
    decided_at: Utc | None
    # 그 안건에 걸린 내 작업의 키
    task_keys: list[str]


class MyWork(Schema):
    name: str
    tasks: list[MyTask]
    tests: list[MyTest]
    agendas: list[MyAgenda]
    changed_decisions: list[ChangedDecision]

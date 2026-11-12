"""AI 영향도 분석 — 결정이 바뀐 안건에 걸린 작업 · 테스트 · 다른 결정 (`docs/api/impact.md`).

연결 작업 · 닿는 테스트 · 다른 결정은 서버가 정해 미리 모은다(리스크 분석처럼). 연결 안 된 것은
Claude 가 읽기 도구(검색 · get_*)로 찾고, `propose_impact` 로 내며 검사에 떨어지면 까닭을
돌려받아 고쳐 낸다(회의록 초안처럼). 끝까지 받으면 늘 남긴다.
반영은 작업 · 테스트 PATCH 와 링크 · 태그 PUT 의 몸통을 한 트랜잭션으로 부른다 —
권한 · 검사 · 변경 이력 · 테스트 기준 다시 찍기가 일반 수정과 같다.
"""

import json
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterator, Collection, Sequence
from contextlib import aclosing
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import ApiError, not_found
from app.llm import LLMError, LLMProvider, Message, Reply, ToolResult, ToolSpec, UserMessage
from app.models import (
    Agenda,
    AgendaHistory,
    AgendaImpact,
    Member,
    Task,
    TaskAgendaLink,
    TestCase,
    TestRef,
)
from app.models.base import new_id
from app.schemas.impact import (
    AgendaImpactOut,
    AgendaImpactState,
    ImpactApplyInput,
    ImpactApplyResult,
    ImpactApplyTask,
    ImpactApplyTest,
    ImpactConflict,
    ImpactDoneEvent,
    ImpactErrorEvent,
    ImpactEvent,
    ImpactGetTaskInput,
    ImpactGetTestInput,
    ImpactLine,
    ImpactResultEvent,
    ImpactSearchInput,
    ImpactTask,
    ImpactTaskBefore,
    ImpactTest,
    ImpactTestBefore,
    ImpactToolEvent,
    ImpactToolName,
    ProposedImpact,
    ProposedImpactTask,
    ProposedImpactTest,
)
from app.schemas.task import TaskAgendaLinkOut, TaskLinePatchIn, TaskOut, TaskPatch
from app.schemas.test import CONTENT_MAX, TEXT_MAX, TestPatch
from app.services import access
from app.services import search as search_service
from app.services import task as task_service
from app.services import test as test_service
from app.services.access import Scope
from app.services.chat import WEEKDAYS
from app.time import as_utc, iso_z, now

log = logging.getLogger(__name__)

# Claude 에 넣는 상한 (계약 '무엇을 Claude 에 넣나')
TASKS_MAX = 40
BODY_LINES_MAX = 60
TESTS_MAX = 40
DECIDED_MAX = 80
FIELD_MAX = 4000
DECISION_MAX = 1500
CUT = "…(잘림)"
_NEVER = datetime.min.replace(tzinfo=UTC)

# 고친 안의 검사 (계약 'propose_impact 검사 규칙')
TITLE_MAX = 200
REASON_MAX = 500
SUMMARY_MAX = 1000
# 작업 PATCH 에는 본문 상한이 없다 — 영향도가 고친 안에만 거는 값이다 (impact.md '구현에서 메운 것')
LINES_MAX = 200
LINE_TEXT_MAX = 4000
LEVEL_MAX = 3

# 검사에 떨어진 안을 고쳐 낼 기회. 넘으면 IMPACT_FAILED
MAX_FAILURES = 3
# 읽기 도구(검색 · get_*)는 분석 한 번에 이만큼 — 넘으면 도구가 '더 찾을 수 없습니다' 를 돌려준다
READ_MAX = 12
# 차례 전체의 천장 — 읽기 12번을 한 차례씩 + 고쳐 내기 3번 + 멈춘 차례(paused)를 이어 부를 몫
MAX_ROUNDS = 20
# 도구로 찾은 것(넣어 준 연결 작업 · 닿는 테스트 밖)을 결과에 싣는 상한
FOUND_MAX = 20
# 서버가 미리 찾는 후보 (impact.md '서버가 먼저 찾는 후보')
# — 모델이 검색 도구를 안 불러도 놓치지 않게
TERMS_MAX = 10
TERM_HITS = 10
CANDIDATES_MAX = 20
# 낱말 끝의 조사 · 어미 — 긴 것부터 뗀다('우분투로' → '우분투')
_ENDINGS = (
    "으로",
    "에서",
    "에게",
    "한다",
    "합니다",
    "하기",
    "로",
    "을",
    "를",
    "은",
    "는",
    "이",
    "가",
    "에",
    "의",
    "도",
    "와",
    "과",
)
# 찾아 봐야 아무것에나 걸리는 낱말
_STOPWORDS = frozenset(
    {
        "결정",
        "안건",
        "한다",
        "하다",
        "사용",
        "최신",
        "버전",
        "여부",
        "검토",
        "적용",
        "진행",
        "정의",
        "확정",
        "우리",
        "모든",
        "전체",
    }
)

EMPTY_SUMMARY = "살펴볼 연결 작업 · 테스트 · 다른 결정이 없습니다."
NO_VERDICT = "판정 없음"
NO_OWNER = "담당자 없음"
FAILED_MESSAGE = "영향도를 분석하지 못했습니다. 잠시 뒤에 다시 분석해 주세요."
TOO_LONG_MESSAGE = "살펴볼 것이 많아 분석을 다 만들지 못했습니다. 잠시 뒤에 다시 분석해 주세요."
REFUSED_MESSAGE = "이 안건은 분석할 수 없습니다. 결정내용을 바꿔 다시 분석해 주세요."
NO_DECISION_MESSAGE = "결정내용이 비어 있어 분석할 수 없습니다."
STALE_MESSAGE = "결정이 바뀌어 다시 분석해야 합니다."
TARGET_CHANGED_MESSAGE = "분석 뒤에 바뀐 작업 · 테스트가 있습니다."
CHANGED = "분석 뒤에 바뀌었습니다."
GONE = "분석 뒤에 지워졌습니다."

READ_CAP_MESSAGE = "더 찾을 수 없습니다 — propose_impact 로 내세요"
# 진행 한 줄 (impact.md '도구')
SEARCH_LABEL = "관련 작업 · 테스트 찾는 중"
READ_LABEL = "관련 작업 · 테스트 읽는 중"
READ_TOOLS: dict[str, str] = {
    "search_tasks": SEARCH_LABEL,
    "search_tests": SEARCH_LABEL,
    "get_task": READ_LABEL,
    "get_test": READ_LABEL,
}

NUDGE = (
    "분석을 아직 내지 않았다. 글로 답하지 말고 propose_impact 로 내라. "
    "고칠 것 · 부딪히는 것이 없으면 작업 · 테스트를 모두 ok 로 해서 부른다."
)

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 영향도 분석 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자 메시지로 오는 것은 **결정이 바뀐 안건 하나**(결정 전 · 후)와 그 결정에 걸린
연결 작업 · 닿는 테스트, 그리고 같은 프로젝트의 다른 결정된 안건이다.
바뀐 결정 때문에 이제 틀린 것을 찾아 propose_impact 로 낸다. 너는 아무것도 저장하지 못한다 —
사람이 검토 화면에서 골라 [반영] 한다.

## 순서
1. 결정 전 · 후에서 **바뀐 값**을 먼저 뽑는다(예: 우분투 → 록키).
   결정 전이 null 이면 처음 정한 결정이다(새 결정)
2. 넣어 준 연결 작업 · 닿는 테스트를 판정한다
3. 그 안건에 **연결되지 않은** 작업 · 테스트 중에도 옛 값 · 옛 결정을 전제로 적힌 것이 있다.
   - **candidates** 는 서버가 낱말(terms)로 미리 찾아 둔 연결 안 된 작업 · 테스트다(본문까지 있다).
     **하나씩 빠짐없이** 보고, 바뀐 결정과 어긋나게 적혔으면 update(고친 안) · 애매하면 check,
     상관없으면 내지 않는다
   - candidates 로 모자라면 search_tasks · search_tests 로 더 찾는다
   - **바뀌기 전 값**, 바뀐 뒤 값, 그 주제(예: 'OS' · '운영체제')로 찾는다.
     옛 값을 적은 것이 바로 고칠 대상이다
   - 한글 · 영문 · 줄임말을 바꿔 가며 찾는다(예: 우분투 · Ubuntu, 운영체제 · OS)
   - 결정 전이 null 이면 결정이 정한 주제로 찾아, 그 결정과 **어긋나게 적힌** 것을 찾는다
   - 검색 결과의 linked 가 true 면 이미 넣어 준 것이다 — 다시 볼 것 없다
   - 읽기 도구는 모두 {read_max}번까지다. 아끼어 쓴다
4. 찾은 것의 본문 · 내용 · 테스트 데이터를 고치려면 get_task · get_test 로 **먼저 읽는다**.
   제목만 고칠 때는 검색 결과로 된다. 확실치 않으면 check
5. propose_impact 로 한 번에 낸다

## 규칙
1. summary — 결정 전 → 후 에서 **무엇이 바뀌었는지** 먼저 한두 줄로, 이어 무엇을 보면 되는지 한 줄
2. 작업 · 테스트마다 판정한다
   - 바뀐 결정 때문에 제목 · 본문(작업) · 내용 · 테스트 데이터(테스트)가
     **이제 틀렸으면** update 와 고친 안
   - 틀린지 확실치 않으면 check, 상관없으면 ok
   - 고칠 것이 없는데 update 를 내지 않는다
   - 도구로 찾은 것(넣어 준 것 밖)은 **영향이 있는 것만** update · check 로 낸다. ok 로 내지 않는다.
     작업 {found_max}개 · 테스트 {found_max}개까지
3. 고친 안은 **바뀐 결정에 닿는 부분만** 고친다.
   나머지 글 · 줄 · 체크 상태(done) · 들여쓰기(level)는 그대로 옮긴다
   - 바꿀 칸만 보낸다. 안 바꾸는 칸은 null 로 둔다
   - 작업 body 는 **본문 전체를 갈아끼운다** — 고치지 않는 줄도 다 옮겨 적는다
   - body_cut · content_cut · test_data_cut(도구에서는 bodyCut · contentCut · testDataCut)이
     true 인 칸은 잘려서 보인 것이라 고칠 수 없다(null)
4. 다른 결정된 안건과 **같이 지킬 수 없으면** conflict, 겹치거나 범위가 애매하면 check.
   상관없는 안건은 conflicts 에 내지 않는다
5. reason 은 한두 문장, **결정 전 · 후 또는 그 안건의 결정내용을 짚어서** 쓴다.
   넣어 준 것 · 도구가 돌려준 것에 없는 사실을 지어내지 않는다
6. id 는 넣어 준 것과 도구가 돌려준 것만 쓴다. 같은 id 를 두 번 내지 않는다
7. propose_impact 가 오류를 돌려주면 problems 가 짚은 자리를 고쳐 다시 부른다.
   통과하면 거기서 끝난다 — 글로 답하지 않는다
"""

_REASON = {"type": "string", "description": "근거 한두 문장 — 결정 전 · 후나 그 결정내용을 짚어서"}
_VERDICT = {
    "type": "string",
    "enum": ["update", "check", "ok"],
    "description": "update 고칠 안 · check 사람이 볼 것 · ok 그대로",
}
_FIX = {"type": ["string", "null"], "description": "update 일 때 바꿀 값. 안 바꾸면 null"}

PROPOSE_TOOL: ToolSpec = {
    "name": "propose_impact",
    "description": (
        "영향도 분석을 화면에 낸다. 저장하지 않는다 — 사람이 고르고 고쳐 [반영] 한다. "
        "틀리면 오류(problems: 자리 → 사유)로 돌려준다 — 고쳐서 다시 부른다. 통과하면 끝이다."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "무엇이 바뀌었나 · 무엇을 보면 되나"},
            "tasks": {
                "type": "array",
                "description": (
                    "넣어 준 연결 작업의 판정 + 도구로 찾은 작업 중 영향이 있는 것(update · check)"
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string"},
                        "verdict": _VERDICT,
                        "reason": _REASON,
                        "title": _FIX,
                        "body": {
                            "type": ["array", "null"],
                            "description": "update 일 때 본문 전체. 안 바꾸면 null",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "kind": {"type": "string", "enum": ["check", "bullet"]},
                                    "text": {"type": "string"},
                                    "done": {"type": "boolean"},
                                    "level": {"type": "integer", "minimum": 0, "maximum": 3},
                                },
                                "required": ["kind", "text", "done", "level"],
                            },
                        },
                    },
                    "required": ["task_id", "verdict", "reason"],
                },
            },
            "tests": {
                "type": "array",
                "description": (
                    "넣어 준 닿는 테스트의 판정 + "
                    "도구로 찾은 테스트 중 영향이 있는 것(update · check)"
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "test_id": {"type": "string"},
                        "verdict": _VERDICT,
                        "reason": _REASON,
                        "title": _FIX,
                        "content": _FIX,
                        "test_data": _FIX,
                    },
                    "required": ["test_id", "verdict", "reason"],
                },
            },
            "conflicts": {
                "type": "array",
                "description": "부딪히거나 확인이 필요한 다른 결정 안건만",
                "items": {
                    "type": "object",
                    "properties": {
                        "agenda_id": {"type": "string"},
                        "verdict": {
                            "type": "string",
                            "enum": ["conflict", "check"],
                            "description": "conflict 같이 못 지킴 · check 겹침 · 범위 애매",
                        },
                        "reason": _REASON,
                    },
                    "required": ["agenda_id", "verdict", "reason"],
                },
            },
        },
        "required": ["summary", "tasks", "tests", "conflicts"],
    },
}
_SEARCH_INPUT = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "낱말 하나나 짧은 말 — 옛 값 · 새 값 · 주제"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 20},
    },
    "required": ["query"],
}
READ_TOOL_SPECS: list[ToolSpec] = [
    {
        "name": "search_tasks",
        "description": (
            "이 프로젝트의 작업을 낱말로 찾는다 — 제목과 본문 줄을 본다. 지운 작업은 빠진다. "
            "linked 는 이 안건의 연결 작업인가(true 면 이미 넣어 준 것). "
            "matched 는 맞은 자리(title · body), snippet 은 그 한 줄."
        ),
        "input_schema": _SEARCH_INPUT,
    },
    {
        "name": "search_tests",
        "description": (
            "이 프로젝트의 테스트를 낱말로 찾는다 — "
            "제목 · 내용(content) · 테스트 데이터(testData). "
            "linked 는 이 안건에 닿는 테스트인가(true 면 이미 넣어 준 것)."
        ),
        "input_schema": _SEARCH_INPUT,
    },
    {
        "name": "get_task",
        "description": (
            f"작업 하나를 본문까지 읽는다. 본문은 {BODY_LINES_MAX}줄까지(넘으면 bodyCut true). "
            "task_id 에는 작업 id 나 키(HW-4)를 넣는다. 본문 고친 안을 내기 전에 꼭 읽는다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "get_test",
        "description": (
            f"테스트 하나를 내용 · 테스트 데이터까지 읽는다. 칸마다 {FIELD_MAX}자까지"
            "(넘으면 contentCut · testDataCut true). test_id 에는 테스트 id 나 키(HW-T3)를 넣는다. "
            "내용 · 테스트 데이터 고친 안을 내기 전에 꼭 읽는다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"test_id": {"type": "string"}},
            "required": ["test_id"],
        },
    },
]
TOOLS: list[ToolSpec] = [*READ_TOOL_SPECS, PROPOSE_TOOL]


def _impact_not_found() -> ApiError:
    return not_found("IMPACT_NOT_FOUND", "영향도 분석을 찾을 수 없습니다.")


def _invalid(problems: dict[str, str]) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", problems)


def _cut(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[: limit - len(CUT)] + CUT, True


# --- 근거 모으기 ---


@dataclass
class TaskSnap:
    id: str
    seq: int
    key: str
    title: str
    status: str
    # 담당자 이름 — 없으면 None. 사용자 메시지는 '담당자 없음' 으로 적는다
    owner: str | None
    due: date | None
    # 분석 때의 본문 전체 — before 가 된다. Claude 에는 앞 60줄만 간다
    lines: list[ImpactLine]

    @property
    def body_cut(self) -> bool:
        return len(self.lines) > BODY_LINES_MAX


@dataclass
class TestSnap:
    id: str
    seq: int
    key: str
    title: str
    status: str
    owner: str | None
    content: str
    test_data: str

    @property
    def cut(self) -> set[str]:
        """잘려서 보인 칸(자리 이름) — 그 칸은 고친 안을 받지 않는다."""
        return {
            place
            for place, value in (("content", self.content), ("testData", self.test_data))
            if len(value) > FIELD_MAX
        }


@dataclass
class DecidedSnap:
    id: str
    title: str
    decision: str
    decided_at: datetime | None


@dataclass
class ImpactContext:
    """스트림을 열기 전에 떠 둔 것 — rollback 이 ORM 객체를 만료시킨다."""

    project_id: str
    project_name: str
    agenda_id: str
    title: str
    description: str
    state: str
    owner: str
    decision_rev: int
    before: str | None
    after: str
    tasks: list[TaskSnap] = field(default_factory=list)
    tests: list[TestSnap] = field(default_factory=list)
    others: list[DecidedSnap] = field(default_factory=list)
    # 상한 없이 다 — 도구가 돌려주는 linked 와 결과 줄의 linked 가 이것을 본다
    linked_task_ids: set[str] = field(default_factory=set)
    reached_test_ids: set[str] = field(default_factory=set)
    # 서버가 낱말로 미리 찾은 연결 안 된 작업 · 테스트 — 본문까지 넣어 준다(읽은 것으로 친다)
    terms: list[str] = field(default_factory=list)
    candidate_tasks: list[TaskSnap] = field(default_factory=list)
    candidate_tests: list[TestSnap] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not (
            self.tasks or self.tests or self.others or self.candidate_tasks or self.candidate_tests
        )


@dataclass
class Found:
    """분석 한 번에 읽기 도구가 돌려준 것 — 지어낸 id 와 읽지 않은 본문 갈아끼우기를 막는다.

    스냅샷은 도구가 돌려준 때의 DB 값이다(나중에 다시 돌려주면 새 값으로) — before 가 된다."""

    tasks: dict[str, TaskSnap] = field(default_factory=dict)
    tests: dict[str, TestSnap] = field(default_factory=dict)
    # get_task · get_test 로 본문 · 내용까지 읽은 것
    read_tasks: set[str] = field(default_factory=set)
    read_tests: set[str] = field(default_factory=set)
    reads: int = 0


async def decision_before(session: AsyncSession, agenda_id: str) -> str | None:
    """결정내용 칸이 바뀐 가장 최근 이력 줄의 `from`. 없거나 빈 글이면(처음 결정) null."""
    rows = await session.scalars(
        select(AgendaHistory.changes)
        .where(AgendaHistory.agenda_id == agenda_id)
        .order_by(AgendaHistory.seq.desc())
    )
    for changes in rows.all():
        for change in changes:
            if change.get("field") == "decision":
                value = change.get("from")
                text = value.strip() if isinstance(value, str) else ""
                return text or None
    return None


def _linked_tasks(agenda_id: str) -> Select[tuple[Task]]:
    return (
        select(Task)
        .join(TaskAgendaLink, TaskAgendaLink.task_id == Task.id)
        .where(TaskAgendaLink.agenda_id == agenda_id, Task.is_deleted.is_(False))
        .order_by(Task.seq)
    )


def _reached_tests(agenda_id: str, task_ids: Collection[str]) -> Select[tuple[TestCase]]:
    """이 안건을 직접 태그했거나 이 안건에 걸린 작업을 태그한 테스트 — `test._reached` 의 거꾸로."""
    tagged = select(TestRef.test_id).where(
        or_(TestRef.agenda_id == agenda_id, TestRef.task_id.in_(task_ids))
    )
    return select(TestCase).where(TestCase.id.in_(tagged)).order_by(TestCase.seq)


async def _other_decided(session: AsyncSession, project_id: str, agenda_id: str) -> list[Agenda]:
    """같은 프로젝트의 결정된 다른 안건 중 결정내용이 있는 것 — 결정 시각 최신 순."""
    rows = await session.scalars(
        select(Agenda).where(
            Agenda.project_id == project_id,
            Agenda.id != agenda_id,
            Agenda.state == "decided",
            Agenda.is_deleted.is_(False),
        )
    )
    found = [row for row in rows.all() if row.decision.strip()]
    # 같은 시각이면 나중에 등록한 것부터, 결정 시각이 없는 줄(지난 데이터)은 맨 뒤로
    found.sort(key=lambda row: row.seq, reverse=True)
    found.sort(key=lambda row: as_utc(row.decided_at) if row.decided_at else _NEVER, reverse=True)
    return found


async def impact_state(session: AsyncSession, agenda_id: str) -> AgendaImpactState:
    agenda = await _load_agenda(session, agenda_id)
    tasks = list((await session.scalars(_linked_tasks(agenda.id))).all())
    task_ids = [task.id for task in tasks]
    test_count = await session.scalar(
        select(func.count()).select_from(_reached_tests(agenda.id, task_ids).subquery())
    )
    others = await _other_decided(session, agenda.project_id, agenda.id)
    latest = await session.scalar(
        select(AgendaImpact)
        .where(AgendaImpact.agenda_id == agenda.id)
        .order_by(AgendaImpact.created_at.desc())
        .limit(1)
    )
    return AgendaImpactState(
        latest=to_impact(latest) if latest is not None else None,
        task_count=len(tasks),
        test_count=test_count or 0,
        decided_agenda_count=len(others),
    )


async def _load_agenda(session: AsyncSession, agenda_id: str) -> Agenda:
    found = await session.scalar(
        select(Agenda).where(Agenda.id == agenda_id, Agenda.is_deleted.is_(False))
    )
    if found is None:
        raise not_found("AGENDA_NOT_FOUND", "안건을 찾을 수 없습니다.")
    return found


async def load_for_analysis(session: AsyncSession, agenda_id: str) -> Agenda:
    """결정내용이 빈 안건은 분석하지 않는다 — Claude 를 부르기 전에 409."""
    agenda = await _load_agenda(session, agenda_id)
    if not agenda.decision.strip():
        raise ApiError(409, "IMPACT_NO_DECISION", NO_DECISION_MESSAGE)
    return agenda


async def _names(session: AsyncSession, ids: Collection[str | None]) -> dict[str, str]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await session.execute(select(Member.id, Member.name).where(Member.id.in_(wanted)))
    return {row.id: row.name for row in rows}


def _lines(task: Task) -> list[ImpactLine]:
    return [
        ImpactLine.model_validate(
            {"kind": line.kind, "text": line.text, "done": line.done, "level": line.level}
        )
        for line in task.lines
    ]


def _task_snap(task: Task, owner: str | None) -> TaskSnap:
    return TaskSnap(
        id=task.id,
        seq=task.seq,
        key=task.key,
        title=task.title,
        status=task.status,
        owner=owner,
        due=task.due,
        lines=_lines(task),
    )


def _test_snap(test: TestCase, owner: str | None) -> TestSnap:
    return TestSnap(
        id=test.id,
        seq=test.seq,
        key=test.key,
        title=test.title,
        status=test.status,
        owner=owner,
        content=test.content,
        test_data=test.test_data,
    )


def _words(text: str) -> list[str]:
    """글을 낱말로 — 조사 · 어미를 떼고, 한 글자 · 흔한 낱말은 뺀다. 나온 순서, 겹치면 하나."""
    out: list[str] = []
    for raw in re.findall(r"[0-9A-Za-z가-힣]+", text):
        word = raw
        for ending in _ENDINGS:
            if word.endswith(ending) and len(word) - len(ending) >= 2:
                word = word[: -len(ending)]
                break
        if len(word) < 2 or word in _STOPWORDS:
            continue
        if word.lower() not in (w.lower() for w in out):
            out.append(word)
    return out


def search_terms(title: str, before: str | None, after: str, others: Sequence[Agenda]) -> list[str]:
    """미리 찾을 낱말 — 옛 결정 → 주제가 겹치는 다른 결정 안건의 결정 → 제목 → 그 안건들의 제목 →
    새 결정 순.

    옛 값을 적은 작업이 바로 고칠 대상이라 옛 값을 앞에 둔다. 처음 결정이면(전 없음) 제목이
    겹치는 다른 결정된 안건의 결정이 사실상의 옛 값이다('server os' 의 록키 ↔ '서버 OS' 의 우분투).
    그 안건들의 제목은 한 · 영이 갈린 주제어를 채운다(server ↔ 서버).
    """
    title_words = {w.lower() for w in _words(title)}
    related = [a for a in others if title_words & {w.lower() for w in _words(a.title)}]
    out: list[str] = []
    texts = [before or "", *(a.decision for a in related), title, *(a.title for a in related)]
    for text in [*texts, after]:
        for word in _words(text):
            if word.lower() not in (w.lower() for w in out):
                out.append(word)
    return out[:TERMS_MAX]


async def _candidates(
    session: AsyncSession,
    project_id: str,
    terms: Sequence[str],
    linked: Collection[str],
    reached: Collection[str],
) -> tuple[list[Task], list[TestCase]]:
    """낱말마다 검색해 연결 안 된 것만 — 먼저 걸린 순, 각 CANDIDATES_MAX 개까지."""
    if session.get_bind().dialect.name != "postgresql":
        # 검색은 pg_trgm 이다 — sqlite 위의 검사에서는 건너뛴다(찾는 것은 pg 검사가 본다)
        return [], []
    task_ids: list[str] = []
    test_ids: list[str] = []
    for term in terms:
        try:
            task_hits = await search_service.search_tasks(
                session, project_id, term, limit=TERM_HITS
            )
            test_hits = await search_service.search_tests(
                session, project_id, term, limit=TERM_HITS
            )
        except ApiError:
            continue
        task_ids += [h.id for h in task_hits if h.id not in linked and h.id not in task_ids]
        test_ids += [h.id for h in test_hits if h.id not in reached and h.id not in test_ids]
    task_ids, test_ids = task_ids[:CANDIDATES_MAX], test_ids[:CANDIDATES_MAX]
    tasks = (await session.scalars(select(Task).where(Task.id.in_(task_ids)))).all()
    tests = (await session.scalars(select(TestCase).where(TestCase.id.in_(test_ids)))).all()
    return (
        sorted(tasks, key=lambda t: t.seq),
        sorted(tests, key=lambda t: t.seq),
    )


async def build_context(session: AsyncSession, agenda: Agenda, project_name: str) -> ImpactContext:
    try:
        tasks = list((await session.scalars(_linked_tasks(agenda.id))).all())
        # 닿는 테스트는 상한 밖의 연결 작업까지 보고 고른다 — 상한은 테스트 수에만 건다
        tests = list(
            (await session.scalars(_reached_tests(agenda.id, [t.id for t in tasks]))).all()
        )
        others = (await _other_decided(session, agenda.project_id, agenda.id))[:DECIDED_MAX]
        before = await decision_before(session, agenda.id)
        terms = search_terms(agenda.title, before, agenda.decision, others)
        found_tasks, found_tests = await _candidates(
            session,
            agenda.project_id,
            terms,
            {t.id for t in tasks},
            {t.id for t in tests},
        )
        names = await _names(
            session,
            [
                agenda.owner_id,
                *(t.owner_id for t in tasks[:TASKS_MAX]),
                *(t.owner_id for t in tests[:TESTS_MAX]),
                *(t.owner_id for t in found_tasks),
                *(t.owner_id for t in found_tests),
            ],
        )

        def who(member_id: str | None) -> str | None:
            return names.get(member_id) if member_id is not None else None

        return ImpactContext(
            project_id=agenda.project_id,
            project_name=project_name,
            agenda_id=agenda.id,
            title=agenda.title,
            description=agenda.description,
            state=agenda.state,
            owner=who(agenda.owner_id) or NO_OWNER,
            decision_rev=agenda.decision_rev,
            before=before,
            after=agenda.decision.strip(),
            tasks=[_task_snap(t, who(t.owner_id)) for t in tasks[:TASKS_MAX]],
            tests=[_test_snap(t, who(t.owner_id)) for t in tests[:TESTS_MAX]],
            others=[
                DecidedSnap(
                    id=a.id, title=a.title, decision=a.decision.strip(), decided_at=a.decided_at
                )
                for a in others
            ],
            linked_task_ids={t.id for t in tasks},
            reached_test_ids={t.id for t in tests},
            terms=terms,
            candidate_tasks=[_task_snap(t, who(t.owner_id)) for t in found_tasks],
            candidate_tests=[_test_snap(t, who(t.owner_id)) for t in found_tests],
        )
    finally:
        # 읽기만 한다 — Claude 를 부르는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


def user_message(context: ImpactContext) -> str:
    def text(value: str) -> str:
        return _cut(value, FIELD_MAX)[0]

    def task_doc(t: TaskSnap) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "id": t.id,
            "key": t.key,
            "title": t.title,
            "status": t.status,
            "owner": t.owner or NO_OWNER,
            "due": t.due.isoformat() if t.due else None,
            "body": [line.model_dump() for line in t.lines[:BODY_LINES_MAX]],
        }
        if t.body_cut:
            doc["body_cut"] = True
        return doc

    def test_doc(t: TestSnap) -> dict[str, Any]:
        content, content_cut = _cut(t.content, FIELD_MAX)
        test_data, data_cut = _cut(t.test_data, FIELD_MAX)
        doc: dict[str, Any] = {
            "id": t.id,
            "key": t.key,
            "title": t.title,
            "status": t.status,
            "owner": t.owner or NO_OWNER,
            "content": content,
            "test_data": test_data,
        }
        if content_cut:
            doc["content_cut"] = True
        if data_cut:
            doc["test_data_cut"] = True
        return doc

    payload = {
        "agenda": {
            "id": context.agenda_id,
            "title": text(context.title),
            "description": text(context.description),
            "state": context.state,
            "owner": context.owner,
            "decision_before": text(context.before) if context.before is not None else None,
            "decision_after": text(context.after),
        },
        "tasks": [task_doc(t) for t in context.tasks],
        "tests": [test_doc(t) for t in context.tests],
        "decided_agendas": [
            {
                "id": a.id,
                "title": a.title,
                "decision": _cut(a.decision, DECISION_MAX)[0],
                "decided_at": iso_z(a.decided_at) if a.decided_at else None,
            }
            for a in context.others
        ],
    }
    if context.candidate_tasks or context.candidate_tests:
        payload["candidates"] = {
            "terms": context.terms,
            "tasks": [task_doc(t) for t in context.candidate_tasks],
            "tests": [test_doc(t) for t in context.candidate_tests],
        }
    data = json.dumps(payload, ensure_ascii=False)
    return f"결정이 바뀐 안건과 그 결정에 걸린 것들이다. 규칙대로 판정해 내라.\n\n{data}"


def system_prompt(project_name: str, today: date) -> str:
    return SYSTEM_PROMPT.format(
        project_name=project_name,
        today=f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})",
        read_max=READ_MAX,
        found_max=FOUND_MAX,
    )


# --- 읽기 도구 — 연결 안 된 작업 · 테스트를 찾는다 (impact.md '도구') ---


def _tool_error(message: str) -> str:
    return json.dumps({"error": message}, ensure_ascii=False)


async def _snap_tasks(session: AsyncSession, found: Found, tasks: Sequence[Task]) -> list[TaskSnap]:
    names = await _names(session, [t.owner_id for t in tasks])
    snaps = [_task_snap(t, names.get(t.owner_id) if t.owner_id else None) for t in tasks]
    found.tasks |= {snap.id: snap for snap in snaps}
    return snaps


async def _snap_tests(
    session: AsyncSession, found: Found, tests: Sequence[TestCase]
) -> list[TestSnap]:
    names = await _names(session, [t.owner_id for t in tests])
    snaps = [_test_snap(t, names.get(t.owner_id) if t.owner_id else None) for t in tests]
    found.tests |= {snap.id: snap for snap in snaps}
    return snaps


async def _search_tasks(
    session: AsyncSession, context: ImpactContext, found: Found, raw: object
) -> dict[str, Any]:
    args = ImpactSearchInput.model_validate(raw)
    hits = await search_service.search_tasks(
        session, context.project_id, args.query, limit=args.limit
    )
    rows = (await session.scalars(select(Task).where(Task.id.in_([h.id for h in hits])))).all()
    snaps = {snap.id: snap for snap in await _snap_tasks(session, found, rows)}
    return {
        "tasks": [
            {
                "id": hit.id,
                "key": hit.key,
                "title": hit.title,
                "status": hit.status,
                "ownerName": snaps[hit.id].owner,
                "linked": hit.id in context.linked_task_ids,
                "matched": hit.matched,
                "snippet": hit.snippet,
            }
            for hit in hits
        ]
    }


async def _search_tests(
    session: AsyncSession, context: ImpactContext, found: Found, raw: object
) -> dict[str, Any]:
    args = ImpactSearchInput.model_validate(raw)
    hits = await search_service.search_tests(
        session, context.project_id, args.query, limit=args.limit
    )
    rows = (
        await session.scalars(select(TestCase).where(TestCase.id.in_([h.id for h in hits])))
    ).all()
    snaps = {snap.id: snap for snap in await _snap_tests(session, found, rows)}
    return {
        "tests": [
            {
                "id": hit.id,
                "key": hit.key,
                "title": hit.title,
                "status": hit.status,
                "ownerName": snaps[hit.id].owner,
                "linked": hit.id in context.reached_test_ids,
                "matched": hit.matched,
                "snippet": hit.snippet,
            }
            for hit in hits
        ]
    }


async def _get_task(
    session: AsyncSession, context: ImpactContext, found: Found, raw: object
) -> dict[str, Any] | None:
    args = ImpactGetTaskInput.model_validate(raw)
    # 프로젝트로 먼저 거른다 — 다른 프로젝트의 id 를 넣어도 못 읽는다
    task = await session.scalar(
        select(Task).where(
            Task.project_id == context.project_id,
            or_(Task.id == args.task_id, Task.key == args.task_id.strip().upper()),
            Task.is_deleted.is_(False),
        )
    )
    if task is None:
        return None
    (snap,) = await _snap_tasks(session, found, [task])
    found.read_tasks.add(snap.id)
    return {
        "id": snap.id,
        "key": snap.key,
        "title": snap.title,
        "status": snap.status,
        "ownerName": snap.owner,
        "due": snap.due.isoformat() if snap.due else None,
        "linked": snap.id in context.linked_task_ids,
        "body": [line.model_dump() for line in snap.lines[:BODY_LINES_MAX]],
        "bodyCut": snap.body_cut,
    }


async def _get_test(
    session: AsyncSession, context: ImpactContext, found: Found, raw: object
) -> dict[str, Any] | None:
    args = ImpactGetTestInput.model_validate(raw)
    test = await session.scalar(
        select(TestCase).where(
            TestCase.project_id == context.project_id,
            or_(TestCase.id == args.test_id, TestCase.key == args.test_id.strip().upper()),
        )
    )
    if test is None:
        return None
    (snap,) = await _snap_tests(session, found, [test])
    found.read_tests.add(snap.id)
    content, content_cut = _cut(snap.content, FIELD_MAX)
    test_data, data_cut = _cut(snap.test_data, FIELD_MAX)
    return {
        "id": snap.id,
        "key": snap.key,
        "title": snap.title,
        "status": snap.status,
        "ownerName": snap.owner,
        "linked": snap.id in context.reached_test_ids,
        "content": content,
        "contentCut": content_cut,
        "testData": test_data,
        "testDataCut": data_cut,
    }


async def run_read_tool(
    session: AsyncSession, context: ImpactContext, found: Found, name: str, raw: object
) -> tuple[str, bool]:
    """(결과 JSON, 오류인가). 없는 id · 키 · 틀린 입력은 오류로 돌려주고 분석은 잇는다."""
    try:
        match name:
            case "search_tasks":
                doc: dict[str, Any] | None = await _search_tasks(session, context, found, raw)
            case "search_tests":
                doc = await _search_tests(session, context, found, raw)
            case "get_task":
                doc = await _get_task(session, context, found, raw)
                if doc is None:
                    return _tool_error("작업을 찾을 수 없습니다."), True
            case "get_test":
                doc = await _get_test(session, context, found, raw)
                if doc is None:
                    return _tool_error("테스트를 찾을 수 없습니다."), True
            case _:
                return _tool_error(f"없는 도구다: {name}"), True
        return json.dumps(doc, ensure_ascii=False), False
    except ApiError as exc:
        return _tool_error(exc.message), True
    except ValidationError as exc:
        return _tool_error(f"입력이 올바르지 않다: {exc.errors(include_url=False)}"), True
    finally:
        # 읽기만 한다 — 다음 차례를 기다리는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


# --- 고친 안 검사 — Claude 의 안과 반영 요청이 같은 규칙을 탄다 ---


def _line_key(line: ImpactLine) -> tuple[str, str, bool, int]:
    return (line.kind, line.text, line.done, line.level)


def _same_body(a: Sequence[ImpactLine], b: Sequence[ImpactLine]) -> bool:
    return [_line_key(x) for x in a] == [_line_key(x) for x in b]


def _title_problem(title: str) -> str | None:
    stripped = title.strip()
    if not stripped:
        return "제목을 입력해 주세요."
    if len(stripped) > TITLE_MAX:
        return f"제목은 {TITLE_MAX}자까지입니다."
    return None


def _body_problems(at: str, body: Sequence[ImpactLine]) -> dict[str, str]:
    if len(body) > LINES_MAX:
        return {at: f"본문은 {LINES_MAX}줄까지입니다."}
    problems: dict[str, str] = {}
    for index, line in enumerate(body):
        if len(line.text) > LINE_TEXT_MAX:
            problems[f"{at}.{index}.text"] = f"한 줄은 {LINE_TEXT_MAX}자까지입니다."
        if not 0 <= line.level <= LEVEL_MAX:
            problems[f"{at}.{index}.level"] = f"들여쓰기는 0 ~ {LEVEL_MAX} 입니다."
    return problems


def task_fix_problems(
    at: str,
    title: str | None,
    body: Sequence[ImpactLine] | None,
    before: ImpactTaskBefore,
    *,
    every_field_differs: bool,
    body_cut: bool = False,
) -> dict[str, str]:
    """작업 고친 안 한 줄. Claude 의 안은 보낸 칸마다 before 와 달라야 하고(`every_field_differs`),
    반영은 하나만 달라도 된다 — 화면에서 고쳐 되돌린 칸이 있을 수 있다."""
    problems: dict[str, str] = {}
    if title is None and body is None:
        return {at: "고칠 칸(title · body)이 하나도 없습니다."}
    differs: list[bool] = []
    if title is not None:
        found = _title_problem(title)
        if found:
            problems[f"{at}.title"] = found
        same = title.strip() == before.title
        differs.append(not same)
        if same and every_field_differs:
            problems[f"{at}.title"] = "지금 제목과 같습니다 — 안 바꾸는 칸은 null 로 둡니다."
    if body is not None:
        if body_cut:
            problems[f"{at}.body"] = "본문이 잘려서 보였습니다 — 본문은 고칠 수 없습니다."
        problems |= _body_problems(f"{at}.body", body)
        same = _same_body(body, before.body)
        differs.append(not same)
        if same and every_field_differs:
            problems[f"{at}.body"] = "지금 본문과 같습니다 — 안 바꾸는 칸은 null 로 둡니다."
    if not problems and not any(differs):
        problems[at] = "지금 값과 다른 칸이 없습니다."
    return problems


TEST_FIELDS: tuple[tuple[str, str, int], ...] = (
    # (파이썬 이름, 자리 이름, 상한)
    ("content", "content", CONTENT_MAX),
    ("test_data", "testData", TEXT_MAX),
)


def test_fix_problems(
    at: str,
    values: dict[str, str | None],
    before: ImpactTestBefore,
    *,
    every_field_differs: bool,
    cut: Collection[str] = (),
) -> dict[str, str]:
    """테스트 고친 안 한 줄 — 테스트 PATCH 와 같은 상한. `values` 는 title · content · test_data."""
    if all(value is None for value in values.values()):
        return {at: "고칠 칸(title · content · testData)이 하나도 없습니다."}
    problems: dict[str, str] = {}
    differs: list[bool] = []
    title = values.get("title")
    if title is not None:
        found = _title_problem(title)
        if found:
            problems[f"{at}.title"] = found
        same = title.strip() == before.title
        differs.append(not same)
        if same and every_field_differs:
            problems[f"{at}.title"] = "지금 제목과 같습니다 — 안 바꾸는 칸은 null 로 둡니다."
    for name, place, limit in TEST_FIELDS:
        value = values.get(name)
        if value is None:
            continue
        if place in cut:
            problems[f"{at}.{place}"] = "잘려서 보인 칸이라 고칠 수 없습니다."
        if len(value) > limit:
            problems[f"{at}.{place}"] = f"{limit}자까지입니다."
        same = value == getattr(before, name)
        differs.append(not same)
        if same and every_field_differs:
            problems[f"{at}.{place}"] = "지금 값과 같습니다 — 안 바꾸는 칸은 null 로 둡니다."
    if not problems and not any(differs):
        problems[at] = "지금 값과 다른 칸이 없습니다."
    return problems


def _reason_problem(reason: str) -> str | None:
    stripped = reason.strip()
    if not stripped:
        return "근거를 적어 주세요."
    if len(stripped) > REASON_MAX:
        return f"근거는 {REASON_MAX}자까지입니다."
    return None


@dataclass
class Checked:
    """propose_impact 한 번의 결과. result 가 있으면 통과."""

    content: str
    is_error: bool
    result: "Built | None" = None


@dataclass
class Built:
    summary: str
    tasks: list[ImpactTask]
    tests: list[ImpactTest]
    conflicts: list[ImpactConflict]


def _task_before(t: TaskSnap) -> ImpactTaskBefore:
    return ImpactTaskBefore(title=t.title, body=t.lines)


def _test_before(t: TestSnap) -> ImpactTestBefore:
    return ImpactTestBefore(title=t.title, content=t.content, test_data=t.test_data)


FOUND_OK = "상관없는 것은 내지 마세요 — 도구로 찾은 것은 영향이 있는 것만 update · check 로 냅니다."


def _problems(context: ImpactContext, proposed: ProposedImpact, found: Found) -> dict[str, str]:
    problems: dict[str, str] = {}
    summary = proposed.summary.strip()
    if not summary:
        problems["summary"] = "요약을 적어 주세요."
    elif len(summary) > SUMMARY_MAX:
        problems["summary"] = f"요약은 {SUMMARY_MAX}자까지입니다."

    tasks = {t.id: t for t in context.tasks}
    seen: set[str] = set()
    found_count = 0
    for index, item in enumerate(proposed.tasks):
        at = f"tasks.{index}"
        # 넣어 준 것 밖은 이 분석에서 도구가 돌려준 것만 — 지어낸 id 를 막는다
        snap = tasks.get(item.task_id)
        from_tool = snap is None
        if snap is None:
            snap = found.tasks.get(item.task_id)
        if snap is None:
            problems[f"{at}.taskId"] = "넣어 준 연결 작업도, 도구가 돌려준 작업도 아닙니다."
            continue
        if item.task_id in seen:
            problems[f"{at}.taskId"] = "같은 작업을 두 번 냈습니다."
            continue
        seen.add(item.task_id)
        found_count += from_tool
        if bad := _reason_problem(item.reason):
            problems[f"{at}.reason"] = bad
        if from_tool and item.verdict == "ok":
            problems[f"{at}.verdict"] = FOUND_OK
        if item.verdict == "update":
            problems |= task_fix_problems(
                at,
                item.title,
                item.body,
                _task_before(snap),
                every_field_differs=True,
                body_cut=snap.body_cut,
            )
            # 검색 결과의 한 줄 조각만 보고 본문 전체를 갈아끼우지 않게
            if from_tool and item.body is not None and snap.id not in found.read_tasks:
                problems[f"{at}.body"] = "본문을 고치려면 get_task 로 먼저 읽어야 합니다."
        elif item.title is not None or item.body is not None:
            problems[at] = "update 가 아니면 고칠 칸을 보내지 않습니다."
    if found_count > FOUND_MAX:
        problems["tasks"] = f"도구로 찾은 작업은 {FOUND_MAX}개까지 냅니다."

    tests = {t.id: t for t in context.tests}
    seen = set()
    found_count = 0
    for index, test in enumerate(proposed.tests):
        at = f"tests.{index}"
        tsnap = tests.get(test.test_id)
        from_tool = tsnap is None
        if tsnap is None:
            tsnap = found.tests.get(test.test_id)
        if tsnap is None:
            problems[f"{at}.testId"] = "넣어 준 테스트도, 도구가 돌려준 테스트도 아닙니다."
            continue
        if test.test_id in seen:
            problems[f"{at}.testId"] = "같은 테스트를 두 번 냈습니다."
            continue
        seen.add(test.test_id)
        found_count += from_tool
        if bad := _reason_problem(test.reason):
            problems[f"{at}.reason"] = bad
        if from_tool and test.verdict == "ok":
            problems[f"{at}.verdict"] = FOUND_OK
        values = {"title": test.title, "content": test.content, "test_data": test.test_data}
        if test.verdict == "update":
            problems |= test_fix_problems(
                at, values, _test_before(tsnap), every_field_differs=True, cut=tsnap.cut
            )
            if from_tool and tsnap.id not in found.read_tests:
                for name, place, _ in TEST_FIELDS:
                    if values[name] is not None:
                        problems[f"{at}.{place}"] = (
                            "내용 · 테스트 데이터를 고치려면 get_test 로 먼저 읽어야 합니다."
                        )
        elif any(value is not None for value in values.values()):
            problems[at] = "update 가 아니면 고칠 칸을 보내지 않습니다."
    if found_count > FOUND_MAX:
        problems["tests"] = f"도구로 찾은 테스트는 {FOUND_MAX}개까지 냅니다."

    others = {a.id for a in context.others}
    seen = set()
    for index, conflict in enumerate(proposed.conflicts):
        at = f"conflicts.{index}"
        if conflict.agenda_id not in others:
            problems[f"{at}.agendaId"] = "넣어 준 다른 결정 안건이 아닙니다."
            continue
        if conflict.agenda_id in seen:
            problems[f"{at}.agendaId"] = "같은 안건을 두 번 냈습니다."
            continue
        seen.add(conflict.agenda_id)
        if bad := _reason_problem(conflict.reason):
            problems[f"{at}.reason"] = bad
    return problems


def _impact_task(snap: TaskSnap, item: ProposedImpactTask | None, linked: bool) -> ImpactTask:
    if item is None:
        return ImpactTask(
            task_id=snap.id,
            verdict="ok",
            reason=NO_VERDICT,
            before=_task_before(snap),
            linked=linked,
        )
    update = item.verdict == "update"
    return ImpactTask(
        task_id=snap.id,
        verdict=item.verdict,
        reason=item.reason.strip(),
        title=item.title.strip() if update and item.title is not None else None,
        body=item.body if update else None,
        before=_task_before(snap),
        linked=linked,
    )


def _impact_test(snap: TestSnap, item: ProposedImpactTest | None, linked: bool) -> ImpactTest:
    if item is None:
        return ImpactTest(
            test_id=snap.id,
            verdict="ok",
            reason=NO_VERDICT,
            before=_test_before(snap),
            linked=linked,
        )
    update = item.verdict == "update"
    return ImpactTest(
        test_id=snap.id,
        verdict=item.verdict,
        reason=item.reason.strip(),
        title=item.title.strip() if update and item.title is not None else None,
        content=item.content if update else None,
        test_data=item.test_data if update else None,
        before=_test_before(snap),
        linked=linked,
    )


def _build(context: ImpactContext, proposed: ProposedImpact, found: Found) -> Built:
    """검사를 통과한 안 → 남길 모양. 넣어 준 작업 · 테스트는 판정이 빠져도 ok 로 채워 다 싣고,
    도구로 찾은 것은 그 뒤에 seq 순으로 붙인다."""
    by_task = {item.task_id: item for item in proposed.tasks}
    by_test = {item.test_id: item for item in proposed.tests}
    decisions = {a.id: a.decision for a in context.others}

    given_tasks = {snap.id for snap in context.tasks}
    tasks = [_impact_task(snap, by_task.get(snap.id), True) for snap in context.tasks]
    extra_tasks = sorted(
        (found.tasks[i] for i in by_task if i not in given_tasks), key=lambda snap: snap.seq
    )
    tasks += [
        _impact_task(snap, by_task[snap.id], snap.id in context.linked_task_ids)
        for snap in extra_tasks
    ]

    given_tests = {snap.id for snap in context.tests}
    tests = [_impact_test(snap, by_test.get(snap.id), True) for snap in context.tests]
    extra_tests = sorted(
        (found.tests[i] for i in by_test if i not in given_tests), key=lambda snap: snap.seq
    )
    tests += [
        _impact_test(snap, by_test[snap.id], snap.id in context.reached_test_ids)
        for snap in extra_tests
    ]
    return Built(
        summary=proposed.summary.strip(),
        tasks=tasks,
        tests=tests,
        conflicts=[
            ImpactConflict(
                agenda_id=c.agenda_id,
                verdict=c.verdict,
                reason=c.reason.strip(),
                decision=decisions[c.agenda_id],
            )
            for c in proposed.conflicts
        ],
    )


def check_proposal(context: ImpactContext, raw: object, found: Found | None = None) -> Checked:
    """propose_impact. DB 를 보지 않는다 — 넣어 준 것(context)과 도구가 돌려준 것(found)만 본다."""
    found = found if found is not None else Found()
    try:
        proposed = ProposedImpact.model_validate(raw)
    except ValidationError as exc:
        return Checked(
            content=json.dumps(
                {"error": f"입력이 올바르지 않다: {exc.errors(include_url=False)}"},
                ensure_ascii=False,
                default=str,
            ),
            is_error=True,
        )
    problems = _problems(context, proposed, found)
    if problems:
        return Checked(
            content=json.dumps(
                {"error": "분석이 올바르지 않다. 고쳐서 다시 불러라.", "problems": problems},
                ensure_ascii=False,
            ),
            is_error=True,
        )
    return Checked(
        content=json.dumps({"ok": True}), is_error=False, result=_build(context, proposed, found)
    )


# --- 남기기 · 읽기 ---


def _result_doc(
    tasks: Sequence[ImpactTask], tests: Sequence[ImpactTest], conflicts: Sequence[ImpactConflict]
) -> dict[str, Any]:
    return {
        "tasks": [t.model_dump(mode="json", by_alias=True) for t in tasks],
        "tests": [t.model_dump(mode="json", by_alias=True) for t in tests],
        "conflicts": [c.model_dump(mode="json", by_alias=True) for c in conflicts],
    }


def to_impact(row: AgendaImpact) -> AgendaImpactOut:
    result = row.result
    return AgendaImpactOut(
        id=row.id,
        project_id=row.project_id,
        agenda_id=row.agenda_id,
        decision_rev=row.decision_rev,
        decision_before=row.decision_before,
        decision_after=row.decision_after,
        summary=row.summary,
        tasks=[ImpactTask.model_validate(t) for t in result.get("tasks", [])],
        tests=[ImpactTest.model_validate(t) for t in result.get("tests", [])],
        conflicts=[ImpactConflict.model_validate(c) for c in result.get("conflicts", [])],
        created_by=row.created_by,
        created_at=row.created_at,
    )


async def save(
    session: AsyncSession, context: ImpactContext, built: Built, actor_id: str | None
) -> AgendaImpactOut:
    row = AgendaImpact(
        id=new_id(),
        project_id=context.project_id,
        agenda_id=context.agenda_id,
        decision_rev=context.decision_rev,
        decision_before=context.before,
        decision_after=context.after,
        summary=built.summary,
        result=_result_doc(built.tasks, built.tests, built.conflicts),
        created_by=actor_id,
        created_at=now(),
    )
    session.add(row)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return to_impact(row)


def empty_result() -> Built:
    return Built(summary=EMPTY_SUMMARY, tasks=[], tests=[], conflicts=[])


# --- 스트림 ---


def _error(code: str, message: str) -> ImpactErrorEvent:
    return ImpactErrorEvent(code=code, message=message)


async def analyze(
    llm: LLMProvider,
    session: AsyncSession,
    settings: Settings,
    context: ImpactContext,
    *,
    actor_id: str | None,
    today: date,
) -> AsyncIterator[ImpactEvent]:
    """도구 루프. 열린 뒤의 실패는 error 이벤트로 접는다 — 이게 오면 impact · done 은 안 온다.

    화면이 끊으면 남기기 전에 멈춘다 — 남기는 자리는 검사를 통과한 뒤 하나다.
    """
    try:
        async with aclosing(_loop(llm, session, settings, context, actor_id, today)) as events:
            async for event in events:
                yield event
                if isinstance(event, ImpactErrorEvent | ImpactDoneEvent):
                    return
    except LLMError as exc:
        yield _error(exc.code, exc.message)
        return
    except Exception:
        log.exception("영향도 분석 중 오류")
        yield _error("INTERNAL_ERROR", "서버에서 오류가 발생했습니다.")
        return
    # 루프가 결과 없이 끝났다 — 상한에 닿았다
    yield _error("IMPACT_FAILED", FAILED_MESSAGE)


async def _loop(
    llm: LLMProvider,
    session: AsyncSession,
    settings: Settings,
    context: ImpactContext,
    actor_id: str | None,
    today: date,
) -> AsyncGenerator[ImpactEvent, None]:
    if context.empty:
        # 볼 것이 없다 — Claude 를 부르지 않고 빈 결과를 남긴다
        impact = await save(session, context, empty_result(), actor_id)
        yield ImpactResultEvent(impact=impact)
        yield ImpactDoneEvent()
        return

    yield ImpactToolEvent(name="read_tasks", label="연결 작업 읽는 중")
    yield ImpactToolEvent(name="compare_decisions", label="다른 결정 비교 중")
    if context.candidate_tasks or context.candidate_tests:
        yield ImpactToolEvent(name="search_tasks", label=SEARCH_LABEL)
    system = system_prompt(context.project_name, today)
    # 근거는 차례마다 다시 실려 간다 — 캐시해 두면 고쳐 내는 차례부터 싸다
    history: list[Message] = [UserMessage(user_message(context), cache=True)]
    found = Found()
    # 미리 찾은 후보는 본문까지 넣어 줬다 — 도구로 읽은 것과 같이 친다
    for snap in context.candidate_tasks:
        found.tasks[snap.id] = snap
        found.read_tasks.add(snap.id)
    for test_snap in context.candidate_tests:
        found.tests[test_snap.id] = test_snap
        found.read_tests.add(test_snap.id)
    failures = 0

    def failed() -> bool:
        nonlocal failures
        failures += 1
        return failures >= MAX_FAILURES

    for _ in range(MAX_ROUNDS):
        reply: Reply | None = None
        async for event in llm.turn(
            system=system, messages=history, tools=TOOLS, max_tokens=settings.impact_max_tokens
        ):
            if isinstance(event, Reply):
                reply = event
        assert reply is not None, "공급자는 차례마다 Reply 로 끝난다"

        match reply.stop:
            case "refused":
                yield _error("CHAT_REFUSED", REFUSED_MESSAGE)
                return
            case "max_tokens":
                # 도구 입력이 잘렸다 — 다시 불러도 같은 자리에서 잘린다
                yield _error("IMPACT_FAILED", TOO_LONG_MESSAGE)
                return
            case "paused":
                history.append(reply.message)
                continue

        calls = reply.message.calls
        history.append(reply.message)
        if not calls:
            if failed():
                yield _error("IMPACT_FAILED", FAILED_MESSAGE)
                return
            history.append(UserMessage(NUDGE))
            continue

        results: list[ToolResult] = []
        # 읽기를 하나라도 했거나 안을 냈으면 쓸모 있는 차례다. 상한에 막힌 읽기 · 없는 도구뿐이면
        # 고쳐 내기 기회를 하나 먹는다 — 끝없이 돌지 않게
        useful = False
        for call in calls:
            if call.name in READ_TOOLS:
                if found.reads >= READ_MAX:
                    results.append(
                        ToolResult(
                            call_id=call.id, content=_tool_error(READ_CAP_MESSAGE), is_error=True
                        )
                    )
                    continue
                found.reads += 1
                useful = True
                yield ImpactToolEvent(name=_tool_name(call.name), label=READ_TOOLS[call.name])
                content, is_error = await run_read_tool(
                    session, context, found, call.name, call.input
                )
                results.append(ToolResult(call_id=call.id, content=content, is_error=is_error))
                continue
            if call.name != "propose_impact":
                results.append(
                    ToolResult(
                        call_id=call.id,
                        content=_tool_error(f"없는 도구다: {call.name}"),
                        is_error=True,
                    )
                )
                continue
            useful = True
            yield ImpactToolEvent(name="propose_impact", label="고칠 안 만드는 중")
            checked = check_proposal(context, call.input, found)
            if checked.result is not None:
                impact = await save(session, context, checked.result, actor_id)
                yield ImpactResultEvent(impact=impact)
                yield ImpactDoneEvent()
                return
            if failed():
                yield _error("IMPACT_FAILED", FAILED_MESSAGE)
                return
            results.append(
                ToolResult(call_id=call.id, content=checked.content, is_error=checked.is_error)
            )
        if not useful and failed():
            yield _error("IMPACT_FAILED", FAILED_MESSAGE)
            return
        history.append(UserMessage(results=results))


def _tool_name(name: str) -> ImpactToolName:
    match name:
        case "search_tasks" | "search_tests" | "get_task" | "get_test":
            return name
    raise ValueError(name)


# --- 반영 ---


async def load_impact(session: AsyncSession, impact_id: str) -> AgendaImpact:
    found = await session.scalar(
        select(AgendaImpact).where(
            AgendaImpact.id == impact_id, AgendaImpact.agenda_id.in_(access.live_agenda_ids())
        )
    )
    if found is None:
        raise _impact_not_found()
    return found


LINK_ON_LINKED = "이미 이 안건에 연결된 줄입니다 — 연결은 연결 안 된 줄에서만 합니다."
CHECK_WITH_FIX = "확인 필요 줄은 고칠 안이 없습니다 — 연결(link)만 보냅니다."
CHECK_NO_LINK = "확인 필요 줄은 연결(link)로만 고릅니다."


def _task_fix(item: ImpactApplyTask) -> bool:
    return item.title is not None or item.body is not None


def _test_fix(item: ImpactApplyTest) -> bool:
    return any(value is not None for value in (item.title, item.content, item.test_data))


def _pickable(verdict: str, linked: bool) -> bool:
    """고를 수 있는 줄 — update 줄 + 연결 안 된 check 줄(연결만)."""
    return verdict == "update" or (verdict == "check" and not linked)


def _line_problems(
    at: str, verdict: str, linked: bool, link: bool, has_fix: bool, places: str
) -> dict[str, str]:
    """고칠 칸 · link 의 짝 — 고칠 칸 자체의 검사는 task_fix_problems · test_fix_problems."""
    problems: dict[str, str] = {}
    if link and linked:
        problems[f"{at}.link"] = LINK_ON_LINKED
    if verdict == "check":
        if has_fix:
            problems[at] = CHECK_WITH_FIX
        elif not link:
            problems[f"{at}.link"] = CHECK_NO_LINK
    elif not has_fix and not link:
        problems[at] = (
            f"고칠 칸({places})이 하나도 없습니다."
            if linked
            else f"고칠 칸({places})도 연결(link)도 없습니다."
        )
    return problems


def _apply_problems(impact: AgendaImpactOut, payload: ImpactApplyInput) -> dict[str, str]:
    if not payload.tasks and not payload.tests:
        return {"tasks": "반영할 줄이 없습니다."}
    problems: dict[str, str] = {}
    tasks = {t.task_id: t for t in impact.tasks}
    seen: set[str] = set()
    for index, item in enumerate(payload.tasks):
        at = f"tasks.{index}"
        row = tasks.get(item.task_id)
        if row is None or not _pickable(row.verdict, row.linked):
            problems[f"{at}.taskId"] = "이 분석의 고칠 작업이 아닙니다."
            continue
        if item.task_id in seen:
            problems[f"{at}.taskId"] = "같은 작업이 두 번 있습니다."
            continue
        seen.add(item.task_id)
        has_fix = _task_fix(item)
        problems |= _line_problems(
            at, row.verdict, row.linked, bool(item.link), has_fix, "title · body"
        )
        if row.verdict == "update" and has_fix:
            problems |= task_fix_problems(
                at, item.title, item.body, row.before, every_field_differs=False
            )
    tests = {t.test_id: t for t in impact.tests}
    seen = set()
    for index, test in enumerate(payload.tests):
        at = f"tests.{index}"
        trow = tests.get(test.test_id)
        if trow is None or not _pickable(trow.verdict, trow.linked):
            problems[f"{at}.testId"] = "이 분석의 고칠 테스트가 아닙니다."
            continue
        if test.test_id in seen:
            problems[f"{at}.testId"] = "같은 테스트가 두 번 있습니다."
            continue
        seen.add(test.test_id)
        has_fix = _test_fix(test)
        problems |= _line_problems(
            at, trow.verdict, trow.linked, bool(test.link), has_fix, "title · content · testData"
        )
        if trow.verdict == "update" and has_fix:
            values = {"title": test.title, "content": test.content, "test_data": test.test_data}
            problems |= test_fix_problems(at, values, trow.before, every_field_differs=False)
    return problems


def _task_now(task: Task) -> ImpactTaskBefore:
    return ImpactTaskBefore(title=task.title, body=_lines(task))


async def apply_impact(
    session: AsyncSession, impact_id: str, payload: ImpactApplyInput, scope: Scope, *, today: date
) -> ImpactApplyResult:
    """고른 고칠 안 · 연결을 한 트랜잭션에 반영한다.

    검사 순서는 422 → 403 → 409 STALE → 409 TARGET_CHANGED — 앞에서 걸리면 뒤는 안 본다.
    """
    row = await load_impact(session, impact_id)
    impact = to_impact(row)
    problems = _apply_problems(impact, payload)
    if problems:
        raise _invalid(problems)

    task_ids = [item.task_id for item in payload.tasks]
    test_ids = [item.test_id for item in payload.tests]
    live_tasks = {
        task.id: task
        for task in (
            await session.scalars(
                select(Task).where(
                    Task.id.in_(task_ids),
                    Task.project_id == row.project_id,
                    Task.is_deleted.is_(False),
                )
            )
        ).all()
    }
    live_tests = {
        test.id: test
        for test in (
            await session.scalars(
                select(TestCase).where(
                    TestCase.id.in_(test_ids), TestCase.project_id == row.project_id
                )
            )
        ).all()
    }

    # 줄마다 그 작업 · 테스트의 고치기 권한 — 연결도 링크 · 태그 PUT 처럼 같은 권한이다.
    # 지운 것은 아래 '바뀜' 으로 간다. 공통 테스트는 그 프로젝트 멤버 누구나다
    denied = {
        f"tasks.{index}": "이 작업을 고칠 권한이 없습니다."
        for index, task_id in enumerate(task_ids)
        if task_id in live_tasks and not access.can_edit_task(scope, live_tasks[task_id])
    }
    denied |= {
        f"tests.{index}": "이 테스트를 고칠 권한이 없습니다."
        for index, test_id in enumerate(test_ids)
        if test_id in live_tests and not access.can_edit_test(scope, live_tests[test_id])
    }
    if denied:
        raise ApiError(403, "FORBIDDEN", "권한이 없습니다.", denied)

    agenda = await _load_agenda(session, row.agenda_id)
    if agenda.decision_rev != row.decision_rev:
        raise ApiError(409, "IMPACT_STALE", STALE_MESSAGE)

    by_task = {t.task_id: t for t in impact.tasks}
    by_test = {t.test_id: t for t in impact.tests}
    changed: dict[str, str] = {}
    for index, item in enumerate(payload.tasks):
        task = live_tasks.get(item.task_id)
        if task is None:
            changed[f"tasks.{index}"] = GONE
            continue
        # 연결만 하는 줄은 글을 덮어쓰지 않으니 견주지 않는다
        if not _task_fix(item):
            continue
        before = by_task[item.task_id].before
        current = _task_now(task)
        if current.title != before.title or not _same_body(current.body, before.body):
            changed[f"tasks.{index}"] = CHANGED
    for index, chosen in enumerate(payload.tests):
        test = live_tests.get(chosen.test_id)
        if test is None:
            changed[f"tests.{index}"] = GONE
            continue
        if not _test_fix(chosen):
            continue
        tbefore = by_test[chosen.test_id].before
        if (test.title, test.content, test.test_data) != (
            tbefore.title,
            tbefore.content,
            tbefore.test_data,
        ):
            changed[f"tests.{index}"] = CHANGED
    if changed:
        raise ApiError(409, "IMPACT_TARGET_CHANGED", TARGET_CHANGED_MESSAGE, changed)

    applied_at = now()
    links: list[TaskAgendaLinkOut] = []
    edited_tasks: list[Task] = []
    for item in payload.tasks:
        task = live_tasks[item.task_id]
        fields: dict[str, Any] = {}
        if item.title is not None:
            fields["title"] = item.title.strip()
        if item.body is not None:
            # 같은 자리의 줄은 id 를 이어 쓴다 — 고치지 않은 줄의 id 가 반영 뒤에도 그대로다
            ids = [line.id for line in task.lines]
            fields["body"] = [
                TaskLinePatchIn(
                    id=ids[order] if order < len(ids) else None,
                    kind=line.kind,
                    text=line.text,
                    done=line.done,
                    level=line.level,
                )
                for order, line in enumerate(item.body)
            ]
        if fields:
            task = await task_service.edit_task(session, item.task_id, TaskPatch(**fields), scope)
        # 링크 PUT 과 같은 몸통 — 이미 걸려 있으면 그대로(멱등), 새로 건 것만 돌려준다
        if item.link and await task_service.attach_agenda(session, task, row.agenda_id, scope):
            links.append(TaskAgendaLinkOut(task_id=task.id, agenda_id=row.agenda_id))
        edited_tasks.append(task)
        current_row = by_task[item.task_id]
        by_task[item.task_id] = current_row.model_copy(
            update={
                "title": fields.get("title"),
                "body": item.body,
                "applied_at": applied_at,
                "linked_on_apply": current_row.linked_on_apply or bool(item.link),
            }
        )
    edited_tests: list[TestCase] = []
    for index, chosen in enumerate(payload.tests):
        test = live_tests[chosen.test_id]
        test_fields: dict[str, Any] = {}
        if chosen.title is not None:
            test_fields["title"] = chosen.title.strip()
        if chosen.content is not None:
            test_fields["content"] = chosen.content
        if chosen.test_data is not None:
            test_fields["test_data"] = chosen.test_data
        if test_fields:
            test = await test_service.edit_test(
                session, chosen.test_id, TestPatch(**test_fields), scope
            )
        if chosen.link:
            try:
                # 태그 PUT 과 같은 몸통 — 태그 상한도 같다. 걸리면 그 오류를 이 줄 자리로
                await test_service.add_ref(session, test, "agenda", row.agenda_id, scope.actor.id)
            except ApiError as exc:
                await session.rollback()
                raise ApiError(
                    exc.status_code, exc.code, exc.message, {f"tests.{index}.link": exc.message}
                ) from exc
        edited_tests.append(test)
        current_test = by_test[chosen.test_id]
        by_test[chosen.test_id] = current_test.model_copy(
            update={
                "title": test_fields.get("title"),
                "content": chosen.content,
                "test_data": chosen.test_data,
                "applied_at": applied_at,
                "linked_on_apply": current_test.linked_on_apply or bool(chosen.link),
            }
        )
    # 반영한 값 그대로 남긴다 — 화면에서 고친 안이면 그것이 '후' 다
    row.result = _result_doc(
        [by_task[t.task_id] for t in impact.tasks],
        [by_test[t.test_id] for t in impact.tests],
        impact.conflicts,
    )
    await session.commit()

    tasks_out: list[TaskOut] = [
        task_service.to_task(
            task,
            await task_service.comment_count(session, task.id),
            await task_service.status_since(session, task),
        )
        for task in edited_tasks
    ]
    tests_out = await test_service.build_tests(session, row.project_id, edited_tests, today=today)
    return ImpactApplyResult(tasks=tasks_out, tests=tests_out, links=links, impact=to_impact(row))

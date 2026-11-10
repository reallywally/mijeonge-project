"""AI 영향도 분석 — 결정이 바뀐 안건에 걸린 작업 · 테스트 · 다른 결정 (`docs/api/impact.md`).

읽을 것은 서버가 정해 미리 모은다(리스크 분석처럼). Claude 는 `propose_impact` 하나만 쥐고,
검사에 떨어지면 까닭을 돌려받아 고쳐 낸다(회의록 초안처럼). 끝까지 받으면 늘 남긴다.
반영은 작업 · 테스트 PATCH 의 몸통(`edit_task` · `edit_test`)을 한 트랜잭션으로 부른다 —
권한 · 검사 · 변경 이력 · 테스트 기준 다시 찍기가 일반 수정과 같다.
"""

import json
import logging
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
    ImpactConflict,
    ImpactDoneEvent,
    ImpactErrorEvent,
    ImpactEvent,
    ImpactLine,
    ImpactResultEvent,
    ImpactTask,
    ImpactTaskBefore,
    ImpactTest,
    ImpactTestBefore,
    ImpactToolEvent,
    ProposedImpact,
)
from app.schemas.task import TaskLinePatchIn, TaskOut, TaskPatch
from app.schemas.test import CONTENT_MAX, TEXT_MAX, TestPatch
from app.services import access
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
# 공급자가 멈춘 차례(paused)를 이어 부를 몫까지
MAX_ROUNDS = 6

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

## 규칙
1. summary — 결정 전 → 후 에서 **무엇이 바뀌었는지** 먼저 한두 줄로, 이어 무엇을 보면 되는지 한 줄.
   결정 전이 null 이면 처음 정한 결정이다(새 결정)
2. 작업 · 테스트마다 판정한다
   - 바뀐 결정 때문에 제목 · 본문(작업) · 내용 · 테스트 데이터(테스트)가
     **이제 틀렸으면** update 와 고친 안
   - 틀린지 확실치 않으면 check, 상관없으면 ok
   - 고칠 것이 없는데 update 를 내지 않는다
3. 고친 안은 **바뀐 결정에 닿는 부분만** 고친다.
   나머지 글 · 줄 · 체크 상태(done) · 들여쓰기(level)는 그대로 옮긴다
   - 바꿀 칸만 보낸다. 안 바꾸는 칸은 null 로 둔다
   - 작업 body 는 **본문 전체를 갈아끼운다** — 고치지 않는 줄도 다 옮겨 적는다
   - body_cut · content_cut · test_data_cut 이 true 인 칸은 잘려서 보인 것이라 고칠 수 없다(null)
4. 다른 결정된 안건과 **같이 지킬 수 없으면** conflict, 겹치거나 범위가 애매하면 check.
   상관없는 안건은 conflicts 에 내지 않는다
5. reason 은 한두 문장, **결정 전 · 후 또는 그 안건의 결정내용을 짚어서** 쓴다.
   넣어 준 것에 없는 사실을 지어내지 않는다
6. id 는 넣어 준 것만 쓴다. 같은 id 를 두 번 내지 않는다
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
                "description": "넣어 준 연결 작업의 판정",
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
                "description": "넣어 준 닿는 테스트의 판정",
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
TOOLS: list[ToolSpec] = [PROPOSE_TOOL]


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
    key: str
    title: str
    status: str
    owner: str
    due: date | None
    # 분석 때의 본문 전체 — before 가 된다. Claude 에는 앞 60줄만 간다
    lines: list[ImpactLine]


@dataclass
class TestSnap:
    id: str
    key: str
    title: str
    status: str
    owner: str
    content: str
    test_data: str


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

    @property
    def empty(self) -> bool:
        return not self.tasks and not self.tests and not self.others


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


async def build_context(session: AsyncSession, agenda: Agenda, project_name: str) -> ImpactContext:
    try:
        tasks = list((await session.scalars(_linked_tasks(agenda.id))).all())
        # 닿는 테스트는 상한 밖의 연결 작업까지 보고 고른다 — 상한은 테스트 수에만 건다
        tests = list(
            (await session.scalars(_reached_tests(agenda.id, [t.id for t in tasks]))).all()
        )
        tasks, tests = tasks[:TASKS_MAX], tests[:TESTS_MAX]
        others = (await _other_decided(session, agenda.project_id, agenda.id))[:DECIDED_MAX]
        names = await _names(
            session, [agenda.owner_id, *(t.owner_id for t in tasks), *(t.owner_id for t in tests)]
        )

        def who(member_id: str | None) -> str:
            return names.get(member_id, NO_OWNER) if member_id is not None else NO_OWNER

        return ImpactContext(
            project_id=agenda.project_id,
            project_name=project_name,
            agenda_id=agenda.id,
            title=agenda.title,
            description=agenda.description,
            state=agenda.state,
            owner=who(agenda.owner_id),
            decision_rev=agenda.decision_rev,
            before=await decision_before(session, agenda.id),
            after=agenda.decision.strip(),
            tasks=[
                TaskSnap(
                    id=t.id,
                    key=t.key,
                    title=t.title,
                    status=t.status,
                    owner=who(t.owner_id),
                    due=t.due,
                    lines=_lines(t),
                )
                for t in tasks
            ],
            tests=[
                TestSnap(
                    id=t.id,
                    key=t.key,
                    title=t.title,
                    status=t.status,
                    owner=who(t.owner_id),
                    content=t.content,
                    test_data=t.test_data,
                )
                for t in tests
            ],
            others=[
                DecidedSnap(
                    id=a.id, title=a.title, decision=a.decision.strip(), decided_at=a.decided_at
                )
                for a in others
            ],
        )
    finally:
        # 읽기만 한다 — Claude 를 부르는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


def _cut_flags(context: ImpactContext) -> tuple[set[str], dict[str, set[str]]]:
    """잘려서 보인 칸 — 그 칸은 고친 안을 받지 않는다(통째로 갈아끼우면 잘린 뒤가 사라진다)."""
    tasks = {t.id for t in context.tasks if len(t.lines) > BODY_LINES_MAX}
    tests: dict[str, set[str]] = {}
    for t in context.tests:
        cut = {
            name
            for name, value in (("content", t.content), ("testData", t.test_data))
            if len(value) > FIELD_MAX
        }
        if cut:
            tests[t.id] = cut
    return tasks, tests


def user_message(context: ImpactContext) -> str:
    def text(value: str) -> str:
        return _cut(value, FIELD_MAX)[0]

    def task_doc(t: TaskSnap) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "id": t.id,
            "key": t.key,
            "title": t.title,
            "status": t.status,
            "owner": t.owner,
            "due": t.due.isoformat() if t.due else None,
            "body": [line.model_dump() for line in t.lines[:BODY_LINES_MAX]],
        }
        if len(t.lines) > BODY_LINES_MAX:
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
            "owner": t.owner,
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
    data = json.dumps(payload, ensure_ascii=False)
    return f"결정이 바뀐 안건과 그 결정에 걸린 것들이다. 규칙대로 판정해 내라.\n\n{data}"


def system_prompt(project_name: str, today: date) -> str:
    return SYSTEM_PROMPT.format(
        project_name=project_name, today=f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})"
    )


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


def _problems(context: ImpactContext, proposed: ProposedImpact) -> dict[str, str]:
    problems: dict[str, str] = {}
    summary = proposed.summary.strip()
    if not summary:
        problems["summary"] = "요약을 적어 주세요."
    elif len(summary) > SUMMARY_MAX:
        problems["summary"] = f"요약은 {SUMMARY_MAX}자까지입니다."
    body_cut, test_cut = _cut_flags(context)

    tasks = {t.id: t for t in context.tasks}
    seen: set[str] = set()
    for index, item in enumerate(proposed.tasks):
        at = f"tasks.{index}"
        snap = tasks.get(item.task_id)
        if snap is None:
            problems[f"{at}.taskId"] = "넣어 준 연결 작업이 아닙니다."
            continue
        if item.task_id in seen:
            problems[f"{at}.taskId"] = "같은 작업을 두 번 냈습니다."
            continue
        seen.add(item.task_id)
        if found := _reason_problem(item.reason):
            problems[f"{at}.reason"] = found
        if item.verdict == "update":
            problems |= task_fix_problems(
                at,
                item.title,
                item.body,
                _task_before(snap),
                every_field_differs=True,
                body_cut=snap.id in body_cut,
            )
        elif item.title is not None or item.body is not None:
            problems[at] = "update 가 아니면 고칠 칸을 보내지 않습니다."

    tests = {t.id: t for t in context.tests}
    seen = set()
    for index, test in enumerate(proposed.tests):
        at = f"tests.{index}"
        tsnap = tests.get(test.test_id)
        if tsnap is None:
            problems[f"{at}.testId"] = "넣어 준 테스트가 아닙니다."
            continue
        if test.test_id in seen:
            problems[f"{at}.testId"] = "같은 테스트를 두 번 냈습니다."
            continue
        seen.add(test.test_id)
        if found := _reason_problem(test.reason):
            problems[f"{at}.reason"] = found
        values = {"title": test.title, "content": test.content, "test_data": test.test_data}
        if test.verdict == "update":
            problems |= test_fix_problems(
                at,
                values,
                _test_before(tsnap),
                every_field_differs=True,
                cut=test_cut.get(tsnap.id, set()),
            )
        elif any(value is not None for value in values.values()):
            problems[at] = "update 가 아니면 고칠 칸을 보내지 않습니다."

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
        if found := _reason_problem(conflict.reason):
            problems[f"{at}.reason"] = found
    return problems


def _build(context: ImpactContext, proposed: ProposedImpact) -> Built:
    """검사를 통과한 안 → 남길 모양. 판정이 빠진 작업 · 테스트는 ok 로 채워 다 싣는다."""
    by_task = {item.task_id: item for item in proposed.tasks}
    by_test = {item.test_id: item for item in proposed.tests}
    decisions = {a.id: a.decision for a in context.others}
    tasks: list[ImpactTask] = []
    for snap in context.tasks:
        item = by_task.get(snap.id)
        if item is None:
            tasks.append(
                ImpactTask(
                    task_id=snap.id, verdict="ok", reason=NO_VERDICT, before=_task_before(snap)
                )
            )
            continue
        update = item.verdict == "update"
        tasks.append(
            ImpactTask(
                task_id=snap.id,
                verdict=item.verdict,
                reason=item.reason.strip(),
                title=item.title.strip() if update and item.title is not None else None,
                body=item.body if update else None,
                before=_task_before(snap),
            )
        )
    tests: list[ImpactTest] = []
    for tsnap in context.tests:
        test = by_test.get(tsnap.id)
        if test is None:
            tests.append(
                ImpactTest(
                    test_id=tsnap.id, verdict="ok", reason=NO_VERDICT, before=_test_before(tsnap)
                )
            )
            continue
        update = test.verdict == "update"
        tests.append(
            ImpactTest(
                test_id=tsnap.id,
                verdict=test.verdict,
                reason=test.reason.strip(),
                title=test.title.strip() if update and test.title is not None else None,
                content=test.content if update else None,
                test_data=test.test_data if update else None,
                before=_test_before(tsnap),
            )
        )
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


def check_proposal(context: ImpactContext, raw: object) -> Checked:
    """propose_impact. DB 를 보지 않는다 — 넣어 준 것(context)만으로 본다."""
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
    problems = _problems(context, proposed)
    if problems:
        return Checked(
            content=json.dumps(
                {"error": "분석이 올바르지 않다. 고쳐서 다시 불러라.", "problems": problems},
                ensure_ascii=False,
            ),
            is_error=True,
        )
    return Checked(
        content=json.dumps({"ok": True}), is_error=False, result=_build(context, proposed)
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
    system = system_prompt(context.project_name, today)
    # 근거는 차례마다 다시 실려 간다 — 캐시해 두면 고쳐 내는 차례부터 싸다
    history: list[Message] = [UserMessage(user_message(context), cache=True)]
    failures = 0

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
            failures += 1
            if failures >= MAX_FAILURES:
                yield _error("IMPACT_FAILED", FAILED_MESSAGE)
                return
            history.append(UserMessage(NUDGE))
            continue

        results: list[ToolResult] = []
        for call in calls:
            if call.name != "propose_impact":
                results.append(
                    ToolResult(
                        call_id=call.id,
                        content=json.dumps(
                            {"error": f"없는 도구다: {call.name}"}, ensure_ascii=False
                        ),
                        is_error=True,
                    )
                )
                continue
            yield ImpactToolEvent(name="propose_impact", label="고칠 안 만드는 중")
            checked = check_proposal(context, call.input)
            if checked.result is not None:
                impact = await save(session, context, checked.result, actor_id)
                yield ImpactResultEvent(impact=impact)
                yield ImpactDoneEvent()
                return
            failures += 1
            if failures >= MAX_FAILURES:
                yield _error("IMPACT_FAILED", FAILED_MESSAGE)
                return
            results.append(
                ToolResult(call_id=call.id, content=checked.content, is_error=checked.is_error)
            )
        history.append(UserMessage(results=results))


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


def _apply_problems(impact: AgendaImpactOut, payload: ImpactApplyInput) -> dict[str, str]:
    if not payload.tasks and not payload.tests:
        return {"tasks": "반영할 줄이 없습니다."}
    problems: dict[str, str] = {}
    tasks = {t.task_id: t for t in impact.tasks}
    seen: set[str] = set()
    for index, item in enumerate(payload.tasks):
        at = f"tasks.{index}"
        row = tasks.get(item.task_id)
        if row is None or row.verdict != "update":
            problems[f"{at}.taskId"] = "이 분석의 고칠 작업이 아닙니다."
            continue
        if item.task_id in seen:
            problems[f"{at}.taskId"] = "같은 작업이 두 번 있습니다."
            continue
        seen.add(item.task_id)
        problems |= task_fix_problems(
            at, item.title, item.body, row.before, every_field_differs=False
        )
    tests = {t.test_id: t for t in impact.tests}
    seen = set()
    for index, test in enumerate(payload.tests):
        at = f"tests.{index}"
        trow = tests.get(test.test_id)
        if trow is None or trow.verdict != "update":
            problems[f"{at}.testId"] = "이 분석의 고칠 테스트가 아닙니다."
            continue
        if test.test_id in seen:
            problems[f"{at}.testId"] = "같은 테스트가 두 번 있습니다."
            continue
        seen.add(test.test_id)
        values = {"title": test.title, "content": test.content, "test_data": test.test_data}
        problems |= test_fix_problems(at, values, trow.before, every_field_differs=False)
    return problems


def _task_now(task: Task) -> ImpactTaskBefore:
    return ImpactTaskBefore(title=task.title, body=_lines(task))


async def apply_impact(
    session: AsyncSession, impact_id: str, payload: ImpactApplyInput, scope: Scope, *, today: date
) -> ImpactApplyResult:
    """고른 고칠 안을 한 트랜잭션에 반영한다.

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

    # 작업은 줄마다 그 작업의 고치기 권한 — 지운 작업은 아래 '바뀜' 으로 간다.
    # 테스트는 그 프로젝트 멤버 누구나라 경로의 경계(require_scope)로 이미 됐다
    denied = {
        f"tasks.{index}": "이 작업을 고칠 권한이 없습니다."
        for index, task_id in enumerate(task_ids)
        if task_id in live_tasks and not access.can_edit_task(scope, live_tasks[task_id])
    }
    if denied:
        raise ApiError(403, "FORBIDDEN", "권한이 없습니다.", denied)

    agenda = await _load_agenda(session, row.agenda_id)
    if agenda.decision_rev != row.decision_rev:
        raise ApiError(409, "IMPACT_STALE", STALE_MESSAGE)

    by_task = {t.task_id: t for t in impact.tasks}
    by_test = {t.test_id: t for t in impact.tests}
    changed: dict[str, str] = {}
    for index, task_id in enumerate(task_ids):
        task = live_tasks.get(task_id)
        if task is None:
            changed[f"tasks.{index}"] = GONE
            continue
        before = by_task[task_id].before
        current = _task_now(task)
        if current.title != before.title or not _same_body(current.body, before.body):
            changed[f"tasks.{index}"] = CHANGED
    for index, test_id in enumerate(test_ids):
        test = live_tests.get(test_id)
        if test is None:
            changed[f"tests.{index}"] = GONE
            continue
        tbefore = by_test[test_id].before
        if (test.title, test.content, test.test_data) != (
            tbefore.title,
            tbefore.content,
            tbefore.test_data,
        ):
            changed[f"tests.{index}"] = CHANGED
    if changed:
        raise ApiError(409, "IMPACT_TARGET_CHANGED", TARGET_CHANGED_MESSAGE, changed)

    applied_at = now()
    edited_tasks: list[Task] = []
    for item in payload.tasks:
        fields: dict[str, Any] = {}
        if item.title is not None:
            fields["title"] = item.title.strip()
        if item.body is not None:
            # 같은 자리의 줄은 id 를 이어 쓴다 — 고치지 않은 줄의 id 가 반영 뒤에도 그대로다
            ids = [line.id for line in live_tasks[item.task_id].lines]
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
        edited_tasks.append(
            await task_service.edit_task(session, item.task_id, TaskPatch(**fields), scope)
        )
        by_task[item.task_id] = by_task[item.task_id].model_copy(
            update={
                "title": fields.get("title"),
                "body": item.body,
                "applied_at": applied_at,
            }
        )
    edited_tests: list[TestCase] = []
    for chosen in payload.tests:
        test_fields: dict[str, Any] = {}
        if chosen.title is not None:
            test_fields["title"] = chosen.title.strip()
        if chosen.content is not None:
            test_fields["content"] = chosen.content
        if chosen.test_data is not None:
            test_fields["test_data"] = chosen.test_data
        edited_tests.append(
            await test_service.edit_test(
                session, chosen.test_id, TestPatch(**test_fields), scope.actor.id
            )
        )
        by_test[chosen.test_id] = by_test[chosen.test_id].model_copy(
            update={
                "title": test_fields.get("title"),
                "content": chosen.content,
                "test_data": chosen.test_data,
                "applied_at": applied_at,
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
    return ImpactApplyResult(tasks=tasks_out, tests=tests_out, impact=to_impact(row))

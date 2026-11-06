"""리스크 화면의 [AI 리스크 분석] — 계약은 `docs/api/risk.md` 'AI 요약' · '근거 넓히기'.

판정은 규칙(`services/risk.py`)이, 설명은 Claude 가 한다. 읽을 것이 정해져 있어 도구 없이
근거를 미리 모아 한 번만 부른다. 답을 끝까지 받으면 임시 분석으로 남긴다 —
[저장] 을 눌러야 게시판에 오른다 (`docs/api/risk-analysis.md`).
"""

import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, NamedTuple

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import Finished, LLMError, LLMProvider
from app.models import (
    Agenda,
    AgendaHistory,
    Member,
    Minutes,
    Part,
    RiskAnalysis,
    Task,
    TaskAgendaLink,
    TaskComment,
    TaskHistory,
    TaskLine,
    TestCase,
    TestComment,
    TestHistory,
    TestRef,
)
from app.schemas.chat import ChatEvent, DeltaEvent, DoneEvent, ErrorEvent
from app.schemas.risk import (
    AgendaRisk,
    DecisionRiskReport,
    OwnerLoad,
    RiskSettings,
    RiskSummaryInput,
    TaskRisk,
    TestRisk,
)
from app.schemas.risk_analysis import (
    AnalysisSettings,
    AnalyzedAgenda,
    AnalyzedTask,
    AnalyzedTest,
    KeptAgenda,
    RiskAnalysisFacts,
    RiskSummaryDoneEvent,
)
from app.services import risk as risk_service
from app.services import risk_analysis as analysis_service
from app.services import task as task_service
from app.services import test as test_service
from app.services.chat import TRUNCATED, WEEKDAYS, extract_refs
from app.services.progress import kst_day

log = logging.getLogger(__name__)

# 근거(배경 · 이력 · 회의록 · 연결 작업 · 테스트 · 담당자 부담)까지 읽어 줄 안건 수 — 점수 위쪽부터
DETAIL_AGENDAS = 8
# 상세를 붙일 작업 · 테스트 리스크 수 — 각각 점수 위쪽부터 (risk-dashboard.md 'AI 리스크 분석')
DETAIL_WORK = 6
ACTIONS_PER_TEST = 2
# 한 번에 너무 커지지 않게 목록마다 자른다 (docs/api/risk.md '근거 넓히기')
HISTORY_LINES = 10
MEETINGS_MAX = 5
COMMENTS_PER_TASK = 3
TESTS_PER_AGENDA = 5
TEXT_MAX = 200
# 실패 · 막힘이거나 기준이 바뀐 테스트만 근거가 된다
TROUBLED_STATUSES = ("fail", "blocked")
BASIS_CHANGED = "basisChanged"
# 안건을 직접 태그한 테스트의 '어디로 닿았나'
DIRECT = "안건"
NOTHING = "지금 짚을 리스크가 없습니다."
NO_OWNER = "담당자 없음"
UNKNOWN = "알 수 없음"
COMMON_PART = "공통"
# 이력의 칸 이름 — id 를 담는 칸 이름(ownerId 등)을 그대로 내면 id 를 가리킨다는 말이 새어 나간다
FIELD_LABELS = {
    "created": "등록",
    "deleted": "삭제",
    "title": "제목",
    "description": "배경",
    "decision": "결정내용",
    "state": "상태",
    "ownerId": "담당자",
    "ccIds": "참조",
    "partId": "파트",
    "dueDate": "결정 기한",
}
# 작업 · 테스트 이력의 칸 이름 (docs/api/history.md '칸 — 작업' · '칸 — 테스트')
WORK_FIELD_LABELS = {
    "title": "제목",
    "body": "본문",
    "status": "상태",
    "priority": "우선순위",
    "ownerId": "담당자",
    "ccIds": "참조",
    "partId": "파트",
    "parentId": "상위",
    "start": "시작일",
    "due": "기한",
    "lineDone": "체크",
    "agenda": "안건 연결",
    "content": "내용",
    "testData": "테스트 데이터",
    "resultNote": "결과 메모",
    "taskRef": "작업 태그",
    "agendaRef": "안건 태그",
    "basis": "기준 확인",
}

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자가 리스크 화면에서 [AI 리스크 분석] 을 눌렀다. 화면에 지금 보이는
안건 · 작업 · 테스트 리스크를 읽고 '그래서 뭐부터 하나' 를 짧게 정리한다.

## 받는 것
사용자 메시지의 JSON 하나다. 규칙으로 계산한 리스크 보고서와, 위쪽 줄의 근거다.
숫자는 모두 서버가 센 것이다 — 네가 다시 세지 않는다.
- report.settings: 쓴 기준(dueSoonDays 기한 임박 날 수 · staleDays 오래 멈춤 날 수 ·
  highScore · mediumScore 등급 문턱 · churnDays 흔들림을 세는 최근 날 수 ·
  churnCount 내용 자주 바뀜 문턱 · slipCount 기한 거듭 미룸 문턱)
- report.agendas: 위험한 안건(점수 내림차순). blockedTasks 는 이 안건 때문에 막힌 작업,
  waitingTasks 는 결정을 기다리는 작업, impactTaskCount 는 막힌 작업과 그 하위 작업 수
- report.tasks: 위험한 작업(점수 내림차순). overdueDays 기한 넘긴 날 ·
  statusDays 지금 상태가 된 지 며칠째 ·
  plannedDays 계획 기간 · slipCount 기한을 뒤로 미룬 횟수 · contentChanges 최근 내용 변경 줄 수 ·
  ownerChanges 최근 담당자 변경 줄 수
- report.tests: 위험한 테스트(점수 내림차순). flips 최근 성공 ↔ 실패 뒤집힘 수 ·
  slipCount 기한 미룬 횟수
- report.owners: 사람별 몰림(프로젝트 전체). riskyTasks · riskyTests 는
  맡은 작업 · 테스트 중 높음 · 중간 수
- details: 점수 위쪽 안건마다
  - description 배경 · decision 지금까지 적힌 결정내용(없으면 '')
  - history: dueDateChanges 결정 기한을 바꾼 횟수 ·
    dueDateFlow 그 흐름(옛 → 새, null 은 기한 없음) · ownerChanges 담당자 바뀐 횟수 ·
    stateFlow 상태 흐름 · createdOn 만든 날 · lastTouchedOn 마지막으로 손댄 날 ·
    recent 최근 변경(칸 · 바뀐 값 · 날짜 · 누가)
  - meetings: count 이 안건을 다룬 회의록 수 · recent 회의록(제목 · 날짜 · 그 회의에서 바뀐 칸)
  - tasks: 연결된 작업. progress.checklist 는 체크리스트 완료 done / 전체 total
    (체크 줄이 없으면 null), progress.statusDays 는 지금 상태가 된 지 며칠째,
    recentComments 는 최근 댓글(작성자 · 날짜 · 본문)
  - tests: 연결된 테스트 중 실패 · 막힘 · 기준 바뀜(basisChanged)인 것만 — 상태 · 신호 ·
    via(안건 직접 또는 태그한 작업 키) · latestAction 최근 조치 내역
  - ownerLoad: 안건 담당자가 이 프로젝트에서 맡은 안 정해진 안건 수(openAgendas) · 그중 기한 넘김
    (overdueAgendas) · 맡은 작업 중 진행 중(doingTasks) · 막힘(blockedTasks). 담당자가 없으면 null
- taskDetails: 점수 위쪽 작업마다 checklist(완료 done / 전체 total, 없으면 null) ·
  recentComments 최근 댓글 · dueFlow 기한 흐름(옛 → 새) · recentChanges 최근 churnDays 일 안에
  바뀐 칸과 횟수 · openAgendas 걸린 안 정해진 안건 제목
- testDetails: 점수 위쪽 테스트마다 recentActions 최근 조치 내역 · statusFlow 최근 churnDays 일 안의
  상태 흐름 · taggedTasks · taggedAgendas 태그한 작업 · 안건
- compare: 바로 앞에 저장한 분석 대비. previousTitle 앞 분석의 제목 · previousSavedOn 저장한 날 ·
  previousAgendaCount · previousTaskCount · previousTestCount 앞 분석의 줄 수 ·
  added 이번에 새로 들어온 줄 · removed 앞에 있었는데 이번에 없는 줄(풀렸거나 범위 밖) ·
  kept 둘 다 있는 줄과 등급(levelFrom → levelTo). 줄은 kind(안건 · 작업 · 테스트)와
  제목(키가 있으면 key)으로 준다. null 이면 앞 분석이 없다

## 답의 모양
화면은 마크다운을 그리지 않고 줄바꿈만 살린다. #, **, 표를 쓰지 말고 아래 모양을 글자 그대로 쓴다.

한 줄 총평 — 지금 가장 큰 병목이 무엇인지 한 문장

먼저 손쓸 것
1. [[agenda:ID]] · [[task:ID]] · [[test:ID]] 중 하나 — 왜(신호 · 숫자 그대로) · 다음 할 일 · 누가
2. … (최대 4개, 안건 · 작업 · 테스트를 섞어 점수 · 영향 순)

흔들리는 일
- 기한 거듭 미룸 · 내용 자주 바뀜 · 담당자 자주 바뀜 · 결과 뒤집힘의 공통 원인 추정(1 ~ 2줄)

지난 분석 대비 — 달라진 점 한 줄

- '먼저 손쓸 것' 은 보고서에 줄이 있을 때만 쓴다
- '흔들리는 일' 은 흔들림 신호(dueSlipped · contentChurn · ownerChurn · flaky)가 있을 때만 쓴다.
  원인은 받은 근거에서 짐작한 것이니 '~로 보임' 으로 맺는다
- '지난 분석 대비' 는 compare 가 있고 달라진 점(새로 생김 · 풀림 · 등급 바뀜)이 있을 때만
  한 줄로 쓴다. 앞 분석의 제목 · 날짜 · 줄 수 · 등급은 넣어 준 그대로 쓴다
- 해당 없는 칸은 머리글까지 통째로 뺀다. 전체 900자 안팎 — 근거가 많아도 길게 쓰지 않는다

## 규칙
1. 점수 · 등급 · 날 수 · 날짜 · 작업 수 · 횟수는 받은 데이터 그대로만 쓴다.
   지어내거나 고쳐 매기지 않는다
2. 신호는 영어 이름 대신 화면의 말로 쓴다 —
   안건: overdue 기한 지남 · dueSoon 기한 임박 · stale 오래 멈춤 ·
   blocking 작업을 막는 중 · decisionAfterTaskDue 작업 기한이 먼저 · noOwner 담당자 없음 ·
   noDueDate 기한 없음.
   작업: overdue 기한 넘김 · longBlocked 오래 막힘 · longRunning 오래 걸림 ·
   dueSlipped 기한 거듭 미룸 · notStarted 시작 안 함 · contentChurn 내용 자주 바뀜 ·
   ownerChurn 담당자 자주 바뀜.
   테스트: overdue 기간 지남 · failedIdle 실패 그대로 · longBlocked 오래 막힘 ·
   basisChanged 기준 바뀜 · longRunning 오래 걸림 · flaky 결과 뒤집힘 ·
   dueSlipped 기한 거듭 미룸 · notStarted 시작 안 함.
   등급은 high 높음 · medium 중간 · low 낮음. 테스트 상태는 fail 실패 · blocked 막힘 ·
   pass 성공 · testing 진행 중 · draft 작성 중 · ready 준비됨
3. '왜' 는 근거로 구체적으로 쓴다 — 받은 숫자 그대로.
   예: "기한을 2번 미룸(11/7 → 11/14 → 11/21)", "회의 3번 다뤘지만 미정",
   "작업은 체크리스트 4/5 인데 이 결정만 남음", "연결 테스트 실패(HW-T3)",
   "최근 14일 동안 성공 ↔ 실패가 2번 뒤집힘"
4. '다음 할 일' 은 배경 · 결정내용 · 작업 댓글 · 테스트 조치 내역에서 근거를 찾는다 — 배경에
   "정보보안팀 확인이 먼저" 라면 "보안팀 의견을 받아 다음 회의에 올린다" 처럼.
   근거가 없으면 짐작하지 말고 담당자가 정하라고만 쓴다
5. '누가' 는 담당자 이름으로 쓴다. ownerLoad · owners 가 커서 병목으로 보이면 그 점을 같이 짚는다 —
   "김OO 님이 안건 4건을 들고 있어 나눠 맡기를 권함" 처럼
6. 너는 아무것도 바꾸지 못한다. 상태 · 담당자 · 기한을 바꾸는 것은 사람에게 권하기만 한다
7. 답에 쓴 안건 · 작업 · 테스트마다 [[agenda:ID]] · [[task:ID]] · [[test:ID]] 를 붙인다.
   ID 는 받은 데이터의 id 그대로다.
   받은 데이터에 없는 ID 는 절대 쓰지 않는다. ID 는 [[…]] 안에만 쓰고, 본문에는 작업 키(HW-4) ·
   테스트 키(HW-T3) · 제목 · 이름으로 말한다
8. 한국어 존댓말(~습니다 · ~요)로 짧고 분명하게 쓴다. 영어 문장을 섞지 않는다.
   상태 이름(queued 등)을 그대로 쓰지 말고 우리말(대기 · 논의중)로 풀어 쓴다
"""


@dataclass
class SummaryContext:
    """Claude 에 넣을 근거. ids 는 근거 칩으로 내도 되는 id 다 — 넣지 않은 id 는 칩이 안 된다."""

    payload: dict[str, Any]
    agenda_ids: set[str]
    task_ids: set[str]
    test_ids: set[str]
    # 임시 분석에 남길 스냅샷 · 지난 분석 대비 (docs/api/risk-analysis.md)
    facts: RiskAnalysisFacts


class _Comment(NamedTuple):
    author_id: str | None
    created_at: datetime
    body: str


class _HistoryLine(NamedTuple):
    changed_by: str | None
    changed_at: datetime
    changes: list[dict[str, Any]]
    # 회의록 [등록] 이 남긴 줄이면 그 회의록 (API.md Q69)
    minutes_id: str | None


@dataclass
class _Test:
    """안건에 닿은 문제 테스트 한 줄 — 닿은 길(via)은 안건마다 다르다."""

    id: str
    key: str
    title: str
    status: str
    signals: list[str]
    seq: int


async def build_context(
    session: AsyncSession, project_id: str, picked: RiskSummaryInput, *, today: date
) -> SummaryContext | None:
    """보고서를 다시 계산해 화면이 보낸 줄로 거른다. 거른 뒤 비면 None — Claude 를 안 부른다.

    화면이 보낸 숫자는 받지도 않는다 — id 만 받아 서버의 계산으로 다시 고른다.
    """
    try:
        report = await risk_service.decision_risks(session, project_id, today=today)
        # 모르는 id(다른 프로젝트 · 이제는 리스크가 아닌 것 · 지어낸 것)는 조용히 버린다
        want_agendas = set(picked.agenda_ids)
        want_tasks = set(picked.task_ids)
        want_tests = set(picked.test_ids)
        agendas = [t for t in report.agendas if t.agenda_id in want_agendas]
        tasks = [t for t in report.tasks if t.task_id in want_tasks]
        tests = [t for t in report.tests if t.test_id in want_tests]
        if not (agendas or tasks or tests):
            return None
        previous = await analysis_service.latest_saved(session, project_id)
        return await _collect(
            session, project_id, report, Picked(agendas, tasks, tests), today, previous
        )
    finally:
        # 읽기만 한다 — Claude 가 답하는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


def _cut(text: str) -> str:
    return text if len(text) <= TEXT_MAX else text[: TEXT_MAX - 1] + "…"


def _day(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


class Picked(NamedTuple):
    """화면이 보낸 id 로 거른 보고서 줄 — 점수 순 그대로."""

    agendas: list[AgendaRisk]
    tasks: list[TaskRisk]
    tests: list[TestRisk]


async def _collect(
    session: AsyncSession,
    project_id: str,
    report: DecisionRiskReport,
    picked_rows: Picked,
    today: date,
    previous: RiskAnalysis | None = None,
) -> SummaryContext:
    # 근거는 종류마다 한 번에 읽는다 — 안건 · 작업마다 따로 읽으면 쿼리가 수십 개가 된다
    agendas, risk_tasks, risk_tests = picked_rows
    top = agendas[:DETAIL_AGENDAS]
    top_tasks = risk_tasks[:DETAIL_WORK]
    top_tests = risk_tests[:DETAIL_WORK]
    top_ids = [t.agenda_id for t in top]
    rows = await _agenda_rows(session, project_id, top_ids)
    linked = await _linked_tasks(session, project_id, top_ids)
    linked_ids = {row["id"] for rows_ in linked.values() for row in rows_}
    histories = await _histories(session, project_id, top_ids)
    minutes = await _minutes(
        session,
        project_id,
        {row.minutes_id for row in rows.values() if row.minutes_id}
        | {line.minutes_id for lines in histories.values() for line in lines if line.minutes_id},
    )
    top_task_ids = {t.task_id for t in top_tasks}
    top_test_ids = {t.test_id for t in top_tests}
    checklists = await _checklists(session, linked_ids | top_task_ids)
    since = await task_service.status_since_map(session, project_id)
    task_comments = await _recent_comments(
        session, TaskComment, linked_ids | top_task_ids, COMMENTS_PER_TASK
    )
    tests, via = await _troubled_tests(session, project_id, top_ids, linked, today)
    # 안건에 닿은 테스트는 최근 1개, 위쪽 테스트 리스크는 최근 2개 — 한 번에 2개씩 읽고 잘라 쓴다
    test_comments = await _recent_comments(
        session, TestComment, {t.id for t in tests.values()} | top_test_ids, ACTIONS_PER_TEST
    )
    task_changes = await _work_history(session, TaskHistory, project_id, top_task_ids)
    test_changes = await _work_history(session, TestHistory, project_id, top_test_ids)
    test_refs = {test_id: refs for test_id, refs in ((t.test_id, t.refs) for t in top_tests)}
    # 걸린 안 정해진 안건 · 테스트가 태그한 안건의 제목
    agenda_titles = await _agenda_titles(
        session,
        project_id,
        {i for t in top_tasks for i in t.open_agenda_ids}
        | {ref.id for refs in test_refs.values() for ref in refs if ref.kind == "agenda"},
    )
    owner_loads = {o.member_id: o for o in report.owners}
    task_loads = await _task_loads(session, project_id, {t.owner_id for t in top})
    # 막힌 · 기다리는 작업을 키 · 제목으로 보이려고 — 이 프로젝트 안에서만 찾는다
    task_ids = {i for t in agendas for i in (*t.blocked_task_ids, *t.waiting_task_ids)}
    tagged_task_ids = {ref.id for refs in test_refs.values() for ref in refs if ref.kind == "task"}
    briefs = await _tasks_by_id(session, project_id, task_ids | tagged_task_ids)

    member_ids: set[str | None] = {t.owner_id for t in agendas}
    work: list[TaskRisk | TestRisk] = [*risk_tasks, *risk_tests]
    member_ids |= {t.owner_id for t in work}
    member_ids |= {o.member_id for o in report.owners}
    member_ids |= {row["owner_id"] for rows_ in linked.values() for row in rows_}
    member_ids |= {
        c.author_id for each in (task_comments, test_comments) for cs in each.values() for c in cs
    }
    part_ids: set[str | None] = {t.part_id for t in agendas} | {t.part_id for t in work}
    for lines in histories.values():
        for line in lines:
            member_ids.add(line.changed_by)
            for change in line.changes:
                ids = _id_values(change)
                if change.get("field") == "partId":
                    part_ids |= ids
                else:
                    member_ids |= ids
    names = await _names(session, Member, member_ids)
    parts = await _names(session, Part, part_ids)

    def who(member_id: str | None) -> str:
        return NO_OWNER if member_id is None else names.get(member_id, UNKNOWN)

    def by(member_id: str | None) -> str:
        # 이력 · 댓글의 '누가' — 비어 있으면 지난 데이터라 모른다
        return UNKNOWN if member_id is None else names.get(member_id, UNKNOWN)

    def part(part_id: str | None) -> str:
        return COMMON_PART if part_id is None else parts.get(part_id, UNKNOWN)

    def brief(task_id: str) -> dict[str, str]:
        found = briefs.get(task_id)
        return {"id": task_id, "key": found[0], "title": found[1]} if found else {"id": task_id}

    def comment(c: _Comment) -> dict[str, Any]:
        return {
            "author": by(c.author_id),
            "date": kst_day(c.created_at).isoformat(),
            "body": _cut(c.body),
        }

    def task_detail(row: dict[str, Any]) -> dict[str, Any]:
        found = since.get(row["id"])
        changed = found.changed_at if found is not None else row["created_at"]
        checklist = checklists.get(row["id"])
        return {
            "id": row["id"],
            "key": row["key"],
            "title": row["title"],
            "status": row["status"],
            "due": _day(row["due"]),
            "owner": who(row["owner_id"]),
            "progress": {
                "checklist": ({"done": checklist[0], "total": checklist[1]} if checklist else None),
                "statusDays": max((today - kst_day(changed)).days, 0),
            },
            "recentComments": [comment(c) for c in task_comments.get(row["id"], [])],
        }

    def test_detail(test: _Test, agenda_id: str) -> dict[str, Any]:
        latest = test_comments.get(test.id)
        return {
            "id": test.id,
            "key": test.key,
            "title": test.title,
            "status": test.status,
            "signals": test.signals,
            "via": via[(agenda_id, test.id)],
            "latestAction": comment(latest[-1]) if latest else None,
        }

    def owner_load(member_id: str | None) -> dict[str, Any] | None:
        if member_id is None:
            return None
        load = owner_loads.get(member_id)
        doing, blocked = task_loads.get(member_id, (0, 0))
        return {
            "member": who(member_id),
            "openAgendas": load.open_agendas if load else 0,
            "overdueAgendas": load.overdue_agendas if load else 0,
            "doingTasks": doing,
            "blockedTasks": blocked,
        }

    shown_tests: set[str] = set()
    details: list[dict[str, Any]] = []
    for risk in top:
        row = rows.get(risk.agenda_id)
        if row is None:
            continue
        picked = sorted(
            (tests[test_id] for (agenda_id, test_id) in via if agenda_id == risk.agenda_id),
            key=lambda t: t.seq,
        )[:TESTS_PER_AGENDA]
        shown_tests |= {t.id for t in picked}
        lines = histories.get(risk.agenda_id, [])
        details.append(
            {
                "id": row.id,
                "title": row.title,
                "description": row.description,
                "decision": row.decision,
                "history": _history(row, lines, who=who, by=by, part=part),
                "meetings": _meetings(row, lines, minutes),
                "tasks": [task_detail(task) for task in linked.get(risk.agenda_id, [])],
                "tests": [test_detail(t, risk.agenda_id) for t in picked],
                "ownerLoad": owner_load(risk.owner_id),
            }
        )

    payload: dict[str, Any] = {
        "report": {
            "asOf": report.as_of.isoformat(),
            "settings": report.settings.model_dump(by_alias=True),
            "agendas": [
                {
                    "id": t.agenda_id,
                    "title": t.title,
                    "state": t.state,
                    "owner": who(t.owner_id),
                    "part": part(t.part_id),
                    "dueDate": _day(t.due_date),
                    "overdueDays": t.overdue_days,
                    "idleDays": t.idle_days,
                    "blockedTasks": [brief(i) for i in t.blocked_task_ids],
                    "waitingTasks": [brief(i) for i in t.waiting_task_ids],
                    "impactTaskCount": t.impact_task_count,
                    "nearestTaskDue": _day(t.nearest_task_due),
                    "signals": t.signals,
                    "score": t.score,
                    "level": t.level,
                }
                for t in agendas
            ],
            "tasks": [_task_line(t, who, part) for t in risk_tasks],
            "tests": [_test_line(t, who, part) for t in risk_tests],
            "owners": [_owner(o, who) for o in report.owners],
        },
        "details": details,
        "taskDetails": [
            {
                "id": t.task_id,
                "key": t.key,
                "title": t.title,
                "checklist": (
                    {"done": checklists[t.task_id][0], "total": checklists[t.task_id][1]}
                    if t.task_id in checklists
                    else None
                ),
                "recentComments": [comment(c) for c in task_comments.get(t.task_id, [])],
                "dueFlow": t.due_flow,
                "recentChanges": _recent_changes(
                    task_changes.get(t.task_id, []), today, report.settings
                ),
                "openAgendas": [agenda_titles[i] for i in t.open_agenda_ids if i in agenda_titles],
            }
            for t in top_tasks
        ],
        "testDetails": [
            {
                "id": t.test_id,
                "key": t.key,
                "title": t.title,
                "recentActions": [
                    comment(c) for c in test_comments.get(t.test_id, [])[-ACTIONS_PER_TEST:]
                ],
                "statusFlow": _status_flow(
                    test_changes.get(t.test_id, []), t.status, today, report.settings
                ),
                "taggedTasks": [
                    {"key": briefs[ref.id][0], "title": briefs[ref.id][1]}
                    for ref in t.refs
                    if ref.kind == "task" and ref.id in briefs
                ],
                "taggedAgendas": [
                    agenda_titles[ref.id]
                    for ref in t.refs
                    if ref.kind == "agenda" and ref.id in agenda_titles
                ],
            }
            for t in top_tests
        ],
    }
    snapshot = [
        AnalyzedAgenda(
            agenda_id=t.agenda_id,
            # 안건에는 아직 키가 없다
            key=None,
            title=t.title,
            level=t.level,
            score=t.score,
            signals=list(t.signals),
            owner_name=names.get(t.owner_id) if t.owner_id is not None else None,
        )
        for t in agendas
    ]

    def owner_name(member_id: str | None) -> str | None:
        return names.get(member_id) if member_id is not None else None

    facts = RiskAnalysisFacts(
        as_of=report.as_of,
        settings=AnalysisSettings.model_validate(report.settings.model_dump()),
        agendas=snapshot,
        tasks=[
            AnalyzedTask(
                task_id=t.task_id,
                key=t.key,
                title=t.title,
                level=t.level,
                score=t.score,
                signals=list(t.signals),
                owner_name=owner_name(t.owner_id),
            )
            for t in risk_tasks
        ],
        tests=[
            AnalyzedTest(
                test_id=t.test_id,
                key=t.key,
                title=t.title,
                level=t.level,
                score=t.score,
                signals=list(t.signals),
                owner_name=owner_name(t.owner_id),
            )
            for t in risk_tests
        ],
        compare=None,
    )
    facts.compare = analysis_service.compare(previous, facts)
    payload["compare"] = _compare_doc(facts, previous)
    return SummaryContext(
        payload=payload,
        agenda_ids={t.agenda_id for t in agendas},
        # 작업 · 테스트 리스크 줄은 보고서에 다 실었으니 다 칩이 될 수 있다
        task_ids=task_ids | linked_ids | {t.task_id for t in risk_tasks},
        test_ids=shown_tests | {t.test_id for t in risk_tests},
        facts=facts,
    )


def _compare_doc(facts: RiskAnalysisFacts, previous: RiskAnalysis | None) -> dict[str, Any] | None:
    """Claude 에 줄 지난 분석 대비 — 줄은 id 대신 종류 · 제목 · 키로. 빠진 줄은 앞 스냅샷 제목.

    id 를 주지 않으니 빠진 줄은 근거 칩이 되지 않는다 — 지웠을 수도 있다.
    """
    compared = facts.compare
    if compared is None or previous is None:
        return None
    before_facts = RiskAnalysisFacts.model_validate(previous.facts)
    before = _named_lines(before_facts)
    current = _named_lines(facts)

    def ref(item: Any) -> tuple[str, str]:
        # 옛 모양(안건 id 문자열)은 새로 만들지 않지만 같은 함수로 읽는다
        return ("agenda", item) if isinstance(item, str) else (item.kind, item.id)

    return {
        "previousTitle": compared.previous_title,
        "previousSavedOn": analysis_service.saved_on(compared.previous_saved_at),
        "previousAgendaCount": len(before_facts.agendas),
        "previousTaskCount": len(before_facts.tasks),
        "previousTestCount": len(before_facts.tests),
        "added": [current[ref(i)] for i in compared.added],
        "removed": [before[ref(i)] for i in compared.removed],
        "kept": [
            {**current[(k.kind, k.id)], "levelFrom": k.level_from, "levelTo": k.level_to}
            for k in compared.kept
            if not isinstance(k, KeptAgenda)
        ],
    }


KIND_LABELS = {"agenda": "안건", "task": "작업", "test": "테스트"}


def _named_lines(facts: RiskAnalysisFacts) -> dict[tuple[str, str], dict[str, Any]]:
    def named(kind: str, title: str, key: str | None) -> dict[str, Any]:
        return {"kind": KIND_LABELS[kind], "title": title, **({"key": key} if key else {})}

    found = {("agenda", r.agenda_id): named("agenda", r.title, r.key) for r in facts.agendas}
    found |= {("task", r.task_id): named("task", r.title, r.key) for r in facts.tasks}
    found |= {("test", r.test_id): named("test", r.title, r.key) for r in facts.tests}
    return found


def _task_line(
    t: TaskRisk, who: Callable[[str | None], str], part: Callable[[str | None], str]
) -> dict[str, Any]:
    return {
        "id": t.task_id,
        "key": t.key,
        "title": t.title,
        "status": t.status,
        "owner": who(t.owner_id),
        "part": part(t.part_id),
        "start": _day(t.start),
        "due": _day(t.due),
        "overdueDays": t.overdue_days,
        "statusDays": t.status_days,
        "plannedDays": t.planned_days,
        "slipCount": t.slip_count,
        "contentChanges": t.content_changes,
        "ownerChanges": t.owner_changes,
        "openAgendaIds": t.open_agenda_ids,
        "signals": t.signals,
        "score": t.score,
        "level": t.level,
    }


def _test_line(
    t: TestRisk, who: Callable[[str | None], str], part: Callable[[str | None], str]
) -> dict[str, Any]:
    return {
        "id": t.test_id,
        "key": t.key,
        "title": t.title,
        "status": t.status,
        "owner": who(t.owner_id),
        "part": part(t.part_id),
        "due": _day(t.due),
        "overdueDays": t.overdue_days,
        "statusDays": t.status_days,
        "slipCount": t.slip_count,
        "flips": t.flips,
        "signals": t.signals,
        "score": t.score,
        "level": t.level,
    }


class _WorkLine(NamedTuple):
    changed_at: datetime
    changes: list[dict[str, Any]]


async def _work_history(
    session: AsyncSession,
    model: type[TaskHistory] | type[TestHistory],
    project_id: str,
    ids: set[str],
) -> dict[str, list[_WorkLine]]:
    """위쪽 작업 · 테스트의 이력 — 한 번에, seq 순 (API.md Q15)."""
    if not ids:
        return {}
    parent = TaskHistory.task_id if model is TaskHistory else TestHistory.test_id
    rows = await session.execute(
        select(parent, model.changed_at, model.changes)
        .where(model.project_id == project_id, parent.in_(ids))
        .order_by(model.seq)
    )
    found: dict[str, list[_WorkLine]] = defaultdict(list)
    for owner_id, changed_at, changes in rows.tuples():
        found[owner_id].append(_WorkLine(changed_at, list(changes)))
    return found


def _recent(lines: list[_WorkLine], today: date, rule: RiskSettings) -> list[_WorkLine]:
    """리스크의 흔들림과 같은 창 — 최근 churnDays 일 안(그날 포함)."""
    return [line for line in lines if (today - kst_day(line.changed_at)).days <= rule.churn_days]


def _recent_changes(lines: list[_WorkLine], today: date, rule: RiskSettings) -> dict[str, int]:
    """최근 churnDays 일 안에 바뀐 칸(우리말)과 그 칸이 든 줄 수 — 등록 · 삭제 줄은 뺀다."""
    counts: dict[str, int] = {}
    for line in _recent(lines, today, rule):
        for field in dict.fromkeys(str(c.get("field")) for c in line.changes):
            if field in ("created", "deleted"):
                continue
            label = WORK_FIELD_LABELS.get(field, field)
            counts[label] = counts.get(label, 0) + 1
    return counts


def _status_flow(lines: list[_WorkLine], status: str, today: date, rule: RiskSettings) -> list[str]:
    """최근 churnDays 일 안의 상태 흐름(첫 옛 값 → 줄마다 새 값). 바뀐 적 없으면 지금 상태 하나."""
    flow: list[str] = []
    for line in _recent(lines, today, rule):
        for change in line.changes:
            if change.get("field") != "status":
                continue
            if not flow and isinstance(change.get("from"), str):
                flow.append(str(change["from"]))
            if isinstance(change.get("to"), str):
                flow.append(str(change["to"]))
    return flow or [status]


async def _agenda_titles(
    session: AsyncSession, project_id: str, agenda_ids: set[str]
) -> dict[str, str]:
    if not agenda_ids:
        return {}
    rows = await session.execute(
        select(Agenda.id, Agenda.title).where(
            Agenda.project_id == project_id,
            Agenda.id.in_(agenda_ids),
            Agenda.is_deleted.is_(False),
        )
    )
    return {row.id: row.title for row in rows}


def _owner(load: OwnerLoad, who: Callable[[str | None], str]) -> dict[str, Any]:
    return {
        "member": who(load.member_id),
        "openAgendas": load.open_agendas,
        "overdueAgendas": load.overdue_agendas,
        "blockedTasks": load.blocked_tasks,
        "blockingImpact": load.blocking_impact,
        "riskyTasks": load.risky_tasks,
        "riskyTests": load.risky_tests,
    }


def _id_values(change: dict[str, Any]) -> set[str | None]:
    """이름으로 바꿀 id 가 든 칸의 값들 — 담당자 · 파트 · 참조."""
    if change.get("field") not in ("ownerId", "partId", "ccIds"):
        return set()
    found: set[str | None] = set()
    for value in (change.get("from"), change.get("to")):
        if isinstance(value, list):
            found |= {each for each in value if isinstance(each, str)}
        elif isinstance(value, str):
            found.add(value)
    return found


def _history(
    row: Any,
    lines: list[_HistoryLine],
    *,
    who: Callable[[str | None], str],
    by: Callable[[str | None], str],
    part: Callable[[str | None], str],
) -> dict[str, Any]:
    """변경 이력 요약 — 횟수 · 흐름은 서버가 센다. 줄 순서는 seq 다 (API.md Q15)."""

    def changes_of(field: str) -> list[dict[str, Any]]:
        return [c for line in lines for c in line.changes if c.get("field") == field]

    def shown(field: str, value: Any) -> Any:
        if value is None and field not in ("ownerId", "partId"):
            return None
        match field:
            case "ownerId":
                return who(value)
            case "partId":
                return part(value)
            case "ccIds":
                return [by(each) for each in value] if isinstance(value, list) else value
        return _cut(value) if isinstance(value, str) else value

    def line_out(line: _HistoryLine) -> dict[str, Any]:
        fields = []
        for c in line.changes:
            field = str(c.get("field"))
            item: dict[str, Any] = {"field": FIELD_LABELS.get(field, field)}
            if field not in ("created", "deleted"):
                item["from"] = shown(field, c.get("from"))
                item["to"] = shown(field, c.get("to"))
            fields.append(item)
        return {
            "date": kst_day(line.changed_at).isoformat(),
            "by": by(line.changed_by),
            "changes": fields,
        }

    dues = changes_of("dueDate")
    states = changes_of("state")
    created = kst_day(row.created_at)
    return {
        "dueDateChanges": len(dues),
        "dueDateFlow": [dues[0].get("from"), *(c.get("to") for c in dues)] if dues else [],
        "ownerChanges": len(changes_of("ownerId")),
        "stateFlow": (
            [states[0].get("from"), *(c.get("to") for c in states)] if states else [row.state]
        ),
        "createdOn": created.isoformat(),
        "lastTouchedOn": max([created, *(kst_day(line.changed_at) for line in lines)]).isoformat(),
        "recent": [line_out(line) for line in lines[-HISTORY_LINES:]],
    }


def _meetings(
    row: Any, lines: list[_HistoryLine], minutes: dict[str, tuple[str, date]]
) -> dict[str, Any]:
    """이 안건을 다룬 회의록 — 안건을 만든 회의록 + 이력 줄을 남긴 회의록(2026-11-06 부터).

    지운 회의록은 출처가 비어 빠진다. 같은 회의록의 줄은 칸 이름을 모아 한 편으로 센다.
    """
    fields: dict[str, list[str]] = {}
    if row.minutes_id is not None:
        fields[row.minutes_id] = []
    for line in lines:
        if line.minutes_id is None:
            continue
        held = fields.setdefault(line.minutes_id, [])
        for change in line.changes:
            field = str(change.get("field"))
            label = FIELD_LABELS.get(field, field)
            if label not in held:
                held.append(label)
    if row.minutes_id is not None and not fields[row.minutes_id]:
        # 출처 칸이 생기기 전에 만든 안건 — 등록 줄에 회의록이 안 달려 있다
        fields[row.minutes_id] = [FIELD_LABELS["created"]]
    met = sorted((i for i in fields if i in minutes), key=lambda i: (minutes[i][1], i))
    return {
        "count": len(met),
        "recent": [
            {"title": minutes[i][0], "date": minutes[i][1].isoformat(), "fields": fields[i]}
            for i in met[-MEETINGS_MAX:]
        ],
    }


async def _agenda_rows(
    session: AsyncSession, project_id: str, agenda_ids: list[str]
) -> dict[str, Any]:
    if not agenda_ids:
        return {}
    rows = await session.execute(
        select(
            Agenda.id,
            Agenda.title,
            Agenda.description,
            Agenda.decision,
            Agenda.state,
            Agenda.minutes_id,
            Agenda.created_at,
        ).where(
            Agenda.project_id == project_id,
            Agenda.id.in_(agenda_ids),
            Agenda.is_deleted.is_(False),
        )
    )
    return {row.id: row for row in rows}


async def _linked_tasks(
    session: AsyncSession, project_id: str, agenda_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """안건마다 연결된 작업 — 지운 작업은 뺀다."""
    if not agenda_ids:
        return {}
    rows = await session.execute(
        select(
            TaskAgendaLink.agenda_id,
            Task.id,
            Task.key,
            Task.title,
            Task.status,
            Task.due,
            Task.owner_id,
            Task.created_at,
        )
        .join(Task, Task.id == TaskAgendaLink.task_id)
        .where(
            TaskAgendaLink.project_id == project_id,
            TaskAgendaLink.agenda_id.in_(agenda_ids),
            Task.is_deleted.is_(False),
        )
        .order_by(Task.seq)
    )
    found: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        found.setdefault(row.agenda_id, []).append(
            {
                "id": row.id,
                "key": row.key,
                "title": row.title,
                "status": row.status,
                "due": row.due,
                "owner_id": row.owner_id,
                "created_at": row.created_at,
            }
        )
    return found


async def _histories(
    session: AsyncSession, project_id: str, agenda_ids: list[str]
) -> dict[str, list[_HistoryLine]]:
    if not agenda_ids:
        return {}
    rows = await session.execute(
        select(
            AgendaHistory.agenda_id,
            AgendaHistory.changed_by,
            AgendaHistory.changed_at,
            AgendaHistory.changes,
            AgendaHistory.minutes_id,
        )
        .where(AgendaHistory.project_id == project_id, AgendaHistory.agenda_id.in_(agenda_ids))
        .order_by(AgendaHistory.seq)
    )
    found: dict[str, list[_HistoryLine]] = defaultdict(list)
    for agenda_id, changed_by, changed_at, changes, minutes_id in rows.tuples():
        found[agenda_id].append(_HistoryLine(changed_by, changed_at, list(changes), minutes_id))
    return found


async def _minutes(
    session: AsyncSession, project_id: str, minutes_ids: set[str]
) -> dict[str, tuple[str, date]]:
    """회의록 제목 · 날짜(회의 날짜, 없으면 등록일)."""
    if not minutes_ids:
        return {}
    rows = await session.execute(
        select(Minutes.id, Minutes.title, Minutes.meeting_date, Minutes.created_at).where(
            Minutes.project_id == project_id, Minutes.id.in_(minutes_ids)
        )
    )
    return {row.id: (row.title, row.meeting_date or kst_day(row.created_at)) for row in rows}


async def _checklists(session: AsyncSession, task_ids: set[str]) -> dict[str, tuple[int, int]]:
    """작업마다 체크리스트 (완료, 전체). 체크 줄이 없는 작업은 키가 없다."""
    if not task_ids:
        return {}
    rows = await session.execute(
        select(
            TaskLine.task_id,
            func.sum(case((TaskLine.done.is_(True), 1), else_=0)),
            func.count(),
        )
        .where(TaskLine.task_id.in_(task_ids), TaskLine.kind == "check")
        .group_by(TaskLine.task_id)
    )
    return {task_id: (int(done or 0), int(total)) for task_id, done, total in rows.tuples()}


async def _recent_comments(
    session: AsyncSession,
    model: type[TaskComment] | type[TestComment],
    parent_ids: set[str],
    limit: int,
) -> dict[str, list[_Comment]]:
    """작업 댓글 · 테스트 조치 내역의 최근 몇 개 — 한 번에, 오래된 것부터. 순서는 seq (Q15)."""
    if not parent_ids:
        return {}
    parent = TaskComment.task_id if model is TaskComment else TestComment.test_id
    ranked = (
        select(
            parent.label("parent_id"),
            model.author_id,
            model.created_at,
            model.body,
            model.seq,
            func.row_number().over(partition_by=parent, order_by=model.seq.desc()).label("rank"),
        )
        .where(parent.in_(parent_ids))
        .subquery()
    )
    rows = await session.execute(
        select(ranked.c.parent_id, ranked.c.author_id, ranked.c.created_at, ranked.c.body)
        .where(ranked.c.rank <= limit)
        .order_by(ranked.c.seq)
    )
    found: dict[str, list[_Comment]] = defaultdict(list)
    for parent_id, author_id, created_at, body in rows.tuples():
        found[parent_id].append(_Comment(author_id, created_at, body))
    return found


async def _troubled_tests(
    session: AsyncSession,
    project_id: str,
    agenda_ids: list[str],
    linked: dict[str, list[dict[str, Any]]],
    today: date,
) -> tuple[dict[str, _Test], dict[tuple[str, str], list[str]]]:
    """안건을 태그했거나 연결 작업을 태그한 테스트 중 실패 · 막힘 · 기준 바뀜인 것.

    돌려주는 via 는 (안건 id, 테스트 id) → 닿은 길(안건 직접 · 작업 키).
    상태 · 신호는 테스트 목록과 같은 셈(`test.build_tests`)을 쓴다.
    """
    task_agendas: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for linked_agenda, tasks in linked.items():
        for task in tasks:
            task_agendas[task["id"]].append((linked_agenda, task["key"]))
    if not agenda_ids:
        return {}, {}
    refs = await session.execute(
        select(TestRef.test_id, TestRef.agenda_id, TestRef.task_id).where(
            TestRef.project_id == project_id,
            or_(TestRef.agenda_id.in_(agenda_ids), TestRef.task_id.in_(list(task_agendas))),
        )
    )
    paths: dict[tuple[str, str], list[str]] = defaultdict(list)
    for test_id, tagged_agenda, task_id in refs.tuples():
        if tagged_agenda is not None:
            paths[(tagged_agenda, test_id)].insert(0, DIRECT)
        elif task_id is not None:
            for reached, key in task_agendas.get(task_id, []):
                paths[(reached, test_id)].append(key)
    if not paths:
        return {}, {}
    found = await session.scalars(
        select(TestCase).where(
            TestCase.project_id == project_id,
            TestCase.id.in_({test_id for _, test_id in paths}),
        )
    )
    cases = list(found.all())
    built = await test_service.build_tests(session, project_id, cases, today=today)
    seqs = {case.id: case.seq for case in cases}
    tests = {
        out.id: _Test(out.id, out.key, out.title, out.status, list(out.signals), seqs[out.id])
        for out in built
        if out.status in TROUBLED_STATUSES or BASIS_CHANGED in out.signals
    }
    via = {
        pair: sorted(set(path), key=path.index) for pair, path in paths.items() if pair[1] in tests
    }
    return tests, via


async def _task_loads(
    session: AsyncSession, project_id: str, owner_ids: Iterable[str | None]
) -> dict[str, tuple[int, int]]:
    """사람마다 맡은 작업 중 (진행 중, 막힘) — 이 프로젝트 · 지우지 않은 것만."""
    wanted = {i for i in owner_ids if i is not None}
    if not wanted:
        return {}
    rows = await session.execute(
        select(Task.owner_id, Task.status, func.count())
        .where(
            Task.project_id == project_id,
            Task.is_deleted.is_(False),
            Task.owner_id.in_(wanted),
            Task.status.in_(("doing", "blocked")),
        )
        .group_by(Task.owner_id, Task.status)
    )
    counts: dict[str, dict[str, int]] = defaultdict(dict)
    for owner_id, status, count in rows.tuples():
        if owner_id is not None:
            counts[owner_id][status] = count
    return {
        owner_id: (by_status.get("doing", 0), by_status.get("blocked", 0))
        for owner_id, by_status in counts.items()
    }


async def _tasks_by_id(
    session: AsyncSession, project_id: str, task_ids: set[str]
) -> dict[str, tuple[str, str]]:
    if not task_ids:
        return {}
    rows = await session.execute(
        select(Task.id, Task.key, Task.title).where(
            Task.project_id == project_id, Task.id.in_(task_ids), Task.is_deleted.is_(False)
        )
    )
    return {row.id: (row.key, row.title) for row in rows}


async def _names(
    session: AsyncSession, model: type[Member] | type[Part], ids: Iterable[str | None]
) -> dict[str, str]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await session.execute(select(model.id, model.name).where(model.id.in_(wanted)))
    return {row.id: row.name for row in rows}


def system_prompt(project_name: str, today: date) -> str:
    return SYSTEM_PROMPT.format(
        project_name=project_name, today=f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})"
    )


def user_message(context: SummaryContext) -> str:
    data = json.dumps(context.payload, ensure_ascii=False)
    return f"화면에 보이는 결정 리스크다. 답의 모양대로 정리하라.\n\n{data}"


async def nothing() -> AsyncIterator[ChatEvent]:
    """거른 뒤 아무 줄도 없을 때 — Claude 를 부르지 않는다."""
    yield DeltaEvent(text=NOTHING)
    yield DoneEvent(refs=[])


async def summarize(
    llm: LLMProvider,
    project_name: str,
    context: SummaryContext,
    *,
    today: date,
    session: AsyncSession | None = None,
    project_id: str | None = None,
    actor_id: str | None = None,
) -> AsyncIterator[ChatEvent]:
    """한 번 스트림으로 부른다. 열린 뒤의 실패는 error 이벤트로 — 이게 오면 done 은 안 온다.

    세션을 받으면 답을 끝까지 받은 뒤 임시 분석으로 남기고 done 에 `analysisId` 를 싣는다.
    화면이 끊으면 이 제너레이터가 남기기 전에 멈춘다 — 그래서 남기는 자리는 맨 끝 하나다.
    """
    written: list[str] = []
    finished = Finished("end")
    try:
        async for event in llm.stream(
            system=system_prompt(project_name, today), user_text=user_message(context)
        ):
            if isinstance(event, Finished):
                finished = event
                continue
            written.append(event.text)
            yield DeltaEvent(text=event.text)
    except LLMError as exc:
        yield ErrorEvent(code=exc.code, message=exc.message)
        return
    except Exception:
        log.exception("리스크 요약 중 오류")
        yield ErrorEvent(code="INTERNAL_ERROR", message="서버에서 오류가 발생했습니다.")
        return

    match finished.stop:
        case "refused":
            yield ErrorEvent(
                code="CHAT_REFUSED",
                message="이 목록은 요약할 수 없습니다. 목록을 바꿔 다시 눌러 주세요.",
            )
            return
        case "max_tokens":
            # 잘린 글도 남긴다 — 화면에 보인 그대로, 잘렸다는 한 줄까지
            written.append(TRUNCATED)
            yield DeltaEvent(text=TRUNCATED)
    body = "".join(written)
    # 넣어 준 데이터에 없던 id 는 칩으로 내지 않는다 — 눌러도 열 것이 없다
    refs = [
        ref
        for ref in extract_refs(body)
        if ref.id
        in {"agenda": context.agenda_ids, "task": context.task_ids, "test": context.test_ids}.get(
            ref.kind, ()
        )
    ]
    if session is None or project_id is None or actor_id is None:
        yield DoneEvent(refs=refs)
        return
    try:
        analysis_id = await analysis_service.save_draft(
            session,
            project_id=project_id,
            actor_id=actor_id,
            body=body,
            refs=refs,
            facts=context.facts,
        )
    except Exception:
        # 글은 이미 다 보였다 — 저장만 못 하게 하고 분석은 그대로 끝낸다
        log.exception("임시 분석을 남기는 중 오류")
        await session.rollback()
        yield DoneEvent(refs=refs)
        return
    yield RiskSummaryDoneEvent(refs=refs, analysis_id=analysis_id)

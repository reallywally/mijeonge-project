"""리스크 화면의 [AI 요약] — 계약은 `docs/api/risk.md` 'AI 요약'.

판정은 규칙(`services/risk.py`)이, 설명은 Claude 가 한다. 읽을 것이 정해져 있어 도구 없이
근거를 미리 모아 한 번만 부른다. 남기지 않는다.
"""

import json
import logging
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import Finished, LLMError, LLMProvider
from app.models import Member, Part, Task, TaskThreadLink, Thread
from app.schemas.chat import ChatEvent, DeltaEvent, DoneEvent, ErrorEvent
from app.schemas.risk import DecisionRiskReport, RiskSummaryInput, TaskRisk, ThreadRisk
from app.services import risk as risk_service
from app.services import search as search_service
from app.services.chat import TRUNCATED, WEEKDAYS, extract_refs
from app.time import KST, as_utc

log = logging.getLogger(__name__)

# 배경 · 이력까지 읽어 줄 안건 수 — 점수 위쪽부터
DETAIL_THREADS = 5
NOTHING = "지금 짚을 리스크가 없습니다."
NO_OWNER = "담당자 없음"
UNKNOWN = "알 수 없음"
COMMON_PART = "공통"

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자가 리스크 화면에서 [AI 요약] 을 눌렀다. 화면에 지금 보이는 결정 리스크를 읽고
'그래서 뭐부터 하나' 를 짧게 정리한다.

## 받는 것
사용자 메시지의 JSON 하나다. 규칙으로 계산한 결정 리스크 보고서다.
- report.settings: 쓴 기준(dueSoonDays 기한 임박 날 수 · deferCount 여러 번 미룸 횟수 ·
  staleDays 오래 멈춤 날 수 · highScore · mediumScore 등급 문턱)
- report.threads: 위험한 안건(점수 내림차순). blockedTasks 는 이 안건 때문에 막힌 작업,
  waitingTasks 는 결정을 기다리는 작업, impactTaskCount 는 막힌 작업과 그 하위 작업 수
- report.tasks: 안건과 어긋난 작업(signal 하나). threads 는 근거 안건
- report.owners: 사람별 몰림(프로젝트 전체)
- details: 점수 위쪽 안건의 배경(description) · 후보(options) ·
  이력(entries, 오래된 것부터) · 연결된 작업.
  이력의 kind: raise 제기, defer 미룸, decide 결정, refine 세부, change 결정 변경, split 분리

## 답의 모양
화면은 마크다운을 그리지 않고 줄바꿈만 살린다. #, **, 표를 쓰지 말고 아래 모양을 글자 그대로 쓴다.

한 줄 총평 — 지금 가장 큰 병목이 무엇인지 한 문장

먼저 정할 것
1. [[thread:ID]] — 왜(신호를 화면 말로) · 무엇이 막히나(작업 수 · [[task:ID]]) · 다음 할 일 · 누가
2. … (최대 3개, report.threads 순서대로)

바로 풀 수 있는 것
- [[task:ID]] — 무엇을 하면 되는지

눈에 띄는 점
- 한 사람에게 몰림 · 같은 미룸 사유 반복 ·
  대부분이 '오래 멈춤' 이면 기준(staleDays)이 회의 주기보다 짧을 수 있다 등

- '먼저 정할 것' 은 report.threads 가 있을 때만 쓴다
- '바로 풀 수 있는 것' 은 report.tasks 에
  decidedButBlocked · blockedWithoutThread 가 있을 때만 쓴다.
  decidedButBlocked 는 걸린 안건이 다 정해졌으니 막힘을 풀어도 된다,
  blockedWithoutThread 는 막힌 이유(안건)가 안 걸려 있으니 이유를 적거나 안건을 걸라고 권한다
- '눈에 띄는 점' 은 데이터에서 실제로 보일 때만 1 ~ 2줄 쓴다
- 해당 없는 칸은 머리글까지 통째로 뺀다. 전체 800자 안팎

## 규칙
1. 점수 · 등급 · 날 수 · 날짜 · 작업 수는 받은 데이터 그대로만 쓴다. 지어내거나 고쳐 매기지 않는다
2. 신호는 영어 이름 대신 화면의 말로 쓴다 —
   overdue 기한 지남 · dueSoon 기한 임박 · deferredRepeatedly 여러 번 미룸 · stale 오래 멈춤 ·
   blocking 작업을 막는 중 · decisionAfterTaskDue 작업 기한이 먼저 · noOwner 담당자 없음 ·
   noDueDate 기한 없음 / decidedButBlocked 풀어도 됨 · blockedWithoutThread 막힌 이유 없음 ·
   dueBeforeDecision 결정이 기한보다 늦음. 등급은 high 높음 · medium 중간 · low 낮음
3. '다음 할 일' 은 이력에서 근거를 찾는다 — 마지막 미룸 사유가 "보안팀 의견 대기" 면
   "보안팀 의견을 받아 다음 회의에 올린다" 처럼.
   근거가 없으면 짐작하지 말고 담당자가 정하라고만 쓴다
4. 너는 아무것도 바꾸지 못한다. 상태 · 담당자 · 기한을 바꾸는 것은 사람에게 권하기만 한다
5. 답에 쓴 안건 · 작업마다 [[thread:ID]] · [[task:ID]] 를 붙인다. ID 는 받은 데이터의 id 그대로다.
   받은 데이터에 없는 ID 는 절대 쓰지 않는다. ID 는 [[…]] 안에만 쓰고, 본문에는 작업 키(HW-4) ·
   제목 · 이름으로 말한다
6. 한국어 존댓말(~습니다 · ~요)로 짧고 분명하게 쓴다. 영어 문장을 섞지 않는다.
   이력의 kind 이름(defer 등)을 그대로 쓰지 말고 우리말로 풀어 쓴다
"""


@dataclass
class SummaryContext:
    """Claude 에 넣을 근거. ids 는 근거 칩으로 내도 되는 id 다 — 넣지 않은 id 는 칩이 안 된다."""

    payload: dict[str, Any]
    thread_ids: set[str]
    task_ids: set[str]


async def build_context(
    session: AsyncSession, project_id: str, picked: RiskSummaryInput, *, today: date
) -> SummaryContext | None:
    """보고서를 다시 계산해 화면이 보낸 줄로 거른다. 거른 뒤 둘 다 비면 None — Claude 를 안 부른다.

    화면이 보낸 숫자는 받지도 않는다 — id 만 받아 서버의 계산으로 다시 고른다.
    """
    try:
        report = await risk_service.decision_risks(session, project_id, today=today)
        # 모르는 id(다른 프로젝트 · 이제는 리스크가 아닌 것 · 지어낸 것)는 조용히 버린다
        want_threads = set(picked.thread_ids)
        want_tasks = set(picked.task_ids)
        threads = [t for t in report.threads if t.thread_id in want_threads]
        tasks = [t for t in report.tasks if t.task_id in want_tasks]
        if not threads and not tasks:
            return None
        return await _collect(session, project_id, report, threads, tasks)
    finally:
        # 읽기만 한다 — Claude 가 답하는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


async def _collect(
    session: AsyncSession,
    project_id: str,
    report: DecisionRiskReport,
    threads: list[ThreadRisk],
    tasks: list[TaskRisk],
) -> SummaryContext:
    docs = [
        await search_service.get_thread(session, project_id, t.thread_id)
        for t in threads[:DETAIL_THREADS]
    ]
    linked = await _linked_tasks(session, project_id, [doc.thread.id for doc in docs])
    # 막힌 · 기다리는 작업을 키 · 제목으로 보이려고 — 이 프로젝트 안에서만 찾는다
    task_ids = {i for t in threads for i in (*t.blocked_task_ids, *t.waiting_task_ids)}
    briefs = await _tasks_by_id(session, project_id, task_ids)
    thread_titles = {t.thread_id: t.title for t in report.threads}
    thread_titles |= {doc.thread.id: doc.thread.title for doc in docs}
    # tasks 줄의 근거 안건은 이미 정해진 것일 수 있어 보고서 밖에서도 찾는다
    missing = {i for t in tasks for i in t.thread_ids} - thread_titles.keys()
    thread_titles |= await _thread_titles(session, project_id, missing)

    member_ids: set[str | None] = {t.owner_id for t in threads}
    member_ids |= {t.owner_id for t in tasks}
    member_ids |= {o.member_id for o in report.owners}
    member_ids |= {row["owner_id"] for rows in linked.values() for row in rows}
    names = await _names(session, Member, member_ids)
    parts = await _names(session, Part, {t.part_id for t in threads} | {t.part_id for t in tasks})

    def who(member_id: str | None) -> str:
        return NO_OWNER if member_id is None else names.get(member_id, UNKNOWN)

    def part(part_id: str | None) -> str:
        return COMMON_PART if part_id is None else parts.get(part_id, UNKNOWN)

    def brief(task_id: str) -> dict[str, str]:
        found = briefs.get(task_id)
        return {"id": task_id, "key": found[0], "title": found[1]} if found else {"id": task_id}

    def day(value: date | None) -> str | None:
        return value.isoformat() if value is not None else None

    payload: dict[str, Any] = {
        "report": {
            "asOf": report.as_of.isoformat(),
            "settings": report.settings.model_dump(by_alias=True),
            "threads": [
                {
                    "id": t.thread_id,
                    "title": t.title,
                    "state": t.state,
                    "owner": who(t.owner_id),
                    "part": part(t.part_id),
                    "dueDate": day(t.due_date),
                    "overdueDays": t.overdue_days,
                    "deferCount": t.defer_count,
                    "lastDeferNote": t.last_defer_note,
                    "idleDays": t.idle_days,
                    "blockedTasks": [brief(i) for i in t.blocked_task_ids],
                    "waitingTasks": [brief(i) for i in t.waiting_task_ids],
                    "impactTaskCount": t.impact_task_count,
                    "nearestTaskDue": day(t.nearest_task_due),
                    "signals": t.signals,
                    "score": t.score,
                    "level": t.level,
                }
                for t in threads
            ],
            "tasks": [
                {
                    "id": t.task_id,
                    "key": t.key,
                    "title": t.title,
                    "status": t.status,
                    "owner": who(t.owner_id),
                    "part": part(t.part_id),
                    "due": day(t.due),
                    "signal": t.signal,
                    "threads": [
                        {"id": i, "title": thread_titles.get(i, UNKNOWN)} for i in t.thread_ids
                    ],
                }
                for t in tasks
            ],
            "owners": [
                {
                    "member": who(o.member_id),
                    "openThreads": o.open_threads,
                    "overdueThreads": o.overdue_threads,
                    "blockedTasks": o.blocked_tasks,
                    "blockingImpact": o.blocking_impact,
                }
                for o in report.owners
            ],
        },
        "details": [
            {
                "id": doc.thread.id,
                "title": doc.thread.title,
                "description": doc.thread.description,
                "options": doc.thread.options,
                "entries": [
                    {
                        "kind": e.kind,
                        "text": e.text,
                        "detail": e.detail,
                        "note": e.note,
                        "date": as_utc(e.created_at).astimezone(KST).date().isoformat(),
                    }
                    for e in doc.entries
                ],
                "tasks": [
                    {
                        "id": row["id"],
                        "key": row["key"],
                        "title": row["title"],
                        "status": row["status"],
                        "due": day(row["due"]),
                        "owner": who(row["owner_id"]),
                    }
                    for row in linked.get(doc.thread.id, [])
                ],
            }
            for doc in docs
        ],
    }
    cited_tasks = {t.task_id for t in tasks} | task_ids
    cited_tasks |= {row["id"] for rows in linked.values() for row in rows}
    cited_threads = {t.thread_id for t in threads} | {i for t in tasks for i in t.thread_ids}
    return SummaryContext(payload=payload, thread_ids=cited_threads, task_ids=cited_tasks)


async def _linked_tasks(
    session: AsyncSession, project_id: str, thread_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """안건마다 연결된 작업 — get_thread 의 것에 기한 · 담당자를 더한 것."""
    if not thread_ids:
        return {}
    rows = await session.execute(
        select(
            TaskThreadLink.thread_id,
            Task.id,
            Task.key,
            Task.title,
            Task.status,
            Task.due,
            Task.owner_id,
        )
        .join(Task, Task.id == TaskThreadLink.task_id)
        .where(TaskThreadLink.project_id == project_id, TaskThreadLink.thread_id.in_(thread_ids))
        .order_by(Task.seq)
    )
    found: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        found.setdefault(row.thread_id, []).append(
            {
                "id": row.id,
                "key": row.key,
                "title": row.title,
                "status": row.status,
                "due": row.due,
                "owner_id": row.owner_id,
            }
        )
    return found


async def _tasks_by_id(
    session: AsyncSession, project_id: str, task_ids: set[str]
) -> dict[str, tuple[str, str]]:
    if not task_ids:
        return {}
    rows = await session.execute(
        select(Task.id, Task.key, Task.title).where(
            Task.project_id == project_id, Task.id.in_(task_ids)
        )
    )
    return {row.id: (row.key, row.title) for row in rows}


async def _thread_titles(
    session: AsyncSession, project_id: str, thread_ids: set[str]
) -> dict[str, str]:
    if not thread_ids:
        return {}
    rows = await session.execute(
        select(Thread.id, Thread.title).where(
            Thread.project_id == project_id, Thread.id.in_(thread_ids)
        )
    )
    return {row.id: row.title for row in rows}


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
) -> AsyncIterator[ChatEvent]:
    """한 번 스트림으로 부른다. 열린 뒤의 실패는 error 이벤트로 — 이게 오면 done 은 안 온다."""
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
            yield DeltaEvent(text=TRUNCATED)
    # 넣어 준 데이터에 없던 id 는 칩으로 내지 않는다 — 눌러도 열 것이 없다
    refs = [
        ref
        for ref in extract_refs("".join(written))
        if ref.id in (context.thread_ids if ref.kind == "thread" else context.task_ids)
    ]
    yield DoneEvent(refs=refs)

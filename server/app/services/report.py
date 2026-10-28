"""프로젝트 진행 리포트 — 만들기(SSE) · 목록 · 읽기 · 지우기. 계약은 `docs/api/report.md`.

판정은 규칙(`services/progress.py`)이, 설명 · 우선순위는 Claude 가 한다. 리스크 AI 요약과 같은 틀 —
근거를 미리 모아 도구 없이 한 번 부른다. **스트림이 끝까지 성공했을 때만 저장한다.**
"""

import json
import logging
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.llm import Finished, LLMError, LLMProvider
from app.models import (
    Entry,
    Member,
    Part,
    ProjectReport,
    Task,
    TaskLine,
    TaskThreadLink,
    Thread,
    new_id,
)
from app.schemas.chat import DeltaEvent, ErrorEvent
from app.schemas.report import (
    ProgressFacts,
    Report,
    ReportDoneEvent,
    ReportEvent,
    ReportFactsEvent,
    ReportItem,
    report_item,
)
from app.schemas.risk import DecisionRiskReport
from app.services import progress as progress_service
from app.services.access import Scope, forbidden
from app.services.chat import TRUNCATED, WEEKDAYS, extract_refs
from app.time import KST, as_utc, now

log = logging.getLogger(__name__)

# 본문 · 하위 작업 · 걸린 안건까지 읽어 줄 손쓸 작업 수 — 점수 위쪽부터
DETAIL_TASKS = 8
NO_TASKS = "아직 작업이 없어 리포트를 쓸 것이 없습니다."
NO_OWNER = "담당자 없음"
UNKNOWN = "알 수 없음"
COMMON_PART = "공통"

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자가 [리포트 만들기] 를 눌렀다. 서버가 지난 7일의 진행을 규칙으로 센 것을 읽고,
이번 주 프로젝트가 어디에 있는지와 **무엇을 먼저 손써야 하는지**를 근거와 함께 쓴다.

## 받는 것
사용자 메시지의 JSON 하나다.
- period: 기간(start ~ end, 한국 날짜). settings: 쓴 기준 —
  dueSoonDays 기한 임박 날 수 · staleDays 오래 멈춤 날 수
- progress: 지금 상태별 작업 수(todo 해야 할 일 · doing 진행 중 · blocked 막힘 · done 완료) ·
  doneRate 완료율(0.14 는 14%) · completed 기간 안에 완료된 작업 ·
  started 기간 안에 진행 중이 된 작업 · created 기간 안에 등록된 작업
- previous: 바로 앞 리포트의 숫자와 글. null 이면 첫 리포트다
- decisions: decided 기간 안에 정해진(또는 바뀐) 안건과 그 기간의 이력 ·
  deferred 기간 안에 미뤄진 안건과 그 기간의 이력 · risky 지금 결정 병목인 안건(등급 · 신호)
- attention: 손쓸 작업(score 내림차순). signals 는 규칙이 단 신호,
  statusDays 는 지금 상태가 된 뒤 지난 날 수(statusSinceBackfill 이 true 면 '적어도' 그만큼),
  plannedDays 는 계획 기간(start ~ due 의 날 수, 없으면 null),
  weight 는 무게(openChildren 안 끝난 하위 작업 수 ·
  openLines / totalLines 안 끝난 체크리스트 줄 / 전체 줄 · threadCount 걸린 안건 수 ·
  priority 중요도)
- details: attention 위쪽 작업의 본문(체크리스트 줄과 체크 여부) · 하위 작업 ·
  걸린 안건과 마지막 이력
- people: 사람별 진행 중 · 막힘 · 기한 지남 · 기간 안에 끝낸 수 · 손쓸 작업
- 이력의 kind: raise 제기, defer 미룸, decide 결정, refine 세부, change 결정 변경, split 분리

## 답의 모양
화면은 마크다운을 그리지 않고 줄바꿈만 살린다. #, **, 표를 쓰지 말고 아래 모양을 글자 그대로 쓴다.

한 줄 총평 — 이번 주 프로젝트가 어디에 있는지 한 문장

이번 주 진척
- 완료 N건(…) · 새로 시작 N건 · 완료율 x% (지난주 y%)

결정
- 정해진 것 [[thread:ID]] … · 미뤄진 것 [[thread:ID]] — 사유 · 아직 큰 병목 [[thread:ID]]

먼저 손쓸 것
1. [[task:ID]] — 무엇이 문제인지 · 왜 급한지 · 할 일 · 누구에게
2. …

사람
- 이름 — 진행 중 N · 막힘 N, …

다음 주 볼 것
- 1 ~ 3줄

- '먼저 손쓸 것' 은 최대 5개다. attention 의 score 순을 따르되 같은 원인으로 묶이는 것은 묶고,
  순서를 바꿔도 된다 — 바꾸면 왜인지 한마디 붙인다
- 한 줄마다 무엇이 문제인지(신호를 사람 말로, 숫자 그대로) · 왜 급한지(기한 · 무게 · 걸린 안건) ·
  할 일 · 누구에게를 쓴다.
  예: "HW-20 DB 설치가 진행 중이 된 지 12일째(계획 3일)입니다. 하위 작업 2개와
  체크리스트 8줄 중 5줄이 남아 있어 이도현 님께 진행 상황을 확인해 보세요."
- '사람' 은 한 사람에게 손쓸 작업 · 막힘이 몰렸을 때만 쓴다
- '지난주' 는 previous 가 있을 때만 쓴다. previous.body 는 지난 리포트의 글이다 —
  지난번에 짚은 것이 풀렸는지 그대로인지 한마디 보탠다
- 해당 없는 칸은 머리글까지 통째로 뺀다. 전체 1,500자 안팎

## 규칙
1. 숫자 · 날짜 · 날 수 · 작업 수는 받은 데이터 그대로만 쓴다. 지어내거나 고쳐 세지 않는다.
   statusSinceBackfill 이 true 면 "12일 이상" 처럼 '이상' 을 붙인다
2. "어렵다 · 크다" 는 weight 로 근거를 댄다 — "하위 작업 3개 남음, 체크리스트 8줄 중 5줄 남음" 처럼.
   근거가 없으면 어렵다고 말하지 않는다
3. 신호는 영어 이름 대신 화면의 말로 쓴다 — longRunning 오래 걸림 · longBlocked 오래 막힘 ·
   overdue 기한 지남 · notStarted 시작 안 함 · decidedButBlocked 풀어도 됨(걸린 안건이 다 정해졌다).
   리스크 등급은 high 높음 · medium 중간
4. 사람을 탓하는 말투를 쓰지 않는다 —
   '누가 못했나' 가 아니라 '어디에 일이 몰렸나 · 무엇이 막혔나' 다
5. 너는 아무것도 바꾸지 못한다. 상태 · 담당자 · 기한을 바꾸는 것은 사람에게 권하기만 한다
6. 답에 쓴 작업 · 안건마다 [[task:ID]] · [[thread:ID]] 를 붙인다. ID 는 받은 데이터의 id 그대로다.
   받은 데이터에 없는 ID 는 절대 쓰지 않는다. ID 는 [[…]] 안에만 쓰고, 본문에는 작업 키(HW-4) ·
   제목 · 이름으로 말한다
7. 한국어 존댓말(~습니다 · ~요)로 짧고 분명하게 쓴다. 영어 문장을 섞지 않는다.
   이력의 kind 이름(defer 등)을 그대로 쓰지 말고 우리말로 풀어 쓴다
"""


@dataclass
class ReportContext:
    """Claude 에 넣을 근거. ids 는 근거 칩으로 내도 되는 id 다 — 넣지 않은 id 는 칩이 안 된다."""

    payload: dict[str, Any]
    task_ids: set[str] = field(default_factory=set)
    thread_ids: set[str] = field(default_factory=set)


@dataclass
class Prepared:
    """계산 결과. context 가 None 이면 작업이 없다 — Claude 를 안 부른다."""

    facts: ProgressFacts
    context: ReportContext | None


async def prepare(session: AsyncSession, project_id: str, *, today: date) -> Prepared:
    try:
        facts, risks = await progress_service.progress_with_risks(session, project_id, today=today)
        p = facts.progress
        if p.todo + p.doing + p.blocked + p.done == 0:
            return Prepared(facts=facts, context=None)
        return Prepared(facts=facts, context=await _collect(session, project_id, facts, risks))
    finally:
        # 읽기만 한다 — Claude 가 쓰는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


async def _collect(
    session: AsyncSession, project_id: str, facts: ProgressFacts, risks: DecisionRiskReport
) -> ReportContext:
    context = ReportContext(payload={})
    task_rows = await session.execute(
        select(
            Task.id,
            Task.key,
            Task.title,
            Task.parent_id,
            Task.status,
            Task.owner_id,
            Task.part_id,
            Task.start,
            Task.due,
        )
        .where(Task.project_id == project_id)
        .order_by(Task.seq)
    )
    tasks = {row.id: row for row in task_rows}
    names = await _names(session, Member, (t.owner_id for t in tasks.values()))
    parts = await _names(session, Part, (t.part_id for t in tasks.values()))

    def who(member_id: str | None) -> str:
        return NO_OWNER if member_id is None else names.get(member_id, UNKNOWN)

    def brief(task_id: str) -> dict[str, Any]:
        row = tasks[task_id]
        context.task_ids.add(task_id)
        return {
            "id": task_id,
            "key": row.key,
            "title": row.title,
            "status": row.status,
            "owner": who(row.owner_id),
            "part": COMMON_PART if row.part_id is None else parts.get(row.part_id, UNKNOWN),
        }

    def briefs(task_ids: Iterable[str]) -> list[dict[str, Any]]:
        return [brief(i) for i in task_ids if i in tasks]

    def day(value: date | None) -> str | None:
        return value.isoformat() if value is not None else None

    p = facts.progress
    d = facts.decisions
    previous = await _previous_body(session, facts)
    thread_docs = await _period_threads(
        session, project_id, [*d.decided_thread_ids, *d.deferred_thread_ids], facts
    )
    risky = {t.thread_id: t for t in risks.threads}
    top = facts.attention[:DETAIL_TASKS]

    def thread_doc(thread_id: str) -> dict[str, Any]:
        context.thread_ids.add(thread_id)
        return thread_docs[thread_id]

    def risky_doc(thread_id: str) -> dict[str, Any]:
        context.thread_ids.add(thread_id)
        t = risky[thread_id]
        return {
            "id": thread_id,
            "title": t.title,
            "owner": who(t.owner_id),
            "level": t.level,
            "score": t.score,
            "signals": t.signals,
            "blockedTasks": briefs(t.blocked_task_ids),
        }

    context.payload = {
        "period": {"start": facts.period_start.isoformat(), "end": facts.period_end.isoformat()},
        "settings": {
            "dueSoonDays": facts.settings.due_soon_days,
            "staleDays": facts.settings.stale_days,
        },
        "progress": {
            "todo": p.todo,
            "doing": p.doing,
            "blocked": p.blocked,
            "done": p.done,
            "doneRate": p.done_rate,
            "completed": briefs(p.completed_task_ids),
            "started": briefs(p.started_task_ids),
            "created": briefs(p.created_task_ids),
        },
        "previous": previous,
        "decisions": {
            "decided": [thread_doc(i) for i in d.decided_thread_ids if i in thread_docs],
            "deferred": [thread_doc(i) for i in d.deferred_thread_ids if i in thread_docs],
            "risky": [risky_doc(i) for i in d.risky_thread_ids if i in risky],
        },
        "attention": [
            {
                **brief(a.task_id),
                "start": day(tasks[a.task_id].start),
                "due": day(tasks[a.task_id].due),
                "signals": a.signals,
                "statusDays": a.status_days,
                "statusSinceBackfill": a.status_since_backfill,
                "plannedDays": a.planned_days,
                "weight": a.weight.model_dump(by_alias=True),
                "score": a.score,
            }
            for a in facts.attention
            if a.task_id in tasks
        ],
        "details": await _details(session, project_id, [a.task_id for a in top], tasks, briefs),
        "people": [
            {
                "member": who(person.member_id),
                "doing": person.doing,
                "blocked": person.blocked,
                "overdue": person.overdue,
                "completed": person.completed,
                "attention": briefs(person.attention_task_ids),
            }
            for person in facts.people
        ],
    }
    # 근거 칩이 되는 안건 — details 의 걸린 안건도 넣어 준 것이다
    for detail in context.payload["details"]:
        context.thread_ids.update(t["id"] for t in detail["threads"])
    return context


async def _details(
    session: AsyncSession,
    project_id: str,
    task_ids: list[str],
    tasks: dict[str, Any],
    briefs: Callable[[Iterable[str]], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not task_ids:
        return []
    line_rows = await session.execute(
        select(TaskLine.task_id, TaskLine.kind, TaskLine.text, TaskLine.done, TaskLine.level)
        .where(TaskLine.task_id.in_(task_ids))
        .order_by(TaskLine.task_id, TaskLine.sort_order)
    )
    lines: dict[str, list[dict[str, Any]]] = {}
    for row in line_rows:
        line: dict[str, Any] = {"kind": row.kind, "text": row.text, "level": row.level}
        if row.kind == "check":
            line["done"] = row.done
        lines.setdefault(row.task_id, []).append(line)

    link_rows = await session.execute(
        select(TaskThreadLink.task_id, Thread.id, Thread.title, Thread.state)
        .join(Thread, Thread.id == TaskThreadLink.thread_id)
        .where(TaskThreadLink.project_id == project_id, TaskThreadLink.task_id.in_(task_ids))
        .order_by(Thread.seq)
    )
    links = list(link_rows.tuples())
    last = await _last_entries(session, {thread_id for _, thread_id, _, _ in links})
    threads: dict[str, list[dict[str, Any]]] = {}
    for task_id, thread_id, title, state in links:
        threads.setdefault(task_id, []).append(
            {"id": thread_id, "title": title, "state": state, "lastEntry": last.get(thread_id)}
        )
    return [
        {
            "id": task_id,
            "key": tasks[task_id].key,
            "title": tasks[task_id].title,
            "body": lines.get(task_id, []),
            "children": briefs(t.id for t in tasks.values() if t.parent_id == task_id),
            "threads": threads.get(task_id, []),
        }
        for task_id in task_ids
        if task_id in tasks
    ]


def _entry(kind: str, text: str, note: str, created_at: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "text": text,
        "note": note,
        "date": as_utc(created_at).astimezone(KST).date().isoformat(),
    }


async def _last_entries(session: AsyncSession, thread_ids: set[str]) -> dict[str, dict[str, Any]]:
    """안건마다 마지막 이력 — seq 가 정한다 (API.md Q15)."""
    if not thread_ids:
        return {}
    last = (
        select(Entry.thread_id, func.max(Entry.seq).label("seq"))
        .where(Entry.thread_id.in_(thread_ids))
        .group_by(Entry.thread_id)
        .subquery()
    )
    rows = await session.execute(
        select(Entry.thread_id, Entry.kind, Entry.text, Entry.note, Entry.created_at).join(
            last, (last.c.thread_id == Entry.thread_id) & (last.c.seq == Entry.seq)
        )
    )
    return {row.thread_id: _entry(row.kind, row.text, row.note, row.created_at) for row in rows}


async def _period_threads(
    session: AsyncSession, project_id: str, thread_ids: list[str], facts: ProgressFacts
) -> dict[str, dict[str, Any]]:
    """정해진 · 미뤄진 안건 — 제목 · 상태 · 이번 기간의 이력(오래된 것부터)."""
    if not thread_ids:
        return {}
    rows = await session.execute(
        select(Thread.id, Thread.title, Thread.state).where(
            Thread.project_id == project_id, Thread.id.in_(thread_ids)
        )
    )
    docs: dict[str, dict[str, Any]] = {
        row.id: {"id": row.id, "title": row.title, "state": row.state, "entries": []}
        for row in rows
    }
    entries = await session.execute(
        select(Entry.thread_id, Entry.kind, Entry.text, Entry.note, Entry.created_at)
        .where(Entry.thread_id.in_(docs))
        .order_by(Entry.seq)
    )
    for row in entries:
        entry = _entry(row.kind, row.text, row.note, row.created_at)
        if facts.period_start.isoformat() <= entry["date"] <= facts.period_end.isoformat():
            docs[row.thread_id]["entries"].append(entry)
    return docs


async def _previous_body(session: AsyncSession, facts: ProgressFacts) -> dict[str, Any] | None:
    if facts.previous is None:
        return None
    body = await session.scalar(
        select(ProjectReport.body).where(ProjectReport.id == facts.previous.report_id)
    )
    return {
        "periodEnd": facts.previous.period_end.isoformat(),
        "doneRate": facts.previous.done_rate,
        "blocked": facts.previous.blocked,
        "body": body or "",
    }


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


def user_message(context: ReportContext) -> str:
    data = json.dumps(context.payload, ensure_ascii=False)
    return f"지난 7일의 프로젝트 진행이다. 답의 모양대로 리포트를 써라.\n\n{data}"


async def _save(
    session: AsyncSession, project_id: str, actor_id: str, facts: ProgressFacts, body: str
) -> ReportItem:
    row = ProjectReport(
        id=new_id(),
        project_id=project_id,
        period_start=facts.period_start,
        period_end=facts.period_end,
        facts=facts.model_dump(mode="json", by_alias=True),
        body=body,
        created_by=actor_id,
        created_at=now(),
    )
    session.add(row)
    await session.commit()
    return _item(row, facts)


async def empty(
    session: AsyncSession, project_id: str, actor_id: str, facts: ProgressFacts
) -> AsyncIterator[ReportEvent]:
    """작업이 하나도 없을 때 — Claude 없이 고정 문구로 저장한다."""
    yield ReportFactsEvent(facts=facts)
    yield DeltaEvent(text=NO_TASKS)
    item = await _save(session, project_id, actor_id, facts, NO_TASKS)
    yield ReportDoneEvent(report=item, refs=[])


async def write(
    llm: LLMProvider,
    session: AsyncSession,
    *,
    project_id: str,
    project_name: str,
    actor_id: str,
    prepared: Prepared,
    today: date,
) -> AsyncIterator[ReportEvent]:
    """facts → 글 조각 → (다 받으면) 저장 → done. 열린 뒤의 실패는 error 이고 저장하지 않는다.

    화면이 끊으면 이 제너레이터가 저장에 닿기 전에 멈춘다 — 그래서 저장은 맨 끝 한 자리뿐이다.
    """
    facts, context = prepared.facts, prepared.context
    assert context is not None, "작업이 없으면 empty 를 부른다"
    yield ReportFactsEvent(facts=facts)
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
        log.exception("리포트를 쓰는 중 오류")
        yield ErrorEvent(code="INTERNAL_ERROR", message="서버에서 오류가 발생했습니다.")
        return

    match finished.stop:
        case "refused":
            yield ErrorEvent(
                code="CHAT_REFUSED",
                message="이 리포트는 쓸 수 없습니다. 잠시 뒤에 다시 만들어 주세요.",
            )
            return
        case "max_tokens":
            # 잘린 글도 그대로 남긴다 — 잘렸다는 한 줄을 붙여서
            written.append(TRUNCATED)
            yield DeltaEvent(text=TRUNCATED)
    body = "".join(written)
    # 넣어 준 데이터에 없던 id 는 칩으로 내지 않는다 — 눌러도 열 것이 없다
    refs = [
        ref
        for ref in extract_refs(body)
        if ref.id in (context.thread_ids if ref.kind == "thread" else context.task_ids)
    ]
    try:
        item = await _save(session, project_id, actor_id, facts, body)
    except Exception:
        log.exception("리포트 저장 중 오류")
        await session.rollback()
        yield ErrorEvent(code="INTERNAL_ERROR", message="서버에서 오류가 발생했습니다.")
        return
    yield ReportDoneEvent(report=item, refs=refs)


def _item(row: ProjectReport, facts: ProgressFacts) -> ReportItem:
    return report_item(
        id_=row.id,
        project_id=row.project_id,
        facts=facts,
        created_by=row.created_by,
        created_at=row.created_at,
    )


async def load_report(session: AsyncSession, report_id: str) -> ProjectReport:
    row = await session.get(ProjectReport, report_id)
    if row is None:
        raise not_found("REPORT_NOT_FOUND", "리포트를 찾을 수 없습니다.")
    return row


async def list_reports(session: AsyncSession, project_id: str) -> list[ReportItem]:
    """최근 것 먼저(seq 내림차순). 숫자는 저장한 facts 에서 — 다시 계산하지 않는다."""
    rows = await session.scalars(
        select(ProjectReport)
        .where(ProjectReport.project_id == project_id)
        .order_by(ProjectReport.seq.desc())
    )
    return [_item(row, ProgressFacts.model_validate(row.facts)) for row in rows.all()]


async def get_report(session: AsyncSession, report_id: str) -> Report:
    row = await load_report(session, report_id)
    facts = ProgressFacts.model_validate(row.facts)
    return Report(**_item(row, facts).model_dump(), facts=facts, body=row.body)


async def delete_report(session: AsyncSession, report_id: str, scope: Scope) -> None:
    """만든 사람 · 그 프로젝트 관리자 · 시스템 관리자 — 회의록 · 댓글과 같은 경계."""
    row = await load_report(session, report_id)
    if row.created_by != scope.actor.id and not scope.can_manage:
        raise forbidden()
    await session.delete(row)
    await session.commit()

"""회의록 → 초안 — `POST /api/minutes/{minutesId}/draft`. 계약은 `docs/api/minutes.md`.

저장된 회의록 하나의 제목 · 회의 날짜 · 본문을 읽는다.

챗봇의 도구 루프를 줄여 다시 쓴다 — 클라이언트 · 모델 설정 · 읽기 도구 넷(`run_tool`) ·
오류 변환이 같다. 다른 것은 글을 흘리지 않고 `propose_minutes` 가 검사를 통과하면
초안 하나를 내고 끝나는 것이다.
저장하지 않는다.
"""

import json
import logging
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

from anthropic import AnthropicError, AsyncAnthropic
from anthropic.types.beta import (
    BetaMessage,
    BetaMessageParam,
    BetaTextBlockParam,
    BetaToolParam,
    BetaToolResultBlockParam,
    BetaToolUseBlock,
)
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.llm.anthropic_provider import FALLBACK_BETA
from app.models import Member, Part, PartMember
from app.schemas.minutes import (
    MINUTES_ENTRIES_MAX,
    MINUTES_TASKS_MAX,
    MINUTES_THREADS_MAX,
    MinutesDoneEvent,
    MinutesDraft,
    MinutesDraftEvent,
    MinutesErrorEvent,
    MinutesEvent,
    MinutesToolEvent,
    MinutesToolName,
)
from app.services import access
from app.services import chat as chat_service
from app.services import minutes as minutes_service
from app.services.chat import WEEKDAYS

log = logging.getLogger(__name__)

# 검사에 떨어진 초안을 고쳐 낼 기회. 넘으면 MINUTES_DRAFT_FAILED
MAX_FAILURES = 5
# Claude 를 부르는 횟수의 상한 — 안건을 찾는 차례 몇 번 + 초안을 고치는 차례 다섯 번이 들어가야 한다
MAX_ROUNDS = 10

READ_TOOLS = ("search_threads", "get_thread", "search_tasks", "list_members")

EMPTY_MESSAGE = "회의록에서 정할 것 · 할 일을 찾지 못했습니다."
FAILED_MESSAGE = "초안을 정리하지 못했습니다. 회의록을 조금 나눠 다시 정리해 주세요."
TOO_LONG_MESSAGE = "회의록이 길어 초안을 다 만들지 못했습니다. 회의록을 나눠 다시 정리해 주세요."
REFUSED_MESSAGE = "이 회의록은 정리할 수 없습니다. 내용을 바꿔 다시 정리해 주세요."

NUDGE = (
    "초안을 아직 내지 않았다. 글로 답하지 말고 propose_minutes 로 초안을 내라. "
    "정리할 것이 없으면 threads · entries · tasks 를 모두 빈 배열로 해서 부른다."
)
WRAP_UP = (
    "도구를 부를 수 있는 횟수가 거의 다 찼다. 더 찾지 말고 지금 propose_minutes 로 초안을 내라."
)

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 회의록 정리 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자 메시지로 오는 회의록(제목 · 회의 날짜 · 본문)을 읽고
**새 안건 · 이미 있는 안건에 붙일 이력 · 작업** 초안으로 나눠
propose_minutes 로 낸다. 너는 아무것도 저장하지 못한다 — 사람이 초안을 고르고 고쳐 [등록] 을 누른다.

## 이 프로젝트의 멤버 (담당자로 둘 수 있는 사람)
{members}

## 나누는 규칙
1. 정해진 것 → 이력 kind 'decide'. 결정을 바꾼 것도 decide 다.
   "다음에 다시" · "확인 후" 처럼 미룬 것 → 'defer', 사유를 note 에.
   범위를 좁히거나 조건을 더한 것 → 'refine'. 이 셋 말고는 쓰지 않는다
2. 아직 안 정했고 다음에 정해야 할 것 → 새 안건(entry: null). 후보가 말로 나오면 options 에
3. 새 안건이 이 회의에서 바로 정해졌거나 미뤄졌으면 그 새 안건의 entry 에 이력을 단다
4. 누가 하기로 한 일 → 작업. 어느 안건의 결정에서 나온 일이면 그 안건에 건다 —
   이 초안의 새 안건이면 thread_temp_ids, 이미 있는 안건이면 thread_ids 에
5. 새 안건을 내기 전에 search_threads 로 **이미 있는지 먼저 본다**. 있으면 새로 만들지 말고
   그 안건에 붙일 이력(entries)으로 낸다. 검색은 글자 일부가 맞는 것을 찾으니 짧은 낱말로,
   안 나오면 표현을 바꿔 다시 찾는다. 헷갈리면 get_thread 로 읽어 본다
6. 한 안건에 이력은 하나까지다. 같은 안건에 여러 말이 나왔으면 한 줄로 합치고 detail 에 나눠 적는다
7. 회의록에 없는 것을 지어내지 않는다.
   quote 는 근거가 된 회의록의 한두 문장을 **글자 그대로** 옮긴다
8. 사람: 위 멤버 목록으로 id 를 잇는다. 이름이 멤버에 없거나 여럿에 걸리면("김 책임" 등)
   owner_id 는 null 로 두고 회의록에서 부른 말을 owner_hint 에 적는다.
   owner_id 를 정했으면 owner_hint 는 ''
9. 날짜: {date_rule}
   말하지 않은 기한은 채우지 않는다(null). 작업 우선순위는 말하지 않았으면 normal
10. summary 는 회의 요약 서너 줄. 한국어로 짧게
11. temp_id 는 새 안건 n1, n2 …, 이력 e1, e2 …, 작업 t1, t2 … — 초안 안에서 서로 다르다.
    작업의 상위는 같은 초안의 앞 작업(parent_temp_id)이다. 이미 있는 작업 밑에 붙일 때만 parent_id
12. 개수: 새 안건 {threads_max}개 · 이력 {entries_max}개 · 작업 {tasks_max}개까지
13. 정리할 것이 하나도 없으면 threads · entries · tasks 를 모두 빈 배열로 해서
    propose_minutes 를 부른다
14. propose_minutes 가 오류를 돌려주면 problems 가 짚은 자리를 고쳐 다시 부른다.
    통과하면 거기서 끝난다 — 글로 답하지 않는다
"""

_DATE_OR_NULL = {"type": ["string", "null"], "description": "YYYY-MM-DD. 말하지 않았으면 null"}
_OWNER = {
    "type": ["string", "null"],
    "description": "멤버 목록의 id. 못 정했으면 null",
}
_OWNER_HINT = {
    "type": "string",
    "description": "owner_id 를 못 정했을 때 회의록에서 부른 말('김 책임'). 아니면 ''",
}
_QUOTE = {"type": "string", "description": "근거 — 회의록의 한두 문장을 글자 그대로"}
_ENTRY_FIELDS: dict[str, Any] = {
    "kind": {"type": "string", "enum": ["decide", "defer", "refine"]},
    "text": {"type": "string", "description": "한 줄 — 결정이면 무엇으로, 미룸이면 무엇을"},
    "detail": {"type": "array", "items": {"type": "string"}, "description": "조건별 상세"},
    "note": {"type": "string", "description": "왜 — 미룸이면 사유. 없으면 ''"},
    "owner_id": _OWNER,
    "owner_hint": _OWNER_HINT,
}
_ENTRY_REQUIRED = ["kind", "text", "detail", "note", "owner_id", "owner_hint"]

PROPOSE_TOOL: BetaToolParam = {
    "name": "propose_minutes",
    "description": (
        "회의록 초안을 화면에 낸다. 저장하지 않는다 — 사람이 고르고 고쳐 [등록] 을 누른다. "
        "틀리면 오류(problems: 자리 → 사유)로 돌려준다 — 고쳐서 다시 부른다. 통과하면 끝이다."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "meeting_date": {
                "type": ["string", "null"],
                "description": "회의록에서 읽은 회의 날짜 YYYY-MM-DD. 못 읽으면 null",
            },
            "summary": {"type": "string", "description": "회의 요약 서너 줄"},
            "threads": {
                "type": "array",
                "maxItems": MINUTES_THREADS_MAX,
                "description": "새 안건 — 이미 있는 안건이 아닐 때만",
                "items": {
                    "type": "object",
                    "properties": {
                        "temp_id": {"type": "string", "description": "n1, n2 …"},
                        "title": {"type": "string"},
                        "description": {"type": "string", "description": "배경. 없으면 ''"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "후보 선택지. 없으면 []",
                        },
                        "owner_id": _OWNER,
                        "owner_hint": _OWNER_HINT,
                        "due_date": {
                            "type": ["string", "null"],
                            "description": "결정 기한 YYYY-MM-DD. 말하지 않았으면 null",
                        },
                        "entry": {
                            "type": ["object", "null"],
                            "description": "이 회의에서 정해졌거나 미뤄졌으면 그 이력. 아니면 null",
                            "properties": _ENTRY_FIELDS,
                            "required": _ENTRY_REQUIRED,
                        },
                        "quote": _QUOTE,
                    },
                    "required": [
                        "temp_id",
                        "title",
                        "description",
                        "options",
                        "owner_id",
                        "owner_hint",
                        "due_date",
                        "entry",
                        "quote",
                    ],
                },
            },
            "entries": {
                "type": "array",
                "maxItems": MINUTES_ENTRIES_MAX,
                "description": "이미 있는 안건에 붙일 이력 — 한 안건에 하나까지",
                "items": {
                    "type": "object",
                    "properties": {
                        "temp_id": {"type": "string", "description": "e1, e2 …"},
                        "thread_id": {
                            "type": "string",
                            "description": "search_threads · get_thread 로 찾은 안건의 id",
                        },
                        **_ENTRY_FIELDS,
                        "quote": _QUOTE,
                    },
                    "required": ["temp_id", "thread_id", *_ENTRY_REQUIRED, "quote"],
                },
            },
            "tasks": {
                "type": "array",
                "maxItems": MINUTES_TASKS_MAX,
                "description": "누가 하기로 한 일. 배열 순서가 등록 순서, 상위가 하위보다 앞",
                "items": {
                    "type": "object",
                    "properties": {
                        "temp_id": {"type": "string", "description": "t1, t2 …"},
                        "parent_temp_id": {
                            "type": ["string", "null"],
                            "description": "상위 작업의 temp_id — 앞 항목만. 없으면 null",
                        },
                        "parent_id": {
                            "type": ["string", "null"],
                            "description": "이미 있는 작업 밑에 붙일 때 그 id. 아니면 null",
                        },
                        "title": {"type": "string"},
                        "owner_id": _OWNER,
                        "owner_hint": _OWNER_HINT,
                        "start": _DATE_OR_NULL,
                        "due": _DATE_OR_NULL,
                        "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                        "thread_temp_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "걸 새 안건의 temp_id. 없으면 []",
                        },
                        "thread_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "걸 이미 있는 안건의 id. 없으면 []",
                        },
                        "quote": _QUOTE,
                    },
                    "required": [
                        "temp_id",
                        "parent_temp_id",
                        "parent_id",
                        "title",
                        "owner_id",
                        "owner_hint",
                        "start",
                        "due",
                        "priority",
                        "thread_temp_ids",
                        "thread_ids",
                        "quote",
                    ],
                },
            },
        },
        "required": ["meeting_date", "summary", "threads", "entries", "tasks"],
    },
}

# 읽기 도구는 챗봇의 정의 그대로다 — 설명을 두 벌 갖지 않는다
TOOLS: list[BetaToolParam] = [
    *(tool for tool in chat_service.TOOLS if tool["name"] in READ_TOOLS),
    PROPOSE_TOOL,
]
_TOOL_NAMES: frozenset[str] = frozenset(tool["name"] for tool in TOOLS)


DATE_FROM_BODY = (
    "회의록에 회의 날짜가 있으면 meeting_date 에 YYYY-MM-DD 로 적고 그 날을 기준으로,\n"
    "   없으면 meeting_date 는 null 로 두고 오늘을 기준으로 "
    '"다음 주 금요일" 같은 말을 날짜로 바꾼다.'
)
DATE_GIVEN = (
    "회의 날짜는 {meeting_date} ({weekday}) 로 정해져 있다. meeting_date 에 그 값을 적고\n"
    '   그 날을 기준으로 "다음 주 금요일" 같은 말을 날짜로 바꾼다.'
)
NO_DATE = "(적혀 있지 않음)"


@dataclass
class MinutesSource:
    """정리할 회의록 — 스트림을 열기 전에 떠 둔다(ORM 객체는 rollback 으로 만료된다)."""

    title: str
    meeting_date: date | None
    body: str


def user_message(source: MinutesSource) -> str:
    """Claude 에게 주는 회의록 한 덩어리. 본문은 손대지 않는다 — quote 가 글자 그대로여야 한다."""
    meeting_date = source.meeting_date.isoformat() if source.meeting_date else NO_DATE
    return f"제목: {source.title}\n회의 날짜: {meeting_date}\n\n{source.body}"


@dataclass
class MinutesContext:
    """스트림을 열기 전에 떠 둔 것 — 아래 rollback 이 ORM 객체를 만료시킨다."""

    project_id: str
    project_name: str
    # (id, 이름, 파트 이름들)
    members: list[tuple[str, str, list[str]]]


async def build_context(
    session: AsyncSession, project_id: str, project_name: str
) -> MinutesContext:
    """담당자 후보(그 프로젝트의 활성 멤버)와 그 사람의 파트. 보관한 파트는 빼고 이름 순."""
    try:
        member_ids = await access.active_project_members(session, project_id)
        rows = await session.execute(
            select(Member.id, Member.name).where(Member.id.in_(member_ids)).order_by(Member.id)
        )
        parts = await session.execute(
            select(PartMember.member_id, Part.name)
            .join(Part, Part.id == PartMember.part_id)
            .where(Part.project_id == project_id, Part.active.is_(True))
            .order_by(Part.name)
        )
        part_names: dict[str, list[str]] = {}
        for member_id, part_name in parts.tuples().all():
            part_names.setdefault(member_id, []).append(part_name)
        return MinutesContext(
            project_id=project_id,
            project_name=project_name,
            members=[
                (member_id, name, part_names.get(member_id, []))
                for member_id, name in rows.tuples().all()
            ],
        )
    finally:
        # 읽기만 한다 — Claude 를 부르는 동안 트랜잭션을 붙잡지 않는다
        await session.rollback()


def system_prompt(context: MinutesContext, today: date, meeting_date: date | None = None) -> str:
    date_rule = (
        DATE_GIVEN.format(
            meeting_date=meeting_date.isoformat(), weekday=WEEKDAYS[meeting_date.weekday()]
        )
        if meeting_date is not None
        else DATE_FROM_BODY
    )
    members = "\n".join(
        f"- {member_id} · {name} · {', '.join(parts) if parts else '파트 없음'}"
        for member_id, name, parts in context.members
    )
    return SYSTEM_PROMPT.format(
        project_name=context.project_name,
        today=f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})",
        members=members or "(없음)",
        threads_max=MINUTES_THREADS_MAX,
        entries_max=MINUTES_ENTRIES_MAX,
        tasks_max=MINUTES_TASKS_MAX,
        date_rule=date_rule,
    )


def tool_label(name: MinutesToolName, raw: object) -> str:
    query = raw.get("query") if isinstance(raw, dict) else None
    shown = f'"{query.strip()[:30]}" ' if isinstance(query, str) and query.strip() else ""
    match name:
        case "search_threads":
            return f"{shown}기존 안건 찾는 중"
        case "get_thread":
            return "안건 이력 읽는 중"
        case "search_tasks":
            return f"{shown}기존 작업 찾는 중"
        case "list_members":
            return "멤버 확인 중"
        case "propose_minutes":
            return "초안 만드는 중"


@dataclass
class Checked:
    """propose_minutes 한 번의 결과. draft 가 있으면 통과, empty 면 정리할 것이 없다."""

    content: str
    is_error: bool
    draft: MinutesDraft | None = None
    empty: bool = False


async def check_draft(session: AsyncSession, project_id: str, raw: object) -> Checked:
    """propose_minutes. DB 에 쓰지 않는다 — 등록(`apply`)과 같은 검사로 보고,
    맞으면 초안을 돌려준다."""
    try:
        draft = MinutesDraft.model_validate(raw)
        threads, entries, tasks = minutes_service.normalize(
            draft.threads, draft.entries, draft.tasks
        )
        if not threads and not entries and not tasks:
            return Checked(content=json.dumps({"ok": True}), is_error=False, empty=True)
        found = await minutes_service.minutes_problems(session, project_id, threads, entries, tasks)
        if found:
            # 등록은 첫 오류만 내지만 Claude 에게는 한 번에 다 보여 준다 — 고치는 차례를 아낀다
            problems = {
                key: value for error in found for key, value in (error.detail or {}).items()
            }
            return Checked(
                content=json.dumps(
                    {"error": "초안이 올바르지 않다. 고쳐서 다시 불러라.", "problems": problems},
                    ensure_ascii=False,
                ),
                is_error=True,
            )
        cleaned = draft.model_copy(update={"threads": threads, "entries": entries, "tasks": tasks})
        return Checked(content=json.dumps({"ok": True}), is_error=False, draft=cleaned)
    except ValidationError as exc:
        return Checked(
            content=json.dumps(
                {"error": f"입력이 올바르지 않다: {exc.errors(include_url=False)}"},
                ensure_ascii=False,
                default=str,
            ),
            is_error=True,
        )
    finally:
        await session.rollback()


def _error(code: str, message: str) -> MinutesErrorEvent:
    return MinutesErrorEvent(code=code, message=message)


async def draft(
    client: AsyncAnthropic,
    session: AsyncSession,
    settings: Settings,
    context: MinutesContext,
    source: MinutesSource,
    *,
    today: date,
) -> AsyncIterator[MinutesEvent]:
    """도구 루프. 스트림이 열린 뒤의 실패는 error 이벤트로 접는다.

    error 가 오면 draft · done 은 안 온다.
    """
    try:
        async with aclosing(_loop(client, session, settings, context, source, today)) as events:
            async for event in events:
                yield event
                if isinstance(event, MinutesErrorEvent | MinutesDoneEvent):
                    return
    except AnthropicError as exc:
        failed = chat_service._api_error_event(exc)
        yield _error(failed.code, failed.message)
        return
    except Exception:
        log.exception("회의록 정리 중 오류")
        yield _error("INTERNAL_ERROR", "서버에서 오류가 발생했습니다.")
        return
    # 루프가 초안 없이 끝났다 — 상한에 닿았다
    yield _error("MINUTES_DRAFT_FAILED", FAILED_MESSAGE)


async def _loop(
    client: AsyncAnthropic,
    session: AsyncSession,
    settings: Settings,
    context: MinutesContext,
    source: MinutesSource,
    today: date,
) -> AsyncGenerator[MinutesEvent, None]:
    system = system_prompt(context, today, source.meeting_date)
    # 회의록은 차례마다 다시 실려 간다 — 캐시해 두면 두 번째 차례부터 싸다
    first: BetaTextBlockParam = {
        "type": "text",
        "text": user_message(source),
        "cache_control": {"type": "ephemeral"},
    }
    history: list[BetaMessageParam] = [{"role": "user", "content": [first]}]
    failures = 0

    for round_no in range(1, MAX_ROUNDS + 1):
        final: BetaMessage
        async with client.beta.messages.stream(
            model=settings.chat_model,
            max_tokens=settings.minutes_max_tokens,
            system=system,
            messages=history,
            tools=TOOLS,
            # 챗봇과 같은 이유로 auto — Sonnet 5.5 는 강제 호출이 400 이다.
            # thinking 도 넘기지 않는다
            tool_choice={"type": "auto"},
            output_config={"effort": settings.chat_effort},
            fallbacks="default",
            betas=[FALLBACK_BETA],
        ) as stream:
            # 글은 화면에 흘리지 않는다 — 초안만 낸다
            async for _ in stream:
                pass
            final = await stream.get_final_message()

        match final.stop_reason:
            case "refusal":
                yield _error("CHAT_REFUSED", REFUSED_MESSAGE)
                return
            case "max_tokens" | "model_context_window_exceeded":
                # 초안 도구의 입력이 잘렸다 — 다시 불러도 같은 자리에서 잘린다
                yield _error("MINUTES_DRAFT_FAILED", TOO_LONG_MESSAGE)
                return
            case "pause_turn":
                history.append(final.to_param())
                continue

        calls = [block for block in final.content if isinstance(block, BetaToolUseBlock)]
        history.append(final.to_param())
        if not calls:
            # 초안 없이 글로 끝냈다 — 한 번 고칠 기회로 세고 초안을 내라고 한다
            failures += 1
            if failures >= MAX_FAILURES:
                yield _error("MINUTES_DRAFT_FAILED", FAILED_MESSAGE)
                return
            history.append({"role": "user", "content": NUDGE})
            continue

        results: list[BetaToolResultBlockParam | BetaTextBlockParam] = []
        for call in calls:
            if call.name in _TOOL_NAMES:
                name = cast(MinutesToolName, call.name)
                yield MinutesToolEvent(name=name, label=tool_label(name, call.input))
            if call.name == "propose_minutes":
                checked = await check_draft(session, context.project_id, call.input)
                if checked.empty:
                    yield _error("MINUTES_EMPTY", EMPTY_MESSAGE)
                    return
                if checked.draft is not None:
                    found = checked.draft
                    if source.meeting_date is not None:
                        # 사람이 고른 회의 날짜가 기준이다 — Claude 가 본문에서 다르게 읽었어도
                        found = found.model_copy(update={"meeting_date": source.meeting_date})
                    yield MinutesDraftEvent(draft=found)
                    yield MinutesDoneEvent()
                    return
                failures += 1
                if failures >= MAX_FAILURES:
                    yield _error("MINUTES_DRAFT_FAILED", FAILED_MESSAGE)
                    return
                content, is_error = checked.content, checked.is_error
            elif call.name in READ_TOOLS:
                content, is_error = await chat_service.run_tool(
                    session, context.project_id, call.name, call.input
                )
            else:
                # 챗봇의 다른 도구(list_tasks 등)는 여기서 쥐여 주지 않았다
                content, is_error = (
                    json.dumps({"error": f"없는 도구다: {call.name}"}, ensure_ascii=False),
                    True,
                )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": content,
                    "is_error": is_error,
                }
            )
        if round_no == MAX_ROUNDS - 1:
            results.append({"type": "text", "text": WRAP_UP})
        history.append({"role": "user", "content": results})

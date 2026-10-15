import json
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterator, Sequence
from contextlib import aclosing
from typing import Any, cast

from anthropic import (
    AnthropicError,
    APIConnectionError,
    APIStatusError,
    AsyncAnthropic,
    RateLimitError,
)
from anthropic.types.beta import (
    BetaMessage,
    BetaMessageParam,
    BetaTextBlockParam,
    BetaToolParam,
    BetaToolResultBlockParam,
    BetaToolUseBlock,
)
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import ApiError
from app.schemas.chat import (
    ChatEvent,
    ChatMessage,
    ChatProposal,
    ChatRef,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    FindSimilarTasksInput,
    GetDecisionRisksInput,
    GetTaskInput,
    GetThreadInput,
    ListTasksInput,
    ProposalEvent,
    SearchTasksInput,
    SearchThreadsInput,
    TaskProposal,
    ToolEvent,
    ToolName,
)
from app.schemas.task import PROPOSAL_MAX
from app.services import project as project_service
from app.services import risk as risk_service
from app.services import search as search_service
from app.services import task as task_service
from app.time import today_kst

log = logging.getLogger(__name__)

# Claude 를 부르는 횟수의 상한. 끝없이 도는 루프는 돈이 샌다
MAX_ROUNDS = 6
# 거절에 대비해 서버 쪽 대체 모델을 켠다 — fallbacks 는 이 베타가 있어야 받는다
FALLBACK_BETA = "server-side-fallback-2026-07-01"

WEEKDAYS = "월화수목금토일"

REF_PATTERN = re.compile(r"\[\[(thread|task):([^\[\]\s]+)\]\]")
# 질문 속 작업 언급 — 화면의 @ 자동완성이 '@HW-4' 로 넣는다. 접두사 규칙은 프로젝트와 같다
# 뒤에 조사가 바로 붙어도('@HW-4는') 잡는다. 앞이 영숫자면 이메일 같은 것이라 뺀다
MENTION_PATTERN = re.compile(r"(?<![A-Za-z0-9_.@])@([A-Za-z][A-Za-z0-9]{0,7}-\d+)(?![A-Za-z0-9_])")

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 도우미다. 지금 프로젝트는 '{project_name}' 이다.
오늘은 {today} 이다(한국 시간).
사용자의 질문에 이 프로젝트에 저장된 안건(thread) · 안건 이력(entry) · 작업(task)을
찾아 근거로 답한다. 작업을 만들어 달라고 하면 작업 초안을 낸다.

## 찾는 법
- 답하기 전에 반드시 도구로 찾는다. 기억이나 짐작으로 답하지 않는다
- 검색은 글자 일부가 맞는 것을 찾는다. 처음에 안 나오면 표현을 바꿔 다시 찾는다
  (예: 'OS' ↔ '운영체제' ↔ '우분투', 'DB' ↔ '데이터베이스')
- 안건을 찾았으면 get_thread 로 이력을 읽고 답한다. 검색 결과의 한 줄만 보고 단정하지 않는다
- 도구 고르기: 특정 낱말 · 주제의 작업은 search_tasks, 작업 전체를 훑어야 하면(전체 현황 · 빠진 것)
  list_tasks, 중복 · 겹치는 작업은 find_similar_tasks 다. 하나를 자세히 보려면 get_task.
  리스크 · 막힘 · 무엇부터 정해야 하나는 get_decision_risks 다

## 중복 · 비슷한 작업
1. find_similar_tasks 로 글자가 비슷한 후보 쌍을 받는다. 작업 하나를 콕 집었으면 task_id 를 넣는다
2. 글자는 달라도 뜻이 같은 것(예: '계정 발급' ↔ '계정 배포')은 못 잡는다 —
   프로젝트 전체를 물었으면 list_tasks 로 제목을 훑어 보탠다
3. 후보는 get_task 로 본문을 읽고 판단한다. 다 못 읽으면 점수 높은 것부터 읽고,
   읽지 못한 것은 "제목만 봤다" 고 밝힌다
4. relation 이 parent_child(상위 ↔ 하위)인 쌍은 원래 범위가 겹친다 — 중복으로 치지 않는다.
   siblings 는 같은 상위 밑이라 겹칠 가능성이 크다.
   상위 본문의 체크리스트와 하위 작업이 겹치는 것은 말해도 된다
5. "중복 가능성 높음" · "확인 필요" 로 나눠 말하고,
   왜 그렇게 봤는지(제목 · 본문 · 담당자 · 기간)를 짧게 붙인다.
   합치거나 지우는 것은 화면에서 사람이 한다 — 너는 바꾸지 못한다

## 결정 리스크
1. "뭐가 위험해?" · "막힌 거 뭐 있어?" · "이번 주 뭐부터 정해야 해?" 처럼 리스크 · 막힘 · 우선순위를
   물으면 get_decision_risks 를 먼저 부른다.
   사람을 콕 집었으면 list_members 로 id 를 찾아 member_id 에,
   파트를 콕 집었으면 그 이름을 part_id 에 넣는다
2. 답은 level 이 high 인 것부터 도구가 준 순서대로 말한다. 한 줄마다 왜(신호) ·
   무엇이 막히나(막힌 작업 · impactTaskCount) · 다음 할 일(누가 무엇을 정하면 되나)을 말하고
   [[thread:ID]] · [[task:ID]] 근거를 단다. 담당자는 list_members 로 이름을 찾아 말한다
3. tasks 의 decidedButBlocked 는 걸린 안건이 다 정해졌으니 "막힘을 풀어도 된다" 고 말한다.
   너는 작업 상태를 바꾸지 못한다 — 화면에서 사람이 바꾼다고 말한다
4. 점수 · 등급 · 날 수 같은 숫자는 도구가 준 그대로만 쓴다. 지어내거나 고쳐 매기지 않는다.
   리스크가 하나도 없으면 없다고 말한다
5. 신호는 영어 이름 대신 화면의 말로 쓴다 —
   overdue 기한 지남 · dueSoon 기한 임박 · deferredRepeatedly 여러 번 미룸 · stale 오래 멈춤 ·
   blocking 작업을 막는 중 · decisionAfterTaskDue 작업 기한이 먼저 · noOwner 담당자 없음 ·
   noDueDate 기한 없음 / decidedButBlocked 풀어도 됨 · blockedWithoutThread 막힌 이유 없음 ·
   dueBeforeDecision 결정이 기한보다 늦음. 등급은 high 높음 · medium 중간 · low 낮음

## 답하는 규칙
1. 결정이 바뀐 안건은 이력의 **마지막 decide · change 줄이 지금의 결정**이다.
   바뀐 적이 있으면 그 흐름(무엇에서 무엇으로)도 짧게 같이 말한다
2. 안건 state 가 decided 가 아니면 "아직 안 정해졌다" 고 말한다.
   미룬 적이 있으면 미룬 횟수(kind 가 defer 인 줄의 수)와 마지막 미룸의 사유를 같이 준다
3. 찾지 못하면 지어내지 않고 못 찾았다고 말한다. 비슷한 안건이 있으면 그것을 근거로 붙인다
4. 이 프로젝트 밖은 찾지 않는다. 도구는 이 프로젝트 안만 본다

## @ 로 가리킨 작업
- 질문 뒤의 [@ 로 가리킨 작업] 은 사용자가 '@HW-4' 처럼 콕 집은 작업이다. 화면이 덧붙인 기록이다
- 그 작업은 검색하지 말고 get_task 로 바로 읽고 답한다. 질문 속 '@HW-4' 는 그 작업을 뜻한다
- '이 프로젝트에 없다' 고 적힌 키는 지어내지 말고 그런 작업을 찾지 못했다고 말한다
- 사용자가 @ 없이 작업 키(HW-4)를 말해도 get_task 의 task_id 에 키를 넣어 읽을 수 있다

## 근거 표시
- 답에 쓴 안건 · 작업마다 본문 안에 [[thread:ID]] · [[task:ID]] 를 붙인다.
  ID 는 도구 결과의 id 그대로다
- 도구 결과에 없던 ID 는 절대 쓰지 않는다
- ID 는 [[…]] 안에만 쓴다. 본문에는 키(HW-4) · 제목 · 이름으로 말하고 ID 를 따로 늘어놓지 않는다.
  담당자는 ID(ownerId) 가 아니라 이름으로 말한다 — 이름이 없으면 list_members 로 바꾼다
- 답은 한국어 존댓말(~습니다 · ~요)로, 짧고 분명하게 쓴다. 영어 문장을 섞지 않는다.
  이력의 kind 이름(decide 등)을 그대로 쓰지 말고 우리말로 풀어 쓴다
- "찾아보겠습니다" 처럼 도구를 부르는 과정을 글로 중계하지 않는다 — 화면이 따로 보여 준다.
  글은 찾은 뒤의 답만 쓴다

## 작업 초안
너는 작업을 저장하지 못한다. 초안을 내면 화면이 카드로 보여 주고, 사용자가 [등록] 을 눌러야
이 프로젝트에 저장된다.
1. 작업을 만들어 달라는 말에는 **초안만 낸다.** propose_tasks 로 낸다
2. 담당자 이름은 list_members 로 id 를 찾아 owner_id 에 넣는다.
   이름이 멤버에 없거나 여럿에 걸리면 **초안을 내지 말고** 누구인지 되묻는다
3. 묶음 이름이 있고 할 일이 둘 이상이면 묶음을 상위 작업으로, 할 일을 하위 작업
   (parent_temp_id 가 묶음의 temp_id)으로 둔다. 할 일이 하나면 상위 없이 하나만 낸다
4. 상위 작업은 같은 초안 안의 앞 항목(parent_temp_id)이거나, 이미 있는 작업(parent_id)이다.
   이미 있는 작업 밑에 붙일 때는 get_task 로 그 작업을 먼저 읽고 그 id 를 parent_id 에 넣는다.
   한 항목에 둘을 같이 쓰지 않는다. 초안 안의 하위의 하위는 parent_temp_id 로 잇는다
5. 날짜("다음 주 금요일")는 오늘을 기준으로 YYYY-MM-DD 로 바꾼다.
   말하지 않은 기간은 null, 우선순위는 normal 로 둔다. 짐작으로 채우지 않는다
6. propose_tasks 가 오류를 돌려주면 고쳐서 다시 부른다. 한 답에서 마지막으로 낸 초안만 화면에 보인다
7. 초안을 낸 뒤의 답은 짧게 — "아래처럼 등록할까요?" 정도. 초안 내용을 본문에 다시 늘어놓지 않고,
   "등록했다" 고 말하지 않는다
8. "@HW-20 분석해서 필요한 작업 하위에 추가해줘" 처럼 작업을 나눠 달라면:
   get_task 로 그 작업의 제목 · 본문 · 걸어 둔 안건 · 이미 있는 하위 작업(children)을 읽는다.
   걸린 안건의 결정이 할 일을 정하면 get_thread 로 읽는다. 그다음 그 작업을 끝내는 데 필요한데
   **children 에 아직 없는** 할 일만 하위 작업 초안(parent_id = 그 작업의 id)으로 낸다.
   이미 있는 하위 작업과 겹치는 것은 내지 않는다. 담당자 · 기간은 말하지 않았으면 비워 둔다.
   답에는 무엇을 근거로 나눴는지 한 줄 말하고,
   읽은 작업 · 안건의 [[task:ID]] · [[thread:ID]] 를 붙인다
9. 지난 답 뒤의 [작업 초안 …] 은 화면이 덧붙인 기록이다 — 네가 쓰는 형식이 아니다.
   '대기' · '취소' 인 초안을 고쳐 달라면 고친 새 초안을 낸다.
   '등록됨' 인 작업은 이미 저장됐다 — 채팅으로는 고치지 못하니 화면에서 고치라고 말한다
"""

WRAP_UP = (
    "검색 횟수 한도에 닿았다. 더 찾지 말고 지금까지 찾은 것만으로 답하라. "
    "확인하지 못한 것은 확인하지 못했다고 말하라."
)
GAVE_UP = "여러 번 찾아봤지만 답을 정리하지 못했습니다. 질문을 조금 더 구체적으로 해 주세요."
TRUNCATED = "\n\n(답이 길어 여기서 끊었습니다.)"

PROPOSED = (
    "초안을 화면에 보였다. 아직 저장되지 않았다 — 사용자가 [등록] 을 눌러야 저장된다. "
    "답은 '아래처럼 등록할까요?' 정도로 짧게 하라. 이미 있는 작업을 나눈 초안이면 "
    "무엇을 근거로 나눴는지 한 줄과 근거 표시를 붙인다."
)

_DATE_OR_NULL = {"type": ["string", "null"], "description": "YYYY-MM-DD. 말하지 않았으면 null"}

TOOLS: list[BetaToolParam] = [
    {
        "name": "search_threads",
        "description": (
            "이 프로젝트의 안건을 글자로 찾는다. "
            "제목 · 배경 · 후보 · 이력(결정 · 미룸 등)의 글을 본다. "
            "결과마다 id · state(queued 대기 / open 논의중 / decided 결정) · 맞은 자리(matched) · "
            "발췌(snippet) · 지금의 결정(decision, 마지막 decide/change 줄. 없으면 '')을 준다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "찾을 말. 짧을수록 잘 걸린다"},
                "state": {
                    "type": "string",
                    "enum": ["queued", "open", "decided"],
                    "description": "이 상태인 안건만",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_thread",
        "description": (
            "안건 하나를 읽는다 — 안건(배경 · 후보 포함) + 이력 전부(등록 순서, 오래된 것부터) "
            "+ 연결된 작업. 이력의 kind: raise 제기, defer 미룸, decide 결정, refine 세부, "
            "change 결정 변경, split 분리."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"thread_id": {"type": "string"}},
            "required": ["thread_id"],
        },
    },
    {
        "name": "search_tasks",
        "description": (
            "이 프로젝트의 작업을 낱말 · 주제로 찾는다. 제목과 본문 줄을 본다. "
            "status: todo 해야 할 일 / doing 진행 중 / blocked 막힘 / done 완료."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "status": {"type": "string", "enum": ["todo", "doing", "blocked", "done"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_task",
        "description": (
            "작업 하나를 읽는다 — 작업(본문 포함) + 걸어 둔 안건의 제목 · 상태. "
            "task_id 에는 작업 id 나 작업 키(HW-4)를 넣는다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "list_tasks",
        "description": (
            "이 프로젝트의 작업 전체를 한 줄씩 "
            "(id · key · title · status · parentKey · owner 이름) 준다. "
            "번호 순, 본문 없음. 작업 전체를 훑어야 할 때(전체 현황 · 중복 · 빠진 것) 쓴다. "
            "특정 낱말로 찾을 때는 search_tasks, 본문은 get_task 를 쓴다. "
            "truncated 가 true 면 앞에서 잘린 것이다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["todo", "doing", "blocked", "done"]},
            },
        },
    },
    {
        "name": "find_similar_tasks",
        "description": (
            "제목 · 본문 글자가 비슷한 작업 쌍을 유사도(score 0 ~ 1) 순으로 준다. "
            "중복 · 겹치는 작업을 찾을 때 먼저 쓴다. "
            "task_id(id 나 작업 키)를 주면 그 작업이 낀 쌍만 준다. "
            "글자가 다르고 뜻만 같은 것은 못 찾는다. "
            "relation: parent_child 는 상위 ↔ 하위, siblings 는 같은 상위 밑, null 은 관계 없음."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
        },
    },
    {
        "name": "get_decision_risks",
        "description": (
            "안 정해진 안건이 막는(막을) 일을 규칙으로 계산한 결정 리스크 보고서를 준다. "
            "threads: 위험한 안건(score 내림차순, level high/medium/low, signals, "
            "blockedTaskIds · impactTaskCount), tasks: 안건과 어긋난 작업(signal 하나), "
            "owners: 사람별로 몰린 정도(memberId null 은 담당자 없음), settings: 쓴 기준. "
            "member_id 를 주면 그 사람이 맡은 안건 · 작업만, part_id 를 주면 그 파트의 것만 남긴다"
            "(owners 는 그대로). 사람 이름으로 물으면 list_members 로 id 를 먼저 찾는다. "
            "part_id 에는 파트 이름(예: '인프라')을 그대로 넣어도 된다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "member_id": {"type": "string", "description": "list_members 의 id"},
                "part_id": {"type": "string", "description": "파트 id 나 파트 이름"},
            },
        },
    },
    {
        "name": "list_members",
        "description": (
            "이 프로젝트의 담당자 후보(활성 멤버) 목록(id · name)을 준다. "
            "담당자 이름을 owner_id 로 바꾸거나, "
            "도구 결과의 ownerId · memberId 를 이름으로 바꿀 때 쓴다. "
            "여기 없는 사람은 담당자로 둘 수 없다."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "propose_tasks",
        "description": (
            "작업 초안을 화면에 보인다. 저장하지 않는다 — 사용자가 [등록] 을 눌러야 저장된다. "
            "배열 순서가 등록 순서이고, 상위 작업이 늘 하위보다 앞이다. "
            "틀리면 오류로 돌려준다 — 고쳐서 다시 부른다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": PROPOSAL_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "temp_id": {
                                "type": "string",
                                "description": "이 초안 안에서만 쓰는 이름 — t1, t2 …",
                            },
                            "parent_temp_id": {
                                "type": ["string", "null"],
                                "description": "상위 작업의 temp_id — 앞 항목만. 없으면 null",
                            },
                            "parent_id": {
                                "type": ["string", "null"],
                                "description": (
                                    "이미 있는 작업 밑에 붙일 때 그 작업의 id "
                                    "(get_task 로 읽은 것). parent_temp_id 와 같이 쓰지 않는다. "
                                    "없으면 null"
                                ),
                            },
                            "title": {"type": "string"},
                            "owner_id": {
                                "type": ["string", "null"],
                                "description": "list_members 의 id. 말하지 않았으면 null",
                            },
                            "start": _DATE_OR_NULL,
                            "due": _DATE_OR_NULL,
                            "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                        },
                        "required": [
                            "temp_id",
                            "parent_temp_id",
                            "parent_id",
                            "title",
                            "owner_id",
                            "start",
                            "due",
                            "priority",
                        ],
                    },
                },
            },
            "required": ["tasks"],
        },
    },
]

_TOOL_NAMES: frozenset[str] = frozenset(tool["name"] for tool in TOOLS)


def make_client(settings: Settings) -> AsyncAnthropic | None:
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else ""
    if not key.strip():
        return None
    return AsyncAnthropic(api_key=key, timeout=settings.chat_timeout_seconds)


def extract_refs(text: str) -> list[ChatRef]:
    """본문에 실제로 나온 근거만, 처음 나온 순서대로 한 번씩."""
    seen: dict[tuple[str, str], ChatRef] = {}
    for kind, id_ in REF_PATTERN.findall(text):
        seen.setdefault((kind, id_), ChatRef(kind=kind, id=id_))
    return list(seen.values())


def tool_label(name: ToolName, raw: object) -> str:
    query = raw.get("query") if isinstance(raw, dict) else None
    shown = f'"{query.strip()[:30]}" ' if isinstance(query, str) and query.strip() else ""
    match name:
        case "search_threads":
            return f"{shown}안건 찾는 중"
        case "search_tasks":
            return f"{shown}작업 찾는 중"
        case "get_thread":
            return "안건 이력 읽는 중"
        case "get_task":
            return "작업 읽는 중"
        case "list_tasks":
            return "작업 목록 보는 중"
        case "find_similar_tasks":
            return "비슷한 작업 찾는 중"
        case "get_decision_risks":
            return "결정 리스크 보는 중"
        case "list_members":
            return "멤버 확인 중"
        case "propose_tasks":
            return "작업 초안 만드는 중"


async def run_tool(
    session: AsyncSession, project_id: str, name: str, raw: object
) -> tuple[str, bool]:
    """(결과 JSON 문자열, 오류인가). project_id 는 경로에서 온 것만 쓴다 — Claude 가 못 바꾼다."""
    try:
        match name:
            case "search_threads":
                a = SearchThreadsInput.model_validate(raw)
                threads = await search_service.search_threads(
                    session, project_id, a.query, state=a.state, limit=a.limit
                )
                return _dump_list(threads), False
            case "search_tasks":
                b = SearchTasksInput.model_validate(raw)
                tasks = await search_service.search_tasks(
                    session, project_id, b.query, status=b.status, limit=b.limit
                )
                return _dump_list(tasks), False
            case "get_thread":
                c = GetThreadInput.model_validate(raw)
                doc = await search_service.get_thread(session, project_id, c.thread_id)
                return doc.model_dump_json(by_alias=True), False
            case "get_task":
                d = GetTaskInput.model_validate(raw)
                task = await search_service.get_task(session, project_id, d.task_id)
                return task.model_dump_json(by_alias=True), False
            case "list_tasks":
                e = ListTasksInput.model_validate(raw)
                listed = await search_service.list_tasks(session, project_id, status=e.status)
                return listed.model_dump_json(by_alias=True), False
            case "find_similar_tasks":
                f = FindSimilarTasksInput.model_validate(raw)
                pairs = await search_service.similar_tasks(
                    session, project_id, task_id=f.task_id, limit=f.limit
                )
                return _dump_list(pairs), False
            case "get_decision_risks":
                g = GetDecisionRisksInput.model_validate(raw)
                # 오늘은 프롬프트의 오늘과 같은 기준(한국 시간)이다
                report = await risk_service.decision_risks_for(
                    session, project_id, today=today_kst(), member_id=g.member_id, part=g.part_id
                )
                return report.model_dump_json(by_alias=True), False
            case "list_members":
                # 담당자 후보는 그 프로젝트의 활성 멤버뿐이다 (docs/api/auth.md)
                members = await project_service.list_members(session, assignable_in=project_id)
                # 다 활성이라 active 는 싣지 않는다 — 도구 설명대로 id · name 만
                return json.dumps(
                    [{"id": m.id, "name": m.name} for m in members], ensure_ascii=False
                ), False
            case _:
                return _tool_error(f"없는 도구다: {name}"), True
    except ApiError as exc:
        # 다른 프로젝트의 id 도 여기로 온다 — 있는지조차 알려 주지 않고 '못 찾았다' 로 넘긴다
        return _tool_error(exc.message), True
    except ValidationError as exc:
        return _tool_error(f"입력이 올바르지 않다: {exc.errors(include_url=False)}"), True
    finally:
        # 읽기만 한다. 검색이 트랜잭션에 박은 설정과 열린 트랜잭션을
        # 다음 Claude 호출 동안 붙잡지 않는다
        await session.rollback()


async def check_proposal(
    session: AsyncSession, project_id: str, raw: object
) -> tuple[str, bool, TaskProposal | None]:
    """propose_tasks. DB 에 쓰지 않는다 — 일괄 등록과 같은 검사로 보고, 맞으면 초안을 돌려준다."""
    try:
        proposal = TaskProposal.model_validate(raw)
        problems = task_service.proposal_problems(proposal.tasks)
        if not problems:
            problems = await task_service.missing_owners(session, project_id, proposal.tasks)
        if not problems:
            problems = await task_service.missing_parents(session, project_id, proposal.tasks)
        if problems:
            return (
                json.dumps(
                    {"error": "초안이 올바르지 않다. 고쳐서 다시 불러라.", "problems": problems},
                    ensure_ascii=False,
                ),
                True,
                None,
            )
        return json.dumps({"ok": True, "message": PROPOSED}, ensure_ascii=False), False, proposal
    except ValidationError as exc:
        return _tool_error(f"입력이 올바르지 않다: {exc.errors(include_url=False)}"), True, None
    finally:
        await session.rollback()


def _dump_list(items: Sequence[Any]) -> str:
    return "[" + ",".join(item.model_dump_json(by_alias=True) for item in items) + "]"


def _tool_error(message: str) -> str:
    return json.dumps({"error": message}, ensure_ascii=False)


_PROPOSAL_STATUS = {
    "pending": "대기 — 사용자가 아직 등록하지 않았다",
    "registered": "등록됨 — 사용자가 [등록] 을 눌러 저장했다",
    "cancelled": "취소 — 저장되지 않았다",
}


def proposal_note(proposal: ChatProposal) -> str:
    """지난 초안을 Claude 가 읽을 글로. 서버가 대화를 저장하지 않아 화면이 돌려보낸 것이다."""
    keys = proposal.key_by_temp_id or {}
    lines = [f"[작업 초안 · {_PROPOSAL_STATUS[proposal.status]}]"]
    for item in proposal.tasks:
        fields = {
            "temp_id": item.temp_id,
            "parent_temp_id": item.parent_temp_id,
            "parent_id": item.parent_id,
            "title": item.title,
            "owner_id": item.owner_id,
            "start": item.start.isoformat() if item.start else None,
            "due": item.due.isoformat() if item.due else None,
            "priority": item.priority,
        }
        if proposal.status == "registered" and item.temp_id in keys:
            fields["key"] = keys[item.temp_id]
        lines.append("- " + json.dumps(fields, ensure_ascii=False))
    return "\n".join(lines)


def mentioned_keys(text: str) -> list[str]:
    """질문에 '@HW-4' 로 나온 작업 키 — 대문자로, 처음 나온 순서대로 한 번씩."""
    return list(dict.fromkeys(key.upper() for key in MENTION_PATTERN.findall(text)))


async def find_mentions(
    session: AsyncSession, project_id: str, messages: Sequence[ChatMessage]
) -> dict[str, dict[str, str]]:
    """질문들이 가리킨 작업을 이 프로젝트 안에서만 찾는다. 다른 프로젝트의 키는 없는 것과 같다.

    값을 바로 떠 둔다 — 아래 rollback 이 ORM 객체를 만료시킨다.
    """
    keys = [key for m in messages if m.role == "user" for key in mentioned_keys(m.text)]
    try:
        found = await search_service.tasks_by_key(session, project_id, keys)
        return {
            key: {"id": task.id, "key": task.key, "title": task.title, "status": task.status}
            for key, task in found.items()
        }
    finally:
        # 도구처럼 읽기만 한다 — 열린 트랜잭션을 Claude 를 부르는 동안 붙잡지 않는다
        await session.rollback()


def mention_note(keys: Sequence[str], found: dict[str, dict[str, str]]) -> str:
    """질문이 가리킨 작업을 Claude 가 읽을 글로. id 를 실어 검색 없이 get_task 로 읽게 한다."""
    lines = ["[@ 로 가리킨 작업]"]
    for key in keys:
        task = found.get(key)
        if task is None:
            lines.append(f"- @{key}: 이 프로젝트에 없다")
        else:
            lines.append(f"- @{key}: " + json.dumps(task, ensure_ascii=False))
    return "\n".join(lines)


def _content(message: ChatMessage, mentions: dict[str, dict[str, str]]) -> str:
    if message.proposal is not None:
        return f"{message.text}\n\n{proposal_note(message.proposal)}"
    keys = mentioned_keys(message.text) if message.role == "user" else []
    if not keys:
        return message.text
    return f"{message.text}\n\n{mention_note(keys, mentions)}"


def _to_params(
    messages: Sequence[ChatMessage], mentions: dict[str, dict[str, str]] | None = None
) -> list[BetaMessageParam]:
    found = mentions or {}
    params: list[BetaMessageParam] = [
        {"role": m.role, "content": _content(m, found)} for m in messages
    ]
    # 대화는 질문으로 시작해야 한다 — 화면이 앞을 잘라도 assistant 가 먼저 오면 떼어 낸다
    while params and params[0]["role"] != "user":
        params.pop(0)
    return params


def _api_error_event(exc: AnthropicError) -> ErrorEvent:
    if isinstance(exc, RateLimitError):
        return ErrorEvent(
            code="CHAT_RATE_LIMITED",
            message="지금 질문이 많아 답하지 못했습니다. 잠시 뒤에 다시 물어 주세요.",
        )
    if isinstance(exc, APIStatusError):
        # 키 · 요청 내용은 싣지 않는다. 상태만 로그에 남긴다
        log.warning("Claude API 오류 status=%s request_id=%s", exc.status_code, exc.request_id)
    elif isinstance(exc, APIConnectionError):
        log.warning("Claude API 에 닿지 않음: %s", type(exc).__name__)
    else:
        log.warning("Claude SDK 오류: %s", type(exc).__name__)
    return ErrorEvent(
        code="CHAT_UNAVAILABLE",
        message="AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 물어 주세요.",
    )


async def answer(
    client: AsyncAnthropic,
    session: AsyncSession,
    settings: Settings,
    project_id: str,
    project_name: str,
    messages: Sequence[ChatMessage],
) -> AsyncIterator[ChatEvent]:
    """도구 루프. 글자 조각은 바로 delta 로, 도구를 부를 때마다 tool 로 흘린다.

    스트림이 열린 뒤의 실패는 여기서 error 이벤트로 접는다 — 이게 오면 done 은 안 온다.
    """
    written: list[str] = []
    # 한 답에 초안은 많아야 하나 — 여러 번 내면 마지막 것만 done 바로 앞에 낸다
    proposal: ProposalEvent | None = None
    try:
        # 일찍 끝나도 안쪽 루프(열린 스트림)를 바로 닫는다
        async with aclosing(
            _loop(client, session, settings, project_id, project_name, messages)
        ) as events:
            async for event in events:
                if isinstance(event, ProposalEvent):
                    proposal = event
                    continue
                yield event
                if isinstance(event, ErrorEvent):
                    return
                if isinstance(event, DeltaEvent):
                    written.append(event.text)
    except AnthropicError as exc:
        yield _api_error_event(exc)
        return
    except Exception:
        log.exception("채팅 처리 중 오류")
        yield ErrorEvent(code="INTERNAL_ERROR", message="서버에서 오류가 발생했습니다.")
        return
    if proposal is not None:
        yield proposal
    yield DoneEvent(refs=extract_refs("".join(written)))


async def _loop(
    client: AsyncAnthropic,
    session: AsyncSession,
    settings: Settings,
    project_id: str,
    project_name: str,
    messages: Sequence[ChatMessage],
) -> AsyncGenerator[ChatEvent, None]:
    history = _to_params(messages, await find_mentions(session, project_id, messages))
    today = today_kst()
    system = SYSTEM_PROMPT.format(
        project_name=project_name, today=f"{today.isoformat()} ({WEEKDAYS[today.weekday()]})"
    )
    wrote = False

    for round_no in range(1, MAX_ROUNDS + 1):
        final: BetaMessage
        started = False
        async with client.beta.messages.stream(
            model=settings.chat_model,
            max_tokens=settings.chat_max_tokens,
            system=system,
            messages=history,
            tools=TOOLS,
            # Sonnet 5.5 는 강제 호출(any · tool)이 400 이다 — 프롬프트로 도구를 쓰게 한다
            tool_choice={"type": "auto"},
            # thinking 은 넘기지 않는다 — Sonnet 5.5 는 끌 수 없다(disabled 는 400)
            output_config={"effort": settings.chat_effort},
            fallbacks="default",
            betas=[FALLBACK_BETA],
        ) as stream:
            async for chunk in stream:
                if chunk.type != "text" or not chunk.text:
                    continue
                if not started and wrote:
                    # 앞 차례에 쓴 글과 붙지 않게 한 줄 띄운다
                    yield DeltaEvent(text="\n\n")
                started = True
                yield DeltaEvent(text=chunk.text)
            final = await stream.get_final_message()
        wrote = wrote or started

        match final.stop_reason:
            case "refusal":
                yield ErrorEvent(
                    code="CHAT_REFUSED",
                    message="이 질문에는 답할 수 없습니다. 질문을 바꿔 다시 물어 주세요.",
                )
                return
            case "max_tokens" | "model_context_window_exceeded":
                yield DeltaEvent(text=TRUNCATED)
                return
            case "pause_turn":
                # 서버 쪽에서 멈춘 차례 — 그대로 이어 붙여 다시 부른다
                history.append(final.to_param())
                continue
            case "tool_use":
                pass
            case _:
                return

        calls = [block for block in final.content if isinstance(block, BetaToolUseBlock)]
        if not calls:
            return
        if round_no == MAX_ROUNDS:
            # 상한에서도 도구를 부르면 더 돌지 않는다. 이번 차례에 쓴 글이 없으면 그렇다고 알린다
            if not started:
                yield DeltaEvent(text=("\n\n" if wrote else "") + GAVE_UP)
            return

        history.append(final.to_param())
        results: list[BetaToolResultBlockParam | BetaTextBlockParam] = []
        for call in calls:
            if call.name in _TOOL_NAMES:
                name = cast(ToolName, call.name)
                yield ToolEvent(name=name, label=tool_label(name, call.input))
            if call.name == "propose_tasks":
                content, is_error, proposal = await check_proposal(session, project_id, call.input)
                if proposal is not None:
                    yield ProposalEvent(proposal=proposal)
            else:
                content, is_error = await run_tool(session, project_id, call.name, call.input)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": content,
                    "is_error": is_error,
                }
            )
        if round_no == MAX_ROUNDS - 1:
            # 다음이 마지막 차례다 — 찾은 것으로 마무리하게 한다
            results.append({"type": "text", "text": WRAP_UP})
        history.append({"role": "user", "content": results})

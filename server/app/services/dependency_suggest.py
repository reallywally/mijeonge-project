"""[AI 선행 관계 찾기] — 계약은 `docs/api/task-flow.md` 'AI 제안'.

리스크 AI 요약과 같은 틀이다 — 읽을 것을 미리 모아 도구 없이 한 번 부른다. 저장하지 않는다.
Claude 는 작업을 키(HW-4)로만 본다. 답의 키를 id 로 되돌리고, 사람이 거는 것과 같은 검사
(`services/dependency.py` 의 `check`)를 돌려 걸리는 것 · 이미 있는 것 · 겹치는 것은 조용히 버린다.
"""

import json
import logging
import re
from typing import Any

from anthropic import AnthropicError, AsyncAnthropic
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import ApiError
from app.models import Task, TaskDependency, TaskThreadLink, Thread
from app.schemas.task import DependencySuggestionOut, DependencySuggestionsOut
from app.services import dependency as dependency_service
from app.services.chat import _api_error_event
from app.services.risk_summary import one_shot

log = logging.getLogger(__name__)

# 넣는 작업 수 — 기한 이른 순 → 등록 순으로 앞에서 자른다
TASK_LIMIT = 200
# 내보내는 제안 수
SUGGESTION_MAX = 20
# 작업 본문은 앞 몇 줄만, 한 줄도 줄여서 — 200개를 넣어도 요청이 커지지 않게
BODY_LINES = 3
LINE_CHARS = 120

SYSTEM_PROMPT = """\
너는 사내 업무 도구 innoFlow 의 도우미다. 지금 프로젝트는 '{project_name}' 이다.
사용자가 작업 화면에서 [AI 선행 관계 찾기] 를 눌렀다. 아직 안 끝난 작업들 사이에서
'A 를 하려면 B 가 먼저 끝나야 한다' 인데 아직 걸려 있지 않은 관계를 찾는다.
사람이 하나씩 보고 [적용] 하거나 버린다.

## 받는 것
사용자 메시지의 JSON 하나다.
- tasks: 아직 안 끝난 작업. key(HW-4) · title · parent(상위 작업의 key) · status · start · due ·
  body(본문 앞 몇 줄) · threads(걸린 안건 제목)
- existing: 이미 걸린 선행 관계. task 가 dependsOn 을 기다린다

## 답의 모양
JSON 하나만 쓴다. 앞뒤에 설명 · 마크다운 · 코드 블록 표시를 붙이지 않는다.
{{"suggestions": [{{"task": "HW-21", "dependsOn": "HW-20", "reason": "DB 가 떠야 계정을 만든다"}}]}}

- task 는 뒤 작업, dependsOn 은 먼저 끝나야 하는 작업이다. 둘 다 받은 tasks 의 key 그대로 쓴다
- reason 은 왜 그런지 한국어 한 문장이다. 제목 · 본문 · 기간에서 근거를 댄다
- 찾을 것이 없으면 {{"suggestions": []}} 이다

## 규칙
1. 근거가 약하면 내지 않는다. 제목 · 본문 · 기간에서 이유를 한 문장으로 댈 수 있는 것만 낸다.
   기간이 앞뒤라는 것만으로는 선후가 아니다
2. 상위 · 하위 작업 사이는 선후가 아니다 — 하위는 상위의 일부다. 내지 않는다
3. existing 에 있는 관계 · 그 반대 방향 · 순환이 되는 관계는 내지 않는다
4. 가장 확실한 것부터 최대 {limit}개
"""


class _Item(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    task: str
    depends_on: str = Field(alias="dependsOn")
    reason: str


class _Answer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    suggestions: list[_Item]


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


def failed() -> ApiError:
    return ApiError(
        502,
        "DEPENDENCY_SUGGEST_FAILED",
        "AI 가 선행 관계를 알아볼 수 없는 모양으로 답했습니다. 다시 눌러 주세요.",
    )


async def build_context(session: AsyncSession, project_id: str) -> tuple[dict[str, Any], bool]:
    """(Claude 에 넣을 JSON, 잘랐나). 읽고 나면 트랜잭션을 놓는다 — 답을 기다리는 동안 안 붙잡게."""
    try:
        open_tasks = Task.project_id == project_id, Task.status != "done"
        total = await session.scalar(select(func.count()).select_from(Task).where(*open_tasks))
        tasks = (
            await session.scalars(
                select(Task)
                .where(*open_tasks)
                .order_by(Task.due.asc().nulls_last(), Task.seq)
                .limit(TASK_LIMIT)
            )
        ).all()
        ids = [task.id for task in tasks]
        keys = dict(
            (await session.execute(select(Task.id, Task.key).where(Task.project_id == project_id)))
            .tuples()
            .all()
        )
        titles: dict[str, list[str]] = {}
        linked = await session.execute(
            select(TaskThreadLink.task_id, Thread.title)
            .join(Thread, Thread.id == TaskThreadLink.thread_id)
            .where(TaskThreadLink.project_id == project_id, TaskThreadLink.task_id.in_(ids))
            .order_by(Thread.seq)
        )
        for task_id, title in linked.tuples():
            titles.setdefault(task_id, []).append(title)
        listed = set(ids)
        edges = await session.execute(
            select(TaskDependency.task_id, TaskDependency.depends_on_id)
            .where(TaskDependency.project_id == project_id)
            .order_by(TaskDependency.task_id, TaskDependency.depends_on_id)
        )
        payload: dict[str, Any] = {
            "tasks": [
                {
                    "key": task.key,
                    "title": task.title,
                    "parent": keys.get(task.parent_id) if task.parent_id else None,
                    "status": task.status,
                    "start": task.start.isoformat() if task.start else None,
                    "due": task.due.isoformat() if task.due else None,
                    "body": [line.text[:LINE_CHARS] for line in task.lines[:BODY_LINES]],
                    "threads": titles.get(task.id, []),
                }
                for task in tasks
            ],
            # 넣은 작업끼리의 것만 — 나머지는 Claude 가 키를 몰라 쓸 일이 없다
            "existing": [
                {"task": keys[task_id], "dependsOn": keys[depends_on_id]}
                for task_id, depends_on_id in edges.tuples()
                if task_id in listed and depends_on_id in listed
            ],
        }
        return payload, (total or 0) > TASK_LIMIT
    finally:
        await session.rollback()


def system_prompt(project_name: str) -> str:
    return SYSTEM_PROMPT.format(project_name=project_name, limit=SUGGESTION_MAX)


def user_message(payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    return f"아직 안 끝난 작업들이다. 빠진 선행 관계를 답의 모양대로 내라.\n\n{data}"


def parse(text: str) -> list[_Item]:
    """답 글 → 제안 줄. 모양이 틀리면 502 다 — 반쯤 맞는 답을 고쳐 쓰지 않는다."""
    raw = _FENCE.sub("", text.strip())
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < start:
        raise failed()
    try:
        return _Answer.model_validate(json.loads(raw[start : end + 1])).suggestions
    except (ValueError, ValidationError) as exc:
        raise failed() from exc


async def ask(
    client: AsyncAnthropic, settings: Settings, project_name: str, payload: dict[str, Any]
) -> str:
    """한 번 부르고 답 글을 돌려준다. SDK 오류는 챗봇과 같은 코드(429 · 503)로 바꾼다."""
    try:
        async with client.beta.messages.stream(
            **one_shot(settings, system_prompt(project_name), user_message(payload))
        ) as stream:
            final = await stream.get_final_message()
    except AnthropicError as exc:
        event = _api_error_event(exc)
        status = 429 if event.code == "CHAT_RATE_LIMITED" else 503
        raise ApiError(status, event.code, event.message) from exc
    if final.stop_reason == "refusal":
        raise failed()
    return "".join(block.text for block in final.content if block.type == "text")


async def suggest(
    session: AsyncSession,
    client: AsyncAnthropic,
    settings: Settings,
    project_id: str,
    project_name: str,
) -> DependencySuggestionsOut:
    payload, truncated = await build_context(session, project_id)
    # 둘이 안 되면 관계가 설 수 없다 — Claude 를 부르지 않는다
    if len(payload["tasks"]) < 2:
        return DependencySuggestionsOut(suggestions=[], truncated=truncated)

    items = parse(await ask(client, settings, project_name, payload))

    sent_keys = [row["key"] for row in payload["tasks"]]
    found = await session.execute(
        select(Task.key, Task.id).where(Task.project_id == project_id, Task.key.in_(sent_keys))
    )
    listed = dict(found.tuples().all())
    graph = await dependency_service.load_graph(session, project_id)
    await session.rollback()

    kept: list[DependencySuggestionOut] = []
    for item in items:
        task_id, depends_on_id = listed.get(item.task), listed.get(item.depends_on)
        reason = item.reason.strip()
        # 넣지 않은 키(완료 · 다른 프로젝트 · 지어낸 것) · 이유 없는 것은 버린다
        if task_id is None or depends_on_id is None or not reason:
            continue
        # 이미 있는 것 · 앞의 제안과 겹치는 것
        if graph.has(task_id, depends_on_id):
            continue
        try:
            dependency_service.check(graph, task_id, depends_on_id)
        except ApiError:
            continue
        # 받아들인 제안을 얹어 둔다 — [모두 적용] 이 뒤 줄에서 순환 · 개수에 걸리지 않게
        graph.add(task_id, depends_on_id)
        kept.append(
            DependencySuggestionOut(task_id=task_id, depends_on_id=depends_on_id, reason=reason)
        )
        if len(kept) == SUGGESTION_MAX:
            break
    return DependencySuggestionsOut(suggestions=kept, truncated=truncated)

"""채팅 — `POST /api/projects/{projectId}/chat`.

**Claude 를 부르지 않는다.** `get_chat_client` 를 가짜 클라이언트로 바꿔 끼운다 — 가짜는
`client.beta.messages.stream(...)` 의 모양만 흉내 내고, 정해 둔 차례
(글자 조각 · 도구 호출 · stop_reason)를 차례대로 내준다. 마지막 메시지는 SDK 의 진짜
`BetaMessage` 라 `to_param()` 까지 실제 코드가 돈다.
"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError
from anthropic.types.beta import BetaMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.config import Settings, settings
from app.main import app
from app.services import chat as chat_service
from app.time import today_kst
from scripts.seed import seed
from tests.test_contract_types import FIELDS

URL = "/api/projects/p1/chat"
ASK = {"messages": [{"role": "user", "text": "서버 OS 뭐로 하기로 했지?"}]}


# --- 가짜 클라이언트 ---------------------------------------------------------


@dataclass
class Turn:
    """Claude 한 차례. texts 는 흘릴 글자 조각, tools 는 (도구 이름, 입력) 목록."""

    texts: list[str] = field(default_factory=list)
    tools: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    stop_reason: str | None = None
    raises: Exception | None = None

    def message(self, number: int) -> BetaMessage:
        content: list[dict[str, Any]] = [{"type": "text", "text": "".join(self.texts)}]
        content = content if self.texts else []
        content += [
            {"type": "tool_use", "id": f"tu{number}_{i}", "name": name, "input": args}
            for i, (name, args) in enumerate(self.tools)
        ]
        stop = self.stop_reason or ("tool_use" if self.tools else "end_turn")
        return BetaMessage.model_validate(
            {
                "id": f"msg{number}",
                "type": "message",
                "role": "assistant",
                "model": "fake",
                "content": content,
                "stop_reason": stop,
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        )


class FakeStream:
    def __init__(self, turn: Turn, number: int) -> None:
        self.turn = turn
        self.number = number

    async def __aenter__(self) -> "FakeStream":
        if self.turn.raises is not None:
            raise self.turn.raises
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    def __aiter__(self) -> AsyncIterator[Any]:
        return self._events()

    async def _events(self) -> AsyncIterator[Any]:
        # 진짜 스트림에는 content_block_* 같은 것도 섞인다 — 서비스는 text 만 골라야 한다
        yield SimpleNamespace(type="message_start")
        for text in self.turn.texts:
            yield SimpleNamespace(type="content_block_delta")
            yield SimpleNamespace(type="text", text=text, snapshot="")
        yield SimpleNamespace(type="message_stop")

    async def get_final_message(self) -> BetaMessage:
        return self.turn.message(self.number)


class FakeClient:
    """차례를 다 쓰면 마지막 차례를 되풀이한다 — 루프 상한 검사에 쓴다."""

    def __init__(self, *turns: Turn) -> None:
        self.turns = list(turns)
        self.calls: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs: Any) -> FakeStream:
        # 서비스가 history 를 이어 붙이므로 그때의 모양을 떠 둔다
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        number = len(self.calls)
        return FakeStream(self.turns[min(number, len(self.turns)) - 1], number)


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


def use(client: FakeClient | None) -> None:
    # 덮어쓴 의존성은 conftest 의 client 픽스처가 끝날 때 비운다
    app.dependency_overrides[chat_api.get_chat_client] = lambda: client


def parse_sse(raw: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in raw.split("\n\n"):
        if not block.strip():
            continue
        lines = block.split("\n")
        assert len(lines) == 2, block
        assert lines[0].startswith("event: ") and lines[1].startswith("data: "), block
        events.append((lines[0][len("event: ") :], json.loads(lines[1][len("data: ") :])))
    return events


async def run(session: AsyncSession, fake: FakeClient, project_id: str = "p1") -> list[Any]:
    return [
        event
        async for event in chat_service.answer(
            fake,  # type: ignore[arg-type]
            session,
            settings,
            project_id,
            "한화손보 차세대",
            [chat_service.ChatMessage(role="user", text="서버 OS 뭐로 하기로 했지?")],
        )
    ]


def tool_results(call: dict[str, Any]) -> list[dict[str, Any]]:
    last = call["messages"][-1]
    assert last["role"] == "user"
    return [block for block in last["content"] if block["type"] == "tool_result"]


# --- ① 도구를 부르고 → 답한다 ------------------------------------------------


async def test_tool_then_answer(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(
        Turn(tools=[("get_thread", {"thread_id": "t1"})]),
        Turn(texts=["서버 OS 는 ", "우분투로 정했습니다 [[thread:t1]]"]),
    )
    events = await run(session, fake)

    assert [e.type for e in events] == ["tool", "delta", "delta", "done"]
    assert events[0].name == "get_thread"
    assert events[-1].refs[0].model_dump() == {"kind": "thread", "id": "t1"}

    # 도구 결과가 다음 차례에 JSON 문자열로 실려 간다 — id · 이력 kind 를 그대로
    assert len(fake.calls) == 2
    second = fake.calls[1]["messages"]
    assert second[-2]["role"] == "assistant"
    (result,) = tool_results(fake.calls[1])
    assert result["tool_use_id"] == "tu1_0"
    assert result["is_error"] is False
    doc = json.loads(result["content"])
    assert doc["thread"]["id"] == "t1"
    assert doc["thread"]["title"] == "서버 OS 결정"
    assert [entry["kind"] for entry in doc["entries"]] == ["decide"]


async def test_request_follows_the_settings(session: AsyncSession) -> None:
    """모델 · effort 는 설정에서 · 거절 대체 모델은 베타로 · 강제 도구 호출 · thinking 끄기 없음."""
    await seed(session)
    fake = FakeClient(Turn(texts=["답"]))
    await run(session, fake)

    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.chat_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["tool_choice"] == {"type": "auto"}
    assert "thinking" not in call
    assert {tool["name"] for tool in call["tools"]} == {
        "search_threads",
        "get_thread",
        "search_tasks",
        "get_task",
        "list_members",
        "propose_tasks",
    }
    assert "한화손보 차세대" in call["system"]
    assert call["messages"] == [{"role": "user", "content": "서버 OS 뭐로 하기로 했지?"}]


def test_settings_default_to_sonnet_low() -> None:
    fresh = Settings(_env_file=None)  # type: ignore[call-arg]
    assert fresh.chat_model == "claude-sonnet-5-5"
    assert fresh.chat_effort == "low"


async def test_text_between_rounds_is_kept_apart(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(
        Turn(texts=["찾아볼게요."], tools=[("get_task", {"task_id": "k4"})]),
        Turn(texts=["개발 환경 설정 [[task:k4]] 입니다."]),
    )
    events = await run(session, fake)
    text = "".join(e.text for e in events if e.type == "delta")
    assert text == "찾아볼게요.\n\n개발 환경 설정 [[task:k4]] 입니다."
    assert [e.type for e in events].count("tool") == 1


def test_refs_are_unique_and_in_order() -> None:
    refs = chat_service.extract_refs(
        "[[task:k4]] 와 [[thread:t1]], 다시 [[task:k4]]. [[thread:]] [[meeting:m1]] [[thread:t2"
    )
    assert [(r.kind, r.id) for r in refs] == [("task", "k4"), ("thread", "t1")]


# --- ② SSE 이벤트 순서 · 모양 ------------------------------------------------


async def test_sse_events_order_and_shape(client: httpx.AsyncClient) -> None:
    use(
        FakeClient(
            Turn(tools=[("get_thread", {"thread_id": "t1"})]),
            Turn(texts=["우분투로 ", "정했습니다 [[thread:t1]]"]),
        )
    )
    res = await client.post(URL, json=ASK)

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(res.text)
    assert [name for name, _ in events] == ["tool", "delta", "delta", "done"]
    # event 줄과 data 의 type 이 같다
    assert all(data["type"] == name for name, data in events)
    assert events[0][1] == {"type": "tool", "name": "get_thread", "label": "안건 이력 읽는 중"}
    assert events[1][1] == {"type": "delta", "text": "우분투로 "}
    assert events[3][1] == {"type": "done", "refs": [{"kind": "thread", "id": "t1"}]}


async def test_search_tool_label_carries_the_query(client: httpx.AsyncClient) -> None:
    # sqlite 에는 pg_trgm 이 없어 검색 자체는 실패한다 — 라벨은 도구를 부르기 전에 나간다
    label = chat_service.tool_label("search_threads", {"query": " OS "})
    assert label == '"OS" 안건 찾는 중'
    assert chat_service.tool_label("search_tasks", {}) == "작업 찾는 중"


async def test_refusal_is_an_error_event_without_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    events = parse_sse((await client.post(URL, json=ASK)).text)
    assert [name for name, _ in events] == ["delta", "error"]
    assert events[-1][1]["code"] == "CHAT_REFUSED"
    assert set(events[-1][1]) == {"type", "code", "message"}


async def test_claude_rate_limit_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=error)))
    res = await client.post(URL, json=ASK)
    # 스트림이 열린 뒤라 상태는 200 이고 code 로 가른다
    assert res.status_code == 200
    assert parse_sse(res.text) == [
        (
            "error",
            {
                "type": "error",
                "code": "CHAT_RATE_LIMITED",
                "message": "지금 질문이 많아 답하지 못했습니다. 잠시 뒤에 다시 물어 주세요.",
            },
        )
    ]


async def test_claude_unreachable_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    use(FakeClient(Turn(raises=APIConnectionError(request=request))))
    events = parse_sse((await client.post(URL, json=ASK)).text)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_UNAVAILABLE")]


async def test_max_tokens_ends_with_a_note_and_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["길게 "], stop_reason="max_tokens")))
    events = parse_sse((await client.post(URL, json=ASK)).text)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[1][1]["text"] == chat_service.TRUNCATED


# --- ③ 루프 상한 -------------------------------------------------------------


async def test_loop_stops_at_six_rounds(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(Turn(tools=[("get_task", {"task_id": "k4"})]))
    events = await run(session, fake)

    assert len(fake.calls) == chat_service.MAX_ROUNDS == 6
    # 마지막 차례의 도구 호출은 돌리지 않는다
    assert [e.type for e in events].count("tool") == 5
    assert events[-2].type == "delta" and events[-2].text == chat_service.GAVE_UP
    assert events[-1].type == "done"

    # 마지막 차례 직전에 '찾은 것으로 마무리하라' 가 실려 간다. 그 전에는 없다
    last_user = fake.calls[-1]["messages"][-1]["content"]
    assert last_user[-1] == {"type": "text", "text": chat_service.WRAP_UP}
    before = fake.calls[-2]["messages"][-1]["content"]
    assert all(block["type"] == "tool_result" for block in before)


async def test_loop_wraps_up_when_claude_answers_at_the_limit(session: AsyncSession) -> None:
    await seed(session)
    turns = [Turn(tools=[("get_task", {"task_id": "k4"})]) for _ in range(5)]
    fake = FakeClient(*turns, Turn(texts=["찾은 것으로는 [[task:k4]] 입니다."]))
    events = await run(session, fake)
    assert len(fake.calls) == 6
    assert events[-1].type == "done"
    assert [(r.kind, r.id) for r in events[-1].refs] == [("task", "k4")]
    assert chat_service.GAVE_UP not in "".join(e.text for e in events if e.type == "delta")


# --- ④ 키 없음 · 스트림 전 실패는 JSON ---------------------------------------


async def test_no_key_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(URL, json=ASK)
    assert res.status_code == 503
    assert res.headers["content-type"].startswith("application/json")
    assert res.json()["code"] == "CHAT_UNAVAILABLE"
    # 앱의 나머지는 그대로 돈다
    assert (await client.get("/api/projects")).status_code == 200


@pytest.mark.parametrize("key", [None, "", "   "])
def test_no_key_builds_no_client(key: str | None) -> None:
    fresh = Settings(_env_file=None, anthropic_api_key=key)  # type: ignore[call-arg]
    assert chat_service.make_client(fresh) is None


def test_key_does_not_leak_into_repr() -> None:
    fresh = Settings(_env_file=None, anthropic_api_key="sk-ant-비밀")  # type: ignore[call-arg]
    assert "sk-ant-비밀" not in repr(fresh)
    assert chat_service.make_client(fresh) is not None


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["답"])))
    res = await client.post("/api/projects/없는프로젝트/chat", json=ASK)
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize(
    ("messages", "field"),
    [
        ([], "messages"),
        ([{"role": "user", "text": "질문"}] * 21, "messages"),
        ([{"role": "user", "text": "가" * 2001}], "text"),
        (
            [
                {"role": "user", "text": "질문"},
                {"role": "assistant", "text": "가" * 20001},
                {"role": "user", "text": "질문"},
            ],
            "text",
        ),
        ([{"role": "user", "text": "   "}], "text"),
        ([{"role": "user", "text": "질문"}, {"role": "assistant", "text": "답"}], "messages"),
        ([{"role": "system", "text": "질문"}], "role"),
    ],
)
async def test_bad_input_is_422(
    client: httpx.AsyncClient, messages: list[dict[str, str]], field: str
) -> None:
    fake = FakeClient(Turn(texts=["답"]))
    use(fake)
    res = await client.post(URL, json={"messages": messages})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert field in body["detail"]
    assert fake.calls == []


async def test_limits_are_inclusive(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["답"]))
    use(fake)
    messages = [{"role": "user", "text": "가" * 2000}] * 20
    res = await client.post(URL, json={"messages": messages})
    assert res.status_code == 200
    assert len(fake.calls[0]["messages"]) == 20


async def test_long_answer_does_not_block_next_question(client: httpx.AsyncClient) -> None:
    """답은 질문 상한(2,000자)을 넘을 수 있다 — 그대로 돌려보내도 다음 질문이 막히지 않는다."""
    fake = FakeClient(Turn(texts=["답"]))
    use(fake)
    messages = [
        {"role": "user", "text": "질문"},
        {"role": "assistant", "text": "가" * 20000},
        {"role": "user", "text": "다음 질문"},
    ]
    res = await client.post(URL, json={"messages": messages})
    assert res.status_code == 200


async def test_leading_assistant_is_dropped(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(Turn(texts=["답"]))
    messages = [
        chat_service.ChatMessage(role="assistant", text="앞에서 잘린 답"),
        chat_service.ChatMessage(role="user", text="질문"),
    ]
    async for _ in chat_service.answer(fake, session, settings, "p1", "p1", messages):  # type: ignore[arg-type]
        pass
    assert fake.calls[0]["messages"] == [{"role": "user", "content": "질문"}]


async def test_rate_limit_per_ip_is_429(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["답"])))
    limiter = chat_service.RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter

    assert (await client.post(URL, json=ASK)).status_code == 200
    res = await client.post(URL, json=ASK)
    assert res.status_code == 429
    assert res.json()["code"] == "CHAT_RATE_LIMITED"


def test_rate_limiter_window_slides() -> None:
    limiter = chat_service.RateLimiter(2)
    assert limiter.allow("a", now=0) and limiter.allow("a", now=1)
    assert not limiter.allow("a", now=59)
    assert limiter.allow("b", now=59)
    assert limiter.allow("a", now=60)


# --- ⑤ 다른 프로젝트 id 를 도구에 넣어도 못 읽는다 ---------------------------


async def test_tools_cannot_read_other_projects(session: AsyncSession) -> None:
    """t10 · x1 은 p2 의 것이다. p1 에서 묻는 대화의 도구로는 있는지조차 못 본다."""
    await seed(session)
    fake = FakeClient(
        Turn(tools=[("get_thread", {"thread_id": "t10"}), ("get_task", {"task_id": "x1"})]),
        Turn(texts=["못 찾았습니다."]),
    )
    events = await run(session, fake, project_id="p1")

    results = tool_results(fake.calls[1])
    assert [r["is_error"] for r in results] == [True, True]
    assert json.loads(results[0]["content"]) == {"error": "안건을 찾을 수 없습니다."}
    assert json.loads(results[1]["content"]) == {"error": "작업을 찾을 수 없습니다."}
    leaked = json.dumps(results, ensure_ascii=False)
    assert "이관 범위 확정" not in leaked and "현행 분석" not in leaked
    assert events[-1].type == "done"


async def test_tool_input_cannot_override_the_project(session: AsyncSession) -> None:
    """도구 입력에 project_id 를 끼워 넣어도 경로의 프로젝트만 본다."""
    await seed(session)
    content, is_error = await chat_service.run_tool(
        session, "p1", "get_thread", {"thread_id": "t10", "project_id": "p2"}
    )
    assert is_error
    assert "이관" not in content


async def test_bad_tool_input_is_a_tool_error(session: AsyncSession) -> None:
    await seed(session)
    content, is_error = await chat_service.run_tool(session, "p1", "get_thread", {"id": "t1"})
    assert is_error and "입력이 올바르지 않다" in json.loads(content)["error"]
    content, is_error = await chat_service.run_tool(session, "p1", "drop_table", {})
    assert is_error and "없는 도구" in json.loads(content)["error"]


async def test_search_tools_stay_in_project(pg_session: AsyncSession) -> None:
    """Postgres 에서만 — '서버 OS' 는 p1 의 안건이다. p2 에서 찾으면 안 나온다."""
    content, is_error = await chat_service.run_tool(
        pg_session, "p1", "search_threads", {"query": "서버 OS"}
    )
    assert not is_error
    assert "t1" in [hit["id"] for hit in json.loads(content)]

    content, is_error = await chat_service.run_tool(
        pg_session, "p2", "search_threads", {"query": "서버 OS"}
    )
    assert (content, is_error) == ("[]", False)

    content, is_error = await chat_service.run_tool(
        pg_session, "p2", "search_tasks", {"query": "개발 환경 설정"}
    )
    assert (content, is_error) == ("[]", False)


# --- ⑥ 작업 초안 — propose_tasks 는 저장하지 않고 proposal 로 낸다 -------------

DRAFT = {
    "tasks": [
        {"temp_id": "t1", "parent_temp_id": None, "title": "간담회 준비", "owner_id": None,
         "start": None, "due": None, "priority": "normal"},
        {"temp_id": "t2", "parent_temp_id": "t1", "title": "일정 체크", "owner_id": "u1",
         "start": None, "due": "2026-10-16", "priority": "normal"},
        {"temp_id": "t3", "parent_temp_id": "t1", "title": "준비물 체크", "owner_id": "u2",
         "start": None, "due": None, "priority": "normal"},
    ]
}  # fmt: skip
ASK_DRAFT = {
    "messages": [
        {
            "role": "user",
            "text": "간담회 준비 작업 만들어줘. 김서연한테 일정체크, 박지훈한테 준비물 체크",
        }
    ]
}


async def task_count(client: httpx.AsyncClient, project_id: str = "p3") -> int:
    snap = (await client.get(f"/api/projects/{project_id}/snapshot")).json()
    return len(snap["tasks"])


async def test_propose_tasks_emits_one_proposal_before_done(client: httpx.AsyncClient) -> None:
    fake = FakeClient(
        Turn(tools=[("list_members", {})]),
        Turn(tools=[("propose_tasks", DRAFT)]),
        Turn(texts=["아래처럼 등록할까요?"]),
    )
    use(fake)
    events = parse_sse((await client.post("/api/projects/p3/chat", json=ASK_DRAFT)).text)

    assert [name for name, _ in events] == ["tool", "tool", "delta", "proposal", "done"]
    assert events[0][1]["label"] == "멤버 확인 중"
    assert events[1][1] == {
        "type": "tool",
        "name": "propose_tasks",
        "label": "작업 초안 만드는 중",
    }
    proposal = events[3][1]["proposal"]
    # 화면 계약대로 camelCase · 날짜는 YYYY-MM-DD
    assert proposal["tasks"][1] == {
        "tempId": "t2",
        "parentTempId": "t1",
        "title": "일정 체크",
        "ownerId": "u1",
        "start": None,
        "due": "2026-10-16",
        "priority": "normal",
    }
    assert set(proposal["tasks"][0]) == set(FIELDS["ProposedTask"])

    # 멤버 목록이 도구 결과로 실려 간다
    (members,) = tool_results(fake.calls[1])
    assert {"id": "u1", "name": "김서연"} in json.loads(members["content"])
    (proposed,) = tool_results(fake.calls[2])
    assert proposed["is_error"] is False
    assert json.loads(proposed["content"])["ok"] is True
    # 저장하지 않는다
    assert await task_count(client) == 0


async def test_bad_draft_goes_back_as_tool_error(session: AsyncSession) -> None:
    await seed(session)
    bad = {
        "tasks": [
            DRAFT["tasks"][1],  # 상위 t1 이 앞에 없다
            DRAFT["tasks"][0] | {"title": "  "},
            DRAFT["tasks"][2] | {"owner_id": "없음"},
        ]
    }
    fake = FakeClient(
        Turn(tools=[("propose_tasks", bad)]),
        Turn(texts=["누구인지 알려 주세요."]),
    )
    events = await run(session, fake, project_id="p3")

    assert [e.type for e in events] == ["tool", "delta", "done"]
    (result,) = tool_results(fake.calls[1])
    assert result["is_error"] is True
    problems = json.loads(result["content"])["problems"]
    # 일괄 등록과 같은 검사 — 같은 자리 이름으로 짚는다
    assert set(problems) == {"tasks.0.parentTempId", "tasks.1.title"}


async def test_unknown_owner_goes_back_as_tool_error(session: AsyncSession) -> None:
    await seed(session)
    bad = {"tasks": [DRAFT["tasks"][0] | {"owner_id": "없음"}]}
    content, is_error, proposal = await chat_service.check_proposal(session, bad)
    assert is_error and proposal is None
    assert json.loads(content)["problems"] == {"tasks.0.ownerId": "담당자를 찾을 수 없습니다."}

    content, is_error, proposal = await chat_service.check_proposal(session, {"tasks": "x"})
    assert is_error and proposal is None and "입력이 올바르지 않다" in content


async def test_only_the_last_proposal_is_sent(session: AsyncSession) -> None:
    await seed(session)
    second = {"tasks": [DRAFT["tasks"][0] | {"title": "간담회 준비 (수정)"}]}
    fake = FakeClient(
        Turn(tools=[("propose_tasks", DRAFT)]),
        Turn(tools=[("propose_tasks", second)]),
        Turn(texts=["아래처럼 등록할까요?"]),
    )
    events = await run(session, fake, project_id="p3")

    assert [e.type for e in events] == ["tool", "tool", "delta", "proposal", "done"]
    (proposal,) = [e for e in events if e.type == "proposal"]
    assert [t.title for t in proposal.proposal.tasks] == ["간담회 준비 (수정)"]


async def test_no_proposal_after_an_error(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(
        Turn(tools=[("propose_tasks", DRAFT)]),
        Turn(texts=["그건"], stop_reason="refusal"),
    )
    events = await run(session, fake, project_id="p3")
    assert [e.type for e in events] == ["tool", "delta", "error"]


async def test_today_is_in_the_system_prompt(session: AsyncSession) -> None:
    await seed(session)
    fake = FakeClient(Turn(texts=["답"]))
    await run(session, fake)
    today = today_kst()
    weekday = "월화수목금토일"[today.weekday()]
    assert f"오늘은 {today.isoformat()} ({weekday})" in fake.calls[0]["system"]


async def test_past_proposal_is_written_after_the_answer(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["답"]))
    use(fake)
    tasks = [
        {"tempId": "t1", "parentTempId": None, "title": "간담회 준비", "ownerId": None,
         "start": None, "due": None, "priority": "normal"},
        {"tempId": "t2", "parentTempId": "t1", "title": "일정 체크", "ownerId": "u1",
         "start": None, "due": "2026-10-16", "priority": "normal"},
    ]  # fmt: skip
    messages = [
        {"role": "user", "text": "간담회 준비 작업 만들어줘"},
        {
            "role": "assistant",
            "text": "아래처럼 등록할까요?",
            "proposal": {
                "tasks": tasks,
                "status": "registered",
                "keyByTempId": {"t1": "MG-7", "t2": "MG-8"},
            },
        },
        {"role": "user", "text": "방금 만든 것에 하나 더"},
    ]
    res = await client.post("/api/projects/p3/chat", json={"messages": messages})
    assert res.status_code == 200

    sent = fake.calls[0]["messages"]
    assert [m["role"] for m in sent] == ["user", "assistant", "user"]
    note = sent[1]["content"]
    assert note.startswith("아래처럼 등록할까요?\n\n[작업 초안 · 등록됨")
    assert '"key": "MG-8"' in note and '"owner_id": "u1"' in note
    assert '"due": "2026-10-16"' in note


@pytest.mark.parametrize("status", ["pending", "cancelled"])
async def test_unregistered_proposal_has_no_keys(status: str) -> None:
    proposal = chat_service.ChatProposal.model_validate(
        {
            "tasks": [{"tempId": "t1", "title": "간담회 준비"}],
            "status": status,
            "keyByTempId": {"t1": "MG-7"},
        }
    )
    note = chat_service.proposal_note(proposal)
    assert "MG-7" not in note
    assert ("대기" if status == "pending" else "취소") in note


async def test_proposal_on_user_is_422(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["답"]))
    use(fake)
    messages = [
        {
            "role": "user",
            "text": "질문",
            "proposal": {"tasks": [], "status": "pending"},
        }
    ]
    res = await client.post("/api/projects/p3/chat", json={"messages": messages})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "proposal" in body["detail"]
    assert fake.calls == []

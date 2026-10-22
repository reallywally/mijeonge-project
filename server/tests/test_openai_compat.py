"""GPT · Groq 공급자 — `app/llm/openai_compat.py`.

**OpenAI · Groq 를 부르지 않는다.** 가짜 클라이언트가 `client.chat.completions.create(...)` 의
모양만 흉내 내고, SDK 의 진짜 `ChatCompletionChunk` 를 차례대로 내준다.
"""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import httpx2
import pytest
from openai import APIConnectionError, RateLimitError
from openai.types.chat import ChatCompletionChunk
from pydantic import SecretStr

from app.api import chat as chat_api
from app.config import Settings, settings
from app.llm import (
    AssistantMessage,
    Finished,
    LLMError,
    Reply,
    StopReason,
    TextDelta,
    ToolCall,
    ToolResult,
    TurnEvent,
    UserMessage,
)
from app.llm.openai_compat import GROQ_BASE_URL, OpenAICompatProvider, make_provider, to_params
from app.main import app
from app.services import chat as chat_service
from tests.test_chat import parse_sse

QUESTION = {"messages": [{"role": "user", "text": "서버 OS 뭐로 하기로 했지?"}]}


def chunk(
    content: str | None = None,
    *,
    calls: list[dict[str, Any]] | None = None,
    finish: str | None = None,
    refusal: str | None = None,
) -> ChatCompletionChunk:
    delta: dict[str, Any] = {"content": content, "refusal": refusal}
    if calls is not None:
        delta["tool_calls"] = calls
    return ChatCompletionChunk.model_validate(
        {
            "id": "chunk",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "fake",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
    )


def call_piece(
    index: int, *, id_: str | None = None, name: str | None = None, args: str | None = None
) -> dict[str, Any]:
    piece: dict[str, Any] = {"index": index, "function": {"name": name, "arguments": args}}
    if id_ is not None:
        piece |= {"id": id_, "type": "function"}
    return piece


class FakeOpenAI:
    """차례마다 정해 둔 조각 목록을 흘린다. 다 쓰면 마지막 것을 되풀이한다."""

    def __init__(self, *turns: list[ChatCompletionChunk] | Exception) -> None:
        self.turns = list(turns)
        self.calls: list[dict[str, Any]] = []
        self.chat = self
        self.completions = self

    async def create(self, **kwargs: Any) -> AsyncIterator[ChatCompletionChunk]:
        self.calls.append(kwargs)
        turn = self.turns[min(len(self.calls), len(self.turns)) - 1]
        if isinstance(turn, Exception):
            raise turn
        return self._events(turn)

    async def _events(self, turn: list[ChatCompletionChunk]) -> AsyncIterator[ChatCompletionChunk]:
        for item in turn:
            yield item


def provider(fake: FakeOpenAI) -> OpenAICompatProvider:
    return OpenAICompatProvider(fake, settings, model="gpt-test")  # type: ignore[arg-type]


async def one_turn(fake: FakeOpenAI, **kwargs: Any) -> list[TurnEvent]:
    messages = kwargs.pop("messages", [UserMessage("질문")])
    return [e async for e in provider(fake).turn(system="시스템", messages=messages, **kwargs)]


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


# --- 한 번 부르기 ------------------------------------------------------------------------


async def test_text_stream_and_request() -> None:
    fake = FakeOpenAI([chunk("안녕"), chunk("하세요"), chunk(finish="stop")])
    events = [e async for e in provider(fake).stream(system="시스템", user_text="질문")]
    assert events == [TextDelta("안녕"), TextDelta("하세요"), Finished("end")]

    (call,) = fake.calls
    assert call["model"] == "gpt-test"
    assert call["stream"] is True
    assert call["max_completion_tokens"] == settings.chat_max_tokens
    assert call["messages"] == [
        {"role": "system", "content": "시스템"},
        {"role": "user", "content": "질문"},
    ]
    # Claude 전용 설정은 싣지 않는다. 도구가 없으면 도구 칸도 없다
    assert not {"tools", "tool_choice", "betas", "fallbacks", "output_config"} & call.keys()


@pytest.mark.parametrize(
    ("finish", "stop"),
    [("stop", "end"), ("length", "max_tokens"), ("content_filter", "refused"), (None, "end")],
)
async def test_finish_reasons(finish: str | None, stop: StopReason) -> None:
    events = await one_turn(FakeOpenAI([chunk("글"), chunk(finish=finish)]))
    assert isinstance(events[-1], Reply) and events[-1].stop == stop


async def test_refusal_delta_is_refused() -> None:
    events = await one_turn(FakeOpenAI([chunk(refusal="못 합니다"), chunk(finish="stop")]))
    assert isinstance(events[-1], Reply) and events[-1].stop == "refused"


# --- 도구 -------------------------------------------------------------------------------


async def test_tool_calls_arrive_in_pieces() -> None:
    fake = FakeOpenAI(
        [
            chunk("볼게요"),
            chunk(calls=[call_piece(0, id_="call_a", name="get_thread", args='{"thread')]),
            chunk(calls=[call_piece(0, args='_id": "t1"}')]),
            chunk(calls=[call_piece(1, id_="call_b", name="list_members", args="")]),
            chunk(finish="tool_calls"),
        ]
    )
    tools = [t for t in chat_service.TOOLS if t["name"] in ("get_thread", "list_members")]
    events = await one_turn(fake, tools=tools, max_tokens=123)
    reply = events[-1]
    assert isinstance(reply, Reply) and reply.stop == "tool_use"
    assert reply.message.text == "볼게요"
    assert list(reply.message.calls) == [
        ToolCall(id="call_a", name="get_thread", input={"thread_id": "t1"}),
        ToolCall(id="call_b", name="list_members", input={}),
    ]

    (call,) = fake.calls
    assert call["max_completion_tokens"] == 123
    assert call["tool_choice"] == "auto"
    get_thread = next(t for t in call["tools"] if t["function"]["name"] == "get_thread")
    assert get_thread["type"] == "function"
    assert get_thread["function"]["parameters"] == tools[0]["input_schema"]


async def test_calls_with_stop_still_count_and_broken_json_goes_through() -> None:
    """도구를 불러 놓고 stop 으로 끝내도 tool_use 다. 깨진 입력은 글자 그대로 넘긴다."""
    fake = FakeOpenAI(
        [
            chunk(calls=[call_piece(0, id_="c", name="get_thread", args="{깨짐")]),
            chunk(finish="stop"),
        ]
    )
    reply = (await one_turn(fake))[-1]
    assert isinstance(reply, Reply) and reply.stop == "tool_use"
    assert reply.message.calls[0].input == "{깨짐"


def test_messages_in_openai_shape() -> None:
    call = ToolCall(id="c1", name="get_thread", input={"thread_id": "t1"})
    messages = [
        UserMessage("회의록", cache=True),
        AssistantMessage(text="", calls=[call], native=object()),
        UserMessage("마무리하라", results=[ToolResult(call_id="c1", content="{}", is_error=True)]),
        AssistantMessage(text="답"),
        UserMessage(results=[ToolResult(call_id="c2", content="[]", is_error=False)]),
    ]
    assert to_params("시스템", messages) == [
        {"role": "system", "content": "시스템"},
        # 캐시 표시는 건너뛴다
        {"role": "user", "content": "회의록"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "get_thread", "arguments": '{"thread_id": "t1"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "{}"},
        {"role": "user", "content": "마무리하라"},
        {"role": "assistant", "content": "답"},
        # 덧말 없는 도구 결과 뒤에는 빈 user 메시지를 붙이지 않는다
        {"role": "tool", "tool_call_id": "c2", "content": "[]"},
    ]


# --- 오류 -------------------------------------------------------------------------------


async def test_sdk_errors_become_llm_errors() -> None:
    request = httpx2.Request("POST", "https://api.openai.com/v1/chat/completions")
    limited = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    for raised, code in [
        (limited, "CHAT_RATE_LIMITED"),
        (APIConnectionError(request=request), "CHAT_UNAVAILABLE"),
    ]:
        with pytest.raises(LLMError) as caught:
            await one_turn(FakeOpenAI(raised))
        assert caught.value.code == code


# --- 챗봇 끝까지 -------------------------------------------------------------------------


async def test_chat_runs_on_openai_shape(client: httpx.AsyncClient) -> None:
    fake = FakeOpenAI(
        [
            chunk(
                calls=[call_piece(0, id_="call_1", name="get_thread", args='{"thread_id":"t1"}')]
            ),
            chunk(finish="tool_calls"),
        ],
        [chunk("우분투로 정했습니다 [[thread:t1]]"), chunk(finish="stop")],
    )
    llm = provider(fake)
    app.dependency_overrides[chat_api.get_llm] = lambda: llm
    events = parse_sse((await client.post("/api/projects/p1/chat", json=QUESTION)).text)
    assert [name for name, _ in events] == ["tool", "delta", "done"]
    assert events[-1][1]["refs"] == [{"kind": "thread", "id": "t1"}]

    second = fake.calls[1]["messages"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "tool"]
    assert second[2]["tool_calls"][0]["id"] == "call_1"
    assert second[3]["tool_call_id"] == "call_1"
    assert json.loads(second[3]["content"])["thread"]["id"] == "t1"


async def test_minutes_draft_runs_on_openai_shape(client: httpx.AsyncClient) -> None:
    from tests.test_minutes import DRAFT_URL, PROPOSED

    args = json.dumps(PROPOSED, ensure_ascii=False)
    fake = FakeOpenAI(
        [
            chunk(calls=[call_piece(0, id_="call_1", name="propose_minutes", args=args)]),
            chunk(finish="tool_calls"),
        ]
    )
    llm = provider(fake)
    app.dependency_overrides[chat_api.get_llm] = lambda: llm
    events = parse_sse((await client.post(DRAFT_URL)).text)
    assert [name for name, _ in events] == ["tool", "draft", "done"]
    assert fake.calls[0]["max_completion_tokens"] == settings.minutes_max_tokens


# --- 설정으로 고르기 ----------------------------------------------------------------------


def fresh(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_make_provider_needs_key_and_model() -> None:
    assert make_provider(fresh(llm_provider="anthropic", openai_api_key="k")) is None
    assert make_provider(fresh(llm_provider="openai", openai_api_key="k")) is None
    assert make_provider(fresh(llm_provider="openai", openai_model="gpt-x")) is None
    assert make_provider(fresh(llm_provider="groq", groq_api_key=" ", groq_model="m")) is None

    gpt = make_provider(fresh(llm_provider="openai", openai_api_key="k", openai_model="gpt-x"))
    assert gpt is not None and gpt.model == "gpt-x" and "api.openai.com" in str(gpt.client.base_url)
    groq = make_provider(fresh(llm_provider="groq", groq_api_key="k", groq_model=" llama "))
    assert groq is not None and groq.model == "llama" and groq.name == "Groq"
    assert str(groq.client.base_url).rstrip("/") == GROQ_BASE_URL


def test_keys_do_not_leak_into_repr() -> None:
    values = fresh(openai_api_key="sk-비밀", groq_api_key="gsk-비밀")
    assert "sk-비밀" not in repr(values) and "gsk-비밀" not in repr(values)


async def test_get_llm_follows_the_setting(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 만든 것을 검사 뒤에 되돌린다 — 다음 검사가 이 공급자를 받지 않게
    monkeypatch.setattr(chat_api, "_other", None)
    monkeypatch.setattr(chat_api, "_other_built", False)
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", None)
    # 고른 공급자의 키가 없으면 Claude 키가 있어도 503 이다
    res = await client.post("/api/projects/p1/chat", json=QUESTION)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"

    monkeypatch.setattr(chat_api, "_other_built", False)
    monkeypatch.setattr(settings, "groq_api_key", SecretStr("gsk-키"))
    monkeypatch.setattr(settings, "groq_model", "llama-test")
    built = chat_api.get_llm(None)
    assert isinstance(built, OpenAICompatProvider) and built.name == "Groq"
    # 한 번 만든 것을 다시 쓴다
    assert chat_api.get_llm(None) is built

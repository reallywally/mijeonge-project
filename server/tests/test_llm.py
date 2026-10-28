"""LLM 공급자 경계 — `app/llm`.

AI 를 부르는 서비스(챗봇 · 회의록 초안 · 리스크 요약 · 리포트)는
`LLMProvider` 만 본다.
Anthropic SDK 모양을 흉내 내지 않는 가짜 공급자를 `get_llm` 에 끼워도 그대로 돌아야 한다.
"""

import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError

from app.api import chat as chat_api
from app.config import settings
from app.llm import (
    AssistantMessage,
    Finished,
    LLMError,
    LLMEvent,
    Message,
    Reply,
    StopReason,
    TextDelta,
    ToolCall,
    ToolResult,
    ToolSpec,
    TurnEvent,
    UserMessage,
)
from app.llm.anthropic_provider import AnthropicProvider, to_param
from app.main import app
from app.services import minutes_draft
from tests.test_chat import FakeClient, Turn, parse_sse
from tests.test_minutes import DRAFT_URL, PROPOSED
from tests.test_risk_summary import ALL, URL


class PlainProvider:
    """공급자 SDK 와 무관한 가짜 — 정해 둔 글 조각과 멈춘 이유만 낸다."""

    def __init__(
        self, *texts: str, stop: StopReason = "end", raises: LLMError | None = None
    ) -> None:
        self.texts = texts
        self.stop = stop
        self.raises = raises
        self.calls: list[tuple[str, str]] = []

    async def stream(self, *, system: str, user_text: str) -> AsyncIterator[LLMEvent]:
        self.calls.append((system, user_text))
        if self.raises is not None:
            raise self.raises
        for text in self.texts:
            yield TextDelta(text)
        yield Finished(self.stop)


@dataclass
class Step:
    """도구 루프 한 차례 — 흘릴 글, 부를 도구(이름, 입력), 멈춘 이유."""

    texts: list[str] = field(default_factory=list)
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    stop: StopReason | None = None


class ScriptedProvider:
    """도구 루프용 가짜. 받은 대화를 차례마다 떠 둔다 — 서비스가 무엇을 이어 붙였는지 본다."""

    def __init__(self, *steps: Step) -> None:
        self.steps = list(steps)
        self.turns: list[list[Message]] = []
        self.tools: list[list[str]] = []

    async def stream(self, *, system: str, user_text: str) -> AsyncIterator[LLMEvent]:
        raise AssertionError("도구 루프는 turn 을 부른다")
        yield  # pragma: no cover

    async def turn(
        self,
        *,
        system: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSpec] = (),
        max_tokens: int | None = None,
    ) -> AsyncIterator[TurnEvent]:
        self.turns.append(list(messages))
        self.tools.append([tool["name"] for tool in tools])
        number = len(self.turns)
        step = self.steps[min(number, len(self.steps)) - 1]
        for text in step.texts:
            yield TextDelta(text)
        calls = [
            ToolCall(id=f"c{number}_{i}", name=name, input=args)
            for i, (name, args) in enumerate(step.calls)
        ]
        stop = step.stop or ("tool_use" if calls else "end")
        yield Reply(AssistantMessage(text="".join(step.texts), calls=calls), stop)


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


def use(llm: PlainProvider | ScriptedProvider | None) -> None:
    app.dependency_overrides[chat_api.get_llm] = lambda: llm


async def collect(provider: AnthropicProvider) -> list[LLMEvent]:
    return [event async for event in provider.stream(system="s", user_text="u")]


# --- 서비스는 공급자를 가리지 않는다 ---------------------------------------------------------


async def test_risk_summary_runs_on_any_provider(client: httpx.AsyncClient) -> None:
    fake = PlainProvider("먼저 ", "[[thread:t5]] 를 정합니다.")
    use(fake)
    res = await client.post(URL, json=ALL)
    events = parse_sse(res.text)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[-1][1]["refs"] == [{"kind": "thread", "id": "t5"}]
    ((system, user_text),) = fake.calls
    assert "리스크" in system and user_text.endswith("}")


async def test_refused_and_errors_come_through(client: httpx.AsyncClient) -> None:
    use(PlainProvider("그건", stop="refused"))
    events = parse_sse((await client.post(URL, json=ALL)).text)
    assert [name for name, _ in events] == ["delta", "error"]
    assert events[-1][1]["code"] == "CHAT_REFUSED"

    use(PlainProvider(raises=LLMError("CHAT_RATE_LIMITED", "잠시 뒤에")))
    events = parse_sse((await client.post(URL, json=ALL)).text)
    assert events == [
        ("error", {"type": "error", "code": "CHAT_RATE_LIMITED", "message": "잠시 뒤에"})
    ]


async def test_no_provider_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(URL, json=ALL)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


async def test_chat_tool_loop_runs_on_any_provider(client: httpx.AsyncClient) -> None:
    fake = ScriptedProvider(
        Step(calls=[("get_thread", {"thread_id": "t1"})]),
        Step(texts=["우분투로 정했습니다 [[thread:t1]]"]),
    )
    use(fake)
    body = {"messages": [{"role": "user", "text": "서버 OS 뭐로 하기로 했지?"}]}
    events = parse_sse((await client.post("/api/projects/p1/chat", json=body)).text)
    assert [name for name, _ in events] == ["tool", "delta", "done"]
    assert events[-1][1]["refs"] == [{"kind": "thread", "id": "t1"}]

    # 둘째 차례 = 질문 · 도구를 부른 답 · 도구 결과
    question, called, answered = fake.turns[1]
    assert question == UserMessage("서버 OS 뭐로 하기로 했지?")
    assert isinstance(called, AssistantMessage) and called.calls[0].name == "get_thread"
    assert isinstance(answered, UserMessage) and answered.text == ""
    (result,) = answered.results
    assert result.call_id == "c1_0" and result.is_error is False
    assert json.loads(result.content)["thread"]["id"] == "t1"
    assert "propose_tasks" in fake.tools[0]


async def test_paused_turn_is_continued(client: httpx.AsyncClient) -> None:
    fake = ScriptedProvider(Step(texts=["찾는 중"], stop="paused"), Step(texts=["답"]))
    use(fake)
    body = {"messages": [{"role": "user", "text": "질문"}]}
    events = parse_sse((await client.post("/api/projects/p1/chat", json=body)).text)
    assert [data.get("text") for name, data in events if name == "delta"] == [
        "찾는 중",
        "\n\n",
        "답",
    ]
    paused = fake.turns[1][-1]
    assert isinstance(paused, AssistantMessage) and paused.text == "찾는 중"


async def test_minutes_draft_runs_on_any_provider(client: httpx.AsyncClient) -> None:
    fake = ScriptedProvider(Step(texts=["정리합니다"]), Step(calls=[("propose_minutes", PROPOSED)]))
    use(fake)
    events = parse_sse((await client.post(DRAFT_URL)).text)
    assert [name for name, _ in events] == ["tool", "draft", "done"]
    # 회의록은 캐시 표시를 달고, 초안 없이 끝낸 차례 뒤에는 재촉이 붙는다
    first, _, nudge = fake.turns[1]
    assert isinstance(first, UserMessage) and first.cache is True
    assert isinstance(nudge, UserMessage) and nudge.text == minutes_draft.NUDGE
    assert fake.tools[0] == [
        "search_threads",
        "get_thread",
        "search_tasks",
        "list_members",
        "propose_minutes",
    ]


# --- AnthropicProvider 가 SDK 를 접는 법 -------------------------------------------------------


@pytest.mark.parametrize(
    ("stop_reason", "stop"),
    [
        ("end_turn", "end"),
        ("refusal", "refused"),
        ("max_tokens", "max_tokens"),
        ("model_context_window_exceeded", "max_tokens"),
    ],
)
async def test_anthropic_stop_reasons(stop_reason: str, stop: StopReason) -> None:
    fake = FakeClient(Turn(texts=["가", "나"], stop_reason=stop_reason))
    events = await collect(AnthropicProvider(fake, settings))  # type: ignore[arg-type]
    assert events == [TextDelta("가"), TextDelta("나"), Finished(stop)]


async def test_anthropic_errors_become_llm_errors() -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    limited = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    for raised, code in [
        (limited, "CHAT_RATE_LIMITED"),
        (APIConnectionError(request=request), "CHAT_UNAVAILABLE"),
    ]:
        fake = FakeClient(Turn(raises=raised))
        with pytest.raises(LLMError) as caught:
            await collect(AnthropicProvider(fake, settings))  # type: ignore[arg-type]
        assert caught.value.code == code


def test_anthropic_params_from_neutral_messages() -> None:
    """원본(native)이 없는 답 · 도구 결과 · 캐시 표시를 Claude 의 모양으로."""
    call = ToolCall(id="c1", name="get_thread", input={"thread_id": "t1"})
    assert to_param(AssistantMessage(text="앞의 답")) == {"role": "assistant", "content": "앞의 답"}
    assert to_param(AssistantMessage(text="볼게요", calls=[call])) == {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "볼게요"},
            {"type": "tool_use", "id": "c1", "name": "get_thread", "input": {"thread_id": "t1"}},
        ],
    }
    results = [ToolResult(call_id="c1", content="{}", is_error=False)]
    assert to_param(UserMessage("마무리", results=results)) == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "c1", "content": "{}", "is_error": False},
            {"type": "text", "text": "마무리"},
        ],
    }
    assert to_param(UserMessage("회의록", cache=True)) == {
        "role": "user",
        "content": [{"type": "text", "text": "회의록", "cache_control": {"type": "ephemeral"}}],
    }

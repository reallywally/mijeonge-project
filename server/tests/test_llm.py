"""LLM 공급자 경계 — `app/llm`.

한 번 부르는 서비스(리스크 요약 · 리포트 · 선행 관계 제안)는 `LLMProvider` 만 본다.
Anthropic SDK 모양을 흉내 내지 않는 가짜 공급자를 `get_llm` 에 끼워도 그대로 돌아야 한다.
"""

import json
from collections.abc import AsyncIterator

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError

from app.api import chat as chat_api
from app.config import settings
from app.llm import Finished, LLMError, LLMEvent, StopReason, TextDelta
from app.llm.anthropic_provider import AnthropicProvider
from app.main import app
from tests.test_chat import FakeClient, Turn, parse_sse
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


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


def use(llm: PlainProvider | None) -> None:
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


async def test_dependency_suggest_runs_on_any_provider(client: httpx.AsyncClient) -> None:
    answer = {"suggestions": [{"task": "HW-21", "dependsOn": "HW-20", "reason": "DB 가 먼저"}]}
    use(PlainProvider(json.dumps(answer, ensure_ascii=False)))
    res = await client.post("/api/projects/p1/dependencies/suggest")
    assert res.status_code == 200, res.text

    use(PlainProvider(raises=LLMError("CHAT_UNAVAILABLE", "응답 없음")))
    res = await client.post("/api/projects/p1/dependencies/suggest")
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


async def test_no_provider_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(URL, json=ALL)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


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

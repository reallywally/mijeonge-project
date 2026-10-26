"""고른 공급자(.env 의 LLM_PROVIDER)를 실제로 한 번 불러 본다 — DB · 로그인 없이.

    uv run python -m scripts.llm_smoke

① 도구 없이 한 번(글이 흐르는지) ② 도구 한 차례(모델이 도구를 부르는지)를 본다.
돈이 든다 — 사람이 돌린다.
"""

import asyncio
import sys

from app.config import settings
from app.llm import LLMError, LLMProvider, Reply, TextDelta, ToolSpec, UserMessage
from app.llm.anthropic_provider import AnthropicProvider, make_client
from app.llm.openai_compat import make_provider

WEATHER: ToolSpec = {
    "name": "get_weather",
    "description": "도시의 오늘 날씨를 알려 준다.",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string", "description": "도시 이름"}},
        "required": ["city"],
    },
}


def build() -> LLMProvider | None:
    if settings.llm_provider == "anthropic":
        client = make_client(settings)
        return AnthropicProvider(client, settings) if client is not None else None
    return make_provider(settings)


async def main() -> int:
    llm = build()
    if llm is None:
        print(f"'{settings.llm_provider}' 의 키 · 모델이 .env 에 없습니다.")
        return 1
    print(f"공급자: {settings.llm_provider}")
    try:
        print("\n① 도구 없이 한 번")
        async for event in llm.stream(
            system="너는 한국어로 짧게 답한다.", user_text="자기소개를 한 문장으로 해 줘."
        ):
            if isinstance(event, TextDelta):
                print(event.text, end="", flush=True)
            else:
                print(f"\n   → 멈춘 이유: {event.stop}")

        print("\n② 도구 한 차례")
        async for turn_event in llm.turn(
            system="날씨를 물으면 반드시 get_weather 도구를 불러라.",
            messages=[UserMessage("서울 날씨 어때?")],
            tools=[WEATHER],
        ):
            if isinstance(turn_event, Reply):
                print(f"   → 멈춘 이유: {turn_event.stop}")
                for call in turn_event.message.calls:
                    print(f"   → 도구 호출: {call.name}({call.input})")
    except LLMError as exc:
        print(f"\n실패: {exc.code} — {exc.message} (자세한 상태는 위 경고 로그)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

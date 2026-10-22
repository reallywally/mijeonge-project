"""리스크 AI 요약 — `POST /api/projects/{projectId}/risks/summary` (`docs/api/risk.md` 'AI 요약').

**Claude 를 부르지 않는다.** 챗봇 검사의 가짜 클라이언트를 그대로 끼운다.
'오늘' 은 시드 보고서 검사(`test_risk.py`)와 같은 2026-10-15 로 고정한다.
"""

import json
from datetime import date
from typing import Any

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.api import risk as risk_api
from app.config import settings
from app.llm.anthropic_provider import FALLBACK_BETA
from app.main import app
from app.models import Member
from app.services import chat as chat_service
from app.services import risk_summary
from app.services.ratelimit import RateLimiter
from tests.conftest import AsMember
from tests.test_chat import FakeClient, Turn, parse_sse

URL = "/api/projects/p1/risks/summary"
TODAY = date(2026, 10, 15)
# 시드 p1 의 그날 보고서: 안건 t5 t3 t8 t9 t4 t7, 작업 k22 k3 k13
ALL = {"threadIds": ["t5", "t3", "t8", "t9", "t4", "t7"], "taskIds": ["k22", "k3", "k13"]}


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(risk_api, "today_kst", lambda: TODAY)
    chat_api.get_rate_limiter().reset()


def use(client: FakeClient | None) -> None:
    app.dependency_overrides[chat_api.get_chat_client] = lambda: client


def sent(fake: FakeClient) -> dict[str, Any]:
    """Claude 에 넣은 근거 JSON — 사용자 메시지 하나의 끝에 붙어 있다."""
    (call,) = fake.calls
    (message,) = call["messages"]
    assert message["role"] == "user"
    text: str = message["content"]
    return dict(json.loads(text[text.index("{") :]))


async def post(client: httpx.AsyncClient, body: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    res = await client.post(URL, json=body)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return parse_sse(res.text)


# --- 거르기 -------------------------------------------------------------------------


async def test_keeps_only_report_rows_that_were_sent(client: httpx.AsyncClient) -> None:
    """남의 프로젝트 id(t10 · x1) · 리스크가 아닌 id(t1 · k4) · 지어낸 id 는 조용히 버린다."""
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    body = {"threadIds": ["t3", "t10", "t1", "없는안건", "t5"], "taskIds": ["k4", "x1", "k22"]}
    events = await post(client, body)
    assert [name for name, _ in events] == ["delta", "done"]

    data = sent(fake)
    # 순서는 화면이 보낸 순서가 아니라 서버의 계산(점수 순)이다
    assert [t["id"] for t in data["report"]["threads"]] == ["t5", "t3"]
    assert [t["id"] for t in data["report"]["tasks"]] == ["k22"]
    leaked = json.dumps(data, ensure_ascii=False)
    assert "t10" not in leaked and "이관 범위 확정" not in leaked and "현행 분석" not in leaked
    assert "x1" not in leaked


async def test_numbers_come_from_the_server(client: httpx.AsyncClient) -> None:
    """화면이 숫자를 끼워 보내도 받지 않는다 — 점수 · 등급은 서버의 계산 그대로다."""
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, {"threadIds": ["t5"], "taskIds": [], "score": 99, "level": "low"})
    (t5,) = sent(fake)["report"]["threads"]
    assert (t5["score"], t5["level"]) == (7, "high")
    assert t5["signals"] == ["deferredRepeatedly", "stale", "blocking"]


@pytest.mark.parametrize(
    "body",
    [
        {"threadIds": [], "taskIds": []},
        # 거른 뒤 빈 것도 같다 — 남의 것 · 리스크 아닌 것뿐
        {"threadIds": ["t10", "t1"], "taskIds": ["x1", "k4"]},
    ],
)
async def test_nothing_left_does_not_call_claude(
    client: httpx.AsyncClient, body: dict[str, Any]
) -> None:
    fake = FakeClient(Turn(texts=["부르면 안 된다"]))
    use(fake)
    events = await post(client, body)
    assert fake.calls == []
    assert events == [
        ("delta", {"type": "delta", "text": "지금 짚을 리스크가 없습니다."}),
        ("done", {"type": "done", "refs": []}),
    ]


# --- 넣는 근거 ----------------------------------------------------------------------


async def test_context_names_people_and_hides_their_ids(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    data = sent(fake)
    report = data["report"]

    assert report["asOf"] == "2026-10-15"
    assert report["settings"]["staleDays"] == 7
    t5 = report["threads"][0]
    assert (t5["owner"], t5["part"]) == ("정하늘", "기간계 연동")
    k18 = {"id": "k18", "key": "HW-18", "title": "보험료 산출 기간계 API 개발"}
    assert t5["blockedTasks"] == [k18]
    t4 = next(t for t in report["threads"] if t["id"] == "t4")
    assert t4["owner"] == "담당자 없음"
    k22 = report["tasks"][0]
    assert (k22["key"], k22["title"], k22["owner"], k22["part"]) == (
        "HW-22", "스테이징 DB 구성", "이도현", "인프라",
    )  # fmt: skip
    # 근거 안건은 이미 정해진 t2 라 보고서 밖에서 제목을 찾아 온다
    assert [t["id"] for t in k22["threads"]] == ["t2"]
    assert k22["threads"][0]["title"] not in ("", "알 수 없음")
    assert [o["member"] for o in report["owners"]] == [
        "정하늘", "김서연", "박지훈", "이도현", "담당자 없음",
    ]  # fmt: skip

    # 멤버 · 파트 id 는 어디에도 실리지 않는다 — 키도 값도
    raw = json.dumps(data, ensure_ascii=False)
    for key in ("ownerId", "memberId", "partId", "projectId", "threadId", "taskId"):
        assert f'"{key}"' not in raw
    for member_id in ("u1", "u2", "u3", "u4", "admin", "pt1", "pt2", "pt3"):
        assert f'"{member_id}"' not in raw


async def test_context_details_top_five_threads(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    details = sent(fake)["details"]

    # 점수 위쪽 다섯 — 여섯째(t7)는 배경 · 이력을 안 싣는다
    assert [d["id"] for d in details] == ["t5", "t3", "t8", "t9", "t4"]
    t5 = details[0]
    assert t5["description"].startswith("보험료 산출 기간계 API 개발 중")
    # 이력은 전부, 등록 순서(seq)대로 · 날짜는 한국 날짜
    defers = [e for e in t5["entries"] if e["kind"] == "defer"]
    assert [e["date"] for e in defers] == ["2026-09-07", "2026-09-14"]
    assert defers[-1]["note"].startswith("두 번째 미룸이다")
    assert set(t5["entries"][0]) == {"kind", "text", "detail", "note", "date"}
    k18 = next(t for t in t5["tasks"] if t["id"] == "k18")
    assert k18 == {
        "id": "k18",
        "key": "HW-18",
        "title": "보험료 산출 기간계 API 개발",
        "status": "blocked",
        "due": None,
        "owner": "정하늘",
    }
    t3 = details[1]
    assert t3["options"] == ["전면 허용", "비식별 데이터만 허용", "사내 모델만 사용"]


async def test_one_call_without_tools_on_chat_settings(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.chat_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["betas"] == [FALLBACK_BETA]
    assert "tools" not in call and "tool_choice" not in call and "thinking" not in call
    assert "한화손보 차세대" in call["system"] and "2026-10-15 (목)" in call["system"]
    # 계약의 '답의 모양' 머리글 · 대응표가 프롬프트에 있다
    heads = ("먼저 정할 것", "바로 풀 수 있는 것", "눈에 띄는 점", "decidedButBlocked 풀어도 됨")
    assert all(line in call["system"] for line in heads)


# --- 스트림 ---------------------------------------------------------------------------


async def test_refs_only_for_ids_that_were_given(client: httpx.AsyncClient) -> None:
    """근거 칩은 본문에 나온 것 중 넣어 준 id 만 — 지어낸 id(t10)는 칩이 되지 않는다."""
    text = (
        "먼저 정할 것\n1. [[thread:t5]] — [[task:k18]] 이 막힘 "
        "[[thread:t10]] [[task:k22]] [[thread:t5]]"
    )
    use(FakeClient(Turn(texts=[text[:20], text[20:]])))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[-1][1]["refs"] == [
        {"kind": "thread", "id": "t5"},
        {"kind": "task", "id": "k18"},
        {"kind": "task", "id": "k22"},
    ]


async def test_claude_rate_limit_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=error)))
    res = await client.post(URL, json=ALL)
    assert res.status_code == 200
    events = parse_sse(res.text)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_RATE_LIMITED")]


async def test_claude_unreachable_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    use(FakeClient(Turn(raises=APIConnectionError(request=request))))
    events = await post(client, ALL)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_UNAVAILABLE")]


async def test_refusal_is_an_error_without_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "error"]
    assert events[-1][1]["code"] == "CHAT_REFUSED"


async def test_max_tokens_ends_with_a_note_and_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["길게 "], stop_reason="max_tokens")))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[1][1]["text"] == chat_service.TRUNCATED


# --- 경계 -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"threadIds": ["t5"]},
        {"taskIds": []},
        {},
        {"threadIds": "t5", "taskIds": []},
        {"threadIds": [f"t{n}" for n in range(101)], "taskIds": []},
        {"threadIds": [], "taskIds": [f"k{n}" for n in range(101)]},
    ],
)
async def test_bad_input_is_422(client: httpx.AsyncClient, body: dict[str, Any]) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    res = await client.post(URL, json=body)
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    assert fake.calls == []


async def test_hundred_each_is_fine(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    body = {"threadIds": ["t5"] * 100, "taskIds": ["k22"] * 100}
    assert (await client.post(URL, json=body)).status_code == 200


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    res = await client.post("/api/projects/nope/risks/summary", json=ALL)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_ungranted_member_is_404(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    session.add(Member(id="u9", name="외부인", email="u9@innoflow.local"))
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    u9 = await as_member("u9")
    res = await u9.post(URL, json=ALL)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"
    assert fake.calls == []


async def test_any_member_summarizes(as_member: AsMember) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    u2 = await as_member("u2")
    assert (await u2.post(URL, json=ALL)).status_code == 200


async def test_no_key_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(URL, json=ALL)
    assert res.status_code == 503
    assert res.headers["content-type"].startswith("application/json")
    assert res.json()["code"] == "CHAT_UNAVAILABLE"
    # 리스크 표는 그대로 읽힌다
    assert (await client.get("/api/projects/p1/risks")).status_code == 200


async def test_shares_the_chat_rate_limit(client: httpx.AsyncClient) -> None:
    """챗봇과 같은 제한기 — 질문 하나를 쓰면 같은 분에 요약은 429 다."""
    use(FakeClient(Turn(texts=["답"])))
    limiter = RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter
    ask = {"messages": [{"role": "user", "text": "뭐부터 정해야 해?"}]}
    assert (await client.post("/api/projects/p1/chat", json=ask)).status_code == 200
    res = await client.post(URL, json=ALL)
    assert res.status_code == 429 and res.json()["code"] == "CHAT_RATE_LIMITED"


def test_nothing_text_matches_the_contract() -> None:
    assert risk_summary.NOTHING == "지금 짚을 리스크가 없습니다."

"""프로젝트 진행 리포트 — `/api/projects/{projectId}/reports` · `/api/reports/{reportId}`.

계약은 `docs/api/report.md`.

**Claude 를 부르지 않는다.** 챗봇 검사의 가짜 클라이언트를 그대로 끼운다.
'오늘' 은 2026-10-20(화) 로 고정한다 — 시드 p1 의 HW-20 이 '오래 걸림' 인 날.
"""

import json
from datetime import date
from typing import Any

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.api import report as report_api
from app.config import settings
from app.main import app
from app.models import Entry, Member, ProjectReport, Task
from app.services import chat as chat_service
from app.services import report as report_service
from app.services.ratelimit import RateLimiter
from app.time import at
from tests.conftest import AsMember
from tests.test_chat import FakeClient, Turn, parse_sse

URL = "/api/projects/p1/reports"
TODAY = date(2026, 10, 20)


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(report_api, "today_kst", lambda: TODAY)
    chat_api.get_rate_limiter().reset()


def use(client: FakeClient | None) -> None:
    app.dependency_overrides[chat_api.get_chat_client] = lambda: client


def sent(fake: FakeClient, index: int = 0) -> dict[str, Any]:
    """Claude 에 넣은 근거 JSON — 사용자 메시지 하나의 끝에 붙어 있다."""
    (message,) = fake.calls[index]["messages"]
    assert message["role"] == "user"
    text: str = message["content"]
    return dict(json.loads(text[text.index("{") :]))


async def post(client: httpx.AsyncClient, url: str = URL) -> list[tuple[str, dict[str, Any]]]:
    res = await client.post(url)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return parse_sse(res.text)


async def saved(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(ProjectReport)) or 0)


# --- 만들기 -------------------------------------------------------------------------------


async def test_stream_order_and_save(client: httpx.AsyncClient, session: AsyncSession) -> None:
    """facts → delta… → done. done 의 report 는 저장한 것이고 목록 · 읽기가 같은 것을 준다."""
    use(FakeClient(Turn(texts=["한 줄 총평", " — HW-20 [[task:k20]]"])))
    events = await post(client)
    assert [name for name, _ in events] == ["facts", "delta", "delta", "done"]

    facts = events[0][1]["facts"]
    assert (facts["periodStart"], facts["periodEnd"]) == ("2026-10-14", "2026-10-20")
    assert facts["attention"][0]["taskId"] == "k20"
    done = events[-1][1]
    item = done["report"]
    assert set(item) == {
        "id",
        "projectId",
        "periodStart",
        "periodEnd",
        "createdBy",
        "createdAt",
        "doneRate",
        "attentionCount",
    }
    assert (item["projectId"], item["createdBy"]) == ("p1", "admin")
    assert item["doneRate"] == facts["progress"]["doneRate"]
    assert item["attentionCount"] == len(facts["attention"])
    assert item["createdAt"].endswith("Z")
    assert done["refs"] == [{"kind": "task", "id": "k20"}]

    rows = (await client.get(URL)).json()
    assert rows == [item]
    one = (await client.get(f"/api/reports/{item['id']}")).json()
    assert one == {**item, "facts": facts, "body": "한 줄 총평 — HW-20 [[task:k20]]"}
    assert await saved(session) == 1


async def test_list_newest_first(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["글"])))
    first = (await post(client))[-1][1]["report"]["id"]
    second = (await post(client))[-1][1]["report"]["id"]
    assert [r["id"] for r in (await client.get(URL)).json()] == [second, first]


async def test_second_report_sees_the_first(client: httpx.AsyncClient) -> None:
    """바로 앞 리포트의 숫자는 facts.previous 에, 글은 Claude 에 — '지난주 대비' 를 쓰라고."""
    fake = FakeClient(Turn(texts=["지난 글"]))
    use(fake)
    first = (await post(client))[-1][1]["report"]
    events = await post(client)
    previous = events[0][1]["facts"]["previous"]
    assert previous == {
        "reportId": first["id"],
        "periodEnd": "2026-10-20",
        "doneRate": first["doneRate"],
        "blocked": 2,
    }
    assert sent(fake, 0)["previous"] is None
    assert sent(fake, 1)["previous"]["body"] == "지난 글"


async def test_refs_only_for_ids_that_were_given(client: httpx.AsyncClient) -> None:
    """근거 칩은 본문에 나온 것 중 넣어 준 id 만 — 다른 프로젝트 · 지어낸 id 는 칩이 안 된다."""
    text = (
        "[[task:k20]] [[task:x1]] [[thread:t10]] [[thread:t5]] [[task:없는것]] "
        "[[task:k22]] [[thread:t2]] [[task:k20]]"
    )
    use(FakeClient(Turn(texts=[text])))
    events = await post(client)
    assert events[-1][1]["refs"] == [
        {"kind": "task", "id": "k20"},
        {"kind": "thread", "id": "t5"},
        {"kind": "task", "id": "k22"},
        # k22 에 걸린 안건 — details 로 넣어 준 것이다
        {"kind": "thread", "id": "t2"},
    ]


async def test_max_tokens_saves_with_a_note(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    use(FakeClient(Turn(texts=["길게 "], stop_reason="max_tokens")))
    events = await post(client)
    assert [name for name, _ in events] == ["facts", "delta", "delta", "done"]
    assert events[2][1]["text"] == chat_service.TRUNCATED
    report_id = events[-1][1]["report"]["id"]
    body = (await client.get(f"/api/reports/{report_id}")).json()["body"]
    assert body == "길게 " + chat_service.TRUNCATED


# --- 실패하면 저장하지 않는다 ------------------------------------------------------------


async def test_refusal_is_an_error_and_not_saved(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    events = await post(client)
    assert [name for name, _ in events] == ["facts", "delta", "error"]
    assert events[-1][1]["code"] == "CHAT_REFUSED"
    assert await saved(session) == 0


async def test_rate_limit_after_stream_opens_is_not_saved(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=error)))
    events = await post(client)
    assert [(name, data.get("code")) for name, data in events] == [
        ("facts", None),
        ("error", "CHAT_RATE_LIMITED"),
    ]
    assert await saved(session) == 0


async def test_unreachable_is_not_saved(client: httpx.AsyncClient, session: AsyncSession) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    use(FakeClient(Turn(raises=APIConnectionError(request=request))))
    events = await post(client)
    assert events[-1] == (
        "error",
        {"type": "error", "code": "CHAT_UNAVAILABLE", "message": events[-1][1]["message"]},
    )
    assert await saved(session) == 0


async def test_stopped_stream_is_not_saved(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """화면이 끊으면(제너레이터를 닫으면) 저장에 닿지 않는다."""
    prepared = await report_service.prepare(session, "p1", today=TODAY)
    fake = FakeClient(Turn(texts=["하나", "둘", "셋"]))
    stream = report_service.write(
        fake,  # type: ignore[arg-type]
        session,
        settings,
        project_id="p1",
        project_name="한화손보 차세대",
        actor_id="u1",
        prepared=prepared,
        today=TODAY,
    )
    assert (await anext(stream)).type == "facts"
    assert (await anext(stream)).type == "delta"
    await stream.aclose()
    assert await saved(session) == 0


# --- 작업이 없을 때 ----------------------------------------------------------------------


async def test_no_tasks_writes_a_fixed_line_without_claude(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """p3 은 작업이 없다 — Claude 를 안 부르니 키가 없어도 만들어지고 저장된다."""
    use(None)
    events = await post(client, "/api/projects/p3/reports")
    assert [name for name, _ in events] == ["facts", "delta", "done"]
    assert events[1][1]["text"] == "아직 작업이 없어 리포트를 쓸 것이 없습니다."
    assert events[-1][1]["refs"] == []
    item = events[-1][1]["report"]
    assert (item["doneRate"], item["attentionCount"]) == (0, 0)
    body = (await client.get(f"/api/reports/{item['id']}")).json()["body"]
    assert body == report_service.NO_TASKS
    assert await saved(session) == 1


def test_no_tasks_text_matches_the_contract() -> None:
    assert report_service.NO_TASKS == "아직 작업이 없어 리포트를 쓸 것이 없습니다."


# --- 넣는 근거 ----------------------------------------------------------------------------


async def test_one_call_without_tools_on_chat_settings(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["글"]))
    use(fake)
    await post(client)
    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.chat_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["betas"] == [chat_service.FALLBACK_BETA]
    assert "tools" not in call and "tool_choice" not in call and "thinking" not in call
    system = call["system"]
    assert "한화손보 차세대" in system and "2026-10-20 (화)" in system
    heads = ("이번 주 진척", "결정", "먼저 손쓸 것", "사람", "다음 주 볼 것", "1,500자")
    assert all(head in system for head in heads)
    words = ("선행 대기", "뒤 작업을 막는 중", "오래 걸림", "오래 막힘", "시작 안 함", "풀어도 됨")
    assert all(word in system for word in words)


async def test_context_names_tasks_and_people(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["글"]))
    use(fake)
    await post(client)
    data = sent(fake)

    k20 = data["attention"][0]
    assert {k: k20[k] for k in ("id", "key", "title", "owner", "part")} == {
        "id": "k20",
        "key": "HW-20",
        "title": "DB 설치와 초기 스키마 반영",
        "owner": "이도현",
        "part": "인프라",
    }
    assert (k20["statusDays"], k20["plannedDays"], k20["statusSinceBackfill"]) == (12, 3, False)
    assert [t["key"] for t in k20["blocking"]] == ["HW-21", "HW-22"]
    assert data["period"] == {"start": "2026-10-14", "end": "2026-10-20"}
    assert [t["id"] for t in data["decisions"]["risky"]] == ["t5", "t3", "t8", "t9"]
    assert data["decisions"]["risky"][0]["level"] == "high"

    # 멤버 · 파트 id 는 어디에도 실리지 않는다 — 키도 값도
    raw = json.dumps(data, ensure_ascii=False)
    for key in ("ownerId", "memberId", "partId", "projectId", "createdBy"):
        assert f'"{key}"' not in raw
    for member_id in ("u1", "u2", "u3", "u4", "admin", "pt1", "pt2", "pt3"):
        assert f'"{member_id}"' not in raw
    # 다른 프로젝트의 것도 없다
    assert '"x1"' not in raw and "현행 분석" not in raw


async def test_details_for_top_eight(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["글"]))
    use(fake)
    events = await post(client)
    data = sent(fake)
    attention = events[0][1]["facts"]["attention"]
    details = data["details"]
    assert [d["id"] for d in details] == [a["taskId"] for a in attention[:8]]

    k4 = next(d for d in details if d["id"] == "k4")
    checks = [line for line in k4["body"] if line["kind"] == "check"]
    assert checks and all(isinstance(line["done"], bool) for line in checks)
    assert [c["key"] for c in k4["children"]] == ["HW-19", "HW-20", "HW-21", "HW-22"]
    assert {c["status"] for c in k4["children"]} == {"done", "doing", "todo", "blocked"}
    threads = {t["id"]: t for t in k4["threads"]}
    assert set(threads) == {"t1", "t2"}
    last = threads["t2"]["lastEntry"]
    assert set(last) == {"kind", "text", "note", "date"}


async def test_decisions_carry_period_entries(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """기간 안에 결정 이력이 남은 안건 — 제목과 이번 기간의 이력만 들어간다."""
    session.add(
        Entry(
            thread_id="t9",
            kind="decide",
            text="공통 코드 A안",
            note="",
            created_at=at("2026-10-19T00:00:00Z"),
        )
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["글"]))
    use(fake)
    events = await post(client)
    assert events[0][1]["facts"]["decisions"]["decidedThreadIds"] == ["t9"]
    (t9,) = sent(fake)["decisions"]["decided"]
    assert t9["id"] == "t9" and t9["title"]
    assert t9["entries"] == [
        {"kind": "decide", "text": "공통 코드 A안", "note": "", "date": "2026-10-19"}
    ]


# --- 문턱 -----------------------------------------------------------------------------------


async def test_no_key_is_503_and_nothing_saved(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    use(None)
    res = await client.post(URL)
    assert res.status_code == 503
    assert res.headers["content-type"].startswith("application/json")
    assert res.json()["code"] == "CHAT_UNAVAILABLE"
    assert await saved(session) == 0
    # 목록은 그대로 읽힌다
    assert (await client.get(URL)).json() == []


async def test_shares_the_chat_rate_limit(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["답"])))
    limiter = RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter
    ask = {"messages": [{"role": "user", "text": "이번 주 뭐가 늦어?"}]}
    assert (await client.post("/api/projects/p1/chat", json=ask)).status_code == 200
    res = await client.post(URL)
    assert res.status_code == 429 and res.json()["code"] == "CHAT_RATE_LIMITED"


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["글"])))
    res = await client.post("/api/projects/nope/reports")
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_any_member_creates_and_reads(as_member: AsMember) -> None:
    use(FakeClient(Turn(texts=["글"])))
    u2 = await as_member("u2")
    item = (await post(u2))[-1][1]["report"]
    assert item["createdBy"] == "u2"
    assert (await u2.get(f"/api/reports/{item['id']}")).status_code == 200


# --- 읽기 · 지우기 ----------------------------------------------------------------------------


async def make(client: httpx.AsyncClient) -> str:
    use(FakeClient(Turn(texts=["글"])))
    report_id: str = (await post(client))[-1][1]["report"]["id"]
    return report_id


async def test_missing_report_is_404(client: httpx.AsyncClient) -> None:
    for res in (await client.get("/api/reports/nope"), await client.delete("/api/reports/nope")):
        assert res.status_code == 404 and res.json()["code"] == "REPORT_NOT_FOUND"


async def test_ungranted_member_sees_404(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    report_id = await make(client)
    session.add(Member(id="u9", name="외부인", email="u9@innoflow.local"))
    await session.commit()
    u9 = await as_member("u9")
    for res in (
        await u9.get(f"/api/reports/{report_id}"),
        await u9.delete(f"/api/reports/{report_id}"),
    ):
        assert res.status_code == 404 and res.json()["code"] == "REPORT_NOT_FOUND"
    res = await u9.get(URL)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize(("deleter", "status"), [("u2", 204), ("u3", 403), ("u1", 204)])
async def test_delete_boundary(
    as_member: AsMember, session: AsyncSession, deleter: str, status: int
) -> None:
    """만든 사람(u2) · 프로젝트 관리자(u1) 는 지우고, 다른 멤버(u3) 는 403."""
    u2 = await as_member("u2")
    report_id = await make(u2)
    who = u2 if deleter == "u2" else await as_member(deleter)
    res = await who.delete(f"/api/reports/{report_id}")
    assert res.status_code == status
    if status == 403:
        assert res.json()["code"] == "FORBIDDEN"
        assert await saved(session) == 1
    else:
        assert await saved(session) == 0
        res = await u2.get(f"/api/reports/{report_id}")
        assert res.status_code == 404 and res.json()["code"] == "REPORT_NOT_FOUND"


async def test_system_admin_deletes(as_member: AsMember, client: httpx.AsyncClient) -> None:
    u2 = await as_member("u2")
    report_id = await make(u2)
    assert (await client.delete(f"/api/reports/{report_id}")).status_code == 204


async def test_no_edit(client: httpx.AsyncClient) -> None:
    report_id = await make(client)
    res = await client.patch(f"/api/reports/{report_id}", json={"body": "고침"})
    assert res.status_code == 405


async def test_saved_facts_are_not_recomputed(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """만든 때의 계산이다 — 작업이 바뀌어도 저장된 facts 는 그대로다."""
    report_id = await make(client)
    before = (await client.get(f"/api/reports/{report_id}")).json()["facts"]
    k20 = await session.get(Task, "k20")
    assert k20 is not None
    k20.status = "done"
    await session.commit()
    after = (await client.get(f"/api/reports/{report_id}")).json()["facts"]
    assert after == before

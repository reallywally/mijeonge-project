"""회의록 — 게시판 CRUD · `POST /api/minutes/{id}/draft` · `…/apply` (docs/api/minutes.md).

draft 는 **Claude 를 부르지 않는다** — `test_chat.py` 의 가짜 클라이언트를 그대로 끼운다.
시드의 회의록은 `m1`(p1 · 작성자 u1 · 회의 날짜 2026-10-16) 하나다.
"""

import json
from typing import Any

import httpx
import httpx2
import pytest
from anthropic import RateLimitError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.config import settings
from app.llm.anthropic_provider import AnthropicProvider
from app.main import app
from app.models import Entry, Member, Minutes, Task, TaskThreadLink, Thread
from app.schemas.minutes import ProposedEntry, ProposedMinutesTask, ProposedThread
from app.services import minutes as minutes_service
from app.services import minutes_draft
from app.services import task as task_service
from app.services.ratelimit import RateLimiter
from app.time import today_kst
from scripts.seed import MINUTES_EXAMPLE, seed
from tests.conftest import AsMember
from tests.test_chat import FakeClient, Turn, parse_sse, tool_results, use
from tests.test_contract_types import MINUTES_SHAPES

APPLY = "/api/minutes/m1/apply"
DRAFT_URL = "/api/minutes/m1/draft"
BOARD = "/api/projects/p1/minutes"


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    # 챗봇과 같은 제한기다 — 앞 검사의 요청이 뒤로 넘어오지 않게
    chat_api.get_rate_limiter().reset()


def new_thread(temp_id: str, title: str, **extra: Any) -> dict[str, Any]:
    return {
        "tempId": temp_id,
        "title": title,
        "description": "",
        "options": [],
        "ownerId": None,
        "ownerHint": "",
        "dueDate": None,
        "entry": None,
        "quote": "",
    } | extra


def body(kind: str, text: str, **extra: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "text": text,
        "detail": [],
        "note": "",
        "ownerId": None,
        "ownerHint": "",
    } | extra


def old_entry(temp_id: str, thread_id: str, kind: str, text: str, **extra: Any) -> dict[str, Any]:
    return body(kind, text) | {"tempId": temp_id, "threadId": thread_id, "quote": ""} | extra


def task(temp_id: str, title: str, **extra: Any) -> dict[str, Any]:
    return {
        "tempId": temp_id,
        "relatedId": None,
        "title": title,
        "ownerId": None,
        "start": None,
        "due": None,
        "priority": "normal",
        "ownerHint": "",
        "threadTempIds": [],
        "threadIds": [],
        "quote": "",
    } | extra


def minutes(
    threads: list[dict[str, Any]] | None = None,
    entries: list[dict[str, Any]] | None = None,
    tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {"threads": threads or [], "entries": entries or [], "tasks": tasks or []}


FULL = minutes(
    threads=[
        new_thread(
            "n1",
            "  운영 DB 백업 보관 기간  ",
            description="감사 대응 때문에 보관 기간을 정해야 한다",
            options=["30일", "  ", "90일"],
            ownerId="u3",
            dueDate="2026-10-30",
            entry=body(
                "defer", "보관 기간 결정을 미룸", note="보안팀 의견 대기", ownerHint="김 책임"
            ),
            quote="백업 보관 기간은 보안팀 의견 듣고 다시 보자",
        ),
        new_thread("n2", "개발 서버 접근 권한 범위", ownerHint="박 선임"),
    ],
    entries=[
        old_entry("e1", "t4", "refine", "주 1회 전체 백업으로 좁힘", detail=["일요일 새벽", ""]),
        old_entry("e2", "t7", "decide", "검색 tool 부터 만든다", ownerId="u2"),
    ],
    tasks=[
        task("t1", "백업 스크립트 작성", ownerId="u3", threadTempIds=["n1"], threadIds=["t4"]),
        task("t2", "보존 기간 비교표", due="2026-10-24"),
        task("t3", "환경 설정 남은 일 정리", relatedId="k4", ownerHint="누군가"),
    ],
)


async def count(session: AsyncSession, model: type[Any]) -> int:
    return (await session.scalar(select(func.count()).select_from(model))) or 0


async def counts(session: AsyncSession) -> tuple[int, int, int, int]:
    return (
        await count(session, Thread),
        await count(session, Entry),
        await count(session, Task),
        await count(session, TaskThreadLink),
    )


# --- apply · 정상 --------------------------------------------------------------


async def test_apply_creates_in_order(client: httpx.AsyncClient, session: AsyncSession) -> None:
    before = await counts(session)
    res = await client.post(APPLY, json=FULL)
    assert res.status_code == 201, res.text
    out = res.json()
    assert set(out) == MINUTES_SHAPES["MinutesApplyResult"]

    # 새 안건 — 요청 순서, 제목은 앞뒤 공백을 떼고, 후보의 빈 줄은 뺀다. 파트는 공통 · 참조 없음
    n1, n2 = out["threads"]
    assert out["threadIdByTempId"] == {"n1": n1["id"], "n2": n2["id"]}
    assert n1["title"] == "운영 DB 백업 보관 기간"
    assert n1["options"] == ["30일", "90일"]
    assert n1["ownerId"] == "u3" and n1["dueDate"] == "2026-10-30"
    assert n1["partId"] is None and n1["ccIds"] == [] and n1["projectId"] == "p1"
    # 미룸 이력이 붙어 queued → open, 이력 없는 새 안건은 등록만 된 상태
    assert n1["state"] == "open"
    assert n2["state"] == "queued" and n2["ownerId"] is None

    # 이력 — 새 안건 것 먼저, 그다음 기존 안건 것. createdAt 은 지금(Z · 초까지)
    entries = out["entries"]
    assert [(e["threadId"], e["kind"]) for e in entries] == [
        (n1["id"], "defer"),
        ("t4", "refine"),
        ("t7", "decide"),
    ]
    assert entries[0]["note"] == "보안팀 의견 대기"
    assert entries[1]["detail"] == ["일요일 새벽"]
    assert entries[2]["ownerId"] == "u2"
    assert all(e["createdAt"].endswith("Z") and len(e["createdAt"]) == 20 for e in entries)

    # 이력 때문에 바뀐 기존 안건 — t4 는 queued → open, t7 은 decided 에 담당자가 그 사람으로
    updated = {t["id"]: t for t in out["updatedThreads"]}
    assert set(updated) == {"t4", "t7"}
    assert updated["t4"]["state"] == "open"
    assert updated["t7"]["state"] == "decided" and updated["t7"]["ownerId"] == "u2"

    # 작업 — 배열 순서대로 발번(p1 은 HW-22 까지 썼다), todo · 본문 [] · relatedId 는 연관 한 줄
    tasks = out["tasks"]
    ids = out["taskIdByTempId"]
    assert [t["key"] for t in tasks] == ["HW-23", "HW-24", "HW-25"]
    assert ids == {"t1": tasks[0]["id"], "t2": tasks[1]["id"], "t3": tasks[2]["id"]}
    assert [t["relatedIds"] for t in tasks] == [[], [], ["k4"]]
    assert all(t["status"] == "todo" and t["body"] == [] for t in tasks)
    assert tasks[1]["due"] == "2026-10-24"
    # 파트는 늘 공통 — 연관 작업(k4 는 인프라)을 따르지 않는다 (Q61)
    assert [t["partId"] for t in tasks] == [None, None, None]

    # 링크 — 새 안건(tempId) · 기존 안건(id) 둘 다
    assert out["links"] == [
        {"taskId": ids["t1"], "threadId": n1["id"]},
        {"taskId": ids["t1"], "threadId": "t4"},
    ]

    # 출처 — 만든 안건 · 이력(새 · 기존 안건 모두) · 작업에 그 회의록. 기존 안건 자체에는 안 붙는다
    assert all(row["minutesId"] == "m1" for row in [*out["threads"], *entries, *tasks])
    assert all(t["minutesId"] is None for t in out["updatedThreads"])

    after = await counts(session)
    assert [a - b for a, b in zip(after, before, strict=True)] == [2, 3, 3, 2]
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    state = {t["id"]: t["state"] for t in snap["threads"]}
    assert state["t4"] == "open" and state[n1["id"]] == "open"
    assert {"taskId": ids["t1"], "threadId": n1["id"]} in snap["taskThreadLinks"]
    # 스냅샷에도 실린다
    sourced = {
        row["id"]
        for key in ("threads", "entries", "tasks")
        for row in snap[key]
        if row["minutesId"] == "m1"
    }
    assert sourced == {row["id"] for row in [*out["threads"], *entries, *tasks]}


async def test_apply_drops_quote_and_owner_hint(client: httpx.AsyncClient) -> None:
    """quote · ownerHint 는 실어 와도 버린다 — 남길 칸이 없다."""
    res = await client.post(APPLY, json=FULL)
    out = res.json()
    text = json.dumps(out, ensure_ascii=False)
    assert "보안팀 의견 듣고" not in text and "김 책임" not in text
    assert "quote" not in out["threads"][0]


async def test_apply_without_quote_and_hint_keys(client: httpx.AsyncClient) -> None:
    payload = minutes(
        threads=[{"tempId": "n1", "title": "안건만"}],
        entries=[{"tempId": "e1", "threadId": "t8", "kind": "defer", "text": "미룸"}],
        tasks=[{"tempId": "t1", "title": "할 일", "threadTempIds": ["n1"]}],
    )
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 201, res.text


@pytest.mark.parametrize(
    "payload",
    [
        minutes(tasks=[task("t1", "작업만")]),
        minutes(entries=[old_entry("e1", "t9", "decide", "공통 코드는 3자리")]),
        minutes(threads=[new_thread("n1", "안건만")]),
    ],
    ids=["tasks", "entries", "threads"],
)
async def test_apply_one_kind_only(client: httpx.AsyncClient, payload: dict[str, Any]) -> None:
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 201, res.text


async def test_decided_thread_stays_decided_on_defer(client: httpx.AsyncClient) -> None:
    """한 번 정해진 것은 미룸 한 줄로 되돌아가지 않는다 — POST .../entries 와 같은 규칙."""
    res = await client.post(APPLY, json=minutes(entries=[old_entry("e1", "t1", "defer", "재검토")]))
    assert res.status_code == 201
    assert res.json()["updatedThreads"] == []


async def test_new_thread_decided_in_meeting(client: httpx.AsyncClient) -> None:
    entry = body("decide", "록키로 간다", ownerId="u1")
    res = await client.post(APPLY, json=minutes(threads=[new_thread("n1", "OS", entry=entry)]))
    (thread,) = res.json()["threads"]
    # decide 는 decided, 담당자를 적었으면 안건 담당자도 그 사람으로
    assert thread["state"] == "decided" and thread["ownerId"] == "u1"


async def test_limits_are_inclusive(client: httpx.AsyncClient) -> None:
    payload = minutes(
        threads=[new_thread(f"n{i}", "안건") for i in range(20)],
        entries=[
            old_entry(f"e{i}", thread_id, "refine", "세부")
            for i, thread_id in enumerate(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"])
        ],
        tasks=[task(f"t{i}", "할 일") for i in range(30)],
    )
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 201, res.text
    assert len(res.json()["tasks"]) == 30


# --- apply · 오류 --------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        (minutes(), "요청"),
        (minutes(threads=[new_thread(f"n{i}", "안건") for i in range(21)]), "threads"),
        (minutes(tasks=[task(f"t{i}", "할 일") for i in range(31)]), "tasks"),
        (minutes(threads=[new_thread("n1", "   ")]), "threads.0.title"),
        (
            minutes(threads=[new_thread("n1", "가", entry=body("defer", " "))]),
            "threads.0.entry.text",
        ),
        (minutes(entries=[old_entry("e1", "t4", "refine", "")]), "entries.0.text"),
        (
            minutes(
                entries=[
                    old_entry("e1", "t4", "refine", "가"),
                    old_entry("e2", "t4", "defer", "나"),
                ]
            ),
            "entries.1.threadId",
        ),
        # tempId 는 세 묶음 전체에서 서로 다르다
        (
            minutes(threads=[new_thread("x", "가")], entries=[old_entry("x", "t4", "defer", "나")]),
            "entries.0.tempId",
        ),
        (
            minutes(threads=[new_thread("n1", "가")], tasks=[task("n1", "나")]),
            "tasks.0.tempId",
        ),
        (minutes(tasks=[task("t1", "가", threadTempIds=["n9"])]), "tasks.0.threadTempIds.0"),
        (minutes(tasks=[task("t1", "가", start="2026-10-20", due="2026-10-19")]), "tasks.0.due"),
        # 타입 오류도 자리를 짚는다 — change · split 은 받지 않는다
        (minutes(entries=[old_entry("e1", "t4", "change", "가")]), "entries.0.kind"),
        (
            minutes(threads=[new_thread("n1", "가", entry=body("split", "나"))]),
            "threads.0.entry.kind",
        ),
        (minutes(threads=[new_thread("n1", "가", dueDate="다음 주")]), "threads.0.dueDate"),
    ],
)
async def test_rule_violation_is_422_with_position(
    client: httpx.AsyncClient, session: AsyncSession, payload: dict[str, Any], field: str
) -> None:
    before = await counts(session)
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 422, res.text
    out = res.json()
    assert out["code"] == "VALIDATION_ERROR"
    assert field in out["detail"], out
    assert await counts(session) == before


@pytest.mark.parametrize(
    ("payload", "code", "field"),
    [
        # 다른 프로젝트의 안건(t10)도 없는 것과 같다
        (
            minutes(entries=[old_entry("e1", "t10", "decide", "가")]),
            "THREAD_NOT_FOUND",
            "entries.0.threadId",
        ),
        (
            minutes(tasks=[task("t1", "가", threadIds=["t4", "없음"])]),
            "THREAD_NOT_FOUND",
            "tasks.0.threadIds.1",
        ),
        (
            minutes(threads=[new_thread("n1", "가", ownerId="없음")]),
            "THREAD_OWNER_NOT_FOUND",
            "threads.0.ownerId",
        ),
        (
            minutes(threads=[new_thread("n1", "가", entry=body("decide", "나", ownerId="없음"))]),
            "ENTRY_OWNER_NOT_FOUND",
            "threads.0.entry.ownerId",
        ),
        (
            minutes(entries=[old_entry("e1", "t4", "decide", "가", ownerId="없음")]),
            "ENTRY_OWNER_NOT_FOUND",
            "entries.0.ownerId",
        ),
        (
            minutes(tasks=[task("t1", "가", ownerId="없음")]),
            "TASK_OWNER_NOT_FOUND",
            "tasks.0.ownerId",
        ),
        (
            minutes(tasks=[task("t1", "가", relatedId="x1")]),
            "TASK_RELATED_NOT_FOUND",
            "tasks.0.relatedId",
        ),
    ],
)
async def test_reference_errors_are_400_and_leave_nothing(
    client: httpx.AsyncClient,
    session: AsyncSession,
    payload: dict[str, Any],
    code: str,
    field: str,
) -> None:
    # 맞는 줄을 같이 실어도 아무것도 안 남는다
    payload = {
        "threads": [new_thread("n0", "맞는 안건"), *payload["threads"]],
        "entries": payload["entries"],
        "tasks": [task("t0", "맞는 작업"), *payload["tasks"]],
    }
    field = field.replace("threads.0", "threads.1").replace("tasks.0", "tasks.1")
    before = await counts(session)
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 400, res.text
    out = res.json()
    assert out["code"] == code
    assert list(out["detail"]) == [field]
    assert await counts(session) == before


async def test_failure_midway_leaves_nothing(
    client: httpx.AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """두 번째 작업을 넣다 터져도 안건 · 이력 · 상태 · 올려 둔 번호까지 되돌린다."""
    real = task_service._insert_task
    calls = 0

    async def broken(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("두 번째에서 터진다")
        return await real(*args, **kwargs)

    before = await counts(session)
    monkeypatch.setattr(task_service, "_insert_task", broken)
    with pytest.raises(RuntimeError):
        await client.post(APPLY, json=FULL)
    monkeypatch.undo()

    assert calls == 2
    assert await counts(session) == before
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {t["id"]: t["state"] for t in snap["threads"]}["t4"] == "queued"
    res = await client.post(APPLY, json=minutes(tasks=[task("t1", "다시")]))
    assert res.json()["tasks"][0]["key"] == "HW-23"


async def test_entry_may_keep_the_current_thread_owner(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """안건 담당자를 그대로 적는 이력은 새로 지정하는 것이 아니다 — POST .../entries 와 같다."""
    session.add(Member(id="u9", name="떠난 사람", email=None))
    await session.flush()
    await session.execute(update(Thread).where(Thread.id == "t9").values(owner_id="u9"))
    await session.commit()

    ok = minutes(entries=[old_entry("e1", "t9", "decide", "3자리", ownerId="u9")])
    assert (await client.post(APPLY, json=ok)).status_code == 201
    bad = minutes(entries=[old_entry("e1", "t8", "decide", "가", ownerId="u9")])
    res = await client.post(APPLY, json=bad)
    assert res.status_code == 400 and res.json()["code"] == "ENTRY_OWNER_NOT_FOUND"


async def test_unknown_minutes_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/minutes/없음/apply", json=FULL)
    assert res.status_code == 404
    assert res.json()["code"] == "MINUTES_NOT_FOUND"


async def test_old_project_paths_are_gone(client: httpx.AsyncClient) -> None:
    """붙여넣은 글을 바로 정리하던 프로젝트 경로는 걷었다 (Q48)."""
    res = await client.post("/api/projects/p1/minutes/apply", json=FULL)
    assert res.status_code in (404, 405)
    res = await client.post("/api/projects/p1/minutes/draft", json={"text": "회의"})
    assert res.status_code in (404, 405)


async def test_apply_saves_summary_but_not_updated_at(client: httpx.AsyncClient) -> None:
    before = (await client.get("/api/minutes/m1")).json()
    res = await client.post(APPLY, json=FULL | {"summary": "  백업 보관 기간은 미뤘다.  "})
    assert res.status_code == 201, res.text
    after = (await client.get("/api/minutes/m1")).json()
    assert after["summary"] == "백업 보관 기간은 미뤘다."
    # '고친 시각' 은 사람이 글을 고친 때다 — 등록은 바꾸지 않는다
    assert after["updatedAt"] == before["updatedAt"]
    assert after["body"] == before["body"]


@pytest.mark.parametrize("extra", [{}, {"summary": None}], ids=["missing", "null"])
async def test_apply_without_summary_keeps_it(
    client: httpx.AsyncClient, extra: dict[str, Any]
) -> None:
    await client.post(APPLY, json=minutes(tasks=[task("t1", "가")]) | {"summary": "첫 요약"})
    res = await client.post(APPLY, json=minutes(tasks=[task("t1", "나")]) | extra)
    assert res.status_code == 201, res.text
    assert (await client.get("/api/minutes/m1")).json()["summary"] == "첫 요약"


async def test_failed_apply_keeps_summary(client: httpx.AsyncClient) -> None:
    bad = minutes(tasks=[task("t1", "가", ownerId="없음")]) | {"summary": "남으면 안 된다"}
    assert (await client.post(APPLY, json=bad)).status_code == 400
    assert (await client.get("/api/minutes/m1")).json()["summary"] == ""


async def test_apply_uses_the_minutes_project(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """p2 의 회의록에서 등록하면 p2 에 선다 — p1 의 안건은 없는 것과 같다."""
    made = await client.post(
        "/api/projects/p2/minutes", json={"title": "PAS 회의", "body": "회의 내용"}
    )
    other = made.json()["id"]
    res = await client.post(
        f"/api/minutes/{other}/apply", json=minutes(tasks=[task("t1", "할 일")])
    )
    assert res.status_code == 201, res.text
    (made_task,) = res.json()["tasks"]
    assert made_task["projectId"] == "p2" and made_task["key"] == "PAS-3"
    assert made_task["minutesId"] == other
    res = await client.post(
        f"/api/minutes/{other}/apply",
        json=minutes(entries=[old_entry("e1", "t4", "defer", "가")]),
    )
    assert res.status_code == 400 and res.json()["code"] == "THREAD_NOT_FOUND"


async def test_apply_needs_login(anon: httpx.AsyncClient) -> None:
    assert (await anon.post(APPLY, json=FULL)).status_code == 401


# --- 검사 함수 -----------------------------------------------------------------


def rows(payload: dict[str, Any]) -> minutes_service.Rows:
    return minutes_service.normalize(
        [ProposedThread.model_validate(t) for t in payload["threads"]],
        [ProposedEntry.model_validate(e) for e in payload["entries"]],
        [ProposedMinutesTask.model_validate(t) for t in payload["tasks"]],
    )


def test_normalize_trims_and_drops_blank_lines() -> None:
    threads, entries, tasks = rows(FULL)
    assert threads[0].title == "운영 DB 백업 보관 기간"
    assert threads[0].options == ["30일", "90일"]
    # 담당자를 정했으면 부른 말은 비운다 — ownerHint 는 ownerId 가 null 일 때만
    assert threads[0].owner_hint == ""
    assert threads[0].entry is not None and threads[0].entry.owner_hint == "김 책임"
    assert threads[1].owner_hint == "박 선임"
    assert entries[0].detail == ["일요일 새벽"]
    assert tasks[2].owner_hint == "누군가"


def test_shape_problems_points_every_place() -> None:
    bad = minutes(
        threads=[new_thread("n1", " "), new_thread("n1", "가")],
        entries=[old_entry("e1", "t4", "defer", ""), old_entry("e2", "t4", "defer", "나")],
        tasks=[task("t1", "가", threadTempIds=["n1", "n7"])],
    )
    assert minutes_service.shape_problems(*rows(bad)) == {
        "threads.0.title": "제목을 입력해 주세요.",
        "threads.1.tempId": "초안의 다른 줄과 tempId 가 겹칩니다.",
        "entries.0.text": "내용을 입력해 주세요.",
        "entries.1.threadId": "한 안건에 이력은 하나까지입니다.",
        "tasks.0.threadTempIds.1": "이 초안에 없는 새 안건입니다.",
    }
    assert minutes_service.shape_problems(*rows(FULL)) == {}


async def test_minutes_problems_in_order(session: AsyncSession) -> None:
    """등록은 첫 것을, 초안 도구는 전부를 쓴다 — 422 → 없는 안건 → 담당자 → 연관 작업."""
    await seed(session)
    bad = minutes(
        threads=[
            new_thread("n1", "", ownerId="없음", entry=body("defer", "가", ownerId="없는 사람"))
        ],
        entries=[
            old_entry("e1", "t10", "defer", "가"),
            old_entry("e2", "t4", "defer", "나", ownerId="없음"),
        ],
        tasks=[task("t1", "가", ownerId="없음", relatedId="없음", threadIds=["없음"])],
    )
    found = await minutes_service.minutes_problems(session, "p1", *rows(bad))
    assert [(e.status_code, e.code) for e in found] == [
        (422, "VALIDATION_ERROR"),
        (400, "THREAD_NOT_FOUND"),
        (400, "THREAD_OWNER_NOT_FOUND"),
        (400, "ENTRY_OWNER_NOT_FOUND"),
        (400, "TASK_OWNER_NOT_FOUND"),
        (400, "TASK_RELATED_NOT_FOUND"),
    ]
    assert found[1].detail == {
        "entries.0.threadId": "안건을 찾을 수 없습니다.",
        "tasks.0.threadIds.0": "안건을 찾을 수 없습니다.",
    }
    assert found[3].detail is not None
    assert set(found[3].detail) == {"threads.0.entry.ownerId", "entries.1.ownerId"}
    assert await minutes_service.minutes_problems(session, "p1", *rows(FULL)) == []


# --- 게시판 --------------------------------------------------------------------

MINUTES_ITEM = {"id", "projectId", "title", "meetingDate", "authorId", "createdAt", "updatedAt"}
MINUTES_FULL = MINUTES_ITEM | {"body", "summary"}


async def test_seeded_minutes(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/minutes/m1")
    assert res.status_code == 200
    out = res.json()
    assert set(out) == MINUTES_FULL
    assert out["projectId"] == "p1" and out["authorId"] == "u1"
    assert out["title"] == "10월 셋째 주 주간 회의" and out["meetingDate"] == "2026-10-16"
    assert out["body"] == MINUTES_EXAMPLE and out["summary"] == ""
    assert out["createdAt"].endswith("Z") and len(out["createdAt"]) == 20
    # 출처를 단 줄은 없다
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert all(
        row["minutesId"] is None for key in ("threads", "entries", "tasks") for row in snap[key]
    )


async def test_create_and_read(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    res = await u2.post(
        BOARD,
        json={
            "title": "  기간계 연동 회의  ",
            "meetingDate": "2026-10-19",
            "body": "\n  1. 마스킹 기준\n  - 다음 주에 다시\n\n",
            # 작성자는 로그인한 사람이다 — 실어 와도 버린다
            "authorId": "u1",
        },
    )
    assert res.status_code == 201, res.text
    out = res.json()
    assert set(out) == MINUTES_FULL
    assert out["title"] == "기간계 연동 회의"
    # 앞뒤 공백만 뗀다 — 안쪽 줄 · 들여쓰기는 글 그대로
    assert out["body"] == "1. 마스킹 기준\n  - 다음 주에 다시"
    assert out["authorId"] == "u2" and out["summary"] == "" and out["projectId"] == "p1"
    assert out["createdAt"] == out["updatedAt"]
    assert (await u2.get(f"/api/minutes/{out['id']}")).json() == out


async def test_create_without_meeting_date(client: httpx.AsyncClient) -> None:
    res = await client.post(BOARD, json={"title": "날짜 없음", "body": "글"})
    assert res.status_code == 201, res.text
    assert res.json()["meetingDate"] is None


async def test_list_order_and_shape(client: httpx.AsyncClient) -> None:
    """회의 날짜 내림차순(없으면 맨 뒤) → 같은 날은 나중에 쓴 것 먼저. 본문 · 요약 없이."""

    async def write(title: str, meeting_date: str | None) -> str:
        res = await client.post(
            BOARD, json={"title": title, "meetingDate": meeting_date, "body": "글"}
        )
        assert res.status_code == 201, res.text
        made: str = res.json()["id"]
        return made

    no_date_old = await write("날짜 없음 1", None)
    early = await write("10월 2일", "2026-10-02")
    same_day = await write("10월 16일 둘째", "2026-10-16")
    late = await write("10월 19일", "2026-10-19")
    no_date_new = await write("날짜 없음 2", None)

    rows = (await client.get(BOARD)).json()
    assert [row["id"] for row in rows] == [late, same_day, "m1", early, no_date_new, no_date_old]
    assert all(set(row) == MINUTES_ITEM for row in rows)
    # 다른 프로젝트의 것은 안 실린다
    assert (await client.get("/api/projects/p2/minutes")).json() == []


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"title": "   ", "body": "글"}, "title"),
        ({"title": "가" * 201, "body": "글"}, "title"),
        ({"body": "글"}, "title"),
        ({"title": "제목", "body": " \n "}, "body"),
        ({"title": "제목", "body": "가" * 60001}, "body"),
        ({"title": "제목"}, "body"),
        ({"title": "제목", "body": "글", "meetingDate": "10월 16일"}, "meetingDate"),
        ({"title": "제목", "body": "글", "meetingDate": "2026-13-01"}, "meetingDate"),
    ],
)
async def test_create_validation(
    client: httpx.AsyncClient, payload: dict[str, Any], field: str
) -> None:
    res = await client.post(BOARD, json=payload)
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "VALIDATION_ERROR"
    assert field in res.json()["detail"]


async def test_limits_count_after_trim(client: httpx.AsyncClient) -> None:
    payload = {"title": " " + "가" * 200 + " ", "body": "  " + "가" * 60000 + "\n"}
    res = await client.post(BOARD, json=payload)
    assert res.status_code == 201, res.text
    assert len(res.json()["title"]) == 200 and len(res.json()["body"]) == 60000


async def test_author_edits_only_what_was_sent(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    before = (await u1.get("/api/minutes/m1")).json()
    res = await u1.patch("/api/minutes/m1", json={"title": " 고친 제목 "})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["title"] == "고친 제목"
    assert out["body"] == before["body"] and out["meetingDate"] == "2026-10-16"
    assert out["createdAt"] == before["createdAt"]
    assert out["updatedAt"] > before["updatedAt"]

    # null 로 보내면 회의 날짜를 비운다
    res = await u1.patch("/api/minutes/m1", json={"meetingDate": None, "body": "새 본문"})
    assert res.json()["meetingDate"] is None and res.json()["body"] == "새 본문"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"title": None}, "title"),
        ({"body": None}, "body"),
        ({"title": ""}, "title"),
        ({"body": "가" * 60001}, "body"),
        ({"meetingDate": "어제"}, "meetingDate"),
    ],
)
async def test_edit_validation(as_member: AsMember, payload: dict[str, Any], field: str) -> None:
    res = await (await as_member("u1")).patch("/api/minutes/m1", json=payload)
    assert res.status_code == 422, res.text
    assert field in res.json()["detail"]


async def test_only_the_author_edits(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """m1 은 u1 이 썼다. 프로젝트 관리자 · 시스템 관리자도 남의 회의록을 고쳐 쓰지 못한다."""
    made = await (await as_member("u2")).post(BOARD, json={"title": "u2 의 회의록", "body": "글"})
    theirs = made.json()["id"]
    for who, url in (("u3", "/api/minutes/m1"), ("u1", f"/api/minutes/{theirs}")):
        res = await (await as_member(who)).patch(url, json={"title": "남의 것"})
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"
    res = await client.patch("/api/minutes/m1", json={"title": "관리자"})
    assert res.status_code == 403
    assert (await client.get("/api/minutes/m1")).json()["title"] == "10월 셋째 주 주간 회의"


async def test_who_can_delete(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자."""
    u2, u3 = await as_member("u2"), await as_member("u3")

    async def write(who: httpx.AsyncClient) -> str:
        res = await who.post(BOARD, json={"title": "지울 회의록", "body": "글"})
        made: str = res.json()["id"]
        return made

    denied = await u3.delete("/api/minutes/m1")
    assert denied.status_code == 403 and denied.json()["code"] == "FORBIDDEN"

    mine = await write(u2)
    assert (await u3.delete(f"/api/minutes/{mine}")).status_code == 403
    assert (await u2.delete(f"/api/minutes/{mine}")).status_code == 204  # 작성자
    assert (await u2.get(f"/api/minutes/{mine}")).status_code == 404

    by_admin = await write(u2)
    u1 = await as_member("u1")  # p1 관리자
    assert (await u1.delete(f"/api/minutes/{by_admin}")).status_code == 204

    by_system = await write(u3)
    assert (await client.delete(f"/api/minutes/{by_system}")).status_code == 204

    # p2 에서 u1 은 user 다 — 거기서는 남의 것을 못 지운다
    other = await u2.post("/api/projects/p2/minutes", json={"title": "PAS", "body": "글"})
    res = await u1.delete(f"/api/minutes/{other.json()['id']}")
    assert res.status_code == 403


async def test_delete_keeps_what_came_out(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """지우면 회의록만 없어지고, 나온 안건 · 이력 · 작업은 남아 출처만 빈다."""
    out = (await client.post(APPLY, json=FULL)).json()
    made = {row["id"] for key in ("threads", "entries", "tasks") for row in out[key]}
    before = await counts(session)

    res = await (await as_member("u1")).delete("/api/minutes/m1")
    assert res.status_code == 204
    assert await counts(session) == before
    assert await count(session, Minutes) == 0

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    rows = {row["id"]: row for key in ("threads", "entries", "tasks") for row in snap[key]}
    assert made <= set(rows)
    assert all(rows[row_id]["minutesId"] is None for row_id in made)

    res = await client.get("/api/minutes/m1")
    assert res.status_code == 404 and res.json()["code"] == "MINUTES_NOT_FOUND"


async def test_ungranted_project_minutes_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """부여받지 않은 프로젝트의 회의록은 없는 것과 같다 — 읽기 · 고치기 · 지우기 · 정리 · 등록."""
    assert (await client.delete("/api/projects/p1/members/u1")).status_code == 204
    u1 = await as_member("u1")
    for method, url, body in (
        ("GET", "/api/minutes/m1", None),
        ("PATCH", "/api/minutes/m1", {"title": "가"}),
        ("DELETE", "/api/minutes/m1", None),
        ("POST", "/api/minutes/m1/draft", None),
        ("POST", APPLY, FULL),
    ):
        res = await u1.request(method, url, json=body)
        assert res.status_code == 404, (method, url)
        assert res.json()["code"] == "MINUTES_NOT_FOUND"
    for method in ("GET", "POST"):
        res = await u1.request(method, BOARD, json={"title": "가", "body": "나"})
        assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_board_needs_login(anon: httpx.AsyncClient) -> None:
    assert (await anon.get(BOARD)).status_code == 401
    assert (await anon.get("/api/minutes/m1")).status_code == 401


async def test_hand_made_rows_have_no_source(client: httpx.AsyncClient) -> None:
    """손으로 만든 안건 · 이력 · 작업은 null 이다."""
    thread = (await client.post("/api/projects/p1/threads", json={"title": "손으로"})).json()
    added = await client.post(
        f"/api/threads/{thread['id']}/entries", json={"kind": "defer", "text": "미룸"}
    )
    made = (await client.post("/api/projects/p1/tasks", json={"title": "손으로"})).json()
    assert thread["minutesId"] is None and made["minutesId"] is None
    assert added.json()["entry"]["minutesId"] is None


# --- draft ---------------------------------------------------------------------

TEXT = """\
2026-10-17 주간 회의
- 백업 보관 기간은 보안팀 의견 듣고 다시 보자 (김 책임)
- 가상비서 tool 은 검색 tool 부터 만든다. 박지훈 담당
"""

PROPOSED: dict[str, Any] = {
    "meeting_date": "2026-10-17",
    "summary": "백업 보관 기간은 미뤘고, 가상비서는 검색 tool 부터 만들기로 했다.",
    "threads": [
        {
            "temp_id": "n1",
            "title": " 운영 DB 백업 보관 기간 ",
            "description": "",
            "options": [],
            "owner_id": None,
            "owner_hint": "김 책임",
            "due_date": None,
            "entry": {
                "kind": "defer",
                "text": "보관 기간 결정을 미룸",
                "detail": [],
                "note": "보안팀 의견 대기",
                "owner_id": None,
                "owner_hint": "김 책임",
            },
            "quote": "백업 보관 기간은 보안팀 의견 듣고 다시 보자",
        }
    ],
    "entries": [
        {
            "temp_id": "e1",
            "thread_id": "t7",
            "kind": "decide",
            "text": "검색 tool 부터 만든다",
            "detail": [],
            "note": "",
            "owner_id": "u2",
            "owner_hint": "박지훈",
            "quote": "가상비서 tool 은 검색 tool 부터 만든다.",
        }
    ],
    "tasks": [
        {
            "temp_id": "t1",
            "related_id": None,
            "title": "검색 tool 만들기",
            "owner_id": "u2",
            "owner_hint": "",
            "start": None,
            "due": None,
            "priority": "normal",
            "thread_temp_ids": [],
            "thread_ids": ["t7"],
            "quote": "박지훈 담당",
        }
    ],
}

EMPTY = {"meeting_date": None, "summary": "잡담", "threads": [], "entries": [], "tasks": []}


def broken_draft() -> dict[str, Any]:
    bad = json.loads(json.dumps(PROPOSED))
    bad["tasks"][0]["thread_temp_ids"] = ["n9"]
    bad["tasks"][0]["owner_id"] = "없음"
    bad["entries"][0]["thread_id"] = "t10"
    return bad


SOURCE = minutes_draft.MinutesSource(title="주간 회의", meeting_date=None, body=TEXT)


async def run(
    session: AsyncSession, fake: FakeClient, source: minutes_draft.MinutesSource = SOURCE
) -> list[Any]:
    await seed(session)
    context = await minutes_draft.build_context(session, "p1", "한화손보 차세대")
    return [
        event
        async for event in minutes_draft.draft(
            AnthropicProvider(fake, settings),  # type: ignore[arg-type]
            session,
            settings,
            context,
            source,
            today=today_kst(),
        )
    ]


async def test_draft_events_and_shape(client: httpx.AsyncClient, session: AsyncSession) -> None:
    fake = FakeClient(
        Turn(tools=[("get_thread", {"thread_id": "t7"}), ("list_members", {})]),
        Turn(tools=[("propose_minutes", PROPOSED)]),
    )
    use(fake)
    before = await counts(session)
    # 본문 없이 부른다 — 저장된 회의록을 읽는다
    res = await client.post(DRAFT_URL)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(res.text)

    assert [name for name, _ in events] == ["tool", "tool", "tool", "draft", "done"]
    assert all(data["type"] == name for name, data in events)
    assert [data["label"] for _, data in events[:3]] == [
        "안건 이력 읽는 중",
        "멤버 확인 중",
        "초안 만드는 중",
    ]
    assert events[2][1]["name"] == "propose_minutes"
    assert events[4][1] == {"type": "done"}

    draft = events[3][1]["draft"]
    assert set(draft) == MINUTES_SHAPES["MinutesDraft"]
    assert set(draft["threads"][0]) == MINUTES_SHAPES["ProposedThread"]
    assert set(draft["threads"][0]["entry"]) == MINUTES_SHAPES["ProposedEntryBody"]
    assert set(draft["entries"][0]) == MINUTES_SHAPES["ProposedEntry"]
    assert set(draft["tasks"][0]) == MINUTES_SHAPES["ProposedMinutesTask"]
    # 회의록에 회의 날짜(2026-10-16)가 있으면 그것이다 — Claude 가 본문에서 다르게 읽어도
    assert draft["meetingDate"] == "2026-10-16"
    # 검사 전에 다듬은 모양으로 낸다 — 제목 공백, 담당자를 정한 줄의 부른 말
    assert draft["threads"][0]["title"] == "운영 DB 백업 보관 기간"
    assert draft["threads"][0]["ownerHint"] == "김 책임"
    assert draft["entries"][0]["ownerHint"] == ""
    assert draft["tasks"][0]["threadIds"] == ["t7"]

    # 저장된 제목 · 회의 날짜 · 본문이 사용자 메시지 하나로 간다. 본문은 글자 그대로
    first = fake.calls[0]["messages"][0]
    assert first["role"] == "user"
    assert first["content"][0]["text"] == (
        f"제목: 10월 셋째 주 주간 회의\n회의 날짜: 2026-10-16\n\n{MINUTES_EXAMPLE}"
    )
    # 날짜 기준도 그 날이다
    assert "회의 날짜는 2026-10-16 (금) 로 정해져 있다" in fake.calls[0]["system"]
    # 저장하지 않는다 — 회의록 요약도 그대로
    assert await counts(session) == before
    assert (await client.get("/api/minutes/m1")).json()["summary"] == ""


async def test_draft_reads_the_saved_body(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """고친 본문 · 날짜 없음이 다음 정리에 그대로 쓰인다 — 날짜는 Claude 가 본문에서 읽는다."""
    res = await (await as_member("u1")).patch(
        "/api/minutes/m1", json={"title": "고친 회의", "meetingDate": None, "body": TEXT}
    )
    assert res.status_code == 200, res.text
    fake = FakeClient(Turn(tools=[("propose_minutes", PROPOSED)]))
    use(fake)
    events = parse_sse((await client.post(DRAFT_URL)).text)
    assert events[-2][1]["draft"]["meetingDate"] == "2026-10-17"
    first = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert first == f"제목: 고친 회의\n회의 날짜: (적혀 있지 않음)\n\n{TEXT.strip()}"
    assert "없으면 meeting_date 는 null 로 두고 오늘을 기준으로" in fake.calls[0]["system"]


async def test_draft_request_follows_the_settings(session: AsyncSession) -> None:
    fake = FakeClient(Turn(tools=[("propose_minutes", PROPOSED)]))
    await run(session, fake)
    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.minutes_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["tool_choice"] == {"type": "auto"}
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert {tool["name"] for tool in call["tools"]} == {
        "search_threads",
        "get_thread",
        "search_tasks",
        "list_members",
        "propose_minutes",
    }


async def test_system_prompt_has_today_project_and_members(session: AsyncSession) -> None:
    fake = FakeClient(Turn(tools=[("propose_minutes", PROPOSED)]))
    await run(session, fake)
    system = fake.calls[0]["system"]
    today = today_kst()
    assert f"오늘은 {today.isoformat()} ({'월화수목금토일'[today.weekday()]})" in system
    assert "'한화손보 차세대'" in system
    # 담당자 후보만 — 부여 없는 시스템 관리자는 빠진다. 파트가 없으면 그렇다고
    assert "- u1 · 김서연 · AI" in system
    assert "- u2 · 박지훈 · 기간계 연동" in system
    assert "- u3 · 이도현 · 인프라" in system
    assert "admin" not in system
    assert "search_threads 로 **이미 있는지 먼저 본다**" in system


async def test_bad_draft_goes_back_then_fixed(session: AsyncSession) -> None:
    fake = FakeClient(
        Turn(tools=[("propose_minutes", broken_draft())]),
        Turn(tools=[("propose_minutes", PROPOSED)]),
    )
    events = await run(session, fake)
    assert [e.type for e in events] == ["tool", "tool", "draft", "done"]

    (result,) = tool_results(fake.calls[1])
    assert result["is_error"] is True
    # 등록과 같은 검사 — 422 · 400 자리를 한 번에 다 돌려준다. 다른 프로젝트 안건(t10)은 없는 것
    problems = json.loads(result["content"])["problems"]
    assert set(problems) == {
        "tasks.0.threadTempIds.0",
        "entries.0.threadId",
        "tasks.0.ownerId",
    }


async def test_gives_up_after_five_failures(session: AsyncSession) -> None:
    fake = FakeClient(Turn(tools=[("propose_minutes", broken_draft())]))
    events = await run(session, fake)
    assert len(fake.calls) == minutes_draft.MAX_FAILURES == 5
    assert [e.type for e in events] == ["tool"] * 5 + ["error"]
    assert events[-1].code == "MINUTES_DRAFT_FAILED"


async def test_answer_without_draft_is_nudged_then_gives_up(session: AsyncSession) -> None:
    fake = FakeClient(Turn(texts=["정리했습니다."]))
    events = await run(session, fake)
    assert [e.type for e in events] == ["error"]
    assert events[0].code == "MINUTES_DRAFT_FAILED"
    assert len(fake.calls) == 5
    assert fake.calls[1]["messages"][-1] == {"role": "user", "content": minutes_draft.NUDGE}


async def test_nothing_to_draft_is_empty(session: AsyncSession) -> None:
    fake = FakeClient(Turn(tools=[("propose_minutes", EMPTY)]))
    events = await run(session, fake)
    assert [e.type for e in events] == ["tool", "error"]
    assert events[-1].code == "MINUTES_EMPTY"
    assert events[-1].message == "회의록에서 정할 것 · 할 일을 찾지 못했습니다."


async def test_round_limit_ends_in_failure(session: AsyncSession) -> None:
    fake = FakeClient(Turn(tools=[("get_thread", {"thread_id": "t1"})]))
    events = await run(session, fake)
    assert len(fake.calls) == minutes_draft.MAX_ROUNDS
    assert events[-1].type == "error" and events[-1].code == "MINUTES_DRAFT_FAILED"
    last_user = fake.calls[-1]["messages"][-1]["content"]
    assert last_user[-1] == {"type": "text", "text": minutes_draft.WRAP_UP}


async def test_tools_stay_in_project_and_set(session: AsyncSession) -> None:
    """다른 프로젝트 안건은 못 읽고, 쥐여 주지 않은 챗봇 도구는 돌지 않는다."""
    fake = FakeClient(
        Turn(tools=[("get_thread", {"thread_id": "t10"}), ("list_tasks", {})]),
        Turn(tools=[("propose_minutes", PROPOSED)]),
    )
    events = await run(session, fake)
    # 모르는 도구는 진행 줄도 안 낸다
    assert [e.type for e in events] == ["tool", "tool", "draft", "done"]
    other, unknown = tool_results(fake.calls[1])
    assert other["is_error"] is True and "찾을 수 없습니다" in other["content"]
    assert unknown["is_error"] is True and "없는 도구" in unknown["content"]


async def test_refusal_and_truncation(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(stop_reason="refusal")))
    events = parse_sse((await client.post(DRAFT_URL)).text)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_REFUSED")]

    use(FakeClient(Turn(stop_reason="max_tokens")))
    events = parse_sse((await client.post(DRAFT_URL)).text)
    assert [(name, data["code"]) for name, data in events] == [("error", "MINUTES_DRAFT_FAILED")]


async def test_claude_rate_limit_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=error)))
    res = await client.post(DRAFT_URL)
    assert res.status_code == 200
    events = parse_sse(res.text)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_RATE_LIMITED")]
    assert set(events[0][1]) == {"type", "code", "message"}


async def test_no_key_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(DRAFT_URL)
    assert res.status_code == 503
    assert res.json()["code"] == "CHAT_UNAVAILABLE"


async def test_rate_limit_is_429(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(tools=[("propose_minutes", PROPOSED)])))
    limiter = RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter
    assert (await client.post(DRAFT_URL)).status_code == 200
    res = await client.post(DRAFT_URL)
    assert res.status_code == 429
    assert res.json()["code"] == "CHAT_RATE_LIMITED"


async def test_draft_unknown_minutes_is_404(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(tools=[("propose_minutes", PROPOSED)]))
    use(fake)
    res = await client.post("/api/minutes/없음/draft")
    assert res.status_code == 404
    assert res.json()["code"] == "MINUTES_NOT_FOUND"
    assert fake.calls == []


def test_labels() -> None:
    assert (
        minutes_draft.tool_label("search_threads", {"query": " 백업 "})
        == '"백업" 기존 안건 찾는 중'
    )
    assert minutes_draft.tool_label("propose_minutes", {}) == "초안 만드는 중"


async def test_apply_on_postgres(pg_client: httpx.AsyncClient) -> None:
    """진짜 Postgres 에서 — seq(Identity) · 복합 FK 링크 · 발번이 한 트랜잭션에 선다."""
    res = await pg_client.post(APPLY, json=FULL)
    assert res.status_code == 201, res.text
    out = res.json()
    assert [t["key"] for t in out["tasks"]] == ["HW-23", "HW-24", "HW-25"]
    snap = (await pg_client.get("/api/projects/p1/snapshot")).json()
    # 이력은 seq 순서 — 새 안건 것 먼저, 그다음 기존 안건 것
    ids = [e["id"] for e in out["entries"]]
    assert [e["id"] for e in snap["entries"] if e["id"] in ids] == ids
    links = {(link["taskId"], link["threadId"]) for link in snap["taskThreadLinks"]}
    assert {(link["taskId"], link["threadId"]) for link in out["links"]} <= links


async def test_board_on_postgres(pg_client: httpx.AsyncClient) -> None:
    """진짜 Postgres 에서 — seq(Identity) 순서 · nulls last · ON DELETE SET NULL."""
    made = []
    for meeting_date in (None, "2026-10-16", None):
        res = await pg_client.post(
            BOARD, json={"title": "회의", "meetingDate": meeting_date, "body": "글"}
        )
        assert res.status_code == 201, res.text
        made.append(res.json()["id"])
    rows = [row["id"] for row in (await pg_client.get(BOARD)).json()]
    assert rows == [made[1], "m1", made[2], made[0]]

    out = (await pg_client.post(APPLY, json=FULL)).json()
    assert (await pg_client.delete("/api/minutes/m1")).status_code == 204
    snap = (await pg_client.get("/api/projects/p1/snapshot")).json()
    ids = {row["id"] for key in ("threads", "entries", "tasks") for row in out[key]}
    left = [row for key in ("threads", "entries", "tasks") for row in snap[key] if row["id"] in ids]
    assert len(left) == len(ids) and all(row["minutesId"] is None for row in left)

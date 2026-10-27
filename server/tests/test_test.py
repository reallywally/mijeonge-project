"""테스트 1단계(AI 없이) — `docs/api/test.md`. 쓰기 · 검사 · 권한 · 상태 · 신호 · 기준 바뀜.

시드 p1 에 HW-T1 ~ T8 이 있다(계약 '시드 · 목업' 표). 오늘은 2026-10-15 로 고정한다 —
리스크 · 리포트 검사와 같은 날이다.
"""

from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, delete, event, func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import test as route
from app.models import Member, Task, TestRef, Thread
from app.models import TestCase as Case
from app.schemas.risk import RiskSettings
from app.services import test as service
from scripts.seed import SEED_TESTS
from tests.conftest import AsMember

TODAY = date(2026, 10, 15)
LIST = "/api/projects/p1/tests"

# 계약 '시드 · 목업' 표의 '나와야 할 신호'
SEED_SIGNALS = {
    "HW-T1": [],
    "HW-T2": [],
    "HW-T3": ["longRunning", "overdue"],
    "HW-T4": ["notStarted", "basisChanged"],
    "HW-T5": [],
    "HW-T6": ["longBlocked"],
    "HW-T7": ["failedIdle"],
    "HW-T8": [],
}


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(route, "today_kst", lambda: TODAY)


async def rows_by_key(c: httpx.AsyncClient, project: str = "p1") -> dict[str, dict[str, Any]]:
    res = await c.get(f"/api/projects/{project}/tests")
    assert res.status_code == 200
    return {row["key"]: row for row in res.json()}


async def one(c: httpx.AsyncClient, test_id: str) -> dict[str, Any]:
    res = await c.get(f"/api/tests/{test_id}")
    assert res.status_code == 200
    body: dict[str, Any] = res.json()
    return body


async def create(c: httpx.AsyncClient, body: dict[str, Any], project: str = "p1") -> dict[str, Any]:
    res = await c.post(f"/api/projects/{project}/tests", json=body)
    assert res.status_code == 201, res.json()
    created: dict[str, Any] = res.json()
    return created


async def add_entry(c: httpx.AsyncClient, thread: str, kind: str) -> str:
    res = await c.post(
        f"/api/threads/{thread}/entries", json={"kind": kind, "text": "다시 정했다", "note": "왜"}
    )
    assert res.status_code == 201, res.json()
    entry_id: str = res.json()["entry"]["id"]
    return entry_id


def error(res: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert res.status_code == status, res.json()
    body: dict[str, Any] = res.json()
    assert body["code"] == code
    return body


# --- 시드 · 목록 ---


async def test_seed_list_is_in_seq_order(client: httpx.AsyncClient) -> None:
    rows = (await client.get(LIST)).json()
    assert [row["key"] for row in rows] == [f"HW-T{n}" for n in range(1, 9)]
    assert [row["id"] for row in rows] == [f"tc{n}" for n in range(1, 9)]


async def test_seed_signals_match_the_contract_table(client: httpx.AsyncClient) -> None:
    rows = await rows_by_key(client)
    assert {key: row["signals"] for key, row in rows.items()} == SEED_SIGNALS


async def test_seed_status_days_and_details(client: httpx.AsyncClient) -> None:
    rows = await rows_by_key(client)
    days = {key: row["statusDays"] for key, row in rows.items()}
    assert days == {
        "HW-T1": 15,
        "HW-T2": 5,
        "HW-T3": 12,
        "HW-T4": 14,
        "HW-T5": 15,
        "HW-T6": 13,
        "HW-T7": 10,
        "HW-T8": 1,
    }
    t7 = rows["HW-T7"]
    assert t7["status"] == "fail" and t7["resultNote"]
    assert rows["HW-T6"]["resultNote"]
    assert rows["HW-T2"]["resultNote"] == ""
    assert rows["HW-T2"]["refs"] == [{"kind": "task", "id": "k4"}]
    assert rows["HW-T3"]["refs"] == [{"kind": "thread", "id": "t3"}]
    assert rows["HW-T6"]["refs"] == [{"kind": "task", "id": "k21"}]
    assert rows["HW-T4"]["changedEntryIds"] == ["e3"]
    assert all(rows[k]["changedEntryIds"] == [] for k in rows if k != "HW-T4")
    assert rows["HW-T3"]["statusChangedAt"] == "2026-10-03T03:00:00Z"
    # 지난 목적 · 사전조건 · 단계를 0020 의 모양으로 합친 글 (목업과 같다)
    assert rows["HW-T2"]["content"] == (
        "목적\n발급받은 계정으로 들어갈 수 있는지 본다.\n\n"
        "사전조건\n개발 서버가 떠 있고 계정이 발급돼 있다.\n\n"
        "단계\n1. 로그인 화면을 연다\n"
        "2. dev01 과 임시 비밀번호를 넣고 [로그인] → 대시보드가 열리고 이름이 보인다"
    )
    assert rows["HW-T8"]["content"] == (
        "단계\n1. [계정 목록 내려받기] → 모든 계정이 담긴 CSV 가 받아진다"
    )
    # 목적 · 사전조건 · 단계 · 실패한 단계는 걷었다 (Q60)
    gone = {"purpose", "precondition", "steps", "failedStep"}
    assert not any(gone & row.keys() for row in rows.values())
    assert rows["HW-T7"]["statusChangedBy"] == "u1" and rows["HW-T8"]["partId"] == "pt1"
    # 레벨은 걷었다 (2026-10-27 고침)
    assert not any("level" in row for row in rows.values())
    assert rows["HW-T2"]["parentId"] == "tc1"


async def test_other_project_has_its_own_list(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/projects/p2/tests")).json() == []


async def test_list_runs_a_fixed_number_of_queries(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """N+1 이 없다 — 테스트 · 태그가 늘어도 select 수가 같다."""
    bind = session.bind
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(args[2])

    await client.get(LIST)
    event.listen(bind.sync_engine, "before_cursor_execute", count)
    try:
        await client.get(LIST)
        before = len(statements)
        assert before > 0
        for n in range(6):
            await create(
                client,
                {
                    "title": f"더 {n}",
                    "parentId": "tc5",
                    "content": "한다",
                    "refs": [{"kind": "task", "id": "k4"}, {"kind": "thread", "id": f"t{n + 1}"}],
                },
            )
        statements.clear()
        await client.get(LIST)
        assert len(statements) == before
    finally:
        event.remove(bind.sync_engine, "before_cursor_execute", count)


# --- 만들기 · 읽기 · 고치기 ---


async def test_create_minimal(client: httpx.AsyncClient) -> None:
    body = await create(client, {"title": "  새 테스트  "})
    assert body["key"] == "HW-T9"
    assert body["title"] == "새 테스트"
    assert body["status"] == "draft"
    assert body["statusChangedBy"] == "admin" and body["createdBy"] == "admin"
    assert body["statusDays"] == 0
    assert (body["refs"], body["signals"], body["changedEntryIds"]) == ([], [], [])
    assert body["content"] == body["testData"] == body["resultNote"] == ""
    for key in ("parentId", "start", "due", "ownerId", "partId"):
        assert body[key] is None
    assert body["createdAt"].endswith("Z") and body["statusChangedAt"] == body["createdAt"]
    assert await one(client, body["id"]) == body


async def test_create_ignores_status(client: httpx.AsyncClient) -> None:
    body = await create(client, {"title": "상태를 보낸다", "status": "pass"})
    assert body["status"] == "draft"


async def test_keys_are_counted_per_project_and_never_reused(client: httpx.AsyncClient) -> None:
    first = await create(client, {"title": "하나"})
    assert first["key"] == "HW-T9"
    assert (await client.delete(f"/api/tests/{first['id']}")).status_code == 204
    assert (await create(client, {"title": "둘"}))["key"] == "HW-T10"
    assert (await create(client, {"title": "다른 프로젝트"}, "p2"))["key"] == "PAS-T1"
    assert (await create(client, {"title": "다른 프로젝트 둘"}, "p2"))["key"] == "PAS-T2"


async def test_create_full(client: httpx.AsyncClient) -> None:
    body = await create(
        client,
        {
            "title": "계정 잠금 해제",
            "parentId": "tc5",
            "content": "  관리 화면을 연다\n[잠금 해제] → 다시 로그인된다\n",
            "testData": "u2",
            # 걷은 칸 — 옛 화면이 보내도 오류 없이 버린다 (Q60)
            "purpose": "잠긴 계정을 관리자가 푼다",
            "steps": [{"action": "관리 화면을 연다"}],
            "refs": [
                {"kind": "thread", "id": "t3"},
                {"kind": "task", "id": "k21"},
                {"kind": "task", "id": "k4"},
                {"kind": "task", "id": "k4"},
            ],
            # 걷은 칸 — 옛 화면이 보내도 오류 없이 버린다
            "level": "integration",
            "start": "2026-10-16",
            "due": "2026-10-20",
            "ownerId": "u3",
        },
    )
    # 상위 테스트의 파트를 따른다
    assert body["partId"] == "pt1"
    # 글 칸은 받은 그대로 둔다 — 앞뒤 공백도
    assert body["content"] == "  관리 화면을 연다\n[잠금 해제] → 다시 로그인된다\n"
    assert not {"purpose", "steps"} & body.keys()
    # 겹친 태그는 하나로, task 먼저 → 작업 · 안건의 seq 순
    assert body["refs"] == [
        {"kind": "task", "id": "k4"},
        {"kind": "task", "id": "k21"},
        {"kind": "thread", "id": "t3"},
    ]
    assert "level" not in body
    assert (body["start"], body["due"], body["ownerId"]) == (
        "2026-10-16",
        "2026-10-20",
        "u3",
    )
    # 만들 때 기준을 찍는다 — 지금의 결정은 바뀐 것이 아니다
    assert body["changedEntryIds"] == [] and body["signals"] == []


async def test_part_null_means_common_even_under_a_parent(client: httpx.AsyncClient) -> None:
    body = await create(client, {"title": "공통", "parentId": "tc1", "partId": None})
    assert body["partId"] is None


async def test_patch_changes_only_what_was_sent(client: httpx.AsyncClient) -> None:
    res = await client.patch(
        "/api/tests/tc3",
        json={"title": " 잠금 5회 ", "level": "unit", "due": "2026-10-09", "status": "pass"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "잠금 5회"
    assert "level" not in body
    assert (body["start"], body["due"]) == ("2026-10-06", "2026-10-09")
    # 상태 · 태그는 PATCH 로 안 바뀐다
    assert body["status"] == "testing" and body["refs"] == [{"kind": "thread", "id": "t3"}]
    assert body["ownerId"] == "u2" and body["content"].startswith("목적\n")


async def test_patch_replaces_content(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tests/tc2", json={"content": "새로 쓴 내용"})
    assert res.json()["content"] == "새로 쓴 내용"
    res = await client.patch("/api/tests/tc2", json={"content": ""})
    assert res.json()["content"] == ""
    # 10,000자까지 받는다
    res = await client.patch("/api/tests/tc2", json={"content": "가" * 10000})
    assert res.status_code == 200 and len(res.json()["content"]) == 10000


async def test_patch_null_means_clear_only_where_allowed(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tests/tc3", json={"ownerId": None, "start": None})
    assert res.status_code == 200
    assert res.json()["ownerId"] is None and res.json()["start"] is None
    for key in ("title", "content", "testData"):
        res = await client.patch("/api/tests/tc3", json={key: None})
        assert error(res, 422, "VALIDATION_ERROR")["detail"].keys() == {key}


async def test_get_missing_is_404(client: httpx.AsyncClient) -> None:
    for res in (
        await client.get("/api/tests/nope"),
        await client.patch("/api/tests/nope", json={"title": "x"}),
        await client.delete("/api/tests/nope"),
        await client.post("/api/tests/nope/status", json={"status": "ready"}),
        await client.put("/api/tests/nope/refs/task/k4"),
        await client.delete("/api/tests/nope/refs/task/k4"),
        await client.post("/api/tests/nope/basis"),
    ):
        error(res, 404, "TEST_NOT_FOUND")


# --- 검사 ---


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"title": "   "}, "title"),
        ({"title": "가" * 201}, "title"),
        ({}, "title"),
        ({"title": "t", "content": "가" * 10001}, "content"),
        ({"title": "t", "testData": "가" * 4001}, "testData"),
        ({"title": "t", "start": "2026-10-20", "due": "2026-10-19"}, "due"),
        ({"title": "t", "refs": [{"kind": "label", "id": "x"}]}, "refs.0.kind"),
    ],
)
async def test_create_validation(
    client: httpx.AsyncClient, body: dict[str, Any], field: str
) -> None:
    detail = error(await client.post(LIST, json=body), 422, "VALIDATION_ERROR")["detail"]
    assert set(detail) == {field}


async def test_period_check_looks_at_the_stored_side(client: httpx.AsyncClient) -> None:
    # tc3 은 10-06 ~ 10-08 — 끝만 시작 앞으로 당기면 422, 한쪽만 있는 것은 된다
    res = await client.patch("/api/tests/tc3", json={"due": "2026-10-05"})
    assert error(res, 422, "VALIDATION_ERROR")["detail"] == {"due": "끝이 시작보다 빠릅니다."}
    res = await client.patch("/api/tests/tc3", json={"start": None, "due": "2026-10-05"})
    assert res.status_code == 200
    assert (await create(client, {"title": "끝만", "due": "2026-10-20"}))["start"] is None


async def test_parent_rules(client: httpx.AsyncClient) -> None:
    other = await create(client, {"title": "p2 의 것"}, "p2")
    for parent in ("nope", other["id"]):
        res = await client.post(LIST, json={"title": "t", "parentId": parent})
        error(res, 400, "TEST_PARENT_NOT_FOUND")
        res = await client.patch("/api/tests/tc2", json={"parentId": parent})
        error(res, 400, "TEST_PARENT_NOT_FOUND")
    error(await client.patch("/api/tests/tc1", json={"parentId": "tc1"}), 400, "TEST_PARENT_SELF")
    error(
        await client.patch("/api/tests/tc1", json={"parentId": "tc2"}),
        400,
        "TEST_PARENT_DESCENDANT",
    )
    grandchild = await create(client, {"title": "손자", "parentId": "tc2"})
    error(
        await client.patch("/api/tests/tc1", json={"parentId": grandchild["id"]}),
        400,
        "TEST_PARENT_DESCENDANT",
    )
    # 묶음을 옮기는 것은 된다
    res = await client.patch("/api/tests/tc5", json={"parentId": "tc1"})
    assert res.status_code == 200 and res.json()["parentId"] == "tc1"
    res = await client.patch("/api/tests/tc5", json={"parentId": None})
    assert res.json()["parentId"] is None


async def test_owner_must_be_an_active_project_member(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    session.add(Member(id="u9", name="외부인", email="u9@innoflow.local"))
    await session.commit()
    for owner in ("nope", "u9"):
        res = await client.post(LIST, json={"title": "t", "ownerId": owner})
        body = error(res, 400, "TEST_OWNER_NOT_FOUND")
        assert body["detail"] == {"ownerId": "담당자를 찾을 수 없습니다."}
        error(
            await client.patch("/api/tests/tc2", json={"ownerId": owner}),
            400,
            "TEST_OWNER_NOT_FOUND",
        )


async def test_part_uses_the_task_codes(client: httpx.AsyncClient) -> None:
    error(await client.post(LIST, json={"title": "t", "partId": "nope"}), 400, "PART_NOT_FOUND")
    error(await client.patch("/api/tests/tc2", json={"partId": "nope"}), 400, "PART_NOT_FOUND")
    assert (await client.patch("/api/parts/pt2", json={"active": False})).status_code == 200
    error(await client.post(LIST, json={"title": "t", "partId": "pt2"}), 400, "PART_ARCHIVED")


async def test_refs_must_be_in_the_same_project(client: httpx.AsyncClient) -> None:
    for kind, target, code in (
        ("task", "x1", "TASK_NOT_FOUND"),
        ("task", "nope", "TASK_NOT_FOUND"),
        ("thread", "t10", "THREAD_NOT_FOUND"),
        ("thread", "nope", "THREAD_NOT_FOUND"),
    ):
        res = await client.post(LIST, json={"title": "t", "refs": [{"kind": kind, "id": target}]})
        error(res, 404, code)
        error(await client.put(f"/api/tests/tc2/refs/{kind}/{target}"), 404, code)
    assert (await client.put("/api/tests/tc2/refs/label/k4")).status_code == 422


async def test_ref_limit_is_20(client: httpx.AsyncClient) -> None:
    refs = [{"kind": "task", "id": f"k{n}"} for n in range(1, 22)]
    error(await client.post(LIST, json={"title": "t", "refs": refs}), 400, "TEST_REF_LIMIT")
    body = await create(client, {"title": "t", "refs": refs[:20]})
    assert len(body["refs"]) == 20
    # 이미 건 것을 다시 거는 것은 늘지 않으니 된다
    assert (await client.put(f"/api/tests/{body['id']}/refs/task/k1")).status_code == 200
    error(await client.put(f"/api/tests/{body['id']}/refs/task/k21"), 400, "TEST_REF_LIMIT")


async def test_ref_put_and_delete_are_idempotent(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for _ in range(2):
        res = await client.put("/api/tests/tc7/refs/thread/t1")
        assert res.status_code == 200
        assert res.json()["refs"] == [{"kind": "thread", "id": "t1"}]
    res = await client.put("/api/tests/tc7/refs/task/k22")
    assert res.json()["refs"] == [{"kind": "task", "id": "k22"}, {"kind": "thread", "id": "t1"}]
    for _ in range(2):
        assert (await client.delete("/api/tests/tc7/refs/thread/t1")).status_code == 204
    assert (await client.delete("/api/tests/tc7/refs/thread/t10")).status_code == 204
    assert (await one(client, "tc7"))["refs"] == [{"kind": "task", "id": "k22"}]
    rows = await session.scalar(
        select(func.count()).select_from(TestRef).where(TestRef.test_id == "tc7")
    )
    assert rows == 1


# --- 상태 ---


async def status(c: httpx.AsyncClient, test_id: str, **body: Any) -> httpx.Response:
    return await c.post(f"/api/tests/{test_id}/status", json=body)


async def test_fail_keeps_note_then_testing_clears_it(client: httpx.AsyncClient) -> None:
    # 실패한 단계는 걷었다(Q60) — 옛 화면이 보내도 버린다
    res = await status(client, "tc2", status="fail", failedStep=2, note="  화면이 멈춘다  ")
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["resultNote"]) == ("fail", "화면이 멈춘다")
    assert "failedStep" not in body
    assert body["statusChangedBy"] == "admin" and body["statusDays"] == 0
    body = (await status(client, "tc2", status="testing", note="버린다")).json()
    assert (body["status"], body["resultNote"]) == ("testing", "")


async def test_blocked_keeps_note(client: httpx.AsyncClient) -> None:
    body = (await status(client, "tc2", status="blocked", note="서버 없음")).json()
    assert body["resultNote"] == "서버 없음"
    body = (await status(client, "tc7", status="pass", note="버린다")).json()
    assert body["resultNote"] == ""


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"status": "fail"}, "note"),
        ({"status": "fail", "note": "   "}, "note"),
        ({"status": "blocked", "note": ""}, "note"),
        ({"status": "fail", "note": "가" * 4001}, "note"),
        ({"status": "done"}, "status"),
    ],
)
async def test_status_validation(
    client: httpx.AsyncClient, body: dict[str, Any], field: str
) -> None:
    detail = error(await status(client, "tc2", **body), 422, "VALIDATION_ERROR")["detail"]
    assert set(detail) == {field}
    assert (await one(client, "tc2"))["status"] == "pass"


async def test_group_status_is_400(client: httpx.AsyncClient) -> None:
    error(await status(client, "tc1", status="testing"), 400, "TEST_GROUP_STATUS")


async def test_same_status_overwrites_when_and_who(
    as_member: AsMember, monkeypatch: pytest.MonkeyPatch
) -> None:
    u3 = await as_member("u3")
    monkeypatch.setattr(service, "now", lambda: datetime(2026, 10, 15, 1, 0, tzinfo=UTC))
    body = (await status(u3, "tc8", status="testing")).json()
    assert body["statusChangedAt"] == "2026-10-15T01:00:00Z"
    assert body["statusChangedBy"] == "u3" and body["statusDays"] == 0


# --- 지우기 · 권한 ---


async def test_delete_removes_refs(client: httpx.AsyncClient, session: AsyncSession) -> None:
    assert (await client.delete("/api/tests/tc2")).status_code == 204
    error(await client.get("/api/tests/tc2"), 404, "TEST_NOT_FOUND")
    left = await session.scalar(
        select(func.count()).select_from(TestRef).where(TestRef.test_id == "tc2")
    )
    assert left == 0
    # 형제가 남아 있어 tc1 은 아직 묶음이다
    assert (await rows_by_key(client))["HW-T1"]["signals"] == []


async def test_group_cannot_be_deleted(client: httpx.AsyncClient) -> None:
    error(await client.delete("/api/tests/tc1"), 409, "TEST_HAS_CHILDREN")
    for child in ("tc2", "tc3", "tc4"):
        assert (await client.delete(f"/api/tests/{child}")).status_code == 204
    assert (await client.delete("/api/tests/tc1")).status_code == 204


@pytest.mark.parametrize(("deleter", "code"), [("u2", 204), ("u3", 403), ("u1", 204)])
async def test_delete_boundary(as_member: AsMember, deleter: str, code: int) -> None:
    """만든 사람(u2) · 프로젝트 관리자(u1) 는 지우고, 다른 멤버(u3) 는 403."""
    u2 = await as_member("u2")
    made = await create(u2, {"title": "u2 의 것"})
    who = u2 if deleter == "u2" else await as_member(deleter)
    res = await who.delete(f"/api/tests/{made['id']}")
    assert res.status_code == code
    if code == 403:
        assert res.json()["code"] == "FORBIDDEN"
        assert (await u2.get(f"/api/tests/{made['id']}")).status_code == 200


async def test_members_write_but_only_the_author_deletes(
    as_member: AsMember, client: httpx.AsyncClient
) -> None:
    u3 = await as_member("u3")
    # 시드 tc2 는 u2 가 만들었다 — u3 도 고치고 상태를 바꾸고 태그를 건다
    assert (await u3.patch("/api/tests/tc2", json={"title": "고침"})).status_code == 200
    assert (await status(u3, "tc2", status="testing")).status_code == 200
    assert (await u3.put("/api/tests/tc2/refs/thread/t1")).status_code == 200
    assert (await u3.post("/api/tests/tc2/basis")).status_code == 200
    error(await u3.delete("/api/tests/tc2"), 403, "FORBIDDEN")
    # 시스템 관리자는 지운다
    assert (await client.delete("/api/tests/tc2")).status_code == 204


async def test_ungranted_member_sees_404(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    session.add(Member(id="u9", name="외부인", email="u9@innoflow.local"))
    await session.commit()
    u9 = await as_member("u9")
    error(await u9.get(LIST), 404, "PROJECT_NOT_FOUND")
    error(await u9.post(LIST, json={"title": "t"}), 404, "PROJECT_NOT_FOUND")
    for res in (
        await u9.get("/api/tests/tc2"),
        await u9.patch("/api/tests/tc2", json={"title": "x"}),
        await u9.delete("/api/tests/tc2"),
        await status(u9, "tc2", status="ready"),
        await u9.put("/api/tests/tc2/refs/task/k4"),
        await u9.delete("/api/tests/tc2/refs/task/k4"),
        await u9.post("/api/tests/tc2/basis"),
    ):
        error(res, 404, "TEST_NOT_FOUND")


async def test_anonymous_is_401(anon: httpx.AsyncClient) -> None:
    assert (await anon.get(LIST)).status_code == 401
    assert (await anon.get("/api/tests/tc2")).status_code == 401


# --- 신호 ---


def case(
    status: str, changed: str, start: str | None = None, due: str | None = None
) -> tuple[Case, int]:
    row = Case(
        status=status,
        status_changed_at=datetime.fromisoformat(changed).replace(tzinfo=UTC),
        start=date.fromisoformat(start) if start else None,
        due=date.fromisoformat(due) if due else None,
    )
    return row, service.status_days(row, TODAY)


RULE = RiskSettings(due_soon_days=3, defer_count=2, stale_days=7, high_score=6, medium_score=3)


def signals_of(row: Case, days: int, changed: bool = False) -> list[str]:
    return list(service.signals(row, days=days, changed=changed, rule=RULE, today=TODAY))


@pytest.mark.parametrize(
    ("changed_at", "start", "due", "expected"),
    [
        # 기간 사흘 — 1.5배(4.5일)를 넘어야
        ("2026-10-11T03:00:00", "2026-10-14", "2026-10-16", []),
        ("2026-10-10T03:00:00", "2026-10-14", "2026-10-16", ["longRunning"]),
        # 기간 없음 — staleDays(7) 를 넘어야
        ("2026-10-08T03:00:00", None, None, []),
        ("2026-10-07T03:00:00", None, None, ["longRunning"]),
        # 한쪽만 있으면 기간이 없는 것으로 본다
        ("2026-10-07T03:00:00", "2026-10-16", None, ["longRunning"]),
    ],
)
def test_long_running(
    changed_at: str, start: str | None, due: str | None, expected: list[str]
) -> None:
    row, days = case("testing", changed_at, start, due)
    assert signals_of(row, days) == expected


def test_status_days_use_the_kst_date() -> None:
    # 10-14 15:30Z 는 한국 시간 10-15 00:30 — 오늘 바뀐 것이다
    assert case("testing", "2026-10-14T15:30:00")[1] == 0
    assert case("testing", "2026-10-14T14:30:00")[1] == 1


def test_overdue_and_not_started_boundaries() -> None:
    assert signals_of(*case("ready", "2026-10-15T00:00:00", "2026-10-15", "2026-10-15")) == []
    assert signals_of(*case("ready", "2026-10-15T00:00:00", "2026-10-14", "2026-10-14")) == [
        "overdue",
        "notStarted",
    ]
    assert signals_of(*case("draft", "2026-10-15T00:00:00", "2026-10-14")) == ["notStarted"]
    for done in ("testing", "fail", "blocked"):
        assert "notStarted" not in signals_of(*case(done, "2026-10-15T00:00:00", "2026-10-14"))
    assert signals_of(*case("pass", "2026-10-15T00:00:00", None, "2026-10-01")) == []
    assert signals_of(*case("fail", "2026-10-15T00:00:00", None, "2026-10-01")) == ["overdue"]


def test_blocked_and_failed_need_more_than_stale_days() -> None:
    assert signals_of(*case("blocked", "2026-10-08T03:00:00")) == []
    assert signals_of(*case("blocked", "2026-10-07T03:00:00")) == ["longBlocked"]
    assert signals_of(*case("fail", "2026-10-08T03:00:00")) == []
    assert signals_of(*case("fail", "2026-10-07T03:00:00")) == ["failedIdle"]


def test_signals_follow_the_table_order() -> None:
    row, days = case("testing", "2026-09-01T00:00:00", "2026-09-01", "2026-09-02")
    assert signals_of(row, days, changed=True) == ["longRunning", "overdue", "basisChanged"]


async def test_thresholds_follow_the_project_risk_settings(client: httpx.AsyncClient) -> None:
    res = await client.put(
        "/api/projects/p1/risk-settings",
        json={"dueSoonDays": 3, "deferCount": 2, "staleDays": 13, "highScore": 6, "mediumScore": 3},
    )
    assert res.status_code == 200
    rows = await rows_by_key(client)
    # HW-T6 은 막힘 13일째 — 13 을 넘어야 한다
    assert rows["HW-T6"]["signals"] == []
    assert rows["HW-T7"]["signals"] == []
    assert rows["HW-T3"]["signals"] == ["longRunning", "overdue"]


async def test_group_never_has_signals(client: httpx.AsyncClient) -> None:
    # 기간이 지난 묶음이어도 신호는 하위에서 모은다
    res = await client.patch("/api/tests/tc5", json={"start": "2026-10-01", "due": "2026-10-02"})
    assert res.json()["signals"] == []
    # 하위를 다 지우면 묶음이 아니다
    for child in ("tc6", "tc7", "tc8"):
        assert (await client.delete(f"/api/tests/{child}")).status_code == 204
    assert (await one(client, "tc5"))["signals"] == ["overdue", "notStarted"]


# --- 기준 바뀜 ---


async def test_basis_confirm_clears_the_change(client: httpx.AsyncClient) -> None:
    assert (await one(client, "tc4"))["changedEntryIds"] == ["e3"]
    res = await client.post("/api/tests/tc4/basis")
    assert res.status_code == 200
    body = res.json()
    assert body["changedEntryIds"] == [] and body["signals"] == ["notStarted"]


async def test_new_decision_reaches_through_a_tagged_task(client: httpx.AsyncClient) -> None:
    """t2 는 HW-T4 가 직접, HW-T2 가 작업 k4 를 거쳐 닿는다."""
    changed = await add_entry(client, "t2", "change")
    rows = await rows_by_key(client)
    assert rows["HW-T4"]["changedEntryIds"] == ["e3", changed]
    assert rows["HW-T2"]["changedEntryIds"] == [changed]
    assert rows["HW-T2"]["signals"] == ["basisChanged"]
    # 닿지 않는 테스트는 그대로
    assert rows["HW-T3"]["changedEntryIds"] == [] and rows["HW-T6"]["changedEntryIds"] == []
    # 오래된 것부터
    again = await add_entry(client, "t1", "change")
    assert (await one(client, "tc2"))["changedEntryIds"] == [changed, again]


async def test_patch_restamps_the_basis(client: httpx.AsyncClient) -> None:
    changed = await add_entry(client, "t2", "change")
    assert (await one(client, "tc4"))["changedEntryIds"] == ["e3", changed]
    res = await client.patch("/api/tests/tc4", json={"content": "다시 봤다"})
    assert res.json()["changedEntryIds"] == []
    assert res.json()["signals"] == ["notStarted"]
    # 빈 PATCH 는 아무것도 안 바꾼 것이다 — 기준도 그대로
    again = await add_entry(client, "t2", "decide")
    res = await client.patch("/api/tests/tc4", json={})
    assert res.json()["changedEntryIds"] == [again]


async def test_defer_and_refine_are_not_changes(client: httpx.AsyncClient) -> None:
    await add_entry(client, "t3", "defer")
    await add_entry(client, "t3", "refine")
    assert (await one(client, "tc3"))["changedEntryIds"] == []


async def test_tagging_restamps_the_basis(client: httpx.AsyncClient) -> None:
    # 결정이 있는 안건을 새로 걸어도 그 결정은 '바뀐 것' 이 아니다 — 거는 때가 기준이다
    res = await client.put("/api/tests/tc7/refs/thread/t1")
    assert res.json()["changedEntryIds"] == [] and res.json()["signals"] == ["failedIdle"]
    changed = await add_entry(client, "t1", "change")
    assert (await one(client, "tc7"))["changedEntryIds"] == [changed]
    # 다른 태그를 걸면 다시 찍는다
    res = await client.put("/api/tests/tc7/refs/thread/t3")
    assert res.json()["changedEntryIds"] == []


async def test_untagging_restamps_the_basis(client: httpx.AsyncClient) -> None:
    assert (await client.put("/api/tests/tc4/refs/thread/t1")).status_code == 200
    changed = await add_entry(client, "t1", "change")
    assert (await one(client, "tc4"))["changedEntryIds"] == [changed]
    assert (await client.delete("/api/tests/tc4/refs/thread/t2")).status_code == 204
    assert (await one(client, "tc4"))["changedEntryIds"] == []


async def test_a_thread_newly_linked_to_a_tagged_task_shows_old_decisions(
    client: httpx.AsyncClient,
) -> None:
    """계약의 '알고 두는 것' — HW-T6 의 작업 k21 에 t1 이 새로 걸리면 그 옛 결정 e1 이 뜬다."""
    assert (await one(client, "tc6"))["changedEntryIds"] == []
    assert (await client.put("/api/tasks/k21/threads/t1")).status_code == 200
    body = await one(client, "tc6")
    assert body["changedEntryIds"] == ["e1"]
    assert body["signals"] == ["longBlocked", "basisChanged"]
    assert (await client.post("/api/tests/tc6/basis")).json()["changedEntryIds"] == []


async def test_status_change_keeps_the_basis(client: httpx.AsyncClient) -> None:
    body = (await status(client, "tc4", status="testing")).json()
    assert body["changedEntryIds"] == ["e3"]


# --- 지운 작업 · 안건 ---


async def test_deleting_a_task_or_thread_drops_only_the_tag(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await session.execute(delete(Task).where(Task.id == "k21"))
    await session.execute(delete(Thread).where(Thread.id == "t3"))
    await session.commit()
    rows = await rows_by_key(client)
    assert rows["HW-T6"]["refs"] == [] and rows["HW-T6"]["status"] == "blocked"
    assert rows["HW-T3"]["refs"] == []
    left = await session.scalar(select(func.count()).select_from(TestRef))
    assert left == 2  # HW-T2 → k4, HW-T4 → t2


# --- 0020 — 테스트 내용으로 합치기 (Q60) ---

# 0020 앞의 시드 그대로 — (id, 목적, 사전조건, 단계). 옮긴 글이 지금 시드의 content 와 같아야 한다
OLD_TESTS: list[tuple[str, str, str, list[tuple[str, str]]]] = [
    ("tc1", "사내 계정으로 들어오는 길을 처음부터 끝까지 따라간다.", "", []),
    (
        "tc2",
        "발급받은 계정으로 들어갈 수 있는지 본다.",
        "개발 서버가 떠 있고 계정이 발급돼 있다.",
        [
            ("로그인 화면을 연다", ""),
            ("dev01 과 임시 비밀번호를 넣고 [로그인]", "대시보드가 열리고 이름이 보인다"),
        ],
    ),
    (
        "tc3",
        "비밀번호를 거푸 틀리면 계정이 잠기는지 본다.",
        "",
        [
            ("틀린 비밀번호로 네 번 로그인한다", "매번 남은 횟수가 보인다"),
            ("다섯 번째로 틀린다", "계정이 잠겼다는 안내가 뜬다"),
        ],
    ),
    (
        "tc6",
        "",
        "",
        [
            ("계정 목록 파일을 올린다", ""),
            ("[한 번에 만들기]", "네 계정이 모두 만들어지고 메일이 나간다"),
        ],
    ),
    # 사전조건만 · 아무것도 없음
    ("x1", "", "서버가 떠 있다", []),
    ("x2", "", "", []),
]


def test_migration_moves_old_fields_into_content() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0020_test_content")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            for no, (test_id, purpose, precondition, steps) in enumerate(OLD_TESTS, start=1):
                conn.execute(
                    text(
                        "insert into test_case (id, project_id, key, seq, title, purpose,"
                        " precondition, status, failed_step, status_changed_at, created_at)"
                        " values (:id, 'p', :key, :seq, '테스트', :purpose, :precondition,"
                        " :status, :failed, '2026-09-03 00:00:00', '2026-09-03 00:00:00')"
                    ),
                    {
                        "id": test_id,
                        "key": f"P-T{no}",
                        "seq": no,
                        "purpose": purpose,
                        "precondition": precondition,
                        # 실패한 단계는 버린다
                        "status": "fail" if test_id == "tc6" else "draft",
                        "failed": 2 if test_id == "tc6" else None,
                    },
                )
                # 단계 순서는 sort_order 다 — 거꾸로 넣어도 순서대로 옮긴다
                for order, (action, expected) in reversed(list(enumerate(steps))):
                    conn.execute(
                        text(
                            "insert into test_step (id, test_id, sort_order, action, expected)"
                            " values (:id, :test_id, :order, :action, :expected)"
                        ),
                        {
                            "id": f"{test_id}s{order}",
                            "test_id": test_id,
                            "order": order,
                            "action": action,
                            "expected": expected,
                        },
                    )
            revisions[head].module.upgrade()

            moved = dict(conn.execute(text("select id, content from test_case")).all())
            seeded = {f"tc{no}": row.content for no, row in enumerate(SEED_TESTS, start=1)}
            for test_id in ("tc1", "tc2", "tc3", "tc6"):
                assert moved[test_id] == seeded[test_id], test_id
            assert moved["x1"] == "사전조건\n서버가 떠 있다"
            assert moved["x2"] == ""
            columns = {c["name"] for c in inspect(conn).get_columns("test_case")}
            assert not {"purpose", "precondition", "failed_step"} & columns
            assert "test_step" not in inspect(conn).get_table_names()

            # 열 · 테이블만 되살린다 — 값은 돌아오지 않는다
            revisions[head].module.downgrade()
            columns = {c["name"] for c in inspect(conn).get_columns("test_case")}
            assert {"purpose", "precondition", "failed_step"} <= columns
            assert "content" not in columns
            assert "test_step" in inspect(conn).get_table_names()
            purposes = conn.execute(text("select distinct purpose from test_case")).scalars()
            assert list(purposes) == [""]

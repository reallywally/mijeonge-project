"""확인 요청 — `docs/api/check.md`. 보내기 · 목록 · 확인 · 배지와 그 경계.

시드 p1 에 c1 ~ c4 가 있다(계약 '시드 · 목업' 표). 부하 계산은 빈 p3 에 줄을 손으로 세워
서비스에 바로 묻는다 — `today` 를 넘겨 날짜에 안 흔들린다.
"""

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CheckRequest, Member, Task, Thread
from app.services.check import Load, recipient_loads
from app.time import at, today_kst
from tests.conftest import AsMember

TASK = {"targetType": "task", "targetId": "k4", "recipientIds": ["u2"], "text": "봐 주세요"}


async def send(c: httpx.AsyncClient, body: dict[str, Any], project: str = "p1") -> httpx.Response:
    return await c.post(f"/api/projects/{project}/checks", json=body)


# --- 목록 ---


async def test_list_is_seed_in_seq_order(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    res = await u1.get("/api/projects/p1/checks")
    assert res.status_code == 200
    rows = res.json()
    assert [row["id"] for row in rows] == ["c1", "c2", "c3", "c4"]
    assert rows[0] == {
        "id": "c1",
        "projectId": "p1",
        "targetType": "task",
        "targetId": "k22",
        "senderId": "u1",
        "recipientId": "u3",
        "text": "스테이징 DB 구성 순서 봐 주세요",
        "createdAt": "2026-10-14T01:00:00Z",
        "confirmedAt": None,
    }
    assert rows[1]["targetType"] == "thread" and rows[1]["targetId"] == "t3"
    assert rows[1]["confirmedAt"] == "2026-10-14T05:00:00Z"
    # 부하는 응답에 싣지 않는다
    assert not any(key.startswith("load") for row in rows for key in row)


async def test_other_projects_have_their_own_list(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/projects/p2/checks")).json() == []


async def test_list_needs_the_grant(client: httpx.AsyncClient, as_member: AsMember) -> None:
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    res = await u4.get("/api/projects/p1/checks")
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_needs_login(anon: httpx.AsyncClient) -> None:
    assert (await anon.get("/api/projects/p1/checks")).status_code == 401
    assert (await anon.get("/api/checks/pending-count")).status_code == 401


# --- 보내기 ---


async def test_send_to_many_makes_a_row_each(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    body = {
        "targetType": "task",
        "targetId": "k4",
        # 겹친 사람은 하나로, 순서는 처음 나온 자리대로
        "recipientIds": ["u3", "u2", "u3"],
        "text": "  계정 목록 봐 주세요  ",
        "senderId": "u4",  # 모르는 키 — 보낸 사람은 로그인한 사람이다
    }
    res = await send(u1, body)
    assert res.status_code == 201
    rows = res.json()
    assert [row["recipientId"] for row in rows] == ["u3", "u2"]
    assert {row["senderId"] for row in rows} == {"u1"}
    assert {row["text"] for row in rows} == {"계정 목록 봐 주세요"}
    assert len({row["createdAt"] for row in rows}) == 1
    assert all(row["confirmedAt"] is None for row in rows)
    assert all(row["targetType"] == "task" and row["targetId"] == "k4" for row in rows)

    listed = (await u1.get("/api/projects/p1/checks")).json()
    assert [row["id"] for row in listed[-2:]] == [row["id"] for row in rows]


async def test_send_on_a_thread(as_member: AsMember, session: AsyncSession) -> None:
    u2 = await as_member("u2")
    res = await send(
        u2, {"targetType": "thread", "targetId": "t3", "recipientIds": ["u1"], "text": "의견"}
    )
    assert res.status_code == 201
    row = res.json()[0]
    assert (row["targetType"], row["targetId"]) == ("thread", "t3")
    stored = await session.get(CheckRequest, row["id"])
    assert stored is not None
    assert (stored.task_id, stored.thread_id) == (None, "t3")


async def test_text_can_be_29_characters(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    assert (await send(u1, {**TASK, "text": "가" * 29})).status_code == 201


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"text": "   "}, "text"),
        ({"text": "가" * 30}, "text"),
        ({"recipientIds": []}, "recipientIds"),
        ({"recipientIds": [f"m{n}" for n in range(21)]}, "recipientIds"),
        ({"targetType": "meeting"}, "targetType"),
    ],
    ids=["blank-text", "long-text", "no-recipient", "too-many", "bad-target-type"],
)
async def test_send_shape_is_422(as_member: AsMember, change: dict[str, Any], field: str) -> None:
    u1 = await as_member("u1")
    res = await send(u1, {**TASK, **change})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert field in body["detail"]


@pytest.mark.parametrize(
    ("target_type", "target_id"),
    [("task", "nope"), ("task", "x1"), ("thread", "t10"), ("thread", "k4"), ("task", "t3")],
    ids=["missing", "other-project-task", "other-project-thread", "task-as-thread", "wrong-kind"],
)
async def test_target_must_be_this_projects(
    as_member: AsMember, target_type: str, target_id: str
) -> None:
    u1 = await as_member("u1")
    res = await send(u1, {**TASK, "targetType": target_type, "targetId": target_id})
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_TARGET_NOT_FOUND"
    assert "targetId" in res.json()["detail"]


async def test_cannot_send_to_myself(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    res = await send(u1, {**TASK, "recipientIds": ["u2", "u1"]})
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_RECIPIENT_SELF"
    assert res.json()["detail"] == {"recipientIds.1": "나 자신은 고를 수 없습니다."}


async def test_recipient_must_be_an_active_grant(
    client: httpx.AsyncClient, as_member: AsMember, session: AsyncSession
) -> None:
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    u1 = await as_member("u1")
    # admin 은 부여 없이 다 보지만 p1 에 부여되지 않았다
    res = await send(u1, {**TASK, "recipientIds": ["u2", "admin", "u4", "ghost"]})
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == "MEMBER_NOT_IN_PROJECT"
    assert set(body["detail"]) == {"recipientIds.1", "recipientIds.2", "recipientIds.3"}
    # 한 줄도 안 남는다
    assert len((await u1.get("/api/projects/p1/checks")).json()) == 4


async def test_checks_run_in_contract_order(as_member: AsMember) -> None:
    """대상 → 나 자신 → 부여."""
    u1 = await as_member("u1")
    both = await send(u1, {**TASK, "targetId": "nope", "recipientIds": ["u1"]})
    assert both.json()["code"] == "CHECK_TARGET_NOT_FOUND"
    self_and_stranger = await send(u1, {**TASK, "recipientIds": ["ghost", "u1"]})
    assert self_and_stranger.json()["code"] == "CHECK_RECIPIENT_SELF"


async def test_send_needs_the_grant(client: httpx.AsyncClient, as_member: AsMember) -> None:
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    res = await send(u4, TASK)
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_send_stamps_recipient_load(as_member: AsMember, session: AsyncSession) -> None:
    """부하는 보내는 순간의 값이다 — 기한 임박은 오늘(KST) + 3일, 지난 것 포함."""
    today = today_kst()
    for id_, status, due in (
        ("q1", "todo", today - timedelta(days=5)),  # 지남 — 임박에 든다
        ("q2", "blocked", today + timedelta(days=3)),  # 경계 — 든다
        ("q3", "doing", today + timedelta(days=4)),  # 안 든다
        ("q4", "todo", None),
        ("q5", "done", today),  # 완료는 빠진다
    ):
        session.add(
            Task(
                id=id_,
                project_id="p3",
                key=f"MG-{id_}",
                title=id_,
                status=status,
                owner_id="u2",
                due=due,
                created_at=at("2026-10-01T00:00:00Z"),
            )
        )
    for id_, state in (("h1", "open"), ("h2", "queued"), ("h3", "decided")):
        session.add(
            Thread(
                id=id_,
                project_id="p3",
                title=id_,
                state=state,
                owner_id="u2",
                created_at=at("2026-10-01T00:00:00Z"),
            )
        )
    await session.commit()

    u1 = await as_member("u1")
    res = await send(
        u1,
        {"targetType": "task", "targetId": "q1", "recipientIds": ["u2", "u3"], "text": "봐 주세요"},
        project="p3",
    )
    assert res.status_code == 201
    loads = {}
    for row in res.json():
        stored = await session.get(CheckRequest, row["id"])
        assert stored is not None
        loads[row["recipientId"]] = (
            stored.load_open_tasks,
            stored.load_blocked_tasks,
            stored.load_due_soon_tasks,
            stored.load_open_threads,
        )
    assert loads == {"u2": (4, 1, 2, 2), "u3": (0, 0, 0, 0)}


async def test_recipient_loads_count_only_this_project(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """시드 p1 의 u3 — 다른 프로젝트 작업은 세지 않는다."""
    today = date(2026, 10, 15)
    loads = await recipient_loads(session, "p1", ["u3", "nobody"], today=today)
    assert loads["nobody"] == Load()
    tasks = (
        await session.scalars(
            select(Task).where(
                Task.project_id == "p1", Task.owner_id == "u3", Task.status != "done"
            )
        )
    ).all()
    soon = today + timedelta(days=3)
    assert loads["u3"].open_tasks == len(tasks)
    assert loads["u3"].blocked_tasks == sum(t.status == "blocked" for t in tasks)
    assert loads["u3"].due_soon_tasks == sum(t.due is not None and t.due <= soon for t in tasks)


# --- 확인 ---


async def test_only_the_recipient_confirms(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u4 = await as_member("u4")
    res = await u4.post("/api/checks/c4/confirm")
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    # 시스템 관리자 · 보낸 사람도 대신 못 한다
    assert (await client.post("/api/checks/c4/confirm")).status_code == 403
    u2 = await as_member("u2")
    assert (await u2.post("/api/checks/c4/confirm")).status_code == 403


async def test_confirm_is_idempotent(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    first = await u1.post("/api/checks/c4/confirm")
    assert first.status_code == 200
    body = first.json()
    assert body["id"] == "c4" and body["confirmedAt"] is not None
    again = await u1.post("/api/checks/c4/confirm")
    assert again.status_code == 200
    assert again.json() == body
    # 이미 확인된 시드 줄은 시각이 그대로다
    seeded = await u1.post("/api/checks/c2/confirm")
    assert seeded.json()["confirmedAt"] == "2026-10-14T05:00:00Z"


async def test_confirm_unknown_or_foreign_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u1 = await as_member("u1")
    missing = await u1.post("/api/checks/nope/confirm")
    assert missing.status_code == 404
    assert missing.json()["code"] == "CHECK_NOT_FOUND"
    # 부여가 빠지면 내가 받은 요청이라도 없는 것처럼
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    foreign = await u4.post("/api/checks/c3/confirm")
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "CHECK_NOT_FOUND"


# --- 배지 ---


async def test_pending_count_per_project(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    assert (await u1.get("/api/checks/pending-count")).json() == {
        "total": 1,
        "byProject": {"p1": 1},
    }
    u2 = await as_member("u2")
    sent = await send(
        u2,
        {"targetType": "task", "targetId": "x1", "recipientIds": ["u1"], "text": "봐 주세요"},
        project="p2",
    )
    assert sent.status_code == 201
    assert (await u1.get("/api/checks/pending-count")).json() == {
        "total": 2,
        "byProject": {"p1": 1, "p2": 1},
    }
    await u1.post("/api/checks/c4/confirm")
    assert (await u1.get("/api/checks/pending-count")).json() == {
        "total": 1,
        "byProject": {"p2": 1},
    }


async def test_pending_count_skips_lost_grants(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u4 = await as_member("u4")
    assert (await u4.get("/api/checks/pending-count")).json() == {
        "total": 1,
        "byProject": {"p1": 1},
    }
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    assert (await u4.get("/api/checks/pending-count")).json() == {"total": 0, "byProject": {}}
    # 시스템 관리자도 부여된 것만 — 부여가 없어 늘 0 이다
    assert (await client.get("/api/checks/pending-count")).json() == {
        "total": 0,
        "byProject": {},
    }


# --- 걸린 것을 지우면 ---


async def test_deleting_the_target_deletes_the_checks(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for model, id_ in ((Task, "k18"), (Thread, "t3")):
        row = await session.get(model, id_)
        assert row is not None
        await session.delete(row)
    await session.commit()
    left = (await client.get("/api/projects/p1/checks")).json()
    assert [row["id"] for row in left] == ["c1"]

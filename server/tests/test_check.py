"""확인 요청 — `docs/api/check.md`(2026-10-19 고침). 보내기 · 목록 · 확인 · 배지와 그 경계.

시드 p1 에 c1 ~ c4 가 있다(계약 '시드 · 목업' 표). t2 의 결정 e3 · t1 의 결정 e1 은 이미 보냈고
t6(참조 u2, 연결 작업 없음)은 아직 안 보냈다. 부하 계산은 빈 p3 에 줄을 손으로 세워 본다.
"""

from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CheckRequest, Entry, Member, Task, Thread, ThreadCc
from app.services import check as check_service
from app.services.check import Load, recipient_loads
from app.time import at, today_kst
from tests.conftest import AsMember


async def send(c: httpx.AsyncClient, thread: str) -> httpx.Response:
    return await c.post(f"/api/threads/{thread}/checks")


async def change(c: httpx.AsyncClient, thread: str) -> str:
    """결정을 바꾼다 — 새 change 이력의 id."""
    res = await c.post(
        f"/api/threads/{thread}/entries", json={"kind": "change", "text": "다시 정했다"}
    )
    assert res.status_code == 201
    entry_id: str = res.json()["entry"]["id"]
    return entry_id


async def link(c: httpx.AsyncClient, task: str, thread: str) -> None:
    assert (await c.put(f"/api/tasks/{task}/threads/{thread}")).status_code in (200, 201, 204)


async def set_cc(c: httpx.AsyncClient, thread: str, cc_ids: list[str]) -> None:
    assert (await c.patch(f"/api/threads/{thread}", json={"ccIds": cc_ids})).status_code == 200


def recipients(res: httpx.Response) -> list[str]:
    return [row["recipientId"] for row in res.json()]


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
        "threadId": "t2",
        "entryId": "e3",
        "senderId": "u1",
        "recipientId": "u3",
        "createdAt": "2026-10-14T01:00:00Z",
        "confirmedAt": None,
    }
    assert [row["recipientId"] for row in rows[:3]] == ["u3", "u2", "u4"]
    assert rows[1]["confirmedAt"] == "2026-10-14T05:00:00Z"
    assert (rows[3]["threadId"], rows[3]["entryId"], rows[3]["senderId"]) == ("t1", "e1", "u3")
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
    assert (await send(anon, "t6")).status_code == 401
    assert (await anon.get("/api/checks/pending-count")).status_code == 401


async def test_old_send_path_is_gone(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    res = await u1.post("/api/projects/p1/checks", json={})
    assert res.status_code == 405


# --- 보내기 ---


async def test_send_goes_to_cc_on_the_latest_decision(as_member: AsMember) -> None:
    """t6 — 연결 작업이 없고 참조가 u2 하나. 계약 '시드 · 목업' 의 마지막 줄."""
    u1 = await as_member("u1")
    res = await send(u1, "t6")
    assert res.status_code == 201
    rows = res.json()
    assert len(rows) == 1
    row = rows[0]
    assert set(row) == {
        "id",
        "projectId",
        "threadId",
        "entryId",
        "senderId",
        "recipientId",
        "createdAt",
        "confirmedAt",
    }
    assert (row["projectId"], row["threadId"], row["entryId"]) == ("p1", "t6", "e6")
    assert (row["senderId"], row["recipientId"], row["confirmedAt"]) == ("u1", "u2", None)
    assert row["createdAt"].endswith("Z")

    listed = (await u1.get("/api/projects/p1/checks")).json()
    assert listed[-1]["id"] == row["id"]


async def test_body_is_ignored(as_member: AsMember) -> None:
    """본문이 없다 — 받는 사람 · 보낸 사람을 실어 와도 서버가 정한 대로 간다."""
    u1 = await as_member("u1")
    res = await u1.post(
        "/api/threads/t6/checks", json={"recipientIds": ["u4"], "senderId": "u3", "text": "x"}
    )
    assert res.status_code == 201
    assert [(row["senderId"], row["recipientId"]) for row in res.json()] == [("u1", "u2")]


async def test_one_batch_shares_entry_and_time(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    entry_id = await change(u1, "t2")
    res = await send(u1, "t2")
    assert res.status_code == 201
    rows = res.json()
    assert {row["entryId"] for row in rows} == {entry_id}
    assert len({row["createdAt"] for row in rows}) == 1


async def test_recipients_are_task_owners_then_cc(client: httpx.AsyncClient) -> None:
    """작업 seq 순 담당자 다음 참조 순. 겹치면 처음 자리, 담당자 없는 작업은 건너뛴다."""
    # 링크를 거는 순서와 상관없이 작업 seq 순이다 — k9(u4) · k13(u1) · k15(u2), k1 은 담당자 없음
    for task in ("k15", "k9", "k13", "k1"):
        await link(client, task, "t6")
    await set_cc(client, "t6", ["u3", "u2", "u1"])
    res = await send(client, "t6")  # 시스템 관리자가 보낸다 — 받는 사람 누구도 빠지지 않는다
    assert res.status_code == 201
    assert recipients(res) == ["u4", "u1", "u2", "u3"]


async def test_sender_is_left_out(as_member: AsMember, client: httpx.AsyncClient) -> None:
    """t1 — 연결 작업 k4 담당 u3, 참조 u1. 누른 사람은 받지 않는다."""
    u3 = await as_member("u3")
    await change(u3, "t1")
    res = await send(u3, "t1")
    assert res.status_code == 201
    assert recipients(res) == ["u1"]

    # 결정을 또 바꾸면 이번엔 u1 이 누른다 — u3 만 받는다
    u1 = await as_member("u1")
    await change(u1, "t1")
    again = await send(u1, "t1")
    assert again.status_code == 201
    assert recipients(again) == ["u3"]


async def test_inactive_or_ungranted_are_skipped(
    client: httpx.AsyncClient, as_member: AsMember, session: AsyncSession
) -> None:
    """t2 — k4 · k22 담당 u3, 참조 u2 · u4. 빠진 사람은 오류 없이 건너뛴다."""
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    assert (await client.delete("/api/projects/p1/members/u2")).status_code == 204

    u1 = await as_member("u1")
    await change(u1, "t2")
    res = await send(u1, "t2")
    assert res.status_code == 201
    assert recipients(res) == ["u3"]


async def test_not_decided_is_400(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    for thread in ("t3", "t4"):  # open · queued
        res = await send(u1, thread)
        assert res.status_code == 400
        assert res.json()["code"] == "CHECK_THREAD_NOT_DECIDED"


async def test_same_decision_only_once(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    assert (await send(u1, "t6")).status_code == 201
    again = await send(u1, "t6")
    assert again.status_code == 409
    assert again.json()["code"] == "CHECK_ALREADY_SENT"
    # 시드가 이미 보낸 결정도 같다
    assert (await send(u1, "t2")).json()["code"] == "CHECK_ALREADY_SENT"
    assert len((await u1.get("/api/projects/p1/checks")).json()) == 5


async def test_changed_decision_can_be_sent_again(as_member: AsMember) -> None:
    """결정을 바꾸면 다시 보낸다. 앞 결정의 대기 줄은 그대로 남는다."""
    u1 = await as_member("u1")
    entry_id = await change(u1, "t2")
    res = await send(u1, "t2")
    assert res.status_code == 201
    assert recipients(res) == ["u3", "u2", "u4"]
    rows = (await u1.get("/api/projects/p1/checks")).json()
    sent = [row["entryId"] for row in rows if row["threadId"] == "t2"]
    assert sent == ["e3"] * 3 + [entry_id] * 3
    assert rows[0]["confirmedAt"] is None


async def test_defer_after_decision_does_not_reopen(as_member: AsMember) -> None:
    """미룸은 결정이 아니다 — 최근 결정은 그대로라 다시 못 보낸다."""
    u1 = await as_member("u1")
    res = await u1.post("/api/threads/t2/entries", json={"kind": "defer", "text": "다시 보자"})
    assert res.status_code == 201
    assert (await send(u1, "t2")).json()["code"] == "CHECK_ALREADY_SENT"


async def test_no_recipients_is_400(client: httpx.AsyncClient, as_member: AsMember) -> None:
    # 참조가 나 하나뿐
    u2 = await as_member("u2")
    res = await send(u2, "t6")
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_NO_RECIPIENTS"
    # 참조도 연결 작업도 없다
    await set_cc(client, "t6", [])
    u1 = await as_member("u1")
    res = await send(u1, "t6")
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_NO_RECIPIENTS"
    assert (await u1.get("/api/projects/p1/checks")).json()[-1]["id"] == "c4"


async def test_checks_run_in_contract_order(as_member: AsMember) -> None:
    """이미 보냄(409)이 받을 사람 없음(400)보다 먼저다."""
    u1 = await as_member("u1")
    assert (await send(u1, "t6")).status_code == 201
    # u2 혼자라면 받을 사람이 없지만, 그 전에 이미 보냈다
    u2 = await as_member("u2")
    assert (await send(u2, "t6")).json()["code"] == "CHECK_ALREADY_SENT"


async def test_unknown_or_foreign_thread_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u1 = await as_member("u1")
    missing = await send(u1, "nope")
    assert missing.status_code == 404
    assert missing.json()["code"] == "THREAD_NOT_FOUND"
    # 부여받지 않은 프로젝트의 안건은 없는 것처럼
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    foreign = await send(u4, "t6")
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "THREAD_NOT_FOUND"


async def test_race_lands_on_409(as_member: AsMember, monkeypatch: pytest.MonkeyPatch) -> None:
    """동시에 두 번 — 앞 검사를 지나친 늦은 쪽은 unique (entry_id, recipient_id) 에 걸린다."""
    u1 = await as_member("u1")
    assert (await send(u1, "t6")).status_code == 201

    async def not_yet(*_args: object) -> bool:
        return False

    monkeypatch.setattr(check_service, "_already_sent", not_yet)
    late = await send(u1, "t6")
    assert late.status_code == 409
    assert late.json()["code"] == "CHECK_ALREADY_SENT"
    assert len((await u1.get("/api/projects/p1/checks")).json()) == 5


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
                cc=[
                    ThreadCc(project_id="p3", member_id=member_id, sort_order=order)
                    for order, member_id in enumerate(["u2", "u3"] if id_ == "h3" else [])
                ],
            )
        )
    await session.flush()
    session.add(
        Entry(
            id="hd",
            thread_id="h3",
            kind="decide",
            text="정했다",
            created_at=at("2026-10-02T00:00:00Z"),
        )
    )
    await session.commit()

    u1 = await as_member("u1")
    res = await send(u1, "h3")
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
    u3 = await as_member("u3")
    assert (await u3.post("/api/checks/c4/confirm")).status_code == 403


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
    u2 = await as_member("u2")
    seeded = await u2.post("/api/checks/c2/confirm")
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


async def test_pending_count_per_project(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u1 = await as_member("u1")
    assert (await u1.get("/api/checks/pending-count")).json() == {
        "total": 1,
        "byProject": {"p1": 1},
    }
    # p2 의 t10 을 정하고 u1 을 참조로 — u2 가 보낸다
    await set_cc(client, "t10", ["u1"])
    decided = await client.post("/api/threads/t10/entries", json={"kind": "decide", "text": "x"})
    assert decided.status_code == 201
    u2 = await as_member("u2")
    sent = await send(u2, "t10")
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


async def test_deleting_thread_or_entry_deletes_the_checks(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for model, id_ in ((Thread, "t1"), (Entry, "e3")):
        row = await session.get(model, id_)
        assert row is not None
        await session.delete(row)
    await session.commit()
    assert (await client.get("/api/projects/p1/checks")).json() == []

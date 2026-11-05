"""확인 요청 — `docs/api/check.md`(2026-11-04 고침 — 결정 판). 보내기 · 목록 · 확인 · 배지.

시드 p1 에 c1 ~ c4 가 있다(계약 '시드 · 목업' 표). t2 의 결정 판 1 · t1 의 결정 판 1 은 이미 보냈다.
받는 사람은 연결 작업 담당자뿐이다 — t2 는 k4 · k22(둘 다 u3), t1 은 k4(u3), t6 은 연결 작업이 없다.
부하 계산은 빈 p3 에 줄을 손으로 세워 본다.
"""

from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agenda, CheckRequest, Member, Task, TaskAgendaLink
from app.services import check as check_service
from app.services.check import Load, recipient_loads
from app.time import at, today_kst
from tests.conftest import AsMember, decide

CHECK_KEYS = {
    "id",
    "projectId",
    "agendaId",
    "decisionRev",
    "decision",
    "senderId",
    "recipientId",
    "createdAt",
    "confirmedAt",
}


async def send(c: httpx.AsyncClient, agenda: str) -> httpx.Response:
    return await c.post(f"/api/agendas/{agenda}/checks")


async def change(c: httpx.AsyncClient, agenda: str, text: str = "다시 정했다") -> int:
    """결정을 바꾼다 — 새 결정 판."""
    res = await decide(c, agenda, text)
    assert res.status_code == 200, res.text
    rev: int = res.json()["decisionRev"]
    return rev


async def link(c: httpx.AsyncClient, task: str, agenda: str) -> None:
    assert (await c.put(f"/api/tasks/{task}/agendas/{agenda}")).status_code in (200, 201, 204)


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
        "agendaId": "t2",
        "decisionRev": 1,
        # 이행 규칙 — 그때 가리킨 결정 줄의 글(세부 없이)
        "decision": "mysql 을 쓴다",
        "senderId": "u1",
        "recipientId": "u3",
        "createdAt": "2026-10-14T01:00:00Z",
        "confirmedAt": None,
    }
    assert [row["recipientId"] for row in rows[:3]] == ["u3", "u2", "u4"]
    assert rows[1]["confirmedAt"] == "2026-10-14T05:00:00Z"
    assert (rows[3]["agendaId"], rows[3]["decisionRev"], rows[3]["senderId"]) == ("t1", 1, "u3")
    assert rows[3]["decision"] == "우분투 최신 버전으로 한다"
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
    assert (await u1.post("/api/threads/t2/checks")).status_code == 404


# --- 보내기 ---


async def test_send_stamps_the_decision_and_its_rev(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """t6 — 연결 작업 k13(u1)을 걸고 u2 가 보낸다. 지금의 결정 판 · 결정내용을 찍는다."""
    await link(client, "k13", "t6")
    u2 = await as_member("u2")
    res = await send(u2, "t6")
    assert res.status_code == 201, res.text
    (row,) = res.json()
    assert set(row) == CHECK_KEYS
    assert (row["projectId"], row["agendaId"], row["decisionRev"]) == ("p1", "t6", 1)
    assert row["decision"].startswith("테스트 기간: 전체 일정은 그대로 두고")
    assert (row["senderId"], row["recipientId"], row["confirmedAt"]) == ("u2", "u1", None)
    assert row["createdAt"].endswith("Z")

    listed = (await u2.get("/api/projects/p1/checks")).json()
    assert listed[-1]["id"] == row["id"]


async def test_stamped_decision_stays_after_a_change(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u1 = await as_member("u1")
    rev = await change(u1, "t2", "postgresql 로 바꾼다")
    assert rev == 2
    assert (await send(u1, "t2")).status_code == 201
    await change(u1, "t2", "다시 mysql")
    rows = (await u1.get("/api/projects/p1/checks")).json()
    assert [(row["decisionRev"], row["decision"]) for row in rows if row["agendaId"] == "t2"] == [
        (1, "mysql 을 쓴다"),
        (1, "mysql 을 쓴다"),
        (1, "mysql 을 쓴다"),
        (2, "postgresql 로 바꾼다"),
        (2, "postgresql 로 바꾼다"),
        (2, "postgresql 로 바꾼다"),
    ]


async def test_body_is_ignored(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """본문이 없다 — 받는 사람 · 보낸 사람을 실어 와도 서버가 정한 대로 간다."""
    await link(client, "k13", "t6")
    u2 = await as_member("u2")
    res = await u2.post(
        "/api/agendas/t6/checks", json={"recipientIds": ["u4"], "senderId": "u3", "text": "x"}
    )
    assert res.status_code == 201
    assert [(row["senderId"], row["recipientId"]) for row in res.json()] == [("u2", "u1")]


async def test_one_batch_shares_rev_and_time(client: httpx.AsyncClient) -> None:
    for task in ("k9", "k13"):
        await link(client, task, "t6")
    res = await send(client, "t6")
    assert res.status_code == 201
    rows = res.json()
    assert len(rows) == 2
    assert {row["decisionRev"] for row in rows} == {1}
    assert len({row["createdAt"] for row in rows}) == 1


async def test_recipients_are_task_owners_in_task_order(client: httpx.AsyncClient) -> None:
    """작업 seq 순 담당자. 겹치면 처음 자리, 담당자 없는 작업은 건너뛴다. t6 은 참조가 없다."""
    # 링크를 거는 순서와 상관없이 작업 seq 순이다 — k9(u4) · k13(u1) · k15(u2), k1 은 담당자 없음
    for task in ("k15", "k9", "k13", "k1", "k20"):
        await link(client, task, "t6")
    res = await send(client, "t6")  # 시스템 관리자가 보낸다 — 받는 사람 누구도 빠지지 않는다
    assert res.status_code == 201
    assert recipients(res) == ["u4", "u1", "u2", "u3"]


async def test_sender_is_left_out(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """t2 — 연결 작업 k4 · k22 담당 u3, 참조 u2 · u4. 누른 사람은 받지 않는다."""
    await link(client, "k13", "t2")
    u3 = await as_member("u3")
    await change(u3, "t2")
    res = await send(u3, "t2")
    assert res.status_code == 201
    assert recipients(res) == ["u1", "u2", "u4"]


async def test_recipients_are_task_owners_then_cc(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """① 연결 작업 담당자(작업 seq 순) ② 참조(ccIds 순). 겹치면 처음 자리, 누른 사람은 빠진다."""
    # t6 — 연결 작업 k9(u4) · k13(u1), 참조 u2 · u4(작업 담당과 겹침) · u3(누른 사람)
    for task in ("k13", "k9"):
        await link(client, task, "t6")
    u1 = await as_member("u1")
    res = await u1.patch("/api/agendas/t6", json={"ccIds": ["u2", "u4", "u3"]})
    assert res.status_code == 200, res.text
    u3 = await as_member("u3")
    res = await send(u3, "t6")
    assert res.status_code == 201
    assert recipients(res) == ["u4", "u1", "u2"]


async def test_cc_alone_is_enough(as_member: AsMember) -> None:
    """연결 작업이 없어도 참조가 있으면 보낸다 — t6 은 연결 작업이 없다."""
    u1 = await as_member("u1")
    assert (await u1.patch("/api/agendas/t6", json={"ccIds": ["u4"]})).status_code == 200
    res = await send(u1, "t6")
    assert res.status_code == 201
    assert recipients(res) == ["u4"]


async def test_inactive_or_ungranted_are_skipped(
    client: httpx.AsyncClient, as_member: AsMember, session: AsyncSession
) -> None:
    for task in ("k9", "k15", "k13"):
        await link(client, task, "t6")
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    assert (await client.delete("/api/projects/p1/members/u2")).status_code == 204

    res = await send(client, "t6")
    assert res.status_code == 201
    assert recipients(res) == ["u1"]


async def test_not_decided_is_400(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u1 = await as_member("u1")
    for agenda in ("t3", "t4"):  # open · queued
        res = await send(u1, agenda)
        assert res.status_code == 400
        assert res.json()["code"] == "CHECK_AGENDA_NOT_DECIDED"
    # 결정내용이 있어도 decided 가 아니면 못 보낸다 — t5 는 논의중
    assert (await send(u1, "t5")).json()["code"] == "CHECK_AGENDA_NOT_DECIDED"


async def test_same_rev_only_once(client: httpx.AsyncClient, as_member: AsMember) -> None:
    await link(client, "k13", "t6")
    u2 = await as_member("u2")
    assert (await send(u2, "t6")).status_code == 201
    again = await send(u2, "t6")
    assert again.status_code == 409
    assert again.json()["code"] == "CHECK_ALREADY_SENT"
    # 시드가 이미 보낸 결정 판도 같다
    assert (await send(u2, "t2")).json()["code"] == "CHECK_ALREADY_SENT"
    assert len((await u2.get("/api/projects/p1/checks")).json()) == 5


async def test_changed_decision_can_be_sent_again(as_member: AsMember) -> None:
    """결정을 바꾸면 판이 올라 다시 보낸다. 앞 판의 대기 줄은 그대로 남는다."""
    u1 = await as_member("u1")
    rev = await change(u1, "t2")
    res = await send(u1, "t2")
    assert res.status_code == 201
    assert recipients(res) == ["u3", "u2", "u4"]
    rows = (await u1.get("/api/projects/p1/checks")).json()
    sent = [row["decisionRev"] for row in rows if row["agendaId"] == "t2"]
    assert sent == [1, 1, 1, rev, rev, rev]
    assert rows[0]["confirmedAt"] is None


async def test_reopening_and_deciding_again_raises_the_rev(as_member: AsMember) -> None:
    """같은 결정내용이라도 논의중으로 돌렸다가 다시 정하면 새 판 — 다시 보낼 수 있다."""
    u3 = await as_member("u3")
    u1 = await as_member("u1")
    assert (await u3.patch("/api/agendas/t2", json={"state": "open"})).status_code == 200
    assert (await send(u1, "t2")).json()["code"] == "CHECK_AGENDA_NOT_DECIDED"
    decided = await u3.patch("/api/agendas/t2", json={"state": "decided"})
    assert decided.json()["decisionRev"] == 2
    assert (await send(u1, "t2")).status_code == 201


async def test_other_edits_do_not_reopen(as_member: AsMember) -> None:
    """제목 · 설명 · 담당자를 고쳐도 결정 판은 그대로라 다시 못 보낸다."""
    u1 = await as_member("u1")
    u3 = await as_member("u3")
    res = await u3.patch("/api/agendas/t2", json={"description": "다시 보자", "ownerId": "u2"})
    assert res.status_code == 200 and res.json()["decisionRev"] == 1
    assert (await send(u1, "t2")).json()["code"] == "CHECK_ALREADY_SENT"


async def test_no_recipients_is_400(client: httpx.AsyncClient, as_member: AsMember) -> None:
    # 연결 작업이 없다
    u1 = await as_member("u1")
    res = await send(u1, "t6")
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_NO_RECIPIENTS"
    # 연결 작업 담당자가 나 하나뿐 — t1 은 k4(u3). 참조(u1)를 빼야 받을 사람이 없다
    u3 = await as_member("u3")
    assert (await u3.patch("/api/agendas/t1", json={"ccIds": []})).status_code == 200
    await change(u3, "t1")
    res = await send(u3, "t1")
    assert res.status_code == 400
    assert res.json()["code"] == "CHECK_NO_RECIPIENTS"
    assert (await u1.get("/api/projects/p1/checks")).json()[-1]["id"] == "c4"


async def test_checks_run_in_contract_order(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """이미 보냄(409)이 받을 사람 없음(400)보다 먼저다."""
    # t1 의 지금 판은 시드가 이미 보냈다 — u3 혼자라면 받을 사람이 없지만, 그 전에 이미 보냈다
    u3 = await as_member("u3")
    assert (await send(u3, "t1")).json()["code"] == "CHECK_ALREADY_SENT"


async def test_unknown_or_foreign_agenda_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u1 = await as_member("u1")
    missing = await send(u1, "nope")
    assert missing.status_code == 404
    assert missing.json()["code"] == "AGENDA_NOT_FOUND"
    # 부여받지 않은 프로젝트의 안건은 없는 것처럼
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    foreign = await send(u4, "t6")
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "AGENDA_NOT_FOUND"


async def test_race_lands_on_409(
    client: httpx.AsyncClient, as_member: AsMember, monkeypatch: pytest.MonkeyPatch
) -> None:
    """동시에 두 번 — 앞 검사를 지나친 늦은 쪽은 unique (agenda_id, decision_rev, recipient_id)
    에 걸린다."""
    await link(client, "k13", "t6")
    u2 = await as_member("u2")
    assert (await send(u2, "t6")).status_code == 201

    async def not_yet(*_args: object) -> bool:
        return False

    monkeypatch.setattr(check_service, "_already_sent", not_yet)
    late = await send(u2, "t6")
    assert late.status_code == 409
    assert late.json()["code"] == "CHECK_ALREADY_SENT"
    assert len((await u2.get("/api/projects/p1/checks")).json()) == 5


async def test_send_stamps_recipient_load(as_member: AsMember, session: AsyncSession) -> None:
    """부하는 보내는 순간의 값이다 — 기한 임박은 오늘(KST) + 3일, 지난 것 포함."""
    today = today_kst()
    for id_, status, due, owner in (
        ("q1", "todo", today - timedelta(days=5), "u2"),  # 지남 — 임박에 든다
        ("q2", "blocked", today + timedelta(days=3), "u2"),  # 경계 — 든다
        ("q3", "doing", today + timedelta(days=4), "u2"),  # 안 든다
        ("q4", "todo", None, "u2"),
        ("q5", "done", today, "u2"),  # 완료는 빠진다
        ("q6", "todo", None, "u3"),
    ):
        session.add(
            Task(
                id=id_,
                project_id="p3",
                key=f"MG-{id_}",
                title=id_,
                status=status,
                owner_id=owner,
                due=due,
                created_at=at("2026-10-01T00:00:00Z"),
            )
        )
    for id_, state in (("h1", "open"), ("h2", "queued"), ("h3", "decided")):
        session.add(
            Agenda(
                id=id_,
                project_id="p3",
                title=id_,
                state=state,
                decision="정했다" if state == "decided" else "",
                decision_rev=1 if state == "decided" else 0,
                owner_id="u2",
                created_at=at("2026-10-01T00:00:00Z"),
            )
        )
    await session.flush()
    for task_id in ("q4", "q6"):
        session.add(TaskAgendaLink(task_id=task_id, agenda_id="h3", project_id="p3"))
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
            stored.load_open_agendas,
        )
    assert loads == {"u2": (4, 1, 2, 2), "u3": (1, 0, 0, 0)}


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
    # p2 의 t10 을 정하고 u1 이 맡은 작업을 건다 — u2 가 보낸다
    made = await client.post("/api/projects/p2/tasks", json={"title": "이관 대상 정리"})
    granted = await client.put("/api/projects/p2/members/u1", json={"role": "user"})
    assert granted.status_code in (200, 201)
    task_id = made.json()["id"]
    assert (await client.patch(f"/api/tasks/{task_id}", json={"ownerId": "u1"})).status_code == 200
    await link(client, task_id, "t10")
    decided = await decide(client, "t10", "x")
    assert decided.status_code == 200
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


async def test_hard_deleting_the_agenda_deletes_the_checks(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for id_ in ("t1", "t2"):
        row = await session.get(Agenda, id_)
        assert row is not None
        await session.delete(row)
    await session.commit()
    assert (await client.get("/api/projects/p1/checks")).json() == []

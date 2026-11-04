"""안건 쓰기 API — 등록 · 부분 수정 · 삭제 (docs/api/agenda.md).

상태 · 결정내용은 사람이 PATCH 로 바꾼다. 결정 시각(`decidedAt`) · 결정 판(`decisionRev`)은
서버만 정한다 — 그 규칙을 여기서 못 박는다.
"""

from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import Agenda, CheckRequest, TaskAgendaLink, TestRef
from app.services import search as search_service
from tests.conftest import AsMember
from tests.test_read_api import AGENDA_KEYS


async def add(c: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    res = await c.post("/api/projects/p1/agendas", json={"title": "로그 보관 기간", **body})
    assert res.status_code == 201, res.text
    created: dict[str, Any] = res.json()
    return created


async def patch(c: httpx.AsyncClient, agenda_id: str, **body: Any) -> dict[str, Any]:
    res = await c.patch(f"/api/agendas/{agenda_id}", json=body)
    assert res.status_code == 200, res.text
    patched: dict[str, Any] = res.json()
    return patched


# --- 등록 ---


async def test_add_answers_with_an_agenda(client: httpx.AsyncClient) -> None:
    agenda = await add(client, ownerId="u2")

    assert set(agenda) == AGENDA_KEYS
    assert agenda["state"] == "queued"  # 안 보내면 대기
    assert agenda["ownerId"] == "u2"
    assert agenda["decision"] == "" and agenda["description"] == ""
    assert agenda["decidedAt"] is None and agenda["decisionRev"] == 0
    assert agenda["createdAt"].endswith("Z")  # ISO 8601 UTC (API.md Q3)


async def test_add_takes_the_four_fields_and_the_properties(client: httpx.AsyncClient) -> None:
    agenda = await add(
        client,
        title="  로그 보관 기간  ",
        description="감사 대응 기준이 없어 보관 정책을 못 정한다.",
        decision="1년 보관한다",
        state="open",
        dueDate="2026-10-31",
        partId="pt1",
    )
    assert agenda["title"] == "로그 보관 기간"  # 앞뒤 공백을 뗀다
    assert agenda["description"] == "감사 대응 기준이 없어 보관 정책을 못 정한다."
    assert agenda["decision"] == "1년 보관한다"
    assert agenda["state"] == "open"
    assert agenda["dueDate"] == "2026-10-31"
    assert agenda["partId"] == "pt1"
    # 결정내용이 생겼으니 판 1, 결정된 것은 아니라 시각은 없다
    assert agenda["decisionRev"] == 1 and agenda["decidedAt"] is None

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert snap["agendas"][-1] == agenda  # 다시 읽어도 같은 모양 · 맨 뒤


async def test_add_as_decided_stamps_the_creation_time(client: httpx.AsyncClient) -> None:
    agenda = await add(client, state="decided")
    # 결정내용이 비어도 decided 로 둘 수 있다
    assert agenda["decision"] == ""
    assert agenda["decidedAt"] == agenda["createdAt"]
    assert agenda["decisionRev"] == 1


@pytest.mark.parametrize(
    "body",
    [{"title": ""}, {"title": "   "}, {}, {"title": "x", "state": "deferred"}],
    ids=["empty", "blank", "missing", "bad-state"],
)
async def test_add_rejects_bad_input(client: httpx.AsyncClient, body: dict[str, Any]) -> None:
    res = await client.post("/api/projects/p1/agendas", json=body)
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_ERROR"


async def test_add_rejects_a_malformed_due_date(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/agendas", json={"title": "x", "dueDate": "10월 31일"})
    assert res.status_code == 422


async def test_add_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/agendas", json={"title": "x"})
    assert res.status_code == 404


async def test_add_with_an_unknown_owner_is_400(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/agendas", json={"title": "x", "ownerId": "nope"})
    assert res.status_code == 400
    assert res.json()["code"] == "AGENDA_OWNER_NOT_FOUND"


async def test_removed_fields_are_ignored(client: httpx.AsyncClient) -> None:
    """후보 · 참조 · 상위 안건은 걷어냈다 — 실어 와도 버린다. 서버가 정하는 칸도 그렇다."""
    agenda = await add(
        client,
        options=["가", "나"],
        ccIds=["u1"],
        parentAgendaId="t1",
        decisionRev=9,
        decidedAt="2026-01-01T00:00:00Z",
    )
    assert set(agenda) == AGENDA_KEYS
    assert agenda["decisionRev"] == 0 and agenda["decidedAt"] is None


# --- 부분 수정 ---


async def test_patch_changes_only_what_was_sent(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t1", description="배경을 고쳐 적는다.")

    assert set(agenda) == AGENDA_KEYS
    assert agenda["description"] == "배경을 고쳐 적는다."
    # 안 보낸 것은 그대로다
    assert agenda["title"] == "서버 OS 결정"
    assert agenda["decision"] == "우분투 최신 버전으로 한다"
    assert agenda["ownerId"] == "u3"
    assert agenda["dueDate"] == "2026-09-12"
    assert agenda["state"] == "decided"
    assert agenda["decidedAt"] == "2026-09-09T02:00:00Z"
    assert agenda["decisionRev"] == 1


async def test_patch_trims_the_title(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t4", title="  개발 서버 백업 주기와 보관  ")
    assert agenda["title"] == "개발 서버 백업 주기와 보관"


async def test_patch_null_clears_owner_due_date_and_part(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t3", ownerId=None, dueDate=None, partId=None)
    assert agenda["ownerId"] is None
    assert agenda["dueDate"] is None
    assert agenda["partId"] is None
    assert agenda["description"].startswith("가상비서가")  # 안 보낸 것은 그대로


async def test_patch_sets_owner_and_due_date(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t4", ownerId="u2", dueDate="2026-10-31")
    assert agenda["ownerId"] == "u2"
    assert agenda["dueDate"] == "2026-10-31"


async def test_patch_rejects_a_blank_title(client: httpx.AsyncClient) -> None:
    for title in ("", "   "):
        res = await client.patch("/api/agendas/t1", json={"title": title})
        assert res.status_code == 422
        assert "title" in res.json()["detail"]


@pytest.mark.parametrize("field", ["title", "description", "decision", "state"])
async def test_patch_rejects_null_where_empty_is_not_null(
    client: httpx.AsyncClient, field: str
) -> None:
    """네 칸은 빈 값이 '' 이거나 비울 수 없다 — null 은 비우기로 받지 않는다."""
    res = await client.patch("/api/agendas/t1", json={field: None})
    assert res.status_code == 422
    assert field in res.json()["detail"]


async def test_patch_rejects_an_unknown_state(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/agendas/t1", json={"state": "deferred"})
    assert res.status_code == 422


async def test_patch_on_unknown_agenda_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/agendas/없는안건", json={"title": "x"})
    assert res.status_code == 404
    assert res.json()["code"] == "AGENDA_NOT_FOUND"


# --- 결정 시각 · 결정 판 (docs/api/agenda.md '모양') ---


async def test_deciding_stamps_the_time_and_raises_the_rev(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t4", decision="매일 새벽 2시", state="decided")
    # 한 요청에 결정내용 · 상태가 다 바뀌어도 판은 1 만 오른다
    assert agenda["decisionRev"] == 1
    assert agenda["decidedAt"] is not None and agenda["decidedAt"].endswith("Z")


async def test_leaving_decided_clears_the_time(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t1", state="open")
    assert agenda["state"] == "open"
    assert agenda["decidedAt"] is None
    assert agenda["decisionRev"] == 1  # 결정내용이 그대로라 판도 그대로

    again = await patch(client, "t1", state="decided")
    assert again["decidedAt"] is not None
    assert again["decisionRev"] == 2  # decided 로 들어서면 오른다


async def test_staying_decided_keeps_the_time(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t1", state="decided", title="서버 OS")
    assert agenda["decidedAt"] == "2026-09-09T02:00:00Z"
    assert agenda["decisionRev"] == 1


async def test_rev_follows_the_trimmed_decision(client: httpx.AsyncClient) -> None:
    same = await patch(client, "t1", decision="  우분투 최신 버전으로 한다\n")
    assert same["decisionRev"] == 1  # 앞뒤 공백만 다르면 같은 결정이다

    changed = await patch(client, "t1", decision="우분투 24.04 로 한다")
    assert changed["decisionRev"] == 2
    assert changed["decidedAt"] == "2026-09-09T02:00:00Z"  # 상태는 그대로 decided

    cleared = await patch(client, "t1", decision="")
    assert cleared["decisionRev"] == 3 and cleared["state"] == "decided"


async def test_rev_and_time_cannot_be_sent(client: httpx.AsyncClient) -> None:
    agenda = await patch(client, "t3", decisionRev=7, decidedAt="2026-01-01T00:00:00Z")
    assert agenda["decisionRev"] == 0 and agenda["decidedAt"] is None


# --- 걷어낸 길 ---


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/agendas/t1/entries"),
        ("PATCH", "/api/agendas/t1/entries/e1"),
        ("DELETE", "/api/agendas/t1/entries/e1"),
        ("POST", "/api/agendas/t1/items"),
        ("PATCH", "/api/agendas/t1/items/di1"),
        ("DELETE", "/api/agendas/t1/items/di1"),
        ("POST", "/api/projects/p1/threads"),
        ("PATCH", "/api/threads/t1"),
    ],
)
async def test_removed_paths_are_gone(client: httpx.AsyncClient, method: str, path: str) -> None:
    res = await client.request(method, path, json={"kind": "decide", "text": "x"})
    assert res.status_code in (404, 405)


# --- 작성자 · 논리 삭제 ---


async def test_creator_is_the_requester_and_cannot_be_sent(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    made = await u2.post("/api/projects/p1/agendas", json={"title": "새", "creatorId": "u3"})
    assert made.status_code == 201 and made.json()["creatorId"] == "u2"
    patched = await u2.patch(
        f"/api/agendas/{made.json()['id']}", json={"creatorId": "u3", "title": "새2"}
    )
    assert patched.status_code == 200 and patched.json()["creatorId"] == "u2"


async def test_seed_creator_is_the_owner(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert all(t["creatorId"] == t["ownerId"] for t in snap["agendas"])


async def test_delete_agenda_is_logical_and_hides_it_everywhere(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """t2 — 링크(k4 · k22) · 확인 요청(c1 ~ c3) · 테스트 참조가 걸린 안건."""
    before_badge = (await (await as_member("u3")).get("/api/checks/pending-count")).json()
    assert (await client.delete("/api/agendas/t2")).status_code == 204

    session.expire_all()
    row = await session.get(Agenda, "t2")
    assert row is not None
    assert row.is_deleted is True and row.deleted_by == "admin" and row.deleted_at is not None
    # 딸린 줄은 DB 에 남는다
    for model, column in (
        (TaskAgendaLink, TaskAgendaLink.agenda_id),
        (CheckRequest, CheckRequest.agenda_id),
        (TestRef, TestRef.agenda_id),
    ):
        left = await session.scalar(select(func.count()).select_from(model).where(column == "t2"))
        assert left, model.__name__

    # 안건으로 가는 길은 전부 404
    for method, url, body in [
        ("DELETE", "/api/agendas/t2", None),
        ("PATCH", "/api/agendas/t2", {"title": "살리기"}),
        ("GET", "/api/agendas/t2/history", None),
        ("POST", "/api/agendas/t2/checks", None),
        ("PUT", "/api/tasks/k1/agendas/t2", None),
        ("PUT", "/api/tests/tc1/refs/agenda/t2", None),
    ]:
        res = await client.request(method, url, json=body)
        assert res.status_code == 404, (method, url)
        assert res.json()["code"] == "AGENDA_NOT_FOUND", (method, url)
    # 확인 요청 id 로 가도 없는 것과 같다
    res = await (await as_member("u3")).post("/api/checks/c1/confirm")
    assert res.status_code == 404 and res.json()["code"] == "CHECK_NOT_FOUND"
    # 작업 등록에서 걸어도 없는 안건이다
    res = await client.post("/api/projects/p1/tasks", json={"title": "x", "agendaIds": ["t2"]})
    assert res.status_code == 404 and res.json()["code"] == "AGENDA_NOT_FOUND"

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert "t2" not in {t["id"] for t in snap["agendas"]}
    assert all(link["agendaId"] != "t2" for link in snap["taskAgendaLinks"])

    checks = (await client.get("/api/projects/p1/checks")).json()
    assert all(c["agendaId"] != "t2" for c in checks)
    after_badge = (await (await as_member("u3")).get("/api/checks/pending-count")).json()
    assert after_badge["total"] == before_badge["total"] - 1  # c1 이 빠졌다

    tests = (await client.get("/api/projects/p1/tests")).json()
    assert all(ref["id"] != "t2" for row in tests for ref in row["refs"])
    risks = await client.get("/api/projects/p1/risks")
    assert risks.status_code == 200 and '"t2"' not in risks.text

    # 챗봇 도구도 못 읽는다
    with pytest.raises(ApiError) as caught:
        await search_service.get_agenda(session, "p1", "t2")
    assert caught.value.code == "AGENDA_NOT_FOUND"
    task = await search_service.get_task(session, "p1", "k4")
    assert "t2" not in {t.id for t in task.agendas}

    # 회의록 반영도 없는 안건으로 본다
    res = await client.post(
        "/api/minutes/m1/apply",
        json={"updates": [{"agendaId": "t2", "decision": "x", "state": "decided"}]},
    )
    assert res.status_code == 400 and res.json()["code"] == "AGENDA_NOT_FOUND"
    assert res.json()["detail"] == {"updates.0.agendaId": "안건을 찾을 수 없습니다."}

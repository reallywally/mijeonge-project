"""안건 쓰기 API — 등록 · 부분 수정 · 삭제 · 이력 한 줄 · 이력 줄 고치기 · 지우기.

**줄 하나가 안건 상태를 바꾼다.** 지금 `stores/thread.ts` 가 하는 계산을 서버로 옮긴 것이라
전이 규칙을 여기서 못 박는다. 부분 수정(PATCH)은 상태를 못 바꾼다.
"""

from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import CheckRequest, Entry, Member, TaskThreadLink, TestRef, Thread
from app.services import search as search_service
from tests.conftest import AsMember
from tests.test_read_api import ENTRY_KEYS, THREAD_KEYS


async def test_add_thread_answers_with_a_thread(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/threads", json={"title": "로그 보관 기간", "ownerId": "u2"}
    )
    assert res.status_code == 201
    thread = res.json()

    assert set(thread) == THREAD_KEYS
    assert thread["state"] == "queued"  # 등록만 된 상태
    assert thread["ownerId"] == "u2"
    assert thread["parentThreadId"] is None
    assert thread["createdAt"].endswith("Z")  # ISO 8601 UTC (API.md Q3)


async def test_add_thread_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/threads", json={"title": "x"})
    assert res.status_code == 404


async def test_new_thread_shows_up_at_the_end_of_the_snapshot(client: httpx.AsyncClient) -> None:
    thread = (
        await client.post("/api/projects/p1/threads", json={"title": "로그 보관 기간"})
    ).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["threads"][-1]["id"] == thread["id"]


async def test_entry_answers_with_entry_and_thread(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/threads/t4/entries",
        json={
            "kind": "decide",
            "text": "기간계와 같은 주기로 맞춘다",
            "detail": ["일 1회 전체 백업", "보관은 30일"],
            "note": "기간계 담당자에게 확인받았다",
            "ownerId": "u2",
        },
    )
    assert res.status_code == 201
    body = res.json()

    assert set(body) == {"entry", "thread"}
    assert set(body["entry"]) == ENTRY_KEYS
    assert body["entry"]["detail"] == ["일 1회 전체 백업", "보관은 30일"]
    assert body["entry"]["createdAt"].endswith("Z")


async def test_decide_settles_the_thread_and_moves_the_owner(client: httpx.AsyncClient) -> None:
    body = (
        await client.post(
            "/api/threads/t4/entries",
            json={"kind": "decide", "text": "기간계와 맞춘다", "ownerId": "u2"},
        )
    ).json()

    assert body["thread"]["state"] == "decided"
    assert body["thread"]["ownerId"] == "u2"  # t4 는 담당자가 없었다


async def test_defer_moves_queued_to_open(client: httpx.AsyncClient) -> None:
    body = (
        await client.post(
            "/api/threads/t4/entries",
            json={"kind": "defer", "text": "이번에는 못 정했다", "ownerId": "u1"},
        )
    ).json()

    assert body["thread"]["state"] == "open"
    assert body["thread"]["ownerId"] is None  # 미룸은 담당자를 옮기지 않는다


async def test_defer_does_not_undo_a_decision(client: httpx.AsyncClient) -> None:
    """t1 은 이미 decided 다. 한 번 정해진 것은 미룸 한 줄로 되돌아가지 않는다."""
    body = (
        await client.post(
            "/api/threads/t1/entries", json={"kind": "defer", "text": "다시 볼 거리가 있다"}
        )
    ).json()

    assert body["thread"]["state"] == "decided"


async def test_change_settles_too(client: httpx.AsyncClient) -> None:
    body = (
        await client.post(
            "/api/threads/t5/entries",
            json={"kind": "change", "text": "앞의 결정을 바꾼다", "ownerId": "u1"},
        )
    ).json()

    assert body["thread"]["state"] == "decided"
    assert body["thread"]["ownerId"] == "u1"


async def test_server_takes_every_kind(client: httpx.AsyncClient) -> None:
    """화면은 decide · refine · defer 셋만 보내지만 모델의 kind 는 여섯이다."""
    for kind in ("raise", "refine", "split"):
        res = await client.post("/api/threads/t4/entries", json={"kind": kind, "text": kind})
        assert res.status_code == 201

    bad = await client.post("/api/threads/t4/entries", json={"kind": "미룸", "text": "x"})
    assert bad.status_code == 422


async def test_entry_on_unknown_thread_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/threads/없는안건/entries", json={"kind": "decide", "text": "x"})
    assert res.status_code == 404


async def test_written_entry_shows_up_at_the_end_of_the_snapshot(
    client: httpx.AsyncClient,
) -> None:
    """등록 순서(seq)가 제대로 채워졌는지 — 안건 이력이 배열 인덱스로 같은 날을 가른다."""
    body = (
        await client.post(
            "/api/threads/t4/entries", json={"kind": "decide", "text": "기간계와 맞춘다"}
        )
    ).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["entries"][-1]["id"] == body["entry"]["id"]
    assert len(snap["entries"]) == 7
    assert next(t for t in snap["threads"] if t["id"] == "t4")["state"] == "decided"


async def test_add_thread_keeps_description_options_and_due_date(
    client: httpx.AsyncClient,
) -> None:
    res = await client.post(
        "/api/projects/p1/threads",
        json={
            "title": "로그 보관 기간",
            "description": "감사 대응 기준이 없어 보관 정책을 못 정한다.",
            "options": ["90일", "1년", "3년"],
            "dueDate": "2026-10-31",
        },
    )
    assert res.status_code == 201
    thread = res.json()

    assert thread["description"] == "감사 대응 기준이 없어 보관 정책을 못 정한다."
    assert thread["options"] == ["90일", "1년", "3년"]  # 보낸 순서 그대로
    assert thread["dueDate"] == "2026-10-31"  # Task.start · due 와 같은 YYYY-MM-DD

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert snap["threads"][-1] == thread  # 다시 읽어도 같은 모양 · 같은 순서


async def test_add_thread_without_context_gets_empty_values(client: httpx.AsyncClient) -> None:
    """빈 값은 '' · [] 다 — null 은 dueDate 만 허락된다."""
    thread = (
        await client.post("/api/projects/p1/threads", json={"title": "로그 보관 기간"})
    ).json()

    assert thread["description"] == ""
    assert thread["options"] == []
    assert thread["dueDate"] is None


async def test_add_thread_rejects_a_malformed_due_date(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/threads", json={"title": "x", "dueDate": "10월 31일"})
    assert res.status_code == 422


async def test_snapshot_folds_options_in_order(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    by_id = {t["id"]: t for t in snap["threads"]}

    assert by_id["t1"]["options"] == ["우분투", "록키", "CentOS"]
    assert by_id["t1"]["dueDate"] == "2026-09-12"
    assert by_id["t3"]["options"] == ["전면 허용", "비식별 데이터만 허용", "사내 모델만 사용"]
    # 정답이 열려 있는 안건 — 배경과 기한은 있고 후보는 비었다
    assert by_id["t5"]["options"] == []
    assert by_id["t5"]["description"].startswith("보험료 산출 기간계 API")
    assert by_id["t5"]["dueDate"] == "2026-10-19"
    # 나머지는 빈 값
    assert by_id["t4"]["description"] == ""
    assert by_id["t4"]["options"] == []
    assert by_id["t4"]["dueDate"] is None


async def test_patch_changes_only_what_was_sent(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/t1", json={"description": "배경을 고쳐 적는다."})
    assert res.status_code == 200
    thread = res.json()

    assert set(thread) == THREAD_KEYS
    assert thread["description"] == "배경을 고쳐 적는다."
    # 안 보낸 것은 그대로다
    assert thread["title"] == "서버 OS 결정"
    assert thread["ownerId"] == "u3"
    assert thread["options"] == ["우분투", "록키", "CentOS"]
    assert thread["dueDate"] == "2026-09-12"
    assert thread["state"] == "decided"


async def test_patch_trims_the_title(client: httpx.AsyncClient) -> None:
    thread = (
        await client.patch("/api/threads/t4", json={"title": "  개발 서버 백업 주기와 보관  "})
    ).json()
    assert thread["title"] == "개발 서버 백업 주기와 보관"


async def test_patch_null_clears_owner_and_due_date(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/t3", json={"ownerId": None, "dueDate": None})
    assert res.status_code == 200
    thread = res.json()

    assert thread["ownerId"] is None
    assert thread["dueDate"] is None
    assert thread["description"].startswith("가상비서가")  # 안 보낸 것은 그대로

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    again = next(t for t in snap["threads"] if t["id"] == "t3")
    assert again["ownerId"] is None and again["dueDate"] is None


async def test_patch_sets_owner_and_due_date(client: httpx.AsyncClient) -> None:
    thread = (
        await client.patch("/api/threads/t4", json={"ownerId": "u2", "dueDate": "2026-10-31"})
    ).json()
    assert thread["ownerId"] == "u2"
    assert thread["dueDate"] == "2026-10-31"


async def test_patch_replaces_options_in_the_order_sent(client: httpx.AsyncClient) -> None:
    thread = (
        await client.patch("/api/threads/t1", json={"options": ["CentOS", "우분투 LTS"]})
    ).json()
    assert thread["options"] == ["CentOS", "우분투 LTS"]  # 옛 후보는 남지 않는다

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert next(t for t in snap["threads"] if t["id"] == "t1")["options"] == [
        "CentOS",
        "우분투 LTS",
    ]

    emptied = (await client.patch("/api/threads/t1", json={"options": []})).json()
    assert emptied["options"] == []


async def test_patch_rejects_a_blank_title(client: httpx.AsyncClient) -> None:
    for title in ("", "   "):
        res = await client.patch("/api/threads/t1", json={"title": title})
        assert res.status_code == 422
        body = res.json()
        assert body["code"] == "VALIDATION_ERROR"
        assert "title" in body["detail"]

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert next(t for t in snap["threads"] if t["id"] == "t1")["title"] == "서버 OS 결정"


async def test_patch_rejects_null_where_empty_is_not_null(client: httpx.AsyncClient) -> None:
    """title · description · options 는 빈 값이 '' · [] 다 — null 은 비우기로 받지 않는다."""
    for field in ("title", "description", "options"):
        res = await client.patch("/api/threads/t1", json={field: None})
        assert res.status_code == 422, field


async def test_patch_on_unknown_thread_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/없는안건", json={"title": "x"})
    assert res.status_code == 404
    assert res.json()["code"] == "THREAD_NOT_FOUND"


async def test_patch_ignores_state(client: httpx.AsyncClient) -> None:
    """상태는 이력으로만 바뀐다 — PATCH 로 보낸 state 는 무시된다."""
    res = await client.patch("/api/threads/t4", json={"state": "decided", "title": "백업 주기"})
    assert res.status_code == 200
    thread = res.json()
    assert thread["state"] == "queued"
    assert thread["title"] == "백업 주기"


# --- 참조(ccIds) — docs/api/check.md '참조' ---


async def test_add_thread_keeps_cc_in_order_without_duplicates(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/threads",
        json={"title": "로그 보관 기간", "ownerId": "u2", "ccIds": ["u4", "u2", "u4", "u1"]},
    )
    assert res.status_code == 201
    # 겹친 사람은 처음 자리 하나로. 안건 담당자를 넣어도 된다
    assert res.json()["ccIds"] == ["u4", "u2", "u1"]
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert snap["threads"][-1]["ccIds"] == ["u4", "u2", "u1"]


async def test_add_thread_without_cc_gets_empty_list(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/threads", json={"title": "로그 보관 기간"})
    assert res.json()["ccIds"] == []


async def test_snapshot_carries_seed_cc(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    cc = {t["id"]: t["ccIds"] for t in snap["threads"]}
    assert cc["t1"] == ["u1"]
    assert cc["t2"] == ["u2", "u4"]
    assert cc["t6"] == ["u2"]
    # 없으면 null 이 아니라 []
    assert cc["t3"] == [] and cc["t4"] == []


async def test_patch_replaces_cc_and_leaves_it_when_not_sent(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/t2", json={"ccIds": ["u4", "u1", "u4"]})
    assert res.status_code == 200
    assert res.json()["ccIds"] == ["u4", "u1"]
    # 안 보내면 그대로
    res = await client.patch("/api/threads/t2", json={"title": "DB 결정 (확정)"})
    assert res.json()["ccIds"] == ["u4", "u1"]
    # 비우기는 []
    res = await client.patch("/api/threads/t2", json={"ccIds": []})
    assert res.json()["ccIds"] == []
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert next(t for t in snap["threads"] if t["id"] == "t2")["ccIds"] == []


async def test_patch_rejects_null_cc(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/t2", json={"ccIds": None})
    assert res.status_code == 422
    assert "ccIds" in res.json()["detail"]


async def test_more_than_20_cc_is_422(client: httpx.AsyncClient) -> None:
    # 개수는 합치기 전에 센다 — 같은 사람 21번이어도 넘친다
    too_many = ["u1"] * 21
    created = await client.post("/api/projects/p1/threads", json={"title": "x", "ccIds": too_many})
    patched = await client.patch("/api/threads/t2", json={"ccIds": too_many})
    for res in (created, patched):
        assert res.status_code == 422
        assert res.json()["code"] == "VALIDATION_ERROR"
        assert "ccIds" in res.json()["detail"]
    assert (await client.patch("/api/threads/t2", json={"ccIds": ["u1"] * 20})).status_code == 200


async def test_cc_must_be_active_grants(client: httpx.AsyncClient) -> None:
    """admin 은 p1 에 부여되지 않았고, u3 은 부여를 뺐고, ghost 는 없다."""
    assert (await client.delete("/api/projects/p1/members/u3")).status_code == 204
    body = {"ccIds": ["u1", "admin", "ghost", "u3", "admin"]}
    for res in (
        await client.post("/api/projects/p1/threads", json={"title": "x", **body}),
        await client.patch("/api/threads/t6", json=body),
    ):
        assert res.status_code == 400
        error = res.json()
        assert error["code"] == "MEMBER_NOT_IN_PROJECT"
        # 걸린 자리 전부
        assert set(error["detail"]) == {"ccIds.1", "ccIds.2", "ccIds.3", "ccIds.4"}
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert next(t for t in snap["threads"] if t["id"] == "t6")["ccIds"] == ["u2"]


async def test_cc_already_there_may_stay_when_it_goes_inactive(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """담당자와 같다 — 이미 걸려 있던 사람을 그대로 두는 수정은 막지 않는다. 새로 넣는 것만 본다."""
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    res = await client.patch("/api/threads/t2", json={"ccIds": ["u2", "u4", "u1"]})
    assert res.status_code == 200
    assert res.json()["ccIds"] == ["u2", "u4", "u1"]
    res = await client.patch("/api/threads/t6", json={"ccIds": ["u2", "u4"]})
    assert res.status_code == 400
    assert res.json()["detail"] == {
        "ccIds.1": "이 프로젝트에 부여되지 않았거나 비활성인 사람입니다."
    }


async def test_patch_entry_fixes_the_text_and_keeps_the_rest(client: httpx.AsyncClient) -> None:
    """실수로 Enter 를 눌러 남긴 결정을 바로잡는다 — 글만 바뀌고 상태 · kind 는 그대로다."""
    res = await client.patch(
        "/api/threads/t1/entries/e1", json={"text": "  우분투 24.04 LTS 로 한다  "}
    )
    assert res.status_code == 200
    entry = res.json()
    assert set(entry) == ENTRY_KEYS
    assert entry["text"] == "우분투 24.04 LTS 로 한다"
    assert entry["note"] == "PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다."
    assert entry["kind"] == "decide"

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    saved = next(e for e in snap["entries"] if e["id"] == "e1")
    assert saved["text"] == "우분투 24.04 LTS 로 한다"
    assert next(t for t in snap["threads"] if t["id"] == "t1")["state"] == "decided"


async def test_patch_entry_may_empty_the_note(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/threads/t1/entries/e1", json={"note": "  "})
    assert res.status_code == 200
    assert res.json()["note"] == ""


async def test_patch_entry_rejects_blank_text_and_null(client: httpx.AsyncClient) -> None:
    for body in ({"text": "   "}, {"text": None}, {"note": None}):
        res = await client.patch("/api/threads/t1/entries/e1", json=body)
        assert res.status_code == 422, body


async def test_patch_entry_of_another_thread_is_404(client: httpx.AsyncClient) -> None:
    # e2 는 t5 의 줄이다 — 경로의 안건과 맞아야 한다
    res = await client.patch("/api/threads/t1/entries/e2", json={"text": "x"})
    assert res.status_code == 404
    assert res.json()["code"] == "ENTRY_NOT_FOUND"
    res = await client.patch("/api/threads/t1/entries/없는줄", json={"text": "x"})
    assert res.status_code == 404


# --- 작성자 · 논리 삭제 (2026-11-02) ------------------------------------------------------------


async def test_creator_is_the_requester_and_cannot_be_sent(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    made = await u2.post("/api/projects/p1/threads", json={"title": "새", "creatorId": "u3"})
    assert made.status_code == 201 and made.json()["creatorId"] == "u2"
    thread_id = made.json()["id"]
    added = await u2.post(
        f"/api/threads/{thread_id}/entries",
        json={"kind": "refine", "text": "다듬음", "creatorId": "u3"},
    )
    assert added.status_code == 201 and added.json()["entry"]["creatorId"] == "u2"
    patched = await u2.patch(f"/api/threads/{thread_id}", json={"creatorId": "u3", "title": "새2"})
    assert patched.status_code == 200 and patched.json()["creatorId"] == "u2"


async def test_seed_creator_is_the_owner(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert all(t["creatorId"] == t["ownerId"] for t in snap["threads"])
    assert all(e["creatorId"] == e["ownerId"] for e in snap["entries"])


async def test_delete_thread_is_logical_and_hides_it_everywhere(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """t2 — 링크(k4 · k22) · 확인 요청(c1 ~ c3) · 테스트 참조 · 결정 e3 이 걸린 안건."""
    before_badge = (await (await as_member("u3")).get("/api/checks/pending-count")).json()
    assert (await client.delete("/api/threads/t2")).status_code == 204

    session.expire_all()
    row = await session.get(Thread, "t2")
    assert row is not None
    assert row.is_deleted is True and row.deleted_by == "admin" and row.deleted_at is not None
    # 딸린 줄은 DB 에 남는다
    for model, column in (
        (Entry, Entry.thread_id),
        (TaskThreadLink, TaskThreadLink.thread_id),
        (CheckRequest, CheckRequest.thread_id),
        (TestRef, TestRef.thread_id),
    ):
        left = await session.scalar(select(func.count()).select_from(model).where(column == "t2"))
        assert left, model.__name__

    # 안건으로 가는 길은 전부 404
    for method, url, body in [
        ("DELETE", "/api/threads/t2", None),
        ("PATCH", "/api/threads/t2", {"title": "살리기"}),
        ("POST", "/api/threads/t2/entries", {"kind": "refine", "text": "또"}),
        ("PATCH", "/api/threads/t2/entries/e3", {"text": "고침"}),
        ("DELETE", "/api/threads/t2/entries/e3", None),
        ("GET", "/api/threads/t2/history", None),
        ("POST", "/api/threads/t2/checks", None),
        ("PUT", "/api/tasks/k1/threads/t2", None),
        ("PUT", "/api/tests/tc1/refs/thread/t2", None),
    ]:
        res = await client.request(method, url, json=body)
        assert res.status_code == 404, (method, url)
        assert res.json()["code"] == "THREAD_NOT_FOUND", (method, url)
    # 확인 요청 id 로 가도 없는 것과 같다
    res = await (await as_member("u3")).post("/api/checks/c1/confirm")
    assert res.status_code == 404 and res.json()["code"] == "CHECK_NOT_FOUND"
    # 작업 등록에서 걸어도 없는 안건이다
    res = await client.post("/api/projects/p1/tasks", json={"title": "x", "threadIds": ["t2"]})
    assert res.status_code == 404 and res.json()["code"] == "THREAD_NOT_FOUND"

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert "t2" not in {t["id"] for t in snap["threads"]}
    assert "e3" not in {e["id"] for e in snap["entries"]}
    assert all(link["threadId"] != "t2" for link in snap["taskThreadLinks"])

    checks = (await client.get("/api/projects/p1/checks")).json()
    assert all(c["threadId"] != "t2" for c in checks)
    after_badge = (await (await as_member("u3")).get("/api/checks/pending-count")).json()
    assert after_badge["total"] == before_badge["total"] - 1  # c1 이 빠졌다

    tests = (await client.get("/api/projects/p1/tests")).json()
    assert all(ref["id"] != "t2" for row in tests for ref in row["refs"])
    risks = await client.get("/api/projects/p1/risks")
    assert risks.status_code == 200 and '"t2"' not in risks.text

    # 챗봇 도구도 못 읽는다
    with pytest.raises(ApiError) as caught:
        await search_service.get_thread(session, "p1", "t2")
    assert caught.value.code == "THREAD_NOT_FOUND"
    task = await search_service.get_task(session, "p1", "k4")
    assert "t2" not in {t.id for t in task.threads}

    # 회의록 반영도 없는 안건으로 본다
    res = await client.post(
        "/api/minutes/m1/apply",
        json={
            "threads": [],
            "entries": [
                {
                    "tempId": "o1",
                    "threadId": "t2",
                    "kind": "decide",
                    "text": "x",
                    "detail": [],
                    "note": "",
                    "ownerId": None,
                    "ownerHint": "",
                    "quote": "",
                }
            ],
            "tasks": [],
        },
    )
    assert res.status_code == 400 and res.json()["code"] == "THREAD_NOT_FOUND"


async def test_thread_with_a_split_child_is_409(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    # 떼어내는 API 는 아직 없다 — 칸을 바로 찍는다. t4 를 t3 에서 떼어냈다
    await session.execute(update(Thread).where(Thread.id == "t4").values(parent_thread_id="t3"))
    await session.commit()
    # 권한이 먼저다 — t3 은 u1 담당 · 등록, u2 는 남
    assert (await (await as_member("u2")).delete("/api/threads/t3")).status_code == 403
    res = await client.delete("/api/threads/t3")
    assert res.status_code == 409
    assert res.json() == {
        "code": "THREAD_HAS_CHILDREN",
        "message": "떼어낸 하위 안건이 있어 지울 수 없습니다. 하위 안건을 먼저 지우세요.",
    }
    # 하위를 지우면 지워진다 — 지운 하위는 세지 않는다
    assert (await client.delete("/api/threads/t4")).status_code == 204
    assert (await client.delete("/api/threads/t3")).status_code == 204


async def test_delete_entry_recounts_the_state(client: httpx.AsyncClient) -> None:
    """남은 줄에 decide · change 가 있으면 decided, 줄이 있으면 open, 없으면 queued."""
    made = (await client.post("/api/projects/p1/threads", json={"title": "셈"})).json()
    tid = made["id"]
    ids = []
    for kind, owner in (("defer", None), ("decide", "u2"), ("change", None)):
        res = await client.post(
            f"/api/threads/{tid}/entries", json={"kind": kind, "text": kind, "ownerId": owner}
        )
        ids.append(res.json()["entry"]["id"])
    defer_id, decide_id, change_id = ids

    res = await client.delete(f"/api/threads/{tid}/entries/{change_id}")
    assert res.status_code == 200
    assert set(res.json()) == {"thread"}
    assert set(res.json()["thread"]) == THREAD_KEYS
    assert res.json()["thread"]["state"] == "decided"  # decide 가 남았다

    res = await client.delete(f"/api/threads/{tid}/entries/{decide_id}")
    thread = res.json()["thread"]
    assert thread["state"] == "open"
    assert thread["ownerId"] == "u2"  # 결정이 바꾼 담당자는 되돌리지 않는다

    res = await client.delete(f"/api/threads/{tid}/entries/{defer_id}")
    assert res.json()["thread"]["state"] == "queued"

    # 지운 줄은 스냅샷에 없고, 그 줄로 가는 길은 404
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert not {defer_id, decide_id, change_id} & {e["id"] for e in snap["entries"]}
    for method, body in (("PATCH", {"text": "살리기"}), ("DELETE", None)):
        res = await client.request(method, f"/api/threads/{tid}/entries/{decide_id}", json=body)
        assert res.status_code == 404 and res.json()["code"] == "ENTRY_NOT_FOUND", method
    res = await client.delete(f"/api/threads/{tid}/entries/없는줄")
    assert res.status_code == 404 and res.json()["code"] == "ENTRY_NOT_FOUND"


async def test_deleted_entry_drops_out_of_decisions_and_risk(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """지운 결정은 '지금의 결정' 이 아니다 — 앞의 결정이 다시 지금의 결정이 된다."""
    res = await client.post(
        "/api/threads/t1/entries", json={"kind": "change", "text": "록키로 바꿈"}
    )
    change_id = res.json()["entry"]["id"]
    assert (await client.delete(f"/api/threads/t1/entries/{change_id}")).status_code == 200
    doc = await search_service.get_thread(session, "p1", "t1")
    assert change_id not in {e.id for e in doc.entries}

    # 확인 요청은 남은 마지막 결정(e1)으로 본다 — c4 가 이미 보냈다
    res = await client.post("/api/threads/t1/checks")
    assert res.status_code == 409 and res.json()["code"] == "CHECK_ALREADY_SENT"

    # t5 의 미룸 둘 가운데 하나를 지우면 미룬 횟수가 하나 준다
    def defers(body: dict[str, Any]) -> int:
        row = next(t for t in body["threads"] if t["threadId"] == "t5")
        count: int = row["deferCount"]
        return count

    before = defers((await client.get("/api/projects/p1/risks")).json())
    assert (await client.delete("/api/threads/t5/entries/e5")).status_code == 200
    after = defers((await client.get("/api/projects/p1/risks")).json())
    assert after == before - 1

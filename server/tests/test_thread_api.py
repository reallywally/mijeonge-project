"""안건 쓰기 API — 등록 · 부분 수정 · 이력 한 줄.

**줄 하나가 안건 상태를 바꾼다.** 지금 `stores/thread.ts` 가 하는 계산을 서버로 옮긴 것이라
전이 규칙을 여기서 못 박는다. 부분 수정(PATCH)은 상태를 못 바꾼다.
"""

import httpx

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

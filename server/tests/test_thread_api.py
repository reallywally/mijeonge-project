"""안건 쓰기 API — 등록과 회의 밖 줄.

**줄 하나가 안건 상태를 바꾼다.** 지금 `stores/thread.ts` 가 하는 계산을 서버로 옮긴 것이라
전이 규칙을 여기서 못 박는다 — 회의 저장(3-1)도 같은 함수를 부른다.
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
    assert "T" not in thread["createdAt"]


async def test_add_thread_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/threads", json={"title": "x"})
    assert res.status_code == 404


async def test_new_thread_shows_up_at_the_end_of_the_snapshot(client: httpx.AsyncClient) -> None:
    thread = (
        await client.post("/api/projects/p1/threads", json={"title": "로그 보관 기간"})
    ).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["threads"][-1]["id"] == thread["id"]


async def test_outside_entry_carries_no_meeting(client: httpx.AsyncClient) -> None:
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
    assert body["entry"]["meetingId"] is None  # 회의 밖 처리
    assert body["entry"]["detail"] == ["일 1회 전체 백업", "보관은 30일"]
    assert "T" not in body["entry"]["createdAt"]


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


async def test_outside_entry_on_unknown_thread_is_404(client: httpx.AsyncClient) -> None:
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

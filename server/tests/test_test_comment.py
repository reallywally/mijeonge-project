"""테스트 조치 내역 — `docs/api/test-comment.md`.

순서 · 등록 · 수정 · 삭제 · 권한 · 경계 · commentCount.

시드에는 조치 내역이 없다(빈 타래로 시작). p1 에 tc1 ~ tc8 이 있고 tc1 은 묶음이다.
"""

from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TestComment
from tests.conftest import AsMember
from tests.test_contract_types import TEST_SHAPES


async def _add(c: httpx.AsyncClient, test_id: str, body: str) -> dict[str, Any]:
    res = await c.post(f"/api/tests/{test_id}/comments", json={"body": body})
    assert res.status_code == 201, res.json()
    added: dict[str, Any] = res.json()
    return added


async def _ids(c: httpx.AsyncClient, test_id: str) -> list[str]:
    res = await c.get(f"/api/tests/{test_id}/comments")
    assert res.status_code == 200
    return [row["id"] for row in res.json()]


async def _count(c: httpx.AsyncClient, test_id: str) -> int:
    count: int = (await c.get(f"/api/tests/{test_id}")).json()["commentCount"]
    return count


async def test_starts_empty(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/tests/tc2/comments")).json() == []
    rows = (await client.get("/api/projects/p1/tests")).json()
    assert all(row["commentCount"] == 0 for row in rows)


async def test_add_trims_and_lists_oldest_first(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u2 = await as_member("u2")
    first = await _add(u2, "tc2", "  로그를 봤다\n  ")
    assert set(first) == TEST_SHAPES["TestComment"]
    assert first["testId"] == "tc2"
    assert first["authorId"] == "u2"
    assert first["body"] == "로그를 봤다"
    assert first["createdAt"].endswith("Z")
    assert first["editedAt"] is None
    second = await _add(client, "tc2", "설정을 고쳤다")
    assert await _ids(client, "tc2") == [first["id"], second["id"]]


async def test_author_is_the_logged_in_member(client: httpx.AsyncClient) -> None:
    for sent in ("u4", "u99", None):
        res = await client.post("/api/tests/tc2/comments", json={"authorId": sent, "body": "메모"})
        assert res.status_code == 201
        assert res.json()["authorId"] == "admin"


async def test_group_takes_comments_too(client: httpx.AsyncClient) -> None:
    added = await _add(client, "tc1", "묶음 전체 조치")
    assert await _ids(client, "tc1") == [added["id"]]


async def test_blank_body_is_422(client: httpx.AsyncClient) -> None:
    for body in ("  \n ", None):
        res = await client.post("/api/tests/tc2/comments", json={"body": body})
        assert res.status_code == 422
        assert res.json()["code"] == "VALIDATION_ERROR"
        assert "body" in res.json()["detail"]


async def test_unknown_test_is_404(client: httpx.AsyncClient) -> None:
    for method, body in (("GET", None), ("POST", {"body": "안녕"})):
        res = await client.request(method, "/api/tests/nope/comments", json=body)
        assert res.status_code == 404
        assert res.json()["code"] == "TEST_NOT_FOUND"


async def test_edit_is_author_only(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    mine = await _add(u2, "tc2", "처음 쓴 말")
    url = f"/api/test-comments/{mine['id']}"
    # 관리자(시스템 · 프로젝트)도 남의 말은 못 고친다
    for other in (client, await as_member("u1"), await as_member("u3")):
        res = await other.patch(url, json={"body": "남의 말"})
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"

    res = await u2.patch(url, json={"body": " 고친 말 "})
    assert res.status_code == 200
    edited = res.json()
    assert edited["body"] == "고친 말"
    assert edited["editedAt"] is not None and edited["editedAt"].endswith("Z")
    assert edited["createdAt"] == mine["createdAt"]

    for body in ("   ", None):
        res = await u2.patch(url, json={"body": body})
        assert res.status_code == 422


async def test_delete_author_or_admins(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    rows = [await _add(u2, "tc2", f"조치 {n}") for n in range(3)]
    urls = [f"/api/test-comments/{row['id']}" for row in rows]

    denied = await (await as_member("u3")).delete(urls[0])
    assert denied.status_code == 403
    assert (await u2.delete(urls[0])).status_code == 204
    assert (await (await as_member("u1")).delete(urls[1])).status_code == 204  # 프로젝트 관리자
    assert (await client.delete(urls[2])).status_code == 204  # 시스템 관리자
    assert await _ids(client, "tc2") == []


async def test_unknown_comment_is_404(client: httpx.AsyncClient) -> None:
    for method, body in (("PATCH", {"body": "안녕"}), ("DELETE", None)):
        res = await client.request(method, "/api/test-comments/nope", json=body)
        assert res.status_code == 404
        assert res.json()["code"] == "TEST_COMMENT_NOT_FOUND"
        assert res.json()["message"] == "조치 내역을 찾을 수 없습니다."


async def test_ungranted_project_looks_missing(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    added = await _add(client, "tc2", "p1 의 조치")
    assert (await client.delete("/api/projects/p1/members/u2")).status_code == 204
    u2 = await as_member("u2")
    for method, url, body, code in (
        ("GET", "/api/tests/tc2/comments", None, "TEST_NOT_FOUND"),
        ("POST", "/api/tests/tc2/comments", {"body": "몰래"}, "TEST_NOT_FOUND"),
        ("PATCH", f"/api/test-comments/{added['id']}", {"body": "몰래"}, "TEST_COMMENT_NOT_FOUND"),
        ("DELETE", f"/api/test-comments/{added['id']}", None, "TEST_COMMENT_NOT_FOUND"),
    ):
        res = await u2.request(method, url, json=body)
        assert res.status_code == 404
        assert res.json()["code"] == code


async def test_comments_go_with_their_test(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    created = await client.post("/api/projects/p1/tests", json={"title": "지울 테스트"})
    test_id = created.json()["id"]
    added = await _add(client, test_id, "곧 사라진다")
    assert (await client.delete(f"/api/tests/{test_id}")).status_code == 204

    res = await client.patch(f"/api/test-comments/{added['id']}", json={"body": "남았나"})
    assert res.status_code == 404
    assert res.json()["code"] == "TEST_COMMENT_NOT_FOUND"
    left = await session.scalar(
        select(func.count()).select_from(TestComment).where(TestComment.test_id == test_id)
    )
    assert left == 0


async def test_comment_count_follows_writes(client: httpx.AsyncClient) -> None:
    rows = [await _add(client, "tc2", f"조치 {n}") for n in range(2)]
    assert await _count(client, "tc2") == 2
    listed = {row["id"]: row for row in (await client.get("/api/projects/p1/tests")).json()}
    assert listed["tc2"]["commentCount"] == 2
    assert listed["tc3"]["commentCount"] == 0

    await client.delete(f"/api/test-comments/{rows[0]['id']}")
    assert await _count(client, "tc2") == 1
    patched = await client.patch("/api/tests/tc2", json={"title": "고친 제목"})
    assert patched.json()["commentCount"] == 1


async def test_comments_leave_history_and_signals_alone(client: httpx.AsyncClient) -> None:
    before = await client.get("/api/tests/tc4")
    history = (await client.get("/api/tests/tc4/history")).json()
    added = await _add(client, "tc4", "기준 안건을 다시 봤다")
    await client.patch(f"/api/test-comments/{added['id']}", json={"body": "다시 봤다"})

    after = (await client.get("/api/tests/tc4")).json()
    expected = {**before.json(), "commentCount": 1}
    assert after == expected  # 상태 · 며칠째 · 신호 · 기준 바뀜 그대로
    assert (await client.get("/api/tests/tc4/history")).json() == history

    await client.delete(f"/api/test-comments/{added['id']}")
    assert (await client.get("/api/tests/tc4/history")).json() == history

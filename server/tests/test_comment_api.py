"""작업 댓글 API — 순서 · 등록 · 수정 · 삭제 · 빈 본문 · 404 · 작업과 함께 지워짐 · commentCount.

시드에는 픽스처대로 k4 에 둘(cm1 · cm2), k18 에 하나(cm3)가 있다.
"""

from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskComment
from scripts.seed import seed
from tests.test_contract_types import FIELDS


async def _task(client: httpx.AsyncClient, task_id: str) -> dict[str, Any]:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    found: dict[str, Any] = next(row for row in snap["tasks"] if row["id"] == task_id)
    return found


async def test_list_is_oldest_first(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/tasks/k4/comments")
    assert res.status_code == 200
    rows = res.json()
    assert [row["id"] for row in rows] == ["cm1", "cm2"]
    assert set(rows[0]) == set(FIELDS["TaskComment"])  # domain.ts 의 TaskComment 와 한 필드씩
    assert rows[0]["editedAt"] is None
    assert rows[1]["editedAt"] == "2026-09-09T02:45:00Z"


async def test_task_without_comments_is_an_empty_list(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/tasks/k1/comments")
    assert res.status_code == 200
    assert res.json() == []


async def test_list_on_unknown_task_is_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/tasks/nope/comments")
    assert res.status_code == 404
    assert res.json()["code"] == "TASK_NOT_FOUND"


async def test_add_trims_and_goes_to_the_end(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/tasks/k4/comments", json={"authorId": "u2", "body": "  계정 받았습니다.\n  "}
    )
    assert res.status_code == 201
    comment = res.json()
    assert set(comment) == set(FIELDS["TaskComment"])
    assert comment["taskId"] == "k4"
    assert comment["authorId"] == "u2"
    assert comment["body"] == "계정 받았습니다."
    assert comment["createdAt"].endswith("Z")
    assert comment["editedAt"] is None

    listed = (await client.get("/api/tasks/k4/comments")).json()
    assert [row["id"] for row in listed] == ["cm1", "cm2", comment["id"]]


async def test_add_without_author(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/tasks/k1/comments", json={"authorId": None, "body": "메모"})
    assert res.status_code == 201
    assert res.json()["authorId"] is None


async def test_blank_body_is_422(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/tasks/k4/comments", json={"authorId": "u3", "body": "  \n "})
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_ERROR"
    assert "body" in res.json()["detail"]


async def test_unknown_author_is_400(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/tasks/k4/comments", json={"authorId": "u99", "body": "안녕"})
    assert res.status_code == 400
    assert res.json()["code"] == "COMMENT_AUTHOR_NOT_FOUND"


async def test_add_on_unknown_task_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/tasks/nope/comments", json={"authorId": "u3", "body": "안녕"})
    assert res.status_code == 404
    assert res.json()["code"] == "TASK_NOT_FOUND"


async def test_edit_sets_edited_at(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/comments/cm1", json={"body": " 신청서 올렸습니다. "})
    assert res.status_code == 200
    comment = res.json()
    assert comment["body"] == "신청서 올렸습니다."
    assert comment["editedAt"] is not None
    assert comment["editedAt"].endswith("Z")
    assert comment["createdAt"] == "2026-09-09T01:12:00Z"  # 등록 시각은 그대로다

    # 고쳐도 순서는 그대로다 — seq 가 정한다
    listed = (await client.get("/api/tasks/k4/comments")).json()
    assert [row["id"] for row in listed] == ["cm1", "cm2"]


async def test_edit_with_blank_or_null_body_is_422(client: httpx.AsyncClient) -> None:
    for body in ("   ", None):
        res = await client.patch("/api/comments/cm1", json={"body": body})
        assert res.status_code == 422
        assert res.json()["code"] == "VALIDATION_ERROR"


async def test_edit_unknown_comment_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/comments/nope", json={"body": "안녕"})
    assert res.status_code == 404
    assert res.json()["code"] == "COMMENT_NOT_FOUND"


async def test_delete(client: httpx.AsyncClient) -> None:
    res = await client.delete("/api/comments/cm1")
    assert res.status_code == 204

    listed = (await client.get("/api/tasks/k4/comments")).json()
    assert [row["id"] for row in listed] == ["cm2"]


async def test_delete_unknown_comment_is_404(client: httpx.AsyncClient) -> None:
    res = await client.delete("/api/comments/nope")
    assert res.status_code == 404
    assert res.json()["code"] == "COMMENT_NOT_FOUND"


async def test_comment_count_in_snapshot(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    counts = {row["id"]: row["commentCount"] for row in snap["tasks"]}
    assert counts["k4"] == 2
    assert counts["k18"] == 1
    assert counts["k1"] == 0

    # 다른 프로젝트 것은 섞이지 않는다
    p2 = (await client.get("/api/projects/p2/snapshot")).json()
    assert all(row["commentCount"] == 0 for row in p2["tasks"])


async def test_comment_count_follows_writes(client: httpx.AsyncClient) -> None:
    await client.post("/api/tasks/k4/comments", json={"authorId": "u3", "body": "하나 더"})
    assert (await _task(client, "k4"))["commentCount"] == 3

    await client.delete("/api/comments/cm1")
    await client.delete("/api/comments/cm2")
    assert (await _task(client, "k4"))["commentCount"] == 1


async def test_task_write_answers_carry_comment_count(client: httpx.AsyncClient) -> None:
    patched = await client.patch("/api/tasks/k4", json={"title": "개발 환경 설정 (수정)"})
    assert patched.json()["commentCount"] == 2

    created = await client.post("/api/projects/p1/tasks", json={"title": "새 작업"})
    assert created.status_code == 201
    assert created.json()["commentCount"] == 0


async def test_comments_go_with_their_task(session: AsyncSession) -> None:
    """작업 삭제 API 는 아직 없다 — 행을 지워 ON DELETE CASCADE 를 본다."""
    await seed(session)
    task = await session.get(Task, "k18")
    assert task is not None
    await session.delete(task)
    await session.commit()

    left = await session.scalar(
        select(func.count()).select_from(TaskComment).where(TaskComment.task_id == "k18")
    )
    assert left == 0

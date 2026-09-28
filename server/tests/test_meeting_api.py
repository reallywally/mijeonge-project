"""회의 ↔ 작업 링크. 작업 상세에서 거는 것과 같은 링크를 반대편에서 건다."""

import httpx


async def test_link_task_is_idempotent(client: httpx.AsyncClient) -> None:
    first = await client.put("/api/meetings/m1/tasks/k1")
    second = await client.put("/api/meetings/m1/tasks/k1")
    assert first.status_code == 200
    assert first.json() == second.json() == {"meetingId": "m1", "taskId": "k1"}

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert snap["meetingTaskLinks"].count({"meetingId": "m1", "taskId": "k1"}) == 1


async def test_both_sides_write_the_same_link(client: httpx.AsyncClient) -> None:
    await client.put("/api/meetings/m1/tasks/k1")
    assert (await client.delete("/api/tasks/k1/meetings/m1")).status_code == 204

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"meetingId": "m1", "taskId": "k1"} not in snap["meetingTaskLinks"]


async def test_unlinking_what_is_not_linked_still_works(client: httpx.AsyncClient) -> None:
    assert (await client.delete("/api/meetings/m1/tasks/k1")).status_code == 204


async def test_link_needs_both_sides_in_one_project(client: httpx.AsyncClient) -> None:
    assert (await client.put("/api/meetings/m1/tasks/x1")).status_code == 400
    assert (await client.put("/api/meetings/없는회의/tasks/k1")).status_code == 404
    assert (await client.put("/api/meetings/m1/tasks/없는작업")).status_code == 404

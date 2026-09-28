"""작업 쓰기 API — 발번 · 고리 금지 · 부분 수정 · 본문 줄 · 링크.

응답은 스냅샷이 쓰는 `TaskOut` 그대로다. 프론트가 바뀐 레코드를 바로 꽂을 수 있어야 하므로
키 집합을 읽기 API 와 **같은 상수**로 본다.
"""

from typing import get_args

import httpx

from app.models.task import TASK_LINE_KINDS, TASK_PRIORITIES, TASK_STATUSES
from app.schemas.task import TaskLineKindIn, TaskPriorityIn, TaskStatusIn
from tests.test_read_api import TASK_KEYS

NEW_TASK = {
    "title": "배포 파이프라인 만들기",
    "parentId": None,
    "body": [
        # 화면이 실어 보내는 id 다 — 서버가 새 id 를 붙여 돌려줘야 한다
        {"id": "tmp1", "kind": "check", "text": "러너 등록", "done": False, "level": 0},
        {"id": "tmp2", "kind": "bullet", "text": "사내망에서만 돈다", "done": False, "level": 1},
    ],
    "status": "todo",
    "ownerId": "u3",
    "start": None,
    "due": None,
    "priority": "normal",
    "threadIds": ["t1"],
}


def test_input_literals_match_the_model() -> None:
    """입력 스키마가 모델의 체크 제약과 갈리면 DB 까지 가서야 터진다."""
    assert set(get_args(TaskStatusIn)) == set(TASK_STATUSES)
    assert set(get_args(TaskPriorityIn)) == set(TASK_PRIORITIES)
    assert set(get_args(TaskLineKindIn)) == set(TASK_LINE_KINDS)


async def test_add_task_answers_with_a_task(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK)
    assert res.status_code == 201
    task = res.json()

    assert set(task) == TASK_KEYS  # domain.ts 의 Task 와 한 필드씩 같다
    assert task["projectId"] == "p1"
    assert task["title"] == "배포 파이프라인 만들기"
    assert task["createdAt"].count("-") == 2 and "T" not in task["createdAt"]  # YYYY-MM-DD


async def test_body_lines_get_server_ids_in_order(client: httpx.AsyncClient) -> None:
    """화면이 보낸 줄 id 는 화면 안에서만 쓰던 값이다 — 서버가 새로 붙인다."""
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()

    assert [line["text"] for line in task["body"]] == ["러너 등록", "사내망에서만 돈다"]
    assert [line["kind"] for line in task["body"]] == ["check", "bullet"]
    assert [line["id"] for line in task["body"]] != ["tmp1", "tmp2"]
    assert task["body"][1]["level"] == 1


async def test_keys_come_from_the_project_counter(client: httpx.AsyncClient) -> None:
    """픽스처가 HW-21 까지 썼다. 최댓값이 아니라 프로젝트의 카운터에서 센다."""
    first = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    second = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()

    assert [first["key"], second["key"]] == ["HW-22", "HW-23"]


async def test_key_prefix_follows_the_project(client: httpx.AsyncClient) -> None:
    body = NEW_TASK | {"threadIds": [], "ownerId": None}
    task = (await client.post("/api/projects/p2/tasks", json=body)).json()
    assert task["key"] == "PAS-3"


async def test_thread_ids_are_linked_on_creation(client: httpx.AsyncClient) -> None:
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": task["id"], "threadId": "t1"} in snap["taskThreadLinks"]


async def test_add_task_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/tasks", json=NEW_TASK)
    assert res.status_code == 404


async def test_written_task_shows_up_at_the_end_of_the_snapshot(
    client: httpx.AsyncClient,
) -> None:
    """등록 순서(seq)가 제대로 채워졌는지 — 배열 순서가 곧 화면 순서다."""
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["tasks"][-1]["id"] == task["id"]
    assert len(snap["tasks"]) == 22


async def test_task_cannot_be_its_own_parent(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4", json={"parentId": "k4"})
    assert res.status_code == 400


async def test_descendant_cannot_become_the_parent(client: httpx.AsyncClient) -> None:
    """k5(개발) › k6(AI Biz) › k7(가상비서). 손자를 상위로 두면 고리가 생긴다."""
    res = await client.patch("/api/tasks/k5", json={"parentId": "k7"})
    assert res.status_code == 400

    fine = await client.patch("/api/tasks/k7", json={"parentId": "k5"})
    assert fine.status_code == 200 and fine.json()["parentId"] == "k5"


async def test_parent_must_be_in_the_same_project(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"parentId": "x1"})
    assert res.status_code == 400

    missing = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"parentId": "없음"})
    assert missing.status_code == 400


async def test_patch_touches_only_what_was_sent(client: httpx.AsyncClient) -> None:
    """`{"ownerId": null}` 은 담당자 지우기다 — 안 보낸 것과 갈라야 한다."""
    before = (await client.get("/api/projects/p1/snapshot")).json()
    k4 = next(t for t in before["tasks"] if t["id"] == "k4")

    task = (await client.patch("/api/tasks/k4", json={"ownerId": None})).json()
    assert task["ownerId"] is None
    assert task["title"] == k4["title"]
    assert task["status"] == k4["status"]
    assert task["start"] == k4["start"] and task["due"] == k4["due"]

    again = (await client.patch("/api/tasks/k4", json={"status": "done"})).json()
    assert again["status"] == "done"
    assert again["ownerId"] is None  # 지운 담당자가 되살아나지 않는다


async def test_patch_can_set_one_side_of_the_period(client: httpx.AsyncClient) -> None:
    """'둘 다 있을 때만'은 간트 화면의 규칙이다 — 서버가 따라 하지 않는다."""
    task = (await client.patch("/api/tasks/k18", json={"start": "2026-10-01"})).json()
    assert task["start"] == "2026-10-01"
    assert task["due"] is None


async def test_patch_rejects_an_unknown_status(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4", json={"status": "미정"})
    assert res.status_code == 422


async def test_patch_on_unknown_task_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/없는작업", json={"status": "done"})
    assert res.status_code == 404


async def test_check_line_toggles(client: httpx.AsyncClient) -> None:
    task = (await client.patch("/api/tasks/k4/lines/l3", json={"done": True})).json()
    line = next(each for each in task["body"] if each["id"] == "l3")
    assert line["done"] is True
    assert task["body"][0]["done"] is True  # 다른 줄은 그대로다

    back = (await client.patch("/api/tasks/k4/lines/l3", json={"done": False})).json()
    assert next(each for each in back["body"] if each["id"] == "l3")["done"] is False


async def test_bullet_line_cannot_be_toggled(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4/lines/l5", json={"done": True})
    assert res.status_code == 400


async def test_unknown_line_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4/lines/없는줄", json={"done": True})
    assert res.status_code == 404


async def test_thread_link_is_idempotent(client: httpx.AsyncClient) -> None:
    first = await client.put("/api/tasks/k1/threads/t4")
    second = await client.put("/api/tasks/k1/threads/t4")
    assert first.status_code == 200
    assert first.json() == second.json() == {"taskId": "k1", "threadId": "t4"}

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert [link for link in snap["taskThreadLinks"] if link["taskId"] == "k1"] == [
        {"taskId": "k1", "threadId": "t4"}
    ]


async def test_unlinking_what_is_not_linked_still_works(client: httpx.AsyncClient) -> None:
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204

    await client.put("/api/tasks/k1/threads/t4")
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": "k1", "threadId": "t4"} not in snap["taskThreadLinks"]


async def test_link_needs_both_sides_in_one_project(client: httpx.AsyncClient) -> None:
    assert (await client.put("/api/tasks/k1/threads/t10")).status_code == 400
    assert (await client.put("/api/tasks/없는작업/threads/t4")).status_code == 404
    assert (await client.put("/api/tasks/k1/threads/없는안건")).status_code == 404


async def test_meeting_link_from_the_task_side(client: httpx.AsyncClient) -> None:
    linked = await client.put("/api/tasks/k1/meetings/m1")
    assert linked.status_code == 200
    assert linked.json() == {"meetingId": "m1", "taskId": "k1"}
    assert (await client.put("/api/tasks/k1/meetings/m1")).json() == linked.json()

    assert (await client.delete("/api/tasks/k1/meetings/m1")).status_code == 204
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"meetingId": "m1", "taskId": "k1"} not in snap["meetingTaskLinks"]

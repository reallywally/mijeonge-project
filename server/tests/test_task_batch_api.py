"""작업 일괄 등록 — `POST /api/projects/{projectId}/tasks/batch` (API.md '작업 초안').

챗봇 초안을 사람이 [등록] 할 때 쓴다. 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다.
"""

from typing import Any

import httpx
import pytest

from app.services import task as task_service
from tests.test_contract_types import FIELDS

URL = "/api/projects/p3/tasks/batch"


def item(temp_id: str, title: str, **extra: Any) -> dict[str, Any]:
    return {
        "tempId": temp_id,
        "parentTempId": None,
        "title": title,
        "ownerId": None,
        "start": None,
        "due": None,
        "priority": "normal",
    } | extra


DRAFT = [
    item("t1", "간담회 준비"),
    item("t2", "일정 체크", parentTempId="t1", ownerId="u1", due="2026-10-16"),
    item("t3", "준비물 체크", parentTempId="t1", ownerId="u2", priority="high"),
]


async def task_count(client: httpx.AsyncClient, project_id: str = "p3") -> int:
    snap = (await client.get(f"/api/projects/{project_id}/snapshot")).json()
    return len(snap["tasks"])


async def test_batch_creates_tree_in_order(client: httpx.AsyncClient) -> None:
    res = await client.post(URL, json={"tasks": DRAFT})
    assert res.status_code == 201
    body = res.json()
    assert set(body) == set(FIELDS["TaskBatchResult"])

    tasks = body["tasks"]
    ids = body["taskIdByTempId"]
    assert set(tasks[0]) == set(FIELDS["Task"])
    # 요청 순서 그대로, 번호도 그 순서로 — p3 는 아직 작업이 없다
    assert [t["title"] for t in tasks] == ["간담회 준비", "일정 체크", "준비물 체크"]
    assert [t["key"] for t in tasks] == ["MG-1", "MG-2", "MG-3"]
    assert ids == {"t1": tasks[0]["id"], "t2": tasks[1]["id"], "t3": tasks[2]["id"]}
    # tempId 가 실제 id 로 바뀌어 상하위가 선다
    assert [t["parentId"] for t in tasks] == [None, ids["t1"], ids["t1"]]
    assert [t["ownerId"] for t in tasks] == [None, "u1", "u2"]
    assert tasks[1]["due"] == "2026-10-16" and tasks[1]["start"] is None
    assert tasks[2]["priority"] == "high"
    assert all(t["status"] == "todo" and t["body"] == [] for t in tasks)
    assert all(t["projectId"] == "p3" and t["commentCount"] == 0 for t in tasks)

    snap = (await client.get("/api/projects/p3/snapshot")).json()
    assert [t["id"] for t in snap["tasks"]] == [t["id"] for t in tasks]


async def test_batch_keys_continue_from_single_create(client: httpx.AsyncClient) -> None:
    """발번은 작업 하나 등록과 같은 카운터다."""
    one = await client.post("/api/projects/p3/tasks", json={"title": "먼저 하나"})
    assert one.json()["key"] == "MG-1"
    res = await client.post(URL, json={"tasks": DRAFT[:1]})
    assert [t["key"] for t in res.json()["tasks"]] == ["MG-2"]


async def test_batch_trims_title(client: httpx.AsyncClient) -> None:
    res = await client.post(URL, json={"tasks": [item("t1", "  간담회  ")]})
    assert res.json()["tasks"][0]["title"] == "간담회"


async def test_failure_midway_leaves_nothing(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """두 번째를 넣다 터져도 첫 번째 · 올려 둔 번호까지 되돌린다."""
    real = task_service._insert_task
    calls = 0

    async def broken(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("두 번째에서 터진다")
        return await real(*args, **kwargs)

    monkeypatch.setattr(task_service, "_insert_task", broken)
    with pytest.raises(RuntimeError):
        await client.post(URL, json={"tasks": DRAFT})
    monkeypatch.undo()

    assert calls == 2
    assert await task_count(client) == 0
    res = await client.post(URL, json={"tasks": DRAFT[:1]})
    assert res.json()["tasks"][0]["key"] == "MG-1"


async def test_missing_owner_is_400_and_leaves_nothing(client: httpx.AsyncClient) -> None:
    tasks = [DRAFT[0], DRAFT[1], item("t3", "준비물 체크", parentTempId="t1", ownerId="없음")]
    res = await client.post(URL, json={"tasks": tasks})
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == "TASK_OWNER_NOT_FOUND"
    assert body["detail"] == {"tasks.2.ownerId": "담당자를 찾을 수 없습니다."}
    assert await task_count(client) == 0


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/tasks/batch", json={"tasks": DRAFT})
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize(
    ("tasks", "field"),
    [
        ([], "tasks"),
        ([item(f"t{i}", "할 일") for i in range(21)], "tasks"),
        ([item("t1", "가"), item("t1", "나")], "tasks.1.tempId"),
        ([item("t1", "가", parentTempId="t2"), item("t2", "나")], "tasks.0.parentTempId"),
        ([item("t1", "가", parentTempId="t1")], "tasks.0.parentTempId"),
        ([item("t1", "가", parentTempId="없음")], "tasks.0.parentTempId"),
        ([item("t1", "가"), item("t2", "   ")], "tasks.1.title"),
        ([item("t1", "가", start="2026-10-20", due="2026-10-19")], "tasks.0.due"),
        # 타입 오류도 몇 번째인지 짚는다
        ([item("t1", "가"), item("t2", "나", priority="urgent")], "tasks.1.priority"),
        ([item("t1", "가", due="다음 주")], "tasks.0.due"),
    ],
)
async def test_rule_violation_is_422_with_position(
    client: httpx.AsyncClient, tasks: list[dict[str, Any]], field: str
) -> None:
    res = await client.post(URL, json={"tasks": tasks})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert field in body["detail"], body
    assert await task_count(client) == 0


async def test_limits_are_inclusive(client: httpx.AsyncClient) -> None:
    tasks = [item(f"t{i}", "할 일") for i in range(20)]
    tasks.append(item("t20", "같은 날", start="2026-10-20", due="2026-10-20"))
    res = await client.post(URL, json={"tasks": tasks[1:]})
    assert res.status_code == 201
    assert len(res.json()["tasks"]) == 20


async def test_batch_hangs_under_an_existing_task(client: httpx.AsyncClient) -> None:
    """parentId 로 이미 있는 작업 밑에 붙는다. 그 밑의 하위는 parentTempId 로 잇는다."""
    draft = [
        item("t1", "화면 설계", parentId="k1"),
        item("t2", "목록 화면", parentTempId="t1"),
    ]
    res = await client.post("/api/projects/p1/tasks/batch", json={"tasks": draft})
    assert res.status_code == 201, res.text
    tasks = res.json()["tasks"]
    assert tasks[0]["parentId"] == "k1"
    assert tasks[1]["parentId"] == tasks[0]["id"]


@pytest.mark.parametrize("parent", ["x1", "nope"])
async def test_batch_parent_from_elsewhere_is_400_and_leaves_nothing(
    client: httpx.AsyncClient, parent: str
) -> None:
    before = await task_count(client, "p1")
    res = await client.post(
        "/api/projects/p1/tasks/batch",
        json={"tasks": [item("t1", "가"), item("t2", "나", parentId=parent)]},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "TASK_PARENT_NOT_FOUND"
    assert "tasks.1.parentId" in res.json()["detail"]
    assert await task_count(client, "p1") == before


async def test_batch_two_parents_is_422(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tasks/batch",
        json={"tasks": [item("t1", "가"), item("t2", "나", parentTempId="t1", parentId="k1")]},
    )
    assert res.status_code == 422
    assert "tasks.1.parentId" in res.json()["detail"]

"""작업 계층은 4단까지 (Q64) — 등록 · 수정 · 일괄 등록 · 챗봇 초안.

시드는 k5(개발) › k6(AI Biz) › k7(가상비서) › k8(tool01) 로 이미 4단이다.
회의록 반영은 `test_minutes.py` 의 참조 오류 표에 한 줄 있다.
"""

import json
from typing import Any

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task
from app.services import chat as chat_service
from app.services.task import MAX_TASK_DEPTH
from tests.test_task_api import NEW_TASK
from tests.test_task_batch_api import item, task_count

DEPTH = {"code": "TASK_DEPTH_EXCEEDED", "message": "작업은 4단까지만 쌓을 수 있습니다."}


def test_limit_is_four() -> None:
    assert MAX_TASK_DEPTH == 4


async def test_create_up_to_four_levels(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"parentId": "k7"})
    assert res.status_code == 201, res.text


async def test_create_fifth_level_is_400(client: httpx.AsyncClient) -> None:
    before = await task_count(client, "p1")
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"parentId": "k8"})
    assert res.status_code == 400
    assert res.json() == DEPTH
    assert await task_count(client, "p1") == before


async def test_move_counts_the_subtree_height(client: httpx.AsyncClient) -> None:
    """k12(AI 심사) › k13 은 높이 2 — k7(3단) 밑이면 5단이 된다. k3(2단) 밑은 4단이라 된다."""
    res = await client.patch("/api/tasks/k12", json={"parentId": "k7"})
    assert res.status_code == 400
    assert res.json() == DEPTH

    fine = await client.patch("/api/tasks/k12", json={"parentId": "k3"})
    assert fine.status_code == 200 and fine.json()["parentId"] == "k3"


async def test_move_leaf_to_fourth_level(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k13", json={"parentId": "k7"})
    assert res.status_code == 200, res.text

    deeper = await client.patch("/api/tasks/k13", json={"parentId": "k8"})
    assert deeper.status_code == 400 and deeper.json()["code"] == "TASK_DEPTH_EXCEEDED"


async def test_whole_tree_under_a_leaf_is_400(client: httpx.AsyncClient) -> None:
    """k5 의 서브트리는 높이 4 — 어느 최상위 밑에 두어도 5단이 된다."""
    res = await client.patch("/api/tasks/k5", json={"parentId": "k1"})
    assert res.status_code == 400 and res.json()["code"] == "TASK_DEPTH_EXCEEDED"


async def test_old_deep_data_stays_editable(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """이미 5단인 지난 작업 — 상위를 안 바꾸는 수정은 막지 않고, 최상위로 올리는 것도 된다."""
    await session.execute(update(Task).where(Task.id == "k17").values(parent_id="k8"))
    await session.commit()

    title = await client.patch("/api/tasks/k17", json={"title": "챗봇 고침", "status": "doing"})
    assert title.status_code == 200, title.text

    same = await client.patch("/api/tasks/k17", json={"parentId": "k8"})
    assert same.status_code == 200, same.text

    top = await client.patch("/api/tasks/k17", json={"parentId": None})
    assert top.status_code == 200 and top.json()["parentId"] is None


async def test_old_deep_data_lifts_to_the_top(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """서브트리 높이가 4를 넘는 지난 작업도 최상위로는 올린다 — 깊이를 줄이는 쪽이다."""
    await session.execute(update(Task).where(Task.id == "k1").values(parent_id="k8"))
    await session.commit()

    res = await client.patch("/api/tasks/k5", json={"parentId": None})
    assert res.status_code == 200, res.text


async def test_batch_temp_chain_past_four_is_400_and_leaves_nothing(
    client: httpx.AsyncClient,
) -> None:
    draft = [
        item("t1", "가"),
        item("t2", "나", parentTempId="t1"),
        item("t3", "다", parentTempId="t2"),
        item("t4", "라", parentTempId="t3"),
        item("t5", "마", parentTempId="t4"),
    ]
    before = await task_count(client)
    res = await client.post("/api/projects/p3/tasks/batch", json={"tasks": draft})
    assert res.status_code == 400
    out = res.json()
    assert out["code"] == "TASK_DEPTH_EXCEEDED"
    assert list(out["detail"]) == ["tasks.4.parentTempId"]
    assert await task_count(client) == before

    res = await client.post("/api/projects/p3/tasks/batch", json={"tasks": draft[:4]})
    assert res.status_code == 201, res.text


async def test_batch_counts_the_existing_parent(client: httpx.AsyncClient) -> None:
    """k7 은 3단 — 그 밑의 초안 줄이 4단, 그 아래가 5단이다."""
    draft = [
        item("t1", "가", parentId="k8"),
        item("t2", "나", parentId="k7"),
        item("t3", "다", parentTempId="t2"),
    ]
    res = await client.post("/api/projects/p1/tasks/batch", json={"tasks": draft})
    assert res.status_code == 400
    assert set(res.json()["detail"]) == {"tasks.0.parentId", "tasks.2.parentTempId"}


async def test_chat_proposal_gets_the_same_check(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    raw: dict[str, Any] = {"tasks": [item("t1", "가", parentId="k8")]}
    message, is_error, proposal = await chat_service.check_proposal(session, "p1", raw)
    assert is_error and proposal is None
    assert "tasks.0.parentId" in json.loads(message)["problems"]

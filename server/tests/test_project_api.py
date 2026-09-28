"""프로젝트 등록 — 화면에 아직 없는 자리다. 발번 접두사를 여기서 받는다."""

import httpx


async def test_create_project_answers_with_id_and_name(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects", json={"name": "사내 포털 개편", "keyPrefix": "POR"})
    assert res.status_code == 201

    project = res.json()
    assert set(project) == {"id", "name"}  # domain.ts 의 Project 는 둘뿐이다
    assert project["name"] == "사내 포털 개편"

    listed = (await client.get("/api/projects")).json()
    assert {"id": project["id"], "name": "사내 포털 개편"} in listed


async def test_first_task_of_a_new_project_is_number_one(client: httpx.AsyncClient) -> None:
    project = (
        await client.post("/api/projects", json={"name": "사내 포털 개편", "keyPrefix": "POR"})
    ).json()

    task = (
        await client.post(f"/api/projects/{project['id']}/tasks", json={"title": "요구사항 정리"})
    ).json()
    assert task["key"] == "POR-1"

"""프로젝트 등록 — 빈 상태에서 앱을 여는 유일한 길이다 (API.md Q18).

`taskKeyPrefix` 는 **선택**이다. 넣으면 그 값을 쓰고, 안 넣으면 서버가 겹치지 않는 값을
만들어 응답에 실어 준다 (API.md Q20 · Q22).
"""

import httpx


async def test_create_project_answers_with_the_contract_shape(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects", json={"name": "사내 포털 개편", "taskKeyPrefix": "POR"}
    )
    assert res.status_code == 201

    project = res.json()
    # domain.ts 의 Project 그대로 — 프로젝트 목록 화면이 접두사를 찍는다
    assert set(project) == {"id", "name", "taskKeyPrefix"}
    assert project["name"] == "사내 포털 개편"
    assert project["taskKeyPrefix"] == "POR"

    listed = (await client.get("/api/projects")).json()
    assert project in listed


async def test_prefix_is_optional_and_server_makes_one(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects", json={"name": "접두사 없이"})
    assert res.status_code == 201

    prefix = res.json()["taskKeyPrefix"]
    assert prefix not in {"HW", "PAS", "MG"}
    assert prefix.isupper() and 1 <= len(prefix) <= 8

    # 만들어 준 값이 그대로 발번에 쓰인다
    project_id = res.json()["id"]
    task = (
        await client.post(f"/api/projects/{project_id}/tasks", json={"title": "첫 작업"})
    ).json()
    assert task["key"] == f"{prefix}-1"


async def test_taken_prefix_is_409(client: httpx.AsyncClient) -> None:
    """접두사는 프로젝트 사이에 유일하다 — 'HW-4' 한 마디로 가리켜야 하기 때문이다."""
    res = await client.post("/api/projects", json={"name": "겹치는 접두사", "taskKeyPrefix": "HW"})

    assert res.status_code == 409
    assert res.json()["code"] == "PROJECT_PREFIX_TAKEN"
    assert "HW" in res.json()["message"]


async def test_bad_prefix_is_422_with_field_detail(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects", json={"name": "소문자", "taskKeyPrefix": "hw"})

    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["detail"] == {"taskKeyPrefix": "형식이 올바르지 않습니다."}


async def test_first_task_of_a_new_project_is_number_one(client: httpx.AsyncClient) -> None:
    project = (
        await client.post("/api/projects", json={"name": "사내 포털 개편", "taskKeyPrefix": "POR"})
    ).json()

    task = (
        await client.post(f"/api/projects/{project['id']}/tasks", json={"title": "요구사항 정리"})
    ).json()
    assert task["key"] == "POR-1"

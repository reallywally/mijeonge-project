"""프로젝트 등록 — 빈 상태에서 앱을 여는 유일한 길이다 (API.md Q18).

`taskKeyPrefix` 는 **선택**이다. 넣으면 그 값을 쓰고, 안 넣으면 서버가 겹치지 않는 값을
만들어 응답에 실어 준다 (API.md Q20 · Q22).
"""

import httpx
import pytest

from tests.conftest import AsMember
from tests.test_read_api import PROJECT_KEYS


async def test_create_project_answers_with_the_contract_shape(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects", json={"name": "사내 포털 개편", "taskKeyPrefix": "POR"}
    )
    assert res.status_code == 201

    project = res.json()
    # domain.ts 의 Project 그대로 — 프로젝트 목록 화면이 접두사를 찍는다
    assert set(project) == PROJECT_KEYS
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


async def test_blank_prefix_counts_as_not_given(client: httpx.AsyncClient) -> None:
    """등록 폼은 입력칸을 비워 두는 것이 정상 경로다.

    빈 문자열도 '안 넣은 것' 과 같이 본다 (API.md Q24).
    """
    for blank in ("", "   "):
        res = await client.post(
            "/api/projects", json={"name": "비워 둔 칸", "taskKeyPrefix": blank}
        )

        assert res.status_code == 201, blank
        prefix = res.json()["taskKeyPrefix"]
        assert prefix and prefix not in {"HW", "PAS", "MG"}


async def test_prefix_keeps_its_shape_when_given(client: httpx.AsyncClient) -> None:
    """빈 값만 접는다. 적은 값은 앞뒤 공백만 떼고 그대로 쓴다 — 형식이 틀리면 422 다."""
    res = await client.post("/api/projects", json={"name": "공백만 떼기", "taskKeyPrefix": " POR "})
    assert res.status_code == 201
    assert res.json()["taskKeyPrefix"] == "POR"

    bad = await client.post("/api/projects", json={"name": "빈칸 낀 값", "taskKeyPrefix": "PO R"})
    assert bad.status_code == 422
    assert bad.json()["detail"] == {"taskKeyPrefix": "형식이 올바르지 않습니다."}


# --- 프로젝트 관리 — 설명 · 기간 · 상태 · 삭제 (docs/api/auth.md '프로젝트 관리') ---------------


async def test_create_takes_description_and_dates(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects",
        json={
            "name": "기간 있는 프로젝트",
            "description": "  설명 한 줄  ",
            "startDate": "2026-11-01",
            "endDate": "2027-01-31",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["description"] == "설명 한 줄"
    assert (body["startDate"], body["endDate"]) == ("2026-11-01", "2027-01-31")
    assert (body["status"], body["closedAt"]) == ("active", None)


async def test_create_rejects_end_before_start(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects",
        json={"name": "거꾸로", "startDate": "2026-11-02", "endDate": "2026-11-01"},
    )
    assert res.status_code == 400
    assert res.json() == {
        "code": "PROJECT_DATE_RANGE",
        "message": "종료일은 시작일보다 앞설 수 없습니다.",
    }


async def test_patch_changes_only_sent_fields(as_member: AsMember) -> None:
    u1 = await as_member("u1")  # p1 관리자
    res = await u1.patch(
        "/api/projects/p1", json={"description": "  새 설명 ", "endDate": "2027-12-31"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "한화손보 차세대"
    assert body["description"] == "새 설명"
    # 보내지 않은 시작일은 그대로다
    assert (body["startDate"], body["endDate"]) == ("2026-07-01", "2027-12-31")

    # 같은 날은 된다
    same = await u1.patch("/api/projects/p1", json={"startDate": "2027-12-31"})
    assert same.status_code == 200


async def test_patch_checks_range_against_the_result(client: httpx.AsyncClient) -> None:
    """한쪽만 보내도 바뀐 뒤의 쌍으로 본다 — p1 은 2026-07-01 ~ 2027-06-30."""
    res = await client.patch("/api/projects/p1", json={"endDate": "2026-06-30"})
    assert res.status_code == 400
    assert res.json()["code"] == "PROJECT_DATE_RANGE"
    # 막혔으면 아무것도 안 바뀐다
    p1 = (await client.get("/api/projects/p1/snapshot")).json()["project"]
    assert p1["endDate"] == "2027-06-30"

    # 시작일을 같이 비우면 된다
    ok = await client.patch("/api/projects/p1", json={"startDate": None, "endDate": "2026-06-30"})
    assert ok.status_code == 200
    assert (ok.json()["startDate"], ok.json()["endDate"]) == (None, "2026-06-30")


async def test_null_and_blank_clear(client: httpx.AsyncClient) -> None:
    res = await client.patch(
        "/api/projects/p1", json={"description": None, "startDate": None, "endDate": None}
    )
    assert res.status_code == 200
    body = res.json()
    assert (body["description"], body["startDate"], body["endDate"]) == (None, None, None)

    await client.patch("/api/projects/p1", json={"description": "다시"})
    blank = await client.patch("/api/projects/p1", json={"description": "   "})
    assert blank.json()["description"] is None


async def test_patch_rejects_null_name_status_and_long_description(
    client: httpx.AsyncClient,
) -> None:
    for body in (
        {"name": None},
        {"status": None},
        {"name": "  "},
        {"status": "archived"},
        {"status": "PLANNED"},
    ):
        res = await client.patch("/api/projects/p1", json=body)
        assert res.status_code == 422, body
        assert res.json()["code"] == "VALIDATION_ERROR"
    long = await client.patch("/api/projects/p1", json={"description": "가" * 2001})
    assert long.status_code == 422
    fits = await client.patch("/api/projects/p1", json={"description": "가" * 2000})
    assert fits.status_code == 200


async def test_close_and_reopen(client: httpx.AsyncClient) -> None:
    closed = (await client.patch("/api/projects/p1", json={"status": "closed"})).json()
    assert closed["status"] == "closed"
    closed_at = closed["closedAt"]
    assert closed_at is not None and closed_at.endswith("Z")

    # 같은 상태를 다시 보내면 처음 닫은 시각을 지킨다
    again = (await client.patch("/api/projects/p1", json={"status": "closed"})).json()
    assert again["closedAt"] == closed_at

    # 종료는 표시만 한다 — 쓰기는 그대로 된다
    task = await client.post("/api/projects/p1/tasks", json={"title": "닫힌 뒤에도"})
    assert task.status_code == 201

    # 진행 중인 것이 먼저, 그 안에서는 전과 같은 순서
    listed = (await client.get("/api/projects")).json()
    assert [p["id"] for p in listed] == ["p2", "p3", "p1"]

    reopened = (await client.patch("/api/projects/p1", json={"status": "active"})).json()
    assert (reopened["status"], reopened["closedAt"]) == ("active", None)
    assert [p["id"] for p in (await client.get("/api/projects")).json()] == ["p1", "p2", "p3"]


async def test_planned_status(client: httpx.AsyncClient) -> None:
    planned = (await client.patch("/api/projects/p1", json={"status": "planned"})).json()
    assert (planned["status"], planned["closedAt"]) == ("planned", None)

    closed = (await client.patch("/api/projects/p1", json={"status": "closed"})).json()
    assert closed["status"] == "closed" and closed["closedAt"] is not None

    # 종료에서 준비로 돌려도 닫힌 시각은 지운다
    back = (await client.patch("/api/projects/p1", json={"status": "planned"})).json()
    assert (back["status"], back["closedAt"]) == ("planned", None)


async def test_list_orders_active_planned_closed(client: httpx.AsyncClient) -> None:
    await client.patch("/api/projects/p1", json={"status": "closed"})
    await client.patch("/api/projects/p2", json={"status": "planned"})
    listed = (await client.get("/api/projects")).json()
    assert [(p["id"], p["status"]) for p in listed] == [
        ("p3", "active"),
        ("p2", "planned"),
        ("p1", "closed"),
    ]


async def test_only_system_admin_deletes(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u1 = await as_member("u1")  # p1 관리자
    forbidden = await u1.delete("/api/projects/p1")
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "FORBIDDEN"

    assert (await client.delete("/api/projects/p1")).status_code == 204
    # 한 번 지우면 없는 것이다
    again = await client.delete("/api/projects/p1")
    assert again.status_code == 404
    assert again.json()["code"] == "PROJECT_NOT_FOUND"


async def test_deleted_project_drops_out_of_lists(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u1 = await as_member("u1")
    assert (await u1.get("/api/checks/pending-count")).json()["byProject"] == {"p1": 1}

    assert (await client.delete("/api/projects/p1")).status_code == 204

    assert [p["id"] for p in (await client.get("/api/projects")).json()] == ["p2", "p3"]
    assert [p["id"] for p in (await u1.get("/api/projects")).json()] == ["p2", "p3"]
    # 부여 줄은 남지만(되살리기) 화면에는 안 실린다
    assert "p1" not in (await u1.get("/api/auth/me")).json()["projectRoles"]
    assert (await u1.get("/api/checks/pending-count")).json() == {"total": 0, "byProject": {}}


DELETED_PATHS = [
    ("GET", "/api/projects/p1/snapshot", None, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/projects/p1", {"name": "되살리기"}, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/search?q=OS", None, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/members", None, "PROJECT_NOT_FOUND"),
    ("POST", "/api/projects/p1/tasks", {"title": "몰래"}, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/reports", None, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/tasks/k4", {"title": "몰래"}, "TASK_NOT_FOUND"),
    ("GET", "/api/tasks/k4/comments", None, "TASK_NOT_FOUND"),
    ("PATCH", "/api/threads/t1", {"title": "몰래"}, "THREAD_NOT_FOUND"),
    ("PATCH", "/api/comments/cm1", {"body": "몰래"}, "COMMENT_NOT_FOUND"),
    ("PATCH", "/api/parts/pt1", {"name": "몰래"}, "PART_NOT_FOUND"),
    ("POST", "/api/checks/c3/confirm", None, "CHECK_NOT_FOUND"),
    ("GET", "/api/minutes/m1", None, "MINUTES_NOT_FOUND"),
]


@pytest.mark.parametrize(
    ("method", "url", "body", "code"), DELETED_PATHS, ids=[p[1] for p in DELETED_PATHS]
)
async def test_deleted_project_paths_are_404(
    client: httpx.AsyncClient, method: str, url: str, body: object, code: str
) -> None:
    """시스템 관리자도 못 본다 — 정말 없는 것과 같은 코드다."""
    assert (await client.delete("/api/projects/p1")).status_code == 204
    res = await client.request(method, url, json=body)
    assert res.status_code == 404
    assert res.json()["code"] == code


async def test_deleted_prefix_stays_taken(client: httpx.AsyncClient) -> None:
    assert (await client.delete("/api/projects/p1")).status_code == 204
    res = await client.post("/api/projects", json={"name": "HW 다시", "taskKeyPrefix": "HW"})
    assert res.status_code == 409
    assert res.json()["code"] == "PROJECT_PREFIX_TAKEN"

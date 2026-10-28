"""파트 — `docs/api/part.md`. 보기 범위지 권한이 아니다: 서버는 다 싣고 화면이 거른다.

시드: p1 에 pt1(인프라 · u3) · pt2(AI · u1 · u4) · pt3(기간계 연동 · u2). p2 · p3 에는 파트가 없다.
u1 은 p1 관리자 · p2 user, u2 ~ u4 는 user, `client` 는 시스템 관리자(부여 없음).
"""

from typing import Any

import httpx
import pytest

from tests.conftest import AsMember
from tests.test_task_batch_api import item


async def snapshot(client: httpx.AsyncClient, project_id: str = "p1") -> dict[str, Any]:
    res = await client.get(f"/api/projects/{project_id}/snapshot")
    assert res.status_code == 200
    body: dict[str, Any] = res.json()
    return body


async def task_part(client: httpx.AsyncClient, task_id: str) -> str | None:
    snap = await snapshot(client)
    found: str | None = next(t["partId"] for t in snap["tasks"] if t["id"] == task_id)
    return found


async def make_part(client: httpx.AsyncClient, project_id: str, name: str) -> str:
    res = await client.post(f"/api/projects/{project_id}/parts", json={"name": name})
    assert res.status_code == 201, res.json()
    part_id: str = res.json()["id"]
    return part_id


async def archive(client: httpx.AsyncClient, part_id: str) -> None:
    res = await client.patch(f"/api/parts/{part_id}", json={"active": False})
    assert res.status_code == 200


# --- 스냅샷 · 시드 -------------------------------------------------------------------


async def test_snapshot_carries_parts_and_members(client: httpx.AsyncClient) -> None:
    snap = await snapshot(client)
    # 이름 순 — 보관 포함
    assert snap["parts"] == [
        {"id": "pt2", "projectId": "p1", "name": "AI", "active": True},
        {"id": "pt3", "projectId": "p1", "name": "기간계 연동", "active": True},
        {"id": "pt1", "projectId": "p1", "name": "인프라", "active": True},
    ]
    assert snap["partMembers"] == [
        {"partId": "pt1", "memberId": "u3"},
        {"partId": "pt2", "memberId": "u1"},
        {"partId": "pt2", "memberId": "u4"},
        {"partId": "pt3", "memberId": "u2"},
    ]


async def test_seed_parts_match_contract_table(client: httpx.AsyncClient) -> None:
    snap = await snapshot(client)
    tasks = {t["id"]: t["partId"] for t in snap["tasks"]}
    threads = {t["id"]: t["partId"] for t in snap["threads"]}
    assert {k for k, v in tasks.items() if v == "pt1"} == {"k4", "k19", "k20", "k21", "k22"}
    assert {k for k, v in tasks.items() if v == "pt2"} == {f"k{n}" for n in range(6, 17)}
    assert {k for k, v in tasks.items() if v == "pt3"} == {"k18"}
    assert {k for k, v in tasks.items() if v is None} == {"k1", "k2", "k3", "k5", "k17"}
    assert {k for k, v in threads.items() if v == "pt1"} == {"t1", "t2", "t4"}
    assert {k for k, v in threads.items() if v == "pt2"} == {"t3", "t7", "t8"}
    assert {k for k, v in threads.items() if v == "pt3"} == {"t5"}
    assert {k for k, v in threads.items() if v is None} == {"t6", "t9"}


async def test_project_without_parts_has_empty_lists(client: httpx.AsyncClient) -> None:
    snap = await snapshot(client, "p2")
    assert snap["parts"] == [] and snap["partMembers"] == []
    assert all(t["partId"] is None for t in snap["tasks"] + snap["threads"])


async def test_snapshot_does_not_filter_by_part(as_member: AsMember) -> None:
    """파트는 권한이 아니다 — 파트가 없는 사람(admin 말고 u2 는 pt3 뿐)도 전부 받는다."""
    u2 = await as_member("u2")
    snap = await snapshot(u2)
    assert len(snap["tasks"]) == 22 and len(snap["threads"]) == 9
    assert len(snap["parts"]) == 3


# --- 만들기 · 이름 · 보관 -------------------------------------------------------------


async def test_create_part(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/parts", json={"name": "  디자인  "})
    assert res.status_code == 201
    body = res.json()
    assert set(body) == {"id", "projectId", "name", "active"}
    assert body["projectId"] == "p1" and body["name"] == "디자인" and body["active"] is True
    assert [p["name"] for p in (await snapshot(client))["parts"]] == [
        "AI",
        "기간계 연동",
        "디자인",
        "인프라",
    ]


@pytest.mark.parametrize("name", ["", "   ", "가" * 51])
async def test_part_name_is_1_to_50(client: httpx.AsyncClient, name: str) -> None:
    res = await client.post("/api/projects/p1/parts", json={"name": name})
    assert res.status_code == 422
    assert "name" in res.json()["detail"]


async def test_name_taken_is_409_even_when_archived(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/parts", json={"name": "AI"})
    assert res.status_code == 409
    assert res.json()["code"] == "PART_NAME_TAKEN"

    await archive(client, "pt2")
    res = await client.post("/api/projects/p1/parts", json={"name": " AI "})
    assert res.status_code == 409

    # 다른 프로젝트에서는 같은 이름을 쓸 수 있다
    await make_part(client, "p2", "AI")


async def test_rename(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/parts/pt2", json={"name": "AI Biz"})
    assert res.status_code == 200
    assert res.json() == {"id": "pt2", "projectId": "p1", "name": "AI Biz", "active": True}

    taken = await client.patch("/api/parts/pt2", json={"name": "인프라"})
    assert taken.status_code == 409 and taken.json()["code"] == "PART_NAME_TAKEN"
    # 제 이름 그대로는 겹침이 아니다
    same = await client.patch("/api/parts/pt2", json={"name": "AI Biz"})
    assert same.status_code == 200


async def test_archive_and_restore(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/parts/pt1", json={"active": False})
    assert res.status_code == 200 and res.json()["active"] is False
    # 보관해도 스냅샷에 남고, 달린 작업 · 안건도 그대로다
    snap = await snapshot(client)
    assert {"id": "pt1", "projectId": "p1", "name": "인프라", "active": False} in snap["parts"]
    assert await task_part(client, "k4") == "pt1"

    res = await client.patch("/api/parts/pt1", json={"active": True})
    assert res.json()["active"] is True


@pytest.mark.parametrize("body", [{"name": None}, {"active": None}])
async def test_patch_rejects_null(client: httpx.AsyncClient, body: dict[str, Any]) -> None:
    res = await client.patch("/api/parts/pt1", json=body)
    assert res.status_code == 422


async def test_missing_part_is_404(client: httpx.AsyncClient) -> None:
    for method, url, body in [
        ("PATCH", "/api/parts/nope", {"name": "x"}),
        ("PUT", "/api/parts/nope/members/u1", None),
        ("DELETE", "/api/parts/nope/members/u1", None),
    ]:
        res = await client.request(method, url, json=body)
        assert res.status_code == 404
        assert res.json()["code"] == "PART_NOT_FOUND"


# --- 권한 · 경계 ---------------------------------------------------------------------

WRITES = [
    ("POST", "/api/projects/p1/parts", {"name": "새 파트"}),
    ("PATCH", "/api/parts/pt1", {"name": "바꿈"}),
    ("PUT", "/api/parts/pt1/members/u2", None),
    ("DELETE", "/api/parts/pt1/members/u3", None),
]


@pytest.mark.parametrize(("method", "url", "body"), WRITES, ids=[w[0] for w in WRITES])
async def test_user_gets_403(
    as_member: AsMember, method: str, url: str, body: dict[str, Any] | None
) -> None:
    u2 = await as_member("u2")
    res = await u2.request(method, url, json=body)
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"


@pytest.mark.parametrize(("method", "url", "body"), WRITES, ids=[w[0] for w in WRITES])
async def test_project_admin_can_manage(
    as_member: AsMember, method: str, url: str, body: dict[str, Any] | None
) -> None:
    u1 = await as_member("u1")
    res = await u1.request(method, url, json=body)
    assert res.status_code < 300, res.json() if res.content else None


async def test_admin_of_one_project_is_user_in_another(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    other = await make_part(client, "p2", "이관")
    u1 = await as_member("u1")
    res = await u1.patch(f"/api/parts/{other}", json={"name": "바꿈"})
    assert res.status_code == 403


@pytest.mark.parametrize(
    ("method", "url", "body", "code"),
    [
        ("POST", "/api/projects/p1/parts", {"name": "몰래"}, "PROJECT_NOT_FOUND"),
        ("PATCH", "/api/parts/pt1", {"name": "몰래"}, "PART_NOT_FOUND"),
        ("PUT", "/api/parts/pt1/members/u2", None, "PART_NOT_FOUND"),
        ("DELETE", "/api/parts/pt1/members/u3", None, "PART_NOT_FOUND"),
    ],
)
async def test_ungranted_project_part_is_404(
    client: httpx.AsyncClient,
    as_member: AsMember,
    method: str,
    url: str,
    body: dict[str, Any] | None,
    code: str,
) -> None:
    """부여받지 않은 프로젝트의 파트는 없는 것처럼 — 원래 없을 때와 같은 응답이다."""
    assert (await client.delete("/api/projects/p1/members/u2")).status_code == 204
    u2 = await as_member("u2")
    res = await u2.request(method, url, json=body)
    assert res.status_code == 404
    assert res.json()["code"] == code

    missing = await client.request(
        method, url.replace("p1", "nope").replace("pt1", "nope"), json=body
    )
    assert missing.json() == res.json()


# --- 파트 멤버 -----------------------------------------------------------------------


async def test_add_member_is_idempotent(client: httpx.AsyncClient) -> None:
    for _ in range(2):
        res = await client.put("/api/parts/pt1/members/u4")
        assert res.status_code == 200
        assert res.json() == {"partId": "pt1", "memberId": "u4"}
    rows = (await snapshot(client))["partMembers"]
    assert rows.count({"partId": "pt1", "memberId": "u4"}) == 1


async def test_remove_member_is_idempotent(client: httpx.AsyncClient) -> None:
    for _ in range(2):
        res = await client.delete("/api/parts/pt1/members/u3")
        assert res.status_code == 204
    assert {"partId": "pt1", "memberId": "u3"} not in (await snapshot(client))["partMembers"]


@pytest.mark.parametrize("member_id", ["admin", "nope"])
async def test_member_outside_project_is_400(client: httpx.AsyncClient, member_id: str) -> None:
    """시스템 관리자도 p1 에 부여되지 않았으면 못 넣는다. 없는 사람도 같다."""
    res = await client.put(f"/api/parts/pt1/members/{member_id}")
    assert res.status_code == 400
    assert res.json()["code"] == "MEMBER_NOT_IN_PROJECT"


async def test_leaving_project_leaves_its_parts(client: httpx.AsyncClient) -> None:
    other = await make_part(client, "p2", "이관")
    assert (await client.put(f"/api/parts/{other}/members/u3")).status_code == 200

    assert (await client.delete("/api/projects/p1/members/u3")).status_code == 204
    assert all(row["memberId"] != "u3" for row in (await snapshot(client))["partMembers"])
    # 다른 프로젝트의 파트 소속은 그대로다
    assert {"partId": other, "memberId": "u3"} in (await snapshot(client, "p2"))["partMembers"]


# --- 작업 등록의 상속 ----------------------------------------------------------------


async def test_task_inherits_parent_part_when_key_is_missing(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json={"title": "tool05", "parentId": "k7"})
    assert res.status_code == 201
    assert res.json()["partId"] == "pt2"


async def test_task_null_part_is_common(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tasks", json={"title": "공통 일", "parentId": "k7", "partId": None}
    )
    assert res.status_code == 201
    assert res.json()["partId"] is None


async def test_task_explicit_part_wins(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tasks", json={"title": "서버 붙이기", "parentId": "k7", "partId": "pt1"}
    )
    assert res.status_code == 201
    assert res.json()["partId"] == "pt1"


async def test_top_level_task_without_key_is_common(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json={"title": "최상위"})
    assert res.json()["partId"] is None


async def test_batch_follows_the_same_rule_in_order(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tasks/batch",
        json={
            "tasks": [
                item("t1", "인프라 묶음", partId="pt1"),
                item("t2", "따라감", parentTempId="t1"),
                item("t3", "공통으로", parentTempId="t1", partId=None),
                item("t4", "손자도 따라감", parentTempId="t2"),
                item("t5", "최상위"),
            ]
        },
    )
    assert res.status_code == 201, res.json()
    assert [t["partId"] for t in res.json()["tasks"]] == ["pt1", "pt1", None, "pt1", None]


async def test_batch_with_foreign_part_leaves_nothing(client: httpx.AsyncClient) -> None:
    other = await make_part(client, "p2", "이관")
    before = len((await snapshot(client))["tasks"])
    res = await client.post(
        "/api/projects/p1/tasks/batch",
        json={"tasks": [item("t1", "하나"), item("t2", "둘", partId=other)]},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "PART_NOT_FOUND"
    assert "tasks.1.partId" in res.json()["detail"]
    assert len((await snapshot(client))["tasks"]) == before


async def test_patch_task_part_does_not_move_children(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k6", json={"partId": None})
    assert res.status_code == 200 and res.json()["partId"] is None
    assert await task_part(client, "k7") == "pt2"

    res = await client.patch("/api/tasks/k6", json={"partId": "pt3"})
    assert res.json()["partId"] == "pt3"
    # 안 보내면 그대로다
    res = await client.patch("/api/tasks/k6", json={"title": "AI 사업"})
    assert res.json()["partId"] == "pt3"


# --- 다른 프로젝트 · 없는 파트 · 보관 파트 ---------------------------------------------


async def test_foreign_or_missing_part_is_400(client: httpx.AsyncClient) -> None:
    other = await make_part(client, "p2", "이관")
    for part_id in (other, "nope"):
        for method, url, body in [
            ("POST", "/api/projects/p1/tasks", {"title": "x", "partId": part_id}),
            ("PATCH", "/api/tasks/k1", {"partId": part_id}),
            ("POST", "/api/projects/p1/threads", {"title": "x", "partId": part_id}),
            ("PATCH", "/api/threads/t6", {"partId": part_id}),
        ]:
            res = await client.request(method, url, json=body)
            assert res.status_code == 400, (method, url)
            assert res.json()["code"] == "PART_NOT_FOUND"
            assert res.json()["detail"] == {"partId": "파트를 찾을 수 없습니다."}


async def test_archived_part_cannot_be_newly_attached(client: httpx.AsyncClient) -> None:
    await archive(client, "pt1")
    for method, url, body in [
        ("POST", "/api/projects/p1/tasks", {"title": "x", "partId": "pt1"}),
        ("PATCH", "/api/tasks/k5", {"partId": "pt1"}),
        ("POST", "/api/projects/p1/threads", {"title": "x", "partId": "pt1"}),
        ("PATCH", "/api/threads/t6", {"partId": "pt1"}),
        # 상위를 따라오는 것도 새로 다는 것이다
        ("POST", "/api/projects/p1/tasks", {"title": "x", "parentId": "k4"}),
    ]:
        res = await client.request(method, url, json=body)
        assert res.status_code == 400, (method, url)
        assert res.json()["code"] == "PART_ARCHIVED"


async def test_keeping_an_archived_part_is_allowed(client: httpx.AsyncClient) -> None:
    await archive(client, "pt1")
    # 이미 달린 보관 파트를 그대로 두는 수정 — 다른 칸만 바꾸거나 같은 값을 다시 보낸다
    for method, url, body in [
        ("PATCH", "/api/tasks/k4", {"title": "개발 환경"}),
        ("PATCH", "/api/tasks/k4", {"partId": "pt1", "status": "done"}),
        ("PATCH", "/api/threads/t1", {"title": "서버 OS"}),
        ("PATCH", "/api/threads/t1", {"partId": "pt1"}),
    ]:
        res = await client.request(method, url, json=body)
        assert res.status_code == 200, (method, url, res.json())
        assert res.json()["partId"] == "pt1"
    # 공통으로 떼는 것도 된다
    res = await client.patch("/api/tasks/k4", json={"partId": None})
    assert res.json()["partId"] is None


# --- 안건 -----------------------------------------------------------------------------


async def test_thread_part(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/threads", json={"title": "안 보냄"})
    assert res.status_code == 201 and res.json()["partId"] is None

    res = await client.post("/api/projects/p1/threads", json={"title": "AI", "partId": "pt2"})
    assert res.json()["partId"] == "pt2"
    thread_id = res.json()["id"]

    res = await client.patch(f"/api/threads/{thread_id}", json={"partId": None})
    assert res.status_code == 200 and res.json()["partId"] is None
    res = await client.patch(f"/api/threads/{thread_id}", json={"title": "AI 안건"})
    assert res.json()["partId"] is None

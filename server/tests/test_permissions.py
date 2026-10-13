"""권한 셋 — 시스템 관리자 · 프로젝트 관리자 · 일반 사용자 (`docs/api/auth.md` '권한 셋').

시드: `admin` 은 시스템 관리자(부여 없음), u1 은 p1 관리자 · p2 · p3 user, u2 ~ u4 는 전부 user.
부여받지 않은 프로젝트는 **없는 것처럼** 404, 부여는 받았는데 모자라면 403.
"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Member
from app.services import chat as chat_service
from tests.conftest import AsMember
from tests.test_contract_types import contract_keys


async def _revoke(client: httpx.AsyncClient, project_id: str, member_id: str) -> None:
    res = await client.delete(f"/api/projects/{project_id}/members/{member_id}")
    assert res.status_code == 204


# --- 부여받지 않은 프로젝트는 없는 것처럼 -------------------------------------------


async def test_project_list_shows_only_granted(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    await _revoke(client, "p2", "u2")
    u2 = await as_member("u2")
    assert [p["id"] for p in (await u2.get("/api/projects")).json()] == ["p1", "p3"]
    # 시스템 관리자는 부여 없이 다 본다
    assert [p["id"] for p in (await client.get("/api/projects")).json()] == ["p1", "p2", "p3"]


# 경로가 가리키는 레코드가 p1 에 있다 — 원래 없을 때와 같은 코드가 나와야 한다
HIDDEN = [
    ("GET", "/api/projects/p1/snapshot", None, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/search?q=OS", None, "PROJECT_NOT_FOUND"),
    (
        "POST",
        "/api/projects/p1/chat",
        {"messages": [{"role": "user", "text": "?"}]},
        "PROJECT_NOT_FOUND",
    ),
    ("POST", "/api/projects/p1/tasks", {"title": "몰래"}, "PROJECT_NOT_FOUND"),
    ("POST", "/api/projects/p1/tasks/batch", {"tasks": []}, "PROJECT_NOT_FOUND"),
    ("POST", "/api/projects/p1/threads", {"title": "몰래"}, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/members", None, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/projects/p1", {"name": "몰래"}, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/tasks/k4", {"title": "몰래"}, "TASK_NOT_FOUND"),
    ("PATCH", "/api/tasks/k4/lines/x", {"done": True}, "TASK_NOT_FOUND"),
    ("GET", "/api/tasks/k4/comments", None, "TASK_NOT_FOUND"),
    ("POST", "/api/tasks/k4/comments", {"body": "몰래"}, "TASK_NOT_FOUND"),
    ("PATCH", "/api/threads/t1", {"title": "몰래"}, "THREAD_NOT_FOUND"),
    ("POST", "/api/threads/t1/entries", {"kind": "raise", "text": "몰래"}, "THREAD_NOT_FOUND"),
    ("PATCH", "/api/comments/cm1", {"body": "몰래"}, "COMMENT_NOT_FOUND"),
    ("DELETE", "/api/comments/cm1", None, "COMMENT_NOT_FOUND"),
]


@pytest.mark.parametrize(("method", "url", "body", "code"), HIDDEN, ids=[h[1] for h in HIDDEN])
async def test_ungranted_project_is_404(
    client: httpx.AsyncClient,
    as_member: AsMember,
    method: str,
    url: str,
    body: object,
    code: str,
) -> None:
    await _revoke(client, "p1", "u2")
    u2 = await as_member("u2")
    res = await u2.request(method, url, json=body)
    assert res.status_code == 404
    assert res.json()["code"] == code

    # 정말 없는 것과 모양이 같다
    really_missing = url.replace("p1", "nope").replace("k4", "nope").replace("t1", "nope")
    really_missing = really_missing.replace("cm1", "nope")
    missing = await client.request(method, really_missing, json=body)
    assert missing.json() == res.json()


async def test_link_to_a_thread_in_an_ungranted_project_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """작업은 보여도 안건이 안 보이면 안건이 없는 것이다.

    400(프로젝트가 다르다)으로 존재를 흘리지 않는다.
    """
    await _revoke(client, "p1", "u2")
    u2 = await as_member("u2")
    res = await u2.put("/api/tasks/x1/threads/t1")
    assert res.status_code == 404
    assert res.json()["code"] == "THREAD_NOT_FOUND"

    # 둘 다 보이는 시스템 관리자에게는 원래대로 400 이다
    admin = await client.put("/api/tasks/x1/threads/t1")
    assert admin.status_code == 400
    assert admin.json()["code"] == "TASK_THREAD_LINK_OTHER_PROJECT"


# --- 부여는 받았는데 모자라면 403 ----------------------------------------------------


async def test_user_cannot_manage(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    for method, url, body in [
        ("POST", "/api/projects", {"name": "새 프로젝트"}),
        ("PATCH", "/api/projects/p1", {"name": "바꿈"}),
        ("PUT", "/api/projects/p1/members/u3", {"role": "admin"}),
        ("DELETE", "/api/projects/p1/members/u3", None),
    ]:
        res = await u2.request(method, url, json=body)
        assert res.status_code == 403, (method, url)
        assert res.json()["code"] == "FORBIDDEN"

    # 읽고 쓰는 일은 다 된다
    assert (await u2.get("/api/projects/p1/members")).status_code == 200
    assert (await u2.post("/api/projects/p1/tasks", json={"title": "할 일"})).status_code == 201
    assert (await u2.patch("/api/threads/t1", json={"title": "바꾼 제목"})).status_code == 200


async def test_project_admin_manages_only_their_project(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    renamed = await u1.patch("/api/projects/p1", json={"name": " 한화손보 차세대 (2기) "})
    assert renamed.status_code == 200
    assert renamed.json() == {"id": "p1", "name": "한화손보 차세대 (2기)", "taskKeyPrefix": "HW"}

    promoted = await u1.put("/api/projects/p1/members/u2", json={"role": "admin"})
    assert promoted.status_code == 200
    assert promoted.json() == {"memberId": "u2", "role": "admin"}

    # p2 에서는 user 다
    assert (await u1.patch("/api/projects/p2", json={"name": "바꿈"})).status_code == 403
    assert (await u1.put("/api/projects/p2/members/u2", json={"role": "admin"})).status_code == 403
    # 프로젝트 등록 · 사용자 관리는 시스템 관리자만
    assert (await u1.post("/api/projects", json={"name": "새 프로젝트"})).status_code == 403
    assert (await u1.get("/api/admin/members")).status_code == 403


async def test_project_admin_can_step_down(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """다른 관리자가 없어도 막지 않는다 — 시스템 관리자가 있다."""
    u1 = await as_member("u1")
    res = await u1.put("/api/projects/p1/members/u1", json={"role": "user"})
    assert res.status_code == 200
    assert (await u1.patch("/api/projects/p1", json={"name": "바꿈"})).status_code == 403

    assert (await u1.delete("/api/projects/p2/members/u1")).status_code == 403
    await _revoke(client, "p1", "u1")
    assert (await u1.get("/api/projects/p1/snapshot")).status_code == 404


async def test_system_admin_creates_project_without_joining(client: httpx.AsyncClient) -> None:
    created = await client.post(
        "/api/projects", json={"name": "새 프로젝트", "taskKeyPrefix": "NEW"}
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    # 등록한 사람이 관리자로 붙지 않는다 — 그래도 다 할 수 있다
    assert (await client.get(f"/api/projects/{project_id}/members")).json() == []
    assert (await client.get("/api/auth/me")).json()["projectRoles"] == {}
    assert (
        await client.post(f"/api/projects/{project_id}/tasks", json={"title": "첫 작업"})
    ).status_code == 201


# --- 프로젝트 멤버 -------------------------------------------------------------------


async def test_project_members_shape_and_order(client: httpx.AsyncClient) -> None:
    rows = (await client.get("/api/projects/p1/members")).json()
    assert all(set(row) == contract_keys("ProjectMember") for row in rows)
    # 이름 순 — 김서연 · 박지훈 · 이도현 · 정하늘
    assert rows == [
        {"memberId": "u1", "role": "admin"},
        {"memberId": "u2", "role": "user"},
        {"memberId": "u3", "role": "user"},
        {"memberId": "u4", "role": "user"},
    ]


async def test_grant_rules(client: httpx.AsyncClient, session: AsyncSession) -> None:
    url = "/api/projects/p1/members"
    # 멱등 — 두 번 불러도 한 줄
    for _ in range(2):
        res = await client.put(f"{url}/admin", json={"role": "user"})
        assert res.status_code == 200
    assert sum(row["memberId"] == "admin" for row in (await client.get(url)).json()) == 1

    missing = await client.put(f"{url}/nobody", json={"role": "user"})
    assert missing.status_code == 404
    assert missing.json()["code"] == "MEMBER_NOT_FOUND"

    bad_role = await client.put(f"{url}/u2", json={"role": "owner"})
    assert bad_role.status_code == 422

    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    inactive = await client.put(f"{url}/u4", json={"role": "admin"})
    assert inactive.status_code == 400
    assert inactive.json()["code"] == "MEMBER_INACTIVE"

    # 빼기도 멱등
    assert (await client.delete(f"{url}/u4")).status_code == 204
    assert (await client.delete(f"{url}/u4")).status_code == 204
    assert (await client.delete(f"{url}/nobody")).status_code == 204


async def test_revoke_keeps_their_records(client: httpx.AsyncClient) -> None:
    """뺀 사람이 담당하던 작업은 그대로 둔다 — 기록이다."""
    await _revoke(client, "p1", "u3")
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    k4 = next(task for task in snap["tasks"] if task["id"] == "k4")
    assert k4["ownerId"] == "u3"


async def test_members_list_carries_active(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """옛 담당자 이름을 찍어야 해서 비활성도 낸다."""
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()
    rows = {row["id"]: row for row in (await client.get("/api/members")).json()}
    assert rows["u4"] == {"id": "u4", "name": "정하늘", "active": False}


# --- 담당자는 그 프로젝트의 활성 멤버 ------------------------------------------------


async def test_new_owner_must_be_an_active_project_member(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await _revoke(client, "p1", "u3")
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()

    # admin 은 있는 멤버지만 p1 에 부여되지 않았다 · u3 는 빠졌다 · u4 는 비활성
    for owner in ("admin", "u3", "u4", "nobody"):
        task = await client.post(
            "/api/projects/p1/tasks", json={"title": "할 일", "ownerId": owner}
        )
        assert task.status_code == 400, owner
        assert task.json()["code"] == "TASK_OWNER_NOT_FOUND"
        assert task.json()["detail"] == {"ownerId": "담당자를 찾을 수 없습니다."}

        patched = await client.patch("/api/tasks/k1", json={"ownerId": owner})
        assert patched.json()["code"] == "TASK_OWNER_NOT_FOUND", owner

        thread = await client.post(
            "/api/projects/p1/threads", json={"title": "안건", "ownerId": owner}
        )
        assert thread.status_code == 400
        assert thread.json()["code"] == "THREAD_OWNER_NOT_FOUND"

        thread_patch = await client.patch("/api/threads/t4", json={"ownerId": owner})
        assert thread_patch.json()["code"] == "THREAD_OWNER_NOT_FOUND"

        entry = await client.post(
            "/api/threads/t4/entries", json={"kind": "decide", "text": "정함", "ownerId": owner}
        )
        assert entry.status_code == 400
        assert entry.json()["code"] == "ENTRY_OWNER_NOT_FOUND"

    batch = await client.post(
        "/api/projects/p1/tasks/batch",
        json={
            "tasks": [
                {"tempId": "a", "title": "하나", "ownerId": "u1"},
                {"tempId": "b", "title": "둘", "ownerId": "u3"},
            ]
        },
    )
    assert batch.status_code == 400
    assert batch.json()["code"] == "TASK_OWNER_NOT_FOUND"
    assert batch.json()["detail"] == {"tasks.1.ownerId": "담당자를 찾을 수 없습니다."}


async def test_keeping_an_old_owner_is_fine(client: httpx.AsyncClient) -> None:
    """이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다 — k4 의 담당자 u3 를 빼도."""
    await _revoke(client, "p1", "u3")
    same = await client.patch(
        "/api/tasks/k4", json={"title": "개발 환경 설정 (수정)", "ownerId": "u3"}
    )
    assert same.status_code == 200
    assert same.json()["ownerId"] == "u3"

    # 비우는 것도 된다
    cleared = await client.patch("/api/tasks/k4", json={"ownerId": None})
    assert cleared.status_code == 200
    # 비운 뒤 다시 걸면 새로 지정하는 것이다
    again = await client.patch("/api/tasks/k4", json={"ownerId": "u3"})
    assert again.status_code == 400


async def test_chat_tools_see_only_active_project_members(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await _revoke(client, "p1", "u2")
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()

    content, is_error = await chat_service.run_tool(session, "p1", "list_members", {})
    assert not is_error
    assert content == '[{"id": "u1", "name": "김서연"}, {"id": "u3", "name": "이도현"}]'

    draft = {
        "tasks": [
            {
                "temp_id": "a",
                "parent_temp_id": None,
                "title": "할 일",
                "owner_id": "u2",
                "start": None,
                "due": None,
                "priority": "normal",
            }
        ]
    }
    content, is_error, proposal = await chat_service.check_proposal(session, "p1", draft)
    assert is_error and proposal is None
    assert "tasks.0.ownerId" in content


# --- 댓글 권한 ----------------------------------------------------------------------


async def test_only_the_author_edits(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """cm1 은 u1 이 썼다. 관리자도 남의 말을 고쳐 쓰지 못한다."""
    for who in ("u2", "u3"):
        other = await as_member(who)
        res = await other.patch("/api/comments/cm1", json={"body": "남의 댓글"})
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"
    assert (await client.patch("/api/comments/cm1", json={"body": "관리자"})).status_code == 403
    assert (
        await (await as_member("u1")).patch("/api/comments/cm1", json={"body": "내 댓글"})
    ).status_code == 200


async def test_who_can_delete(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자."""
    u2 = await as_member("u2")
    denied = await u2.delete("/api/comments/cm1")
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"

    mine = await u2.post("/api/tasks/k4/comments", json={"body": "지울 댓글"})
    assert (await u2.delete(f"/api/comments/{mine.json()['id']}")).status_code == 204

    u1 = await as_member("u1")  # p1 관리자 — cm2 는 u3 가 썼다
    assert (await u1.delete("/api/comments/cm2")).status_code == 204
    assert (await client.delete("/api/comments/cm3")).status_code == 204  # 시스템 관리자

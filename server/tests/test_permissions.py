"""권한 셋 — 시스템 관리자 · 프로젝트 관리자 · 일반 사용자 (`docs/api/auth.md` '권한 셋').

시드: `admin` 은 시스템 관리자(부여 없음), u1 은 p1 관리자 · p2 · p3 user, u2 ~ u4 는 전부 user.
부여받지 않은 프로젝트는 **없는 것처럼** 404, 부여는 받았는데 모자라면 403.
"""

from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Member, Task, TaskHistory
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
    ("POST", "/api/projects/p1/agendas", {"title": "몰래"}, "PROJECT_NOT_FOUND"),
    ("GET", "/api/projects/p1/members", None, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/projects/p1", {"name": "몰래"}, "PROJECT_NOT_FOUND"),
    ("PATCH", "/api/tasks/k4", {"title": "몰래"}, "TASK_NOT_FOUND"),
    ("PATCH", "/api/tasks/k4/lines/x", {"done": True}, "TASK_NOT_FOUND"),
    ("DELETE", "/api/tasks/k4", None, "TASK_NOT_FOUND"),
    ("POST", "/api/tasks/k4/move", {"parentId": None, "beforeId": None}, "TASK_NOT_FOUND"),
    ("GET", "/api/tasks/k4/comments", None, "TASK_NOT_FOUND"),
    ("POST", "/api/tasks/k4/comments", {"body": "몰래"}, "TASK_NOT_FOUND"),
    ("PATCH", "/api/agendas/t1", {"title": "몰래"}, "AGENDA_NOT_FOUND"),
    ("POST", "/api/agendas/t1/checks", None, "AGENDA_NOT_FOUND"),
    ("DELETE", "/api/agendas/t1", None, "AGENDA_NOT_FOUND"),
    ("GET", "/api/agendas/t1/history", None, "AGENDA_NOT_FOUND"),
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


async def test_link_to_a_agenda_in_an_ungranted_project_is_404(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """작업은 보여도 안건이 안 보이면 안건이 없는 것이다.

    400(프로젝트가 다르다)으로 존재를 흘리지 않는다.
    """
    await _revoke(client, "p1", "u2")
    u2 = await as_member("u2")
    res = await u2.put("/api/tasks/x1/agendas/t1")
    assert res.status_code == 404
    assert res.json()["code"] == "AGENDA_NOT_FOUND"

    # 둘 다 보이는 시스템 관리자에게는 원래대로 400 이다
    admin = await client.put("/api/tasks/x1/agendas/t1")
    assert admin.status_code == 400
    assert admin.json()["code"] == "TASK_AGENDA_LINK_OTHER_PROJECT"


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
    # 안건은 u2 가 맡은 t9 — 남의 안건은 403 이다(아래 '안건')
    assert (await u2.patch("/api/agendas/t9", json={"title": "바꾼 제목"})).status_code == 200


async def test_project_admin_manages_only_their_project(as_member: AsMember) -> None:
    u1 = await as_member("u1")
    renamed = await u1.patch("/api/projects/p1", json={"name": " 한화손보 차세대 (2기) "})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "한화손보 차세대 (2기)"
    assert renamed.json()["taskKeyPrefix"] == "HW"

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

        agenda = await client.post(
            "/api/projects/p1/agendas", json={"title": "안건", "ownerId": owner}
        )
        assert agenda.status_code == 400
        assert agenda.json()["code"] == "AGENDA_OWNER_NOT_FOUND"

        agenda_patch = await client.patch("/api/agendas/t4", json={"ownerId": owner})
        assert agenda_patch.json()["code"] == "AGENDA_OWNER_NOT_FOUND"

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


# --- 작업 — 고치기 · 지우기 (docs/api/auth.md '작업') ------------------------------


async def _task_by(c: httpx.AsyncClient, owner_id: str | None) -> dict[str, Any]:
    res = await c.post(
        "/api/projects/p1/tasks",
        json={
            "title": "권한 보기",
            "ownerId": owner_id,
            "body": [{"kind": "check", "text": "확인", "done": False, "level": 0}],
        },
    )
    assert res.status_code == 201, res.json()
    task: dict[str, Any] = res.json()
    return task


async def _edits(c: httpx.AsyncClient, task: dict[str, Any], done: bool) -> list[int]:
    """작업 하나를 고치는 넷 — PATCH · 체크박스 · 링크 걸기 · 떼기."""
    task_id, line_id = task["id"], task["body"][0]["id"]
    return [
        (await c.patch(f"/api/tasks/{task_id}", json={"priority": "high"})).status_code,
        (await c.patch(f"/api/tasks/{task_id}/lines/{line_id}", json={"done": done})).status_code,
        (await c.put(f"/api/tasks/{task_id}/agendas/t1")).status_code,
        (await c.delete(f"/api/tasks/{task_id}/agendas/t1")).status_code,
    ]


async def test_task_edit_is_for_creator_owner_and_admins(as_member: AsMember) -> None:
    """u2 가 만들고 u4 가 맡은 작업 — u1 은 p1 관리자, admin 은 시스템 관리자, u3 는 남."""
    task = await _task_by(await as_member("u2"), "u4")
    assert task["creatorId"] == "u2" and task["ownerId"] == "u4"
    for who, done in (("u2", True), ("u4", False), ("u1", True), ("admin", False)):
        assert await _edits(await as_member(who), task, done) == [200, 200, 200, 204], who

    u3 = await as_member("u3")
    for res in (
        await u3.patch(f"/api/tasks/{task['id']}", json={"title": "남이 고침"}),
        await u3.patch(
            f"/api/tasks/{task['id']}/lines/{task['body'][0]['id']}", json={"done": True}
        ),
        await u3.put(f"/api/tasks/{task['id']}/agendas/t1"),
        await u3.delete(f"/api/tasks/{task['id']}/agendas/t1"),
    ):
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"


async def test_task_edit_judges_the_task_before_the_change(as_member: AsMember) -> None:
    """담당자가 남에게 넘기는 수정은 된다 — 넘긴 뒤에는 그 사람이 남이다."""
    task = await _task_by(await as_member("u2"), "u4")
    u3 = await as_member("u3")
    # 남이 자기를 담당자로 넣는 것도 바꾸기 전 작업으로 본다 — 막힌다
    assert (await u3.patch(f"/api/tasks/{task['id']}", json={"ownerId": "u3"})).status_code == 403
    u4 = await as_member("u4")
    handed = await u4.patch(f"/api/tasks/{task['id']}", json={"ownerId": "u3"})
    assert handed.status_code == 200 and handed.json()["ownerId"] == "u3"
    again = await u4.patch(f"/api/tasks/{task['id']}", json={"ownerId": "u4"})
    assert again.status_code == 403
    # 넘겨받은 사람은 이제 고친다
    assert (
        await u3.patch(f"/api/tasks/{task['id']}", json={"title": "새 담당"})
    ).status_code == 200


async def test_creator_cannot_be_changed(as_member: AsMember) -> None:
    task = await _task_by(await as_member("u2"), None)
    res = await (await as_member("u2")).patch(
        f"/api/tasks/{task['id']}", json={"creatorId": "u3", "title": "그대로"}
    )
    assert res.status_code == 200
    assert res.json()["creatorId"] == "u2"


async def test_task_without_a_creator_is_for_owner_and_admins(as_member: AsMember) -> None:
    """시드 k17 은 등록한 사람 기록이 없고(null) 담당도 없다 — 관리자만 고친다."""
    u2 = await as_member("u2")
    assert (await u2.patch("/api/tasks/k17", json={"priority": "high"})).status_code == 403
    assert (await (await as_member("u1")).patch("/api/tasks/k17", json={})).status_code == 200


async def test_sub_task_needs_no_edit_right_on_the_parent(as_member: AsMember) -> None:
    """하위 작업 등록은 상위를 고치는 것이 아니다 — k1 을 못 고치는 u2 도 밑에 단다."""
    res = await (await as_member("u2")).post(
        "/api/projects/p1/tasks", json={"title": "하위", "parentId": "k21"}
    )
    assert res.status_code == 201
    assert res.json()["creatorId"] == "u2"


async def test_who_can_delete_a_task(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """지우기는 생성자 · 그 프로젝트 관리자 · 시스템 관리자. 담당자는 못 지운다.

    시드: k18 은 u3 가 만들고 u4 가 맡았다. k3 은 u1(p1 관리자)이 만들고 u2 가 맡았다.
    """
    for who in ("u4", "u2"):  # 담당자 · 남
        denied = await (await as_member(who)).delete("/api/tasks/k18")
        assert denied.status_code == 403, who
        assert denied.json()["code"] == "FORBIDDEN"
    assert (await (await as_member("u2")).delete("/api/tasks/k3")).status_code == 403
    assert (await (await as_member("u3")).delete("/api/tasks/k18")).status_code == 204

    own = await _task_by(await as_member("u3"), "u3")
    assert (await (await as_member("u1")).delete(f"/api/tasks/{own['id']}")).status_code == 204
    assert (await client.delete("/api/tasks/k16")).status_code == 204  # 시스템 관리자
    for gone in ("k18", own["id"], "k16"):
        assert (await client.patch(f"/api/tasks/{gone}", json={})).status_code == 404


async def _child_of(c: httpx.AsyncClient, parent_id: str | None, title: str) -> str:
    res = await c.post("/api/projects/p1/tasks", json={"title": title, "parentId": parent_id})
    assert res.status_code == 201, res.json()
    task_id: str = res.json()["id"]
    return task_id


async def _deleted_rows(session: AsyncSession, ids: list[str]) -> dict[str, Any]:
    session.expire_all()
    rows = (await session.scalars(select(Task).where(Task.id.in_(ids)))).all()
    return {row.id: (row.is_deleted, row.deleted_at, row.deleted_by) for row in rows}


async def _delete_lines(session: AsyncSession, task_id: str) -> int:
    lines = (await session.scalars(select(TaskHistory).where(TaskHistory.task_id == task_id))).all()
    return sum(1 for line in lines if line.changes[0]["field"] == "deleted")


async def test_delete_takes_the_whole_subtree(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """하위 작업은 손자 이하까지 줄기째 지운다 (2026-11-05).

    같은 시각 · 같은 사람으로 찍고, 줄마다 '삭제' 이력이 남는다.
    """
    u2 = await as_member("u2")
    root = await _child_of(u2, None, "뿌리")
    child = await _child_of(u2, root, "자식")
    grand = await _child_of(u2, child, "손자")
    great = await _child_of(u2, grand, "증손")
    sibling = await _child_of(u2, child, "손자 둘")
    outside = await _child_of(u2, None, "남의 줄기")
    family = [root, child, grand, great, sibling]

    assert (await u2.delete(f"/api/tasks/{root}")).status_code == 204

    rows = await _deleted_rows(session, [*family, outside])
    assert rows[outside] == (False, None, None)
    stamps = {rows[i] for i in family}
    assert len(stamps) == 1
    is_deleted, deleted_at, deleted_by = stamps.pop()
    assert is_deleted is True and deleted_at is not None and deleted_by == "u2"
    for task_id in family:
        assert await _delete_lines(session, task_id) == 1, task_id
        res = await client.patch(f"/api/tasks/{task_id}", json={})
        assert res.status_code == 404 and res.json()["code"] == "TASK_NOT_FOUND"
    snap = {t["id"] for t in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]}
    assert outside in snap and not snap & set(family)


async def test_delete_is_403_if_any_descendant_is_not_mine(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """줄기 중 하나라도 못 지우면 아무것도 안 지운다 — 권한은 뿌리 · 후손 하나씩 본다."""
    u2, u3 = await as_member("u2"), await as_member("u3")
    root = await _child_of(u2, None, "뿌리")
    child = await _child_of(u2, root, "자식")
    theirs = await _child_of(u3, child, "u3 의 손자")  # 하위 작업 등록은 아무나 한다
    family = [root, child, theirs]

    res = await u2.delete(f"/api/tasks/{root}")
    assert res.status_code == 403
    assert res.json() == {"code": "FORBIDDEN", "message": "지울 수 없는 하위 작업이 있습니다."}
    rows = await _deleted_rows(session, family)
    assert all(rows[i] == (False, None, None) for i in family)
    assert [await _delete_lines(session, i) for i in family] == [0, 0, 0]
    # 뿌리를 못 지우면 하위를 보기 전에 그냥 403
    res = await u3.delete(f"/api/tasks/{root}")
    assert res.json() == {"code": "FORBIDDEN", "message": "권한이 없습니다."}
    # 관리자는 남의 것까지 지운다
    assert (await (await as_member("u1")).delete(f"/api/tasks/{root}")).status_code == 204
    rows = await _deleted_rows(session, family)
    assert all(rows[i][0] is True and rows[i][2] == "u1" for i in family)


async def test_delete_leaves_already_deleted_descendants_alone(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    """먼저 지운 후손은 다시 찍지 않는다 — 시각 · 사람 · '삭제' 줄이 처음 그대로다.

    남이 만든 후손이라도 이미 지웠으면 권한을 묻지 않는다.
    """
    u2, u3 = await as_member("u2"), await as_member("u3")
    root = await _child_of(u2, None, "뿌리")
    kept = await _child_of(u2, root, "남는 자식")
    theirs = await _child_of(u3, root, "u3 의 자식")
    assert (await u3.delete(f"/api/tasks/{theirs}")).status_code == 204
    before = (await _deleted_rows(session, [theirs]))[theirs]
    assert before[0] is True and before[2] == "u3"

    assert (await u2.delete(f"/api/tasks/{root}")).status_code == 204
    rows = await _deleted_rows(session, [root, kept, theirs])
    assert rows[theirs] == before
    assert await _delete_lines(session, theirs) == 1
    assert rows[root][2] == rows[kept][2] == "u2"


async def test_seed_tree_goes_in_one_delete(client: httpx.AsyncClient) -> None:
    """예전엔 409 `TASK_HAS_CHILDREN` 이던 k1 · k12 도 이제 한 번에 지워진다."""
    assert (await client.delete("/api/tasks/k12")).status_code == 204
    assert (await client.patch("/api/tasks/k13", json={})).status_code == 404
    assert (await client.delete("/api/tasks/k1")).status_code == 204


# --- 안건 — 고치기 · 지우기 (docs/api/auth.md '안건') -----------------------------------------
# 작업과 달리 담당자도 지운다 (2026-11-02 사용자 결정)


async def _agenda_by(c: httpx.AsyncClient, owner_id: str | None) -> dict[str, Any]:
    res = await c.post("/api/projects/p1/agendas", json={"title": "권한 보기", "ownerId": owner_id})
    assert res.status_code == 201, res.json()
    agenda: dict[str, Any] = res.json()
    return agenda


async def test_agenda_edit_and_delete_are_for_creator_owner_and_admins(
    as_member: AsMember,
) -> None:
    """u2 가 만들고 u4 가 맡은 안건 — u1 은 p1 관리자, admin 은 시스템 관리자, u3 는 남."""
    u2 = await as_member("u2")
    agenda = await _agenda_by(u2, "u4")
    assert agenda["creatorId"] == "u2" and agenda["ownerId"] == "u4"
    for who in ("u2", "u4", "u1", "admin"):
        c = await as_member(who)
        assert (
            await c.patch(f"/api/agendas/{agenda['id']}", json={"title": who})
        ).status_code == 200

    u3 = await as_member("u3")
    for method, url, body in [
        ("PATCH", f"/api/agendas/{agenda['id']}", {"title": "남이 고침"}),
        ("DELETE", f"/api/agendas/{agenda['id']}", None),
    ]:
        res = await u3.request(method, url, json=body)
        assert res.status_code == 403, (method, url)
        assert res.json()["code"] == "FORBIDDEN"

    # 지우기는 넷 다 된다 — 담당자도
    for who in ("u2", "u4", "u1", "admin"):
        made = await _agenda_by(u2, "u4")
        res = await (await as_member(who)).delete(f"/api/agendas/{made['id']}")
        assert res.status_code == 204, who
        gone = await (await as_member(who)).patch(f"/api/agendas/{made['id']}", json={})
        assert gone.status_code == 404 and gone.json()["code"] == "AGENDA_NOT_FOUND"


async def test_decision_and_state_are_for_the_same_four(as_member: AsMember) -> None:
    """결정내용 · 상태를 바꾸는 것도 PATCH 다 — 이력 줄을 누구나 남기던 길은 없어졌다."""
    agenda = await _agenda_by(await as_member("u2"), "u4")
    url = f"/api/agendas/{agenda['id']}"
    u3 = await as_member("u3")
    for body in ({"decision": "정함"}, {"state": "decided"}):
        res = await u3.patch(url, json=body)
        assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN", body
    for who in ("u2", "u4", "u1", "admin"):
        res = await (await as_member(who)).patch(url, json={"decision": f"{who} 정함"})
        assert res.status_code == 200, who
    # 회의록 반영도 같은 넷만 기존 안건의 결정을 갈아끼운다
    res = await u3.post(
        "/api/minutes/m1/apply",
        json={"updates": [{"agendaId": agenda["id"], "decision": "몰래", "state": "decided"}]},
    )
    assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN"


async def test_agenda_edit_judges_the_agenda_before_the_change(as_member: AsMember) -> None:
    agenda = await _agenda_by(await as_member("u2"), "u4")
    u3 = await as_member("u3")
    url = f"/api/agendas/{agenda['id']}"
    assert (await u3.patch(url, json={"ownerId": "u3"})).status_code == 403
    u4 = await as_member("u4")
    handed = await u4.patch(url, json={"ownerId": "u3"})
    assert handed.status_code == 200 and handed.json()["ownerId"] == "u3"
    assert (await u4.patch(url, json={"ownerId": "u4"})).status_code == 403
    assert (await u3.patch(url, json={"title": "새 담당"})).status_code == 200


async def test_agenda_without_a_creator_is_for_owner_and_admins(as_member: AsMember) -> None:
    """시드 t4 는 담당도 등록한 사람도 없다 — 관리자만 고친다."""
    u2 = await as_member("u2")
    assert (await u2.patch("/api/agendas/t4", json={"title": "x"})).status_code == 403
    assert (await (await as_member("u1")).patch("/api/agendas/t4", json={})).status_code == 200

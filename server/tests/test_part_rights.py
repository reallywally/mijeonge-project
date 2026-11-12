"""파트 권한 — `docs/api/part.md` '파트 권한 (2026-11-12)'.

보기는 열려 있고, 소속의 등록 · 수정 · 삭제가 그 파트 작업 · 테스트 쓰기를 가른다.
공통(파트 없음)은 예전 규칙 그대로, 관리자는 다 된다, 안건은 타지 않는다.

시드: p1 에 pt1(인프라 · u3) · pt2(AI · u1 · u4) · pt3(기간계 연동 · u2), 시드 소속은 넷 다 켬.
u1 은 p1 관리자, u2 ~ u4 는 user, `client` 는 시스템 관리자.
"""

from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from tests.conftest import AsMember

TASKS = "/api/projects/p1/tasks"
TESTS = "/api/projects/p1/tests"
OFF = {"canView": False, "canCreate": False, "canUpdate": False, "canDelete": False}
ALL = {"canView": True, "canCreate": True, "canUpdate": True, "canDelete": True}


async def grant(client: httpx.AsyncClient, part_id: str, member_id: str, **rights: bool) -> Any:
    res = await client.put(f"/api/parts/{part_id}/members/{member_id}", json=rights)
    assert res.status_code == 200, res.json()
    return res.json()


async def new_task(c: httpx.AsyncClient, **fields: Any) -> str:
    res = await c.post(TASKS, json={"title": "파트 권한", **fields})
    assert res.status_code == 201, res.json()
    task_id: str = res.json()["id"]
    return task_id


async def new_test(c: httpx.AsyncClient, **fields: Any) -> str:
    res = await c.post(TESTS, json={"title": "파트 권한", **fields})
    assert res.status_code == 201, res.json()
    test_id: str = res.json()["id"]
    return test_id


# --- 이행 0040 -----------------------------------------------------------------------


def test_migration_turns_existing_members_all_on() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0040_part_rights")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:at]:
                revision.module.upgrade()
            # 소속 줄만 본다 — 참조할 파트 · 멤버 줄은 세우지 않고 FK 검사를 커밋까지 미룬다
            conn.execute(text("pragma defer_foreign_keys=on"))
            conn.execute(
                text(
                    "insert into part_member (part_id, member_id, created_at)"
                    " values ('pt1', 'u3', '2026-10-14 00:00:00')"
                )
            )
            revisions[at].module.upgrade()
            flags = "can_view, can_create, can_update, can_delete"
            old = conn.execute(text(f"select {flags} from part_member")).one()
            assert tuple(old) == (1, 1, 1, 1)
            # 새 줄의 열 기본값 — 지우기만 끔
            conn.execute(
                text(
                    "insert into part_member (part_id, member_id, created_at)"
                    " values ('pt1', 'u4', '2026-11-12 00:00:00')"
                )
            )
            new = conn.execute(
                text(f"select {flags} from part_member where member_id = 'u4'")
            ).one()
            assert tuple(new) == (1, 1, 1, 0)
            revisions[at].module.downgrade()
            columns = [c["name"] for c in inspect(conn).get_columns("part_member")]
            assert columns == ["part_id", "member_id", "created_at"]
            conn.execute(text("delete from part_member"))


# --- PUT 소속 · 권한 -------------------------------------------------------------------


async def test_new_member_defaults_and_keeps_unsent(client: httpx.AsyncClient) -> None:
    assert await grant(client, "pt1", "u2") == {
        "partId": "pt1",
        "memberId": "u2",
        "canView": True,
        "canCreate": True,
        "canUpdate": True,
        "canDelete": False,
    }
    # 있던 소속은 보낸 것만 바뀐다
    assert (await grant(client, "pt1", "u2", canCreate=False))["canCreate"] is False
    kept = await grant(client, "pt1", "u2")
    assert (kept["canView"], kept["canCreate"], kept["canUpdate"]) == (True, False, True)
    # 새 소속이어도 보낸 것은 그대로 든다
    assert await grant(client, "pt3", "u4", canCreate=False, canUpdate=False) == {
        "partId": "pt3",
        "memberId": "u4",
        "canView": True,
        "canCreate": False,
        "canUpdate": False,
        "canDelete": False,
    }


async def test_rights_are_normalized_upward(client: httpx.AsyncClient) -> None:
    assert await grant(client, "pt1", "u3", **OFF) == {"partId": "pt1", "memberId": "u3", **OFF}
    # 삭제 ⇒ 수정 ⇒ 보기
    on = await grant(client, "pt1", "u3", canDelete=True)
    assert (on["canView"], on["canCreate"], on["canUpdate"], on["canDelete"]) == (
        True,
        False,
        True,
        True,
    )
    # 수정만 끄면 삭제가 남아 있어 다시 켜진다 — 끄는 쪽 맞추기는 화면이 한다
    assert (await grant(client, "pt1", "u3", canUpdate=False))["canUpdate"] is True
    # 보기만 끄면 등록 · 수정이 다시 켠다
    assert (await grant(client, "pt1", "u3", canView=False))["canView"] is True
    # 등록 ⇒ 보기
    alone = await grant(client, "pt1", "u3", **OFF | {"canCreate": True})
    assert (alone["canView"], alone["canCreate"]) == (True, True)


async def test_put_body_rules(client: httpx.AsyncClient, as_member: AsMember) -> None:
    res = await client.put("/api/parts/pt1/members/u2", json={"canView": None})
    assert res.status_code == 422
    u3 = await as_member("u3")
    denied = await u3.put("/api/parts/pt1/members/u2", json={"canView": True})
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"


async def test_snapshot_carries_rights(client: httpx.AsyncClient) -> None:
    await grant(client, "pt1", "u3", **OFF | {"canView": True})
    rows = (await client.get("/api/projects/p1/snapshot")).json()["partMembers"]
    assert {"partId": "pt1", "memberId": "u3", **OFF, "canView": True} in rows


# --- 작업 ---------------------------------------------------------------------------


async def test_task_create_needs_create_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u2 = await as_member("u2")
    # 공통은 예전 그대로 누구나
    await new_task(u2)
    res = await u2.post(TASKS, json={"title": "x", "partId": "pt1"})
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    assert res.json()["message"] == "이 파트에 작업을 등록할 권한이 없습니다."
    # 상위(k21, 인프라)를 따라온 파트도 같다
    inherited = await u2.post(TASKS, json={"title": "x", "parentId": "k21"})
    assert inherited.status_code == 403
    # 공통으로 보내면 상위가 파트여도 된다
    await new_task(u2, parentId="k21", partId=None)

    await grant(client, "pt1", "u2", **OFF | {"canCreate": True})
    await new_task(u2, partId="pt1")
    await new_task(u2, parentId="k21")


async def test_task_batch_checks_every_item(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    before = len((await client.get("/api/projects/p1/snapshot")).json()["tasks"])
    res = await u2.post(
        f"{TASKS}/batch",
        json={
            "tasks": [
                {"tempId": "a", "title": "인프라", "partId": "pt1"},
                {"tempId": "b", "title": "따라감", "parentTempId": "a"},
                {"tempId": "c", "title": "공통"},
                {"tempId": "d", "title": "상위 따라감", "parentId": "k21"},
                {"tempId": "e", "title": "내 파트", "partId": "pt3"},
            ]
        },
    )
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    assert set(res.json()["detail"]) == {"tasks.0.partId", "tasks.1.partId", "tasks.3.partId"}
    after = len((await client.get("/api/projects/p1/snapshot")).json()["tasks"])
    assert after == before


async def test_task_edit_rules(client: httpx.AsyncClient, as_member: AsMember) -> None:
    task_id = await new_task(client, partId="pt1", ownerId="u4")
    u2, u4 = await as_member("u2"), await as_member("u4")
    url = f"/api/tasks/{task_id}"
    assert (await u2.patch(url, json={"priority": "high"})).status_code == 403
    # 담당자는 파트 권한 없이도 고친다
    assert (await u4.patch(url, json={"priority": "high"})).status_code == 200
    # 수정 권한이 고친다 — 본문 줄 · 안건 링크도 같은 권한이다
    await grant(client, "pt1", "u2", **OFF | {"canUpdate": True})
    assert (await u2.patch(url, json={"priority": "low"})).status_code == 200
    assert (await u2.put(f"{url}/agendas/t1")).status_code == 200
    await grant(client, "pt1", "u2", **OFF)
    assert (await u2.delete(f"{url}/agendas/t1")).status_code == 403


async def test_creator_alone_cannot_edit_part_task(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u3 = await as_member("u3")
    task_id = await new_task(u3, partId="pt1")
    await grant(client, "pt1", "u3", **OFF | {"canView": True})
    assert (await u3.patch(f"/api/tasks/{task_id}", json={})).status_code == 403
    assert (await u3.delete(f"/api/tasks/{task_id}")).status_code == 403
    # 공통 작업은 예전 그대로 생성자가 고치고 지운다
    common = await new_task(u3)
    assert (await u3.patch(f"/api/tasks/{common}", json={"priority": "high"})).status_code == 200
    assert (await u3.delete(f"/api/tasks/{common}")).status_code == 204


async def test_task_part_move_needs_update_in_target(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u3 = await as_member("u3")
    task_id = await new_task(u3, partId="pt1")
    url = f"/api/tasks/{task_id}"
    res = await u3.patch(url, json={"partId": "pt3"})
    assert res.status_code == 403
    assert res.json()["message"] == "옮길 파트에 작업을 고칠 권한이 없습니다."
    await grant(client, "pt3", "u3", **OFF | {"canUpdate": True})
    assert (await u3.patch(url, json={"partId": "pt3"})).json()["partId"] == "pt3"
    # 공통으로 빼는 것은 고칠 수 있으면 된다
    assert (await u3.patch(url, json={"partId": None})).json()["partId"] is None


async def test_task_delete_needs_delete_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u3 = await as_member("u3")
    others = await new_task(client, partId="pt1")
    # 시드 소속은 삭제가 켜 있다 — 남이 만든 것도 지운다
    assert (await u3.delete(f"/api/tasks/{others}")).status_code == 204
    await grant(client, "pt1", "u3", canDelete=False)
    mine = await new_task(u3, partId="pt1")
    assert (await u3.delete(f"/api/tasks/{mine}")).status_code == 403

    # 줄기 중 하나라도 못 지우면 아무것도 안 지운다
    await grant(client, "pt1", "u3", canDelete=True)
    parent = await new_task(client, partId="pt1")
    await new_task(client, parentId=parent, partId="pt2")
    res = await u3.delete(f"/api/tasks/{parent}")
    assert res.status_code == 403
    assert res.json()["message"] == "지울 수 없는 하위 작업이 있습니다."


@pytest.mark.parametrize("who", ["u1", "admin"])
async def test_managers_bypass_part_rights(
    client: httpx.AsyncClient, as_member: AsMember, who: str
) -> None:
    """u1 은 p1 관리자(인프라 소속 아님), admin 은 시스템 관리자."""
    c = client if who == "admin" else await as_member(who)
    task_id = await new_task(c, partId="pt1")
    assert (await c.patch(f"/api/tasks/{task_id}", json={"partId": "pt3"})).status_code == 200
    assert (await c.delete(f"/api/tasks/{task_id}")).status_code == 204
    test_id = await new_test(c, partId="pt1")
    assert (await c.patch(f"/api/tests/{test_id}", json={"partId": "pt3"})).status_code == 200
    assert (await c.delete(f"/api/tests/{test_id}")).status_code == 204


async def test_agendas_ignore_part_rights(as_member: AsMember) -> None:
    """안건은 파트를 넘나든다 — 인프라 소속이 아닌 u2 도 인프라 안건을 만든다."""
    u2 = await as_member("u2")
    res = await u2.post("/api/projects/p1/agendas", json={"title": "x", "partId": "pt1"})
    assert res.status_code == 201, res.json()


# --- 테스트 -------------------------------------------------------------------------


async def test_test_create_needs_create_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u2 = await as_member("u2")
    await new_test(u2)
    res = await u2.post(TESTS, json={"title": "x", "partId": "pt1"})
    assert res.status_code == 403
    assert res.json()["message"] == "이 파트에 테스트를 등록할 권한이 없습니다."
    parent = await new_test(client, partId="pt1")
    assert (await u2.post(TESTS, json={"title": "x", "parentId": parent})).status_code == 403
    await grant(client, "pt1", "u2", **OFF | {"canCreate": True})
    await new_test(u2, parentId=parent)


async def test_test_writes_need_update_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    test_id = await new_test(client, partId="pt1", ownerId="u4")
    u2, u4 = await as_member("u2"), await as_member("u4")
    url = f"/api/tests/{test_id}"
    writes = [
        ("PATCH", url, {"title": "고침"}),
        ("POST", f"{url}/status", {"status": "testing"}),
        ("PUT", f"{url}/refs/task/k1", None),
        ("DELETE", f"{url}/refs/task/k1", None),
        ("POST", f"{url}/basis", None),
    ]
    for method, path, body in writes:
        res = await u2.request(method, path, json=body)
        assert res.status_code == 403, path
        assert res.json()["code"] == "FORBIDDEN"
    # 조치 내역은 막지 않는다 — 작업 댓글과 같다
    comment = await u2.post(f"{url}/comments", json={"body": "봤습니다"})
    assert comment.status_code == 201
    # 담당자 · 수정 권한은 된다
    for c in (u4, u2):
        if c is u2:
            await grant(client, "pt1", "u2", **OFF | {"canUpdate": True})
        for method, path, body in writes:
            res = await c.request(method, path, json=body)
            assert res.status_code in (200, 204), (path, res.json())


async def test_test_part_move_and_delete(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u3 = await as_member("u3")
    test_id = await new_test(u3, partId="pt1")
    url = f"/api/tests/{test_id}"
    res = await u3.patch(url, json={"partId": "pt3"})
    assert res.status_code == 403
    assert res.json()["message"] == "옮길 파트에 테스트를 고칠 권한이 없습니다."
    assert (await u3.patch(url, json={"partId": None})).status_code == 200
    assert (await u3.patch(url, json={"partId": "pt1"})).status_code == 200

    await grant(client, "pt1", "u3", canDelete=False)
    assert (await u3.delete(url)).status_code == 403
    await grant(client, "pt1", "u3", canDelete=True)
    others = await new_test(client, partId="pt1")
    assert (await u3.delete(f"/api/tests/{others}")).status_code == 204
    assert (await u3.delete(url)).status_code == 204


async def test_common_tests_unchanged(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """공통 테스트는 프로젝트 누구나 고치고, 지우기는 만든 사람 · 관리자."""
    test_id = await new_test(await as_member("u3"))
    u2 = await as_member("u2")
    url = f"/api/tests/{test_id}"
    assert (await u2.patch(url, json={"title": "남이 고침"})).status_code == 200
    assert (await u2.post(f"{url}/status", json={"status": "testing"})).status_code == 200
    assert (await u2.delete(url)).status_code == 403
    assert (await (await as_member("u3")).delete(url)).status_code == 204

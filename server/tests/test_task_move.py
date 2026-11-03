"""작업 순서(`Task.order`) · 옮기기(`POST /api/tasks/{taskId}/move`) — 2026-11-03 간트에서 줄 끌기.

시드 p1 의 트리 — 최상위 k1 · k4 · k5, k1 › k2 · k3, k4 › k19 · k20 · k21 · k22,
k5 › k6 · k17 · k18, k6 › k7 · k12 · k14, k7 › k8 ~ k11, k12 › k13, k14 › k15 · k16.
"""

from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from tests.conftest import AsMember
from tests.test_minutes import minutes, task
from tests.test_read_api import TASK_KEYS


async def tree(c: httpx.AsyncClient, parent_id: str | None) -> list[str]:
    """그 상위의 하위를 order 순으로."""
    rows = (await c.get("/api/projects/p1/snapshot")).json()["tasks"]
    kids = [row for row in rows if row["parentId"] == parent_id]
    orders = [row["order"] for row in sorted(kids, key=lambda row: row["order"])]
    assert len(set(orders)) == len(orders), orders  # 한 상위 안에서 겹치지 않는다
    return [row["id"] for row in sorted(kids, key=lambda row: row["order"])]


async def move(
    c: httpx.AsyncClient, task_id: str, parent_id: str | None, before_id: str | None
) -> httpx.Response:
    return await c.post(
        f"/api/tasks/{task_id}/move", json={"parentId": parent_id, "beforeId": before_id}
    )


def orders(res: httpx.Response) -> dict[str, tuple[str | None, int]]:
    assert res.status_code == 200, res.text
    return {row["id"]: (row["parentId"], row["order"]) for row in res.json()}


async def history(c: httpx.AsyncClient, task_id: str) -> list[list[dict[str, Any]]]:
    return [line["changes"] for line in (await c.get(f"/api/tasks/{task_id}/history")).json()]


# --- 순서 칸 ------------------------------------------------------------------------------


async def test_seed_orders_follow_the_array(client: httpx.AsyncClient) -> None:
    assert await tree(client, None) == ["k1", "k4", "k5"]
    assert await tree(client, "k4") == ["k19", "k20", "k21", "k22"]
    rows = (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
    assert {row["id"]: row["order"] for row in rows if row["parentId"] == "k7"} == {
        "k8": 0,
        "k9": 1,
        "k10": 2,
        "k11": 3,
    }
    # 스냅샷 배열은 그대로 등록 순이다
    assert [row["id"] for row in rows][:3] == ["k1", "k2", "k3"]


async def test_new_tasks_go_to_the_end(client: httpx.AsyncClient) -> None:
    top = (await client.post("/api/projects/p1/tasks", json={"title": "맨 위"})).json()
    under = (
        await client.post("/api/projects/p1/tasks", json={"title": "밑", "parentId": "k4"})
    ).json()
    assert (top["order"], under["order"]) == (3, 4)

    batch = {
        "tasks": [
            {"tempId": "a", "title": "가", "parentId": "k4"},
            {"tempId": "b", "title": "나", "parentId": "k4"},
            {"tempId": "c", "title": "다", "parentTempId": "a"},
            {"tempId": "d", "title": "라", "parentTempId": "a"},
        ]
    }
    made = (await client.post("/api/projects/p1/tasks/batch", json=batch)).json()["tasks"]
    assert [row["order"] for row in made] == [5, 6, 0, 1]

    applied = await client.post(
        "/api/minutes/m1/apply", json=minutes(tasks=[task("x", "하나"), task("y", "둘")])
    )
    assert applied.status_code == 201, applied.text
    assert [row["order"] for row in applied.json()["tasks"]] == [4, 5]


async def test_deleted_siblings_do_not_hold_the_end(client: httpx.AsyncClient) -> None:
    last = (
        await client.post("/api/projects/p1/tasks", json={"title": "끝", "parentId": "k4"})
    ).json()
    assert last["order"] == 4
    assert (await client.delete(f"/api/tasks/{last['id']}")).status_code == 204
    again = await client.post("/api/projects/p1/tasks", json={"title": "끝", "parentId": "k4"})
    assert again.json()["order"] == 4


async def test_patch_parent_goes_to_the_end(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k3", json={"parentId": "k4"})
    assert res.status_code == 200 and res.json()["order"] == 4
    # 상위를 그대로 두는 수정은 자리를 안 바꾼다
    same = await client.patch("/api/tasks/k20", json={"parentId": "k4", "title": "DB"})
    assert same.json()["order"] == 1


# --- 옮기기 -------------------------------------------------------------------------------


async def test_reorder_in_the_same_parent(client: httpx.AsyncClient) -> None:
    res = await move(client, "k22", "k4", "k20")
    assert all(set(row) == TASK_KEYS for row in res.json())
    # 바뀐 것만 — k19 는 그대로라 안 나온다. 등록 순으로 낸다
    assert [row["id"] for row in res.json()] == ["k20", "k21", "k22"]
    assert orders(res) == {"k20": ("k4", 2), "k21": ("k4", 3), "k22": ("k4", 1)}
    assert await tree(client, "k4") == ["k19", "k22", "k20", "k21"]


async def test_before_null_is_the_end(client: httpx.AsyncClient) -> None:
    res = await move(client, "k19", "k4", None)
    assert orders(res) == {
        "k19": ("k4", 3),
        "k20": ("k4", 0),
        "k21": ("k4", 1),
        "k22": ("k4", 2),
    }


async def test_move_to_another_parent_renumbers_both(client: httpx.AsyncClient) -> None:
    res = await move(client, "k2", "k4", "k20")
    # 옛 상위 k1 은 k3 이 0 으로 당겨진다
    assert orders(res) == {
        "k2": ("k4", 1),
        "k3": ("k1", 0),
        "k20": ("k4", 2),
        "k21": ("k4", 3),
        "k22": ("k4", 4),
    }
    assert await tree(client, "k4") == ["k19", "k2", "k20", "k21", "k22"]
    assert await tree(client, "k1") == ["k3"]


async def test_move_to_the_top(client: httpx.AsyncClient) -> None:
    res = await move(client, "k3", None, "k4")
    assert orders(res) == {"k3": (None, 1), "k4": (None, 2), "k5": (None, 3)}
    assert await tree(client, None) == ["k1", "k3", "k4", "k5"]
    assert await tree(client, "k1") == ["k2"]


async def test_same_place_is_an_empty_answer(client: httpx.AsyncClient) -> None:
    before = await history(client, "k20")
    for parent_id, before_id, task_id in (("k4", "k21", "k20"), ("k4", None, "k22")):
        res = await move(client, task_id, parent_id, before_id)
        assert res.status_code == 200 and res.json() == []
    assert await history(client, "k20") == before


async def test_history_only_when_the_parent_changes(client: httpx.AsyncClient) -> None:
    before = await history(client, "k22")
    assert (await move(client, "k22", "k4", "k19")).status_code == 200
    assert await history(client, "k22") == before  # 순서만 — 이력 없음

    assert (await move(client, "k22", "k1", None)).status_code == 200
    assert (await history(client, "k22"))[-1] == [
        {"field": "parentId", "from": "k4", "to": "k1", "subject": ""}
    ]
    assert (await move(client, "k22", None, None)).status_code == 200
    assert (await history(client, "k22"))[-1] == [
        {"field": "parentId", "from": "k1", "to": None, "subject": ""}
    ]
    # 형제는 order 만 바뀌어 이력이 안 는다
    assert len(await history(client, "k19")) == 1


async def test_part_does_not_follow(client: httpx.AsyncClient) -> None:
    rows = {t["id"]: t for t in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]}
    res = await move(client, "k19", "k5", None)
    moved = next(row for row in res.json() if row["id"] == "k19")
    assert moved["partId"] == rows["k19"]["partId"]


@pytest.mark.parametrize(
    ("task_id", "parent_id", "before_id", "code"),
    [
        ("k4", "k4", None, "TASK_PARENT_SELF"),
        ("k5", "k7", None, "TASK_PARENT_DESCENDANT"),
        ("k2", "nope", None, "TASK_PARENT_NOT_FOUND"),
        ("k2", "x1", None, "TASK_PARENT_OTHER_PROJECT"),
        # k6 은 3단 높이(k6 › k7 › k8) — 2단(k2) 밑이면 5단이다
        ("k6", "k2", None, "TASK_DEPTH_EXCEEDED"),
        ("k8", "k11", None, "TASK_DEPTH_EXCEEDED"),
        ("k20", "k4", "k2", "TASK_BEFORE_NOT_SIBLING"),
        ("k20", "k4", "k20", "TASK_BEFORE_NOT_SIBLING"),
        ("k20", "k4", "nope", "TASK_BEFORE_NOT_SIBLING"),
        # 상위만 바꾸고 앞의 형제를 옛 상위에서 고른 것
        ("k20", "k1", "k21", "TASK_BEFORE_NOT_SIBLING"),
    ],
)
async def test_bad_moves_are_400(
    client: httpx.AsyncClient, task_id: str, parent_id: str, before_id: str | None, code: str
) -> None:
    before = (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
    res = await move(client, task_id, parent_id, before_id)
    assert res.status_code == 400 and res.json()["code"] == code, res.text
    assert (await client.get("/api/projects/p1/snapshot")).json()["tasks"] == before


async def test_deleted_sibling_cannot_be_before(client: httpx.AsyncClient) -> None:
    made = (
        await client.post("/api/projects/p1/tasks", json={"title": "곧 지움", "parentId": "k4"})
    ).json()
    assert (await client.delete(f"/api/tasks/{made['id']}")).status_code == 204
    res = await move(client, "k20", "k4", made["id"])
    assert res.status_code == 400 and res.json()["code"] == "TASK_BEFORE_NOT_SIBLING"
    # 지운 형제는 다시 매길 때도 안 센다
    res = await move(client, "k19", "k4", None)
    assert made["id"] not in {row["id"] for row in res.json()}


async def test_missing_keys_are_422(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/tasks/k20/move", json={"beforeId": None})
    assert res.status_code == 422


async def test_move_is_for_those_who_edit_the_task(as_member: AsMember) -> None:
    """k17 은 등록한 사람 · 담당이 없다 — u2 는 못 옮기고 p1 관리자 u1 은 옮긴다.
    새 상위 · 형제의 권한은 안 본다 — u2 가 만든 k4 를 u3(k20 등록)가 형제로 밀어낸다."""
    u2 = await as_member("u2")
    denied = await move(u2, "k17", "k5", "k6")
    assert denied.status_code == 403 and denied.json()["code"] == "FORBIDDEN"
    assert (await move(await as_member("u1"), "k17", "k5", "k6")).status_code == 200

    res = await move(await as_member("u3"), "k20", None, "k1")
    assert {"k1", "k4", "k5", "k20"} <= set(orders(res))


async def test_deleted_task_is_404(client: httpx.AsyncClient) -> None:
    made = (await client.post("/api/projects/p1/tasks", json={"title": "지움"})).json()
    assert (await client.delete(f"/api/tasks/{made['id']}")).status_code == 204
    res = await move(client, made["id"], None, None)
    assert res.status_code == 404 and res.json()["code"] == "TASK_NOT_FOUND"
    missing = await move(client, "nope", None, None)
    assert missing.status_code == 404 and missing.json()["code"] == "TASK_NOT_FOUND"


# --- 마이그레이션 -------------------------------------------------------------------------


def test_migration_numbers_each_parent_by_seq() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0030_task_order")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text(
                    "insert into project (id, name, task_key_prefix) values"
                    " ('p', '피', 'P'), ('q', '큐', 'Q')"
                )
            )
            # (id, 프로젝트, 상위, seq) — seq 가 배열 순서와 다르게 섞여 있다
            rows = [
                ("a", "p", None, 3),
                ("b", "p", None, 1),
                ("c", "p", "b", 5),
                ("d", "p", "b", 2),
                ("e", "p", None, 4),
                ("f", "q", None, 6),
            ]
            for id_, project, parent, seq in sorted(rows, key=lambda row: row[3]):
                conn.execute(
                    text(
                        "insert into task (id, project_id, key, title, parent_id, status,"
                        " priority, created_at, seq) values (:id, :p, :key, '일', :parent,"
                        " 'todo', 'normal', '2026-11-01 00:00:00', :seq)"
                    ),
                    {"id": id_, "p": project, "key": f"K-{seq}", "parent": parent, "seq": seq},
                )
            revisions[head].module.upgrade()
            found = dict(conn.execute(text("select id, sort_order from task")).tuples().all())
            assert found == {"b": 0, "a": 1, "e": 2, "d": 0, "c": 1, "f": 0}

            revisions[head].module.downgrade()
            columns = {row[1] for row in conn.execute(text("pragma table_info(task)")).all()}
            assert "sort_order" not in columns and "seq" in columns

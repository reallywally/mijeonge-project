"""작업 쓰기 API — 발번 · 연관 작업 · 부분 수정 · 본문 줄 · 링크.

응답은 스냅샷이 쓰는 `TaskOut` 그대로다. 프론트가 바뀐 레코드를 바로 꽂을 수 있어야 하므로
키 집합을 읽기 API 와 **같은 상수**로 본다.
"""

from typing import get_args

import httpx
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskRelation
from app.models.task import TASK_LINE_KINDS, TASK_PRIORITIES, TASK_STATUSES
from app.schemas.task import TaskLineKindIn, TaskPriorityIn, TaskStatusIn
from tests.test_read_api import TASK_KEYS

NEW_TASK = {
    "title": "배포 파이프라인 만들기",
    "body": [
        # 화면이 실어 보내는 id 다 — 서버가 새 id 를 붙여 돌려줘야 한다
        {"id": "tmp1", "kind": "check", "text": "러너 등록", "done": False, "level": 0},
        {"id": "tmp2", "kind": "bullet", "text": "사내망에서만 돈다", "done": False, "level": 1},
    ],
    "status": "todo",
    "ownerId": "u3",
    "start": None,
    "due": None,
    "priority": "normal",
    "threadIds": ["t1"],
}


def test_input_literals_match_the_model() -> None:
    """입력 스키마가 모델의 체크 제약과 갈리면 DB 까지 가서야 터진다."""
    assert set(get_args(TaskStatusIn)) == set(TASK_STATUSES)
    assert set(get_args(TaskPriorityIn)) == set(TASK_PRIORITIES)
    assert set(get_args(TaskLineKindIn)) == set(TASK_LINE_KINDS)


async def test_add_task_answers_with_a_task(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK)
    assert res.status_code == 201
    task = res.json()

    assert set(task) == TASK_KEYS  # domain.ts 의 Task 와 한 필드씩 같다
    assert task["projectId"] == "p1"
    assert task["title"] == "배포 파이프라인 만들기"
    assert task["createdAt"].endswith("Z")  # ISO 8601 UTC (API.md Q3)


async def test_body_lines_get_server_ids_in_order(client: httpx.AsyncClient) -> None:
    """화면이 보낸 줄 id 는 화면 안에서만 쓰던 값이다 — 서버가 새로 붙인다."""
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()

    assert [line["text"] for line in task["body"]] == ["러너 등록", "사내망에서만 돈다"]
    assert [line["kind"] for line in task["body"]] == ["check", "bullet"]
    assert [line["id"] for line in task["body"]] != ["tmp1", "tmp2"]
    assert task["body"][1]["level"] == 1


async def test_keys_come_from_the_project_counter(client: httpx.AsyncClient) -> None:
    """픽스처가 HW-22 까지 썼다. 최댓값이 아니라 프로젝트의 카운터에서 센다."""
    first = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    second = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()

    assert [first["key"], second["key"]] == ["HW-23", "HW-24"]


async def test_key_prefix_follows_the_project(client: httpx.AsyncClient) -> None:
    body = NEW_TASK | {"threadIds": [], "ownerId": None}
    task = (await client.post("/api/projects/p2/tasks", json=body)).json()
    assert task["key"] == "PAS-3"


async def test_thread_ids_are_linked_on_creation(client: httpx.AsyncClient) -> None:
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": task["id"], "threadId": "t1"} in snap["taskThreadLinks"]


async def test_add_task_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/tasks", json=NEW_TASK)
    assert res.status_code == 404


async def test_add_task_with_unknown_owner_is_400(client: httpx.AsyncClient) -> None:
    before = len((await client.get("/api/projects/p1/snapshot")).json()["tasks"])
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"ownerId": "없음"})

    assert res.status_code == 400
    assert res.json()["code"] == "TASK_OWNER_NOT_FOUND"
    assert res.json()["detail"] == {"ownerId": "담당자를 찾을 수 없습니다."}
    after = len((await client.get("/api/projects/p1/snapshot")).json()["tasks"])
    assert after == before


async def test_written_task_shows_up_at_the_end_of_the_snapshot(
    client: httpx.AsyncClient,
) -> None:
    """등록 순서(seq)가 제대로 채워졌는지 — 배열 순서가 곧 화면 순서다."""
    task = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["tasks"][-1]["id"] == task["id"]
    assert len(snap["tasks"]) == 23


async def test_new_task_has_no_related_and_ignores_the_key(client: httpx.AsyncClient) -> None:
    """등록은 relatedIds 를 받지 않는다 — 등록 뒤 상세에서 건다 (Q61). 모르는 키는 버린다."""
    res = await client.post("/api/projects/p1/tasks", json=NEW_TASK | {"relatedIds": ["k1"]})
    assert res.status_code == 201
    assert res.json()["relatedIds"] == []


async def test_snapshot_carries_related_ids_one_way(client: httpx.AsyncClient) -> None:
    """시드는 0021 과 같다 — 예전 하위가 예전 상위를 건다. 걸린 쪽에는 안 보인다."""
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    by_id = {task["id"]: task for task in snap["tasks"]}
    assert by_id["k20"]["relatedIds"] == ["k4"]
    assert by_id["k4"]["relatedIds"] == []


async def test_patch_related_ids_replaces_the_whole_list(client: httpx.AsyncClient) -> None:
    first = await client.patch("/api/tasks/k20", json={"relatedIds": ["k4", "k19", "k4"]})
    assert first.status_code == 200
    # 중복은 한 번. 남는 줄(k4)이 먼저, 새로 건 것이 뒤에
    assert first.json()["relatedIds"] == ["k4", "k19"]

    second = await client.patch("/api/tasks/k20", json={"relatedIds": ["k21", "k19"]})
    assert second.json()["relatedIds"] == ["k19", "k21"]

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    by_id = {task["id"]: task for task in snap["tasks"]}
    assert by_id["k20"]["relatedIds"] == ["k19", "k21"]
    # 한 방향 — 걸린 쪽에는 안 생긴다
    assert by_id["k21"]["relatedIds"] == ["k4"]

    cleared = await client.patch("/api/tasks/k20", json={"relatedIds": []})
    assert cleared.json()["relatedIds"] == []


async def test_patch_without_related_ids_keeps_them(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k20", json={"title": "DB 설치"})
    assert res.json()["relatedIds"] == ["k4"]


async def test_related_null_is_422(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k20", json={"relatedIds": None})
    assert res.status_code == 422
    assert "relatedIds" in res.json()["detail"]


async def test_related_over_twenty_is_422(client: httpx.AsyncClient) -> None:
    ids = [f"k{n}" for n in range(1, 23) if n != 20]  # 21개
    res = await client.patch("/api/tasks/k20", json={"relatedIds": ids})
    assert res.status_code == 422
    assert res.json()["detail"] == {"relatedIds": "너무 많습니다."}
    # 중복을 빼고 세면 20개 — 통과한다
    ok = await client.patch("/api/tasks/k20", json={"relatedIds": ids[:20] + ids[:5]})
    assert ok.status_code == 200 and len(ok.json()["relatedIds"]) == 20


async def test_task_cannot_relate_to_itself(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4", json={"relatedIds": ["k1", "k4"]})
    assert res.status_code == 400
    assert res.json() == {
        "code": "TASK_RELATED_SELF",
        "message": "자기 자신은 연관 작업으로 걸 수 없습니다.",
    }


async def test_related_must_be_in_the_same_project(client: httpx.AsyncClient) -> None:
    for wrong in ("x1", "없음"):
        res = await client.patch("/api/tasks/k20", json={"relatedIds": ["k1", wrong]})
        assert res.status_code == 400
        assert res.json()["code"] == "TASK_RELATED_NOT_FOUND"
        assert res.json()["message"] == "연관 작업을 찾을 수 없습니다."
    # 실패한 수정은 아무것도 안 남긴다
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert next(t for t in snap["tasks"] if t["id"] == "k20")["relatedIds"] == ["k4"]


async def test_deleting_a_task_drops_relations_both_ways(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await client.patch("/api/tasks/k20", json={"relatedIds": ["k4", "k19"]})
    await session.execute(delete(Task).where(Task.id == "k19"))
    await session.commit()
    left = await session.scalar(
        select(func.count()).select_from(TaskRelation).where(TaskRelation.related_id == "k19")
    )
    assert left == 0


async def test_patch_touches_only_what_was_sent(client: httpx.AsyncClient) -> None:
    """`{"ownerId": null}` 은 담당자 지우기다 — 안 보낸 것과 갈라야 한다."""
    before = (await client.get("/api/projects/p1/snapshot")).json()
    k4 = next(t for t in before["tasks"] if t["id"] == "k4")

    task = (await client.patch("/api/tasks/k4", json={"ownerId": None})).json()
    assert task["ownerId"] is None
    assert task["title"] == k4["title"]
    assert task["status"] == k4["status"]
    assert task["start"] == k4["start"] and task["due"] == k4["due"]

    again = (await client.patch("/api/tasks/k4", json={"status": "done"})).json()
    assert again["status"] == "done"
    assert again["ownerId"] is None  # 지운 담당자가 되살아나지 않는다


async def test_patch_with_unknown_owner_is_400(client: httpx.AsyncClient) -> None:
    before = next(
        t
        for t in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
        if t["id"] == "k4"
    )
    res = await client.patch("/api/tasks/k4", json={"ownerId": "없음", "status": "done"})

    assert res.status_code == 400
    assert res.json()["code"] == "TASK_OWNER_NOT_FOUND"
    after = next(
        t
        for t in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
        if t["id"] == "k4"
    )
    assert after == before  # 같이 보낸 status 도 안 바뀐다


async def test_patch_can_set_one_side_of_the_period(client: httpx.AsyncClient) -> None:
    """'둘 다 있을 때만'은 간트 화면의 규칙이다 — 서버가 따라 하지 않는다."""
    task = (await client.patch("/api/tasks/k18", json={"start": "2026-10-01"})).json()
    assert task["start"] == "2026-10-01"
    assert task["due"] is None


async def test_patch_rejects_an_unknown_status(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4", json={"status": "미정"})
    assert res.status_code == 422


async def test_patch_on_unknown_task_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/없는작업", json={"status": "done"})
    assert res.status_code == 404


async def test_check_line_toggles(client: httpx.AsyncClient) -> None:
    task = (await client.patch("/api/tasks/k4/lines/l3", json={"done": True})).json()
    line = next(each for each in task["body"] if each["id"] == "l3")
    assert line["done"] is True
    assert task["body"][0]["done"] is True  # 다른 줄은 그대로다

    back = (await client.patch("/api/tasks/k4/lines/l3", json={"done": False})).json()
    assert next(each for each in back["body"] if each["id"] == "l3")["done"] is False


async def test_bullet_line_cannot_be_toggled(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4/lines/l5", json={"done": True})
    assert res.status_code == 400


async def test_unknown_line_is_404(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4/lines/없는줄", json={"done": True})
    assert res.status_code == 404


async def test_thread_link_is_idempotent(client: httpx.AsyncClient) -> None:
    first = await client.put("/api/tasks/k1/threads/t4")
    second = await client.put("/api/tasks/k1/threads/t4")
    assert first.status_code == 200
    assert first.json() == second.json() == {"taskId": "k1", "threadId": "t4"}

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert [link for link in snap["taskThreadLinks"] if link["taskId"] == "k1"] == [
        {"taskId": "k1", "threadId": "t4"}
    ]


async def test_unlinking_what_is_not_linked_still_works(client: httpx.AsyncClient) -> None:
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204

    await client.put("/api/tasks/k1/threads/t4")
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204
    assert (await client.delete("/api/tasks/k1/threads/t4")).status_code == 204

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": "k1", "threadId": "t4"} not in snap["taskThreadLinks"]


async def test_link_needs_both_sides_in_one_project(client: httpx.AsyncClient) -> None:
    assert (await client.put("/api/tasks/k1/threads/t10")).status_code == 400
    assert (await client.put("/api/tasks/없는작업/threads/t4")).status_code == 404
    assert (await client.put("/api/tasks/k1/threads/없는안건")).status_code == 404


async def test_meeting_routes_are_gone(client: httpx.AsyncClient) -> None:
    """회의는 걷어냈다 — 링크 경로도 회의 저장 경로도 남아 있지 않다."""
    assert (await client.put("/api/tasks/k1/meetings/m1")).status_code == 404
    assert (await client.delete("/api/tasks/k1/meetings/m1")).status_code == 404
    assert (await client.put("/api/meetings/m1/tasks/k1")).status_code == 404
    res = await client.post("/api/projects/p1/meetings", json={"title": "x", "date": "2026-09-10"})
    assert res.status_code == 404


async def _body_of(client: httpx.AsyncClient, task_id: str) -> list[dict[str, object]]:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    task = next(each for each in snap["tasks"] if each["id"] == task_id)
    lines: list[dict[str, object]] = task["body"]
    return lines


async def test_body_patch_replaces_the_whole_body_in_order(client: httpx.AsyncClient) -> None:
    body = [
        {"kind": "bullet", "text": "새 첫 줄", "level": 1},
        {"id": "l3", "kind": "check", "text": "mysql 설치", "done": True},
    ]
    res = await client.patch("/api/tasks/k4", json={"body": body})
    assert res.status_code == 200
    task = res.json()

    assert [line["text"] for line in task["body"]] == ["새 첫 줄", "mysql 설치"]
    assert task["body"][0] == task["body"][0] | {"kind": "bullet", "done": False, "level": 1}
    assert task["body"][1] | {"id": "l3", "done": True, "level": 0} == task["body"][1]
    # 다시 읽어도 같은 순서 · 같은 줄만 남는다
    assert await _body_of(client, "k4") == task["body"]


async def test_body_patch_keeps_known_ids_and_gives_new_ones_otherwise(
    client: httpx.AsyncClient,
) -> None:
    other = (await client.post("/api/projects/p1/tasks", json=NEW_TASK)).json()
    other_line = other["body"][0]["id"]
    body = [
        {"id": "l1", "kind": "check", "text": "a"},
        {"id": "모르는줄", "kind": "check", "text": "b"},
        {"id": other_line, "kind": "check", "text": "c"},  # 남의 작업 줄
        {"id": "l1", "kind": "check", "text": "d"},  # 같은 요청에 두 번
        {"kind": "bullet", "text": "e"},
    ]
    task = (await client.patch("/api/tasks/k4", json={"body": body})).json()
    ids = [line["id"] for line in task["body"]]

    assert ids[0] == "l1"
    assert "모르는줄" not in ids
    assert other_line not in ids
    assert ids.count("l1") == 1
    assert len(set(ids)) == 5
    # 남의 작업 본문은 손대지 않는다
    assert [line["id"] for line in await _body_of(client, other["id"])] == [
        line["id"] for line in other["body"]
    ]


async def test_empty_body_clears_it(client: httpx.AsyncClient) -> None:
    task = (await client.patch("/api/tasks/k4", json={"body": []})).json()
    assert task["body"] == []
    assert await _body_of(client, "k4") == []


async def test_null_body_is_422(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/tasks/k4", json={"body": None})
    assert res.status_code == 422


async def test_body_left_out_stays(client: httpx.AsyncClient) -> None:
    before = await _body_of(client, "k4")
    task = (await client.patch("/api/tasks/k4", json={"status": "doing"})).json()
    assert task["status"] == "doing"
    assert task["body"] == before


async def test_body_goes_with_other_fields(client: httpx.AsyncClient) -> None:
    body = [{"id": "l3", "kind": "check", "text": "mysql"}]
    task = (await client.patch("/api/tasks/k4", json={"title": "새 제목", "body": body})).json()
    assert task["title"] == "새 제목"
    assert [line["id"] for line in task["body"]] == ["l3"]


async def test_line_toggle_works_on_a_kept_id(client: httpx.AsyncClient) -> None:
    body = [
        {"kind": "check", "text": "앞에 끼운 줄"},
        {"id": "l3", "kind": "check", "text": "mysql"},
    ]
    patched = (await client.patch("/api/tasks/k4", json={"body": body})).json()
    fresh = patched["body"][0]["id"]

    task = (await client.patch("/api/tasks/k4/lines/l3", json={"done": True})).json()
    assert next(each for each in task["body"] if each["id"] == "l3")["done"] is True
    task = (await client.patch(f"/api/tasks/k4/lines/{fresh}", json={"done": True})).json()
    assert all(line["done"] for line in task["body"])


# --- 마이그레이션 0021 — 지난 상위를 연관 작업으로 (Q61) ------------------------------------


def test_migration_moves_parents_to_relations() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0021_task_relation")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            # 상위가 먼저 들어가야 복합 FK 가 선다. a › b › c, a › d
            for number, (task_id, parent) in enumerate(
                (("a", None), ("b", "a"), ("c", "b"), ("d", "a")), start=1
            ):
                conn.execute(
                    text(
                        "insert into task (id, project_id, key, title, parent_id, status,"
                        " priority, created_at, seq) values (:id, 'p', :key, '일', :parent,"
                        " 'todo', 'normal', :at, :seq)"
                    ),
                    {
                        "id": task_id,
                        "key": f"P-{number}",
                        "parent": parent,
                        "at": f"2026-09-0{number} 00:00:00",
                        "seq": number,
                    },
                )
            revisions[head].module.upgrade()

            rows = conn.execute(
                text(
                    "select task_id, related_id, project_id, created_at from task_relation"
                    " order by task_id"
                )
            ).all()
            # 하위 → 상위 한 줄씩. 건 시각은 하위의 등록 시각
            assert [tuple(row[:3]) for row in rows] == [
                ("b", "a", "p"),
                ("c", "b", "p"),
                ("d", "a", "p"),
            ]
            assert [str(row[3])[:10] for row in rows] == ["2026-09-02", "2026-09-03", "2026-09-04"]
            columns = {row[1] for row in conn.execute(text("pragma table_info(task)")).all()}
            assert "parent_id" not in columns
            # 작업은 그대로 남는다
            assert conn.execute(text("select count(*) from task")).scalar() == 4

            # 되돌리면 건 순서의 첫 줄이 상위가 된다
            conn.execute(
                text(
                    "insert into task_relation (task_id, related_id, project_id, created_at)"
                    " values ('b', 'd', 'p', '2026-10-01 00:00:00')"
                )
            )
            revisions[head].module.downgrade()
            parents = dict(
                conn.execute(text("select id, parent_id from task order by id")).tuples().all()
            )
            assert parents == {"a": None, "b": "a", "c": "b", "d": "a"}
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "task_relation" not in tables

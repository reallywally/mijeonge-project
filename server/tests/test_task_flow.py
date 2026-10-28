"""작업 상태 기록 — `docs/api/task-flow.md`. 선행 작업은 걷었다(Q63) — 길이 없는 것을 본다.

시드 p1 의 완료는 k2 · k8 · k19.
"""

from datetime import datetime

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskLog
from scripts.demo_task_log import apply_demo
from tests.conftest import ADMIN
from tests.test_minutes import minutes, task


async def logs(session: AsyncSession, task_id: str) -> list[tuple[str | None, str, str | None]]:
    rows = await session.execute(
        select(TaskLog.from_status, TaskLog.to_status, TaskLog.changed_by)
        .where(TaskLog.task_id == task_id)
        .order_by(TaskLog.seq)
    )
    return [tuple(row) for row in rows.tuples()]


# --- 선행 작업은 걷었다 (Q63) ------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("PUT", "/api/tasks/k21/dependencies/k20"),
        ("DELETE", "/api/tasks/k21/dependencies/k20"),
        ("POST", "/api/projects/p1/dependencies/suggest"),
    ],
)
async def test_dependency_routes_are_gone(client: httpx.AsyncClient, method: str, url: str) -> None:
    res = await client.request(method, url)
    assert res.status_code == 404


async def test_snapshot_has_no_dependencies(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/projects/p1/snapshot")).json()
    assert "taskDependencies" not in body


async def test_logs_go_with_the_task(client: httpx.AsyncClient, session: AsyncSession) -> None:
    """작업을 지우면 그 작업의 상태 기록이 같이 지워진다(cascade)."""
    await session.execute(delete(Task).where(Task.id == "k21"))
    await session.commit()
    assert await logs(session, "k21") == []


# --- 작업 상태 기록 ----------------------------------------------------------------------


async def test_create_writes_the_first_line(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    res = await client.post("/api/projects/p1/tasks", json={"title": "새 작업", "status": "doing"})
    assert res.status_code == 201
    out = res.json()
    assert await logs(session, out["id"]) == [(None, "doing", ADMIN)]
    assert out["statusChangedAt"] == out["createdAt"]
    assert out["statusSinceBackfill"] is False


async def test_patch_writes_a_line_only_when_status_changes(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    before = await logs(session, "k21")
    # 상태를 안 보낸 수정 · 같은 상태로의 수정은 남기지 않는다
    assert (await client.patch("/api/tasks/k21", json={"title": "개발자 계정 배포 2"})).is_success
    assert (await client.patch("/api/tasks/k21", json={"status": "todo"})).is_success
    assert await logs(session, "k21") == before

    res = await client.patch("/api/tasks/k21", json={"status": "doing"})
    out = res.json()
    assert await logs(session, "k21") == [*before, ("todo", "doing", ADMIN)]
    assert out["statusChangedAt"] > "2026-10-19" and out["statusSinceBackfill"] is False
    assert out["statusChangedAt"].endswith("Z")
    # 상태 말고 다른 것을 고쳐도 시각은 그대로다
    again = (await client.patch("/api/tasks/k21", json={"priority": "high"})).json()
    assert again["statusChangedAt"] == out["statusChangedAt"]


async def test_batch_writes_a_line_per_task(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    batch = {"tasks": [{"tempId": "a", "title": "가"}, {"tempId": "b", "title": "나"}]}
    res = await client.post("/api/projects/p1/tasks/batch", json=batch)
    assert res.status_code == 201
    for row in res.json()["tasks"]:
        assert await logs(session, row["id"]) == [(None, "todo", ADMIN)]
        assert row["statusChangedAt"] == row["createdAt"]


async def test_minutes_apply_writes_a_line(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    res = await client.post("/api/minutes/m1/apply", json=minutes(tasks=[task("t1", "회의 할 일")]))
    assert res.status_code == 201, res.text
    (row,) = res.json()["tasks"]
    assert await logs(session, row["id"]) == [(None, "todo", ADMIN)]
    assert row["statusSinceBackfill"] is False


async def test_status_changed_at_follows_the_seed(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/projects/p1/snapshot")).json()
    by_id = {row["id"]: row for row in body["tasks"]}
    # 시연용 — 오래 둔 둘
    assert by_id["k20"]["statusChangedAt"] == "2026-10-08T00:00:00Z"
    assert by_id["k22"]["statusChangedAt"] == "2026-10-13T00:00:00Z"
    # 그 밖은 start, 없으면 등록 시각
    assert by_id["k2"]["statusChangedAt"] == "2026-09-07T00:00:00Z"
    assert by_id["k18"]["statusChangedAt"] == by_id["k18"]["createdAt"]
    assert {row["statusSinceBackfill"] for row in body["tasks"]} == {False}


async def test_last_line_by_seq_and_backfill_flag(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """마지막 줄은 seq 로 고른다 — changed_at 이 더 이르더라도."""
    await session.execute(delete(TaskLog).where(TaskLog.task_id == "k1"))
    session.add(
        TaskLog(
            project_id="p1",
            task_id="k1",
            from_status=None,
            to_status="doing",
            changed_at=datetime.fromisoformat("2026-09-04T00:20:00+00:00"),
            backfilled=True,
        )
    )
    await session.commit()
    k1 = next(
        row
        for row in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
        if row["id"] == "k1"
    )
    assert k1["statusChangedAt"] == "2026-09-04T00:20:00Z"
    assert k1["statusSinceBackfill"] is True


def test_migration_backfills_one_line_per_task() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0015_task_flow")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            for number, status in enumerate(("doing", "done"), start=1):
                conn.execute(
                    text(
                        "insert into task (id, project_id, key, title, status, priority,"
                        " created_at, seq) values (:id, 'p', :key, '일', :status, 'normal',"
                        " :at, :seq)"
                    ),
                    {
                        "id": f"t{number}",
                        "key": f"P-{number}",
                        "status": status,
                        "at": f"2026-09-0{number} 00:00:00",
                        "seq": number,
                    },
                )
            revisions[head].module.upgrade()
            rows = conn.execute(
                text(
                    "select task_id, from_status, to_status, changed_by, changed_at, backfilled"
                    " from task_log order by task_id"
                )
            ).all()
            assert [tuple(row[:4]) for row in rows] == [
                ("t1", None, "doing", None),
                ("t2", None, "done", None),
            ]
            assert [str(row[4])[:10] for row in rows] == ["2026-09-01", "2026-09-02"]
            assert all(row[5] for row in rows)

            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "task_log" not in tables and "task_dependency" not in tables


def test_migration_drops_dependencies() -> None:
    """0023 — 선행 줄은 버리고 작업은 그대로 둔다. 되돌리면 빈 표가 돌아온다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0023_drop_task_dependency")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            conn.execute(
                text("insert into member (id, name, created_at) values ('u', '유', :at)"),
                {"at": "2026-09-01 00:00:00"},
            )
            for number, task_id in enumerate("abc", start=1):
                conn.execute(
                    text(
                        "insert into task (id, project_id, key, title, status, priority,"
                        " created_at, seq) values (:id, 'p', :key, '일', 'todo', 'normal',"
                        " '2026-09-01 00:00:00', :seq)"
                    ),
                    {"id": task_id, "key": f"P-{number}", "seq": number},
                )
            for task_id, depends_on_id in (("b", "a"), ("c", "b")):
                conn.execute(
                    text(
                        "insert into task_dependency (task_id, depends_on_id, project_id,"
                        " created_by, created_at) values (:task, :dep, 'p', 'u', :at)"
                    ),
                    {"task": task_id, "dep": depends_on_id, "at": "2026-09-02 00:00:00"},
                )
            revisions[head].module.upgrade()

            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "task_dependency" not in tables
            assert "ix_task_dependency_project_id" not in tables
            ids = conn.execute(text("select id from task order by id")).scalars().all()
            assert ids == ["a", "b", "c"]

            revisions[head].module.downgrade()
            count = conn.execute(text("select count(*) from task_dependency")).scalar()
            assert count == 0
            indexes = {
                row[0]
                for row in conn.execute(
                    text("select name from sqlite_master where tbl_name = 'task_dependency'")
                ).all()
            }
            assert {"ix_task_dependency_depends_on_id", "ix_task_dependency_project_id"} <= indexes


async def test_demo_script_adds_only_what_is_missing(session: AsyncSession) -> None:
    """개발 DB 처럼 backfill 만 있는 상태에서 시연 줄을 더한다. 두 번 돌려도 같다."""
    from scripts.seed import seed

    await seed(session)
    await session.execute(delete(TaskLog))
    for row in (await session.scalars(select(Task).order_by(Task.seq))).all():
        session.add(
            TaskLog(
                project_id=row.project_id,
                task_id=row.id,
                to_status=row.status,
                changed_at=row.created_at,
                backfilled=True,
            )
        )
    await session.commit()

    notes = await apply_demo(session)
    assert sum(note.endswith("넣음") for note in notes) == 2
    assert [row[:2] for row in await logs(session, "k20")] == [(None, "doing"), ("todo", "doing")]

    again = await apply_demo(session)
    assert not any(note.endswith("넣음") for note in again)
    count = await session.scalar(select(func.count()).select_from(TaskLog))
    assert count == len((await session.scalars(select(Task.id))).all()) + 2


async def test_demo_script_skips_a_task_that_moved_on(session: AsyncSession) -> None:
    from scripts.seed import seed

    await seed(session)
    await session.execute(delete(TaskLog).where(TaskLog.task_id.in_(["k20", "k22"])))
    k22 = await session.get(Task, "k22")
    assert k22 is not None
    k22.status = "doing"
    await session.commit()
    notes = await apply_demo(session)
    assert any("k22" in note and "지금 상태가 doing" in note for note in notes)
    assert await logs(session, "k22") == []

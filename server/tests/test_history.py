"""작업 · 테스트 변경 이력 — `docs/api/history.md` · Q59.

요청 하나 = 한 줄, 값이 바뀐 칸만 계약 표의 순서로, 남길 칸이 없으면 줄이 없다.
시드에는 작업 · 테스트마다 '등록' 한 줄과 시연 둘(k20 · HW-T7)이 있다.
"""

import json
from datetime import date, datetime
from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import test as test_route
from app.models import Member, Task, TaskHistory, TestHistory
from tests.conftest import ADMIN, AsMember
from tests.test_minutes import minutes, task

CREATED = [{"field": "created", "from": None, "to": None, "subject": ""}]


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(test_route, "today_kst", lambda: date(2026, 10, 15))


async def history(c: httpx.AsyncClient, path: str) -> list[dict[str, Any]]:
    res = await c.get(f"/api/{path}/history")
    assert res.status_code == 200, res.json()
    rows: list[dict[str, Any]] = res.json()
    return rows


def ch(field: str, before: Any, after: Any, subject: str = "") -> dict[str, Any]:
    return {"field": field, "from": before, "to": after, "subject": subject}


async def last_changes(c: httpx.AsyncClient, path: str) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = (await history(c, path))[-1]["changes"]
    return changes


# --- 시드 ---------------------------------------------------------------------------------


async def test_seed_has_a_created_line_per_task(client: httpx.AsyncClient) -> None:
    (k4,) = await history(client, "tasks/k4")
    assert k4 == {
        "id": "th-k4-1",
        "changedAt": "2026-09-04T00:20:00Z",
        "changedBy": "u3",
        "backfilled": False,
        "changes": CREATED,
    }
    # 담당이 없는 작업은 바꾼 사람도 비어 있다
    (k1,) = await history(client, "tasks/k1")
    assert k1["changedBy"] is None and k1["backfilled"] is False


async def test_seed_demo_lines(client: httpx.AsyncClient) -> None:
    created, moved = await history(client, "tasks/k20")
    assert created["changes"] == CREATED
    assert moved["changedAt"] == "2026-10-08T00:00:00Z" and moved["changedBy"] == "u3"
    assert moved["changes"] == [ch("status", "todo", "doing")]

    created, failed = await history(client, "tests/tc7")
    assert created["changedAt"] == "2026-09-30T01:00:00Z" and created["changedBy"] == "u1"
    assert failed["changedAt"] == "2026-10-05T03:00:00Z" and failed["changedBy"] == "u1"
    assert failed["changes"] == [
        ch("status", "testing", "fail"),
        ch("resultNote", None, "관리 화면 주소를 직접 치면 열린다."),
    ]
    # 시연 줄이 지금 값과 맞는다
    tc7 = (await client.get("/api/tests/tc7")).json()
    assert tc7["status"] == "fail"
    assert tc7["resultNote"] == failed["changes"][1]["to"]


# --- 작업 ---------------------------------------------------------------------------------


async def test_create_is_one_created_line_even_with_threads(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tasks", json={"title": "새 작업", "threadIds": ["t1", "t2"]}
    )
    out = res.json()
    (row,) = await history(client, f"tasks/{out['id']}")
    assert row["changes"] == CREATED
    assert row["changedBy"] == ADMIN and row["changedAt"] == out["createdAt"]


async def test_batch_and_minutes_apply_write_created(client: httpx.AsyncClient) -> None:
    batch = {"tasks": [{"tempId": "a", "title": "가"}, {"tempId": "b", "title": "나"}]}
    res = await client.post("/api/projects/p1/tasks/batch", json=batch)
    applied = await client.post("/api/minutes/m1/apply", json=minutes(tasks=[task("t1", "할 일")]))
    assert res.status_code == 201 and applied.status_code == 201, applied.text
    for row in [*res.json()["tasks"], *applied.json()["tasks"]]:
        assert [line["changes"] for line in await history(client, f"tasks/{row['id']}")] == [
            CREATED
        ]


async def test_patch_writes_changed_fields_in_table_order(client: httpx.AsyncClient) -> None:
    # 칸을 표와 다른 순서로 보내도 줄 안의 순서는 표를 따른다
    res = await client.patch(
        "/api/tasks/k21",
        json={
            "body": [{"kind": "check", "text": "계정 넷", "done": False, "level": 0}],
            "due": "2026-09-20",
            "start": None,
            "parentId": "k1",
            "partId": None,
            "ownerId": "u3",
            "priority": "high",
            "status": "doing",
            "title": "개발자 계정 배포 2",
        },
    )
    assert res.status_code == 200, res.json()
    rows = await history(client, "tasks/k21")
    assert len(rows) == 2
    assert rows[-1]["changedBy"] == ADMIN
    assert rows[-1]["changes"] == [
        ch("title", "개발자 계정 배포", "개발자 계정 배포 2"),
        ch("status", "todo", "doing"),
        ch("priority", "normal", "high"),
        ch("ownerId", "u1", "u3"),
        ch("partId", "pt1", None),
        ch("parentId", "k4", "k1"),
        ch("start", "2026-09-12", None),
        ch("due", "2026-09-15", "2026-09-20"),
        ch("body", None, None),
    ]


async def test_patch_without_a_change_writes_nothing(client: httpx.AsyncClient) -> None:
    before = await history(client, "tasks/k4")
    k4 = next(
        row
        for row in (await client.get("/api/projects/p1/snapshot")).json()["tasks"]
        if row["id"] == "k4"
    )
    same_body = [{k: v for k, v in line.items() if k != "id"} for line in k4["body"]]
    for body in (
        {},
        {"title": k4["title"], "status": k4["status"], "ownerId": "u3", "start": k4["start"]},
        # 줄 id 를 빼고 같은 줄을 보내도 본문은 그대로다
        {"body": same_body},
    ):
        assert (await client.patch("/api/tasks/k4", json=body)).status_code == 200
    assert await history(client, "tasks/k4") == before


@pytest.mark.parametrize(
    "tweak",
    [
        lambda line: line | {"text": "고친 글"},
        lambda line: line | {"kind": "bullet"},
        lambda line: line | {"done": not line["done"]},
        lambda line: line | {"level": 1},
    ],
)
async def test_body_change_is_one_flag(client: httpx.AsyncClient, tweak: Any) -> None:
    snapshot = (await client.get("/api/projects/p1/snapshot")).json()
    body = next(row for row in snapshot["tasks"] if row["id"] == "k4")["body"]
    body[2] = tweak(body[2])
    await client.patch("/api/tasks/k4", json={"body": body})
    assert await last_changes(client, "tasks/k4") == [ch("body", None, None)]


async def test_body_reorder_is_a_change(client: httpx.AsyncClient) -> None:
    snapshot = (await client.get("/api/projects/p1/snapshot")).json()
    body = next(row for row in snapshot["tasks"] if row["id"] == "k4")["body"]
    await client.patch("/api/tasks/k4", json={"body": [body[1], body[0], *body[2:]]})
    assert await last_changes(client, "tasks/k4") == [ch("body", None, None)]


async def test_line_done_only_when_it_changes(client: httpx.AsyncClient) -> None:
    before = len(await history(client, "tasks/k4"))
    await client.patch("/api/tasks/k4/lines/l3", json={"done": True})
    await client.patch("/api/tasks/k4/lines/l3", json={"done": True})
    await client.patch("/api/tasks/k4/lines/l1", json={"done": False})
    rows = await history(client, "tasks/k4")
    assert len(rows) == before + 2
    assert rows[-2]["changes"] == [ch("lineDone", False, True, "mysql 설치와 계정 발급")]
    assert rows[-1]["changes"] == [ch("lineDone", True, False, "서버 신청서 제출")]


async def test_thread_link_only_when_new_or_existing(client: httpx.AsyncClient) -> None:
    before = len(await history(client, "tasks/k1"))
    for _ in range(2):
        assert (await client.put("/api/tasks/k1/threads/t1")).status_code == 200
    for _ in range(2):
        assert (await client.delete("/api/tasks/k1/threads/t1")).status_code == 204
    rows = await history(client, "tasks/k1")
    assert [row["changes"] for row in rows[before:]] == [
        [ch("thread", None, "t1")],
        [ch("thread", "t1", None)],
    ]
    # 안건 쪽에는 남지 않는다 — 작업 이력이다
    assert all(row["changedBy"] == ADMIN for row in rows[before:])


async def test_dependency_leaves_no_line(client: httpx.AsyncClient) -> None:
    """선행 작업은 걷었다(Q63) — 길이 없고 `dependsOn` 줄도 더 남지 않는다."""
    before = await history(client, "tasks/k21")
    assert (await client.put("/api/tasks/k21/dependencies/k19")).status_code == 404
    assert (await client.delete("/api/tasks/k21/dependencies/k19")).status_code == 404
    assert await history(client, "tasks/k21") == before


async def test_changed_by_is_the_requester(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    await u2.patch("/api/tasks/k1", json={"priority": "high"})
    await u2.patch("/api/tasks/k4/lines/l3", json={"done": True})
    await u2.put("/api/tasks/k1/threads/t1")
    assert (await history(client, "tasks/k1"))[-1]["changedBy"] == "u2"
    assert (await history(client, "tasks/k1"))[-2]["changedBy"] == "u2"
    assert (await history(client, "tasks/k4"))[-1]["changedBy"] == "u2"


async def test_failed_write_leaves_no_line(client: httpx.AsyncClient) -> None:
    before = await history(client, "tasks/k4")
    res = await client.patch("/api/tasks/k4", json={"title": "x", "parentId": "k19"})
    assert res.status_code == 400
    assert await history(client, "tasks/k4") == before


# --- 테스트 -------------------------------------------------------------------------------


async def test_test_create_and_patch(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/tests",
        json={
            "title": "새 테스트",
            "content": "연다",
            "refs": [{"kind": "task", "id": "k4"}],
        },
    )
    out = res.json()
    path = f"tests/{out['id']}"
    (row,) = await history(client, path)
    assert row["changes"] == CREATED and row["changedBy"] == ADMIN
    assert row["changedAt"] == out["createdAt"]

    await client.patch(
        f"/api/{path}",
        json={
            "due": "2026-10-20",
            "ownerId": "u2",
            "testData": "dev01",
            "content": "연다\n닫는다",
            "title": "고친 테스트",
            "parentId": "tc1",
            "partId": "pt1",
            "start": "2026-10-16",
            # 걷은 칸(Q60) — 보내도 버리고 이력에 남지 않는다
            "purpose": "목적",
            "steps": [{"action": "연다"}],
        },
    )
    assert await last_changes(client, path) == [
        ch("title", "새 테스트", "고친 테스트"),
        ch("content", "연다", "연다\n닫는다"),
        ch("testData", "", "dev01"),
        ch("parentId", None, "tc1"),
        ch("ownerId", None, "u2"),
        ch("partId", None, "pt1"),
        ch("start", None, "2026-10-16"),
        ch("due", None, "2026-10-20"),
    ]


async def test_test_patch_without_a_change_writes_nothing(client: httpx.AsyncClient) -> None:
    before = await history(client, "tests/tc2")
    tc2 = (await client.get("/api/tests/tc2")).json()
    for body in (
        {},
        {"title": tc2["title"], "content": tc2["content"], "due": tc2["due"], "ownerId": "u2"},
    ):
        assert (await client.patch("/api/tests/tc2", json=body)).status_code == 200
    assert await history(client, "tests/tc2") == before


async def test_content_keeps_the_whole_text(client: httpx.AsyncClient) -> None:
    """테스트 내용은 값을 남긴다 — 본문(`body`)처럼 '바뀜' 만 남기지 않는다 (history.md)."""
    before = (await client.get("/api/tests/tc7")).json()["content"]
    after = before.replace("권한이 없다는 화면이 뜬다", "403 화면이 뜬다")
    await client.patch("/api/tests/tc7", json={"content": after})
    assert await last_changes(client, "tests/tc7") == [ch("content", before, after)]


async def test_same_status_is_still_recorded(client: httpx.AsyncClient) -> None:
    before = len(await history(client, "tests/tc8"))
    for _ in range(2):
        assert (await client.post("/api/tests/tc8/status", json={"status": "testing"})).is_success
    rows = await history(client, "tests/tc8")
    assert [row["changes"] for row in rows[before:]] == [[ch("status", "testing", "testing")]] * 2


async def test_status_brings_note(client: httpx.AsyncClient) -> None:
    # 실패한 단계는 걷었다(Q60) — 보내도 이력에 남지 않는다
    await client.post(
        "/api/tests/tc8/status", json={"status": "fail", "failedStep": 1, "note": "  빈 파일  "}
    )
    assert await last_changes(client, "tests/tc8") == [
        ch("status", "testing", "fail"),
        ch("resultNote", None, "빈 파일"),
    ]
    await client.post("/api/tests/tc8/status", json={"status": "blocked", "note": "빈 파일"})
    assert await last_changes(client, "tests/tc8") == [ch("status", "fail", "blocked")]
    await client.post("/api/tests/tc8/status", json={"status": "testing", "note": "버린다"})
    assert await last_changes(client, "tests/tc8") == [
        ch("status", "blocked", "testing"),
        ch("resultNote", "빈 파일", None),
    ]


async def test_rejected_status_leaves_no_line(client: httpx.AsyncClient) -> None:
    before = await history(client, "tests/tc8")
    res = await client.post("/api/tests/tc8/status", json={"status": "fail", "note": ""})
    assert res.status_code == 422
    assert await history(client, "tests/tc8") == before


@pytest.mark.parametrize(
    ("kind", "target", "field"), [("task", "k1", "taskRef"), ("thread", "t5", "threadRef")]
)
async def test_refs_only_when_new_or_existing(
    client: httpx.AsyncClient, kind: str, target: str, field: str
) -> None:
    before = len(await history(client, "tests/tc8"))
    for _ in range(2):
        assert (await client.put(f"/api/tests/tc8/refs/{kind}/{target}")).status_code == 200
    for _ in range(2):
        assert (await client.delete(f"/api/tests/tc8/refs/{kind}/{target}")).status_code == 204
    rows = await history(client, "tests/tc8")
    assert [row["changes"] for row in rows[before:]] == [
        [ch(field, None, target)],
        [ch(field, target, None)],
    ]


async def test_basis_confirm_is_recorded(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u4 = await as_member("u4")
    assert (await u4.post("/api/tests/tc4/basis")).status_code == 200
    last = (await history(client, "tests/tc4"))[-1]
    assert last["changes"] == [ch("basis", None, None)] and last["changedBy"] == "u4"


async def test_test_writes_record_the_requester(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u3 = await as_member("u3")
    await u3.patch("/api/tests/tc8", json={"title": "목록 내려받기"})
    await u3.post("/api/tests/tc8/status", json={"status": "pass"})
    await u3.put("/api/tests/tc8/refs/task/k1")
    await u3.delete("/api/tests/tc8/refs/task/k1")
    rows = await history(client, "tests/tc8")
    assert [row["changedBy"] for row in rows[-4:]] == ["u3"] * 4


# --- 읽기 · 경계 · 지우기 -------------------------------------------------------------------


async def test_order_is_seq_not_time(client: httpx.AsyncClient, session: AsyncSession) -> None:
    session.add(
        TaskHistory(
            project_id="p1",
            task_id="k4",
            changed_by="u1",
            changed_at=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
            changes=[ch("title", "a", "b")],
        )
    )
    await session.commit()
    rows = await history(client, "tasks/k4")
    assert rows[0]["id"] == "th-k4-1"
    assert rows[-1]["changedAt"] == "2026-01-01T00:00:00Z"


async def test_missing_is_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/tasks/nope/history")
    assert res.status_code == 404 and res.json()["code"] == "TASK_NOT_FOUND"
    res = await client.get("/api/tests/nope/history")
    assert res.status_code == 404 and res.json()["code"] == "TEST_NOT_FOUND"


async def test_ungranted_member_sees_404(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    await session.commit()
    u9 = await as_member("u9")
    assert (await u9.get("/api/tasks/k4/history")).json()["code"] == "TASK_NOT_FOUND"
    assert (await u9.get("/api/tests/tc2/history")).json()["code"] == "TEST_NOT_FOUND"


async def test_anonymous_is_401(anon: httpx.AsyncClient) -> None:
    assert (await anon.get("/api/tasks/k4/history")).status_code == 401
    assert (await anon.get("/api/tests/tc2/history")).status_code == 401


async def test_history_goes_with_the_task_and_test(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    assert (await client.delete("/api/tests/tc8")).status_code == 204
    left = await session.scalar(
        select(func.count()).select_from(TestHistory).where(TestHistory.test_id == "tc8")
    )
    assert left == 0

    await session.execute(delete(Task).where(Task.id == "k8"))
    await session.commit()
    left = await session.scalar(
        select(func.count()).select_from(TaskHistory).where(TaskHistory.task_id == "k8")
    )
    assert left == 0


# --- 마이그레이션 ----------------------------------------------------------------------------


def test_migration_backfills_a_created_line() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0019_history")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            # 등록 순서(seq)가 id 순서와 다르다 — 이력도 seq 순으로 붙어야 한다
            for number, (task_id, day) in enumerate((("t2", "01"), ("t1", "02")), start=1):
                conn.execute(
                    text(
                        "insert into task (id, project_id, key, title, status, priority,"
                        " created_at, seq) values (:id, 'p', :key, '일', 'todo', 'normal',"
                        " :at, :seq)"
                    ),
                    {
                        "id": task_id,
                        "key": f"P-{number}",
                        "at": f"2026-09-{day} 00:00:00",
                        "seq": number,
                    },
                )
            conn.execute(
                text(
                    "insert into test_case (id, project_id, key, seq, title, status_changed_at,"
                    " created_at) values ('c1', 'p', 'P-T1', 1, '테스트',"
                    " '2026-09-03 00:00:00', '2026-09-03 00:00:00')"
                )
            )
            revisions[head].module.upgrade()

            tasks = conn.execute(
                text(
                    "select task_id, changed_by, changed_at, changes, backfilled, seq"
                    " from task_history order by seq"
                )
            ).all()
            assert [row[0] for row in tasks] == ["t2", "t1"]
            assert [str(row[2])[:10] for row in tasks] == ["2026-09-01", "2026-09-02"]
            assert all(row[1] is None and row[4] for row in tasks)
            assert all(json.loads(row[3]) == CREATED for row in tasks)

            (test,) = conn.execute(
                text(
                    "select test_id, changed_by, changed_at, changes, backfilled from test_history"
                )
            ).all()
            assert test[0] == "c1" and test[1] is None and test[4]
            assert str(test[2])[:10] == "2026-09-03"
            assert json.loads(test[3]) == CREATED

            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "task_history" not in tables and "test_history" not in tables

"""작업 · 테스트 · 안건 변경 이력 — `docs/api/history.md` · Q59.

요청 하나 = 한 줄, 값이 바뀐 칸만 계약 표의 순서로, 남길 칸이 없으면 줄이 없다.
시드에는 작업 · 테스트마다 '등록' 한 줄과 시연 둘(k20 · HW-T7)이 있다.
"""

import json
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import test as test_route
from app.models import Member, Task, TaskHistory, TestHistory, ThreadHistory
from app.time import now
from tests.conftest import ADMIN, AsMember
from tests.test_minutes import body as entry_body
from tests.test_minutes import minutes, new_thread, old_entry, task

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
        # 등록 줄의 사람은 등록한 사람이다 — k4 는 u3 담당 · u2 등록
        "changedBy": "u2",
        "backfilled": False,
        "changes": CREATED,
    }
    # 등록한 사람 기록이 없는 작업은 바꾼 사람도 비어 있다 — k2 는 u1 담당
    (k2,) = await history(client, "tasks/k2")
    assert k2["changedBy"] is None and k2["backfilled"] is False


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
        ch("body", None, "☐ 계정 넷"),
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


K4_BODY = "\n".join(
    [
        "☑ 서버 신청서 제출",
        "☑ 우분투 최신 버전 설치",
        "☐ mysql 설치와 계정 발급",
        "☐ 개발자 접속 계정 4개 만들기",
        "  • 방화벽은 정보보안팀에 따로 신청해야 한다 (사내 포털 > 보안)",
        "  • 백업 정책은 기간계와 같은 주기로 맞추기로 했다",
        "☐ CI 러너 붙이기",
    ]
)


def line(text: str, kind: str = "check", done: bool = False, level: int = 0) -> dict[str, Any]:
    return {"kind": kind, "text": text, "done": done, "level": level}


async def k4_body(c: httpx.AsyncClient) -> list[dict[str, Any]]:
    snapshot = (await c.get("/api/projects/p1/snapshot")).json()
    body: list[dict[str, Any]] = next(row for row in snapshot["tasks"] if row["id"] == "k4")["body"]
    return body


@pytest.mark.parametrize(
    ("tweak", "third"),
    [
        (lambda line: line | {"text": "고친 글"}, "☐ 고친 글"),
        (lambda line: line | {"kind": "bullet"}, "• mysql 설치와 계정 발급"),
        (lambda line: line | {"done": not line["done"]}, "☑ mysql 설치와 계정 발급"),
        (lambda line: line | {"level": 1}, "  ☐ mysql 설치와 계정 발급"),
    ],
)
async def test_body_change_keeps_both_texts(
    client: httpx.AsyncClient, tweak: Any, third: str
) -> None:
    body = await k4_body(client)
    body[2] = tweak(body[2])
    await client.patch("/api/tasks/k4", json={"body": body})
    after = K4_BODY.split("\n")
    after[2] = third
    assert await last_changes(client, "tasks/k4") == [ch("body", K4_BODY, "\n".join(after))]


async def test_body_reorder_is_a_change(client: httpx.AsyncClient) -> None:
    body = await k4_body(client)
    await client.patch("/api/tasks/k4", json={"body": [body[1], body[0], *body[2:]]})
    lines = K4_BODY.split("\n")
    after = "\n".join([lines[1], lines[0], *lines[2:]])
    assert await last_changes(client, "tasks/k4") == [ch("body", K4_BODY, after)]


async def test_body_text_marks_and_indent(client: httpx.AsyncClient) -> None:
    task_id = await new_task(client)
    body = [
        line("열기"),
        line("닫기", done=True),
        line("메모", kind="bullet", level=1),
        line("더 깊은 할 일", level=2),
    ]
    await client.patch(f"/api/tasks/{task_id}", json={"body": body})
    assert await last_changes(client, f"tasks/{task_id}") == [
        ch("body", None, "☐ 열기\n☑ 닫기\n  • 메모\n    ☐ 더 깊은 할 일")
    ]
    # 다 지우면 null
    await client.patch(f"/api/tasks/{task_id}", json={"title": "비움", "body": []})
    assert (await last_changes(client, f"tasks/{task_id}"))[-1] == ch(
        "body", "☐ 열기\n☑ 닫기\n  • 메모\n    ☐ 더 깊은 할 일", None
    )


async def test_invisible_body_change_writes_nothing(client: httpx.AsyncClient) -> None:
    """불릿의 체크 값처럼 글에 드러나지 않는 차이는 이력도 없다 — 보이는 것이 같으면 같다."""
    task_id = await new_task(client)
    await client.patch(f"/api/tasks/{task_id}", json={"body": [line("메모", kind="bullet")]})
    before = await history(client, f"tasks/{task_id}")
    await client.patch(
        f"/api/tasks/{task_id}", json={"body": [line("메모", kind="bullet", done=True)]}
    )
    assert await history(client, f"tasks/{task_id}") == before


# --- 본문 합치기 (Q65) ----------------------------------------------------------------------


async def new_task(c: httpx.AsyncClient, owner_id: str | None = None) -> str:
    res = await c.post("/api/projects/p1/tasks", json={"title": "본문 쓰기", "ownerId": owner_id})
    assert res.status_code == 201, res.json()
    task_id: str = res.json()["id"]
    return task_id


async def type_body(c: httpx.AsyncClient, task_id: str, *texts: str) -> None:
    res = await c.patch(f"/api/tasks/{task_id}", json={"body": [line(text) for text in texts]})
    assert res.status_code == 200, res.json()


async def age_last_line(session: AsyncSession, task_id: str, minutes: int) -> None:
    last = await session.scalar(
        select(func.max(TaskHistory.seq)).where(TaskHistory.task_id == task_id)
    )
    await session.execute(
        update(TaskHistory)
        .where(TaskHistory.seq == last)
        .values(changed_at=now() - timedelta(minutes=minutes))
    )
    await session.commit()


async def test_body_edits_merge_into_one_line(client: httpx.AsyncClient) -> None:
    task_id = await new_task(client)
    await type_body(client, task_id, "작업1")
    first = (await history(client, f"tasks/{task_id}"))[-1]
    await type_body(client, task_id, "작업1", "작업2")
    rows = await history(client, f"tasks/{task_id}")
    assert len(rows) == 2
    assert rows[-1]["id"] == first["id"] and rows[-1]["changedBy"] == ADMIN
    assert rows[-1]["changes"] == [ch("body", None, "☐ 작업1\n☐ 작업2")]
    assert rows[-1]["changedAt"] >= first["changedAt"]


async def test_other_person_starts_a_new_line(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    # u2 가 담당이라 고칠 수 있다
    task_id = await new_task(client, owner_id="u2")
    await type_body(client, task_id, "작업1")
    await type_body(await as_member("u2"), task_id, "작업1", "작업2")
    rows = await history(client, f"tasks/{task_id}")
    assert [(row["changedBy"], row["changes"]) for row in rows[1:]] == [
        (ADMIN, [ch("body", None, "☐ 작업1")]),
        ("u2", [ch("body", "☐ 작업1", "☐ 작업1\n☐ 작업2")]),
    ]


async def test_other_line_between_starts_a_new_line(client: httpx.AsyncClient) -> None:
    task_id = await new_task(client)
    await type_body(client, task_id, "작업1")
    await client.patch(f"/api/tasks/{task_id}", json={"status": "doing"})
    await type_body(client, task_id, "작업1", "작업2")
    rows = await history(client, f"tasks/{task_id}")
    assert [row["changes"] for row in rows[1:]] == [
        [ch("body", None, "☐ 작업1")],
        [ch("status", "todo", "doing")],
        [ch("body", "☐ 작업1", "☐ 작업1\n☐ 작업2")],
    ]


async def test_after_ten_minutes_a_new_line(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    task_id = await new_task(client)
    await type_body(client, task_id, "작업1")
    await age_last_line(session, task_id, 9)
    await type_body(client, task_id, "작업1", "작업2")
    await age_last_line(session, task_id, 11)
    await type_body(client, task_id, "작업1", "작업2", "작업3")
    rows = await history(client, f"tasks/{task_id}")
    assert [row["changes"] for row in rows[1:]] == [
        [ch("body", None, "☐ 작업1\n☐ 작업2")],
        [ch("body", "☐ 작업1\n☐ 작업2", "☐ 작업1\n☐ 작업2\n☐ 작업3")],
    ]


async def test_reverting_removes_the_line(client: httpx.AsyncClient) -> None:
    task_id = await new_task(client)
    before = await history(client, f"tasks/{task_id}")
    await type_body(client, task_id, "작업1")
    await type_body(client, task_id)
    assert await history(client, f"tasks/{task_id}") == before

    await type_body(client, task_id, "작업1")
    await client.patch(f"/api/tasks/{task_id}", json={"status": "doing"})
    kept = await history(client, f"tasks/{task_id}")
    await type_body(client, task_id, "작업1", "작업2")
    await type_body(client, task_id, "작업1")
    assert await history(client, f"tasks/{task_id}") == kept


async def test_old_flag_line_is_not_merged(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """2026-11-01 전의 '바뀌었다' 줄(null · null)에는 이어 붙이지 않는다."""
    task_id = await new_task(client)
    session.add(
        TaskHistory(
            project_id="p1",
            task_id=task_id,
            changed_by=ADMIN,
            changed_at=now(),
            changes=[ch("body", None, None)],
        )
    )
    await session.commit()
    await type_body(client, task_id, "작업1")
    rows = await history(client, f"tasks/{task_id}")
    assert [row["changes"] for row in rows[1:]] == [
        [ch("body", None, None)],
        [ch("body", None, "☐ 작업1")],
    ]


async def test_body_with_other_fields_is_not_merged(client: httpx.AsyncClient) -> None:
    task_id = await new_task(client)
    await type_body(client, task_id, "작업1")
    await client.patch(
        f"/api/tasks/{task_id}", json={"title": "새 제목", "body": [line("작업1"), line("작업2")]}
    )
    await type_body(client, task_id, "작업1", "작업2", "작업3")
    rows = await history(client, f"tasks/{task_id}")
    assert [row["changes"] for row in rows[1:]] == [
        [ch("body", None, "☐ 작업1")],
        [ch("title", "본문 쓰기", "새 제목"), ch("body", "☐ 작업1", "☐ 작업1\n☐ 작업2")],
        [ch("body", "☐ 작업1\n☐ 작업2", "☐ 작업1\n☐ 작업2\n☐ 작업3")],
    ]


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
    # u2 는 k3 의 담당자 · k4 의 생성자다 — 고칠 수 있는 사람이어야 줄이 남는다
    u2 = await as_member("u2")
    assert (await u2.patch("/api/tasks/k3", json={"priority": "high"})).status_code == 200
    assert (await u2.patch("/api/tasks/k4/lines/l3", json={"done": True})).status_code == 200
    assert (await u2.put("/api/tasks/k3/threads/t1")).status_code == 200
    assert (await history(client, "tasks/k3"))[-1]["changedBy"] == "u2"
    assert (await history(client, "tasks/k3"))[-2]["changedBy"] == "u2"
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


# --- 안건 (docs/api/history.md '칸 — 안건') ---------------------------------------------------


async def test_seed_has_a_created_line_per_thread(client: httpx.AsyncClient) -> None:
    (t1,) = await history(client, "threads/t1")
    assert t1 == {
        "id": "hh-t1-1",
        "changedAt": "2026-09-08T00:30:00Z",
        # 시드의 등록한 사람은 담당자다 — t1 은 u3
        "changedBy": "u3",
        "backfilled": False,
        "changes": CREATED,
    }
    # 담당이 없던 t4 는 등록한 사람도 비어 있다
    (t4,) = await history(client, "threads/t4")
    assert t4["id"] == "hh-t4-1" and t4["changedBy"] is None


async def test_thread_create_and_minutes_apply_write_created(client: httpx.AsyncClient) -> None:
    created = (await client.post("/api/projects/p1/threads", json={"title": "새 안건"})).json()
    (row,) = await history(client, f"threads/{created['id']}")
    assert row["changes"] == CREATED and row["changedBy"] == ADMIN

    payload = minutes(
        threads=[new_thread("n1", "회의 안건", entry=entry_body("defer", "미룸"))],
        entries=[old_entry("o1", "t4", "decide", "정함")],
    )
    res = await client.post("/api/minutes/m1/apply", json=payload)
    assert res.status_code == 201, res.json()
    (made,) = res.json()["threads"]
    assert made["creatorId"] == ADMIN
    # 회의록으로 남긴 줄도 반영한 사람이 남긴 것이다
    assert [entry["creatorId"] for entry in res.json()["entries"]] == [ADMIN, ADMIN]
    (row,) = await history(client, f"threads/{made['id']}")
    assert row["changes"] == CREATED and row["changedBy"] == ADMIN


async def test_thread_patch_writes_changed_fields_in_table_order(
    client: httpx.AsyncClient,
) -> None:
    res = await client.patch(
        "/api/threads/t1",
        json={
            "ccIds": ["u1", "u2"],
            "dueDate": None,
            "partId": None,
            "ownerId": "u2",
            "options": ["우분투", "록키"],
            "description": "배경을 고침",
            "title": "서버 OS 결정 (고침)",
        },
    )
    assert res.status_code == 200, res.json()
    assert await last_changes(client, "threads/t1") == [
        ch("title", "서버 OS 결정", "서버 OS 결정 (고침)"),
        ch(
            "description",
            "개발 환경 설정 작업에서 서버 OS가 정해지지 않아 서버 구성을 시작하지 못하고 있다.",
            "배경을 고침",
        ),
        ch("options", "우분투\n록키\nCentOS", "우분투\n록키"),
        ch("ownerId", "u3", "u2"),
        ch("partId", "pt1", None),
        ch("dueDate", "2026-09-12", None),
        ch("ccIds", ["u1"], ["u1", "u2"]),
    ]


async def test_thread_patch_options_empty_is_null(client: httpx.AsyncClient) -> None:
    assert (await client.patch("/api/threads/t1", json={"options": []})).status_code == 200
    assert await last_changes(client, "threads/t1") == [ch("options", "우분투\n록키\nCentOS", None)]


async def test_thread_patch_without_a_change_writes_nothing(client: httpx.AsyncClient) -> None:
    for body in (
        {},
        {"title": "서버 OS 결정"},
        {"ccIds": ["u1"]},
        {"options": ["우분투", "록키", "CentOS"]},
    ):
        assert (await client.patch("/api/threads/t1", json=body)).status_code == 200
    assert len(await history(client, "threads/t1")) == 1


async def test_adding_an_entry_writes_no_thread_history(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/threads/t4/entries", json={"kind": "defer", "text": "미룸"})
    assert res.status_code == 201
    assert len(await history(client, "threads/t4")) == 1


async def test_entry_patch_and_delete_lines(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u3 = await as_member("u3")
    res = await u3.patch(
        "/api/threads/t1/entries/e1", json={"text": "우분투 24.04 로 한다", "note": ""}
    )
    assert res.status_code == 200
    rows = await history(client, "threads/t1")
    assert rows[-1]["changedBy"] == "u3"
    assert rows[-1]["changes"] == [
        ch("entryText", "우분투 최신 버전으로 한다", "우분투 24.04 로 한다", "decide"),
        ch(
            "entryNote",
            "PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.",
            None,
            "decide",
        ),
    ]
    # 같은 글로 다시 고치면 줄이 없다
    await u3.patch("/api/threads/t1/entries/e1", json={"text": "우분투 24.04 로 한다"})
    assert len(await history(client, "threads/t1")) == len(rows)

    assert (await u3.delete("/api/threads/t1/entries/e1")).status_code == 200
    assert await last_changes(client, "threads/t1") == [
        ch("entryDeleted", "우분투 24.04 로 한다", None, "decide")
    ]


async def test_thread_delete_line_stays_in_the_db(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    assert (await client.delete("/api/threads/t4")).status_code == 204
    # 지운 안건의 이력은 404 다 — DB 에는 끝에 '삭제' 줄이 남는다
    res = await client.get("/api/threads/t4/history")
    assert res.status_code == 404 and res.json()["code"] == "THREAD_NOT_FOUND"
    rows = (
        await session.scalars(
            select(ThreadHistory).where(ThreadHistory.thread_id == "t4").order_by(ThreadHistory.seq)
        )
    ).all()
    assert [row.changes for row in rows] == [CREATED, [ch("deleted", None, None)]]
    assert rows[-1].changed_by == ADMIN


async def test_thread_history_missing_and_ungranted(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    res = await client.get("/api/threads/nope/history")
    assert res.status_code == 404 and res.json()["code"] == "THREAD_NOT_FOUND"
    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    await session.commit()
    u9 = await as_member("u9")
    assert (await u9.get("/api/threads/t1/history")).json()["code"] == "THREAD_NOT_FOUND"


def test_migration_0029_backfills_a_created_line_per_thread() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0029_thread_perm")

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # sqlite 의 batch 는 표를 새로 만들고 옛 표를 지운다 — FK 를 켜 두면 그때 줄이 cascade 로
        # 같이 지워진다. Postgres 는 ALTER 라 그런 일이 없다. 트랜잭션 밖에서 꺼야 먹는다
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            for number, (thread_id, day) in enumerate((("h2", "01"), ("h1", "02")), start=1):
                conn.execute(
                    text(
                        "insert into thread (id, project_id, title, description, state,"
                        " created_at, seq) values (:id, 'p', '안건', '', 'queued', :at, :seq)"
                    ),
                    {"id": thread_id, "at": f"2026-09-{day} 00:00:00", "seq": number},
                )
            conn.execute(
                text(
                    "insert into entry (id, thread_id, kind, text, note, created_at, seq)"
                    " values ('e', 'h1', 'raise', '줄', '', '2026-09-02 00:00:00', 1)"
                )
            )
            revisions[head].module.upgrade()

            rows = conn.execute(
                text(
                    "select thread_id, changed_by, changed_at, changes, backfilled"
                    " from thread_history order by seq"
                )
            ).all()
            assert [row[0] for row in rows] == ["h2", "h1"]
            assert [str(row[2])[:10] for row in rows] == ["2026-09-01", "2026-09-02"]
            assert all(row[1] is None and row[4] for row in rows)
            assert all(json.loads(row[3]) == CREATED for row in rows)
            # 있던 안건 · 줄은 등록한 사람을 모르고, 살아 있다
            assert conn.execute(text("select creator_id, is_deleted from thread")).all() == [
                (None, 0),
                (None, 0),
            ]
            assert conn.execute(text("select creator_id, is_deleted from entry")).all() == [
                (None, 0)
            ]

            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "thread_history" not in tables
            columns = {row[1] for row in conn.execute(text("pragma table_info(thread)")).all()}
            assert not columns & {"creator_id", "is_deleted", "deleted_at", "deleted_by"}

"""선행 작업 · 작업 상태 기록 · AI 선행 관계 제안 — `docs/api/task-flow.md`.

**Claude 를 부르지 않는다.** 챗봇 검사의 가짜 클라이언트를 그대로 끼운다.
시드 p1 의 선행: k20 ← k19, k21 ← k20, k22 ← k20. 완료는 k2 · k8 · k19.
"""

import json
from datetime import datetime
from typing import Any

import httpx
import httpx2
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from anthropic import APIConnectionError, RateLimitError
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.config import settings
from app.main import app
from app.models import ProjectMember, Task, TaskDependency, TaskLog
from app.services import chat as chat_service
from app.services import dependency_suggest
from app.services.ratelimit import RateLimiter
from scripts.demo_task_log import apply_demo
from tests.conftest import ADMIN, AsMember
from tests.test_chat import FakeClient, Turn
from tests.test_minutes import minutes, task

SUGGEST = "/api/projects/p1/dependencies/suggest"


def dep(task_id: str, depends_on_id: str) -> str:
    return f"/api/tasks/{task_id}/dependencies/{depends_on_id}"


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


def use(client: FakeClient | None) -> None:
    app.dependency_overrides[chat_api.get_chat_client] = lambda: client


async def snapshot_deps(client: httpx.AsyncClient, project: str = "p1") -> list[tuple[str, str]]:
    body = (await client.get(f"/api/projects/{project}/snapshot")).json()
    return [(row["taskId"], row["dependsOnId"]) for row in body["taskDependencies"]]


async def logs(session: AsyncSession, task_id: str) -> list[tuple[str | None, str, str | None]]:
    rows = await session.execute(
        select(TaskLog.from_status, TaskLog.to_status, TaskLog.changed_by)
        .where(TaskLog.task_id == task_id)
        .order_by(TaskLog.seq)
    )
    return [tuple(row) for row in rows.tuples()]


# --- 선행 작업 걸기 · 떼기 ---------------------------------------------------------------


async def test_snapshot_carries_seed_dependencies_in_order(client: httpx.AsyncClient) -> None:
    assert await snapshot_deps(client) == [("k20", "k19"), ("k21", "k20"), ("k22", "k20")]
    assert await snapshot_deps(client, "p2") == []


async def test_put_is_idempotent_and_lands_in_the_snapshot(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    for _ in range(2):
        res = await client.put(dep("k18", "k17"))
        assert res.status_code == 200, res.text
        assert res.json() == {"taskId": "k18", "dependsOnId": "k17"}
    assert ("k18", "k17") in await snapshot_deps(client)
    row = await session.get(TaskDependency, ("k18", "k17"))
    assert row is not None and row.created_by == ADMIN and row.project_id == "p1"
    # 순서는 (taskId, dependsOnId) — 넣은 순서가 아니다
    await client.put(dep("k13", "k15"))
    deps = await snapshot_deps(client)
    assert deps == sorted(deps)


@pytest.mark.parametrize("other", ["x1", "없는작업"])
async def test_other_project_or_unknown_is_404(client: httpx.AsyncClient, other: str) -> None:
    res = await client.put(dep("k18", other))
    assert res.status_code == 404 and res.json()["code"] == "TASK_NOT_FOUND"


async def test_task_outside_my_projects_is_404(
    as_member: AsMember, anon: httpx.AsyncClient, session: AsyncSession
) -> None:
    """뒤 작업의 프로젝트를 못 보면 원래 없을 때와 같은 404 다. 로그인 없이는 401."""
    await session.execute(
        delete(ProjectMember).where(
            ProjectMember.project_id == "p1", ProjectMember.member_id == "u2"
        )
    )
    await session.commit()
    outsider = await as_member("u2")
    res = await outsider.put(dep("k18", "k17"))
    assert res.status_code == 404 and res.json()["code"] == "TASK_NOT_FOUND"
    assert (await anon.put(dep("k18", "k17"))).status_code == 401
    # 같은 프로젝트의 사용자는 건다 — 걸린 사람으로 남는다
    member = await as_member("u3")
    assert (await member.put(dep("k18", "k17"))).status_code == 200
    row = await session.get(TaskDependency, ("k18", "k17"))
    assert row is not None and row.created_by == "u3"


@pytest.mark.parametrize(
    ("task_id", "depends_on_id"),
    [
        ("k20", "k20"),  # 자기 자신
        ("k20", "k4"),  # 상위
        ("k4", "k20"),  # 하위
        ("k8", "k5"),  # 몇 단계 위의 조상
        ("k5", "k8"),  # 몇 단계 아래의 자손
    ],
)
async def test_hierarchy_is_400(
    client: httpx.AsyncClient, task_id: str, depends_on_id: str
) -> None:
    res = await client.put(dep(task_id, depends_on_id))
    assert res.status_code == 400
    assert res.json()["code"] == "TASK_DEPENDENCY_HIERARCHY"


@pytest.mark.parametrize(
    ("task_id", "depends_on_id"),
    [
        ("k20", "k21"),  # k21 이 이미 k20 을 기다린다
        ("k19", "k21"),  # k21 → k20 → k19, 두 단계를 건너
    ],
)
async def test_cycle_is_409(client: httpx.AsyncClient, task_id: str, depends_on_id: str) -> None:
    res = await client.put(dep(task_id, depends_on_id))
    assert res.status_code == 409
    assert res.json()["code"] == "TASK_DEPENDENCY_CYCLE"


async def test_twenty_at_most(client: httpx.AsyncClient) -> None:
    ids: list[str] = []
    for start in (0, 11):
        rows = [{"tempId": f"n{i}", "title": f"선행 후보 {i}"} for i in range(start, start + 11)]
        res = await client.post("/api/projects/p3/tasks/batch", json={"tasks": rows})
        assert res.status_code == 201, res.text
        ids += [row["id"] for row in res.json()["tasks"]]
    head, *others = ids
    for other in others[:20]:
        assert (await client.put(dep(head, other))).status_code == 200
    res = await client.put(dep(head, others[20]))
    assert res.status_code == 400 and res.json()["code"] == "TASK_DEPENDENCY_LIMIT"
    # 이미 걸린 것을 다시 거는 것은 멱등이라 상한에 안 걸린다
    assert (await client.put(dep(head, others[0]))).status_code == 200


async def test_delete_is_idempotent(client: httpx.AsyncClient) -> None:
    for _ in range(2):
        assert (await client.delete(dep("k21", "k20"))).status_code == 204
    assert ("k21", "k20") not in await snapshot_deps(client)
    # 모르는 선행 id 도 204 — 링크 떼기와 같다
    assert (await client.delete(dep("k21", "없는작업"))).status_code == 204
    # 뒤 작업이 없으면 404
    assert (await client.delete(dep("없는작업", "k20"))).status_code == 404


async def test_dependencies_go_with_the_task(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """작업을 지우면 그 작업이 낀 선행 관계 · 상태 기록이 같이 지워진다(cascade)."""
    await session.execute(delete(Task).where(Task.id == "k21"))
    await session.commit()
    assert await snapshot_deps(client) == [("k20", "k19"), ("k22", "k20")]
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


async def test_demo_script_adds_only_what_is_missing(session: AsyncSession) -> None:
    """개발 DB 처럼 backfill 만 있는 상태에서 시연 줄을 더한다. 두 번 돌려도 같다."""
    from scripts.seed import seed

    await seed(session)
    await session.execute(delete(TaskDependency))
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
    assert sum(note.endswith("넣음") for note in notes) == 5
    deps = await session.execute(select(TaskDependency.task_id, TaskDependency.depends_on_id))
    assert sorted(deps.tuples().all()) == [("k20", "k19"), ("k21", "k20"), ("k22", "k20")]
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


# --- AI 선행 관계 제안 -------------------------------------------------------------------


def answer(*items: tuple[str, str, str]) -> FakeClient:
    rows = [{"task": t, "dependsOn": d, "reason": r} for t, d, r in items]
    return FakeClient(Turn(texts=[json.dumps({"suggestions": rows}, ensure_ascii=False)]))


def sent(fake: FakeClient) -> dict[str, Any]:
    (call,) = fake.calls
    (message,) = call["messages"]
    content: str = message["content"]
    return dict(json.loads(content[content.index("{") :]))


async def test_suggestions_are_filtered(client: httpx.AsyncClient) -> None:
    fake = answer(
        ("HW-18", "HW-17", "챗봇 다음에 산출 API"),  # 남는다
        ("HW-21", "HW-20", "이미 있다"),
        ("HW-20", "HW-4", "상위"),
        ("HW-19", "HW-21", "완료 작업은 넣지 않았다"),
        ("HW-18", "HW-17", "겹친다"),
        ("HW-20", "HW-22", "순환"),
        ("PAS-1", "HW-1", "다른 프로젝트"),
        ("HW-17", "HW-18", "앞에서 받아들인 것과 순환"),
        ("HW-13", "HW-15", "   "),  # 이유 없음
        ("HW-13", "HW-15", "상품 분석이 끝나야 모델링을 한다"),  # 남는다
        ("HW-99", "HW-1", "지어낸 키"),
    )
    use(fake)
    res = await client.post(SUGGEST)
    assert res.status_code == 200, res.text
    assert res.json() == {
        "suggestions": [
            {"taskId": "k18", "dependsOnId": "k17", "reason": "챗봇 다음에 산출 API"},
            {"taskId": "k13", "dependsOnId": "k15", "reason": "상품 분석이 끝나야 모델링을 한다"},
        ],
        "truncated": False,
    }
    # 저장하지 않는다
    assert await snapshot_deps(client) == [("k20", "k19"), ("k21", "k20"), ("k22", "k20")]


async def test_context_has_open_tasks_and_existing_edges_by_key(
    client: httpx.AsyncClient,
) -> None:
    fake = answer()
    use(fake)
    assert (await client.post(SUGGEST)).json() == {"suggestions": [], "truncated": False}
    data = sent(fake)
    keys = [row["key"] for row in data["tasks"]]
    assert "HW-2" not in keys and "HW-19" not in keys and "PAS-1" not in keys
    # 기한 이른 순 → 등록 순, 기한 없는 것은 뒤
    assert keys[0] == "HW-20" and keys[-1] == "HW-18"
    hw20 = next(row for row in data["tasks"] if row["key"] == "HW-20")
    assert hw20["parent"] == "HW-4" and hw20["start"] == "2026-09-10"
    hw4 = next(row for row in data["tasks"] if row["key"] == "HW-4")
    assert len(hw4["body"]) <= dependency_suggest.BODY_LINES and hw4["threads"]
    # 완료(HW-19)가 낀 관계는 싣지 않는다
    assert data["existing"] == [
        {"task": "HW-21", "dependsOn": "HW-20"},
        {"task": "HW-22", "dependsOn": "HW-20"},
    ]
    raw = json.dumps(data, ensure_ascii=False)
    assert '"k20"' not in raw and '"u3"' not in raw


async def test_one_call_without_tools_on_chat_settings(client: httpx.AsyncClient) -> None:
    fake = answer()
    use(fake)
    await client.post(SUGGEST)
    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.chat_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["betas"] == [chat_service.FALLBACK_BETA]
    assert "tools" not in call and "thinking" not in call
    assert "한화손보 차세대" in call["system"]


async def test_twenty_suggestions_at_most(client: httpx.AsyncClient) -> None:
    batch = {"tasks": [{"tempId": f"n{i}", "title": f"일 {i}"} for i in range(8)]}
    created = (await client.post("/api/projects/p3/tasks/batch", json=batch)).json()["tasks"]
    keys = [row["key"] for row in created]
    pairs = [(keys[i], keys[j], "앞의 것이 먼저") for i in range(8) for j in range(i)]
    assert len(pairs) > dependency_suggest.SUGGESTION_MAX
    use(answer(*pairs))
    res = await client.post("/api/projects/p3/dependencies/suggest")
    assert len(res.json()["suggestions"]) == dependency_suggest.SUGGESTION_MAX


async def test_truncated_when_too_many(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dependency_suggest, "TASK_LIMIT", 3)
    fake = answer()
    use(fake)
    assert (await client.post(SUGGEST)).json()["truncated"] is True
    assert len(sent(fake)["tasks"]) == 3


async def test_fewer_than_two_open_tasks_does_not_call(client: httpx.AsyncClient) -> None:
    fake = answer()
    use(fake)
    res = await client.post("/api/projects/p3/dependencies/suggest")
    assert res.json() == {"suggestions": [], "truncated": False}
    assert fake.calls == []


@pytest.mark.parametrize(
    "texts",
    [
        ["알아서 하세요"],
        ["[]"],
        ['{"suggestions": "없음"}'],
        ['{"suggestions": [{"task": "HW-18"}]}'],
        ['{"suggestions": [{"task": "HW-18", "dependsOn": '],
    ],
)
async def test_bad_shape_is_502(client: httpx.AsyncClient, texts: list[str]) -> None:
    use(FakeClient(Turn(texts=texts)))
    res = await client.post(SUGGEST)
    assert res.status_code == 502 and res.json()["code"] == "DEPENDENCY_SUGGEST_FAILED"


async def test_fenced_json_is_read(client: httpx.AsyncClient) -> None:
    fenced = (
        '```json\n{"suggestions": [{"task": "HW-18", "dependsOn": "HW-17", "reason": "왜"}]}\n```'
    )
    use(FakeClient(Turn(texts=[fenced])))
    assert len((await client.post(SUGGEST)).json()["suggestions"]) == 1


async def test_refusal_is_502(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    res = await client.post(SUGGEST)
    assert res.status_code == 502 and res.json()["code"] == "DEPENDENCY_SUGGEST_FAILED"


async def test_no_key_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(SUGGEST)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


async def test_shares_the_chat_rate_limit(client: httpx.AsyncClient) -> None:
    use(answer())
    limiter = RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter
    assert (await client.post(SUGGEST)).status_code == 200
    res = await client.post(SUGGEST)
    assert res.status_code == 429 and res.json()["code"] == "CHAT_RATE_LIMITED"


async def test_claude_errors_map_to_chat_codes(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    limited = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=limited)))
    res = await client.post(SUGGEST)
    assert res.status_code == 429 and res.json()["code"] == "CHAT_RATE_LIMITED"
    use(FakeClient(Turn(raises=APIConnectionError(request=request))))
    res = await client.post(SUGGEST)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


async def test_suggest_outside_my_projects_is_404(client: httpx.AsyncClient) -> None:
    use(answer())
    res = await client.post("/api/projects/없음/dependencies/suggest")
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"

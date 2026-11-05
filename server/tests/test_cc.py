"""참조(cc) — 안건 · 테스트의 `ccIds` (docs/api/cc.md).

모양 · 검사 · 통째로 갈아끼우기 · 변경 이력 · 스냅샷 · 권한 · 리비전 0033 을 본다.
확인 요청이 참조에게 가는 것은 `tests/test_check.py`, 챗봇 이름은 `tests/test_search.py` 에 있다.
"""

from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgendaCc, Member, TestCc
from app.services import risk as risk_service
from scripts.seed import seed
from tests.conftest import AsMember

AGENDAS = "/api/projects/p1/agendas"
TESTS = "/api/projects/p1/tests"


async def outsider(session: AsyncSession) -> None:
    """어느 프로젝트에도 부여되지 않은 사람 u9 · 비활성으로 돌린 u4."""
    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.active = False
    await session.commit()


def error(res: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert res.status_code == status, res.text
    body: dict[str, Any] = res.json()
    assert body["code"] == code
    return body


async def history(c: httpx.AsyncClient, path: str) -> list[dict[str, Any]]:
    res = await c.get(f"/api/{path}/history")
    assert res.status_code == 200, res.text
    rows: list[dict[str, Any]] = res.json()
    return rows


# --- 시드 ---


async def test_seed_cc_matches_the_mock(client: httpx.AsyncClient) -> None:
    """t2 = [u2, u4], t1 = [u1], tc2 = [u3], 나머지는 [] — 목업과 값 · 순서까지 같다."""
    snapshot = (await client.get("/api/projects/p1/snapshot")).json()
    cc = {row["id"]: row["ccIds"] for row in snapshot["agendas"]}
    assert cc.pop("t1") == ["u1"]
    assert cc.pop("t2") == ["u2", "u4"]
    assert all(value == [] for value in cc.values())

    tests = (await client.get(TESTS)).json()
    cc = {row["id"]: row["ccIds"] for row in tests}
    assert cc.pop("tc2") == ["u3"]
    assert all(value == [] for value in cc.values())


# --- 안건 ---


async def test_agenda_add_keeps_order_and_drops_repeats(client: httpx.AsyncClient) -> None:
    res = await client.post(
        AGENDAS, json={"title": "로그", "ownerId": "u2", "ccIds": ["u3", "u2", "u1", "u3"]}
    )
    assert res.status_code == 201, res.text
    # 담당자와 같은 사람도 받는다. 겹친 id 는 앞의 하나만
    assert res.json()["ccIds"] == ["u3", "u2", "u1"]
    assert (await client.post(AGENDAS, json={"title": "빈"})).json()["ccIds"] == []


async def test_agenda_cc_must_be_an_active_project_member(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await outsider(session)
    for bad in ("nope", "u9", "u4"):
        body = error(
            await client.post(AGENDAS, json={"title": "t", "ccIds": ["u1", bad]}),
            400,
            "AGENDA_CC_NOT_FOUND",
        )
        # detail 에 걸린 id
        assert body["detail"] == {"ccIds": bad}
        error(
            await client.patch("/api/agendas/t3", json={"ccIds": [bad]}),
            400,
            "AGENDA_CC_NOT_FOUND",
        )
    # 아무것도 안 남았다
    assert (await client.get("/api/projects/p1/snapshot")).json()["agendas"][2]["ccIds"] == []


async def test_agenda_patch_replaces_the_whole_list(client: httpx.AsyncClient) -> None:
    res = await client.patch("/api/agendas/t2", json={"ccIds": ["u4", "u1", "u4"]})
    assert res.status_code == 200, res.text
    assert res.json()["ccIds"] == ["u4", "u1"]
    # 안 보내면 그대로
    res = await client.patch("/api/agendas/t2", json={"title": "DB 결정"})
    assert res.json()["ccIds"] == ["u4", "u1"]
    # 비우기는 []
    assert (await client.patch("/api/agendas/t2", json={"ccIds": []})).json()["ccIds"] == []


async def test_agenda_patch_null_cc_is_422(client: httpx.AsyncClient) -> None:
    error(await client.patch("/api/agendas/t2", json={"ccIds": None}), 422, "VALIDATION_ERROR")


async def test_agenda_keeps_a_cc_who_became_inactive(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """이미 참조에 있던 사람은 그대로 둘 수 있다 — 담당자 · 파트 검사와 같다."""
    await outsider(session)  # t2 의 참조 u4 가 비활성이 됐다
    res = await client.patch("/api/agendas/t2", json={"ccIds": ["u4", "u2"]})
    assert res.status_code == 200, res.text
    assert res.json()["ccIds"] == ["u4", "u2"]


async def test_agenda_history_has_cc_after_owner(client: httpx.AsyncClient) -> None:
    await client.patch("/api/agendas/t2", json={"ownerId": "u1", "ccIds": ["u4", "u2"]})
    rows = await history(client, "agendas/t2")
    assert [(c["field"], c["from"], c["to"]) for c in rows[-1]["changes"]] == [
        ("ownerId", "u3", "u1"),
        ("ccIds", ["u2", "u4"], ["u4", "u2"]),
    ]
    # 같은 집합 · 같은 순서면 안 남긴다
    before = len(rows)
    assert (await client.patch("/api/agendas/t2", json={"ccIds": ["u4", "u2", "u4"]})).is_success
    assert len(await history(client, "agendas/t2")) == before


async def test_agenda_add_records_only_created(client: httpx.AsyncClient) -> None:
    agenda = (await client.post(AGENDAS, json={"title": "t", "ccIds": ["u1"]})).json()
    (row,) = await history(client, f"agendas/{agenda['id']}")
    assert [c["field"] for c in row["changes"]] == ["created"]


async def test_agenda_cc_gives_no_rights(as_member: AsMember) -> None:
    """참조는 권한을 주지 않는다 — t2 의 참조 u2 도 고치지 못한다. 참조를 바꾸는 것도 같다."""
    u2 = await as_member("u2")
    error(await u2.patch("/api/agendas/t2", json={"ccIds": []}), 403, "FORBIDDEN")
    error(await u2.patch("/api/agendas/t2", json={"title": "고침"}), 403, "FORBIDDEN")
    assert (await u2.delete("/api/agendas/t2")).status_code == 403
    # 담당자(u3)는 바꾼다
    u3 = await as_member("u3")
    assert (await u3.patch("/api/agendas/t2", json={"ccIds": ["u2"]})).status_code == 200


async def test_minutes_apply_leaves_cc_alone(client: httpx.AsyncClient) -> None:
    """회의록 반영은 참조를 건드리지 않는다 — 새 안건은 [], 바꾼 안건은 그대로."""
    from tests.test_minutes import APPLY, minutes, new_agenda, update_row

    res = await client.post(
        APPLY,
        json=minutes(
            agendas=[new_agenda("n1", "새 안건")], updates=[update_row("t2", "mysql 로 간다")]
        ),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["agendas"][0]["ccIds"] == []
    assert body["updatedAgendas"][0]["ccIds"] == ["u2", "u4"]


async def test_risk_does_not_count_cc(session: AsyncSession) -> None:
    """참조는 리스크 사람별 · 신호 어디에도 세지 않는다 — 참조를 바꿔도 보고서가 같다."""
    from tests.test_risk import TODAY

    await seed(session)
    before = await risk_service.decision_risks(session, "p1", today=TODAY)
    # PATCH 는 이력 줄을 남겨 '마지막으로 손댄 때' 가 바뀐다 — 참조 줄만 바로 넣는다
    session.add_all(
        AgendaCc(agenda_id=agenda_id, project_id="p1", member_id=member_id, sort_order=order)
        for agenda_id in ("t3", "t5", "t7")
        for order, member_id in enumerate(("u1", "u2", "u3"))
    )
    await session.commit()
    session.expire_all()
    after = await risk_service.decision_risks(session, "p1", today=TODAY)
    assert after.model_dump() == before.model_dump()


# --- 테스트 ---


async def test_test_create_and_patch_cc(client: httpx.AsyncClient) -> None:
    res = await client.post(TESTS, json={"title": "새", "ccIds": ["u2", "u1", "u2"]})
    assert res.status_code == 201, res.text
    created = res.json()
    assert created["ccIds"] == ["u2", "u1"]
    res = await client.patch(f"/api/tests/{created['id']}", json={"ccIds": ["u1"]})
    assert res.json()["ccIds"] == ["u1"]
    res = await client.patch(f"/api/tests/{created['id']}", json={"title": "고침"})
    assert res.json()["ccIds"] == ["u1"]
    assert (await client.post(TESTS, json={"title": "빈"})).json()["ccIds"] == []


async def test_test_cc_errors(client: httpx.AsyncClient, session: AsyncSession) -> None:
    await outsider(session)
    for bad in ("nope", "u9", "u4"):
        body = error(
            await client.post(TESTS, json={"title": "t", "ccIds": [bad]}), 400, "TEST_CC_NOT_FOUND"
        )
        assert body["detail"] == {"ccIds": bad}
        error(await client.patch("/api/tests/tc1", json={"ccIds": [bad]}), 400, "TEST_CC_NOT_FOUND")
    error(await client.patch("/api/tests/tc2", json={"ccIds": None}), 422, "VALIDATION_ERROR")


async def test_test_history_has_cc_after_owner(client: httpx.AsyncClient) -> None:
    await client.patch("/api/tests/tc2", json={"ownerId": "u1", "ccIds": ["u3", "u4"]})
    rows = await history(client, "tests/tc2")
    assert [(c["field"], c["from"], c["to"]) for c in rows[-1]["changes"]] == [
        ("ownerId", "u2", "u1"),
        ("ccIds", ["u3"], ["u3", "u4"]),
    ]
    before = len(rows)
    assert (await client.patch("/api/tests/tc2", json={"ccIds": ["u3", "u4"]})).is_success
    assert len(await history(client, "tests/tc2")) == before


async def test_cc_only_patch_keeps_the_basis(client: httpx.AsyncClient) -> None:
    """참조만 바꾼 것은 내용을 다시 본 것이 아니다 — 기준 바뀜이 남는다(tc4 는 t2 가 바뀜)."""
    res = await client.patch("/api/tests/tc4", json={"ccIds": ["u1"]})
    assert res.status_code == 200, res.text
    assert res.json()["changedAgendaIds"] == ["t2"]
    assert "basisChanged" in res.json()["signals"]
    # 다른 칸을 같이 고치면 지금처럼 다시 찍는다
    res = await client.patch("/api/tests/tc4", json={"ccIds": [], "title": "고침"})
    assert res.json()["changedAgendaIds"] == []


async def test_deleting_a_test_drops_its_cc(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    created = (await client.post(TESTS, json={"title": "지울", "ccIds": ["u1", "u2"]})).json()
    assert (await client.delete(f"/api/tests/{created['id']}")).status_code == 204
    left = await session.scalar(
        select(func.count()).select_from(TestCc).where(TestCc.test_id == created["id"])
    )
    assert left == 0


async def test_deleted_agenda_keeps_its_cc_rows(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """논리 삭제라 줄은 남고 어디서도 안 보인다."""
    assert (await client.delete("/api/agendas/t2")).status_code == 204
    left = await session.scalar(
        select(func.count()).select_from(AgendaCc).where(AgendaCc.agenda_id == "t2")
    )
    assert left == 2


# --- 리비전 0033 ---


@pytest.mark.parametrize("table", ["agenda_cc", "test_cc"])
def test_migration_0033_adds_and_drops_the_tables(table: str) -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0033_cc")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[: at + 1]:
                revision.module.upgrade()
            columns = [c["name"] for c in inspect(conn).get_columns(table)]
            assert columns[1:] == ["project_id", "member_id", "sort_order"]
            assert len(inspect(conn).get_pk_constraint(table)["constrained_columns"]) == 2
            revisions[at].module.downgrade()
            assert table not in inspect(conn).get_table_names()
            revisions[at].module.upgrade()
            assert table in inspect(conn).get_table_names()

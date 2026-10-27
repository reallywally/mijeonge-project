"""스키마 자체를 본다 — 마이그레이션이 모델과 맞는지, 그리고 DB 가 경계를 지키는지.

Postgres 없이 도는 검사다 — 메모리 sqlite 에 리비전을 차례로 얹고, 그 결과를
`Base.metadata` 와 비교해 차이가 없어야 한다. 모델만 고치고 리비전을 안 만들면 여기서 걸린다.
(ALTER 가 들어간 리비전이 생기면 sqlite 로는 못 돌린다. 그때 이 검사는 진짜 Postgres 로 옮긴다.)
"""

import pytest
from alembic.autogenerate import produce_migrations
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Base, Task, TaskRelation, TaskThreadLink, Thread
from app.time import now
from scripts.seed import seed


def test_migrations_match_models() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions:
                revision.module.upgrade()

        diff_ctx = MigrationContext.configure(conn, opts={"target_metadata": Base.metadata})
        diffs = produce_migrations(diff_ctx, Base.metadata).upgrade_ops
        assert diffs is not None
        assert diffs.as_diffs() == []


def test_single_head() -> None:
    """리비전이 갈라지면(head 둘) 배포에서 터진다 — 여기서 먼저 잡는다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert len(script.get_heads()) == 1


async def test_link_cannot_cross_projects(session: AsyncSession) -> None:
    """링크는 양쪽이 같은 프로젝트일 때만 선다 — 서비스만이 아니라 DB 가 막는다 (API.md Q13)."""
    await seed(session)

    session.add(TaskThreadLink(task_id="k4", thread_id="t10", project_id="p1"))
    with pytest.raises(IntegrityError):
        await session.flush()
    await session.rollback()


async def test_relation_cannot_cross_projects(session: AsyncSession) -> None:
    """연관 작업도 같은 프로젝트에서만 선다 — 서비스만이 아니라 DB 가 막는다 (Q61)."""
    await seed(session)

    session.add(
        TaskRelation(task_id="x2", related_id="k1", project_id="p2", created_at=now())
    )  # k1 은 p1, x2 는 p2
    with pytest.raises(IntegrityError):
        await session.flush()
    await session.rollback()


async def test_relation_cannot_point_at_itself(session: AsyncSession) -> None:
    await seed(session)

    session.add(TaskRelation(task_id="k1", related_id="k1", project_id="p1", created_at=now()))
    with pytest.raises(IntegrityError):
        await session.flush()
    await session.rollback()


@pytest.mark.parametrize(("model", "row_id"), [(Task, "x1"), (Thread, "t10")])
async def test_part_cannot_live_in_another_project(
    session: AsyncSession, model: type[Task] | type[Thread], row_id: str
) -> None:
    """파트도 같은 프로젝트의 것만 단다 — 부모 · 링크와 같은 복합 FK (docs/api/part.md)."""
    await seed(session)

    row = await session.get(model, row_id)
    assert row is not None
    row.part_id = "pt1"  # pt1 은 p1, 이 줄은 p2
    with pytest.raises(IntegrityError):
        await session.flush()
    await session.rollback()

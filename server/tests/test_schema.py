"""마이그레이션과 모델이 어긋나지 않는지 본다.

Postgres 없이 도는 검사다 — 메모리 sqlite 에 리비전을 차례로 얹고, 그 결과를
`Base.metadata` 와 비교해 차이가 없어야 한다. 모델만 고치고 리비전을 안 만들면 여기서 걸린다.
(ALTER 가 들어간 리비전이 생기면 sqlite 로는 못 돌린다. 그때 이 검사는 진짜 Postgres 로 옮긴다.)
"""

from alembic.autogenerate import produce_migrations
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from app.models import Base


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

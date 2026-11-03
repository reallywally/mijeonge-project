"""안건 · 이력 줄 — 등록한 사람 · 논리 삭제 · 안건 변경 이력(thread_history)

Revision ID: 0029_thread_perm
Revises: 0028_task_soft_delete
Create Date: 2026-11-02

계약은 `docs/api/history.md` '칸 — 안건' · `docs/api/auth.md` '안건'.
있던 안건 · 줄의 등록한 사람은 남은 기록이 없어 null 로 둔다 — 그 안건은 담당자 · 관리자만 고친다.
있던 안건마다 '등록' 한 줄(`backfilled`, 바꾼 사람 없음)을 등록 시각에 넣는다 — 0019 와 같은 방식.
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0029_thread_perm"
down_revision: str | None = "0028_task_soft_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
CHANGES = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
CREATED = [{"field": "created", "from": None, "to": None, "subject": ""}]
LIVE = sa.text("not is_deleted")


def _add_columns(table: str) -> None:
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("creator_id", ID, nullable=True))
        batch.add_column(
            sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False)
        )
        batch.add_column(sa.Column("deleted_at", UTC_TS, nullable=True))
        batch.add_column(sa.Column("deleted_by", ID, nullable=True))
        batch.create_foreign_key(op.f(f"fk_{table}_creator_id"), "member", ["creator_id"], ["id"])
        batch.create_foreign_key(op.f(f"fk_{table}_deleted_by"), "member", ["deleted_by"], ["id"])


def _drop_columns(table: str) -> None:
    with op.batch_alter_table(table) as batch:
        batch.drop_constraint(op.f(f"fk_{table}_deleted_by"), type_="foreignkey")
        batch.drop_constraint(op.f(f"fk_{table}_creator_id"), type_="foreignkey")
        batch.drop_column("deleted_by")
        batch.drop_column("deleted_at")
        batch.drop_column("is_deleted")
        batch.drop_column("creator_id")


def upgrade() -> None:
    _add_columns("thread")
    _add_columns("entry")
    op.create_index(
        "ix_thread_project_id_live",
        "thread",
        ["project_id", "seq"],
        postgresql_where=LIVE,
        sqlite_where=LIVE,
    )

    history = op.create_table(
        "thread_history",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("changed_by", ID, nullable=True),
        sa.Column("changed_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("changes", CHANGES, nullable=False),
        sa.Column("backfilled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_thread_history_thread_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["changed_by"], ["member.id"], name=op.f("fk_thread_history_changed_by")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_thread_history")),
        sa.UniqueConstraint("seq", name=op.f("uq_thread_history_seq")),
    )
    op.create_index("ix_thread_history_thread_id_seq", "thread_history", ["thread_id", "seq"])

    # 열 타입을 적어 읽는다 — sqlite(검사)에서도 created_at 이 datetime 으로 온다
    thread = sa.table(
        "thread",
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("created_at", UTC_TS),
        sa.column("seq", sa.BigInteger()),
    )
    found = op.get_bind().execute(
        sa.select(thread.c.id, thread.c.project_id, thread.c.created_at).order_by(thread.c.seq)
    )
    rows = [
        {
            "id": uuid4().hex,
            "project_id": row.project_id,
            "thread_id": row.id,
            "changed_by": None,
            "changed_at": row.created_at,
            "changes": CREATED,
            "backfilled": True,
            # 번호를 직접 준다 — sqlite 는 Identity 를 모른다. Postgres 는 아래서 시퀀스를 민다
            "seq": number,
        }
        for number, row in enumerate(found, start=1)
    ]
    if rows:
        op.bulk_insert(history, rows)
    if op.get_bind().dialect.name == "postgresql":
        # 빈 테이블이면 is_called=false — 다음 줄이 1 번이다
        op.execute(
            "select setval(pg_get_serial_sequence('thread_history', 'seq'),"
            " coalesce((select max(seq) from thread_history), 1),"
            " (select count(*) from thread_history) > 0)"
        )


def downgrade() -> None:
    # 지운 안건 · 줄을 실제로 지우지 않는다 — 내리면 다시 보이지만, 되돌릴 수 없는 손실보다 낫다
    op.drop_index("ix_thread_history_thread_id_seq", table_name="thread_history")
    op.drop_table("thread_history")
    op.drop_index("ix_thread_project_id_live", table_name="thread")
    _drop_columns("entry")
    _drop_columns("thread")

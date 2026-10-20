"""회의록 게시판 — minutes, 안건 · 이력 · 작업의 출처 minutes_id

Revision ID: 0014_minutes
Revises: 0013_check_on_decision
Create Date: 2026-10-20

계약은 `docs/api/minutes.md`(2026-10-20 고침) · Q48.
출처는 `ON DELETE SET NULL` 이다 — 회의록을 지워도 거기서 나온 줄은 남는다.
복합 FK 를 두지 않는다(`SET NULL` 이 `project_id` 까지 비우려 든다). 기존 줄은 null 그대로다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_minutes"
down_revision: str | None = "0013_check_on_decision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
SOURCED = ("thread", "entry", "task")


def upgrade() -> None:
    op.create_table(
        "minutes",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("meeting_date", sa.Date(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column("author_id", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("updated_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_minutes_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["author_id"], ["member.id"], name=op.f("fk_minutes_author_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_minutes")),
        sa.UniqueConstraint("seq", name=op.f("uq_minutes_seq")),
    )
    op.create_index("ix_minutes_project_id_seq", "minutes", ["project_id", "seq"])

    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    for table in SOURCED:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("minutes_id", ID, nullable=True))
            batch.create_foreign_key(
                f"fk_{table}_minutes_id", "minutes", ["minutes_id"], ["id"], ondelete="SET NULL"
            )
        # 회의록을 지울 때 SET NULL 이 이것으로 줄을 찾는다
        op.create_index(f"ix_{table}_minutes_id", table, ["minutes_id"])


def downgrade() -> None:
    for table in reversed(SOURCED):
        op.drop_index(f"ix_{table}_minutes_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_minutes_id", type_="foreignkey")
            batch.drop_column("minutes_id")
    op.drop_index("ix_minutes_project_id_seq", table_name="minutes")
    op.drop_table("minutes")

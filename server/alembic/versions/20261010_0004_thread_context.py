"""안건의 배경 · 후보 · 결정 기한

Revision ID: 0004_thread_context
Revises: 0003_contract_gaps
Create Date: 2026-10-10

후보는 순서가 뜻을 갖는 string[] 이라 `entry_detail` 과 같은 자식 테이블로 둔다.
description 은 빈 값이 '' 라(null 이 아니다) 기존 행도 server_default 로 채운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_thread_context"
down_revision: str | None = "0003_contract_gaps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("thread", sa.Column("description", sa.Text(), server_default="", nullable=False))
    op.add_column("thread", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_table(
        "thread_option",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["thread.id"],
            name=op.f("fk_thread_option_thread_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_thread_option")),
    )


def downgrade() -> None:
    op.drop_table("thread_option")
    with op.batch_alter_table("thread") as batch:
        batch.drop_column("due_date")
        batch.drop_column("description")

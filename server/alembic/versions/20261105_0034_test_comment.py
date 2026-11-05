"""테스트 조치 내역 — test_comment

Revision ID: 0034_test_comment
Revises: 0033_cc
Create Date: 2026-11-05

계약은 `docs/api/test-comment.md`. 작업 댓글(0007)과 같은 모양의 빈 표를 세운다 —
있던 테스트는 조치 내역 없이 시작한다. 테스트를 지우면 같이 지워진다(ON DELETE CASCADE).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0034_test_comment"
down_revision: str | None = "0033_cc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    op.create_table(
        "test_comment",
        sa.Column("id", ID, nullable=False),
        sa.Column("test_id", ID, nullable=False),
        sa.Column("author_id", ID, nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"], ["member.id"], name=op.f("fk_test_comment_author_id")
        ),
        sa.ForeignKeyConstraint(
            ["test_id"],
            ["test_case.id"],
            name=op.f("fk_test_comment_test_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_comment")),
        sa.UniqueConstraint("seq", name=op.f("uq_test_comment_seq")),
    )
    op.create_index("ix_test_comment_test_id_seq", "test_comment", ["test_id", "seq"])


def downgrade() -> None:
    # 조치 내역은 옮길 곳이 없어 같이 지운다
    op.drop_index("ix_test_comment_test_id_seq", table_name="test_comment")
    op.drop_table("test_comment")

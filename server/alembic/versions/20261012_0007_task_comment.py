"""작업 댓글 — task_comment

Revision ID: 0007_task_comment
Revises: 0006_search_trgm
Create Date: 2026-10-12

작업 상세에서 주고받는 댓글. 작업을 지우면 같이 지워진다(ON DELETE CASCADE).
목록 순서는 `seq` 가 정한다 — 작업 하나의 댓글을 순서대로 읽으므로 (task_id, seq) 인덱스를 둔다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_task_comment"
down_revision: str | None = "0006_search_trgm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    op.create_table(
        "task_comment",
        sa.Column("id", ID, nullable=False),
        sa.Column("task_id", ID, nullable=False),
        sa.Column("author_id", ID, nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"], ["member.id"], name=op.f("fk_task_comment_author_id")
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["task.id"], name=op.f("fk_task_comment_task_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_comment")),
        sa.UniqueConstraint("seq", name=op.f("uq_task_comment_seq")),
    )
    op.create_index("ix_task_comment_task_id_seq", "task_comment", ["task_id", "seq"])


def downgrade() -> None:
    op.drop_index("ix_task_comment_task_id_seq", table_name="task_comment")
    op.drop_table("task_comment")

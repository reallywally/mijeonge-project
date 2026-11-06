"""프로필 사진 — member_avatar

Revision ID: 0035_member_avatar
Revises: 0034_test_comment
Create Date: 2026-11-06

계약은 `docs/api/me.md`. 한 사람에 한 장 — 빈 표로 세운다(있던 멤버는 사진 없이 시작한다).
멤버 행을 가볍게 두려고 `member` 에 열을 더하지 않고 뗀다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0035_member_avatar"
down_revision: str | None = "0034_test_comment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "member_avatar",
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["member.id"],
            name=op.f("fk_member_avatar_member_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("member_id", name=op.f("pk_member_avatar")),
    )


def downgrade() -> None:
    # 사진은 옮길 곳이 없어 같이 지운다
    op.drop_table("member_avatar")

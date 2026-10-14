"""멤버 소개 — member 의 career · skills · notes

Revision ID: 0010_member_profile
Revises: 0009_part
Create Date: 2026-10-14

계약은 `docs/api/auth.md` 의 '테이블' 이다. 경력 · 기술 스펙 · 기타 사항을 자유 글로 둔다.
기존 멤버는 셋 다 null 로 시작한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_member_profile"
down_revision: str | None = "0009_part"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = ("career", "skills", "notes")


def upgrade() -> None:
    with op.batch_alter_table("member") as batch:
        for name in COLUMNS:
            batch.add_column(sa.Column(name, sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("member") as batch:
        for name in reversed(COLUMNS):
            batch.drop_column(name)

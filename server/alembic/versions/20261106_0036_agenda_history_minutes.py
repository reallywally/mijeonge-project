"""안건 이력 줄의 회의록 출처 — agenda_history.minutes_id

Revision ID: 0036_agenda_history_minutes
Revises: 0035_member_avatar
Create Date: 2026-11-06

`API.md` Q69. 회의록 [등록] 이 남긴 이력 줄에 그 회의록을 단다 — AI 리스크 분석이
'이 안건을 다룬 회의' 를 센다. 지난 줄은 채우지 않는다(어느 회의록이었는지 남은 기록이 없다).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0036_agenda_history_minutes"
down_revision: str | None = "0035_member_avatar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — Postgres 에서는 ALTER 그대로다
    with op.batch_alter_table("agenda_history") as batch:
        batch.add_column(sa.Column("minutes_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key(
            "fk_agenda_history_minutes_id",
            "minutes",
            ["minutes_id"],
            ["id"],
            ondelete="SET NULL",
        )
    # 회의록을 지울 때 SET NULL 이 이것으로 줄을 찾는다
    op.create_index("ix_agenda_history_minutes_id", "agenda_history", ["minutes_id"])


def downgrade() -> None:
    op.drop_index("ix_agenda_history_minutes_id", table_name="agenda_history")
    with op.batch_alter_table("agenda_history") as batch:
        batch.drop_constraint("fk_agenda_history_minutes_id", type_="foreignkey")
        batch.drop_column("minutes_id")

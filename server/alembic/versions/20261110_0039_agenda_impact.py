"""AI 영향도 분석 — agenda_impact

Revision ID: 0039_agenda_impact
Revises: 0038_risk_churn
Create Date: 2026-11-10

계약은 `docs/api/impact.md`. 새 테이블 하나뿐이라 지난 데이터는 건드리지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0039_agenda_impact"
down_revision: str | None = "0038_risk_churn"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "agenda_impact",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("agenda_id", ID, nullable=False),
        sa.Column("decision_rev", sa.Integer(), nullable=False),
        sa.Column("decision_before", sa.Text(), nullable=True),
        sa.Column("decision_after", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("result", JSON_TYPE, nullable=False),
        sa.Column("created_by", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["agenda_id", "project_id"],
            ["agenda.id", "agenda.project_id"],
            name=op.f("fk_agenda_impact_agenda_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["member.id"],
            name=op.f("fk_agenda_impact_created_by"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agenda_impact")),
    )
    op.create_index(
        "ix_agenda_impact_agenda_id_created_at", "agenda_impact", ["agenda_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_agenda_impact_agenda_id_created_at", table_name="agenda_impact")
    op.drop_table("agenda_impact")

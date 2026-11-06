"""저장한 AI 리스크 분석 — risk_analysis · project.last_analysis_no, 리포트 걷기(project_report)

Revision ID: 0037_risk_analysis
Revises: 0036_agenda_history_minutes
Create Date: 2026-11-06

계약은 `docs/api/risk-analysis.md`. 리포트는 하는 일이 겹쳐 걷는다 — **`project_report` 의 줄은
버린다**(사용자 결정). 되돌리면 빈 `project_report` 가 돌아온다(지운 리포트는 못 되살린다).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0037_risk_analysis"
down_revision: str | None = "0036_agenda_history_minutes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "risk_analysis",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("seq", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("refs", JSON_TYPE, nullable=False),
        sa.Column("facts", JSON_TYPE, nullable=False),
        sa.Column("created_by", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("saved_at", UTC_TS, nullable=True),
        sa.Column("title_edited_at", UTC_TS, nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_risk_analysis_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["member.id"],
            name=op.f("fk_risk_analysis_created_by"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_risk_analysis")),
        sa.UniqueConstraint("project_id", "seq", name=op.f("uq_risk_analysis_project_id_seq")),
    )
    op.create_index(
        "ix_risk_analysis_saved_at_created_at", "risk_analysis", ["saved_at", "created_at"]
    )
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — Postgres 에서는 ALTER 그대로다
    with op.batch_alter_table("project") as batch:
        batch.add_column(
            sa.Column("last_analysis_no", sa.Integer(), server_default="0", nullable=False)
        )

    op.drop_index("ix_project_report_project_id_seq", table_name="project_report")
    op.drop_table("project_report")


def downgrade() -> None:
    # 0016 의 모양 그대로 — 줄은 돌아오지 않는다
    op.create_table(
        "project_report",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("facts", JSON_TYPE, nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_project_report_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["member.id"], name=op.f("fk_project_report_created_by")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_report")),
        sa.UniqueConstraint("seq", name=op.f("uq_project_report_seq")),
    )
    op.create_index("ix_project_report_project_id_seq", "project_report", ["project_id", "seq"])

    with op.batch_alter_table("project") as batch:
        batch.drop_column("last_analysis_no")
    op.drop_index("ix_risk_analysis_saved_at_created_at", table_name="risk_analysis")
    op.drop_table("risk_analysis")

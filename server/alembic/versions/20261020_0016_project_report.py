"""프로젝트 진행 리포트 — project_report

Revision ID: 0016_project_report
Revises: 0015_task_flow
Create Date: 2026-10-20

계약은 `docs/api/report.md` · Q51. 시드 리포트는 없다 — 시연에서 [리포트 만들기] 를 누른다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0016_project_report"
down_revision: str | None = "0015_task_flow"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "project_report",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column(
            "facts",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=False,
        ),
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


def downgrade() -> None:
    op.drop_index("ix_project_report_project_id_seq", table_name="project_report")
    op.drop_table("project_report")

"""결정 병목 리스크 기준 — risk_setting

Revision ID: 0011_risk_setting
Revises: 0010_member_profile
Create Date: 2026-10-15

계약은 `docs/api/risk.md` 의 '기준 설정' 이다. 프로젝트당 한 줄,
줄이 없으면 `config.py` 의 기본값을 쓴다.
기존 프로젝트는 줄 없이(기본값으로) 시작한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_risk_setting"
down_revision: str | None = "0010_member_profile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 모델(app/models/risk.py)의 RISK_RANGES 와 같다 — 리비전은 그때의 값을 박아 둔다
RANGES = {
    "due_soon_days": (1, 30),
    "defer_count": (1, 10),
    "stale_days": (1, 90),
    "high_score": (2, 30),
    "medium_score": (1, 29),
}


def upgrade() -> None:
    op.create_table(
        "risk_setting",
        sa.Column("project_id", sa.String(length=36), nullable=False),
        *(sa.Column(column, sa.Integer(), nullable=False) for column in RANGES),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        *(
            sa.CheckConstraint(
                f"{column} between {low} and {high}",
                name=op.f(f"ck_risk_setting_{column}_range"),
            )
            for column, (low, high) in RANGES.items()
        ),
        sa.CheckConstraint(
            "high_score > medium_score", name=op.f("ck_risk_setting_high_above_medium")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_risk_setting_project_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", name=op.f("pk_risk_setting")),
    )


def downgrade() -> None:
    op.drop_table("risk_setting")

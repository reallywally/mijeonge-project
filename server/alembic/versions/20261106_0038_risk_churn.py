"""리스크 흔들림 기준 — risk_setting.churn_days · churn_count · slip_count

Revision ID: 0038_risk_churn
Revises: 0037_risk_analysis
Create Date: 2026-11-06

계약은 `docs/api/risk-dashboard.md` '기준'. 지금 줄은 server_default 로 기본값을 받는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0038_risk_churn"
down_revision: str | None = "0037_risk_analysis"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 모델의 RISK_RANGES · config.py 의 기본값과 같다 — 리비전은 그때의 값을 박아 둔다
COLUMNS: dict[str, tuple[int, int, int]] = {
    # 칸: (아래, 위, 기본)
    "churn_days": (1, 90, 14),
    "churn_count": (2, 50, 5),
    "slip_count": (1, 10, 2),
}


def upgrade() -> None:
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — Postgres 에서는 ALTER 그대로다
    with op.batch_alter_table("risk_setting") as batch:
        for column, (_, _, default) in COLUMNS.items():
            batch.add_column(
                sa.Column(
                    column, sa.Integer(), server_default=sa.text(str(default)), nullable=False
                )
            )
        for column, (low, high, _) in COLUMNS.items():
            batch.create_check_constraint(
                op.f(f"ck_risk_setting_{column}_range"), f"{column} between {low} and {high}"
            )


def downgrade() -> None:
    with op.batch_alter_table("risk_setting") as batch:
        for column in COLUMNS:
            batch.drop_constraint(op.f(f"ck_risk_setting_{column}_range"), type_="check")
        for column in COLUMNS:
            batch.drop_column(column)

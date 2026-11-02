"""프로젝트 관리 — 설명 · 기간 · 상태(진행 · 종료) · 소프트 삭제

Revision ID: 0024_project_manage
Revises: 0023_drop_task_dependency
Create Date: 2026-11-02

있던 프로젝트는 전부 'active' 로 시작한다(server_default). 삭제는 `deleted_at` 만 찍는다 —
레코드와 작업 키 접두사는 그대로 남아 되살릴 여지가 있다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0024_project_manage"
down_revision: str | None = "0023_drop_task_dependency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("project", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("project", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("project", sa.Column("end_date", sa.Date(), nullable=True))
    op.add_column(
        "project",
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
    )
    op.add_column("project", sa.Column("closed_at", UTC_TS, nullable=True))
    op.add_column("project", sa.Column("deleted_at", UTC_TS, nullable=True))
    # 제약을 더하는 ALTER 를 sqlite 가 못 한다 — batch 로 감싼다(Postgres 에서는 그냥 ALTER 다)
    with op.batch_alter_table("project") as batch:
        batch.create_check_constraint(op.f("ck_project_status"), "status in ('active', 'closed')")
        batch.create_check_constraint(
            op.f("ck_project_date_range"),
            "start_date is null or end_date is null or end_date >= start_date",
        )


def downgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.drop_constraint(op.f("ck_project_date_range"), type_="check")
        batch.drop_constraint(op.f("ck_project_status"), type_="check")
    op.drop_column("project", "deleted_at")
    op.drop_column("project", "closed_at")
    op.drop_column("project", "status")
    op.drop_column("project", "end_date")
    op.drop_column("project", "start_date")
    op.drop_column("project", "description")

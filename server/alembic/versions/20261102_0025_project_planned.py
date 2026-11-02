"""프로젝트 상태에 준비(planned)를 더한다

Revision ID: 0025_project_planned
Revises: 0024_project_manage
Create Date: 2026-11-02

0024 는 이미 올라간 DB 가 있어 고치지 않고 CHECK 만 바꾼다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0025_project_planned"
down_revision: str | None = "0024_project_manage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("project") as batch:
        batch.drop_constraint(op.f("ck_project_status"), type_="check")
        batch.create_check_constraint(
            op.f("ck_project_status"), "status in ('planned', 'active', 'closed')"
        )


def downgrade() -> None:
    # 옛 CHECK 가 planned 를 못 받는다 — 진행으로 돌려 놓고 건다
    op.execute("UPDATE project SET status = 'active' WHERE status = 'planned'")
    with op.batch_alter_table("project") as batch:
        batch.drop_constraint(op.f("ck_project_status"), type_="check")
        batch.create_check_constraint(op.f("ck_project_status"), "status in ('active', 'closed')")

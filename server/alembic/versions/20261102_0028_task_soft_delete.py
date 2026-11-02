"""작업 논리 삭제 — is_deleted · deleted_at · deleted_by

Revision ID: 0028_task_soft_delete
Revises: 0027_task_creator
Create Date: 2026-11-02

있던 작업은 전부 살아 있는 것으로 시작한다(server_default false). 삭제는 세 칸을 찍기만 한다 —
본문 줄 · 댓글 · 링크 · 상태 기록 · 이력 · 테스트 참조는 남고 읽는 쪽이 거른다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0028_task_soft_delete"
down_revision: str | None = "0027_task_creator"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
LIVE = sa.text("not is_deleted")


def upgrade() -> None:
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    with op.batch_alter_table("task") as batch:
        batch.add_column(
            sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False)
        )
        batch.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("deleted_by", ID, nullable=True))
        batch.create_foreign_key(op.f("fk_task_deleted_by"), "member", ["deleted_by"], ["id"])
    op.create_index(
        "ix_task_project_id_live",
        "task",
        ["project_id", "seq"],
        postgresql_where=LIVE,
        sqlite_where=LIVE,
    )


def downgrade() -> None:
    # 지운 작업을 실제로 지우지 않는다 — 내리면 다시 보이지만, 되돌릴 수 없는 손실보다 낫다
    op.drop_index("ix_task_project_id_live", table_name="task")
    with op.batch_alter_table("task") as batch:
        batch.drop_constraint(op.f("fk_task_deleted_by"), type_="foreignkey")
        batch.drop_column("deleted_by")
        batch.drop_column("deleted_at")
        batch.drop_column("is_deleted")

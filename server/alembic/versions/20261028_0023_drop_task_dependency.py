"""선행 작업을 걷는다 — task_dependency (-)

Revision ID: 0023_drop_task_dependency
Revises: 0022_task_parent_back
Create Date: 2026-10-28

사용자 결정(Q63, Q49 를 뒤집음) — 선행 작업 기능을 통째로 걷는다. 걸려 있던 줄은 버린다.
작업 상태 기록(task_log)은 별개라 그대로 둔다. 지난 변경 이력의 `dependsOn` 줄도 그대로다.
downgrade 는 0015 가 만든 모양 그대로 빈 표를 되살린다 — 버린 줄은 돌아오지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0023_drop_task_dependency"
down_revision: str | None = "0022_task_parent_back"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.drop_index("ix_task_dependency_project_id", table_name="task_dependency")
    op.drop_index("ix_task_dependency_depends_on_id", table_name="task_dependency")
    op.drop_table("task_dependency")


def downgrade() -> None:
    op.create_table(
        "task_dependency",
        sa.Column("task_id", ID, nullable=False),
        sa.Column("depends_on_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("created_by", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.CheckConstraint("task_id <> depends_on_id", name=op.f("ck_task_dependency_not_self")),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_task_dependency_task_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["depends_on_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_task_dependency_depends_on_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["member.id"], name=op.f("fk_task_dependency_created_by")
        ),
        sa.PrimaryKeyConstraint("task_id", "depends_on_id", name=op.f("pk_task_dependency")),
    )
    op.create_index("ix_task_dependency_depends_on_id", "task_dependency", ["depends_on_id"])
    op.create_index("ix_task_dependency_project_id", "task_dependency", ["project_id"])

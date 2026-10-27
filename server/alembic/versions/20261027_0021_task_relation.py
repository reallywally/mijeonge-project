"""작업 계층을 걷고 연관 작업으로 — task_relation (+), task.parent_id (-)

Revision ID: 0021_task_relation
Revises: 0020_test_content
Create Date: 2026-10-27

사용자 결정(Q61, `docs/api/task-flow.md` '연관 작업') — 지난 상위 관계는 **하위 → 상위** 한 줄씩
옮긴다(하위 작업의 연관 작업이 예전 상위가 된다). 건 시각은 하위 작업의 등록 시각이다.
downgrade 는 열을 되살리고 연관 줄의 첫 것(건 순서)으로 채운다 — 서로 건 두 작업이면 고리가 될 수
있지만 되돌림은 개발용이라 그대로 둔다.

옮길 값을 먼저 읽어 두고 표를 고친다 — sqlite(검사)는 batch 가 task 를 다시 세우면서
FK cascade 로 걸린 줄을 지운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0021_task_relation"
down_revision: str | None = "0020_test_content"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)

_task = sa.table(
    "task",
    sa.column("id", ID),
    sa.column("project_id", ID),
    sa.column("parent_id", ID),
    sa.column("created_at", UTC_TS),
)
_relation = sa.table(
    "task_relation",
    sa.column("task_id", ID),
    sa.column("related_id", ID),
    sa.column("project_id", ID),
    sa.column("created_at", UTC_TS),
)


def upgrade() -> None:
    bind = op.get_bind()
    moved = [
        {
            "task_id": row.id,
            "related_id": row.parent_id,
            "project_id": row.project_id,
            "created_at": row.created_at,
        }
        for row in bind.execute(
            sa.select(_task.c.id, _task.c.parent_id, _task.c.project_id, _task.c.created_at)
            .where(_task.c.parent_id.is_not(None), _task.c.parent_id != _task.c.id)
            .order_by(_task.c.id)
        )
    ]

    op.drop_index("ix_task_parent_id", table_name="task")
    with op.batch_alter_table("task") as batch:
        batch.drop_constraint("fk_task_parent_id", type_="foreignkey")
        batch.drop_constraint(op.f("ck_task_parent_not_self"), type_="check")
        batch.drop_column("parent_id")

    op.create_table(
        "task_relation",
        sa.Column("task_id", ID, nullable=False),
        sa.Column("related_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.CheckConstraint("task_id <> related_id", name=op.f("ck_task_relation_not_self")),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_task_relation_task_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["related_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_task_relation_related_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("task_id", "related_id", name=op.f("pk_task_relation")),
    )
    op.create_index("ix_task_relation_related_id", "task_relation", ["related_id"])
    op.create_index("ix_task_relation_project_id", "task_relation", ["project_id"])
    if moved:
        op.bulk_insert(_relation, moved)


def downgrade() -> None:
    bind = op.get_bind()
    # 작업마다 건 순서의 첫 줄 하나가 상위가 된다
    first: dict[str, str] = {}
    for row in bind.execute(
        sa.select(_relation.c.task_id, _relation.c.related_id).order_by(
            _relation.c.task_id, _relation.c.created_at, _relation.c.related_id
        )
    ):
        first.setdefault(row.task_id, row.related_id)

    op.drop_index("ix_task_relation_project_id", table_name="task_relation")
    op.drop_index("ix_task_relation_related_id", table_name="task_relation")
    op.drop_table("task_relation")

    with op.batch_alter_table("task") as batch:
        batch.add_column(sa.Column("parent_id", ID, nullable=True))
        batch.create_check_constraint(
            op.f("ck_task_parent_not_self"), "parent_id is null or parent_id <> id"
        )
        batch.create_foreign_key(
            "fk_task_parent_id", "task", ["parent_id", "project_id"], ["id", "project_id"]
        )
    op.create_index("ix_task_parent_id", "task", ["parent_id"], unique=False)
    for task_id, parent_id in first.items():
        bind.execute(sa.update(_task).where(_task.c.id == task_id).values(parent_id=parent_id))

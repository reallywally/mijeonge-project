"""작업 계층을 되살린다 — task.parent_id (+), task_relation (-)

Revision ID: 0022_task_parent_back
Revises: 0021_task_relation
Create Date: 2026-10-28

사용자 결정(Q62, Q61 을 뒤집음) — 연관 작업을 걷고 테스트처럼 상위 · 하위로 되돌린다.
작업마다 건 순서의 첫 연관 줄이 상위가 된다(0021 이 옮긴 하위 → 상위 줄이 그대로 돌아온다).
상위를 따라 올라가 자기에게 닿으면(서로 건 두 작업 등) 그 줄은 버리고 최상위로 둔다.
나머지 연관 줄은 버린다.
downgrade 는 0021 의 upgrade 와 같다 — 상위 관계를 하위 → 상위 한 줄씩 연관 줄로 옮긴다.

옮길 값을 먼저 읽어 두고 표를 고친다 — sqlite(검사)는 batch 가 task 를 다시 세우면서
FK cascade 로 걸린 줄을 지운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0022_task_parent_back"
down_revision: str | None = "0021_task_relation"
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


def pick_parents(rows: Sequence[tuple[str, str]]) -> dict[str, str]:
    """(건 작업, 걸린 작업) 을 건 순서대로 받아 작업마다 첫 줄을 상위로. 고리가 되는 줄은 버린다."""
    parents: dict[str, str] = {}
    for task_id, related_id in rows:
        if task_id in parents:
            continue
        node: str | None = related_id
        while node is not None and node != task_id:
            node = parents.get(node)
        if node is None:
            parents[task_id] = related_id
    return parents


def upgrade() -> None:
    bind = op.get_bind()
    parents = pick_parents(
        [
            (row.task_id, row.related_id)
            for row in bind.execute(
                sa.select(_relation.c.task_id, _relation.c.related_id).order_by(
                    _relation.c.task_id, _relation.c.created_at, _relation.c.related_id
                )
            )
        ]
    )

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
    for task_id, parent_id in parents.items():
        bind.execute(sa.update(_task).where(_task.c.id == task_id).values(parent_id=parent_id))


def downgrade() -> None:
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

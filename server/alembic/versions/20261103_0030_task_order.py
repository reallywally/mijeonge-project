"""작업 순서 — 같은 상위 안에서의 순서(`task.sort_order`)

Revision ID: 0030_task_order
Revises: 0029_thread_perm
Create Date: 2026-11-03

계약은 `docs/api/snapshot.md` 'Task.order' · `API.md` `POST /api/tasks/{taskId}/move`.
있던 작업은 (project_id, parent_id) 묶음마다 등록 순(`seq`)으로 0, 1, 2… 를 채운다 —
지운 작업도 같이 센다(어디서도 안 나가니 빈자리가 생겨도 순서만 뜻이 있다).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0030_task_order"
down_revision: str | None = "0029_thread_perm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch 로 걸지 않는다 — sqlite(검사)에서 표를 다시 세우면 상위 작업을 가리키는 FK 가 걸린다.
    # 칸 하나 더하고 빼는 것은 sqlite 도 ALTER 로 한다
    op.add_column(
        "task", sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False)
    )

    task = sa.table(
        "task",
        sa.column("id", sa.String(36)),
        sa.column("project_id", sa.String(36)),
        sa.column("parent_id", sa.String(36)),
        sa.column("seq", sa.BigInteger()),
        sa.column("sort_order", sa.Integer()),
    )
    bind = op.get_bind()
    found = bind.execute(
        sa.select(task.c.id, task.c.project_id, task.c.parent_id).order_by(task.c.seq)
    )
    # 창 함수 대신 파이썬으로 센다 — sqlite · Postgres 가 같은 길로 간다
    counts: dict[tuple[str, str | None], int] = {}
    for row in found.all():
        group = (row.project_id, row.parent_id)
        order = counts.get(group, 0)
        counts[group] = order + 1
        if order:
            bind.execute(sa.update(task).where(task.c.id == row.id).values(sort_order=order))


def downgrade() -> None:
    op.drop_column("task", "sort_order")

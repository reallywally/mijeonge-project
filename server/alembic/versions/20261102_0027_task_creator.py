"""작업에 등록한 사람(creator_id)을 더한다

Revision ID: 0027_task_creator
Revises: 0026_member_no
Create Date: 2026-11-02

있는 작업은 남아 있는 기록으로 채운다 — 먼저 변경 이력의 '등록' 줄(0019 이후 등록한 작업),
없으면 상태 기록의 첫 줄(`from_status` 가 null, 0015 이후). 둘 다 backfill 줄은 누가 했는지
모르니 건너뛴다. 아무 기록이 없으면 null 로 둔다 — 그 작업은 담당자 · 관리자만 고친다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0027_task_creator"
down_revision: str | None = "0026_member_no"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    with op.batch_alter_table("task") as batch:
        batch.add_column(sa.Column("creator_id", ID, nullable=True))
        batch.create_foreign_key(op.f("fk_task_creator_id"), "member", ["creator_id"], ["id"])

    bind = op.get_bind()
    task = sa.table("task", sa.column("id", ID), sa.column("creator_id", ID))
    history = sa.table(
        "task_history",
        sa.column("task_id", ID),
        sa.column("changed_by", ID),
        sa.column("changes", sa.JSON()),
        sa.column("backfilled", sa.Boolean()),
        sa.column("seq", sa.BigInteger()),
    )
    log = sa.table(
        "task_log",
        sa.column("task_id", ID),
        sa.column("from_status", sa.String()),
        sa.column("changed_by", ID),
        sa.column("backfilled", sa.Boolean()),
        sa.column("seq", sa.BigInteger()),
    )

    creators: dict[str, str] = {}
    # 상태 기록이 먼저, 이력이 나중에 덮는다 — 이력의 '등록' 줄이 더 곧은 기록이다
    first_logs = bind.execute(
        sa.select(log.c.task_id, log.c.changed_by)
        .where(
            log.c.from_status.is_(None),
            log.c.backfilled.is_(False),
            log.c.changed_by.is_not(None),
        )
        .order_by(log.c.seq.desc())
    )
    for task_id, changed_by in first_logs.all():
        creators[task_id] = changed_by  # seq 내림차순이라 마지막에 남는 것이 첫 줄이다
    # changes 는 jsonb · JSON 이 갈라져 SQL 로 안 걸고 파이썬에서 '등록' 줄을 고른다
    created_rows = bind.execute(
        sa.select(history.c.task_id, history.c.changed_by, history.c.changes)
        .where(history.c.backfilled.is_(False), history.c.changed_by.is_not(None))
        .order_by(history.c.seq.desc())
    )
    from_history: dict[str, str] = {}
    for task_id, changed_by, changes in created_rows.all():
        if any(isinstance(c, dict) and c.get("field") == "created" for c in changes or []):
            from_history[task_id] = changed_by
    creators.update(from_history)

    for task_id, creator_id in creators.items():
        bind.execute(task.update().where(task.c.id == task_id).values(creator_id=creator_id))


def downgrade() -> None:
    with op.batch_alter_table("task") as batch:
        batch.drop_constraint(op.f("fk_task_creator_id"), type_="foreignkey")
        batch.drop_column("creator_id")

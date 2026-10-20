"""선행 작업 · 작업 상태 기록 — task_dependency, task_log (+ 지난 작업 backfill)

Revision ID: 0015_task_flow
Revises: 0014_minutes
Create Date: 2026-10-20

계약은 `docs/api/task-flow.md` · Q49 · Q50.
지난 작업마다 지금 상태로 한 줄을 등록 시각에 넣는다(`backfilled`) — 그보다 앞은 모른다.
리포트는 이 줄을 '적어도 이때부터' 로 읽는다.
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision: str = "0015_task_flow"
down_revision: str | None = "0014_minutes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
STATUSES = "('todo', 'doing', 'blocked', 'done')"


def upgrade() -> None:
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

    log = op.create_table(
        "task_log",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("task_id", ID, nullable=False),
        sa.Column("from_status", sa.String(length=16), nullable=True),
        sa.Column("to_status", sa.String(length=16), nullable=False),
        sa.Column("changed_by", ID, nullable=True),
        sa.Column("changed_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("backfilled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            f"from_status is null or from_status in {STATUSES}",
            name=op.f("ck_task_log_from_status"),
        ),
        sa.CheckConstraint(f"to_status in {STATUSES}", name=op.f("ck_task_log_to_status")),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_task_log_task_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["changed_by"], ["member.id"], name=op.f("fk_task_log_changed_by")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_log")),
        sa.UniqueConstraint("seq", name=op.f("uq_task_log_seq")),
    )
    op.create_index("ix_task_log_task_id_seq", "task_log", ["task_id", "seq"])

    # 등록 순서(task.seq)대로 넣는다 — seq 가 그 순서로 붙는다. id 는 앱과 같은 uuid4 hex
    # 열 타입을 적어 읽는다 — sqlite(test_task_flow)에서도 created_at 이 datetime 으로 온다
    task = sa.table(
        "task",
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("status", sa.String()),
        sa.column("created_at", UTC_TS),
        sa.column("seq", sa.BigInteger()),
    )
    tasks = op.get_bind().execute(
        sa.select(task.c.id, task.c.project_id, task.c.status, task.c.created_at).order_by(
            task.c.seq
        )
    )
    rows = [
        {
            "id": uuid4().hex,
            "project_id": row.project_id,
            "task_id": row.id,
            "from_status": None,
            "to_status": row.status,
            "changed_by": None,
            "changed_at": row.created_at,
            "backfilled": True,
            # 번호를 직접 준다 — sqlite 는 Identity 를 모른다. Postgres 는 아래서 시퀀스를 민다
            "seq": number,
        }
        for number, row in enumerate(tasks, start=1)
    ]
    if rows:
        op.bulk_insert(log, rows)
    if op.get_bind().dialect.name == "postgresql":
        # 빈 테이블이면 is_called=false — 다음 줄이 1 번이다 (scripts/seed.py 의 advance_identity)
        op.execute(
            "select setval(pg_get_serial_sequence('task_log', 'seq'),"
            " coalesce((select max(seq) from task_log), 1),"
            " (select count(*) from task_log) > 0)"
        )


def downgrade() -> None:
    op.drop_index("ix_task_log_task_id_seq", table_name="task_log")
    op.drop_table("task_log")
    op.drop_index("ix_task_dependency_project_id", table_name="task_dependency")
    op.drop_index("ix_task_dependency_depends_on_id", table_name="task_dependency")
    op.drop_table("task_dependency")

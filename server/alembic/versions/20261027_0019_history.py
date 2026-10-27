"""작업 · 테스트 변경 이력 — task_history, test_history (+ 지난 것마다 등록 한 줄 backfill)

Revision ID: 0019_history
Revises: 0018_test_drop_level
Create Date: 2026-10-27

계약은 `docs/api/history.md` · Q59.
지난 작업 · 테스트마다 '등록' 한 줄을 등록 시각에 넣는다(`backfilled`, 바꾼 사람 없음) —
그보다 앞은 모른다. 작업은 task.seq, 테스트는 test_case.seq 순으로 넣어
이력 seq 가 그 순서로 붙는다.
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0019_history"
down_revision: str | None = "0018_test_drop_level"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
CHANGES = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
# 계약의 '등록' 칸 — 늘 그 줄의 유일한 칸
CREATED = [{"field": "created", "from": None, "to": None, "subject": ""}]


def _create(table: str, owner_col: str, owner_table: str) -> sa.Table:
    return op.create_table(
        table,
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column(owner_col, ID, nullable=False),
        sa.Column("changed_by", ID, nullable=True),
        sa.Column("changed_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("changes", CHANGES, nullable=False),
        sa.Column("backfilled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            [owner_col, "project_id"],
            [f"{owner_table}.id", f"{owner_table}.project_id"],
            name=op.f(f"fk_{table}_{owner_col}"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["changed_by"], ["member.id"], name=op.f(f"fk_{table}_changed_by")),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table}")),
        sa.UniqueConstraint("seq", name=op.f(f"uq_{table}_seq")),
    )


def _backfill(history: sa.Table, owner_col: str, owner_table: str) -> None:
    # 열 타입을 적어 읽는다 — sqlite(검사)에서도 created_at 이 datetime 으로 온다
    owner = sa.table(
        owner_table,
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("created_at", UTC_TS),
        sa.column("seq", sa.BigInteger()),
    )
    found = op.get_bind().execute(
        sa.select(owner.c.id, owner.c.project_id, owner.c.created_at).order_by(owner.c.seq)
    )
    rows = [
        {
            "id": uuid4().hex,
            "project_id": row.project_id,
            owner_col: row.id,
            "changed_by": None,
            "changed_at": row.created_at,
            "changes": CREATED,
            "backfilled": True,
            # 번호를 직접 준다 — sqlite 는 Identity 를 모른다. Postgres 는 아래서 시퀀스를 민다
            "seq": number,
        }
        for number, row in enumerate(found, start=1)
    ]
    if rows:
        op.bulk_insert(history, rows)
    if op.get_bind().dialect.name == "postgresql":
        # 빈 테이블이면 is_called=false — 다음 줄이 1 번이다 (scripts/seed.py 의 advance_identity)
        op.execute(
            f"select setval(pg_get_serial_sequence('{history.name}', 'seq'),"
            f" coalesce((select max(seq) from {history.name}), 1),"
            f" (select count(*) from {history.name}) > 0)"
        )


def upgrade() -> None:
    task_history = _create("task_history", "task_id", "task")
    op.create_index("ix_task_history_task_id_seq", "task_history", ["task_id", "seq"])
    test_history = _create("test_history", "test_id", "test_case")
    op.create_index("ix_test_history_test_id_seq", "test_history", ["test_id", "seq"])

    _backfill(task_history, "task_id", "task")
    _backfill(test_history, "test_id", "test_case")


def downgrade() -> None:
    op.drop_index("ix_test_history_test_id_seq", table_name="test_history")
    op.drop_table("test_history")
    op.drop_index("ix_task_history_task_id_seq", table_name="task_history")
    op.drop_table("task_history")

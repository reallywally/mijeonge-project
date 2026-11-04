"""결정 항목 — 안건 안에서 따로 정하는 것(`decision_item`) · 이력 줄의 항목(`entry.item_id`)

Revision ID: 0031_decision_item
Revises: 0030_task_order
Create Date: 2026-11-03

계약은 `API.md` '결정 항목' · `docs/api/snapshot.md` 'DecisionItem' · 결정 로그 2026-11-03.
지난 데이터 — 지우지 않은 안건 중 decide · change · refine 줄이 있는 안건마다 항목 하나
(제목 = 안건 제목, 시각 = 그 줄들 중 가장 이른 것, 등록한 사람 없음)를 만들고 그 줄(지운 줄 포함)을
그 항목에 단다. defer · raise · split 은 null 로 둔다 — 지난 안건의 상태 · 지금 결정이 그대로다.
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision: str = "0031_decision_item"
down_revision: str | None = "0030_task_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
LIVE = sa.text("not is_deleted")
ITEM_KINDS = ("decide", "change", "refine")


def upgrade() -> None:
    items = op.create_table(
        "decision_item",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("creator_id", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", UTC_TS, nullable=True),
        sa.Column("deleted_by", ID, nullable=True),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_decision_item_thread_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["creator_id"], ["member.id"], name=op.f("fk_decision_item_creator_id")
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["member.id"], name=op.f("fk_decision_item_deleted_by")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_decision_item")),
        sa.UniqueConstraint("id", "thread_id", name=op.f("uq_decision_item_id_thread_id")),
        sa.UniqueConstraint("seq", name=op.f("uq_decision_item_seq")),
    )
    op.create_index(
        "ix_decision_item_thread_id_live",
        "decision_item",
        ["thread_id", "sort_order"],
        postgresql_where=LIVE,
        sqlite_where=LIVE,
    )
    op.create_index(
        "ix_decision_item_title_trgm",
        "decision_item",
        ["title"],
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )

    # sqlite(검사)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    with op.batch_alter_table("entry") as batch:
        batch.add_column(sa.Column("item_id", ID, nullable=True))
        batch.create_index(batch.f("ix_entry_item_id"), ["item_id"])
        batch.create_foreign_key(
            batch.f("fk_entry_item_id"),
            "decision_item",
            ["item_id", "thread_id"],
            ["id", "thread_id"],
        )

    _backfill(items)


def _backfill(items: sa.Table) -> None:
    bind = op.get_bind()
    # 열 타입을 적어 읽는다 — sqlite(검사)에서도 created_at 이 datetime 으로 온다
    thread = sa.table(
        "thread",
        sa.column("id", ID),
        sa.column("project_id", ID),
        sa.column("title", sa.Text()),
        sa.column("seq", sa.BigInteger()),
        sa.column("is_deleted", sa.Boolean()),
    )
    entry = sa.table(
        "entry",
        sa.column("id", ID),
        sa.column("thread_id", ID),
        sa.column("kind", sa.String(16)),
        sa.column("created_at", UTC_TS),
        sa.column("item_id", ID),
    )
    found = bind.execute(
        sa.select(thread.c.id, thread.c.project_id, thread.c.title, sa.func.min(entry.c.created_at))
        .join(entry, entry.c.thread_id == thread.c.id)
        .where(thread.c.is_deleted.is_(False), entry.c.kind.in_(ITEM_KINDS))
        .group_by(thread.c.id, thread.c.project_id, thread.c.title, thread.c.seq)
        .order_by(thread.c.seq)
    ).all()
    rows: list[dict[str, object]] = []
    for number, (thread_id, project_id, title, first_at) in enumerate(found, start=1):
        rows.append(
            {
                "id": uuid4().hex,
                "project_id": project_id,
                "thread_id": thread_id,
                "title": title,
                "creator_id": None,
                "created_at": first_at,
                "sort_order": 0,
                # 번호를 직접 준다 — sqlite 는 Identity 를 모른다. Postgres 는 아래서 시퀀스를 민다
                "seq": number,
                "is_deleted": False,
            }
        )
    if rows:
        op.bulk_insert(items, rows)
        for row in rows:
            bind.execute(
                sa.update(entry)
                .where(entry.c.thread_id == row["thread_id"], entry.c.kind.in_(ITEM_KINDS))
                .values(item_id=row["id"])
            )
    if bind.dialect.name == "postgresql":
        # 빈 테이블이면 is_called=false — 다음 줄이 1 번이다
        op.execute(
            "select setval(pg_get_serial_sequence('decision_item', 'seq'),"
            " coalesce((select max(seq) from decision_item), 1),"
            " (select count(*) from decision_item) > 0)"
        )


def downgrade() -> None:
    # 항목을 거두면 여러 항목의 결정이 안건 하나에 섞인다 — 상태는 다시 세지 않는다
    with op.batch_alter_table("entry") as batch:
        batch.drop_constraint(batch.f("fk_entry_item_id"), type_="foreignkey")
        batch.drop_index(batch.f("ix_entry_item_id"))
        batch.drop_column("item_id")
    op.drop_index("ix_decision_item_title_trgm", table_name="decision_item")
    op.drop_index("ix_decision_item_thread_id_live", table_name="decision_item")
    op.drop_table("decision_item")

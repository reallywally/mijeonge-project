"""확인 요청을 결정 알림으로 — check_request 를 다시 세우고 thread_cc 를 더한다

Revision ID: 0013_check_on_decision
Revises: 0012_check_request
Create Date: 2026-10-19

계약은 `docs/api/check.md`(2026-10-19 고침) · Q42 ~ Q44.
`task_id` · `text` 를 걷고 `entry_id` 를 더한다. **있던 줄은 지운다**(시드가 다시 넣는다) —
작업 줄은 걸 데가 없고, 안건 줄은 어느 결정에 묶을지 모른다. 줄을 살리지 않으니 ALTER 대신
테이블을 지우고 새로 세운다. downgrade 도 같다 — 옛 모양의 빈 테이블로 돌아간다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013_check_on_decision"
down_revision: str | None = "0012_check_request"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
# 0012 의 CHECK_TEXT_MAX — downgrade 가 옛 모양을 그대로 세운다
OLD_TEXT_MAX = 29


def _loads() -> list[sa.Column[int]]:
    return [
        sa.Column("load_open_tasks", sa.Integer(), nullable=False),
        sa.Column("load_blocked_tasks", sa.Integer(), nullable=False),
        sa.Column("load_due_soon_tasks", sa.Integer(), nullable=False),
        sa.Column("load_open_threads", sa.Integer(), nullable=False),
    ]


def _create_indexes() -> None:
    op.create_index("ix_check_request_project_id_seq", "check_request", ["project_id", "seq"])
    op.create_index(
        "ix_check_request_recipient_id_confirmed_at",
        "check_request",
        ["recipient_id", "confirmed_at"],
    )


def _drop_check_request() -> None:
    op.drop_index("ix_check_request_recipient_id_confirmed_at", table_name="check_request")
    op.drop_index("ix_check_request_project_id_seq", table_name="check_request")
    op.drop_table("check_request")


def upgrade() -> None:
    _drop_check_request()
    op.create_table(
        "check_request",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("entry_id", ID, nullable=False),
        sa.Column("sender_id", ID, nullable=False),
        sa.Column("recipient_id", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("confirmed_at", UTC_TS, nullable=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        *_loads(),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_check_request_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_check_request_thread_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["entry.id"],
            name=op.f("fk_check_request_entry_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"], ["member.id"], name=op.f("fk_check_request_sender_id")
        ),
        sa.ForeignKeyConstraint(
            ["recipient_id"], ["member.id"], name=op.f("fk_check_request_recipient_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_check_request")),
        sa.UniqueConstraint("seq", name=op.f("uq_check_request_seq")),
        sa.UniqueConstraint(
            "entry_id", "recipient_id", name=op.f("uq_check_request_entry_id_recipient_id")
        ),
    )
    _create_indexes()

    op.create_table(
        "thread_cc",
        sa.Column("thread_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_thread_cc_thread_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["member_id"], ["member.id"], name=op.f("fk_thread_cc_member_id")),
        sa.PrimaryKeyConstraint("thread_id", "member_id", name=op.f("pk_thread_cc")),
    )


def downgrade() -> None:
    op.drop_table("thread_cc")
    _drop_check_request()
    op.create_table(
        "check_request",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("task_id", ID, nullable=True),
        sa.Column("thread_id", ID, nullable=True),
        sa.Column("sender_id", ID, nullable=False),
        sa.Column("recipient_id", ID, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("confirmed_at", UTC_TS, nullable=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        *_loads(),
        sa.CheckConstraint(
            "(task_id is null) <> (thread_id is null)",
            name=op.f("ck_check_request_one_target"),
        ),
        sa.CheckConstraint(
            f"length(text) between 1 and {OLD_TEXT_MAX}",
            name=op.f("ck_check_request_text_length"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_check_request_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_check_request_task_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_check_request_thread_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"], ["member.id"], name=op.f("fk_check_request_sender_id")
        ),
        sa.ForeignKeyConstraint(
            ["recipient_id"], ["member.id"], name=op.f("fk_check_request_recipient_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_check_request")),
        sa.UniqueConstraint("seq", name=op.f("uq_check_request_seq")),
    )
    _create_indexes()

"""확인 요청 — check_request

Revision ID: 0012_check_request
Revises: 0011_risk_setting
Create Date: 2026-10-16

계약은 `docs/api/check.md` 의 '테이블' 이다.
작업이나 안건 하나에 꼭 붙고, 받는 사람 하나에 줄 하나다.
복합 FK 가 볼 `unique(id, project_id)` 는 `task` · `thread` 둘 다 이미 있다.
부하 네 칸은 보낼 때 찍는다 — 기존 데이터가 없어 기본값을 두지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_check_request"
down_revision: str | None = "0011_risk_setting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
# 모델(app/models/check.py)의 CHECK_TEXT_MAX 와 같다 — 리비전은 그때의 값을 박아 둔다
TEXT_MAX = 29


def upgrade() -> None:
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
        sa.Column("load_open_tasks", sa.Integer(), nullable=False),
        sa.Column("load_blocked_tasks", sa.Integer(), nullable=False),
        sa.Column("load_due_soon_tasks", sa.Integer(), nullable=False),
        sa.Column("load_open_threads", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(task_id is null) <> (thread_id is null)",
            name=op.f("ck_check_request_one_target"),
        ),
        sa.CheckConstraint(
            f"length(text) between 1 and {TEXT_MAX}", name=op.f("ck_check_request_text_length")
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
    op.create_index("ix_check_request_project_id_seq", "check_request", ["project_id", "seq"])
    op.create_index(
        "ix_check_request_recipient_id_confirmed_at",
        "check_request",
        ["recipient_id", "confirmed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_check_request_recipient_id_confirmed_at", table_name="check_request")
    op.drop_index("ix_check_request_project_id_seq", table_name="check_request")
    op.drop_table("check_request")

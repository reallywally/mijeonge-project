"""테스트 — project.next_test_no · test_case · test_step · test_ref

Revision ID: 0017_test_case
Revises: 0016_project_report
Create Date: 2026-10-27

계약은 `docs/api/test.md`(1단계, AI 없이). 테스트가 아직 없어 백필할 것이 없다 —
`next_test_no` 는 1 에서 시작한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0017_test_case"
down_revision: str | None = "0016_project_report"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
# 모델(app/models/test.py)의 값 — 리비전은 그때의 값을 박아 둔다
STATUSES = ("draft", "ready", "testing", "pass", "fail", "blocked")
LEVELS = ("functional", "integration", "acceptance")


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("next_test_no", sa.Integer(), server_default="1", nullable=False),
    )

    op.create_table(
        "test_case",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("key", sa.String(length=32), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("purpose", sa.Text(), server_default="", nullable=False),
        sa.Column("precondition", sa.Text(), server_default="", nullable=False),
        sa.Column("test_data", sa.Text(), server_default="", nullable=False),
        sa.Column("parent_id", ID, nullable=True),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("status_changed_at", UTC_TS, nullable=False),
        sa.Column("status_changed_by", ID, nullable=True),
        sa.Column("failed_step", sa.Integer(), nullable=True),
        sa.Column("result_note", sa.Text(), server_default="", nullable=False),
        sa.Column("level", sa.String(length=16), nullable=True),
        sa.Column("start", sa.Date(), nullable=True),
        sa.Column("due", sa.Date(), nullable=True),
        sa.Column("owner_id", ID, nullable=True),
        sa.Column("part_id", ID, nullable=True),
        sa.Column("basis_seq", sa.BigInteger(), nullable=True),
        sa.Column("created_by", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.CheckConstraint(f"status in {STATUSES}", name=op.f("ck_test_case_status")),
        sa.CheckConstraint(f"level is null or level in {LEVELS}", name=op.f("ck_test_case_level")),
        sa.CheckConstraint(
            "parent_id is null or parent_id <> id", name=op.f("ck_test_case_parent_not_self")
        ),
        sa.CheckConstraint(
            "failed_step is null or (status = 'fail' and failed_step >= 1)",
            name=op.f("ck_test_case_failed_step"),
        ),
        sa.CheckConstraint(
            "result_note = '' or status in ('fail', 'blocked')",
            name=op.f("ck_test_case_result_note"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_test_case_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            name=op.f("fk_test_case_parent_id"),
        ),
        sa.ForeignKeyConstraint(
            ["part_id", "project_id"],
            ["part.id", "part.project_id"],
            name=op.f("fk_test_case_part_id"),
        ),
        sa.ForeignKeyConstraint(
            ["status_changed_by"], ["member.id"], name=op.f("fk_test_case_status_changed_by")
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["member.id"], name=op.f("fk_test_case_owner_id")),
        sa.ForeignKeyConstraint(
            ["created_by"], ["member.id"], name=op.f("fk_test_case_created_by")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_case")),
        sa.UniqueConstraint("seq", name=op.f("uq_test_case_seq")),
        sa.UniqueConstraint("project_id", "key", name=op.f("uq_test_case_project_id_key")),
        sa.UniqueConstraint("id", "project_id", name=op.f("uq_test_case_id_project_id")),
    )
    op.create_index("ix_test_case_project_id_seq", "test_case", ["project_id", "seq"])

    op.create_table(
        "test_step",
        sa.Column("id", ID, nullable=False),
        sa.Column("test_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), server_default="", nullable=False),
        sa.ForeignKeyConstraint(
            ["test_id"],
            ["test_case.id"],
            name=op.f("fk_test_step_test_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_step")),
        sa.UniqueConstraint("test_id", "sort_order", name=op.f("uq_test_step_test_id_sort_order")),
    )

    op.create_table(
        "test_ref",
        sa.Column("id", ID, nullable=False),
        sa.Column("test_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("task_id", ID, nullable=True),
        sa.Column("thread_id", ID, nullable=True),
        sa.CheckConstraint(
            "(task_id is null) <> (thread_id is null)", name=op.f("ck_test_ref_one_target")
        ),
        sa.ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            name=op.f("fk_test_ref_test_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name=op.f("fk_test_ref_task_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["thread_id", "project_id"],
            ["thread.id", "thread.project_id"],
            name=op.f("fk_test_ref_thread_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_ref")),
        sa.UniqueConstraint("test_id", "task_id", name=op.f("uq_test_ref_test_id_task_id")),
        sa.UniqueConstraint("test_id", "thread_id", name=op.f("uq_test_ref_test_id_thread_id")),
    )


def downgrade() -> None:
    op.drop_table("test_ref")
    op.drop_table("test_step")
    op.drop_index("ix_test_case_project_id_seq", table_name="test_case")
    op.drop_table("test_case")
    op.drop_column("project", "next_test_no")

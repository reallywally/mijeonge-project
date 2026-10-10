"""회의를 걷어낸다 — 안건과 그 이력(Entry)만 남긴다

Revision ID: 0005_drop_meeting
Revises: 0004_thread_context
Create Date: 2026-10-11

회의를 관리하는 것은 '일을 위한 일'이라 뺀다. 결정이 미뤄지는 것을 막고 기록을 남기는 일은
안건 이력이 혼자 한다. 테이블 넷과 `entry.meeting_id` 를 지운다.

downgrade 는 빈 테이블과 null 열만 되살린다 — 지운 회의 데이터는 돌아오지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_drop_meeting"
down_revision: str | None = "0004_thread_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    # 회의를 가리키는 쪽부터 지운다
    op.drop_table("meeting_task_link")
    op.drop_table("meeting_memo")
    op.drop_table("meeting_attendee")

    op.drop_index("ix_entry_meeting_id", table_name="entry")
    with op.batch_alter_table("entry") as batch:
        batch.drop_constraint("fk_entry_meeting_id", type_="foreignkey")
        batch.drop_column("meeting_id")

    op.drop_index("ix_meeting_project_id_date", table_name="meeting")
    op.drop_table("meeting")


def downgrade() -> None:
    op.create_table(
        "meeting",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name="fk_meeting_project_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_meeting"),
        sa.UniqueConstraint("seq", name="uq_meeting_seq"),
        sa.UniqueConstraint("id", "project_id", name="uq_meeting_id_project_id"),
    )
    op.create_index("ix_meeting_project_id_date", "meeting", ["project_id", "date"], unique=False)

    with op.batch_alter_table("entry") as batch:
        batch.add_column(sa.Column("meeting_id", ID, nullable=True))
        batch.create_foreign_key(
            "fk_entry_meeting_id", "meeting", ["meeting_id"], ["id"], ondelete="CASCADE"
        )
    op.create_index("ix_entry_meeting_id", "entry", ["meeting_id"], unique=False)

    op.create_table(
        "meeting_attendee",
        sa.Column("meeting_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.ForeignKeyConstraint(
            ["meeting_id"],
            ["meeting.id"],
            name="fk_meeting_attendee_meeting_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["member.id"],
            name="fk_meeting_attendee_member_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("meeting_id", "member_id", name="pk_meeting_attendee"),
    )
    op.create_table(
        "meeting_memo",
        sa.Column("id", ID, nullable=False),
        sa.Column("meeting_id", ID, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("promoted_thread_id", ID, nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_memo_meeting_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["promoted_thread_id"], ["thread.id"], name="fk_meeting_memo_promoted_thread_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_meeting_memo"),
    )
    op.create_table(
        "meeting_task_link",
        sa.Column("meeting_id", ID, nullable=False),
        sa.Column("task_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.ForeignKeyConstraint(
            ["meeting_id", "project_id"],
            ["meeting.id", "meeting.project_id"],
            name="fk_meeting_task_link_meeting_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["task.id", "task.project_id"],
            name="fk_meeting_task_link_task_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("meeting_id", "task_id", name="pk_meeting_task_link"),
    )

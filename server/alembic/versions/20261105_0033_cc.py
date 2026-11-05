"""참조(cc) — 안건 · 테스트의 `ccIds`

Revision ID: 0033_cc
Revises: 0032_agenda
Create Date: 2026-11-05

계약은 `docs/api/cc.md`. 빈 표 둘을 세운다 — 있던 안건 · 테스트는 참조 없이(`[]`) 시작한다.
0032 가 지운 `thread_cc` 의 줄은 되살리지 못한다(그때 지웠다).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0033_cc"
down_revision: str | None = "0032_agenda"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def upgrade() -> None:
    op.create_table(
        "agenda_cc",
        sa.Column("agenda_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agenda_id", "project_id"],
            ["agenda.id", "agenda.project_id"],
            name=op.f("fk_agenda_cc_agenda_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["member_id"], ["member.id"], name=op.f("fk_agenda_cc_member_id")),
        sa.PrimaryKeyConstraint("agenda_id", "member_id", name=op.f("pk_agenda_cc")),
    )
    op.create_table(
        "test_cc",
        sa.Column("test_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["member.id"], name=op.f("fk_test_cc_member_id")),
        sa.ForeignKeyConstraint(
            ["test_id", "project_id"],
            ["test_case.id", "test_case.project_id"],
            name=op.f("fk_test_cc_test_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("test_id", "member_id", name=op.f("pk_test_cc")),
    )


def downgrade() -> None:
    # 참조 줄은 옮길 곳이 없어 같이 지운다
    op.drop_table("test_cc")
    op.drop_table("agenda_cc")

"""파트 — part · part_member, 작업 · 안건의 part_id

Revision ID: 0009_part
Revises: 0008_auth
Create Date: 2026-10-14

계약은 `docs/api/part.md` 의 '테이블' 이다. 파트는 보기 범위지 권한이 아니다.

- 작업 · 안건의 `part_id` 는 부모 · 링크와 같은 복합 FK `(part_id, project_id)` 다 —
  다른 프로젝트의 파트를 달 수 없다. 그래서 `part` 에 `(id, project_id)` 유니크를 먼저 세운다
- 기존 작업 · 안건은 `null`(프로젝트 공통)로 시작한다
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_part"
down_revision: str | None = "0008_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "part",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name=op.f("fk_part_project_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_part")),
        sa.UniqueConstraint("id", "project_id", name=op.f("uq_part_id_project_id")),
        sa.UniqueConstraint("project_id", "name", name=op.f("uq_part_project_id_name")),
    )
    op.create_table(
        "part_member",
        sa.Column("part_id", ID, nullable=False),
        sa.Column("member_id", ID, nullable=False),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["member_id"], ["member.id"], name=op.f("fk_part_member_member_id")
        ),
        sa.ForeignKeyConstraint(
            ["part_id"], ["part.id"], name=op.f("fk_part_member_part_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("part_id", "member_id", name=op.f("pk_part_member")),
    )
    op.create_index("ix_part_member_member_id", "part_member", ["member_id"])

    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    for table in ("task", "thread"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("part_id", ID, nullable=True))
            batch.create_foreign_key(
                f"fk_{table}_part_id", "part", ["part_id", "project_id"], ["id", "project_id"]
            )


def downgrade() -> None:
    for table in ("thread", "task"):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_part_id", type_="foreignkey")
            batch.drop_column("part_id")
    op.drop_index("ix_part_member_member_id", table_name="part_member")
    op.drop_table("part_member")
    op.drop_table("part")

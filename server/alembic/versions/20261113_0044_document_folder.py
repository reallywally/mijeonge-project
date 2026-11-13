"""문서 폴더 — document_folder · document.folder_id

Revision ID: 0044_document_folder
Revises: 0043_document_sheet_header
Create Date: 2026-11-13

계약은 `docs/api/document.md` '폴더'. 있던 문서는 모두 맨 위(`folder_id` null) — 값을 옮기지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0044_document_folder"
down_revision: str | None = "0043_document_sheet_header"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "document_folder",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("parent_id", ID, nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_by", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("updated_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_document_folder_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "project_id"],
            ["document_folder.id", "document_folder.project_id"],
            name=op.f("fk_document_folder_parent_id"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["member.id"], name=op.f("fk_document_folder_created_by")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_folder")),
        sa.UniqueConstraint("seq", name=op.f("uq_document_folder_seq")),
        sa.UniqueConstraint("id", "project_id", name=op.f("uq_document_folder_id_project_id")),
    )
    op.create_index("ix_document_folder_project_id", "document_folder", ["project_id"])

    # sqlite(test_schema)에서도 돌게 batch 로 건다 — sqlite 는 FK 를 ALTER 로 못 더한다
    with op.batch_alter_table("document") as batch:
        batch.add_column(sa.Column("folder_id", ID, nullable=True))
        batch.create_foreign_key(
            "fk_document_folder_id",
            "document_folder",
            ["folder_id", "project_id"],
            ["id", "project_id"],
        )
    op.create_index("ix_document_folder_id", "document", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_document_folder_id", table_name="document")
    with op.batch_alter_table("document") as batch:
        batch.drop_constraint("fk_document_folder_id", type_="foreignkey")
        batch.drop_column("folder_id")
    op.drop_index("ix_document_folder_project_id", table_name="document_folder")
    op.drop_table("document_folder")

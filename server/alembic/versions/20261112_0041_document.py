"""문서 — document · document_agenda

Revision ID: 0041_document
Revises: 0040_part_rights
Create Date: 2026-11-12

계약은 `docs/api/document.md`. 새 테이블 둘뿐이라 지난 데이터는 건드리지 않는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0041_document"
down_revision: str | None = "0040_part_rights"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)
UTC_TS = sa.DateTime(timezone=True)
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
KINDS = ("text", "sheet")


def upgrade() -> None:
    op.create_table(
        "document",
        sa.Column("id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("sheet", JSON_TYPE, nullable=False),
        sa.Column("part_id", ID, nullable=True),
        sa.Column("rev", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_by", ID, nullable=True),
        sa.Column("created_at", UTC_TS, nullable=False),
        sa.Column("updated_by", ID, nullable=True),
        sa.Column("updated_at", UTC_TS, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.CheckConstraint(f"kind in {KINDS}", name=op.f("ck_document_kind")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_document_project_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["part_id", "project_id"],
            ["part.id", "part.project_id"],
            name=op.f("fk_document_part_id"),
        ),
        sa.ForeignKeyConstraint(["created_by"], ["member.id"], name=op.f("fk_document_created_by")),
        sa.ForeignKeyConstraint(["updated_by"], ["member.id"], name=op.f("fk_document_updated_by")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document")),
        sa.UniqueConstraint("seq", name=op.f("uq_document_seq")),
        sa.UniqueConstraint("id", "project_id", name=op.f("uq_document_id_project_id")),
    )
    op.create_index("ix_document_project_id_updated_at", "document", ["project_id", "updated_at"])
    op.create_table(
        "document_agenda",
        sa.Column("document_id", ID, nullable=False),
        sa.Column("agenda_id", ID, nullable=False),
        sa.Column("project_id", ID, nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("seen_rev", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id", "project_id"],
            ["document.id", "document.project_id"],
            name=op.f("fk_document_agenda_document_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["agenda_id", "project_id"],
            ["agenda.id", "agenda.project_id"],
            name=op.f("fk_document_agenda_agenda_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("document_id", "agenda_id", name=op.f("pk_document_agenda")),
    )
    op.create_index("ix_document_agenda_agenda_id", "document_agenda", ["agenda_id"])


def downgrade() -> None:
    op.drop_index("ix_document_agenda_agenda_id", table_name="document_agenda")
    op.drop_table("document_agenda")
    op.drop_index("ix_document_project_id_updated_at", table_name="document")
    op.drop_table("document")

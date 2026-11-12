"""파트 권한 — part_member 의 보기 · 등록 · 수정 · 삭제

Revision ID: 0040_part_rights
Revises: 0039_agenda_impact
Create Date: 2026-11-12

계약은 `docs/api/part.md` '파트 권한 (2026-11-12)'. 있던 소속은 넷 다 켠다 — 지금 하던 일이
그대로 되게. 새 소속의 기본값(삭제는 끔)은 서비스가 정하고, 열의 기본값도 그에 맞춘다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0040_part_rights"
down_revision: str | None = "0039_agenda_impact"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLAGS = (
    ("can_view", "true"),
    ("can_create", "true"),
    ("can_update", "true"),
    ("can_delete", "false"),
)


def upgrade() -> None:
    for name, default in FLAGS:
        op.add_column(
            "part_member",
            sa.Column(name, sa.Boolean(), server_default=sa.text(default), nullable=False),
        )
    # 삭제만 기본이 끔이다 — 있던 소속은 켜서 지금 되던 지우기를 막지 않는다
    op.execute(sa.text("update part_member set can_delete = true"))


def downgrade() -> None:
    with op.batch_alter_table("part_member") as batch:
        for name, _ in reversed(FLAGS):
            batch.drop_column(name)

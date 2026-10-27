"""테스트의 레벨을 걷는다 — test_case.level

Revision ID: 0018_test_drop_level
Revises: 0017_test_case
Create Date: 2026-10-27

사용자 결정(2026-10-27, `docs/api/test.md` 맨 위 '고침') — 화면 · API · DB 에서 레벨을 뺀다.
이미 적힌 레벨 값은 버린다. downgrade 는 열을 null 가능으로 되살릴 뿐 값은 돌아오지 않는다.
batch 로 감싼다 — sqlite(검사)는 CHECK 가 걸린 열을 ALTER 로 못 지워 표를 다시 세운다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0018_test_drop_level"
down_revision: str | None = "0017_test_case"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 0017 의 값 — 되살릴 때 쓴다
LEVELS = ("functional", "integration", "acceptance")


def upgrade() -> None:
    with op.batch_alter_table("test_case") as batch:
        batch.drop_constraint(op.f("ck_test_case_level"), type_="check")
        batch.drop_column("level")


def downgrade() -> None:
    with op.batch_alter_table("test_case") as batch:
        batch.add_column(sa.Column("level", sa.String(length=16), nullable=True))
        batch.create_check_constraint(
            op.f("ck_test_case_level"), f"level is null or level in {LEVELS}"
        )

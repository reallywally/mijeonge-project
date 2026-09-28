"""작업 번호 발번 — project.last_task_no

Revision ID: 0002_task_no
Revises: 0001_initial
Create Date: 2026-09-28

`HW-22` 의 22 를 어디서 세는지. 최댓값+1 로 세면 지운 뒤 번호가 재사용되고 동시 등록에 진다 —
프로젝트 행에 "마지막으로 써 버린 번호"를 두고 update ... returning 한 문장으로 올려 뽑는다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_task_no"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("last_task_no", sa.Integer(), server_default="0", nullable=False),
    )
    # 작업이 이미 있는 DB 는 0 으로 두면 다음 발번이 HW-1 이라 uq_task_project_id_key 에 부딪힌다 —
    # 기존 key 의 숫자부 최댓값으로 채운다. split_part 는 Postgres 것이고,
    # sqlite 로 리비전을 얹어 보는 tests/test_schema.py 는 빈 DB 라 채울 것도 없다
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "update project set last_task_no = coalesce("
            "(select max(cast(split_part(task.key, '-', 2) as integer))"
            " from task where task.project_id = project.id), 0)"
        )


def downgrade() -> None:
    op.drop_column("project", "last_task_no")

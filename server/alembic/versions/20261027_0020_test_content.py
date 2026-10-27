"""테스트 내용으로 합친다 — test_case.content (+), purpose · precondition · failed_step · test_step

Revision ID: 0020_test_content
Revises: 0019_history
Create Date: 2026-10-27

사용자 결정(Q60, `docs/api/test.md` '0020') — 목적 · 사전조건 · 단계를 '테스트 내용' 글로 옮긴다.
빈 절은 빼고 절 사이에 빈 줄 하나. 시드(`scripts/seed.py`) · 목업도 같은 규칙으로 같은 글을 둔다.
downgrade 는 열 · 테이블만 되살린다 — 값은 돌아오지 않는다(`content` 는 버린다).
batch 로 감싼다 — sqlite(검사)는 CHECK 가 걸린 열을 ALTER 로 못 지워 표를 다시 세운다.
"""

from collections import defaultdict
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0020_test_content"
down_revision: str | None = "0019_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(length=36)


def merge(purpose: str, precondition: str, steps: Sequence[tuple[str, str]]) -> str:
    """계약 '0020' 의 모양 — 목적 · 사전조건 · 단계 순, 빈 절은 뺀다. 다 비면 ''."""
    sections: list[str] = []
    if purpose.strip():
        sections.append(f"목적\n{purpose}")
    if precondition.strip():
        sections.append(f"사전조건\n{precondition}")
    if steps:
        numbered = [
            f"{no}. {action} → {expected}" if expected.strip() else f"{no}. {action}"
            for no, (action, expected) in enumerate(steps, start=1)
        ]
        sections.append("단계\n" + "\n".join(numbered))
    return "\n\n".join(sections)


def _move_to_content() -> None:
    bind = op.get_bind()
    case = sa.table(
        "test_case",
        sa.column("id", ID),
        sa.column("purpose", sa.Text()),
        sa.column("precondition", sa.Text()),
        sa.column("content", sa.Text()),
    )
    step = sa.table(
        "test_step",
        sa.column("test_id", ID),
        sa.column("sort_order", sa.Integer()),
        sa.column("action", sa.Text()),
        sa.column("expected", sa.Text()),
    )
    steps: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for row in bind.execute(
        sa.select(step.c.test_id, step.c.action, step.c.expected).order_by(
            step.c.test_id, step.c.sort_order
        )
    ):
        steps[row.test_id].append((row.action, row.expected or ""))
    for row in bind.execute(sa.select(case.c.id, case.c.purpose, case.c.precondition)).all():
        content = merge(row.purpose or "", row.precondition or "", steps.get(row.id, []))
        if content:
            bind.execute(sa.update(case).where(case.c.id == row.id).values(content=content))


def upgrade() -> None:
    op.add_column("test_case", sa.Column("content", sa.Text(), server_default="", nullable=False))
    _move_to_content()
    op.drop_table("test_step")
    with op.batch_alter_table("test_case") as batch:
        batch.drop_constraint(op.f("ck_test_case_failed_step"), type_="check")
        batch.drop_column("failed_step")
        batch.drop_column("precondition")
        batch.drop_column("purpose")


def downgrade() -> None:
    with op.batch_alter_table("test_case") as batch:
        batch.add_column(sa.Column("purpose", sa.Text(), server_default="", nullable=False))
        batch.add_column(sa.Column("precondition", sa.Text(), server_default="", nullable=False))
        batch.add_column(sa.Column("failed_step", sa.Integer(), nullable=True))
        batch.create_check_constraint(
            op.f("ck_test_case_failed_step"),
            "failed_step is null or (status = 'fail' and failed_step >= 1)",
        )
        batch.drop_column("content")
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

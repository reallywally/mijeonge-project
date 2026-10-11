"""검색 — pg_trgm 과 글자 조각(trigram) GIN 인덱스

Revision ID: 0006_search_trgm
Revises: 0005_drop_meeting
Create Date: 2026-10-11

기본 전문검색(tsvector)은 한국어를 못 쪼갠다. 글자 세 개 조각으로 비교하는 pg_trgm 을 켜고
챗봇 · 검색이 훑는 글 여덟 열에 인덱스를 건다 (`server/PLAN.md` 7-1).

확장은 Postgres 에서만 켠다 — 검사 넷의 sqlite 는 같은 이름의 보통 인덱스만 세운다.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006_search_trgm"
down_revision: str | None = "0005_drop_meeting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (테이블, 열) — 모델의 `trgm_index` 와 같은 여덟
COLUMNS = (
    ("thread", "title"),
    ("thread", "description"),
    ("thread_option", "text"),
    ("entry", "text"),
    ("entry", "note"),
    ("entry_detail", "text"),
    ("task", "title"),
    ("task_line", "text"),
)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_postgres():
        # 인덱스의 gin_trgm_ops 가 확장에 있다 — 인덱스보다 먼저다
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for table, column in COLUMNS:
        op.create_index(
            f"ix_{table}_{column}_trgm",
            table,
            [column],
            postgresql_using="gin",
            postgresql_ops={column: "gin_trgm_ops"},
        )


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        op.drop_index(f"ix_{table}_{column}_trgm", table_name=table)
    if _is_postgres():
        # CASCADE 를 안 단다 — 이 리비전 밖에서 확장을 쓰는 것이 있으면 조용히 지우지 않고 멈춘다
        op.execute("DROP EXTENSION IF EXISTS pg_trgm")

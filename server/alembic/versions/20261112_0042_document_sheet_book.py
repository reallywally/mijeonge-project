"""문서 — 표를 시트 여럿(SheetBook)으로

Revision ID: 0042_document_sheet_book
Revises: 0041_document
Create Date: 2026-11-12

계약은 `docs/api/document.md` '이행 0042'. 컬럼은 그대로 두고 `document.sheet` 의 값만 옮긴다.
옛 `{columns, rows}` → 시트 하나 `Sheet1`(열 너비 160), text 문서는 `{sheets: []}`.
내릴 때는 첫 시트의 열 이름 · 값만 옛 꼴로 — 꾸밈 · 병합 · 다른 시트는 잃는다.
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0042_document_sheet_book"
down_revision: str | None = "0041_document"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
OLD_WIDTH = 160

document = sa.table(
    "document",
    sa.column("id", sa.String(length=36)),
    sa.column("kind", sa.String(length=8)),
    sa.column("sheet", JSON_TYPE),
)


def to_book(kind: str, sheet: Any) -> dict[str, Any]:
    if isinstance(sheet, dict) and "sheets" in sheet:
        # 이미 새 꼴 — 두 번 돌아도 그대로
        return sheet
    if kind != "sheet":
        return {"sheets": []}
    old = sheet if isinstance(sheet, dict) else {}
    columns = [str(title) for title in old.get("columns") or []]
    rows = [[str(cell) for cell in row] for row in old.get("rows") or []]
    return {
        "sheets": [
            {
                "name": "Sheet1",
                "columns": [{"title": title, "width": OLD_WIDTH} for title in columns],
                "data": rows,
                "merges": {},
                "styles": {},
            }
        ]
    }


def to_old(sheet: Any) -> dict[str, Any]:
    if isinstance(sheet, dict) and "sheets" not in sheet and "columns" in sheet:
        return sheet
    tabs = sheet.get("sheets") if isinstance(sheet, dict) else None
    if not tabs:
        return {"columns": [], "rows": []}
    first = tabs[0]
    columns = [str(col.get("title", "")) for col in first.get("columns") or []]
    width = len(columns)
    # 옛 꼴은 줄마다 칸 수 = 열 수였다 — 모자라면 빈 칸으로 채운다
    rows = [
        [str(cell) for cell in row[:width]] + [""] * (width - len(row[:width]))
        for row in first.get("data") or []
    ]
    return {"columns": columns, "rows": rows}


def _rewrite(convert: Any) -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.select(document.c.id, document.c.kind, document.c.sheet)).all()
    for row_id, kind, sheet in rows:
        new = convert(kind, sheet)
        if new != sheet:
            conn.execute(sa.update(document).where(document.c.id == row_id).values(sheet=new))


def upgrade() -> None:
    _rewrite(to_book)


def downgrade() -> None:
    _rewrite(lambda _kind, sheet: to_old(sheet))

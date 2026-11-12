"""문서 — 표의 열 이름을 걷고 첫 줄로

Revision ID: 0043_document_sheet_header
Revises: 0042_document_sheet_book
Create Date: 2026-11-12

계약은 `docs/api/document.md` '이행 0043'. 열 머리는 늘 A · B · C 다.
열 이름이 하나라도 비어 있지 않은 시트는 맨 위에 그 이름들로 한 줄을 끼우고
병합 · 꾸밈 주소를 한 줄씩 내린다. 내릴 때는 `title: ''` 만 붙인다(첫 줄은 되돌리지 않는다).
"""

import re
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0043_document_sheet_header"
down_revision: str | None = "0042_document_sheet_book"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
ADDRESS = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")

document = sa.table(
    "document",
    sa.column("id", sa.String(length=36)),
    sa.column("sheet", JSON_TYPE),
)


def shift_down(address: str) -> str:
    match = ADDRESS.match(address)
    if not match:
        return address
    return f"{match.group(1)}{int(match.group(2)) + 1}"


def _shifted(mapping: Any) -> Any:
    if not isinstance(mapping, dict):
        return mapping
    return {shift_down(key): value for key, value in mapping.items()}


def header_tab(tab: dict[str, Any]) -> dict[str, Any]:
    columns = tab.get("columns") or []
    if not any(isinstance(col, dict) and "title" in col for col in columns):
        # 이미 걷은 시트 — 두 번 돌아도 그대로
        return tab
    titles = [str(col.get("title") or "") if isinstance(col, dict) else "" for col in columns]
    new = {
        **tab,
        "columns": [
            {"width": col.get("width")} if isinstance(col, dict) else col for col in columns
        ],
    }
    if any(title.strip() for title in titles):
        new["data"] = [titles, *(tab.get("data") or [])]
        new["merges"] = _shifted(tab.get("merges") or {})
        new["styles"] = _shifted(tab.get("styles") or {})
    return new


def titled_tab(tab: dict[str, Any]) -> dict[str, Any]:
    columns = tab.get("columns") or []
    if all(isinstance(col, dict) and "title" in col for col in columns):
        return tab
    return {
        **tab,
        "columns": [
            {"title": "", **col} if isinstance(col, dict) and "title" not in col else col
            for col in columns
        ],
    }


def _map_tabs(sheet: Any, convert: Any) -> Any:
    if not isinstance(sheet, dict) or not isinstance(sheet.get("sheets"), list):
        return sheet
    return {
        **sheet,
        "sheets": [convert(tab) if isinstance(tab, dict) else tab for tab in sheet["sheets"]],
    }


def to_header(sheet: Any) -> Any:
    return _map_tabs(sheet, header_tab)


def to_titled(sheet: Any) -> Any:
    return _map_tabs(sheet, titled_tab)


def _rewrite(convert: Any) -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.select(document.c.id, document.c.sheet)).all()
    for row_id, sheet in rows:
        new = convert(sheet)
        if new != sheet:
            conn.execute(sa.update(document).where(document.c.id == row_id).values(sheet=new))


def upgrade() -> None:
    _rewrite(to_header)


def downgrade() -> None:
    _rewrite(to_titled)

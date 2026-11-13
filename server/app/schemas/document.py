import json
import re
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    StrictInt,
    StringConstraints,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.schemas.base import Schema, Utc

DocKind = Literal["text", "sheet"]

# 글 본문(편집기가 낸 HTML) — 그림이 data URI 로 들어 있어 글자 수가 아니라 UTF-8 크기로 본다
CONTENT_BYTES_MAX = 5 * 1024 * 1024
AGENDAS_MAX = 50
# 표의 모양 — 계약 '표의 모양'. 열 · 줄 · 칸은 엑셀과 같다
SHEETS_MAX = 10
SHEET_NAME_MAX = 31
COLUMNS_MAX = 16_384  # A ~ XFD
ROWS_MAX = 1_048_576
CELL_MAX = 32_767
STYLE_MAX = 200
WIDTH_MIN = 20
WIDTH_MAX = 1_000
BOOK_BYTES_MAX = 5 * 1024 * 1024
TITLE_REFUSED = "열 이름은 받지 않습니다. 첫 줄 칸에 적어 주세요."

DocTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Cell = Annotated[str, StringConstraints(max_length=CELL_MAX)]
ADDRESS = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")


def _in_sheet(address: str) -> str:
    # 꼴은 맞아도 엑셀 끝(XFD1048576)을 넘는 주소는 받지 않는다
    match = ADDRESS.match(address)
    if match is None:
        raise PydanticCustomError("cell_address", "칸 주소가 A1 꼴이 아닙니다.")
    letters, row = match.groups()
    column = 0
    for letter in letters:
        column = column * 26 + ord(letter) - 64
    if column > COLUMNS_MAX or int(row) > ROWS_MAX:
        raise PydanticCustomError("cell_address", "칸 주소가 시트 끝(XFD1048576)을 넘습니다.")
    return address


# 칸 주소 — 대문자 열 + 1부터 줄 (A1 · AB12), XFD1048576 까지
CellAddress = Annotated[str, AfterValidator(_in_sheet)]
MergeSpan = Annotated[StrictInt, Field(gt=0)]
Style = Annotated[str, StringConstraints(max_length=STYLE_MAX)]


def _content_size(content: str) -> str:
    if len(content.encode("utf-8")) > CONTENT_BYTES_MAX:
        raise PydanticCustomError("content_size", "본문이 5MB 를 넘습니다.")
    return content


# 서버는 본문을 해석하지 않는다 — 크기만 본다
DocContent = Annotated[str, AfterValidator(_content_size)]


def _whole_px(value: object) -> object:
    # 열 너비를 끌면 소수 px 가 올 수 있다 — 저장은 정수로
    if isinstance(value, float):
        return round(value)
    return value


Width = Annotated[int, BeforeValidator(_whole_px), Field(ge=WIDTH_MIN, le=WIDTH_MAX)]


def _unique(ids: list[str]) -> list[str]:
    if len(set(ids)) != len(ids):
        raise PydanticCustomError("duplicate", "같은 안건이 두 번 들어 있습니다.")
    return ids


AgendaIds = Annotated[list[str], Field(max_length=AGENDAS_MAX), AfterValidator(_unique)]


class SheetColumn(Schema):
    """열은 너비만 — 머리는 늘 A · B · C, 이름이 필요하면 첫 줄 칸에 적는다."""

    width: Width

    @model_validator(mode="before")
    @classmethod
    def _no_title(cls, value: object) -> object:
        # 모르는 키는 버리지만 열 이름은 걷어낸 칸이다 — 옛 화면이 보내면 잃지 않게 막는다
        if isinstance(value, dict) and "title" in value:
            raise PydanticCustomError(
                "sheet_column", "열 이름은 받지 않습니다. 첫 줄 칸에 적어 주세요."
            )
        return value


class SheetTab(Schema):
    """시트 탭 하나 — 열 · 줄은 엑셀과 같다, 줄마다 칸 수 ≤ 열 수. 수식은 원문 그대로 둔다."""

    name: Annotated[str, StringConstraints(min_length=1, max_length=SHEET_NAME_MAX)]
    columns: Annotated[list[SheetColumn], Field(min_length=1, max_length=COLUMNS_MAX)]
    data: Annotated[list[list[Cell]], Field(max_length=ROWS_MAX)]
    merges: dict[CellAddress, tuple[MergeSpan, MergeSpan]]
    styles: dict[CellAddress, Style]

    @model_validator(mode="after")
    def _fits_columns(self) -> "SheetTab":
        if any(len(row) > len(self.columns) for row in self.data):
            raise PydanticCustomError("sheet_shape", "줄의 칸 수가 열 수보다 많습니다.")
        return self


class SheetBook(Schema):
    """나가는 표. text 문서의 빈 책({sheets: []})도 그대로 낸다."""

    sheets: list[SheetTab]


class SheetBookInput(Schema):
    """들어오는 표 — 시트 1 ~ 10 · 이름 겹침 없음 · 직렬화 5MB(UTF-8)까지."""

    sheets: Annotated[list[SheetTab], Field(min_length=1, max_length=SHEETS_MAX)]

    @model_validator(mode="after")
    def _book_limits(self) -> "SheetBookInput":
        names = [tab.name for tab in self.sheets]
        if len(set(names)) != len(names):
            raise PydanticCustomError("sheet_name", "시트 이름이 겹칩니다.")
        if len(sheet_json(self).encode("utf-8")) > BOOK_BYTES_MAX:
            raise PydanticCustomError("sheet_size", "표가 5MB 를 넘습니다.")
        return self


def sheet_value(book: SheetBookInput) -> dict[str, Any]:
    """저장할 꼴 — 계약의 camelCase 그대로(병합은 [열 수, 줄 수] 배열)."""
    return book.model_dump(mode="json", by_alias=True)


def sheet_json(book: SheetBookInput) -> str:
    return json.dumps(sheet_value(book), ensure_ascii=False, separators=(",", ":"))


# '안 보냄' 표시 — 기본값은 검사하지 않는다. 보냈는지는 `model_fields_set` 으로 본다
UNSENT_SHEET = SheetBookInput.model_construct(sheets=[])


class DocAgendaLink(Schema):
    agenda_id: str
    # 연결 · 확인할 때의 그 안건 decisionRev
    seen_rev: int


class DocSummaryOut(Schema):
    """`ProjectDocSummary` — 목록 한 줄. 본문 · 표를 뺀다."""

    id: str
    project_id: str
    title: str
    kind: DocKind
    part_id: str | None
    # 연결 순서. 지운 안건은 빠진다
    agendas: list[DocAgendaLink]
    # decisionRev > seenRev 인 연결 안건 — 연결 순서
    changed_agenda_ids: list[str]
    rev: int
    created_by: str | None
    created_at: Utc
    updated_by: str | None
    updated_at: Utc


class DocOut(DocSummaryOut):
    """`ProjectDoc` — 목록 줄 + 본문 · 표."""

    content: str
    sheet: SheetBook


class DocCreate(Schema):
    """`DocInput`. kind 와 안 맞는 content · sheet 는 서비스가 422 로 막는다 — 보냈는지로 가른다."""

    title: DocTitle
    kind: DocKind
    part_id: str | None = None
    agenda_ids: AgendaIds = []
    content: DocContent = ""
    # 안 보내면 sheet 는 기본 시트 하나(서비스), text 는 빈 책. null 은 422
    sheet: SheetBookInput = UNSENT_SHEET


class DocPatch(Schema):
    """보낸 키만 바꾼다. null 을 못 받는 칸은 기본값만 '안 보냄' 표시라 null 은 422 다."""

    rev: int | None = None
    title: DocTitle = ""
    content: DocContent = ""
    sheet: SheetBookInput = UNSENT_SHEET
    part_id: str | None = None


class DocAgendasInput(Schema):
    agenda_ids: AgendaIds


class DocConfirmInput(Schema):
    # 안 보내면 연결 안건 전부
    agenda_ids: list[str] | None = None

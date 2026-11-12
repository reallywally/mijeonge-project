"""문서 — 글 · 표, 연결 안건 · 결정 바뀜 · 판 번호 (`docs/api/document.md`).

본문은 해석하지 않는다. 결정 바뀜은 연결 줄의 `seen_rev` 와 안건의 지금 `decision_rev` 로만 센다.
지운 안건의 연결 줄은 남겨 두고 읽을 때 거른다 — 연결을 다시 맞추면(PUT) 그때 빠진다.
"""

import copy
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Agenda, Document, DocumentAgenda
from app.models.base import new_id
from app.schemas.document import (
    DocAgendaLink,
    DocAgendasInput,
    DocConfirmInput,
    DocCreate,
    DocOut,
    DocPatch,
    DocSummaryOut,
    SheetBook,
    sheet_value,
)
from app.services import access
from app.services import part as part_service
from app.services import project as project_service
from app.services.access import Scope
from app.time import iso_z, now

# 새 표 문서의 시트 — 계약 'DocInput'
DEFAULT_SHEET: dict[str, Any] = {
    "name": "Sheet1",
    "columns": [{"width": 200}, {"width": 400}],
    "data": [["항목", "내용"]],
    "merges": {},
    "styles": {"A1": "font-weight: bold", "B1": "font-weight: bold"},
}
# 판을 올리는 칸
REV_FIELDS = ("title", "content", "sheet")

CREATE_FORBIDDEN = "이 파트에 문서를 만들 권한이 없습니다."
MOVE_FORBIDDEN = "옮길 파트에 문서를 고칠 권한이 없습니다."
STALE_MESSAGE = "다른 사람이 먼저 고쳤습니다. 다시 불러와 주세요."


def _empty_sheet() -> dict[str, Any]:
    return {"sheets": []}


def _default_sheet() -> dict[str, Any]:
    return {"sheets": [copy.deepcopy(DEFAULT_SHEET)]}


def _document_not_found() -> ApiError:
    return not_found("DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.")


def _invalid(field: str, reason: str) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {field: reason})


async def load_document(session: AsyncSession, document_id: str) -> Document:
    found = await session.get(Document, document_id)
    if found is None:
        raise _document_not_found()
    return found


# --- 읽기 ---


@dataclass(frozen=True)
class _Link:
    agenda_id: str
    seen_rev: int
    decision_rev: int


async def _links(session: AsyncSession, document_ids: Collection[str]) -> dict[str, list[_Link]]:
    """문서마다 산 안건의 연결 줄 — 연결 순서."""
    if not document_ids:
        return {}
    rows = await session.execute(
        select(
            DocumentAgenda.document_id,
            DocumentAgenda.agenda_id,
            DocumentAgenda.seen_rev,
            Agenda.decision_rev,
        )
        .join(Agenda, Agenda.id == DocumentAgenda.agenda_id)
        .where(DocumentAgenda.document_id.in_(document_ids), Agenda.is_deleted.is_(False))
        .order_by(DocumentAgenda.document_id, DocumentAgenda.sort_order)
    )
    found: dict[str, list[_Link]] = defaultdict(list)
    for document_id, agenda_id, seen_rev, decision_rev in rows.tuples():
        found[document_id].append(_Link(agenda_id, seen_rev, decision_rev))
    return found


def _summary_fields(row: Document, links: Sequence[_Link]) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "title": row.title,
        "kind": row.kind,
        "part_id": row.part_id,
        "agendas": [DocAgendaLink(agenda_id=x.agenda_id, seen_rev=x.seen_rev) for x in links],
        "changed_agenda_ids": [x.agenda_id for x in links if x.decision_rev > x.seen_rev],
        "rev": row.rev,
        "created_by": row.created_by,
        "created_at": row.created_at,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at,
    }


async def _one(session: AsyncSession, row: Document) -> DocOut:
    links = (await _links(session, [row.id])).get(row.id, [])
    return DocOut(
        **_summary_fields(row, links),
        content=row.content,
        sheet=SheetBook.model_validate(row.sheet),
    )


async def list_documents(
    session: AsyncSession, project_id: str, agenda_id: str | None = None
) -> list[DocSummaryOut]:
    """`updated_at` 늦은 순, 같으면 `seq` 큰 순.

    `agenda_id` 를 주면 그 안건이 (산 채로) 걸린 것만."""
    stmt = select(Document).where(Document.project_id == project_id)
    if agenda_id is not None:
        stmt = stmt.where(
            Document.id.in_(
                select(DocumentAgenda.document_id).where(
                    DocumentAgenda.agenda_id == agenda_id,
                    DocumentAgenda.agenda_id.in_(access.live_agenda_ids()),
                )
            )
        )
    rows = (
        await session.scalars(stmt.order_by(Document.updated_at.desc(), Document.seq.desc()))
    ).all()
    links = await _links(session, [row.id for row in rows])
    return [DocSummaryOut(**_summary_fields(row, links.get(row.id, []))) for row in rows]


async def get_document(session: AsyncSession, document_id: str) -> DocOut:
    return await _one(session, await load_document(session, document_id))


# --- 쓰기 ---


async def _current_revs(
    session: AsyncSession, project_id: str, agenda_ids: Sequence[str]
) -> dict[str, int]:
    """연결하려는 안건의 지금 결정 판. 이 프로젝트의 산 안건이 아니면 400."""
    if not agenda_ids:
        return {}
    rows = await session.execute(
        select(Agenda.id, Agenda.decision_rev).where(
            Agenda.id.in_(agenda_ids),
            Agenda.project_id == project_id,
            Agenda.is_deleted.is_(False),
        )
    )
    found: dict[str, int] = dict(rows.tuples().all())
    missing = [agenda_id for agenda_id in agenda_ids if agenda_id not in found]
    if missing:
        raise ApiError(
            400,
            "DOCUMENT_AGENDA_NOT_FOUND",
            "연결할 안건을 찾을 수 없습니다.",
            {"agendaIds": missing[0]},
        )
    return found


def _touch(document: Document, actor_id: str) -> None:
    document.updated_by = actor_id
    document.updated_at = now()


def _guard_edit(scope: Scope, document: Document) -> None:
    if not access.can_edit_document(scope, document):
        raise access.forbidden()


async def create_document(
    session: AsyncSession, project_id: str, payload: DocCreate, scope: Scope
) -> DocOut:
    sent = payload.model_fields_set
    if payload.kind == "sheet" and "content" in sent:
        raise _invalid("content", "표 문서에는 본문을 보낼 수 없습니다.")
    if payload.kind == "text" and "sheet" in sent:
        raise _invalid("sheet", "글 문서에는 표를 보낼 수 없습니다.")
    project = await project_service.load_project(session, project_id)
    await part_service.guard_part(session, project.id, payload.part_id)
    if not access.can_create_in_part(scope, payload.part_id):
        raise access.forbidden(CREATE_FORBIDDEN)
    revs = await _current_revs(session, project.id, payload.agenda_ids)

    if payload.kind == "text":
        sheet = _empty_sheet()
    elif "sheet" in sent:
        sheet = sheet_value(payload.sheet)
    else:
        sheet = _default_sheet()
    actor_id = scope.actor.id
    at = now()
    document = Document(
        id=new_id(),
        project_id=project.id,
        title=payload.title,
        kind=payload.kind,
        content=payload.content if payload.kind == "text" else "",
        sheet=sheet,
        part_id=payload.part_id,
        rev=1,
        created_by=actor_id,
        created_at=at,
        updated_by=actor_id,
        updated_at=at,
    )
    session.add(document)
    await session.flush()
    session.add_all(
        DocumentAgenda(
            document_id=document.id,
            agenda_id=agenda_id,
            project_id=project.id,
            sort_order=order,
            seen_rev=revs[agenda_id],
        )
        for order, agenda_id in enumerate(payload.agenda_ids)
    )
    await session.commit()
    return await _one(session, document)


async def patch_document(
    session: AsyncSession, document_id: str, payload: DocPatch, scope: Scope
) -> DocOut:
    """검사 순서는 422 → 403 → 409 — 앞에서 걸리면 뒤는 안 본다."""
    document = await load_document(session, document_id)
    sent = payload.model_fields_set
    if document.kind == "sheet" and "content" in sent:
        raise _invalid("content", "표 문서에는 본문을 보낼 수 없습니다.")
    if document.kind == "text" and "sheet" in sent:
        raise _invalid("sheet", "글 문서에는 표를 보낼 수 없습니다.")
    versioned = sent.intersection(REV_FIELDS)
    if versioned and payload.rev is None:
        raise _invalid("rev", "필수 값입니다.")
    # 고치기 전 문서로 본다 — 옮겨 갈 파트는 따로 본다
    _guard_edit(scope, document)
    moving = "part_id" in sent and payload.part_id != document.part_id
    if moving:
        await part_service.guard_part(session, document.project_id, payload.part_id)
        if not access.can_move_to_part(scope, payload.part_id):
            raise access.forbidden(MOVE_FORBIDDEN)
    if versioned and payload.rev != document.rev:
        raise ApiError(
            409,
            "DOCUMENT_STALE",
            STALE_MESSAGE,
            {
                "rev": document.rev,
                "updatedBy": document.updated_by,
                "updatedAt": iso_z(document.updated_at),
            },
        )

    edited = False
    if "title" in sent and payload.title != document.title:
        document.title = payload.title
        edited = True
    if "content" in sent and payload.content != document.content:
        document.content = payload.content
        edited = True
    if "sheet" in sent and (sheet := sheet_value(payload.sheet)) != document.sheet:
        document.sheet = sheet
        edited = True
    if edited:
        document.rev += 1
    if moving:
        document.part_id = payload.part_id
    if edited or moving:
        _touch(document, scope.actor.id)
    await session.commit()
    return await _one(session, document)


async def delete_document(session: AsyncSession, document_id: str, scope: Scope) -> None:
    """진짜 지운다 — 연결 줄은 cascade 로 같이 간다."""
    document = await load_document(session, document_id)
    if not access.can_delete_document(scope, document):
        raise access.forbidden()
    await session.delete(document)
    await session.commit()


async def _link_rows(session: AsyncSession, document_id: str) -> list[DocumentAgenda]:
    """지운 안건의 줄까지 전부 — 연결 순서."""
    rows = await session.scalars(
        select(DocumentAgenda)
        .where(DocumentAgenda.document_id == document_id)
        .order_by(DocumentAgenda.sort_order)
    )
    return list(rows.all())


async def put_agendas(
    session: AsyncSession, document_id: str, payload: DocAgendasInput, scope: Scope
) -> DocOut:
    """연결 통째로. 남는 안건은 `seen_rev` 를 그대로, 새로 들어온 안건은 지금 판.

    판(`rev`)과 무관하다."""
    document = await load_document(session, document_id)
    _guard_edit(scope, document)
    wanted = payload.agenda_ids
    revs = await _current_revs(session, document.project_id, wanted)
    rows = await _link_rows(session, document.id)
    if [row.agenda_id for row in rows] == wanted:
        return await _one(session, document)

    by_agenda = {row.agenda_id: row for row in rows}
    for row in rows:
        if row.agenda_id not in revs:
            await session.delete(row)
    for order, agenda_id in enumerate(wanted):
        kept = by_agenda.get(agenda_id)
        if kept is not None:
            kept.sort_order = order
            continue
        session.add(
            DocumentAgenda(
                document_id=document.id,
                agenda_id=agenda_id,
                project_id=document.project_id,
                sort_order=order,
                seen_rev=revs[agenda_id],
            )
        )
    _touch(document, scope.actor.id)
    await session.commit()
    return await _one(session, document)


async def confirm(
    session: AsyncSession, document_id: str, payload: DocConfirmInput, scope: Scope
) -> DocOut:
    """고른(또는 전부) 연결 안건의 `seen_rev` 를 지금 판으로. 연결 안 된 id 는 400."""
    document = await load_document(session, document_id)
    _guard_edit(scope, document)
    links = (await _links(session, [document.id])).get(document.id, [])
    current = {link.agenda_id: link.decision_rev for link in links}
    if payload.agenda_ids is None:
        picked = list(current)
    else:
        picked = list(dict.fromkeys(payload.agenda_ids))
        missing = [agenda_id for agenda_id in picked if agenda_id not in current]
        if missing:
            raise ApiError(
                400,
                "DOCUMENT_AGENDA_NOT_LINKED",
                "이 문서에 연결되지 않은 안건입니다.",
                {"agendaIds": missing[0]},
            )
    changed = False
    for row in await _link_rows(session, document.id):
        if row.agenda_id in picked and row.seen_rev != current[row.agenda_id]:
            row.seen_rev = current[row.agenda_id]
            changed = True
    if changed:
        _touch(document, scope.actor.id)
    await session.commit()
    return await _one(session, document)

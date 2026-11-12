from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ProjectScope, Session
from app.schemas.document import (
    DocAgendasInput,
    DocConfirmInput,
    DocCreate,
    DocOut,
    DocPatch,
    DocSummaryOut,
)
from app.services import document as document_service

# 보기는 프로젝트 멤버 누구나 — 서버는 파트로 숨기지 않는다. 쓰기는 파트 권한을 탄다
# (docs/api/document.md '권한')
router = APIRouter(tags=["document"])


@router.get("/projects/{project_id}/documents")
async def list_documents(
    project_id: str,
    scope: ProjectScope,
    session: Session,
    agenda_id: Annotated[str | None, Query(alias="agendaId")] = None,
) -> list[DocSummaryOut]:
    return await document_service.list_documents(session, scope.project_id, agenda_id)


@router.post("/projects/{project_id}/documents", status_code=201)
async def create_document(
    project_id: str, payload: DocCreate, scope: ProjectScope, session: Session
) -> DocOut:
    return await document_service.create_document(session, scope.project_id, payload, scope)


@router.get("/documents/{document_id}")
async def get_document(document_id: str, session: Session) -> DocOut:
    return await document_service.get_document(session, document_id)


@router.patch("/documents/{document_id}")
async def patch_document(
    document_id: str, payload: DocPatch, scope: ProjectScope, session: Session
) -> DocOut:
    """제목 · 본문 · 표는 `rev` 를 실어 온다 — 다르면 409 `DOCUMENT_STALE`."""
    return await document_service.patch_document(session, document_id, payload, scope)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, scope: ProjectScope, session: Session) -> None:
    """관리자 · 만든 사람, 파트 문서면 그 파트의 삭제 권한도."""
    await document_service.delete_document(session, document_id, scope)


@router.put("/documents/{document_id}/agendas")
async def put_agendas(
    document_id: str, payload: DocAgendasInput, scope: ProjectScope, session: Session
) -> DocOut:
    return await document_service.put_agendas(session, document_id, payload, scope)


@router.post("/documents/{document_id}/confirm")
async def confirm(
    document_id: str, payload: DocConfirmInput, scope: ProjectScope, session: Session
) -> DocOut:
    """결정 바뀜 지우기 — `agendaIds` 를 안 보내면 연결 안건 전부."""
    return await document_service.confirm(session, document_id, payload, scope)

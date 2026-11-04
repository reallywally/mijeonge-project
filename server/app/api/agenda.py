from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ProjectScope
from app.db import get_session
from app.schemas.agenda import AgendaCreate, AgendaOut, AgendaPatch
from app.services import agenda as agenda_service

router = APIRouter(tags=["agenda"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/projects/{project_id}/agendas", status_code=201)
async def create_agenda(
    project_id: str, payload: AgendaCreate, scope: ProjectScope, session: Session
) -> AgendaOut:
    return await agenda_service.create_agenda(session, project_id, payload, scope.actor.id)


@router.patch("/agendas/{agenda_id}")
async def patch_agenda(
    agenda_id: str, payload: AgendaPatch, scope: ProjectScope, session: Session
) -> AgendaOut:
    """부분 수정 — 결정내용 · 상태도 여기서 바뀐다. 생성자 · 담당자 · 관리자만."""
    return await agenda_service.patch_agenda(session, agenda_id, payload, scope)


@router.delete("/agendas/{agenda_id}", status_code=204)
async def delete_agenda(agenda_id: str, scope: ProjectScope, session: Session) -> None:
    """생성자 · 담당자 · 프로젝트 관리자 · 시스템 관리자."""
    await agenda_service.delete_agenda(session, agenda_id, scope)

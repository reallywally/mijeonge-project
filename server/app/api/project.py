from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.project import MemberOut, ProjectCreate, ProjectOut
from app.schemas.snapshot import SnapshotOut
from app.services import project as project_service
from app.services import snapshot as snapshot_service

router = APIRouter(tags=["project"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/projects")
async def list_projects(session: Session) -> list[ProjectOut]:
    return await project_service.list_projects(session)


# 멤버는 프로젝트에 매이지 않는다. 읽기 전용 목록 하나뿐이라 파일을 따로 두지 않았다
@router.get("/members")
async def list_members(session: Session) -> list[MemberOut]:
    return await project_service.list_members(session)


@router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, session: Session) -> ProjectOut:
    """화면에 프로젝트 등록이 아직 없어 계약이 없는 자리다.
    keyPrefix 는 작업 발번(`HW-22`)에 꼭 필요해서 필수로 받는다."""
    return await project_service.create_project(session, payload)


@router.get("/projects/{project_id}/snapshot")
async def get_snapshot(project_id: str, session: Session) -> SnapshotOut:
    """그 프로젝트의 레코드 전부. 화면의 `stores/data.ts` 가 들고 있는 것과 같은 모양이다."""
    if not await project_service.project_exists(session, project_id):
        raise HTTPException(status_code=404, detail="그런 프로젝트가 없다")
    return await snapshot_service.load_snapshot(session, project_id)

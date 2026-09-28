from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Member, Project, new_id
from app.schemas.project import MemberOut, ProjectCreate, ProjectOut


async def list_projects(session: AsyncSession) -> list[ProjectOut]:
    rows = (await session.execute(select(Project).order_by(Project.id))).scalars().all()
    return [ProjectOut.model_validate(row) for row in rows]


async def list_members(session: AsyncSession) -> list[MemberOut]:
    rows = (await session.execute(select(Member).order_by(Member.id))).scalars().all()
    return [MemberOut.model_validate(row) for row in rows]


async def project_exists(session: AsyncSession, project_id: str) -> bool:
    found = await session.execute(select(Project.id).where(Project.id == project_id))
    return found.scalar_one_or_none() is not None


async def load_project(session: AsyncSession, project_id: str) -> Project:
    found = await session.execute(select(Project).where(Project.id == project_id))
    project = found.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="그런 프로젝트가 없다")
    return project


async def create_project(session: AsyncSession, payload: ProjectCreate) -> ProjectOut:
    project = Project(id=new_id(), name=payload.name, key_prefix=payload.key_prefix)
    session.add(project)
    await session.commit()
    return ProjectOut.model_validate(project)

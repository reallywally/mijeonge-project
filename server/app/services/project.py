from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Member, Project
from app.schemas.project import MemberOut, ProjectOut


async def list_projects(session: AsyncSession) -> list[ProjectOut]:
    rows = (await session.execute(select(Project).order_by(Project.id))).scalars().all()
    return [ProjectOut.model_validate(row) for row in rows]


async def list_members(session: AsyncSession) -> list[MemberOut]:
    rows = (await session.execute(select(Member).order_by(Member.id))).scalars().all()
    return [MemberOut.model_validate(row) for row in rows]


async def project_exists(session: AsyncSession, project_id: str) -> bool:
    found = await session.execute(select(Project.id).where(Project.id == project_id))
    return found.scalar_one_or_none() is not None

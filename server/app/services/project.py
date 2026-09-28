import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Member, Project, new_id
from app.schemas.project import MemberOut, ProjectCreate, ProjectOut

_PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_PREFIX_LENGTH = 4
_PREFIX_TRIES = 20


async def list_projects(session: AsyncSession) -> list[ProjectOut]:
    rows = (await session.execute(select(Project).order_by(Project.id))).scalars().all()
    return [ProjectOut.model_validate(row) for row in rows]


async def list_members(session: AsyncSession) -> list[MemberOut]:
    rows = (await session.execute(select(Member).order_by(Member.id))).scalars().all()
    return [MemberOut.model_validate(row) for row in rows]


async def load_project(session: AsyncSession, project_id: str) -> Project:
    found = await session.execute(select(Project).where(Project.id == project_id))
    project = found.scalar_one_or_none()
    if project is None:
        raise not_found("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.")
    return project


async def create_project(session: AsyncSession, payload: ProjectCreate) -> ProjectOut:
    """접두사는 선택이다 — 안 넣으면 서버가 겹치지 않는 값을 만든다 (API.md Q20)."""
    taken = set((await session.execute(select(Project.task_key_prefix))).scalars().all())

    if payload.task_key_prefix is not None:
        prefix = payload.task_key_prefix
        if prefix in taken:
            raise ApiError(
                409,
                "PROJECT_PREFIX_TAKEN",
                f"작업 키 접두사 '{prefix}' 는 다른 프로젝트가 쓰고 있습니다.",
            )
    else:
        prefix = _make_prefix(taken)

    project = Project(id=new_id(), name=payload.name, task_key_prefix=prefix)
    session.add(project)
    await session.commit()
    return ProjectOut.model_validate(project)


def _make_prefix(taken: set[str]) -> str:
    """보고 옮겨 적는 값이라 헷갈리는 글자(I · O · 0 · 1)를 뺀 넷을 뽑는다."""
    for _ in range(_PREFIX_TRIES):
        candidate = "".join(secrets.choice(_PREFIX_ALPHABET) for _ in range(_PREFIX_LENGTH))
        if candidate not in taken:
            return candidate
    # 32^4 에서 스무 번을 내리 부딪히는 일은 없다 — 나면 데이터가 이상한 것이다
    raise ApiError(500, "INTERNAL_ERROR", "작업 키 접두사를 만들지 못했습니다.")

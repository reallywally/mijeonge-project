import secrets
from datetime import date

from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Member, Project, new_id
from app.schemas.project import MemberOut, ProjectCreate, ProjectOut, ProjectPatch
from app.services import access
from app.services.auth import Actor
from app.time import now

_PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_PREFIX_LENGTH = 4
_PREFIX_TRIES = 20


async def list_projects(session: AsyncSession, actor: Actor) -> list[ProjectOut]:
    """지운 것은 빼고, 진행 중인 것을 먼저 — 그 안에서는 전과 같은 순서(id)."""
    stmt = (
        select(Project)
        .where(Project.deleted_at.is_(None))
        .order_by(case((Project.status == "active", 0), else_=1), Project.id)
    )
    visible = await access.visible_project_ids(session, actor)
    if visible is not None:
        stmt = stmt.where(Project.id.in_(visible))
    rows = (await session.execute(stmt)).scalars().all()
    return [ProjectOut.model_validate(row) for row in rows]


async def list_members(session: AsyncSession, assignable_in: str | None = None) -> list[MemberOut]:
    """전사 멤버 — 비활성까지. `assignable_in` 을 주면 그 프로젝트의 활성 멤버(담당자 후보)만."""
    stmt = select(Member).order_by(Member.id)
    if assignable_in is not None:
        stmt = stmt.where(
            Member.id.in_(await access.active_project_members(session, assignable_in))
        )
    rows = (await session.execute(stmt)).scalars().all()
    return [MemberOut.model_validate(row) for row in rows]


async def load_project(session: AsyncSession, project_id: str) -> Project:
    """지운 프로젝트는 없는 것과 같다."""
    found = await session.execute(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    project = found.scalar_one_or_none()
    if project is None:
        raise not_found("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.")
    return project


def _guard_dates(start: date | None, end: date | None) -> None:
    if start is not None and end is not None and end < start:
        raise ApiError(400, "PROJECT_DATE_RANGE", "종료일은 시작일보다 앞설 수 없습니다.")


async def patch_project(
    session: AsyncSession, project_id: str, payload: ProjectPatch
) -> ProjectOut:
    """보낸 것만 바꾼다. 설명 · 기간의 null 은 '비우기'다."""
    project = await load_project(session, project_id)
    sent = payload.model_fields_set
    start = payload.start_date if "start_date" in sent else project.start_date
    end = payload.end_date if "end_date" in sent else project.end_date
    # 한쪽만 고쳐도 바뀐 뒤의 쌍으로 본다
    _guard_dates(start, end)

    if "name" in sent and payload.name is not None:
        project.name = payload.name
    if "description" in sent:
        project.description = payload.description
    project.start_date = start
    project.end_date = end
    if "status" in sent and payload.status is not None and payload.status != project.status:
        project.status = payload.status
        # 같은 상태를 다시 보내면 처음 닫은 시각을 지킨다
        project.closed_at = now() if payload.status == "closed" else None
    await session.commit()
    return ProjectOut.model_validate(project)


async def delete_project(session: AsyncSession, project_id: str) -> None:
    """소프트 삭제. 레코드 · 부여 · 접두사는 남는다 — 되살릴 여지를 둔다."""
    project = await load_project(session, project_id)
    project.deleted_at = now()
    await session.commit()


async def create_project(session: AsyncSession, payload: ProjectCreate) -> ProjectOut:
    """접두사는 선택이다 — 안 넣으면 서버가 겹치지 않는 값을 만든다 (API.md Q20).

    지운 프로젝트의 접두사도 잡혀 있는 것으로 센다(되살리기).
    """
    _guard_dates(payload.start_date, payload.end_date)
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

    project = Project(
        id=new_id(),
        name=payload.name,
        task_key_prefix=prefix,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="active",
    )
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

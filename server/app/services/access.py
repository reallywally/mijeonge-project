"""누가 어느 프로젝트를 보고 고칠 수 있나 — 권한 검사는 이 파일 하나에 모은다.

부여받지 않은 프로젝트는 **없는 것처럼** 다룬다: 원래 없을 때와 같은 404 코드를 낸다
(403 을 내면 그런 프로젝트가 있다는 것을 알려 준다). 부여는 받았는데 모자라면 403 이다.
"""

from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Member, Project, ProjectMember, Task, TaskComment, Thread
from app.services.auth import Actor


@dataclass(frozen=True)
class Scope:
    """요청 경로가 가리키는 프로젝트와, 그 안에서의 내 자리."""

    actor: Actor
    project_id: str
    # 부여받은 역할. 시스템 관리자가 부여 없이 들어왔으면 None
    role: str | None

    @property
    def can_manage(self) -> bool:
        return self.actor.is_admin or self.role == "admin"


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "권한이 없습니다.")


# 경로 이름 → (원래 없을 때의 코드, 메시지). 프로젝트를 품은 레코드는 전부 여기 있어야 한다
SCOPED_PARAMS: dict[str, tuple[str, str]] = {
    "project_id": ("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다."),
    "task_id": ("TASK_NOT_FOUND", "작업을 찾을 수 없습니다."),
    "thread_id": ("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다."),
    "comment_id": ("COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다."),
}


async def _project_of(session: AsyncSession, param: str, value: str) -> str | None:
    stmt: Select[tuple[str]]
    match param:
        case "project_id":
            stmt = select(Project.id).where(Project.id == value)
        case "task_id":
            stmt = select(Task.project_id).where(Task.id == value)
        case "thread_id":
            stmt = select(Thread.project_id).where(Thread.id == value)
        case "comment_id":
            stmt = (
                select(Task.project_id)
                .join(TaskComment, TaskComment.task_id == Task.id)
                .where(TaskComment.id == value)
            )
        case _:
            raise AssertionError(f"모르는 경로 이름: {param}")
    found: str | None = (await session.execute(stmt)).scalar_one_or_none()
    return found


async def project_role(session: AsyncSession, member_id: str, project_id: str) -> str | None:
    role: str | None = (
        await session.execute(
            select(ProjectMember.role).where(
                ProjectMember.project_id == project_id, ProjectMember.member_id == member_id
            )
        )
    ).scalar_one_or_none()
    return role


async def resolve_scope(
    session: AsyncSession, actor: Actor, path_params: dict[str, str]
) -> Scope | None:
    """경로가 가리키는 레코드마다 프로젝트를 찾아 볼 수 있는지 본다. 프로젝트가 없는 경로면 None.

    작업 ↔ 안건 링크처럼 둘을 가리키면 둘 다 본다 —
    프로젝트가 서로 다른 것은 서비스가 400 으로 막는다.
    """
    scope: Scope | None = None
    for param, (code, message) in SCOPED_PARAMS.items():
        value = path_params.get(param)
        if value is None:
            continue
        project_id = await _project_of(session, param, value)
        if project_id is None:
            raise not_found(code, message)
        role = await project_role(session, actor.id, project_id)
        if role is None and not actor.is_admin:
            raise not_found(code, message)
        if scope is None:
            scope = Scope(actor=actor, project_id=project_id, role=role)
    return scope


async def visible_project_ids(session: AsyncSession, actor: Actor) -> list[str] | None:
    """내가 볼 수 있는 프로젝트. 시스템 관리자는 전부라 None."""
    if actor.is_admin:
        return None
    found = await session.scalars(
        select(ProjectMember.project_id).where(ProjectMember.member_id == actor.id)
    )
    return list(found.all())


async def active_project_members(
    session: AsyncSession, project_id: str, member_ids: Collection[str] | None = None
) -> set[str]:
    """그 프로젝트에 부여된 활성 멤버. 새로 지정하는 담당자는 여기 있어야 한다."""
    stmt = (
        select(Member.id)
        .join(ProjectMember, ProjectMember.member_id == Member.id)
        .where(ProjectMember.project_id == project_id, Member.active.is_(True))
    )
    if member_ids is not None:
        stmt = stmt.where(Member.id.in_(member_ids))
    return set((await session.scalars(stmt)).all())


async def is_assignable(session: AsyncSession, project_id: str, member_id: str) -> bool:
    return bool(await active_project_members(session, project_id, [member_id]))

"""사용자 관리(시스템 관리자) · 프로젝트 멤버 부여(프로젝트 관리자). 계약은 `docs/api/auth.md`.

멤버는 지우지 않는다 — 비활성화한다. 작업 담당자 · 댓글 작성자 · 이력이 멤버를 가리킨다.
"""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import AuthIdentity, Member, ProjectMember, new_id
from app.schemas.auth import (
    MemberAccountCreate,
    MemberAccountOut,
    MemberAccountPatch,
    ProjectMemberOut,
)
from app.services import auth as auth_service
from app.services import part as part_service
from app.services.auth import PASSWORD
from app.time import now


def member_not_found() -> ApiError:
    return not_found("MEMBER_NOT_FOUND", "멤버를 찾을 수 없습니다.")


def _email_taken() -> ApiError:
    return ApiError(
        409,
        "EMAIL_TAKEN",
        "이미 쓰고 있는 이메일입니다.",
        {"email": "이미 쓰고 있는 이메일입니다."},
    )


async def load_member(session: AsyncSession, member_id: str) -> Member:
    member = await session.get(Member, member_id)
    if member is None:
        raise member_not_found()
    return member


def _account(member: Member, identity: AuthIdentity | None) -> MemberAccountOut:
    return MemberAccountOut.model_validate(
        {
            "id": member.id,
            "name": member.name,
            "email": member.email,
            "system_role": member.system_role,
            "active": member.active,
            "career": member.career,
            "skills": member.skills,
            "notes": member.notes,
            "has_password": identity is not None and identity.password_hash is not None,
            "created_at": member.created_at,
            "last_login_at": identity.last_login_at if identity else None,
        }
    )


async def list_accounts(session: AsyncSession) -> list[MemberAccountOut]:
    rows = await session.execute(
        select(Member, AuthIdentity)
        .outerjoin(
            AuthIdentity,
            (AuthIdentity.member_id == Member.id) & (AuthIdentity.provider == PASSWORD),
        )
        .order_by(Member.name, Member.id)
    )
    return [_account(member, identity) for member, identity in rows.tuples().all()]


async def _guard_email(session: AsyncSession, email: str, member_id: str | None) -> None:
    # 유니크에 맡기면 500 이다 — 먼저 409 로 거른다
    taken = await session.scalar(
        select(Member.id).where(Member.email == email, Member.id != (member_id or ""))
    )
    if taken is not None:
        raise _email_taken()


async def create_account(session: AsyncSession, payload: MemberAccountCreate) -> MemberAccountOut:
    await _guard_email(session, payload.email, None)
    member = Member(
        id=new_id(),
        name=payload.name,
        email=payload.email,
        system_role=payload.system_role,
        active=True,
        career=payload.career,
        skills=payload.skills,
        notes=payload.notes,
        created_at=now(),
    )
    identity = AuthIdentity(
        member_id=member.id,
        provider=PASSWORD,
        subject=payload.email,
        password_hash=await auth_service.hash_password(payload.password),
        created_at=now(),
    )
    session.add(member)
    await session.flush()
    session.add(identity)
    await session.commit()
    return _account(member, identity)


async def _guard_last_admin(session: AsyncSession, member: Member) -> None:
    """마지막 활성 시스템 관리자를 내리거나 끄면 아무도 사용자를 관리할 수 없다."""
    # 관리자 행을 잠근다 — 두 관리자가 동시에 서로를 내리면 둘 다 '다른 사람이 있다' 로 통과한다
    admins = await session.scalars(
        select(Member.id)
        .where(Member.system_role == "admin", Member.active.is_(True))
        .with_for_update()
    )
    if set(admins.all()) <= {member.id}:
        raise ApiError(
            409, "LAST_SYSTEM_ADMIN", "마지막 시스템 관리자는 내리거나 비활성화할 수 없습니다."
        )


async def patch_account(
    session: AsyncSession, member_id: str, payload: MemberAccountPatch
) -> MemberAccountOut:
    member = await load_member(session, member_id)
    sent = payload.model_fields_set
    demoting = "system_role" in sent and payload.system_role == "user"
    disabling = "active" in sent and payload.active is False
    if member.system_role == "admin" and member.active and (demoting or disabling):
        await _guard_last_admin(session, member)

    identity = await auth_service.password_identity(session, member.id)
    if "email" in sent and payload.email is not None and payload.email != member.email:
        await _guard_email(session, payload.email, member.id)
        member.email = payload.email
        # password 의 subject 는 로그인 이메일이다 — 같이 옮긴다
        if identity is not None:
            identity.subject = payload.email
    if "name" in sent and payload.name is not None:
        member.name = payload.name
    if "system_role" in sent and payload.system_role is not None:
        member.system_role = payload.system_role
    if "active" in sent and payload.active is not None:
        member.active = payload.active
        if not payload.active:
            await auth_service.end_member_sessions(session, member.id)
    if "career" in sent:
        member.career = payload.career
    if "skills" in sent:
        member.skills = payload.skills
    if "notes" in sent:
        member.notes = payload.notes
    await session.commit()
    return _account(member, identity)


async def set_password(session: AsyncSession, member_id: str, password: str) -> None:
    """비밀번호를 새로 건다. 그 사람의 세션은 모두 끊는다."""
    member = await load_member(session, member_id)
    if member.email is None:
        raise bad_request(
            "MEMBER_EMAIL_REQUIRED", "이메일이 없는 멤버에는 비밀번호를 걸 수 없습니다."
        )
    hashed = await auth_service.hash_password(password)
    identity = await auth_service.password_identity(session, member.id)
    if identity is None:
        session.add(
            AuthIdentity(
                member_id=member.id,
                provider=PASSWORD,
                subject=member.email,
                password_hash=hashed,
                created_at=now(),
            )
        )
    else:
        identity.subject = member.email
        identity.password_hash = hashed
    await auth_service.end_member_sessions(session, member.id)
    await session.commit()


async def list_project_members(session: AsyncSession, project_id: str) -> list[ProjectMemberOut]:
    # 비활성 멤버도 부여가 남아 있으면 싣는다 — 고르는 자리에서 빼는 것은 Member.active 로 한다
    rows = await session.execute(
        select(ProjectMember.member_id, ProjectMember.role)
        .join(Member, Member.id == ProjectMember.member_id)
        .where(ProjectMember.project_id == project_id)
        .order_by(Member.name, Member.id)
    )
    return [
        ProjectMemberOut.model_validate({"member_id": member_id, "role": role})
        for member_id, role in rows.tuples().all()
    ]


async def grant(
    session: AsyncSession, project_id: str, member_id: str, role: str
) -> ProjectMemberOut:
    """부여하거나 역할을 바꾼다 (멱등)."""
    member = await load_member(session, member_id)
    if not member.active:
        raise bad_request("MEMBER_INACTIVE", "비활성 멤버는 프로젝트에 부여할 수 없습니다.")
    found = await session.get(ProjectMember, (project_id, member_id))
    if found is None:
        session.add(
            ProjectMember(project_id=project_id, member_id=member_id, role=role, created_at=now())
        )
    else:
        found.role = role
    await session.commit()
    return ProjectMemberOut.model_validate({"member_id": member_id, "role": role})


async def revoke(session: AsyncSession, project_id: str, member_id: str) -> None:
    """빼기 (멱등). 그 사람이 담당하던 작업 · 안건은 그대로 둔다 — 기록이다.

    그 프로젝트 파트들의 소속은 같이 지운다 — 파트에는 부여된 사람만 있다 (docs/api/part.md).
    """
    await session.execute(
        delete(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.member_id == member_id
        )
    )
    await part_service.leave_project_parts(session, project_id, member_id)
    await session.commit()

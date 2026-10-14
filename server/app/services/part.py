"""파트 — 만들기 · 이름 · 보관 · 사람 넣고 빼기, 작업 · 안건이 다는 `partId` 검사.

계약은 `docs/api/part.md`. **보기 범위지 권한이 아니다** — 서버는 숨기지 않고, 거르는 것은 화면이다.
파트는 지우지 않고 보관한다. 경로의 파트가 내 프로젝트의 것인지는 `access.resolve_scope` 가 본다.
"""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import Part, PartMember, ProjectMember, new_id
from app.schemas.part import PartMemberOut, PartOut, PartPatch
from app.time import now


def to_part(row: Part) -> PartOut:
    return PartOut.model_validate(row)


async def load_part(session: AsyncSession, part_id: str) -> Part:
    part = await session.get(Part, part_id)
    if part is None:
        raise not_found("PART_NOT_FOUND", "파트를 찾을 수 없습니다.")
    return part


async def _guard_name(session: AsyncSession, project_id: str, name: str, part_id: str) -> None:
    # 유니크에 맡기면 500 이다 — 보관한 파트까지 보고 먼저 409 로 거른다
    taken = await session.scalar(
        select(Part.id).where(Part.project_id == project_id, Part.name == name, Part.id != part_id)
    )
    if taken is not None:
        raise ApiError(
            409,
            "PART_NAME_TAKEN",
            "이 프로젝트에 같은 이름의 파트가 있습니다.",
            {"name": "같은 이름의 파트가 있습니다."},
        )


async def create_part(session: AsyncSession, project_id: str, name: str) -> PartOut:
    part = Part(id=new_id(), project_id=project_id, name=name, active=True, created_at=now())
    await _guard_name(session, project_id, name, part.id)
    session.add(part)
    await session.commit()
    return to_part(part)


async def patch_part(session: AsyncSession, part_id: str, payload: PartPatch) -> PartOut:
    part = await load_part(session, part_id)
    sent = payload.model_fields_set
    if "name" in sent and payload.name is not None and payload.name != part.name:
        await _guard_name(session, part.project_id, payload.name, part.id)
        part.name = payload.name
    if "active" in sent and payload.active is not None:
        part.active = payload.active
    await session.commit()
    return to_part(part)


async def add_member(session: AsyncSession, part_id: str, member_id: str) -> PartMemberOut:
    """넣기 (멱등). 그 프로젝트에 부여된 사람만 — 역할 · 활성은 따지지 않는다."""
    part = await load_part(session, part_id)
    granted = await session.get(ProjectMember, (part.project_id, member_id))
    if granted is None:
        raise bad_request("MEMBER_NOT_IN_PROJECT", "이 프로젝트에 부여되지 않은 사람입니다.")
    if await session.get(PartMember, (part_id, member_id)) is None:
        session.add(PartMember(part_id=part_id, member_id=member_id, created_at=now()))
    await session.commit()
    return PartMemberOut(part_id=part_id, member_id=member_id)


async def remove_member(session: AsyncSession, part_id: str, member_id: str) -> None:
    """빼기 (멱등). 없는 소속을 빼도 성공이다."""
    await load_part(session, part_id)
    await session.execute(
        delete(PartMember).where(PartMember.part_id == part_id, PartMember.member_id == member_id)
    )
    await session.commit()


async def leave_project_parts(session: AsyncSession, project_id: str, member_id: str) -> None:
    """프로젝트에서 빠진 사람은 그 프로젝트 파트들에서도 빠진다. 커밋은 부른 쪽이 한다."""
    await session.execute(
        delete(PartMember).where(
            PartMember.member_id == member_id,
            PartMember.part_id.in_(select(Part.id).where(Part.project_id == project_id)),
        )
    )


async def guard_part(
    session: AsyncSession, project_id: str, part_id: str | None, field: str = "partId"
) -> None:
    """본문의 `partId` 를 **새로** 달 때의 검사. 이미 달린 파트를 그대로 두는 수정은 부르지 않는다.

    다른 프로젝트의 파트는 복합 FK 가 500 으로 막는다 — 화면이 고칠 수 있는 400 으로 먼저 거른다.
    """
    if part_id is None:
        return
    part = await session.get(Part, part_id)
    if part is None or part.project_id != project_id:
        raise ApiError(
            400, "PART_NOT_FOUND", "파트를 찾을 수 없습니다.", {field: "파트를 찾을 수 없습니다."}
        )
    if not part.active:
        raise ApiError(
            400, "PART_ARCHIVED", "보관한 파트는 고를 수 없습니다.", {field: "보관한 파트입니다."}
        )

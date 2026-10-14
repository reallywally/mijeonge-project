from fastapi import APIRouter

from app.api.deps import ProjectAdmin, Session
from app.schemas.part import PartCreate, PartMemberOut, PartOut, PartPatch
from app.services import part as part_service

# 쓰기는 전부 프로젝트 관리자 · 시스템 관리자. 읽기는 스냅샷 한 방이라 GET 이 없다
router = APIRouter(tags=["part"])


@router.post("/projects/{project_id}/parts", status_code=201)
async def create_part(
    project_id: str, payload: PartCreate, scope: ProjectAdmin, session: Session
) -> PartOut:
    return await part_service.create_part(session, scope.project_id, payload.name)


@router.patch("/parts/{part_id}")
async def patch_part(
    part_id: str, payload: PartPatch, _: ProjectAdmin, session: Session
) -> PartOut:
    """이름 바꾸기 · 보관 · 되살리기. 지우는 길은 없다."""
    return await part_service.patch_part(session, part_id, payload)


@router.put("/parts/{part_id}/members/{member_id}")
async def add_part_member(
    part_id: str, member_id: str, _: ProjectAdmin, session: Session
) -> PartMemberOut:
    return await part_service.add_member(session, part_id, member_id)


@router.delete("/parts/{part_id}/members/{member_id}", status_code=204)
async def remove_part_member(
    part_id: str, member_id: str, _: ProjectAdmin, session: Session
) -> None:
    await part_service.remove_member(session, part_id, member_id)

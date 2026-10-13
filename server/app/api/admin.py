from fastapi import APIRouter, Depends

from app.api.deps import Session, require_system_admin
from app.schemas.auth import MemberAccountCreate, MemberAccountOut, MemberAccountPatch, PasswordSet
from app.services import member as member_service

# 사용자 관리는 시스템 관리자만 — 라우터 전체에 건다
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_system_admin)])


@router.get("/members")
async def list_members(session: Session) -> list[MemberAccountOut]:
    """비활성 포함, 이름 순."""
    return await member_service.list_accounts(session)


@router.post("/members", status_code=201)
async def create_member(payload: MemberAccountCreate, session: Session) -> MemberAccountOut:
    return await member_service.create_account(session, payload)


@router.patch("/members/{member_id}")
async def patch_member(
    member_id: str, payload: MemberAccountPatch, session: Session
) -> MemberAccountOut:
    """비활성으로 바꾸면 그 사람의 세션을 모두 끊는다."""
    return await member_service.patch_account(session, member_id, payload)


@router.put("/members/{member_id}/password", status_code=204)
async def set_password(member_id: str, payload: PasswordSet, session: Session) -> None:
    """잊었을 때 · 처음 로그인시킬 때. 그 사람의 세션을 모두 끊는다."""
    await member_service.set_password(session, member_id, payload.password)

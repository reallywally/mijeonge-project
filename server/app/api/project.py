from fastapi import APIRouter

from app.api.deps import CurrentActor, ProjectAdmin, ProjectScope, Session, SystemAdmin
from app.schemas.auth import ProjectMemberOut, ProjectMemberPut
from app.schemas.project import MemberOut, ProjectCreate, ProjectOut, ProjectPatch
from app.schemas.snapshot import SnapshotOut
from app.services import member as member_service
from app.services import project as project_service
from app.services import snapshot as snapshot_service

router = APIRouter(tags=["project"])


@router.get("/projects")
async def list_projects(actor: CurrentActor, session: Session) -> list[ProjectOut]:
    """내가 볼 수 있는 프로젝트만. 시스템 관리자는 전부."""
    return await project_service.list_projects(session, actor)


# 멤버는 프로젝트에 매이지 않는다 — 비활성까지 이름을 다 낸다(옛 담당자 이름을 찍어야 한다)
@router.get("/members")
async def list_members(session: Session) -> list[MemberOut]:
    return await project_service.list_members(session)


@router.post("/projects", status_code=201)
async def create_project(payload: ProjectCreate, _: SystemAdmin, session: Session) -> ProjectOut:
    """시스템 관리자만. 등록한 사람이 그 프로젝트의 관리자로 붙지는 않는다."""
    return await project_service.create_project(session, payload)


@router.patch("/projects/{project_id}")
async def patch_project(
    project_id: str, payload: ProjectPatch, _: ProjectAdmin, session: Session
) -> ProjectOut:
    return await project_service.rename_project(session, project_id, payload.name)


@router.get("/projects/{project_id}/snapshot")
async def get_snapshot(project_id: str, session: Session) -> SnapshotOut:
    """그 프로젝트의 레코드 전부. 화면의 `stores/data.ts` 가 들고 있는 것과 같은 모양이다."""
    return await snapshot_service.load_snapshot(session, project_id)


@router.get("/projects/{project_id}/members")
async def list_project_members(
    project_id: str, scope: ProjectScope, session: Session
) -> list[ProjectMemberOut]:
    """그 프로젝트의 user 도 부를 수 있다 — 담당자 고르는 자리가 쓴다."""
    return await member_service.list_project_members(session, scope.project_id)


@router.put("/projects/{project_id}/members/{member_id}")
async def grant_member(
    project_id: str,
    member_id: str,
    payload: ProjectMemberPut,
    scope: ProjectAdmin,
    session: Session,
) -> ProjectMemberOut:
    return await member_service.grant(session, scope.project_id, member_id, payload.role)


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
async def revoke_member(
    project_id: str, member_id: str, scope: ProjectAdmin, session: Session
) -> None:
    await member_service.revoke(session, scope.project_id, member_id)

from fastapi import APIRouter

from app.api.deps import CurrentActor, ProjectScope, Session
from app.schemas.check import CheckPendingCount, CheckRequestInput, CheckRequestOut
from app.services import check as check_service
from app.time import today_kst

# 보기 · 보내기는 그 프로젝트 멤버 누구나, 확인은 받은 사람만 (docs/api/check.md)
router = APIRouter(tags=["check"])


@router.get("/projects/{project_id}/checks")
async def list_checks(
    project_id: str, scope: ProjectScope, session: Session
) -> list[CheckRequestOut]:
    """그 프로젝트의 요청 전부. 받은 것 · 보낸 것 · 작업/안건별은 화면이 거른다."""
    return await check_service.list_checks(session, scope.project_id)


@router.post("/projects/{project_id}/checks", status_code=201)
async def send_checks(
    project_id: str, payload: CheckRequestInput, scope: ProjectScope, session: Session
) -> list[CheckRequestOut]:
    """보낸 사람은 로그인한 사람이다. '오늘' 은 한국 시간이다 — 기한은 사람이 고른 날짜라서."""
    return await check_service.send_checks(session, scope, payload, today=today_kst())


@router.post("/checks/{check_id}/confirm")
async def confirm_check(check_id: str, scope: ProjectScope, session: Session) -> CheckRequestOut:
    return await check_service.confirm_check(session, check_id, scope)


@router.get("/checks/pending-count")
async def pending_count(actor: CurrentActor, session: Session) -> CheckPendingCount:
    """경로에 프로젝트가 없다 — 경계는 서비스가 '지금 부여된 프로젝트' 로 건다."""
    return await check_service.pending_count(session, actor.id)

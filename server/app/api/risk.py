from fastapi import APIRouter

from app.api.deps import ProjectAdmin, ProjectScope, Session
from app.schemas.risk import DecisionRiskReport, RiskSettings
from app.services import risk as risk_service
from app.time import today_kst

# 읽기는 그 프로젝트 멤버 누구나, 기준 바꾸기는 프로젝트 관리자 · 시스템 관리자 (docs/api/risk.md)
router = APIRouter(tags=["risk"])


@router.get("/projects/{project_id}/risks")
async def get_risks(project_id: str, scope: ProjectScope, session: Session) -> DecisionRiskReport:
    """'오늘' 은 한국 시간이다 — 기한은 사람이 고른 날짜라서."""
    return await risk_service.decision_risks(session, scope.project_id, today=today_kst())


@router.get("/projects/{project_id}/risk-settings")
async def get_risk_settings(project_id: str, scope: ProjectScope, session: Session) -> RiskSettings:
    """바꾼 적이 없으면 기본값 — 404 를 내지 않는다."""
    return await risk_service.load_settings(session, scope.project_id)


@router.put("/projects/{project_id}/risk-settings")
async def put_risk_settings(
    project_id: str, payload: RiskSettings, scope: ProjectAdmin, session: Session
) -> RiskSettings:
    return await risk_service.save_settings(session, scope.project_id, payload)

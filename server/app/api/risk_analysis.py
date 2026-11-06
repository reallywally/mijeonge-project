from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import ProjectScope, Session
from app.schemas.risk_analysis import (
    ANALYSES_LIMIT,
    ANALYSES_LIMIT_MAX,
    RiskAnalysisOut,
    RiskAnalysisPage,
    RiskAnalysisPatch,
    RiskAnalysisSave,
)
from app.services import risk_analysis as analysis_service

# 보기 · 저장은 그 프로젝트 멤버 누구나, 제목 고치기는 작성자만, 지우기는 작성자 · 관리자
# (docs/api/risk-analysis.md). 임시 분석은 저장 말고는 어디에도 안 보인다
router = APIRouter(tags=["risk-analysis"])


@router.get("/projects/{project_id}/risk-analyses")
async def list_analyses(
    project_id: str,
    scope: ProjectScope,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=ANALYSES_LIMIT_MAX)] = ANALYSES_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RiskAnalysisPage:
    return await analysis_service.list_analyses(
        session, scope.project_id, limit=limit, offset=offset
    )


@router.post("/projects/{project_id}/risk-analyses", status_code=201)
async def save_analysis(
    project_id: str, payload: RiskAnalysisSave, scope: ProjectScope, session: Session
) -> RiskAnalysisOut:
    return await analysis_service.save_analysis(session, scope, payload)


@router.get("/risk-analyses/{analysis_id}")
async def get_analysis(analysis_id: str, scope: ProjectScope, session: Session) -> RiskAnalysisOut:
    return await analysis_service.get_analysis(session, analysis_id)


@router.patch("/risk-analyses/{analysis_id}")
async def rename_analysis(
    analysis_id: str, payload: RiskAnalysisPatch, scope: ProjectScope, session: Session
) -> RiskAnalysisOut:
    return await analysis_service.rename_analysis(session, analysis_id, scope, payload)


@router.delete("/risk-analyses/{analysis_id}", status_code=204)
async def delete_analysis(analysis_id: str, scope: ProjectScope, session: Session) -> None:
    await analysis_service.delete_analysis(session, analysis_id, scope)

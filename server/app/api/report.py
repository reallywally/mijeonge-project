from typing import Annotated

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.chat import get_chat_client, get_rate_limiter, ready_client, sse_response
from app.api.deps import ProjectScope, Session
from app.config import settings
from app.schemas.report import Report, ReportItem
from app.services import project as project_service
from app.services import report as report_service
from app.services.ratelimit import RateLimiter
from app.time import today_kst

# 만들기 · 보기는 그 프로젝트 멤버 누구나, 지우기만 좁다 (docs/api/report.md).
# 고치기는 없다 — 기록이다
router = APIRouter(tags=["report"])


@router.get("/projects/{project_id}/reports")
async def list_reports(project_id: str, scope: ProjectScope, session: Session) -> list[ReportItem]:
    return await report_service.list_reports(session, scope.project_id)


@router.post(
    "/projects/{project_id}/reports",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def create_report(
    project_id: str,
    request: Request,
    scope: ProjectScope,
    session: Session,
    client: Annotated[AsyncAnthropic | None, Depends(get_chat_client)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> StreamingResponse:
    """본문 없음. 계산 → facts → Claude 글 → 다 받으면 저장 → done. 스트림 전 실패는 JSON 이다.

    '오늘' 은 한국 시간이다. 작업이 없으면 Claude 를 안 부르니 키 · 분당 제한도 안 본다.
    """
    # 이름은 먼저 떠 둔다 — 근거를 모은 뒤 rollback 이 ORM 객체를 만료시킨다
    project_name = (await project_service.load_project(session, scope.project_id)).name
    today = today_kst()
    prepared = await report_service.prepare(session, scope.project_id, today=today)
    if prepared.context is None:
        return sse_response(
            report_service.empty(session, scope.project_id, scope.actor.id, prepared.facts)
        )
    ready = ready_client(request, client, limiter)
    return sse_response(
        report_service.write(
            ready,
            session,
            settings,
            project_id=scope.project_id,
            project_name=project_name,
            actor_id=scope.actor.id,
            prepared=prepared,
            today=today,
        )
    )


@router.get("/reports/{report_id}")
async def get_report(report_id: str, session: Session) -> Report:
    return await report_service.get_report(session, report_id)


@router.delete("/reports/{report_id}", status_code=204)
async def delete_report(report_id: str, scope: ProjectScope, session: Session) -> None:
    """만든 사람 · 그 프로젝트 관리자 · 시스템 관리자."""
    await report_service.delete_report(session, report_id, scope)

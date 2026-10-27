from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.chat import get_llm, get_rate_limiter, ready_llm
from app.api.deps import ProjectScope, Session
from app.llm import LLMProvider
from app.schemas.task import DependencySuggestionsOut, TaskDependencyOut
from app.services import dependency as dependency_service
from app.services import dependency_suggest
from app.services import project as project_service
from app.services.ratelimit import RateLimiter

# 선행 작업 (docs/api/task-flow.md). 선행 쪽 id 는 경계 검사(require_scope)의 이름이 아니다 —
# 같은 프로젝트인지는 서비스가 404 TASK_NOT_FOUND 로 본다
router = APIRouter(tags=["dependency"])


@router.put("/tasks/{task_id}/dependencies/{depends_on_id}")
async def put_dependency(
    task_id: str, depends_on_id: str, scope: ProjectScope, session: Session
) -> TaskDependencyOut:
    """멱등. 자기 · 상위 ↔ 하위 400, 순환 409, 20개까지."""
    return await dependency_service.put_dependency(session, task_id, depends_on_id, scope.actor.id)


@router.delete("/tasks/{task_id}/dependencies/{depends_on_id}", status_code=204)
async def delete_dependency(
    task_id: str, depends_on_id: str, scope: ProjectScope, session: Session
) -> None:
    await dependency_service.delete_dependency(session, task_id, depends_on_id, scope.actor.id)


@router.post("/projects/{project_id}/dependencies/suggest")
async def suggest_dependencies(
    project_id: str,
    request: Request,
    scope: ProjectScope,
    session: Session,
    llm: Annotated[LLMProvider | None, Depends(get_llm)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> DependencySuggestionsOut:
    """[AI 선행 관계 찾기]. 저장하지 않는다 — 화면이 줄마다 [적용](= PUT) 한다. 응답은 JSON 이다."""
    ready = ready_llm(request, llm, limiter)
    project_name = (await project_service.load_project(session, scope.project_id)).name
    return await dependency_suggest.suggest(session, ready, scope.project_id, project_name)

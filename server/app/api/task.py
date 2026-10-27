from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ProjectScope
from app.db import get_session
from app.schemas.task import (
    TaskBatchInput,
    TaskBatchResult,
    TaskCreate,
    TaskLinePatch,
    TaskOut,
    TaskPatch,
    TaskThreadLinkOut,
)
from app.services import task as task_service

router = APIRouter(tags=["task"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_task(
    project_id: str, payload: TaskCreate, scope: ProjectScope, session: Session
) -> TaskOut:
    return await task_service.create_task(session, project_id, payload, scope.actor.id)


@router.post("/projects/{project_id}/tasks/batch", status_code=201)
async def create_tasks(
    project_id: str, payload: TaskBatchInput, scope: ProjectScope, session: Session
) -> TaskBatchResult:
    """챗봇 초안을 한 번에 등록한다. 한 트랜잭션 — 하나라도 틀리면 아무것도 안 남는다."""
    return await task_service.create_tasks(session, project_id, payload, scope.actor.id)


@router.patch("/tasks/{task_id}")
async def patch_task(
    task_id: str, payload: TaskPatch, scope: ProjectScope, session: Session
) -> TaskOut:
    """부분 수정 — 상태 · 담당자 · 기간 · 연관 작업이 다 이 하나로 들어온다."""
    return await task_service.patch_task(session, task_id, payload, scope.actor.id)


@router.patch("/tasks/{task_id}/lines/{line_id}")
async def patch_task_line(
    task_id: str, line_id: str, payload: TaskLinePatch, scope: ProjectScope, session: Session
) -> TaskOut:
    return await task_service.set_line_done(session, task_id, line_id, payload.done, scope.actor.id)


@router.put("/tasks/{task_id}/threads/{thread_id}")
async def link_thread(
    task_id: str, thread_id: str, scope: ProjectScope, session: Session
) -> TaskThreadLinkOut:
    return await task_service.link_thread(session, task_id, thread_id, scope.actor.id)


@router.delete("/tasks/{task_id}/threads/{thread_id}", status_code=204)
async def unlink_thread(
    task_id: str, thread_id: str, scope: ProjectScope, session: Session
) -> None:
    await task_service.unlink_thread(session, task_id, thread_id, scope.actor.id)

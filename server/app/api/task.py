from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.task import (
    MeetingTaskLinkOut,
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
async def create_task(project_id: str, payload: TaskCreate, session: Session) -> TaskOut:
    return await task_service.create_task(session, project_id, payload)


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, payload: TaskPatch, session: Session) -> TaskOut:
    """부분 수정 — 상태 · 담당자 · 기간 · 상위 작업이 다 이 하나로 들어온다."""
    return await task_service.patch_task(session, task_id, payload)


@router.patch("/tasks/{task_id}/lines/{line_id}")
async def patch_task_line(
    task_id: str, line_id: str, payload: TaskLinePatch, session: Session
) -> TaskOut:
    return await task_service.set_line_done(session, task_id, line_id, payload.done)


@router.put("/tasks/{task_id}/threads/{thread_id}")
async def link_thread(task_id: str, thread_id: str, session: Session) -> TaskThreadLinkOut:
    return await task_service.link_thread(session, task_id, thread_id)


@router.delete("/tasks/{task_id}/threads/{thread_id}", status_code=204)
async def unlink_thread(task_id: str, thread_id: str, session: Session) -> None:
    await task_service.unlink_thread(session, task_id, thread_id)


@router.put("/tasks/{task_id}/meetings/{meeting_id}")
async def link_meeting(task_id: str, meeting_id: str, session: Session) -> MeetingTaskLinkOut:
    return await task_service.link_meeting(session, task_id, meeting_id)


@router.delete("/tasks/{task_id}/meetings/{meeting_id}", status_code=204)
async def unlink_meeting(task_id: str, meeting_id: str, session: Session) -> None:
    await task_service.unlink_meeting(session, task_id, meeting_id)

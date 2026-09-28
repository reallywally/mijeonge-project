from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.task import MeetingTaskLinkOut
from app.services import meeting as meeting_service

router = APIRouter(tags=["meeting"])

Session = Annotated[AsyncSession, Depends(get_session)]


# 작업 상세에서 거는 것과 같은 링크다. 방향만 다르다
@router.put("/meetings/{meeting_id}/tasks/{task_id}")
async def link_task(meeting_id: str, task_id: str, session: Session) -> MeetingTaskLinkOut:
    return await meeting_service.link_task(session, meeting_id, task_id)


@router.delete("/meetings/{meeting_id}/tasks/{task_id}", status_code=204)
async def unlink_task(meeting_id: str, task_id: str, session: Session) -> None:
    await meeting_service.unlink_task(session, meeting_id, task_id)

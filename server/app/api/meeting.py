from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.meeting import MeetingCreate, MeetingSaved
from app.schemas.task import MeetingTaskLinkOut
from app.services import meeting as meeting_service

router = APIRouter(tags=["meeting"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/projects/{project_id}/meetings", status_code=201)
async def save_meeting(project_id: str, payload: MeetingCreate, session: Session) -> MeetingSaved:
    """새 회의 저장 — 안건 등록 · 회의 · 줄 여럿 · 안건 상태 변경이 한 트랜잭션이다.

    회의 중에 만든 안건은 화면이 tempId 로 가리킨다. 실제 id 는 응답의 threadIdByTempId 에 있다.
    """
    return await meeting_service.save_meeting(session, project_id, payload)


# 작업 상세에서 거는 것과 같은 링크다. 방향만 다르다
@router.put("/meetings/{meeting_id}/tasks/{task_id}")
async def link_task(meeting_id: str, task_id: str, session: Session) -> MeetingTaskLinkOut:
    return await meeting_service.link_task(session, meeting_id, task_id)


@router.delete("/meetings/{meeting_id}/tasks/{task_id}", status_code=204)
async def unlink_task(meeting_id: str, task_id: str, session: Session) -> None:
    await meeting_service.unlink_task(session, meeting_id, task_id)

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.thread import EntryAdded, EntryCreate, ThreadCreate, ThreadOut
from app.services import thread as thread_service

router = APIRouter(tags=["thread"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/projects/{project_id}/threads", status_code=201)
async def create_thread(project_id: str, payload: ThreadCreate, session: Session) -> ThreadOut:
    return await thread_service.create_thread(session, project_id, payload)


@router.post("/threads/{thread_id}/entries", status_code=201)
async def add_outside_entry(thread_id: str, payload: EntryCreate, session: Session) -> EntryAdded:
    """회의 밖 줄 — meeting_id 는 서버가 null 로 고정한다.

    줄 하나가 안건 상태까지 바꾸므로 entry 와 thread 를 같이 돌려준다.
    """
    return await thread_service.add_outside_entry(session, thread_id, payload)

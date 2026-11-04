from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ProjectScope
from app.db import get_session
from app.schemas.thread import (
    DecisionItemAdded,
    DecisionItemCreate,
    DecisionItemOut,
    DecisionItemPatch,
    DecisionItemRemoved,
    EntryAdded,
    EntryCreate,
    EntryOut,
    EntryPatch,
    EntryRemoved,
    ThreadCreate,
    ThreadOut,
    ThreadPatch,
)
from app.services import thread as thread_service

router = APIRouter(tags=["thread"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/projects/{project_id}/threads", status_code=201)
async def create_thread(
    project_id: str, payload: ThreadCreate, scope: ProjectScope, session: Session
) -> ThreadOut:
    return await thread_service.create_thread(session, project_id, payload, scope.actor.id)


@router.patch("/threads/{thread_id}")
async def patch_thread(
    thread_id: str, payload: ThreadPatch, scope: ProjectScope, session: Session
) -> ThreadOut:
    """부분 수정 — 상태는 못 바꾼다. 상태는 이력으로만 바뀐다."""
    return await thread_service.patch_thread(session, thread_id, payload, scope)


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, scope: ProjectScope, session: Session) -> None:
    """생성자 · 담당자 · 프로젝트 관리자 · 시스템 관리자. 떼어낸 하위 안건이 있으면 409."""
    await thread_service.delete_thread(session, thread_id, scope)


@router.post("/threads/{thread_id}/items", status_code=201)
async def add_item(
    thread_id: str, payload: DecisionItemCreate, scope: ProjectScope, session: Session
) -> DecisionItemAdded:
    """결정 항목 더하기 — 프로젝트 멤버 누구나. 안건 상태가 바뀔 수 있어 안건도 같이 준다."""
    return await thread_service.add_item(session, thread_id, payload, scope.actor.id)


@router.patch("/threads/{thread_id}/items/{item_id}")
async def patch_item(
    thread_id: str,
    item_id: str,
    payload: DecisionItemPatch,
    scope: ProjectScope,
    session: Session,
) -> DecisionItemOut:
    """항목 이름 바꾸기 — 등록한 사람 · 안건을 고칠 수 있는 사람."""
    return await thread_service.patch_item(session, thread_id, item_id, payload, scope)


@router.delete("/threads/{thread_id}/items/{item_id}")
async def delete_item(
    thread_id: str, item_id: str, scope: ProjectScope, session: Session
) -> DecisionItemRemoved:
    """항목 지우기(논리) — 안건 상태를 다시 세어 안건을 돌려준다."""
    return await thread_service.delete_item(session, thread_id, item_id, scope)


@router.post("/threads/{thread_id}/entries", status_code=201)
async def add_entry(
    thread_id: str, payload: EntryCreate, scope: ProjectScope, session: Session
) -> EntryAdded:
    """이력을 남기는 유일한 길.

    줄 하나가 안건 상태까지 바꾸므로 entry 와 thread 를 같이 돌려준다.
    """
    return await thread_service.add_entry(session, thread_id, payload, scope.actor.id)


@router.patch("/threads/{thread_id}/entries/{entry_id}")
async def patch_entry(
    thread_id: str, entry_id: str, payload: EntryPatch, scope: ProjectScope, session: Session
) -> EntryOut:
    """이력 한 줄의 글(text · note) 고치기. kind 는 못 바꾼다 — 상태는 그대로다."""
    return await thread_service.patch_entry(session, thread_id, entry_id, payload, scope)


@router.delete("/threads/{thread_id}/entries/{entry_id}")
async def delete_entry(
    thread_id: str, entry_id: str, scope: ProjectScope, session: Session
) -> EntryRemoved:
    """이력 한 줄 지우기 — 안건 상태를 남은 줄로 다시 세어 안건을 돌려준다."""
    return await thread_service.delete_entry(session, thread_id, entry_id, scope)

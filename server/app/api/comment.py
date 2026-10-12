from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas.task import TaskCommentCreate, TaskCommentOut, TaskCommentPatch
from app.services import comment as comment_service

router = APIRouter(tags=["comment"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/tasks/{task_id}/comments")
async def list_comments(task_id: str, session: Session) -> list[TaskCommentOut]:
    return await comment_service.list_comments(session, task_id)


@router.post("/tasks/{task_id}/comments", status_code=201)
async def add_comment(task_id: str, payload: TaskCommentCreate, session: Session) -> TaskCommentOut:
    return await comment_service.add_comment(session, task_id, payload)


# 작성자 일치는 안 본다 — 로그인이 없다. 자기 댓글에만 메뉴를 여는 건 화면이다
@router.patch("/comments/{comment_id}")
async def edit_comment(
    comment_id: str, payload: TaskCommentPatch, session: Session
) -> TaskCommentOut:
    return await comment_service.edit_comment(session, comment_id, payload)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: str, session: Session) -> None:
    await comment_service.delete_comment(session, comment_id)

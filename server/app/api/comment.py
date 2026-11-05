from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ProjectScope
from app.db import get_session
from app.schemas.task import TaskCommentCreate, TaskCommentOut, TaskCommentPatch
from app.schemas.test import TestCommentCreate, TestCommentOut, TestCommentPatch
from app.services import comment as comment_service

router = APIRouter(tags=["comment"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/tasks/{task_id}/comments")
async def list_comments(task_id: str, session: Session) -> list[TaskCommentOut]:
    return await comment_service.list_comments(session, task_id)


@router.post("/tasks/{task_id}/comments", status_code=201)
async def add_comment(
    task_id: str, payload: TaskCommentCreate, scope: ProjectScope, session: Session
) -> TaskCommentOut:
    """작성자는 로그인한 사람이다 — 본문에 authorId 를 실어 와도 무시한다."""
    return await comment_service.add_comment(session, task_id, scope.actor.id, payload)


@router.patch("/comments/{comment_id}")
async def edit_comment(
    comment_id: str, payload: TaskCommentPatch, scope: ProjectScope, session: Session
) -> TaskCommentOut:
    """고치기는 작성자만."""
    return await comment_service.edit_comment(session, comment_id, scope, payload)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: str, scope: ProjectScope, session: Session) -> None:
    """지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자."""
    await comment_service.delete_comment(session, comment_id, scope)


# 테스트 조치 내역 — 작업 댓글과 같은 규칙 (docs/api/test-comment.md)


@router.get("/tests/{test_id}/comments")
async def list_test_comments(test_id: str, session: Session) -> list[TestCommentOut]:
    return await comment_service.list_test_comments(session, test_id)


@router.post("/tests/{test_id}/comments", status_code=201)
async def add_test_comment(
    test_id: str, payload: TestCommentCreate, scope: ProjectScope, session: Session
) -> TestCommentOut:
    """작성자는 로그인한 사람이다 — 본문에 authorId 를 실어 와도 무시한다."""
    return await comment_service.add_test_comment(session, test_id, scope.actor.id, payload)


@router.patch("/test-comments/{test_comment_id}")
async def edit_test_comment(
    test_comment_id: str, payload: TestCommentPatch, scope: ProjectScope, session: Session
) -> TestCommentOut:
    """고치기는 작성자만."""
    return await comment_service.edit_test_comment(session, test_comment_id, scope, payload)


@router.delete("/test-comments/{test_comment_id}", status_code=204)
async def delete_test_comment(test_comment_id: str, scope: ProjectScope, session: Session) -> None:
    """지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자."""
    await comment_service.delete_test_comment(session, test_comment_id, scope)

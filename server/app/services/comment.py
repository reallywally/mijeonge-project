"""작업 댓글 — 목록 · 등록 · 수정 · 삭제.

작성자는 로그인한 사람이다. 고치기는 작성자만, 지우기는 작성자 · 그 프로젝트 관리자 ·
시스템 관리자다 (docs/api/auth.md '이미 있는 API 에서 바뀌는 것').
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import TaskComment, new_id
from app.schemas.task import TaskCommentCreate, TaskCommentOut, TaskCommentPatch
from app.services.access import Scope, forbidden
from app.services.task import load_task
from app.time import now


async def _load_comment(session: AsyncSession, comment_id: str) -> TaskComment:
    found = await session.execute(select(TaskComment).where(TaskComment.id == comment_id))
    comment = found.scalar_one_or_none()
    if comment is None:
        raise not_found("COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    return comment


async def list_comments(session: AsyncSession, task_id: str) -> list[TaskCommentOut]:
    # 없는 작업이면 404 다 — 빈 배열은 '댓글이 없는 작업' 과 구분이 안 된다
    await load_task(session, task_id)
    rows = await session.execute(
        select(TaskComment).where(TaskComment.task_id == task_id).order_by(TaskComment.seq)
    )
    return [TaskCommentOut.model_validate(row) for row in rows.scalars().all()]


async def add_comment(
    session: AsyncSession, task_id: str, author_id: str, payload: TaskCommentCreate
) -> TaskCommentOut:
    await load_task(session, task_id)
    comment = TaskComment(
        id=new_id(),
        task_id=task_id,
        author_id=author_id,
        body=payload.body,
        created_at=now(),
        edited_at=None,
    )
    session.add(comment)
    await session.commit()
    return TaskCommentOut.model_validate(comment)


async def edit_comment(
    session: AsyncSession, comment_id: str, scope: Scope, payload: TaskCommentPatch
) -> TaskCommentOut:
    comment = await _load_comment(session, comment_id)
    # 남의 말을 고쳐 쓰면 그 사람이 한 말이 된다 — 관리자도 못 고친다
    if comment.author_id != scope.actor.id:
        raise forbidden()
    comment.body = payload.body
    comment.edited_at = now()
    await session.commit()
    return TaskCommentOut.model_validate(comment)


async def delete_comment(session: AsyncSession, comment_id: str, scope: Scope) -> None:
    comment = await _load_comment(session, comment_id)
    if comment.author_id != scope.actor.id and not scope.can_manage:
        raise forbidden()
    await session.delete(comment)
    await session.commit()

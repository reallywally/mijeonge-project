"""작업 댓글 — 목록 · 등록 · 수정 · 삭제.

**작성자 일치를 서버가 따지지 않는다.** 로그인이 없어 요청이 누구 것인지 가릴 수 없다 —
자기 댓글에만 수정 · 삭제 메뉴를 보이는 것은 화면 몫이다. 인증이 붙으면 여기서 막는다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import bad_request, not_found
from app.models import Member, TaskComment, new_id
from app.schemas.task import TaskCommentCreate, TaskCommentOut, TaskCommentPatch
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
    session: AsyncSession, task_id: str, payload: TaskCommentCreate
) -> TaskCommentOut:
    await load_task(session, task_id)
    # FK 에 맡기면 500 으로 떨어진다 — 화면이 고칠 수 있는 400 으로 먼저 거른다
    if payload.author_id is not None and await session.get(Member, payload.author_id) is None:
        raise bad_request("COMMENT_AUTHOR_NOT_FOUND", "작성자를 찾을 수 없습니다.")

    comment = TaskComment(
        id=new_id(),
        task_id=task_id,
        author_id=payload.author_id,
        body=payload.body,
        created_at=now(),
        edited_at=None,
    )
    session.add(comment)
    await session.commit()
    return TaskCommentOut.model_validate(comment)


async def edit_comment(
    session: AsyncSession, comment_id: str, payload: TaskCommentPatch
) -> TaskCommentOut:
    comment = await _load_comment(session, comment_id)
    comment.body = payload.body
    comment.edited_at = now()
    await session.commit()
    return TaskCommentOut.model_validate(comment)


async def delete_comment(session: AsyncSession, comment_id: str) -> None:
    comment = await _load_comment(session, comment_id)
    await session.delete(comment)
    await session.commit()

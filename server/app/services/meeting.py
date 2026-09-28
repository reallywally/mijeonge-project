"""회의 쪽 서비스. 지금은 링크와 변환뿐이다 — 새 회의 저장은 3-1 에서 여기 붙는다.

회의 ↔ 작업 링크는 작업 상세에서 거는 것과 **같은 링크**다. 방향만 다르므로
`services/task.py` 의 함수를 그대로 부른다 — 두 벌로 갈리면 한쪽만 고치는 날이 온다.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meeting
from app.schemas.meeting import MeetingMemoOut, MeetingOut
from app.schemas.task import MeetingTaskLinkOut
from app.services import task as task_service


def to_meeting(row: Meeting) -> MeetingOut:
    return MeetingOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        date=row.date,
        attendee_ids=sorted(attendee.member_id for attendee in row.attendees),
        memos=[
            MeetingMemoOut(id=memo.id, text=memo.text, promoted_thread_id=memo.promoted_thread_id)
            for memo in row.memos
        ],
    )


async def link_task(session: AsyncSession, meeting_id: str, task_id: str) -> MeetingTaskLinkOut:
    return await task_service.link_meeting(session, task_id, meeting_id)


async def unlink_task(session: AsyncSession, meeting_id: str, task_id: str) -> None:
    await task_service.unlink_meeting(session, task_id, meeting_id)

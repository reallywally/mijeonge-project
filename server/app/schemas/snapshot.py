from app.schemas.base import Schema
from app.schemas.meeting import MeetingOut
from app.schemas.task import MeetingTaskLinkOut, TaskOut, TaskThreadLinkOut
from app.schemas.thread import EntryOut, ThreadOut


class SnapshotOut(Schema):
    """한 프로젝트의 레코드 전부.

    `web/src/stores/data.ts` 가 들고 있는 것과 같은 모양이다 — 목록 계산은 여전히 화면이 한다.
    **배열 순서가 곧 화면 순서다**(`stores/thread.ts` 의 seqNo 가 배열 인덱스다) — 서비스가 정한다.
    """

    threads: list[ThreadOut]
    entries: list[EntryOut]
    meetings: list[MeetingOut]
    tasks: list[TaskOut]
    task_thread_links: list[TaskThreadLinkOut]
    meeting_task_links: list[MeetingTaskLinkOut]

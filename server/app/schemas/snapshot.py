from app.schemas.base import Schema
from app.schemas.project import ProjectOut
from app.schemas.task import TaskOut, TaskThreadLinkOut
from app.schemas.thread import EntryOut, ThreadOut


class SnapshotOut(Schema):
    """한 프로젝트의 레코드 전부.

    `web/src/stores/data.ts` 가 들고 있는 것과 같은 모양이다 — 목록 계산은 여전히 화면이 한다.
    **배열 순서가 곧 화면 순서다**(`stores/thread.ts` 의 seqNo 가 배열 인덱스다) — 서비스가 정한다.
    """

    # 고른 프로젝트 자신 (API.md Q7) — 딥링크로 바로 들어와도 헤더가 서고,
    # 프로젝트를 빨리 바꿨을 때 늦게 온 옛 응답을 id 로 가릴 수 있다
    project: ProjectOut
    threads: list[ThreadOut]
    entries: list[EntryOut]
    tasks: list[TaskOut]
    task_thread_links: list[TaskThreadLinkOut]

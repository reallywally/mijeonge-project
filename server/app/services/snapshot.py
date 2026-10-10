"""프로젝트 스냅샷 — 그 프로젝트의 레코드 전부를 한 번에 준다.

지금 프론트 스토어가 "레코드를 다 들고 화면에서 계산"하는 구조라 그 모양대로 주는 것이
제일 적게 고친다. 목록 페이징 · 필터를 서버로 옮기는 건 5단계다.

**배열 순서까지가 계약이다.** 안건 목록(`stores/thread.ts` 의 `rows`)과 작업 목록에는
정렬이 아예 없어서 배열 순서가 곧 화면 순서고, 안건 이력은 같은 날짜의 줄을 배열 인덱스로
가른다(`stores/thread.ts` 의 seqNo). 그래서 **등록 순서(`seq`)** 로 내보낸다 —
`created_at` 은 날짜뿐이라 같은 날 여러 줄의 순서를 못 가린다.

레코드 → 응답 변환(`to_thread` · `to_task` · `to_entry`)은 도메인 서비스에 있다.
쓰기 API 도 바뀐 레코드를 같은 모양으로 돌려주므로 변환이 두 벌이 되면 안 된다.
"""

from collections.abc import Sequence

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, Task, TaskThreadLink, Thread
from app.schemas.project import ProjectOut
from app.schemas.snapshot import SnapshotOut
from app.schemas.task import TaskThreadLinkOut
from app.services import project as project_service
from app.services.task import to_task
from app.services.thread import to_entry, to_thread


async def _all[T](session: AsyncSession, query: Select[tuple[T]]) -> Sequence[T]:
    return (await session.execute(query)).scalars().all()


async def load_snapshot(session: AsyncSession, project_id: str) -> SnapshotOut:
    # 없는 프로젝트면 여기서 404 다 — 빈 배열 넷은 '레코드가 없는 프로젝트' 와 구분이 안 된다
    project = await project_service.load_project(session, project_id)
    threads = await _all(
        session,
        select(Thread).where(Thread.project_id == project_id).order_by(Thread.seq),
    )
    entries = await _all(
        session,
        select(Entry)
        .join(Thread, Thread.id == Entry.thread_id)
        .where(Thread.project_id == project_id)
        .order_by(Entry.seq),
    )
    tasks = await _all(
        session, select(Task).where(Task.project_id == project_id).order_by(Task.seq)
    )
    # 링크는 양쪽이 같은 프로젝트라 project_id 하나로 갈린다 (API.md Q13)
    task_threads = await _all(
        session,
        select(TaskThreadLink)
        .where(TaskThreadLink.project_id == project_id)
        .order_by(TaskThreadLink.task_id, TaskThreadLink.thread_id),
    )

    return SnapshotOut(
        project=ProjectOut.model_validate(project),
        threads=[to_thread(row) for row in threads],
        entries=[to_entry(row) for row in entries],
        tasks=[to_task(row) for row in tasks],
        task_thread_links=[TaskThreadLinkOut.model_validate(row) for row in task_threads],
    )

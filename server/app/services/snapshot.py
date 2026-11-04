"""프로젝트 스냅샷 — 그 프로젝트의 레코드 전부를 한 번에 준다.

지금 프론트 스토어가 "레코드를 다 들고 화면에서 계산"하는 구조라 그 모양대로 주는 것이
제일 적게 고친다. 목록 페이징 · 필터를 서버로 옮기는 건 5단계다.

**배열 순서까지가 계약이다.** 안건 목록(`stores/agenda.ts` 의 `rows`)과 작업 목록에는
정렬이 아예 없어서 배열 순서가 곧 화면 순서다. 그래서 **등록 순서(`seq`)** 로 내보낸다.

레코드 → 응답 변환(`to_agenda` · `to_task`)은 도메인 서비스에 있다.
쓰기 API 도 바뀐 레코드를 같은 모양으로 돌려주므로 변환이 두 벌이 되면 안 된다.
"""

from collections.abc import Sequence

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agenda, Part, PartMember, Task, TaskAgendaLink
from app.schemas.part import PartMemberOut
from app.schemas.project import ProjectOut
from app.schemas.snapshot import SnapshotOut
from app.schemas.task import TaskAgendaLinkOut
from app.services import project as project_service
from app.services.access import live_agenda_ids, live_task_ids
from app.services.agenda import to_agenda
from app.services.part import to_part
from app.services.task import comment_counts, since_or_created, status_since_map, to_task


async def _all[T](session: AsyncSession, query: Select[tuple[T]]) -> Sequence[T]:
    return (await session.execute(query)).scalars().all()


async def load_snapshot(session: AsyncSession, project_id: str) -> SnapshotOut:
    # 없는 프로젝트면 여기서 404 다 — 빈 배열 넷은 '레코드가 없는 프로젝트' 와 구분이 안 된다
    project = await project_service.load_project(session, project_id)
    agendas = await _all(
        session,
        select(Agenda)
        .where(Agenda.project_id == project_id, Agenda.is_deleted.is_(False))
        .order_by(Agenda.seq),
    )
    tasks = await _all(
        session,
        select(Task)
        .where(Task.project_id == project_id, Task.is_deleted.is_(False))
        .order_by(Task.seq),
    )
    counts = await comment_counts(session, project_id)
    since = await status_since_map(session, project_id)
    # 링크는 양쪽이 같은 프로젝트라 project_id 하나로 갈린다 (API.md Q13)
    task_agendas = await _all(
        session,
        select(TaskAgendaLink)
        .where(
            TaskAgendaLink.project_id == project_id,
            # 지운 작업 · 안건의 링크는 남아 있다 — 화면에는 없는 것처럼
            TaskAgendaLink.task_id.in_(live_task_ids()),
            TaskAgendaLink.agenda_id.in_(live_agenda_ids()),
        )
        .order_by(TaskAgendaLink.task_id, TaskAgendaLink.agenda_id),
    )
    parts = await _all(
        session,
        select(Part).where(Part.project_id == project_id).order_by(Part.name, Part.id),
    )
    part_members = await _all(
        session,
        select(PartMember)
        .join(Part, Part.id == PartMember.part_id)
        .where(Part.project_id == project_id)
        .order_by(PartMember.part_id, PartMember.member_id),
    )

    return SnapshotOut(
        project=ProjectOut.model_validate(project),
        agendas=[to_agenda(row) for row in agendas],
        tasks=[to_task(row, counts.get(row.id, 0), since_or_created(since, row)) for row in tasks],
        task_agenda_links=[TaskAgendaLinkOut.model_validate(row) for row in task_agendas],
        parts=[to_part(row) for row in parts],
        part_members=[PartMemberOut.model_validate(row) for row in part_members],
    )

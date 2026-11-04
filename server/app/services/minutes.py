"""회의록 — 게시판(쓰기 · 읽기 · 고치기 · 지우기)과 초안의 검사 · 등록. 계약은 `minutes.md`.

고치기는 작성자만, 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자다 — 작업 댓글과 같은 경계.
검사(`minutes_problems`)는 Claude 의 `propose_minutes`(`services/minutes_draft.py`)와
`POST /api/minutes/{id}/apply` 가 **같은 것**을 쓴다 — 챗봇 `propose_tasks` ↔ `tasks/batch` 처럼.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Agenda, Minutes, Project, Task, new_id
from app.schemas.minutes import (
    MINUTES_AGENDAS_MAX,
    MINUTES_TASKS_MAX,
    MINUTES_UPDATES_MAX,
    MinutesApplyInput,
    MinutesApplyResult,
    MinutesCreate,
    MinutesItem,
    MinutesOut,
    MinutesPatch,
    ProposedAgenda,
    ProposedMinutesTask,
    ProposedUpdate,
)
from app.schemas.task import TaskAgendaLinkOut, TaskCreate
from app.services import access
from app.services import agenda as agenda_service
from app.services import history as history_service
from app.services import part as part_service
from app.services import project as project_service
from app.services import task as task_service
from app.services.access import Scope, forbidden
from app.time import now

OWNER_MISSING = "담당자를 찾을 수 없습니다."
AGENDA_MISSING = "안건을 찾을 수 없습니다."
FORBIDDEN_UPDATE = "이 안건의 결정내용 · 상태를 바꿀 권한이 없습니다."

Rows = tuple[list[ProposedAgenda], list[ProposedUpdate], list[ProposedMinutesTask]]


async def load_minutes(session: AsyncSession, minutes_id: str) -> Minutes:
    found = await session.execute(select(Minutes).where(Minutes.id == minutes_id))
    minutes = found.scalar_one_or_none()
    if minutes is None:
        raise not_found("MINUTES_NOT_FOUND", "회의록을 찾을 수 없습니다.")
    return minutes


async def list_minutes(session: AsyncSession, project_id: str) -> list[MinutesItem]:
    """그 프로젝트의 회의록 전부 — 회의 날짜 내림차순(없으면 맨 뒤) → seq 내림차순."""
    rows = await session.execute(
        select(Minutes)
        .where(Minutes.project_id == project_id)
        .order_by(Minutes.meeting_date.desc().nulls_last(), Minutes.seq.desc())
    )
    return [MinutesItem.model_validate(row) for row in rows.scalars().all()]


async def create_minutes(
    session: AsyncSession, project_id: str, author_id: str, payload: MinutesCreate
) -> MinutesOut:
    written = now()
    minutes = Minutes(
        id=new_id(),
        project_id=project_id,
        title=payload.title,
        meeting_date=payload.meeting_date,
        body=payload.body,
        summary="",
        author_id=author_id,
        created_at=written,
        updated_at=written,
    )
    session.add(minutes)
    await session.commit()
    return MinutesOut.model_validate(minutes)


async def get_minutes(session: AsyncSession, minutes_id: str) -> MinutesOut:
    return MinutesOut.model_validate(await load_minutes(session, minutes_id))


async def edit_minutes(
    session: AsyncSession, minutes_id: str, scope: Scope, payload: MinutesPatch
) -> MinutesOut:
    minutes = await load_minutes(session, minutes_id)
    # 남의 회의록을 고쳐 쓰면 그 사람이 적은 기록이 된다 — 관리자도 못 고친다
    if minutes.author_id != scope.actor.id:
        raise forbidden()
    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        minutes.title = payload.title
    if "meeting_date" in sent:
        minutes.meeting_date = payload.meeting_date
    if "body" in sent and payload.body is not None:
        minutes.body = payload.body
    if sent:
        minutes.updated_at = now()
    await session.commit()
    return MinutesOut.model_validate(minutes)


async def delete_minutes(session: AsyncSession, minutes_id: str, scope: Scope) -> None:
    """회의록만 지운다. 거기서 등록한 줄은 남고 출처만 빈다."""
    minutes = await load_minutes(session, minutes_id)
    if minutes.author_id != scope.actor.id and not scope.can_manage:
        raise forbidden()
    # FK 의 ON DELETE SET NULL 과 같은 일을 먼저 한다 — 세션에 올라 있는 줄도 같이 비게
    for model in (Agenda, Task):
        await session.execute(
            update(model).where(model.minutes_id == minutes.id).values(minutes_id=None)
        )
    await session.delete(minutes)
    await session.commit()


def normalize(
    agendas: Sequence[ProposedAgenda],
    updates: Sequence[ProposedUpdate],
    tasks: Sequence[ProposedMinutesTask],
) -> Rows:
    """제목 · 결정내용의 앞뒤 공백을 뗀다. 검사 전에 한 번."""
    return (
        [
            agenda.model_copy(
                update={
                    "title": agenda.title.strip(),
                    "decision": agenda.decision.strip(),
                    # 담당자를 정했으면 회의록에서 부른 말은 필요 없다 — ownerId 가 null 일 때만
                    "owner_hint": "" if agenda.owner_id is not None else agenda.owner_hint.strip(),
                }
            )
            for agenda in agendas
        ],
        [row.model_copy(update={"decision": row.decision.strip()}) for row in updates],
        [
            task.model_copy(
                update={
                    "title": task.title.strip(),
                    "owner_hint": "" if task.owner_id is not None else task.owner_hint.strip(),
                }
            )
            for task in tasks
        ],
    )


def shape_problems(
    agendas: Sequence[ProposedAgenda],
    updates: Sequence[ProposedUpdate],
    tasks: Sequence[ProposedMinutesTask],
) -> dict[str, str]:
    """DB 를 안 보는 규칙. 자리는 `agendas.0.title` · `tasks.1.agendaTempIds.0` 처럼 짚는다."""
    problems: dict[str, str] = {}
    if len(agendas) > MINUTES_AGENDAS_MAX:
        problems["agendas"] = f"새 안건은 한 번에 {MINUTES_AGENDAS_MAX}개까지입니다."
    if len(updates) > MINUTES_UPDATES_MAX:
        problems["updates"] = f"기존 안건 결정은 한 번에 {MINUTES_UPDATES_MAX}개까지입니다."
    if len(tasks) > MINUTES_TASKS_MAX:
        problems["tasks"] = f"작업은 한 번에 {MINUTES_TASKS_MAX}개까지입니다."
    if not agendas and not updates and not tasks:
        # 어느 한 묶음의 자리가 아니다 — 오류 처리기가 요청 전체에 쓰는 이름과 같다
        problems["요청"] = "등록할 것이 하나도 없습니다."
    if problems:
        return problems

    taken: set[str] = set()
    for index, agenda in enumerate(agendas):
        at = f"agendas.{index}"
        if not agenda.temp_id.strip():
            problems[f"{at}.tempId"] = "값을 입력해 주세요."
        elif agenda.temp_id in taken:
            problems[f"{at}.tempId"] = "초안의 다른 줄과 tempId 가 겹칩니다."
        taken.add(agenda.temp_id)
        if not agenda.title:
            problems[f"{at}.title"] = "제목을 입력해 주세요."
    new_agendas = {agenda.temp_id for agenda in agendas}

    # 한 안건에 갈아끼우기는 하나까지 — 둘이면 어느 글이 남을지 요청 순서에 달린다
    seen: set[str] = set()
    for index, row in enumerate(updates):
        if row.agenda_id in seen:
            problems[f"updates.{index}.agendaId"] = "한 안건의 결정은 한 줄로 합쳐 주세요."
        seen.add(row.agenda_id)

    # 작업 줄의 규칙은 일괄 등록 그대로다 — 개수만 회의록의 상한(30)을 따른다
    problems.update(task_service.task_problems(tasks, taken=taken))
    for index, task in enumerate(tasks):
        for place, temp_id in enumerate(task.agenda_temp_ids):
            if temp_id not in new_agendas:
                problems[f"tasks.{index}.agendaTempIds.{place}"] = "이 초안에 없는 새 안건입니다."
    return problems


async def _part_problems(
    session: AsyncSession, project_id: str, agendas: Sequence[ProposedAgenda]
) -> list[ApiError]:
    """새 안건의 파트 — 등록과 같은 검사(`part.guard_part`)를 자리마다. 코드별로 하나씩."""
    by_code: dict[str, ApiError] = {}
    for index, agenda in enumerate(agendas):
        try:
            await part_service.guard_part(
                session, project_id, agenda.part_id, f"agendas.{index}.partId"
            )
        except ApiError as exc:
            held = by_code.get(exc.code)
            if held is None:
                by_code[exc.code] = exc
            elif held.detail is not None and exc.detail is not None:
                held.detail.update(exc.detail)
    return list(by_code.values())


async def minutes_problems(
    session: AsyncSession,
    project_id: str,
    agendas: Sequence[ProposedAgenda],
    updates: Sequence[ProposedUpdate],
    tasks: Sequence[ProposedMinutesTask],
) -> list[ApiError]:
    """걸린 것을 오류 하나씩으로 — 등록은 첫 것을 내고, 초안 도구는 다 모아 Claude 에게 돌려준다.

    순서는 422 → 없는 안건 → 새 안건 담당자 → 새 안건 파트 → 작업 담당자 → 없는 상위 작업 →
    4단 넘김. 읽기만 한다.
    """
    found: list[ApiError] = []
    shape = shape_problems(agendas, updates, tasks)
    if shape:
        found.append(ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", shape))

    # 다른 프로젝트의 안건도 '없다' 로 본다 — 있는지조차 알려 주지 않는다
    wanted = {row.agenda_id for row in updates} | {
        agenda_id for task in tasks for agenda_id in task.agenda_ids
    }
    live: set[str] = set()
    if wanted:
        rows = await session.scalars(
            select(Agenda.id).where(
                Agenda.project_id == project_id,
                Agenda.id.in_(wanted),
                Agenda.is_deleted.is_(False),
            )
        )
        live = set(rows.all())
    missing_agendas = {
        f"updates.{index}.agendaId": AGENDA_MISSING
        for index, row in enumerate(updates)
        if row.agenda_id not in live
    } | {
        f"tasks.{index}.agendaIds.{place}": AGENDA_MISSING
        for index, task in enumerate(tasks)
        for place, agenda_id in enumerate(task.agenda_ids)
        if agenda_id not in live
    }
    if missing_agendas:
        found.append(ApiError(400, "AGENDA_NOT_FOUND", AGENDA_MISSING, missing_agendas))

    asked = {agenda.owner_id for agenda in agendas if agenda.owner_id is not None}
    assignable = await access.active_project_members(session, project_id, asked)
    agenda_owners = {
        f"agendas.{index}.ownerId": OWNER_MISSING
        for index, agenda in enumerate(agendas)
        if agenda.owner_id is not None and agenda.owner_id not in assignable
    }
    if agenda_owners:
        found.append(ApiError(400, "AGENDA_OWNER_NOT_FOUND", OWNER_MISSING, agenda_owners))

    found += await _part_problems(session, project_id, agendas)

    task_owners = await task_service.missing_owners(session, project_id, tasks)
    if task_owners:
        found.append(ApiError(400, "TASK_OWNER_NOT_FOUND", OWNER_MISSING, task_owners))

    orphans = await task_service.missing_parents(session, project_id, tasks)
    if orphans:
        found.append(
            ApiError(400, "TASK_PARENT_NOT_FOUND", "상위 작업을 찾을 수 없습니다.", orphans)
        )

    deep = await task_service.too_deep(session, project_id, tasks)
    if deep:
        found.append(ApiError(400, "TASK_DEPTH_EXCEEDED", task_service.DEPTH_EXCEEDED, deep))
    return found


async def _guard_updates(
    session: AsyncSession, updates: Sequence[ProposedUpdate], scope: Scope
) -> None:
    """결정내용 · 상태를 바꾸는 것은 PATCH 와 같은 넷만 — 생성자 · 담당자 · 관리자 (auth.md)."""
    denied: dict[str, str] = {}
    for index, row in enumerate(updates):
        agenda = await agenda_service.load_agenda(session, row.agenda_id)
        if not access.can_edit_agenda(scope, agenda):
            denied[f"updates.{index}.agendaId"] = FORBIDDEN_UPDATE
    if denied:
        raise ApiError(403, "FORBIDDEN", "권한이 없습니다.", denied)


async def apply_minutes(
    session: AsyncSession, minutes_id: str, payload: MinutesApplyInput, scope: Scope
) -> MinutesApplyResult:
    """고른 초안을 한 트랜잭션에 넣는다. 하나라도 틀리면 아무것도 안 남는다 — 발번한 번호까지.

    순서: 새 안건 → 기존 안건의 결정 갈아끼우기 → 작업 → 작업 ↔ 안건 링크.
    만든 줄마다 출처(`minutes_id`)를 달고, 요약을 보냈으면 회의록에 남긴다.
    """
    minutes = await load_minutes(session, minutes_id)
    project = await project_service.load_project(session, minutes.project_id)
    agendas, updates, tasks = normalize(payload.agendas, payload.updates, payload.tasks)
    problems = await minutes_problems(session, project.id, agendas, updates, tasks)
    if problems:
        raise problems[0]
    await _guard_updates(session, updates, scope)

    try:
        result = await _insert(
            session, project, minutes.id, _Rows(agendas, updates, tasks), scope.actor.id
        )
        if payload.summary is not None:
            # updated_at 은 그대로 둔다 — '고친 시각' 은 사람이 글을 고친 때다
            minutes.summary = payload.summary
        await session.commit()
    except Exception:
        # 세션을 누가 닫든 여기서 되돌린다 — 반쯤 들어간 줄이 다음 쿼리에 끌려 나가지 않게
        await session.rollback()
        raise
    return result


@dataclass(frozen=True)
class _Rows:
    agendas: list[ProposedAgenda]
    updates: list[ProposedUpdate]
    tasks: list[ProposedMinutesTask]


async def _insert(
    session: AsyncSession, project: Project, minutes_id: str, rows: _Rows, actor_id: str
) -> MinutesApplyResult:
    created_at = now()
    agenda_ids: dict[str, str] = {}
    created_agendas: list[Agenda] = []
    for item in rows.agendas:
        # 결정 시각 · 판은 손으로 등록할 때와 같은 규칙이다
        agenda = agenda_service.new_agenda(
            project.id,
            item.title,
            description=item.description,
            decision=item.decision,
            state=item.state,
            owner_id=item.owner_id,
            due_date=item.due_date,
            part_id=item.part_id,
            creator_id=actor_id,
            created_at=created_at,
            minutes_id=minutes_id,
        )
        session.add(agenda)
        agenda_ids[item.temp_id] = agenda.id
        created_agendas.append(agenda)
    await session.flush()
    # 등록과 같이 '등록' 이력 한 줄 — 안건이 먼저 들어가야 이력의 복합 FK 가 선다
    for agenda in created_agendas:
        history_service.record_agenda(
            session, agenda, history_service.created(), actor_id, created_at
        )

    updated: list[Agenda] = []
    for proposed in rows.updates:
        agenda = await agenda_service.load_agenda(session, proposed.agenda_id)
        before = agenda_service.history_fields(agenda)
        at = now()
        # 결정내용을 통째로 갈아끼운다 — PATCH 와 같은 함수 · 같은 이력
        agenda_service.apply_fields(
            agenda, agenda_service.Fields(decision=proposed.decision, state=proposed.state), at
        )
        changes = agenda_service.changes_since(agenda, before)
        history_service.record_agenda(session, agenda, changes, actor_id, at)
        if changes:
            updated.append(agenda)

    task_ids: dict[str, str] = {}
    created_tasks: list[Task] = []
    links: list[TaskAgendaLinkOut] = []
    # 배열 순서대로 넣는다 — 번호가 그 순서로 나가고, 상위가 늘 먼저 들어가 있다
    for row in rows.tasks:
        linked = list(
            dict.fromkeys([agenda_ids[temp_id] for temp_id in row.agenda_temp_ids] + row.agenda_ids)
        )
        fields = {
            "title": row.title,
            "parent_id": (
                task_ids[row.parent_temp_id] if row.parent_temp_id is not None else row.parent_id
            ),
            "owner_id": row.owner_id,
            "start": row.start,
            "due": row.due,
            "priority": row.priority,
            "agenda_ids": linked,
        }
        # partId 는 안 보낸다 — 상위 작업의 파트를 따르고, 최상위면 공통이다
        # 상태 기록 첫 줄도 여기서 남는다 — 등록과 같은 함수다
        task = await task_service._insert_task(
            session, project, TaskCreate.model_validate(fields), actor_id
        )
        task.minutes_id = minutes_id
        task_ids[row.temp_id] = task.id
        created_tasks.append(task)
        links += [TaskAgendaLinkOut(task_id=task.id, agenda_id=agenda_id) for agenda_id in linked]
    await session.flush()

    return MinutesApplyResult(
        agendas=[agenda_service.to_agenda(agenda) for agenda in created_agendas],
        updated_agendas=[agenda_service.to_agenda(agenda) for agenda in updated],
        tasks=[
            task_service.to_task(task, 0, task_service.StatusSince(task.created_at, False))
            for task in created_tasks
        ],
        links=links,
        agenda_id_by_temp_id=agenda_ids,
        task_id_by_temp_id=task_ids,
    )

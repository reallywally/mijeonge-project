"""확인 요청 — 목록 · 보내기 · 확인 · 배지.

계약은 `docs/api/check.md`. 내용 · 수정 · 삭제 · 확인 취소는 없다.
받는 사람은 서버가 정한다 — 연결 작업의 담당자 + 안건의 참조(docs/api/cc.md).
한 결정 판에 한 번 (Q42 ~ Q44 · docs/api/agenda.md).
경로의 요청이 내 프로젝트의 것인지는 `access.resolve_scope` 가 본다.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Agenda, CheckRequest, ProjectMember, Task, TaskAgendaLink, new_id
from app.schemas.check import CheckPendingCount, CheckRequestOut
from app.services.access import (
    Scope,
    active_project_members,
    forbidden,
    live_agenda_ids,
    live_project_ids,
)
from app.time import now

# '기한 임박' — 리스크 기본값과 같지만 프로젝트 기준을 따르지 않고 고정한다.
# 기준이 바뀌면 지난 기록과 비교가 깨진다 (docs/api/check.md '테이블')
DUE_SOON_DAYS = 3


@dataclass(frozen=True)
class Load:
    open_tasks: int = 0
    blocked_tasks: int = 0
    due_soon_tasks: int = 0
    open_agendas: int = 0


def to_check(row: CheckRequest) -> CheckRequestOut:
    return CheckRequestOut(
        id=row.id,
        project_id=row.project_id,
        agenda_id=row.agenda_id,
        decision_rev=row.decision_rev,
        decision=row.decision,
        sender_id=row.sender_id,
        recipient_id=row.recipient_id,
        created_at=row.created_at,
        confirmed_at=row.confirmed_at,
    )


async def recipient_loads(
    session: AsyncSession, project_id: str, member_ids: list[str], *, today: date
) -> dict[str, Load]:
    """그 프로젝트에서 사람마다 맡은 일의 양. 완료 작업 · 결정된 안건은 뺀다.

    `today` 를 인자로 받는다 — 검사가 날짜에 흔들리지 않게. 시드도 같은 함수로 센다.
    """
    soon = today + timedelta(days=DUE_SOON_DAYS)
    tasks = await session.execute(
        select(
            Task.owner_id,
            func.count(),
            func.sum(case((Task.status == "blocked", 1), else_=0)),
            # 이미 지난 것도 임박에 든다
            func.sum(case((Task.due <= soon, 1), else_=0)),
        )
        .where(
            Task.project_id == project_id,
            Task.owner_id.in_(member_ids),
            Task.status != "done",
            Task.is_deleted.is_(False),
        )
        .group_by(Task.owner_id)
    )
    agendas = await session.execute(
        select(Agenda.owner_id, func.count())
        .where(
            Agenda.project_id == project_id,
            Agenda.owner_id.in_(member_ids),
            Agenda.state != "decided",
            Agenda.is_deleted.is_(False),
        )
        .group_by(Agenda.owner_id)
    )
    task_counts = {owner: (int(n), int(b or 0), int(s or 0)) for owner, n, b, s in tasks.all()}
    agenda_counts = {owner: int(n) for owner, n in agendas.all()}
    loads: dict[str, Load] = {}
    for member_id in member_ids:
        open_tasks, blocked, due_soon = task_counts.get(member_id, (0, 0, 0))
        loads[member_id] = Load(open_tasks, blocked, due_soon, agenda_counts.get(member_id, 0))
    return loads


async def list_checks(session: AsyncSession, project_id: str) -> list[CheckRequestOut]:
    rows = await session.scalars(
        select(CheckRequest)
        .where(
            CheckRequest.project_id == project_id,
            # 지운 안건의 요청은 남아 있다 — 화면에는 없는 것처럼
            CheckRequest.agenda_id.in_(live_agenda_ids()),
        )
        .order_by(CheckRequest.seq)
    )
    return [to_check(row) for row in rows.all()]


async def _already_sent(session: AsyncSession, agenda: Agenda) -> bool:
    found = await session.scalar(
        select(CheckRequest.id)
        .where(
            CheckRequest.agenda_id == agenda.id,
            CheckRequest.decision_rev == agenda.decision_rev,
        )
        .limit(1)
    )
    return found is not None


async def recipients_of(session: AsyncSession, agenda: Agenda, sender_id: str) -> list[str]:
    """연결 작업의 담당자(작업 seq 순) 다음 참조(ccIds 순). 겹치면 처음 자리 하나.

    보낸 사람은 뺀다. 지금 부여된 활성 멤버가 아니면 조용히 건너뛴다 — 오류로 내면
    부여가 빠진 한 사람 때문에 아무에게도 못 보낸다.
    """
    owners = await session.scalars(
        select(Task.owner_id)
        .join(TaskAgendaLink, TaskAgendaLink.task_id == Task.id)
        .where(
            TaskAgendaLink.agenda_id == agenda.id,
            Task.project_id == agenda.project_id,
            Task.owner_id.is_not(None),
            Task.is_deleted.is_(False),
        )
        .order_by(Task.seq)
    )
    ordered = [owner for owner in owners.all() if owner is not None]
    ordered += [cc.member_id for cc in agenda.cc]
    candidates = [member_id for member_id in dict.fromkeys(ordered) if member_id != sender_id]
    granted = await active_project_members(session, agenda.project_id, candidates)
    return [member_id for member_id in candidates if member_id in granted]


def _already_sent_error() -> ApiError:
    return ApiError(409, "CHECK_ALREADY_SENT", "이 결정은 이미 확인 요청을 보냈습니다.")


async def send_checks(
    session: AsyncSession, scope: Scope, agenda_id: str, *, today: date
) -> list[CheckRequestOut]:
    """받는 사람 수만큼 줄을 한 트랜잭션으로.

    검사 순서는 계약대로 — 경로의 안건 404(require_scope) → 결정 안 됨 → 이미 보냄 →
    받을 사람 없음.
    """
    agenda = await session.scalar(
        select(Agenda).where(
            Agenda.id == agenda_id,
            Agenda.project_id == scope.project_id,
            Agenda.is_deleted.is_(False),
        )
    )
    if agenda is None:
        raise not_found("AGENDA_NOT_FOUND", "안건을 찾을 수 없습니다.")
    if agenda.state != "decided":
        raise ApiError(
            400, "CHECK_AGENDA_NOT_DECIDED", "결정된 안건만 확인 요청을 보낼 수 있습니다."
        )
    if await _already_sent(session, agenda):
        raise _already_sent_error()
    recipients = await recipients_of(session, agenda, scope.actor.id)
    if not recipients:
        raise ApiError(
            400,
            "CHECK_NO_RECIPIENTS",
            "받을 사람이 없습니다. 연결 작업에 담당자를 정하거나 참조를 더해 주세요.",
        )

    loads = await recipient_loads(session, agenda.project_id, recipients, today=today)
    sent_at = now()
    rows: list[CheckRequest] = []
    try:
        for member_id in recipients:
            load = loads[member_id]
            row = CheckRequest(
                id=new_id(),
                project_id=agenda.project_id,
                agenda_id=agenda.id,
                decision_rev=agenda.decision_rev,
                # 보낼 때의 결정내용 — 뒤에 결정이 바뀌어도 무엇을 알렸는지 남는다
                decision=agenda.decision,
                sender_id=scope.actor.id,
                recipient_id=member_id,
                created_at=sent_at,
                confirmed_at=None,
                load_open_tasks=load.open_tasks,
                load_blocked_tasks=load.blocked_tasks,
                load_due_soon_tasks=load.due_soon_tasks,
                load_open_agendas=load.open_agendas,
            )
            session.add(row)
            # 한 줄씩 밀어야 seq 가 받는 사람 순서다
            await session.flush()
            rows.append(row)
        await session.commit()
    except IntegrityError as exc:
        # 동시에 두 번 눌렀다 — 늦은 쪽이 unique (agenda_id, decision_rev, recipient_id) 에 걸렸다
        await session.rollback()
        raise _already_sent_error() from exc
    return [to_check(row) for row in rows]


async def confirm_check(session: AsyncSession, check_id: str, scope: Scope) -> CheckRequestOut:
    """받은 사람만. 이미 확인했으면 그대로 돌려준다 — 처음 확인한 시각을 지킨다."""
    row = await session.get(CheckRequest, check_id)
    if row is None:
        raise not_found("CHECK_NOT_FOUND", "확인 요청을 찾을 수 없습니다.")
    # 대신 확인하면 받은 사람이 본 것이 된다 — 관리자도 못 한다
    if row.recipient_id != scope.actor.id:
        raise forbidden()
    if row.confirmed_at is None:
        row.confirmed_at = now()
        await session.commit()
    return to_check(row)


async def pending_count(session: AsyncSession, member_id: str) -> CheckPendingCount:
    """내 대기 수. 지금 부여된 프로젝트만 센다 — 시스템 관리자도 부여된 것만, 지운 것은 빼고."""
    rows = await session.execute(
        select(CheckRequest.project_id, func.count())
        .where(
            CheckRequest.recipient_id == member_id,
            CheckRequest.confirmed_at.is_(None),
            CheckRequest.agenda_id.in_(live_agenda_ids()),
            CheckRequest.project_id.in_(
                select(ProjectMember.project_id).where(
                    ProjectMember.member_id == member_id,
                    ProjectMember.project_id.in_(live_project_ids()),
                )
            ),
        )
        .group_by(CheckRequest.project_id)
    )
    by_project = {project_id: int(n) for project_id, n in rows.all()}
    return CheckPendingCount(total=sum(by_project.values()), by_project=by_project)

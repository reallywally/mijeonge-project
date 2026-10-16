"""확인 요청 — 목록 · 보내기 · 확인 · 배지.

계약은 `docs/api/check.md`. 답 · 수정 · 삭제 · 확인 취소는 없다.
경로의 요청이 내 프로젝트의 것인지는 `access.resolve_scope` 가 본다.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import CheckRequest, ProjectMember, Task, Thread, new_id
from app.schemas.check import (
    CheckPendingCount,
    CheckRequestInput,
    CheckRequestOut,
    CheckTargetType,
)
from app.services.access import Scope, active_project_members, forbidden
from app.time import now

# '기한 임박' — 리스크 기본값과 같지만 프로젝트 기준을 따르지 않고 고정한다.
# 기준이 바뀌면 지난 기록과 비교가 깨진다 (docs/api/check.md '테이블')
DUE_SOON_DAYS = 3


@dataclass(frozen=True)
class Load:
    open_tasks: int = 0
    blocked_tasks: int = 0
    due_soon_tasks: int = 0
    open_threads: int = 0


def to_check(row: CheckRequest) -> CheckRequestOut:
    target_type: CheckTargetType
    if row.task_id is not None:
        target_type, target_id = "task", row.task_id
    else:
        assert row.thread_id is not None  # CHECK 가 둘 중 하나를 보장한다
        target_type, target_id = "thread", row.thread_id
    return CheckRequestOut(
        id=row.id,
        project_id=row.project_id,
        target_type=target_type,
        target_id=target_id,
        sender_id=row.sender_id,
        recipient_id=row.recipient_id,
        text=row.text,
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
        )
        .group_by(Task.owner_id)
    )
    threads = await session.execute(
        select(Thread.owner_id, func.count())
        .where(
            Thread.project_id == project_id,
            Thread.owner_id.in_(member_ids),
            Thread.state != "decided",
        )
        .group_by(Thread.owner_id)
    )
    task_counts = {owner: (int(n), int(b or 0), int(s or 0)) for owner, n, b, s in tasks.all()}
    thread_counts = {owner: int(n) for owner, n in threads.all()}
    loads: dict[str, Load] = {}
    for member_id in member_ids:
        open_tasks, blocked, due_soon = task_counts.get(member_id, (0, 0, 0))
        loads[member_id] = Load(open_tasks, blocked, due_soon, thread_counts.get(member_id, 0))
    return loads


async def list_checks(session: AsyncSession, project_id: str) -> list[CheckRequestOut]:
    rows = await session.scalars(
        select(CheckRequest).where(CheckRequest.project_id == project_id).order_by(CheckRequest.seq)
    )
    return [to_check(row) for row in rows.all()]


async def _guard_target(session: AsyncSession, project_id: str, payload: CheckRequestInput) -> None:
    model = Task if payload.target_type == "task" else Thread
    found = await session.scalar(
        select(model.id).where(model.id == payload.target_id, model.project_id == project_id)
    )
    if found is None:
        what = "작업" if payload.target_type == "task" else "안건"
        raise ApiError(
            400,
            "CHECK_TARGET_NOT_FOUND",
            f"이 프로젝트에서 그 {what}을 찾을 수 없습니다.",
            {"targetId": f"{what}을 찾을 수 없습니다."},
        )


async def send_checks(
    session: AsyncSession, scope: Scope, payload: CheckRequestInput, *, today: date
) -> list[CheckRequestOut]:
    """받는 사람 수만큼 줄을 한 트랜잭션으로. 검사 순서는 계약대로 — 대상 → 나 자신 → 부여."""
    project_id = scope.project_id
    await _guard_target(session, project_id, payload)

    # 겹친 사람은 처음 나온 자리 하나로. 오류는 보낸 배열의 자리를 짚는다
    first_at: dict[str, int] = {}
    for index, member_id in enumerate(payload.recipient_ids):
        first_at.setdefault(member_id, index)

    if scope.actor.id in first_at:
        raise ApiError(
            400,
            "CHECK_RECIPIENT_SELF",
            "자기 자신에게는 확인 요청을 보낼 수 없습니다.",
            {f"recipientIds.{first_at[scope.actor.id]}": "나 자신은 고를 수 없습니다."},
        )

    granted = await active_project_members(session, project_id, list(first_at))
    missing = {
        f"recipientIds.{index}": "이 프로젝트에 부여되지 않았거나 비활성인 사람입니다."
        for member_id, index in first_at.items()
        if member_id not in granted
    }
    if missing:
        raise ApiError(
            400, "MEMBER_NOT_IN_PROJECT", "이 프로젝트에 부여되지 않은 사람입니다.", missing
        )

    recipients = list(first_at)
    loads = await recipient_loads(session, project_id, recipients, today=today)
    sent_at = now()
    rows: list[CheckRequest] = []
    for member_id in recipients:
        load = loads[member_id]
        row = CheckRequest(
            id=new_id(),
            project_id=project_id,
            task_id=payload.target_id if payload.target_type == "task" else None,
            thread_id=payload.target_id if payload.target_type == "thread" else None,
            sender_id=scope.actor.id,
            recipient_id=member_id,
            text=payload.text,
            created_at=sent_at,
            confirmed_at=None,
            load_open_tasks=load.open_tasks,
            load_blocked_tasks=load.blocked_tasks,
            load_due_soon_tasks=load.due_soon_tasks,
            load_open_threads=load.open_threads,
        )
        session.add(row)
        # 한 줄씩 밀어야 seq 가 recipientIds 순서다
        await session.flush()
        rows.append(row)
    await session.commit()
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
    """내 대기 수. 지금 부여된 프로젝트만 센다 — 시스템 관리자도 부여된 것만."""
    rows = await session.execute(
        select(CheckRequest.project_id, func.count())
        .where(
            CheckRequest.recipient_id == member_id,
            CheckRequest.confirmed_at.is_(None),
            CheckRequest.project_id.in_(
                select(ProjectMember.project_id).where(ProjectMember.member_id == member_id)
            ),
        )
        .group_by(CheckRequest.project_id)
    )
    by_project = {project_id: int(n) for project_id, n in rows.all()}
    return CheckPendingCount(total=sum(by_project.values()), by_project=by_project)

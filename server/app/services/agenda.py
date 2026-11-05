"""안건 쓰기 — 등록 · 부분 수정 · 삭제 (docs/api/agenda.md).

상태는 사람이 직접 고른다. 결정 시각(`decided_at`)과 결정 판(`decision_rev`)은 서버만 정한다 —
그 규칙은 `apply_fields` 하나뿐이고 PATCH 와 회의록 반영이 같이 쓴다. 고치기 · 지우기 권한은
`access.can_edit_agenda` 로 본다.
"""

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Agenda, AgendaCc, new_id
from app.schemas.agenda import AgendaCreate, AgendaOut, AgendaPatch
from app.services import access
from app.services import history as history_service
from app.services import part as part_service
from app.services import project as project_service
from app.services.access import Scope
from app.services.history import Change
from app.time import now

AGENDA_MISSING = "안건을 찾을 수 없습니다."


def to_agenda(row: Agenda) -> AgendaOut:
    return AgendaOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        description=row.description,
        decision=row.decision,
        state=row.state,
        owner_id=row.owner_id,
        cc_ids=cc_ids(row),
        creator_id=row.creator_id,
        due_date=row.due_date,
        part_id=row.part_id,
        created_at=row.created_at,
        decided_at=row.decided_at,
        decision_rev=row.decision_rev,
        minutes_id=row.minutes_id,
    )


def cc_ids(agenda: Agenda) -> list[str]:
    return [cc.member_id for cc in agenda.cc]


def cc_rows(project_id: str, member_ids: list[str]) -> list[AgendaCc]:
    """검사를 마친 참조 → 행. 고른 순서가 sort_order 다."""
    return [
        AgendaCc(project_id=project_id, member_id=member_id, sort_order=order)
        for order, member_id in enumerate(member_ids)
    ]


async def load_agenda(session: AsyncSession, agenda_id: str) -> Agenda:
    """지운 안건은 없는 것과 같다 — 다시 지우기 · 고치기가 다 404 다."""
    found = await session.execute(
        select(Agenda).where(Agenda.id == agenda_id, Agenda.is_deleted.is_(False))
    )
    agenda = found.scalar_one_or_none()
    if agenda is None:
        raise not_found("AGENDA_NOT_FOUND", AGENDA_MISSING)
    return agenda


async def guard_owner(
    session: AsyncSession, project_id: str, owner_id: str | None, code: str
) -> None:
    """새로 지정하는 담당자는 그 프로젝트의 활성 멤버여야 한다 (docs/api/auth.md).

    없는 멤버를 FK 에 맡기면 500 이다 — 화면이 고칠 수 있는 400 으로 먼저 거른다.
    """
    if owner_id is not None and not await access.is_assignable(session, project_id, owner_id):
        raise ApiError(
            400, code, "담당자를 찾을 수 없습니다.", {"ownerId": "담당자를 찾을 수 없습니다."}
        )


@dataclass(frozen=True)
class Fields:
    """사람이 바꾸는 네 칸. None 이면 그 칸은 그대로다."""

    title: str | None = None
    description: str | None = None
    decision: str | None = None
    state: str | None = None


def apply_fields(agenda: Agenda, fields: Fields, at: datetime) -> None:
    """네 칸을 바꾸고 결정 시각 · 결정 판을 맞춘다. 이력은 부르는 쪽이 남긴다.

    - `decided_at` — decided 로 들어서면 `at`, decided 에서 벗어나면 null
    - `decision_rev` — 결정내용(앞뒤 공백 뗀 값)이 바뀌거나 decided 로 들어서면 1 오른다.
      한 번에 둘 다여도 1 만
    """
    was_decided = agenda.state == "decided"
    before = agenda.decision.strip()
    if fields.title is not None:
        agenda.title = fields.title
    if fields.description is not None:
        agenda.description = fields.description
    if fields.decision is not None:
        agenda.decision = fields.decision
    if fields.state is not None:
        agenda.state = fields.state
    now_decided = agenda.state == "decided"
    if now_decided and not was_decided:
        agenda.decided_at = at
    elif not now_decided:
        agenda.decided_at = None
    if agenda.decision.strip() != before or (now_decided and not was_decided):
        agenda.decision_rev += 1


def history_fields(agenda: Agenda) -> dict[str, object]:
    """이력에 남기는 칸의 지금 값 — 계약 표의 순서대로 (docs/api/agenda.md '변경 이력 칸')."""
    return {
        "title": agenda.title,
        "description": agenda.description,
        "decision": agenda.decision,
        "state": agenda.state,
        "ownerId": agenda.owner_id,
        "ccIds": cc_ids(agenda),
        "partId": agenda.part_id,
        "dueDate": agenda.due_date,
    }


def changes_since(agenda: Agenda, before: dict[str, object]) -> list[Change]:
    after = history_fields(agenda)
    return history_service.diff((field, before[field], after[field]) for field in before)


def new_agenda(
    project_id: str,
    title: str,
    *,
    description: str,
    decision: str,
    state: str,
    owner_id: str | None,
    due_date: date | None,
    part_id: str | None,
    creator_id: str | None,
    created_at: datetime,
    minutes_id: str | None = None,
    cc: list[str] | None = None,
) -> Agenda:
    """새 안건 한 줄 — 등록 · 회의록 반영이 같이 쓴다. 결정 시각 · 판은 `apply_fields` 규칙으로.

    등록은 빈 안건(queued · 결정 없음)에서 바뀐 것으로 본다 — decided 로 등록하면 등록 시각 · 판 1,
    결정내용만 있어도 판 1 이다.
    """
    agenda = Agenda(
        id=new_id(),
        project_id=project_id,
        title=title,
        description="",
        decision="",
        state="queued",
        decided_at=None,
        decision_rev=0,
        owner_id=owner_id,
        creator_id=creator_id,
        due_date=due_date,
        part_id=part_id,
        minutes_id=minutes_id,
        created_at=created_at,
        # 비어 있어도 채워 둔다 — 새 객체의 컬렉션을 읽다 지연 로드를 부르지 않게
        cc=cc_rows(project_id, cc or []),
    )
    apply_fields(
        agenda, Fields(description=description, decision=decision, state=state), created_at
    )
    return agenda


async def create_agenda(
    session: AsyncSession, project_id: str, payload: AgendaCreate, actor_id: str
) -> AgendaOut:
    await project_service.load_project(session, project_id)
    await guard_owner(session, project_id, payload.owner_id, "AGENDA_OWNER_NOT_FOUND")
    await part_service.guard_part(session, project_id, payload.part_id)
    cc = await access.guard_cc(session, project_id, payload.cc_ids, "AGENDA_CC_NOT_FOUND")
    agenda = new_agenda(
        project_id,
        payload.title,
        description=payload.description,
        decision=payload.decision,
        state=payload.state,
        owner_id=payload.owner_id,
        due_date=payload.due_date,
        part_id=payload.part_id,
        creator_id=actor_id,
        created_at=now(),
        cc=cc,
    )
    session.add(agenda)
    # 이력의 복합 FK 가 안건을 보니 안건이 먼저 들어가야 한다
    await session.flush()
    history_service.record_agenda(
        session, agenda, history_service.created(), actor_id, agenda.created_at
    )
    await session.commit()
    return to_agenda(agenda)


async def _replace_cc(session: AsyncSession, agenda: Agenda, member_ids: list[str]) -> None:
    """통째로 갈아끼운다. 같은 사람 · 같은 순서면 손대지 않는다(이력도 안 남는다)."""
    keep = cc_ids(agenda)
    unique = await access.guard_cc(
        session, agenda.project_id, member_ids, "AGENDA_CC_NOT_FOUND", keep=keep
    )
    if unique == keep:
        return
    # pk 가 (agenda_id, member_id) 라 옛 줄을 먼저 지워야 같은 사람을 다시 넣을 때 안 부딪힌다
    agenda.cc = []
    await session.flush()
    agenda.cc = cc_rows(agenda.project_id, unique)


def _guard_edit(scope: Scope, agenda: Agenda) -> None:
    if not access.can_edit_agenda(scope, agenda):
        raise access.forbidden()


async def patch_agenda(
    session: AsyncSession, agenda_id: str, payload: AgendaPatch, scope: Scope
) -> AgendaOut:
    agenda = await load_agenda(session, agenda_id)
    # 고치기 전 안건으로 본다 — 담당자를 남에게 넘긴 뒤의 모양으로 보지 않는다
    _guard_edit(scope, agenda)
    before = history_fields(agenda)
    # 보낸 것만 바꾼다. ownerId · dueDate · partId 의 null 은 '비우기'다.
    # ccIds 의 null 은 스키마가 422 로 막으니 None 이면 안 보낸 것이다
    sent = payload.model_fields_set
    if "owner_id" in sent:
        # 이미 걸려 있던 담당자를 그대로 두는 수정은 막지 않는다
        if payload.owner_id != agenda.owner_id:
            await guard_owner(
                session, agenda.project_id, payload.owner_id, "AGENDA_OWNER_NOT_FOUND"
            )
        agenda.owner_id = payload.owner_id
    if "due_date" in sent:
        agenda.due_date = payload.due_date
    if "part_id" in sent:
        # 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다
        if payload.part_id != agenda.part_id:
            await part_service.guard_part(session, agenda.project_id, payload.part_id)
        agenda.part_id = payload.part_id
    if payload.cc_ids is not None:
        await _replace_cc(session, agenda, payload.cc_ids)
    at = now()
    apply_fields(
        agenda,
        Fields(
            title=payload.title,
            description=payload.description,
            decision=payload.decision,
            state=payload.state,
        ),
        at,
    )
    history_service.record_agenda(
        session, agenda, changes_since(agenda, before), scope.actor.id, at
    )
    await session.commit()
    return to_agenda(agenda)


async def delete_agenda(session: AsyncSession, agenda_id: str, scope: Scope) -> None:
    """논리 삭제 — 세 칸을 찍고 이력에 '삭제' 줄. 링크 · 확인 요청 · 테스트 참조는 그대로 두고
    읽는 쪽이 거른다."""
    agenda = await load_agenda(session, agenda_id)
    _guard_edit(scope, agenda)
    at = now()
    agenda.is_deleted = True
    agenda.deleted_at = at
    agenda.deleted_by = scope.actor.id
    history_service.record_agenda(session, agenda, history_service.deleted(), scope.actor.id, at)
    await session.commit()

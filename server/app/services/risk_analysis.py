"""저장한 AI 리스크 분석 — 임시로 남기기 · 게시판. 계약은 `docs/api/risk-analysis.md`.

분석 글 · 스냅샷은 화면이 다시 보내 주는 것을 믿지 않는다. 분석이 끝날 때 서버가 임시로 남기고,
[저장] 은 그 줄에 제목과 번호를 붙여 게시판에 올린다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Project, RiskAnalysis, new_id
from app.schemas.chat import ChatRef
from app.schemas.risk_analysis import (
    AnalysisCompare,
    ComparedRef,
    KeptRef,
    RiskAnalysisFacts,
    RiskAnalysisListItem,
    RiskAnalysisOut,
    RiskAnalysisPage,
    RiskAnalysisPatch,
    RiskAnalysisSave,
    RiskKind,
)
from app.services.access import Scope, forbidden
from app.services.progress import kst_day
from app.time import as_utc, now

# 임시 분석을 저장할 수 있는 동안 — 지나면 404 이고, 새 분석을 넣을 때 지운다
DRAFT_TTL = timedelta(hours=24)


def _not_found() -> ApiError:
    return not_found("RISK_ANALYSIS_NOT_FOUND", "저장한 분석을 찾을 수 없습니다.")


async def latest_saved(session: AsyncSession, project_id: str) -> RiskAnalysis | None:
    """'바로 앞 저장 분석' — 번호가 가장 큰 것(저장한 순서)."""
    found: RiskAnalysis | None = await session.scalar(
        select(RiskAnalysis)
        .where(RiskAnalysis.project_id == project_id, RiskAnalysis.saved_at.is_not(None))
        .order_by(RiskAnalysis.seq.desc())
        .limit(1)
    )
    return found


@dataclass(frozen=True)
class _Line:
    kind: RiskKind
    id: str
    level: str


def _lines(facts: RiskAnalysisFacts) -> list[_Line]:
    """스냅샷의 줄 — 안건 → 작업 → 테스트, 각 안은 점수 순(스냅샷 순서 그대로)."""
    return [
        *(_Line("agenda", row.agenda_id, row.level) for row in facts.agendas),
        *(_Line("task", row.task_id, row.level) for row in facts.tasks),
        *(_Line("test", row.test_id, row.level) for row in facts.tests),
    ]


def compare(previous: RiskAnalysis | None, current: RiskAnalysisFacts) -> AnalysisCompare | None:
    """앞 스냅샷과 견준다. added · kept 는 이번 순서, removed 는 앞 순서 — 안건 → 작업 → 테스트.

    옛 분석(작업 · 테스트가 없던 때)과 견주면 이번의 작업 · 테스트는 다 '새로 생김' 이다.
    """
    if previous is None or previous.saved_at is None:
        return None
    before = _lines(RiskAnalysisFacts.model_validate(previous.facts))
    levels = {(line.kind, line.id): line.level for line in before}
    now_lines = _lines(current)
    now_keys = {(line.kind, line.id) for line in now_lines}
    return AnalysisCompare(
        previous_id=previous.id,
        previous_title=previous.title or "",
        previous_saved_at=previous.saved_at,
        added=[
            ComparedRef(kind=line.kind, id=line.id)
            for line in now_lines
            if (line.kind, line.id) not in levels
        ],
        removed=[
            ComparedRef(kind=line.kind, id=line.id)
            for line in before
            if (line.kind, line.id) not in now_keys
        ],
        kept=[
            KeptRef(
                kind=line.kind,
                id=line.id,
                level_from=levels[(line.kind, line.id)],
                level_to=line.level,
            )
            for line in now_lines
            if (line.kind, line.id) in levels
        ],
    )


async def save_draft(
    session: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
    body: str,
    refs: list[ChatRef],
    facts: RiskAnalysisFacts,
) -> str:
    """Claude 답을 끝까지 받은 분석을 임시로 남긴다. 오래된 임시 줄은 이때 같이 지운다."""
    moment = now()
    await session.execute(
        delete(RiskAnalysis).where(
            RiskAnalysis.saved_at.is_(None), RiskAnalysis.created_at < moment - DRAFT_TTL
        )
    )
    row = RiskAnalysis(
        id=new_id(),
        project_id=project_id,
        body=body,
        refs=[ref.model_dump(mode="json", by_alias=True) for ref in refs],
        facts=facts.model_dump(mode="json", by_alias=True),
        created_by=actor_id,
        created_at=moment,
    )
    session.add(row)
    await session.commit()
    return row.id


def _counts(facts: dict[str, Any]) -> tuple[int, int, int, int]:
    """(안건 수, 작업 수, 테스트 수, 세 종류의 high 합) — 옛 줄에는 작업 · 테스트가 없어 0 이다."""
    rows = {kind: facts.get(kind) or [] for kind in ("agendas", "tasks", "tests")}
    high = sum(1 for each in rows.values() for row in each if row.get("level") == "high")
    return len(rows["agendas"]), len(rows["tasks"]), len(rows["tests"]), high


def _item(row: RiskAnalysis) -> RiskAnalysisListItem:
    assert row.seq is not None and row.saved_at is not None and row.title is not None
    agenda_count, task_count, test_count, high_count = _counts(row.facts)
    return RiskAnalysisListItem(
        id=row.id,
        project_id=row.project_id,
        seq=row.seq,
        title=row.title,
        created_by=row.created_by,
        created_at=row.created_at,
        saved_at=row.saved_at,
        agenda_count=agenda_count,
        task_count=task_count,
        test_count=test_count,
        high_count=high_count,
    )


def _out(row: RiskAnalysis) -> RiskAnalysisOut:
    return RiskAnalysisOut(
        **_item(row).model_dump(),
        body=row.body,
        refs=[ChatRef.model_validate(ref) for ref in row.refs],
        facts=RiskAnalysisFacts.model_validate(row.facts),
        title_edited_at=row.title_edited_at,
    )


async def list_analyses(
    session: AsyncSession, project_id: str, *, limit: int, offset: int
) -> RiskAnalysisPage:
    saved = (RiskAnalysis.project_id == project_id, RiskAnalysis.saved_at.is_not(None))
    total = int(
        await session.scalar(select(func.count()).select_from(RiskAnalysis).where(*saved)) or 0
    )
    rows = await session.scalars(
        select(RiskAnalysis)
        .where(*saved)
        .order_by(RiskAnalysis.seq.desc())
        .limit(limit)
        .offset(offset)
    )
    return RiskAnalysisPage(items=[_item(row) for row in rows.all()], total=total)


async def _load_saved(session: AsyncSession, analysis_id: str) -> RiskAnalysis:
    row = await session.get(RiskAnalysis, analysis_id)
    if row is None or row.saved_at is None:
        raise _not_found()
    return row


async def get_analysis(session: AsyncSession, analysis_id: str) -> RiskAnalysisOut:
    return _out(await _load_saved(session, analysis_id))


async def save_analysis(
    session: AsyncSession, scope: Scope, payload: RiskAnalysisSave
) -> RiskAnalysisOut:
    """내가 돌린 임시 분석에 제목 · 번호를 붙인다. 행을 잠가 같은 분석이 두 번 오르지 않게 한다."""
    row: RiskAnalysis | None = await session.scalar(
        select(RiskAnalysis).where(RiskAnalysis.id == payload.analysis_id).with_for_update()
    )
    # 남의 것 · 다른 프로젝트 것은 있다는 것도 알리지 않는다
    if row is None or row.project_id != scope.project_id or row.created_by != scope.actor.id:
        raise _not_found()
    if row.saved_at is not None:
        raise ApiError(409, "RISK_ANALYSIS_ALREADY_SAVED", "이미 저장한 분석입니다.")
    moment = now()
    if as_utc(row.created_at) < moment - DRAFT_TTL:
        raise _not_found()
    bumped = await session.execute(
        update(Project)
        .where(Project.id == scope.project_id)
        .values(last_analysis_no=Project.last_analysis_no + 1)
        .returning(Project.last_analysis_no)
    )
    row.seq = bumped.scalar_one()
    row.title = payload.title
    row.saved_at = moment
    await session.commit()
    return _out(row)


async def rename_analysis(
    session: AsyncSession, analysis_id: str, scope: Scope, payload: RiskAnalysisPatch
) -> RiskAnalysisOut:
    """제목만, 작성자만 — 관리자도 남의 제목은 못 고친다(기록)."""
    row = await _load_saved(session, analysis_id)
    if row.created_by != scope.actor.id:
        raise forbidden()
    if payload.title != row.title:
        row.title = payload.title
        row.title_edited_at = now()
        await session.commit()
    return _out(row)


async def delete_analysis(session: AsyncSession, analysis_id: str, scope: Scope) -> None:
    """작성자 · 그 프로젝트 관리자 · 시스템 관리자. 번호는 다시 쓰지 않는다."""
    row = await _load_saved(session, analysis_id)
    if row.created_by != scope.actor.id and not scope.can_manage:
        raise forbidden()
    await session.delete(row)
    await session.commit()


def saved_on(moment: datetime) -> str:
    """Claude 에 줄 앞 분석의 날짜 — 한국 날짜."""
    return kst_day(moment).isoformat()

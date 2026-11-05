"""시드가 픽스처를 그대로 세우는지 본다 — 목업 화면과 대조할 수 있어야 한다."""

import re
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agenda, AgendaHistory, CheckRequest, Minutes, Task, TaskLine
from app.services.check import recipients_of
from scripts.seed import MINUTES_EXAMPLE, seed


async def test_seed_puts_fixtures_in(session: AsyncSession) -> None:
    await seed(session)

    async def count(model: type) -> int:
        return (await session.execute(select(func.count()).select_from(model))).scalar_one()

    assert await count(Agenda) == 10
    # 안건마다 '등록' 한 줄 + 결정내용이 있는 넷(t1 · t2 · t5 · t6)의 '결정내용' 한 줄
    assert await count(AgendaHistory) == 14
    assert await count(Task) == 24
    assert await count(TaskLine) == 7
    assert await count(CheckRequest) == 4
    assert await count(Minutes) == 1


async def test_seed_is_repeatable(session: AsyncSession) -> None:
    """두 번 돌려도 같은 자리다 — 비우고 다시 넣기 때문이다."""
    await seed(session)
    await seed(session)
    total = (await session.execute(select(func.count()).select_from(Task))).scalar_one()
    assert total == 24


async def test_scenario_records_stand(session: AsyncSession) -> None:
    """시나리오 1 · 2 가 그대로 서 있는지 — 회의 밖에서 정한 결정과 아직 논의중인 t5."""
    await seed(session)

    t1 = await session.get(Agenda, "t1")
    assert t1 is not None and t1.state == "decided" and t1.decision == "우분투 최신 버전으로 한다"
    # 항목 둘 중 in 만 정했다 — 그래서 아직 논의중이고, 정한 것만 결정내용에 남았다
    t5 = await session.get(Agenda, "t5")
    assert t5 is not None and t5.state == "open" and t5.decided_at is None
    assert t5.decision == "요청(in) 항목: 계약번호 · 상품코드 · 가입일 셋을 넘긴다"

    blocked = (await session.execute(select(Task).where(Task.id == "k18"))).scalar_one()
    assert blocked.status == "blocked"
    assert blocked.start is None and blocked.due is None  # 기간 미정

    env = (await session.execute(select(Task).where(Task.id == "k4"))).scalar_one()
    assert [line.text for line in env.lines][:2] == ["서버 신청서 제출", "우분투 최신 버전 설치"]
    assert [line.sort_order for line in env.lines] == list(range(7))


async def test_seed_checks_point_at_the_first_decision(session: AsyncSession) -> None:
    """c1 ~ c4 — 이행 규칙대로 결정 판 1 · 그때의 결정 글 (check.md '시드 · 목업')."""
    await seed(session)
    rows = (await session.scalars(select(CheckRequest).order_by(CheckRequest.seq))).all()
    assert [
        (r.id, r.agenda_id, r.decision_rev, r.decision, r.sender_id, r.recipient_id) for r in rows
    ] == [
        ("c1", "t2", 1, "mysql 을 쓴다", "u1", "u3"),
        ("c2", "t2", 1, "mysql 을 쓴다", "u1", "u2"),
        ("c3", "t2", 1, "mysql 을 쓴다", "u1", "u4"),
        ("c4", "t1", 1, "우분투 최신 버전으로 한다", "u3", "u1"),
    ]
    # 판은 안건의 지금 판과 같다 — 같은 판으로는 다시 못 보낸다
    for agenda_id in ("t1", "t2"):
        agenda = await session.get(Agenda, agenda_id)
        assert agenda is not None and agenda.decision_rev == 1
    # 받는 사람 = 연결 작업 담당자(u3) 다음 참조(u2 · u4) — c1 ~ c3 과 같다 (docs/api/cc.md)
    t2 = await session.get(Agenda, "t2")
    assert t2 is not None
    assert await recipients_of(session, t2, "u1") == ["u3", "u2", "u4"]
    # c4 — 연결 작업 담당 u3 이 보낸 사람이라 빠지고 참조 u1 만
    t1 = await session.get(Agenda, "t1")
    assert t1 is not None
    assert await recipients_of(session, t1, "u3") == ["u1"]


async def test_seed_minutes_m1(session: AsyncSession) -> None:
    """회의록 m1 — minutes.md '시드 · 목업'. 본문은 화면의 예시 글 그대로, 출처를 단 줄은 없다."""
    await seed(session)
    m1 = await session.get(Minutes, "m1")
    assert m1 is not None
    assert (m1.project_id, m1.author_id, m1.title) == ("p1", "u1", "10월 셋째 주 주간 회의")
    assert m1.meeting_date is not None and m1.meeting_date.isoformat() == "2026-10-16"
    assert m1.summary == ""
    fixture = (
        Path(__file__).resolve().parents[2] / "web" / "src" / "fixtures" / "minutes.ts"
    ).read_text(encoding="utf-8")
    found = re.search(r"export const MINUTES_EXAMPLE = `(.*?)`\n", fixture, re.S)
    assert found is not None, "web/src/fixtures/minutes.ts 에 MINUTES_EXAMPLE 이 없다"
    assert m1.body == MINUTES_EXAMPLE == found.group(1)
    for model in (Agenda, Task):
        sourced = await session.scalar(
            select(func.count()).select_from(model).where(model.minutes_id.is_not(None))
        )
        assert sourced == 0

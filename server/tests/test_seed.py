"""시드가 픽스처를 그대로 세우는지 본다 — 목업 화면과 대조할 수 있어야 한다."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, Task, TaskLine, Thread
from scripts.seed import seed


async def test_seed_puts_fixtures_in(session: AsyncSession) -> None:
    await seed(session)

    async def count(model: type) -> int:
        return (await session.execute(select(func.count()).select_from(model))).scalar_one()

    assert await count(Thread) == 10
    assert await count(Entry) == 6
    assert await count(Task) == 23
    assert await count(TaskLine) == 7


async def test_seed_is_repeatable(session: AsyncSession) -> None:
    """두 번 돌려도 같은 자리다 — 비우고 다시 넣기 때문이다."""
    await seed(session)
    await seed(session)
    total = (await session.execute(select(func.count()).select_from(Task))).scalar_one()
    assert total == 23


async def test_scenario_records_stand(session: AsyncSession) -> None:
    """시나리오 1 · 2 가 그대로 서 있는지 — 결정 한 줄과 두 번 미룸."""
    await seed(session)

    outside = (await session.execute(select(Entry).where(Entry.id == "e1"))).scalar_one()
    assert outside.kind == "decide"

    defers = (await session.execute(select(Entry).where(Entry.thread_id == "t5"))).scalars().all()
    assert [e.kind for e in defers] == ["defer", "defer"]

    blocked = (await session.execute(select(Task).where(Task.id == "k18"))).scalar_one()
    assert blocked.status == "blocked"
    assert blocked.start is None and blocked.due is None  # 기간 미정

    env = (await session.execute(select(Task).where(Task.id == "k4"))).scalar_one()
    assert [line.text for line in env.lines][:2] == ["서버 신청서 제출", "우분투 최신 버전 설치"]
    assert [line.sort_order for line in env.lines] == list(range(7))

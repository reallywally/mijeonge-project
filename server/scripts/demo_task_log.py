"""개발 DB 에 리포트 시연용 상태 기록만 넣는다 (docs/api/task-flow.md '시드 · 목업').

    uv run python -m scripts.demo_task_log

개발 DB 는 시드를 다시 돌리지 않는다 — 마이그레이션의 backfill 만 들어 있다. 여기서는 시드와 같은
k20 · k22 의 오래된 바뀜 한 줄씩을 더한다. **지우지 않는다.** 작업이 없거나, 지금 상태가 시연과
다르거나, backfill 말고 다른 줄이 이미 있으면 건너뛴다
(사람이 이미 바꿨으면 그 기록이 맞다 — 덮어 쓰면 '지금 상태가 된 시각' 이 틀어진다).
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, session_factory
from app.models import Task, TaskLog
from scripts.seed import DEMO_STATUS_CHANGES, demo_log

PROJECT = "p1"


async def add_status_changes(session: AsyncSession) -> list[str]:
    notes: list[str] = []
    for task_id, before, after, changed_at in DEMO_STATUS_CHANGES:
        label = f"기록 {task_id} {before} → {after} ({changed_at})"
        task = await session.get(Task, task_id)
        if task is None or task.project_id != PROJECT:
            notes.append(f"{label}: 작업이 없어 건너뜀")
            continue
        if task.status != after:
            notes.append(f"{label}: 지금 상태가 {task.status} 라 건너뜀")
            continue
        recorded = await session.scalar(
            select(TaskLog.id)
            .where(TaskLog.task_id == task_id, TaskLog.backfilled.is_(False))
            .limit(1)
        )
        if recorded is not None:
            notes.append(f"{label}: backfill 말고 기록이 이미 있어 건너뜀")
            continue
        session.add(demo_log(task, before, after, changed_at))
        notes.append(f"{label}: 넣음")
    return notes


async def apply_demo(session: AsyncSession) -> list[str]:
    """넣은 것 · 건너뛴 것을 한 줄씩 돌려준다. 커밋한다."""
    notes = await add_status_changes(session)
    await session.commit()
    return notes


async def run() -> None:
    async with session_factory() as session:
        for note in await apply_demo(session):
            print(note)
    await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

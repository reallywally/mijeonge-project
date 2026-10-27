"""개발 DB 에 리포트 시연용 선행 관계 · 상태 기록만 넣는다 (docs/api/task-flow.md '시드 · 목업').

    uv run python -m scripts.demo_task_log

개발 DB 는 시드를 다시 돌리지 않는다 — 마이그레이션의 backfill 만 들어 있다. 여기서는 시드와 같은
선행 셋과 k20 · k22 의 오래된 바뀜 한 줄씩을 더한다. **지우지 않는다.** 있으면 건너뛴다:
- 선행 관계 — 이미 있거나, 작업이 없거나, 검사(자기 · 순환 · 개수)에 걸리면
- 상태 기록 — 작업이 없거나, 지금 상태가 시연과 다르거나, backfill 말고 다른 줄이 이미 있으면
  (사람이 이미 바꿨으면 그 기록이 맞다 — 덮어 쓰면 '지금 상태가 된 시각' 이 틀어진다)
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, session_factory
from app.errors import ApiError
from app.models import Member, Task, TaskDependency, TaskLog
from app.services import dependency as dependency_service
from app.time import now
from scripts.seed import DEMO_STATUS_CHANGES, DEPENDENCY_BY, TASK_DEPENDENCIES, demo_log

PROJECT = "p1"


async def add_dependencies(session: AsyncSession) -> list[str]:
    notes: list[str] = []
    if await session.get(Member, DEPENDENCY_BY) is None:
        return [f"선행 관계 — 멤버 {DEPENDENCY_BY} 가 없어 건너뜀"]
    graph = await dependency_service.load_graph(session, PROJECT)
    for task_id, depends_on_id in TASK_DEPENDENCIES:
        label = f"선행 {task_id} ← {depends_on_id}"
        if graph.has(task_id, depends_on_id):
            notes.append(f"{label}: 이미 있어 건너뜀")
            continue
        try:
            dependency_service.check(graph, task_id, depends_on_id)
        except ApiError as exc:
            notes.append(f"{label}: {exc.code} 라 건너뜀")
            continue
        graph.add(task_id, depends_on_id)
        session.add(
            TaskDependency(
                task_id=task_id,
                depends_on_id=depends_on_id,
                project_id=PROJECT,
                created_by=DEPENDENCY_BY,
                created_at=now(),
            )
        )
        notes.append(f"{label}: 넣음")
    return notes


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
    notes = await add_dependencies(session)
    notes += await add_status_changes(session)
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

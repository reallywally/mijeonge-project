"""선행 작업 — 걸기 · 떼기와 그 검사 (docs/api/task-flow.md '선행 작업').

검사는 `check` 하나다 — 사람이 거는 PUT 과 AI 제안(`services/dependency_suggest.py`)이 같이 쓴다.
프로젝트의 계층 · 선행 관계를 한 번 읽어 메모리에서 본다 — 제안 수십 개를 거를 때
줄마다 DB 를 다시 읽지 않고, 앞에서 받아들인 제안까지 그래프에 얹어 순환을 본다.
"""

from collections import deque
from dataclasses import dataclass, field

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import Task, TaskDependency
from app.schemas.task import TaskDependencyOut
from app.services import history as history_service
from app.services.task import load_task
from app.time import now

# 한 작업의 선행 수 상한
DEPENDENCY_MAX = 20


@dataclass
class DependencyGraph:
    """한 프로젝트의 계층(parent) · 선행 관계(task → 선행들)."""

    parents: dict[str, str | None]
    depends_on: dict[str, set[str]] = field(default_factory=dict)

    def has(self, task_id: str, depends_on_id: str) -> bool:
        return depends_on_id in self.depends_on.get(task_id, set())

    def add(self, task_id: str, depends_on_id: str) -> None:
        self.depends_on.setdefault(task_id, set()).add(depends_on_id)

    def ancestors(self, task_id: str) -> set[str]:
        found: set[str] = set()
        walker = self.parents.get(task_id)
        # 이미 망가진 계층(고리)을 만나도 멈춘다
        while walker is not None and walker not in found:
            found.add(walker)
            walker = self.parents.get(walker)
        return found

    def waits_for(self, start: str, target: str) -> bool:
        """`start` 가 선행을 몇 단계 타고 가서 `target` 을 기다리는가."""
        seen = {start}
        queue = deque([start])
        while queue:
            for nxt in self.depends_on.get(queue.popleft(), set()):
                if nxt == target:
                    return True
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        return False


async def load_graph(session: AsyncSession, project_id: str) -> DependencyGraph:
    rows = await session.execute(
        select(Task.id, Task.parent_id).where(Task.project_id == project_id)
    )
    graph = DependencyGraph(parents=dict(rows.tuples().all()))
    edges = await session.execute(
        select(TaskDependency.task_id, TaskDependency.depends_on_id).where(
            TaskDependency.project_id == project_id
        )
    )
    for task_id, depends_on_id in edges.tuples():
        graph.add(task_id, depends_on_id)
    return graph


def check(graph: DependencyGraph, task_id: str, depends_on_id: str) -> None:
    """`task_id` 가 `depends_on_id` 를 기다리게 해도 되는가. 이미 걸린 것은 부르는 쪽이 먼저 거른다.

    순서가 계약이다 — 같은 프로젝트(404) → 상하위(400) → 순환(409) → 개수(400).
    """
    if task_id not in graph.parents or depends_on_id not in graph.parents:
        raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")
    # 하위 작업은 상위의 일부라 선후가 아니다
    if (
        depends_on_id == task_id
        or depends_on_id in graph.ancestors(task_id)
        or task_id in graph.ancestors(depends_on_id)
    ):
        raise bad_request(
            "TASK_DEPENDENCY_HIERARCHY",
            "자기 자신이나 상위 · 하위 작업은 선행 작업으로 둘 수 없습니다.",
        )
    if graph.waits_for(depends_on_id, task_id):
        raise ApiError(
            409,
            "TASK_DEPENDENCY_CYCLE",
            "선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.",
        )
    if len(graph.depends_on.get(task_id, set())) >= DEPENDENCY_MAX:
        raise bad_request(
            "TASK_DEPENDENCY_LIMIT", f"선행 작업은 {DEPENDENCY_MAX}개까지 둘 수 있습니다."
        )


async def put_dependency(
    session: AsyncSession, task_id: str, depends_on_id: str, actor_id: str
) -> TaskDependencyOut:
    """멱등 — 이미 걸려 있으면 그대로 돌려준다(검사도 다시 안 한다)."""
    task = await load_task(session, task_id)
    graph = await load_graph(session, task.project_id)
    if not graph.has(task_id, depends_on_id):
        check(graph, task_id, depends_on_id)
        at = now()
        session.add(
            TaskDependency(
                task_id=task_id,
                depends_on_id=depends_on_id,
                project_id=task.project_id,
                created_by=actor_id,
                created_at=at,
            )
        )
        # 이력은 뒤 작업에 남긴다 (docs/api/history.md)
        history_service.record_task(
            session, task, [history_service.change("dependsOn", None, depends_on_id)], actor_id, at
        )
        await session.commit()
    return TaskDependencyOut(task_id=task_id, depends_on_id=depends_on_id)


async def delete_dependency(
    session: AsyncSession, task_id: str, depends_on_id: str, actor_id: str
) -> None:
    """멱등 — 없는 관계 · 모르는 선행 id 도 204 다. 작업 링크 떼기와 같다.
    이력은 있던 관계를 뗄 때만 남긴다."""
    task = await load_task(session, task_id)
    found = await session.scalar(
        select(TaskDependency.depends_on_id).where(
            TaskDependency.task_id == task_id, TaskDependency.depends_on_id == depends_on_id
        )
    )
    if found is None:
        return
    await session.execute(
        delete(TaskDependency).where(
            TaskDependency.task_id == task_id, TaskDependency.depends_on_id == depends_on_id
        )
    )
    history_service.record_task(
        session, task, [history_service.change("dependsOn", depends_on_id, None)], actor_id, now()
    )
    await session.commit()

"""변경 이력 — 남기기 · 읽기 (docs/api/history.md · Q59).

작업 · 테스트를 바꾸는 서비스는 **여기의 `record_task` · `record_test` 만 부른다** — 줄의 모양을
한 곳에서 정한다. 요청 하나가 한 줄이고, 남길 칸이 없으면 줄을 안 만든다.
읽기 쪽 존재 검사는 여기서 따로 한다 — `services/task.py` 가 이 모듈을 부르니
거꾸로 부르면 import 고리가 생긴다.
"""

from collections.abc import Iterable
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import Task, TaskHistory, TestCase, TestHistory, new_id
from app.schemas.history import HistoryEntry, HistoryValue

Change = dict[str, HistoryValue]


def _value(value: object) -> HistoryValue:
    # 사람이 고른 날짜는 계약대로 YYYY-MM-DD 문자열로 남긴다
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, bool | int | str):
        return value
    # 연관 작업 id 목록 — 건 순서 그대로 (Q61)
    if isinstance(value, list | tuple) and all(isinstance(item, str) for item in value):
        return list(value)
    raise TypeError(f"이력에 남길 수 없는 값입니다: {type(value).__name__}")


def change(field: str, before: object, after: object, subject: str = "") -> Change:
    """칸 하나 — 계약의 `HistoryChange` 를 camelCase 그대로."""
    return {"field": field, "from": _value(before), "to": _value(after), "subject": subject}


def created() -> list[Change]:
    return [change("created", None, None)]


def diff(pairs: Iterable[tuple[str, object, object]]) -> list[Change]:
    """(칸, 전, 후) 가운데 값이 바뀐 것만 — 넘긴 순서(= 계약 표의 순서)를 지킨다."""
    return [change(field, before, after) for field, before, after in pairs if before != after]


def record_task(
    session: AsyncSession,
    task: Task,
    changes: list[Change],
    actor_id: str | None,
    at: datetime,
) -> None:
    """작업 이력 한 줄. 칸이 없으면 아무것도 안 한다. 커밋하지 않는다."""
    if not changes:
        return
    session.add(
        TaskHistory(
            id=new_id(),
            project_id=task.project_id,
            task_id=task.id,
            changed_by=actor_id,
            changed_at=at,
            changes=changes,
            backfilled=False,
        )
    )


def record_test(
    session: AsyncSession,
    test: TestCase,
    changes: list[Change],
    actor_id: str | None,
    at: datetime,
) -> None:
    """테스트 이력 한 줄. 칸이 없으면 아무것도 안 한다. 커밋하지 않는다."""
    if not changes:
        return
    session.add(
        TestHistory(
            id=new_id(),
            project_id=test.project_id,
            test_id=test.id,
            changed_by=actor_id,
            changed_at=at,
            changes=changes,
            backfilled=False,
        )
    )


def _entry(row: TaskHistory | TestHistory) -> HistoryEntry:
    return HistoryEntry.model_validate(row)


async def list_task_history(session: AsyncSession, task_id: str) -> list[HistoryEntry]:
    # 없는 작업이면 404 — 빈 배열은 '이력이 없는 작업' 과 구분이 안 된다(댓글과 같다)
    if await session.scalar(select(Task.id).where(Task.id == task_id)) is None:
        raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")
    rows = await session.scalars(
        select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.seq)
    )
    return [_entry(row) for row in rows.all()]


async def list_test_history(session: AsyncSession, test_id: str) -> list[HistoryEntry]:
    if await session.scalar(select(TestCase.id).where(TestCase.id == test_id)) is None:
        raise not_found("TEST_NOT_FOUND", "테스트를 찾을 수 없습니다.")
    rows = await session.scalars(
        select(TestHistory).where(TestHistory.test_id == test_id).order_by(TestHistory.seq)
    )
    return [_entry(row) for row in rows.all()]

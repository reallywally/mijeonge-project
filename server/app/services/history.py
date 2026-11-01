"""변경 이력 — 남기기 · 읽기 (docs/api/history.md · Q59).

작업 · 테스트를 바꾸는 서비스는 **여기의 `record_task` · `record_test` 만 부른다** — 줄의 모양을
한 곳에서 정한다. 요청 하나가 한 줄이고, 남길 칸이 없으면 줄을 안 만든다.
읽기 쪽 존재 검사는 여기서 따로 한다 — `services/task.py` 가 이 모듈을 부르니
거꾸로 부르면 import 고리가 생긴다.
"""

from collections.abc import Iterable
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import not_found
from app.models import Task, TaskHistory, TestCase, TestHistory, new_id
from app.schemas.history import HistoryEntry, HistoryValue
from app.time import as_utc

Change = dict[str, HistoryValue]

# 본문만 이어 고친 줄을 하나로 합치는 창 — 화면이 입력을 멈출 때마다 저장한다 (Q65)
BODY_MERGE_WINDOW = timedelta(minutes=10)


def _value(value: object) -> HistoryValue:
    # 사람이 고른 날짜는 계약대로 YYYY-MM-DD 문자열로 남긴다
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, bool | int | str):
        return value
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


async def record_task_body(
    session: AsyncSession,
    task: Task,
    changes: list[Change],
    actor_id: str | None,
    at: datetime,
) -> None:
    """작업 `PATCH` 의 한 줄 — 본문만 이어 고쳤으면 마지막 줄에 합친다 (Q65).

    남길 칸이 `body` 하나뿐이고 마지막 줄이 같은 사람의 본문 한 칸 · 10분 안이면 그 줄의
    `to` 와 시각만 고친다. 되돌려서 `from == to` 가 되면 그 줄을 지운다. 아니면 `record_task`.
    """
    if len(changes) == 1 and changes[0]["field"] == "body" and actor_id is not None:
        last = await session.scalar(
            select(TaskHistory)
            .where(TaskHistory.task_id == task.id)
            .order_by(TaskHistory.seq.desc())
            .limit(1)
        )
        if last is not None and _merges_body(last, actor_id, at):
            after = changes[0]["to"]
            if last.changes[0]["from"] == after:
                await session.delete(last)
            else:
                # JSON 칸은 안을 고쳐도 SQLAlchemy 가 모른다 — 새 리스트를 대입한다
                last.changes = [{**last.changes[0], "to": after}]
                last.changed_at = at
            return
    record_task(session, task, changes, actor_id, at)


def _merges_body(last: TaskHistory, actor_id: str, at: datetime) -> bool:
    if last.backfilled or last.changed_by != actor_id or len(last.changes) != 1:
        return False
    only = last.changes[0]
    # 2026-11-01 전의 '바뀌었다' 줄(null · null)은 값이 없어 이어 붙일 수 없다.
    # 빈 본문 → 빈 본문은 남지 않으니 둘 다 null 이면 옛 줄이다
    if only.get("field") != "body" or (only.get("from") is None and only.get("to") is None):
        return False
    return at - as_utc(last.changed_at) <= BODY_MERGE_WINDOW


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

"""회의록 — 게시판(쓰기 · 읽기 · 고치기 · 지우기)과 초안의 검사 · 등록. 계약은 `minutes.md`.

고치기는 작성자만, 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자다 — 작업 댓글과 같은 경계.
검사(`minutes_problems`)는 Claude 의 `propose_minutes`(`services/minutes_draft.py`)와
`POST /api/minutes/{id}/apply` 가 **같은 것**을 쓴다 — 챗봇 `propose_tasks` ↔ `tasks/batch` 처럼.
"""

from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, not_found
from app.models import Entry, Minutes, Project, Task, Thread, ThreadOption, new_id
from app.schemas.minutes import (
    MINUTES_ENTRIES_MAX,
    MINUTES_TASKS_MAX,
    MINUTES_THREADS_MAX,
    MinutesApplyInput,
    MinutesApplyResult,
    MinutesCreate,
    MinutesItem,
    MinutesOut,
    MinutesPatch,
    ProposedEntry,
    ProposedEntryBody,
    ProposedMinutesTask,
    ProposedThread,
)
from app.schemas.task import TaskCreate, TaskThreadLinkOut
from app.schemas.thread import EntryCreate, EntryOut
from app.services import access
from app.services import project as project_service
from app.services import task as task_service
from app.services import thread as thread_service
from app.services.access import Scope, forbidden
from app.time import now

OWNER_MISSING = "담당자를 찾을 수 없습니다."
THREAD_MISSING = "안건을 찾을 수 없습니다."

Rows = tuple[list[ProposedThread], list[ProposedEntry], list[ProposedMinutesTask]]


async def load_minutes(session: AsyncSession, minutes_id: str) -> Minutes:
    found = await session.execute(select(Minutes).where(Minutes.id == minutes_id))
    minutes = found.scalar_one_or_none()
    if minutes is None:
        raise not_found("MINUTES_NOT_FOUND", "회의록을 찾을 수 없습니다.")
    return minutes


async def list_minutes(session: AsyncSession, project_id: str) -> list[MinutesItem]:
    """그 프로젝트의 회의록 전부 — 회의 날짜 내림차순(없으면 맨 뒤) → seq 내림차순."""
    rows = await session.execute(
        select(Minutes)
        .where(Minutes.project_id == project_id)
        .order_by(Minutes.meeting_date.desc().nulls_last(), Minutes.seq.desc())
    )
    return [MinutesItem.model_validate(row) for row in rows.scalars().all()]


async def create_minutes(
    session: AsyncSession, project_id: str, author_id: str, payload: MinutesCreate
) -> MinutesOut:
    written = now()
    minutes = Minutes(
        id=new_id(),
        project_id=project_id,
        title=payload.title,
        meeting_date=payload.meeting_date,
        body=payload.body,
        summary="",
        author_id=author_id,
        created_at=written,
        updated_at=written,
    )
    session.add(minutes)
    await session.commit()
    return MinutesOut.model_validate(minutes)


async def get_minutes(session: AsyncSession, minutes_id: str) -> MinutesOut:
    return MinutesOut.model_validate(await load_minutes(session, minutes_id))


async def edit_minutes(
    session: AsyncSession, minutes_id: str, scope: Scope, payload: MinutesPatch
) -> MinutesOut:
    minutes = await load_minutes(session, minutes_id)
    # 남의 회의록을 고쳐 쓰면 그 사람이 적은 기록이 된다 — 관리자도 못 고친다
    if minutes.author_id != scope.actor.id:
        raise forbidden()
    sent = payload.model_fields_set
    if "title" in sent and payload.title is not None:
        minutes.title = payload.title
    if "meeting_date" in sent:
        minutes.meeting_date = payload.meeting_date
    if "body" in sent and payload.body is not None:
        minutes.body = payload.body
    if sent:
        minutes.updated_at = now()
    await session.commit()
    return MinutesOut.model_validate(minutes)


async def delete_minutes(session: AsyncSession, minutes_id: str, scope: Scope) -> None:
    """회의록만 지운다. 거기서 등록한 줄은 남고 출처만 빈다."""
    minutes = await load_minutes(session, minutes_id)
    if minutes.author_id != scope.actor.id and not scope.can_manage:
        raise forbidden()
    # FK 의 ON DELETE SET NULL 과 같은 일을 먼저 한다 — 세션에 올라 있는 줄도 같이 비게
    for model in (Thread, Entry, Task):
        await session.execute(
            update(model).where(model.minutes_id == minutes.id).values(minutes_id=None)
        )
    await session.delete(minutes)
    await session.commit()


def _lines(values: Sequence[str]) -> list[str]:
    return [line for line in (value.strip() for value in values) if line]


def _body[B: ProposedEntryBody](entry: B) -> B:
    # 담당자를 정했으면 회의록에서 부른 말은 필요 없다 — ownerHint 는 ownerId 가 null 일 때만
    return entry.model_copy(
        update={
            "text": entry.text.strip(),
            "detail": _lines(entry.detail),
            "owner_hint": "" if entry.owner_id is not None else entry.owner_hint.strip(),
        }
    )


def normalize(
    threads: Sequence[ProposedThread],
    entries: Sequence[ProposedEntry],
    tasks: Sequence[ProposedMinutesTask],
) -> Rows:
    """제목 · 글의 앞뒤 공백을 떼고 후보 · 상세의 빈 줄을 뺀다. 검사 전에 한 번."""
    return (
        [
            thread.model_copy(
                update={
                    "title": thread.title.strip(),
                    "options": _lines(thread.options),
                    "owner_hint": "" if thread.owner_id is not None else thread.owner_hint.strip(),
                    "entry": _body(thread.entry) if thread.entry is not None else None,
                }
            )
            for thread in threads
        ],
        [_body(entry) for entry in entries],
        [
            task.model_copy(
                update={
                    "title": task.title.strip(),
                    "owner_hint": "" if task.owner_id is not None else task.owner_hint.strip(),
                }
            )
            for task in tasks
        ],
    )


def shape_problems(
    threads: Sequence[ProposedThread],
    entries: Sequence[ProposedEntry],
    tasks: Sequence[ProposedMinutesTask],
) -> dict[str, str]:
    """DB 를 안 보는 규칙. 자리는 `threads.0.title` · `tasks.1.threadTempIds.0` 처럼 짚는다."""
    problems: dict[str, str] = {}
    if len(threads) > MINUTES_THREADS_MAX:
        problems["threads"] = f"새 안건은 한 번에 {MINUTES_THREADS_MAX}개까지입니다."
    if len(entries) > MINUTES_ENTRIES_MAX:
        problems["entries"] = f"이력은 한 번에 {MINUTES_ENTRIES_MAX}개까지입니다."
    if len(tasks) > MINUTES_TASKS_MAX:
        problems["tasks"] = f"작업은 한 번에 {MINUTES_TASKS_MAX}개까지입니다."
    if not threads and not entries and not tasks:
        # 어느 한 묶음의 자리가 아니다 — 오류 처리기가 요청 전체에 쓰는 이름과 같다
        problems["요청"] = "등록할 것이 하나도 없습니다."
    if problems:
        return problems

    taken: set[str] = set()

    def check_temp_id(at: str, temp_id: str) -> None:
        if not temp_id.strip():
            problems[f"{at}.tempId"] = "값을 입력해 주세요."
        elif temp_id in taken:
            problems[f"{at}.tempId"] = "초안의 다른 줄과 tempId 가 겹칩니다."
        taken.add(temp_id)

    for index, thread in enumerate(threads):
        at = f"threads.{index}"
        check_temp_id(at, thread.temp_id)
        if not thread.title:
            problems[f"{at}.title"] = "제목을 입력해 주세요."
        if thread.entry is not None and not thread.entry.text:
            problems[f"{at}.entry.text"] = "내용을 입력해 주세요."
    new_threads = {thread.temp_id for thread in threads}

    seen_threads: set[str] = set()
    for index, entry in enumerate(entries):
        at = f"entries.{index}"
        check_temp_id(at, entry.temp_id)
        if not entry.text:
            problems[f"{at}.text"] = "내용을 입력해 주세요."
        if entry.thread_id in seen_threads:
            problems[f"{at}.threadId"] = "한 안건에 이력은 하나까지입니다."
        seen_threads.add(entry.thread_id)

    # 작업 줄의 규칙은 일괄 등록 그대로다 — 개수만 회의록의 상한(30)을 따른다
    problems.update(task_service.task_problems(tasks, taken=taken))
    for index, task in enumerate(tasks):
        for place, temp_id in enumerate(task.thread_temp_ids):
            if temp_id not in new_threads:
                problems[f"tasks.{index}.threadTempIds.{place}"] = "이 초안에 없는 새 안건입니다."
    return problems


async def minutes_problems(
    session: AsyncSession,
    project_id: str,
    threads: Sequence[ProposedThread],
    entries: Sequence[ProposedEntry],
    tasks: Sequence[ProposedMinutesTask],
) -> list[ApiError]:
    """걸린 것을 오류 하나씩으로 — 등록은 첫 것을 내고, 초안 도구는 다 모아 Claude 에게 돌려준다.

    순서는 422 → 없는 안건 → 담당자(안건 · 이력 · 작업) → 없는 상위 작업. 읽기만 한다.
    """
    found: list[ApiError] = []
    shape = shape_problems(threads, entries, tasks)
    if shape:
        found.append(ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", shape))

    # 다른 프로젝트의 안건도 '없다' 로 본다 — 있는지조차 알려 주지 않는다
    wanted = {entry.thread_id for entry in entries} | {
        thread_id for task in tasks for thread_id in task.thread_ids
    }
    owner_of: dict[str, str | None] = {}
    if wanted:
        rows = await session.execute(
            select(Thread.id, Thread.owner_id).where(
                Thread.project_id == project_id, Thread.id.in_(wanted)
            )
        )
        owner_of = {thread_id: owner_id for thread_id, owner_id in rows.tuples().all()}
    missing_threads = {
        f"entries.{index}.threadId": THREAD_MISSING
        for index, entry in enumerate(entries)
        if entry.thread_id not in owner_of
    } | {
        f"tasks.{index}.threadIds.{place}": THREAD_MISSING
        for index, task in enumerate(tasks)
        for place, thread_id in enumerate(task.thread_ids)
        if thread_id not in owner_of
    }
    if missing_threads:
        found.append(ApiError(400, "THREAD_NOT_FOUND", THREAD_MISSING, missing_threads))

    asked = (
        {thread.owner_id for thread in threads}
        | {thread.entry.owner_id for thread in threads if thread.entry is not None}
        | {entry.owner_id for entry in entries}
        | {task.owner_id for task in tasks}
    )
    assignable = await access.active_project_members(
        session, project_id, {owner for owner in asked if owner is not None}
    )

    def bad(owner_id: str | None, keep: str | None = None) -> bool:
        # 안건 담당자를 그대로 적는 이력은 새로 지정하는 것이 아니다 — POST .../entries 와 같은 경계
        return owner_id is not None and owner_id != keep and owner_id not in assignable

    thread_owners = {
        f"threads.{index}.ownerId": OWNER_MISSING
        for index, thread in enumerate(threads)
        if bad(thread.owner_id)
    }
    if thread_owners:
        found.append(ApiError(400, "THREAD_OWNER_NOT_FOUND", OWNER_MISSING, thread_owners))

    entry_owners = {
        f"threads.{index}.entry.ownerId": OWNER_MISSING
        for index, thread in enumerate(threads)
        if thread.entry is not None and bad(thread.entry.owner_id, keep=thread.owner_id)
    } | {
        f"entries.{index}.ownerId": OWNER_MISSING
        for index, entry in enumerate(entries)
        if entry.thread_id in owner_of and bad(entry.owner_id, keep=owner_of[entry.thread_id])
    }
    if entry_owners:
        found.append(ApiError(400, "ENTRY_OWNER_NOT_FOUND", OWNER_MISSING, entry_owners))

    task_owners = await task_service.missing_owners(session, project_id, tasks)
    if task_owners:
        found.append(ApiError(400, "TASK_OWNER_NOT_FOUND", OWNER_MISSING, task_owners))

    orphans = await task_service.missing_parents(session, project_id, tasks)
    if orphans:
        found.append(
            ApiError(400, "TASK_PARENT_NOT_FOUND", "상위 작업을 찾을 수 없습니다.", orphans)
        )
    return found


def _entry_create(entry: ProposedEntryBody) -> EntryCreate:
    return EntryCreate(
        kind=entry.kind,
        text=entry.text,
        detail=entry.detail,
        note=entry.note,
        owner_id=entry.owner_id,
    )


async def apply_minutes(
    session: AsyncSession, minutes_id: str, payload: MinutesApplyInput
) -> MinutesApplyResult:
    """고른 초안을 한 트랜잭션에 넣는다. 하나라도 틀리면 아무것도 안 남는다 — 발번한 번호까지.

    순서: 새 안건 → 그 이력 → 기존 안건의 이력 → 작업 → 작업 ↔ 안건 링크.
    만든 줄마다 출처(`minutes_id`)를 달고, 요약을 보냈으면 회의록에 남긴다.
    """
    minutes = await load_minutes(session, minutes_id)
    project = await project_service.load_project(session, minutes.project_id)
    threads, entries, tasks = normalize(payload.threads, payload.entries, payload.tasks)
    problems = await minutes_problems(session, project.id, threads, entries, tasks)
    if problems:
        raise problems[0]

    try:
        result = await _insert(session, project, minutes.id, threads, entries, tasks)
        if payload.summary is not None:
            # updated_at 은 그대로 둔다 — '고친 시각' 은 사람이 글을 고친 때다
            minutes.summary = payload.summary
        await session.commit()
    except Exception:
        # 세션을 누가 닫든 여기서 되돌린다 — 반쯤 들어간 줄이 다음 쿼리에 끌려 나가지 않게
        await session.rollback()
        raise
    return result


async def _insert(
    session: AsyncSession,
    project: Project,
    minutes_id: str,
    threads: list[ProposedThread],
    entries: list[ProposedEntry],
    tasks: list[ProposedMinutesTask],
) -> MinutesApplyResult:
    created_at = now()
    thread_ids: dict[str, str] = {}
    created_threads: list[Thread] = []
    for item in threads:
        # 새 안건은 등록만 된 상태로 선다 — 파트는 공통, 참조는 없다
        thread = Thread(
            id=new_id(),
            project_id=project.id,
            title=item.title,
            description=item.description,
            state="queued",
            owner_id=item.owner_id,
            due_date=item.due_date,
            parent_thread_id=None,
            part_id=None,
            minutes_id=minutes_id,
            created_at=created_at,
            options=[
                ThreadOption(id=new_id(), text=text, sort_order=order)
                for order, text in enumerate(item.options)
            ],
            cc=[],
        )
        session.add(thread)
        thread_ids[item.temp_id] = thread.id
        created_threads.append(thread)
    await session.flush()

    added: list[EntryOut] = []
    # 상태를 바꾸는 규칙은 POST /api/threads/{id}/entries 와 같은 함수다
    for item, thread in zip(threads, created_threads, strict=True):
        if item.entry is None:
            continue
        entry = thread_service.build_entry(_entry_create(item.entry), thread.id, now())
        entry.minutes_id = minutes_id
        session.add(entry)
        thread_service.apply_entry_to_thread(thread, item.entry.kind, item.entry.owner_id)
        await session.flush()
        added.append(thread_service.to_entry(entry))

    updated: dict[str, Thread] = {}
    for proposed in entries:
        thread = await thread_service.load_thread(session, proposed.thread_id)
        before = (thread.state, thread.owner_id)
        entry = thread_service.build_entry(_entry_create(proposed), thread.id, now())
        entry.minutes_id = minutes_id
        session.add(entry)
        thread_service.apply_entry_to_thread(thread, proposed.kind, proposed.owner_id)
        await session.flush()
        added.append(thread_service.to_entry(entry))
        if (thread.state, thread.owner_id) != before:
            updated[thread.id] = thread

    task_ids: dict[str, str] = {}
    created_tasks: list[Task] = []
    links: list[TaskThreadLinkOut] = []
    # 배열 순서대로 넣는다 — 번호가 그 순서로 나가고, 상위가 늘 먼저 들어가 있다
    for row in tasks:
        linked = list(
            dict.fromkeys([thread_ids[temp_id] for temp_id in row.thread_temp_ids] + row.thread_ids)
        )
        fields = {
            "title": row.title,
            "parent_id": (
                task_ids[row.parent_temp_id] if row.parent_temp_id is not None else row.parent_id
            ),
            "owner_id": row.owner_id,
            "start": row.start,
            "due": row.due,
            "priority": row.priority,
            "thread_ids": linked,
        }
        # partId 는 안 보낸다 — 상위 작업의 파트를 따르고, 최상위면 공통이다
        task = await task_service._insert_task(session, project, TaskCreate.model_validate(fields))
        task.minutes_id = minutes_id
        task_ids[row.temp_id] = task.id
        created_tasks.append(task)
        links += [TaskThreadLinkOut(task_id=task.id, thread_id=thread_id) for thread_id in linked]
    await session.flush()

    return MinutesApplyResult(
        threads=[thread_service.to_thread(thread) for thread in created_threads],
        entries=added,
        updated_threads=[thread_service.to_thread(thread) for thread in updated.values()],
        tasks=[task_service.to_task(task, comment_count=0) for task in created_tasks],
        links=links,
        thread_id_by_temp_id=thread_ids,
        task_id_by_temp_id=task_ids,
    )

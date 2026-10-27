"""테스트 — 쓰기 · 읽기 · 며칠째 · 신호 · 기준 바뀜 (`docs/api/test.md`).

집계를 서버가 하는 예외다(리스크 · 리포트처럼) — 신호 셈은 여기 한 곳이고
나중의 챗봇 도구가 같이 부른다. `today` 를 인자로 받는다 — 검사가 날짜에 흔들리지 않게.
목록은 몇 번의 select 로 다 읽고 계산은 파이썬에서 한다.
"""

from collections import defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, bad_request, not_found
from app.models import Entry, Project, Task, TaskThreadLink, TestCase, TestRef, TestStep, Thread
from app.models.base import new_id
from app.schemas.risk import RiskSettings
from app.schemas.test import (
    REFS_MAX,
    TestCaseOut,
    TestCreate,
    TestPatch,
    TestRefIn,
    TestRefKind,
    TestRefOut,
    TestSignal,
    TestStatusInput,
    TestStepIn,
    TestStepOut,
)
from app.services import access
from app.services import history as history_service
from app.services import part as part_service
from app.services import project as project_service
from app.services import risk as risk_service
from app.services.access import Scope
from app.services.progress import kst_day
from app.time import now

SIGNAL_ORDER: tuple[TestSignal, ...] = (
    "longRunning",
    "overdue",
    "notStarted",
    "longBlocked",
    "failedIdle",
    "basisChanged",
)
DECISION_KINDS = ("decide", "change")
NOT_STARTED = ("draft", "ready")
WITH_NOTE = ("fail", "blocked")


def _test_not_found() -> ApiError:
    return not_found("TEST_NOT_FOUND", "테스트를 찾을 수 없습니다.")


def _invalid(field: str, reason: str) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {field: reason})


async def load_test(session: AsyncSession, test_id: str) -> TestCase:
    found = (
        await session.execute(select(TestCase).where(TestCase.id == test_id))
    ).scalar_one_or_none()
    if found is None:
        raise _test_not_found()
    return found


# --- 읽기 · 셈 ---


@dataclass(frozen=True)
class _Ref:
    kind: TestRefKind
    target_id: str
    seq: int


@dataclass(frozen=True)
class _Entry:
    id: str
    kind: str
    seq: int


async def _refs(session: AsyncSession, test_ids: Collection[str]) -> dict[str, list[_Ref]]:
    """테스트마다 태그 — task 먼저, 그 안은 작업 · 안건의 seq 순 (계약 '모양')."""
    if not test_ids:
        return {}
    rows = await session.execute(
        select(
            TestRef.test_id,
            TestRef.task_id,
            TestRef.thread_id,
            Task.seq.label("task_seq"),
            Thread.seq.label("thread_seq"),
        )
        .outerjoin(Task, Task.id == TestRef.task_id)
        .outerjoin(Thread, Thread.id == TestRef.thread_id)
        .where(TestRef.test_id.in_(test_ids))
    )
    found: dict[str, list[_Ref]] = defaultdict(list)
    for test_id, task_id, thread_id, task_seq, thread_seq in rows.tuples():
        if task_id is not None:
            found[test_id].append(_Ref("task", task_id, task_seq))
        elif thread_id is not None:
            found[test_id].append(_Ref("thread", thread_id, thread_seq))
    for refs in found.values():
        refs.sort(key=lambda ref: (ref.kind != "task", ref.seq))
    return found


async def _links(session: AsyncSession, task_ids: Collection[str]) -> dict[str, set[str]]:
    """작업 → 걸린 안건."""
    if not task_ids:
        return {}
    rows = await session.execute(
        select(TaskThreadLink.task_id, TaskThreadLink.thread_id).where(
            TaskThreadLink.task_id.in_(task_ids)
        )
    )
    found: dict[str, set[str]] = defaultdict(set)
    for task_id, thread_id in rows.tuples():
        found[task_id].add(thread_id)
    return found


def _reached(refs: Iterable[_Ref], links: dict[str, set[str]]) -> set[str]:
    """닿는 안건 = 직접 태그한 안건 + 태그한 작업에 걸린 안건."""
    threads: set[str] = set()
    for ref in refs:
        if ref.kind == "thread":
            threads.add(ref.target_id)
        else:
            threads |= links.get(ref.target_id, set())
    return threads


async def _entries(session: AsyncSession, thread_ids: Collection[str]) -> dict[str, list[_Entry]]:
    if not thread_ids:
        return {}
    rows = await session.execute(
        select(Entry.id, Entry.thread_id, Entry.kind, Entry.seq)
        .where(Entry.thread_id.in_(thread_ids))
        .order_by(Entry.seq)
    )
    found: dict[str, list[_Entry]] = defaultdict(list)
    for entry_id, thread_id, kind, seq in rows.tuples():
        found[thread_id].append(_Entry(entry_id, kind, seq))
    return found


async def _groups(session: AsyncSession, test_ids: Collection[str]) -> set[str]:
    """이 가운데 하위가 있는 테스트(묶음)."""
    if not test_ids:
        return set()
    rows = await session.scalars(
        select(TestCase.parent_id).where(TestCase.parent_id.in_(test_ids)).distinct()
    )
    return {parent_id for parent_id in rows.all() if parent_id is not None}


async def _has_children(session: AsyncSession, test_id: str) -> bool:
    return bool(await _groups(session, [test_id]))


async def _current_basis(session: AsyncSession, test_id: str) -> int | None:
    """지금 닿는 안건들의 Entry seq 최댓값. 닿는 안건 · Entry 가 없으면 null."""
    refs = (await _refs(session, [test_id])).get(test_id, [])
    links = await _links(session, {ref.target_id for ref in refs if ref.kind == "task"})
    reached = _reached(refs, links)
    if not reached:
        return None
    top: int | None = await session.scalar(
        select(func.max(Entry.seq)).where(Entry.thread_id.in_(reached))
    )
    return top


def _changed(reached: set[str], entries: dict[str, list[_Entry]], basis: int | None) -> list[str]:
    """basis 뒤로 닿는 안건에 생긴 decide · change — 오래된 것부터."""
    floor = basis or 0
    picked = [
        entry
        for thread_id in reached
        for entry in entries.get(thread_id, [])
        if entry.kind in DECISION_KINDS and entry.seq > floor
    ]
    return [entry.id for entry in sorted(picked, key=lambda entry: entry.seq)]


def status_days(row: TestCase, today: date) -> int:
    return max((today - kst_day(row.status_changed_at)).days, 0)


def signals(
    row: TestCase, *, days: int, changed: bool, rule: RiskSettings, today: date
) -> list[TestSignal]:
    """계약 '며칠째 · 신호' 표 그대로 — 진행 리포트의 손쓸 작업 신호와 같은 셈이다.
    묶음인지는 부르는 쪽이 거른다."""
    if row.status != "testing":
        long_running = False
    elif row.start is not None and row.due is not None:
        planned = (row.due - row.start).days + 1
        # 계획의 1.5배를 넘음 — 정수로만 비교한다
        long_running = 2 * days > 3 * planned
    else:
        long_running = days > rule.stale_days
    hits: dict[TestSignal, bool] = {
        "longRunning": long_running,
        "overdue": row.due is not None and row.due < today and row.status != "pass",
        "notStarted": row.start is not None and row.start < today and row.status in NOT_STARTED,
        "longBlocked": row.status == "blocked" and days > rule.stale_days,
        "failedIdle": row.status == "fail" and days > rule.stale_days,
        "basisChanged": changed,
    }
    return [signal for signal in SIGNAL_ORDER if hits[signal]]


async def _build(
    session: AsyncSession, project_id: str, rows: list[TestCase], today: date
) -> list[TestCaseOut]:
    """응답 모양으로 — 몇 개를 넘기든 select 수는 같다."""
    ids = [row.id for row in rows]
    rule = await risk_service.load_settings(session, project_id)
    refs = await _refs(session, ids)
    links = await _links(
        session, {ref.target_id for each in refs.values() for ref in each if ref.kind == "task"}
    )
    reached = {test_id: _reached(refs.get(test_id, []), links) for test_id in ids}
    entries = await _entries(session, set().union(*reached.values()) if reached else set())
    groups = await _groups(session, ids)

    built: list[TestCaseOut] = []
    for row in rows:
        days = status_days(row, today)
        changed = _changed(reached[row.id], entries, row.basis_seq)
        built.append(
            TestCaseOut(
                id=row.id,
                project_id=row.project_id,
                key=row.key,
                title=row.title,
                parent_id=row.parent_id,
                purpose=row.purpose,
                precondition=row.precondition,
                test_data=row.test_data,
                steps=[TestStepOut(action=s.action, expected=s.expected) for s in row.steps],
                refs=[TestRefOut(kind=ref.kind, id=ref.target_id) for ref in refs.get(row.id, [])],
                status=row.status,
                status_changed_at=row.status_changed_at,
                status_changed_by=row.status_changed_by,
                status_days=days,
                failed_step=row.failed_step,
                result_note=row.result_note,
                start=row.start,
                due=row.due,
                owner_id=row.owner_id,
                part_id=row.part_id,
                # 묶음의 상태 · 신호는 화면이 하위에서 모은다
                signals=(
                    []
                    if row.id in groups
                    else signals(row, days=days, changed=bool(changed), rule=rule, today=today)
                ),
                changed_entry_ids=changed,
                created_by=row.created_by,
                created_at=row.created_at,
            )
        )
    return built


async def _one(session: AsyncSession, row: TestCase, today: date) -> TestCaseOut:
    return (await _build(session, row.project_id, [row], today))[0]


async def list_tests(session: AsyncSession, project_id: str, *, today: date) -> list[TestCaseOut]:
    rows = await session.scalars(
        select(TestCase).where(TestCase.project_id == project_id).order_by(TestCase.seq)
    )
    return await _build(session, project_id, list(rows.all()), today)


async def get_test(session: AsyncSession, test_id: str, *, today: date) -> TestCaseOut:
    return await _one(session, await load_test(session, test_id), today)


# --- 검사 ---


def _guard_period(start: date | None, due: date | None) -> None:
    if start is not None and due is not None and start > due:
        raise _invalid("due", "끝이 시작보다 빠릅니다.")


async def _guard_parent(
    session: AsyncSession, project_id: str, test_id: str | None, parent_id: str | None
) -> None:
    """고리 금지 — 작업의 상위 작업과 같은 규칙. 다른 프로젝트의 테스트는 '없다' 로 본다."""
    if parent_id is None:
        return
    if parent_id == test_id:
        raise bad_request("TEST_PARENT_SELF", "테스트를 자기 자신의 상위로 둘 수 없습니다.")
    found = (
        await session.execute(
            select(TestCase.project_id, TestCase.parent_id).where(TestCase.id == parent_id)
        )
    ).one_or_none()
    if found is None or found.project_id != project_id:
        raise bad_request("TEST_PARENT_NOT_FOUND", "상위 테스트를 찾을 수 없습니다.")
    seen: set[str] = set()
    walker: str | None = found.parent_id
    while walker is not None:
        if walker == test_id:
            raise bad_request("TEST_PARENT_DESCENDANT", "하위 테스트를 상위로 둘 수 없습니다.")
        if walker in seen:  # 이미 망가진 데이터를 만나도 여기서 멈춘다
            return
        seen.add(walker)
        walker = await session.scalar(select(TestCase.parent_id).where(TestCase.id == walker))


async def _guard_owner(session: AsyncSession, project_id: str, owner_id: str | None) -> None:
    if owner_id is not None and not await access.is_assignable(session, project_id, owner_id):
        raise ApiError(
            400,
            "TEST_OWNER_NOT_FOUND",
            "담당자를 찾을 수 없습니다.",
            {"ownerId": "담당자를 찾을 수 없습니다."},
        )


async def _guard_target(
    session: AsyncSession, project_id: str, kind: TestRefKind, target_id: str
) -> None:
    """같은 프로젝트의 작업 · 안건만 건다. 다른 프로젝트 것은 '없다' 로 본다."""
    if kind == "task":
        owner = await session.scalar(select(Task.project_id).where(Task.id == target_id))
        if owner != project_id:
            raise not_found("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.")
    else:
        owner = await session.scalar(select(Thread.project_id).where(Thread.id == target_id))
        if owner != project_id:
            raise not_found("THREAD_NOT_FOUND", "안건을 찾을 수 없습니다.")


def _ref_limit() -> ApiError:
    return bad_request("TEST_REF_LIMIT", f"태그는 {REFS_MAX}개까지 걸 수 있습니다.")


# --- 쓰기 ---


async def _next_key(session: AsyncSession, project: Project) -> str:
    """작업 번호와 같은 수법 — 프로젝트 행을 한 문장으로 올려 뽑으면 그 행의 잠금이 순서를 지킨다.
    지운 번호를 다시 쓰지 않는다."""
    bumped = await session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(next_test_no=Project.next_test_no + 1)
        .returning(Project.next_test_no)
    )
    return f"{project.task_key_prefix}-T{bumped.scalar_one() - 1}"


async def _part_for_new(session: AsyncSession, project_id: str, payload: TestCreate) -> str | None:
    """키를 안 보냈으면 상위 테스트의 파트를 따른다 — 작업과 같다."""
    if "part_id" in payload.model_fields_set:
        part_id = payload.part_id
    elif payload.parent_id is not None:
        part_id = await session.scalar(
            select(TestCase.part_id).where(TestCase.id == payload.parent_id)
        )
    else:
        part_id = None
    await part_service.guard_part(session, project_id, part_id)
    return part_id


def _new_steps(steps: list[TestStepIn]) -> list[TestStep]:
    return [
        TestStep(id=new_id(), sort_order=order, action=step.action, expected=step.expected)
        for order, step in enumerate(steps)
    ]


def _replace_steps(test: TestCase, steps: list[TestStepIn]) -> None:
    """자리 순서대로 있던 줄을 고쳐 쓴다 — 지우고 새로 넣으면 `(test_id, sort_order)` 유니크에
    걸린다(같은 flush 에서 INSERT 가 DELETE 보다 먼저 나간다). 남는 줄은 delete-orphan 이 지운다."""
    existing = list(test.steps)
    replaced: list[TestStep] = []
    for order, item in enumerate(steps):
        step = existing[order] if order < len(existing) else TestStep(id=new_id(), sort_order=order)
        step.action = item.action
        step.expected = item.expected
        replaced.append(step)
    test.steps = replaced


def _unique_refs(refs: list[TestRefIn]) -> list[TestRefIn]:
    return list({(ref.kind, ref.id): ref for ref in refs}.values())


def _ref_row(test: TestCase, kind: TestRefKind, target_id: str) -> TestRef:
    return TestRef(
        id=new_id(),
        test_id=test.id,
        project_id=test.project_id,
        task_id=target_id if kind == "task" else None,
        thread_id=target_id if kind == "thread" else None,
    )


async def create_test(
    session: AsyncSession, project_id: str, payload: TestCreate, actor_id: str, *, today: date
) -> TestCaseOut:
    project = await project_service.load_project(session, project_id)
    _guard_period(payload.start, payload.due)
    await _guard_parent(session, project.id, None, payload.parent_id)
    await _guard_owner(session, project.id, payload.owner_id)
    part_id = await _part_for_new(session, project.id, payload)
    refs = _unique_refs(payload.refs)
    if len(refs) > REFS_MAX:
        raise _ref_limit()
    for ref in refs:
        await _guard_target(session, project.id, ref.kind, ref.id)

    at = now()
    test = TestCase(
        id=new_id(),
        project_id=project.id,
        key=await _next_key(session, project),
        title=payload.title,
        purpose=payload.purpose,
        precondition=payload.precondition,
        test_data=payload.test_data,
        parent_id=payload.parent_id,
        status="draft",
        status_changed_at=at,
        # 만든 사람이 draft 로 둔 것이다
        status_changed_by=actor_id,
        failed_step=None,
        result_note="",
        start=payload.start,
        due=payload.due,
        owner_id=payload.owner_id,
        part_id=part_id,
        created_by=actor_id,
        created_at=at,
        steps=_new_steps(payload.steps),
    )
    session.add(test)
    await session.flush()
    # 같이 건 태그는 '등록' 에 든 것으로 본다 — 작업의 threadIds 와 같다
    history_service.record_test(session, test, history_service.created(), actor_id, at)
    session.add_all([_ref_row(test, ref.kind, ref.id) for ref in refs])
    test.basis_seq = await _current_basis(session, test.id)
    await session.commit()
    return await _one(session, test, today)


def _text_fields(test: TestCase) -> list[tuple[str, object]]:
    """PATCH 가 남기는 글 칸 — 계약 '칸' 표의 순서. 단계는 그 뒤, 나머지는 `_plan_fields`."""
    return [
        ("title", test.title),
        ("purpose", test.purpose),
        ("precondition", test.precondition),
        ("testData", test.test_data),
    ]


def _plan_fields(test: TestCase) -> list[tuple[str, object]]:
    return [
        ("parentId", test.parent_id),
        ("ownerId", test.owner_id),
        ("partId", test.part_id),
        ("start", test.start),
        ("due", test.due),
    ]


def _steps_shape(test: TestCase) -> list[tuple[str, str]]:
    return [(step.action, step.expected) for step in test.steps]


def _diff_fields(
    before: list[tuple[str, object]], after: list[tuple[str, object]]
) -> list[history_service.Change]:
    now_values = dict(after)
    return history_service.diff((field, old, now_values[field]) for field, old in before)


async def patch_test(
    session: AsyncSession, test_id: str, payload: TestPatch, actor_id: str, *, today: date
) -> TestCaseOut:
    test = await load_test(session, test_id)
    texts_before = _text_fields(test)
    plan_before = _plan_fields(test)
    steps_before = _steps_shape(test)
    sent = payload.model_fields_set
    changes = payload.model_dump(exclude_unset=True, exclude={"steps"})
    _guard_period(changes.get("start", test.start), changes.get("due", test.due))
    if "parent_id" in changes:
        await _guard_parent(session, test.project_id, test.id, changes["parent_id"])
    # 이미 걸려 있던 담당자 · 보관 파트를 그대로 두는 수정은 막지 않는다 — 작업과 같다
    if "owner_id" in changes and changes["owner_id"] != test.owner_id:
        await _guard_owner(session, test.project_id, changes["owner_id"])
    if "part_id" in changes and changes["part_id"] != test.part_id:
        await part_service.guard_part(session, test.project_id, changes["part_id"])
    for field, value in changes.items():
        setattr(test, field, value)
    if "steps" in sent:
        _replace_steps(test, payload.steps)
    changed = _diff_fields(texts_before, _text_fields(test))
    # 단계는 바뀌었다는 것과 개수만 남긴다 (docs/api/history.md '긴 글')
    if _steps_shape(test) != steps_before:
        changed.append(history_service.change("steps", len(steps_before), len(test.steps)))
    changed += _diff_fields(plan_before, _plan_fields(test))
    history_service.record_test(session, test, changed, actor_id, now())
    # 고쳤다는 것은 지금 기준으로 다시 봤다는 뜻이다
    if sent:
        test.basis_seq = await _current_basis(session, test.id)
    await session.commit()
    return await _one(session, test, today)


async def delete_test(session: AsyncSession, test_id: str, scope: Scope) -> None:
    """만든 사람 · 그 프로젝트 관리자 · 시스템 관리자. 하위가 있으면 못 지운다."""
    test = await load_test(session, test_id)
    if test.created_by != scope.actor.id and not scope.can_manage:
        raise access.forbidden()
    if await _has_children(session, test.id):
        raise ApiError(409, "TEST_HAS_CHILDREN", "하위 테스트가 있어 지울 수 없습니다.")
    await session.delete(test)
    await session.commit()


async def set_status(
    session: AsyncSession, test_id: str, payload: TestStatusInput, actor_id: str, *, today: date
) -> TestCaseOut:
    """같은 상태로 다시 보내도 언제 · 누가를 새로 찍는다(덮어쓴다)."""
    test = await load_test(session, test_id)
    if await _has_children(session, test.id):
        raise bad_request("TEST_GROUP_STATUS", "하위가 있는 테스트는 상태를 직접 바꿀 수 없습니다.")
    failed_step = payload.failed_step if payload.status == "fail" else None
    if failed_step is not None and not 1 <= failed_step <= len(test.steps):
        raise _invalid("failedStep", f"1 ~ {len(test.steps)} 사이의 단계여야 합니다.")
    note = payload.note.strip()
    if payload.status in WITH_NOTE and not note:
        raise _invalid("note", "값을 입력해 주세요.")
    result_note = note if payload.status in WITH_NOTE else ""
    # 상태는 같은 값이어도 남긴다 — 며칠째가 다시 0 이 된 까닭이다. 메모의 빈 값은 null 로 남긴다
    changed = [history_service.change("status", test.status, payload.status)]
    changed += history_service.diff(
        [
            ("failedStep", test.failed_step, failed_step),
            ("resultNote", test.result_note or None, result_note or None),
        ]
    )
    test.status = payload.status
    test.status_changed_at = now()
    test.status_changed_by = actor_id
    test.failed_step = failed_step
    test.result_note = result_note
    history_service.record_test(session, test, changed, actor_id, test.status_changed_at)
    await session.commit()
    return await _one(session, test, today)


def _ref_field(kind: TestRefKind) -> str:
    return "taskRef" if kind == "task" else "threadRef"


async def put_ref(
    session: AsyncSession,
    test_id: str,
    kind: TestRefKind,
    target_id: str,
    actor_id: str,
    *,
    today: date,
) -> TestCaseOut:
    """멱등 — 이미 걸려 있으면 아무것도 바꾸지 않는다(기준도 그대로)."""
    test = await load_test(session, test_id)
    await _guard_target(session, test.project_id, kind, target_id)
    column = TestRef.task_id if kind == "task" else TestRef.thread_id
    exists = await session.scalar(
        select(TestRef.id).where(TestRef.test_id == test.id, column == target_id)
    )
    if exists is None:
        count = await session.scalar(
            select(func.count()).select_from(TestRef).where(TestRef.test_id == test.id)
        )
        if (count or 0) >= REFS_MAX:
            raise _ref_limit()
        session.add(_ref_row(test, kind, target_id))
        tagged = [history_service.change(_ref_field(kind), None, target_id)]
        history_service.record_test(session, test, tagged, actor_id, now())
        test.basis_seq = await _current_basis(session, test.id)
        await session.commit()
    return await _one(session, test, today)


async def delete_ref(
    session: AsyncSession, test_id: str, kind: TestRefKind, target_id: str, actor_id: str
) -> None:
    """멱등 — 없는 태그도 성공이다."""
    test = await load_test(session, test_id)
    column = TestRef.task_id if kind == "task" else TestRef.thread_id
    found = await session.scalar(
        select(TestRef).where(TestRef.test_id == test.id, column == target_id)
    )
    if found is None:
        return
    await session.delete(found)
    await session.flush()
    history_service.record_test(
        session, test, [history_service.change(_ref_field(kind), target_id, None)], actor_id, now()
    )
    test.basis_seq = await _current_basis(session, test.id)
    await session.commit()


async def confirm_basis(
    session: AsyncSession, test_id: str, actor_id: str, *, today: date
) -> TestCaseOut:
    """'그대로 맞다' — 지금까지의 결정을 보고 테스트가 맞다고 확인했다.
    기준 값이 그대로여도 확인한 일 자체를 남긴다."""
    test = await load_test(session, test_id)
    test.basis_seq = await _current_basis(session, test.id)
    history_service.record_test(
        session, test, [history_service.change("basis", None, None)], actor_id, now()
    )
    await session.commit()
    return await _one(session, test, today)

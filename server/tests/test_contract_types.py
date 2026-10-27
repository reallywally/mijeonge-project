"""스냅샷이 `web/src/types/domain.ts` 와 한 필드씩 맞는지 본다.

계약의 값어치가 여기 있다 — 프론트가 타입을 고치거나 서버가 필드를 흘리면 여기서 깨진다.
**`domain.ts` 를 파일로 읽어서 대조하므로 필드 목록을 두 벌로 적어 두지 않는다** —
`tests/test_read_api.py` 의 상수 목록이 손으로 옮겨 적은 쪽이고, 여기는 원본을 본다.
"""

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

DOMAIN_TS = Path(__file__).resolve().parents[2] / "web" / "src" / "types" / "domain.ts"

_INTERFACE = re.compile(r"^export interface (\w+)(?: extends ([\w, ]+))? \{$")
_FIELD = re.compile(r"^  (\w+)\??: (.+?)$")


# interface 이름 → extends 한 이름들. FIELDS 에는 그 interface 가 직접 적은 필드만 있다
EXTENDS: dict[str, list[str]] = {}


def _declared_fields() -> dict[str, dict[str, bool]]:
    """interface 이름 → {필드 이름: null 을 허용하나}"""
    found: dict[str, dict[str, bool]] = {}
    name: str | None = None
    for line in DOMAIN_TS.read_text(encoding="utf-8").splitlines():
        if line == "}":
            name = None
            continue
        head = _INTERFACE.match(line)
        if head:
            name = head.group(1)
            found[name] = {}
            if head.group(2):
                EXTENDS[name] = [parent.strip() for parent in head.group(2).split(",")]
            continue
        if name is None:
            continue
        field = _FIELD.match(line)
        if field:
            found[name][field.group(1)] = "null" in field.group(2)
    return found


FIELDS = _declared_fields()


def all_fields(name: str) -> dict[str, bool]:
    """extends 한 interface 의 필드까지 합친다."""
    merged: dict[str, bool] = {}
    for parent in EXTENDS.get(name, []):
        merged |= all_fields(parent)
    return merged | FIELDS.get(name, {})


Pick = Callable[[dict[str, Any]], list[dict[str, Any]]]

# 스냅샷의 어느 자리가 domain.ts 의 어느 타입인가
CASES: list[tuple[str, Pick]] = [
    ("Project", lambda body: [body["project"]]),
    ("Thread", lambda body: body["threads"]),
    ("Entry", lambda body: body["entries"]),
    ("Task", lambda body: body["tasks"]),
    ("TaskLine", lambda body: [line for task in body["tasks"] for line in task["body"]]),
    ("TaskThreadLink", lambda body: body["taskThreadLinks"]),
    ("TaskDependency", lambda body: body["taskDependencies"]),
]


# 파트가 늘린 필드 — docs/api/part.md '모양'. 프론트가 domain.ts 에 더하는 중이라 아직 없을 수 있다.
# 어긋나면 계약 쪽이 기준이다. 둘 다 null 을 낸다(null = 프로젝트 공통)
PART_ADDED: dict[str, set[str]] = {"Task": {"partId"}, "Thread": {"partId"}}
# 회의록이 늘린 출처 — docs/api/minutes.md '게시판'(2026-10-20 고침).
# 셋 다 null 을 낸다(손으로 만든 것)
MINUTES_ADDED: dict[str, set[str]] = {
    "Thread": {"minutesId"},
    "Entry": {"minutesId"},
    "Task": {"minutesId"},
}


def _added(name: str) -> set[str]:
    return PART_ADDED.get(name, set()) | MINUTES_ADDED.get(name, set())


def expected_keys(name: str) -> set[str]:
    return set(FIELDS[name]) | _added(name)


def nullable_keys(name: str) -> set[str]:
    return {field for field, nullable in FIELDS[name].items() if nullable} | _added(name)


@pytest.fixture
async def snapshot(client: AsyncClient) -> dict[str, Any]:
    res = await client.get("/api/projects/p1/snapshot")
    assert res.status_code == 200
    body: dict[str, Any] = res.json()
    return body


@pytest.mark.parametrize(("name", "pick"), CASES, ids=[name for name, _ in CASES])
def test_keys_match_domain_ts(name: str, pick: Pick, snapshot: dict[str, Any]) -> None:
    rows = pick(snapshot)
    assert rows, f"{name} 을 볼 수 있는 줄이 스냅샷에 없다 — 시드를 확인해라"
    expected = expected_keys(name)
    for row in rows:
        assert set(row) == expected, f"{name} 의 키가 domain.ts 와 다르다"


@pytest.mark.parametrize(("name", "pick"), CASES, ids=[name for name, _ in CASES])
def test_null_only_where_domain_ts_allows(name: str, pick: Pick, snapshot: dict[str, Any]) -> None:
    """빈 값은 '' · [] 다 — null 은 domain.ts 가 허락한 자리에서만 나간다 (API.md Q17)."""
    nullable = nullable_keys(name)
    for row in pick(snapshot):
        for field, value in row.items():
            if value is None:
                assert field in nullable, f"{name}.{field} 가 null 로 나갔다"


ADDED = {
    name: PART_ADDED.get(name, set()) | MINUTES_ADDED.get(name, set())
    for name in sorted(set(PART_ADDED) | set(MINUTES_ADDED))
}


@pytest.mark.parametrize("name", sorted(ADDED))
def test_added_fields_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 이미 들어왔으면 계약대로 `string | null` 이어야 한다."""
    for field in ADDED[name]:
        if field in FIELDS[name]:
            assert FIELDS[name][field], f"domain.ts 의 {name}.{field} 가 null 을 허용하지 않는다"


# 인증 · 파트가 늘린 모양 — docs/api/auth.md '새 응답 · 요청 모양' · docs/api/part.md '모양'.
# 프론트가 domain.ts 에 더하는 중이라 아직 없는 필드가 있을 수 있다. 어긋나면 이 계약 쪽이 기준이다
AUTH_SHAPES: dict[str, set[str]] = {
    "Member": {"id", "name", "active"},
    "Me": {"id", "name", "email", "systemRole", "projectRoles"},
    "MemberAccount": {
        "id",
        "name",
        "email",
        "systemRole",
        "active",
        "career",
        "skills",
        "notes",
        "hasPassword",
        "createdAt",
        "lastLoginAt",
    },
    "ProjectMember": {"memberId", "role"},
    "Part": {"id", "projectId", "name", "active"},
    "PartMember": {"partId", "memberId"},
}


def contract_keys(name: str) -> set[str]:
    """서버 응답이 맞춰야 할 키. domain.ts 가 계약에 없는 필드를 들고 있으면 여기서 깨진다."""
    declared = set(FIELDS.get(name, {}))
    assert declared <= AUTH_SHAPES[name], f"domain.ts 의 {name} 이 계약(docs/api/*.md)과 다르다"
    return AUTH_SHAPES[name]


@pytest.mark.parametrize("name", sorted(AUTH_SHAPES))
def test_auth_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    contract_keys(name)


async def test_member_matches_contract(client: AsyncClient) -> None:
    rows = (await client.get("/api/members")).json()
    assert rows
    assert all(set(row) == contract_keys("Member") for row in rows)


@pytest.mark.parametrize(
    ("name", "key"), [("Part", "parts"), ("PartMember", "partMembers")], ids=["Part", "PartMember"]
)
def test_part_rows_match_contract(name: str, key: str, snapshot: dict[str, Any]) -> None:
    rows = snapshot[key]
    assert rows, f"{name} 을 볼 수 있는 줄이 스냅샷에 없다 — 시드를 확인해라"
    for row in rows:
        assert set(row) == contract_keys(name)
        # 둘 다 null 을 내는 자리가 없다
        assert all(value is not None for value in row.values())


async def test_snapshot_has_no_computed_types(snapshot: dict[str, Any]) -> None:
    """ThreadRow · TaskDetail 같은 계산된 타입은 서버가 주지 않는다."""
    assert set(snapshot) == {
        "project",
        "threads",
        "entries",
        "tasks",
        "taskThreadLinks",
        "taskDependencies",
        "parts",
        "partMembers",
    }


# 결정 병목 리스크 — docs/api/risk.md '응답' · '기준 설정'. 집계를 서버가 하는 첫 예외라(Q35)
# 계산된 타입이 응답으로 나간다. 어긋나면 계약 쪽이 기준이다
RISK_SHAPES: dict[str, set[str]] = {
    "RiskSettings": {"dueSoonDays", "deferCount", "staleDays", "highScore", "mediumScore"},
    "DecisionRiskReport": {"asOf", "settings", "threads", "tasks", "owners"},
    "ThreadRisk": {
        "threadId",
        "title",
        "state",
        "ownerId",
        "partId",
        "dueDate",
        "overdueDays",
        "deferCount",
        "lastDeferNote",
        "idleDays",
        "blockedTaskIds",
        "waitingTaskIds",
        "impactTaskCount",
        "nearestTaskDue",
        "signals",
        "score",
        "level",
    },
    "TaskRisk": {
        "taskId",
        "key",
        "title",
        "status",
        "ownerId",
        "partId",
        "due",
        "threadIds",
        "signal",
    },
    "OwnerLoad": {
        "memberId",
        "openThreads",
        "overdueThreads",
        "blockedTasks",
        "blockingImpact",
    },
}


@pytest.mark.parametrize("name", sorted(RISK_SHAPES))
def test_risk_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드가 계약과 같아야 한다."""
    if name in FIELDS:
        assert set(FIELDS[name]) == RISK_SHAPES[name], f"domain.ts 의 {name} 이 risk.md 와 다르다"


async def test_risk_report_matches_contract(client: AsyncClient) -> None:
    body = (await client.get("/api/projects/p1/risks")).json()
    assert set(body) == RISK_SHAPES["DecisionRiskReport"]
    assert set(body["settings"]) == RISK_SHAPES["RiskSettings"]
    for key, name in (("threads", "ThreadRisk"), ("tasks", "TaskRisk"), ("owners", "OwnerLoad")):
        assert body[key], f"{name} 을 볼 수 있는 줄이 시드에 없다"
        for row in body[key]:
            assert set(row) == RISK_SHAPES[name]
            # null 은 domain.ts 가 허락한 자리에서만
            for field, value in row.items():
                if value is None and name in FIELDS:
                    assert FIELDS[name][field], f"{name}.{field} 가 null 로 나갔다"


# 확인 요청 — docs/api/check.md '모양'(2026-10-19 고침). 어긋나면 계약 쪽이 기준이다.
# null 이 나갈 수 있는 자리는 `CheckRequest.confirmedAt` 하나다
CHECK_SHAPES: dict[str, set[str]] = {
    "CheckRequest": {
        "id",
        "projectId",
        "threadId",
        "entryId",
        "senderId",
        "recipientId",
        "createdAt",
        "confirmedAt",
    },
    "CheckPendingCount": {"total", "byProject"},
}
CHECK_NULLABLE = {"CheckRequest": {"confirmedAt"}}


@pytest.mark.parametrize("name", sorted(CHECK_SHAPES))
def test_check_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 계약과 같아야 한다."""
    if name in FIELDS:
        assert set(FIELDS[name]) == CHECK_SHAPES[name], f"domain.ts 의 {name} 이 check.md 와 다르다"
        nullable = {field for field, allowed in FIELDS[name].items() if allowed}
        assert nullable == CHECK_NULLABLE.get(name, set())


def test_check_input_is_gone_from_domain_ts() -> None:
    """보내기에 본문이 없어졌다 — `CheckRequestInput` 이 남아 있으면 화면이 옛 모양으로 보낸다."""
    assert "CheckRequestInput" not in FIELDS


def test_thread_cc_ids_in_domain_ts() -> None:
    """참조는 `string[]` 다 — null 이 아니라 [] 로 비운다 (Q17)."""
    assert FIELDS["Thread"].get("ccIds") is False


async def test_check_responses_match_contract(client: AsyncClient) -> None:
    rows = (await client.get("/api/projects/p1/checks")).json()
    assert rows, "CheckRequest 를 볼 수 있는 줄이 시드에 없다"
    for row in rows:
        assert set(row) == CHECK_SHAPES["CheckRequest"]
        for field, value in row.items():
            if value is None:
                assert field in CHECK_NULLABLE["CheckRequest"], f"CheckRequest.{field} 가 null"
    assert {row["confirmedAt"] is None for row in rows} == {True, False}
    count = (await client.get("/api/checks/pending-count")).json()
    assert set(count) == CHECK_SHAPES["CheckPendingCount"]


# 회의록 — docs/api/minutes.md '게시판' · '초안' · 'apply'(2026-10-20 고침).
# 프론트가 domain.ts 에 더하는 중이라 아직 없을 수 있다. 어긋나면 계약 쪽이 기준이다.
# `MinutesEvent` 는 union 이라 여기서 못 읽는다 — test_minutes 가 본다
_PROPOSED_TASK = {
    "tempId",
    "parentTempId",
    "parentId",
    "title",
    "ownerId",
    "start",
    "due",
    "priority",
}
_ENTRY_BODY = {"kind", "text", "detail", "note", "ownerId", "ownerHint"}
_MINUTES_ITEM = {"id", "projectId", "title", "meetingDate", "authorId", "createdAt", "updatedAt"}
MINUTES_SHAPES: dict[str, set[str]] = {
    "MinutesItem": _MINUTES_ITEM,
    "Minutes": _MINUTES_ITEM | {"body", "summary"},
    "MinutesInput": {"title", "meetingDate", "body"},
    "MinutesDraft": {"meetingDate", "summary", "threads", "entries", "tasks"},
    "ProposedThread": {
        "tempId",
        "title",
        "description",
        "options",
        "ownerId",
        "ownerHint",
        "dueDate",
        "entry",
        "quote",
    },
    "ProposedEntryBody": _ENTRY_BODY,
    "ProposedEntry": _ENTRY_BODY | {"tempId", "threadId", "quote"},
    "ProposedMinutesTask": _PROPOSED_TASK | {"ownerHint", "threadTempIds", "threadIds", "quote"},
    "MinutesApplyInput": {"summary", "threads", "entries", "tasks"},
    "MinutesApplyResult": {
        "threads",
        "entries",
        "updatedThreads",
        "tasks",
        "links",
        "threadIdByTempId",
        "taskIdByTempId",
    },
}
MINUTES_NULLABLE: dict[str, set[str]] = {
    "MinutesItem": {"meetingDate"},
    "Minutes": {"meetingDate"},
    "MinutesInput": {"meetingDate"},
    "MinutesDraft": {"meetingDate"},
    "ProposedThread": {"ownerId", "dueDate", "entry"},
    "ProposedEntryBody": {"ownerId"},
    "ProposedEntry": {"ownerId"},
    "ProposedMinutesTask": {"parentTempId", "parentId", "ownerId", "start", "due"},
}


@pytest.mark.parametrize("name", sorted(MINUTES_SHAPES))
def test_minutes_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 minutes.md 와 같아야 한다."""
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == MINUTES_SHAPES[name], f"domain.ts 의 {name} 이 minutes.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == MINUTES_NULLABLE.get(name, set())


async def test_minutes_responses_match_contract(client: AsyncClient) -> None:
    rows = (await client.get("/api/projects/p1/minutes")).json()
    assert rows, "MinutesItem 을 볼 수 있는 줄이 시드에 없다"
    for row in rows:
        assert set(row) == MINUTES_SHAPES["MinutesItem"]
    one = (await client.get(f"/api/minutes/{rows[0]['id']}")).json()
    assert set(one) == MINUTES_SHAPES["Minutes"]
    for field, value in one.items():
        if value is None:
            assert field in MINUTES_NULLABLE["Minutes"], f"Minutes.{field} 가 null"


# 선행 작업 · 작업 상태 기록 — docs/api/task-flow.md. 어긋나면 계약 쪽이 기준이다.
# null 이 나가는 자리가 없다(statusChangedAt 은 backfill 이 있어 늘 있다)
TASK_FLOW_SHAPES: dict[str, set[str]] = {
    "TaskDependency": {"taskId", "dependsOnId"},
    "DependencySuggestions": {"suggestions", "truncated"},
    "DependencySuggestion": {"taskId", "dependsOnId", "reason"},
}


@pytest.mark.parametrize("name", sorted(TASK_FLOW_SHAPES))
def test_task_flow_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    declared = FIELDS[name]
    assert set(declared) == TASK_FLOW_SHAPES[name], f"domain.ts 의 {name} 이 task-flow.md 와 다르다"
    assert not any(declared.values()), f"domain.ts 의 {name} 에 null 자리가 있다"


def test_task_status_since_in_domain_ts() -> None:
    """둘 다 null 이 아니다 — 모든 작업에 상태 기록이 적어도 한 줄 있다."""
    assert FIELDS["Task"].get("statusChangedAt") is False
    assert FIELDS["Task"].get("statusSinceBackfill") is False
    assert FIELDS["ProjectSnapshot"].get("taskDependencies") is False


def test_task_status_since_in_snapshot(snapshot: dict[str, Any]) -> None:
    for task in snapshot["tasks"]:
        assert isinstance(task["statusChangedAt"], str) and task["statusChangedAt"].endswith("Z")
        assert isinstance(task["statusSinceBackfill"], bool)


# 프로젝트 진행 리포트 — docs/api/report.md 'ProgressFacts' · '모양'. 집계를 서버가 하는 예외라
# 계산된 타입이 응답으로 나간다. 화면 에이전트가 domain.ts 에 더하는 중이라 아직 없을 수 있다.
# 어긋나면 계약 쪽이 기준이다. `ReportEvent` 는 union 이라 여기서 못 읽는다 — test_report 가 본다
_REPORT_ITEM = {
    "id",
    "projectId",
    "periodStart",
    "periodEnd",
    "createdBy",
    "createdAt",
    "doneRate",
    "attentionCount",
}
REPORT_SHAPES: dict[str, set[str]] = {
    "ProgressFacts": {
        "periodStart",
        "periodEnd",
        "settings",
        "progress",
        "previous",
        "decisions",
        "attention",
        "people",
    },
    "TaskAttention": {
        "taskId",
        "signals",
        "statusDays",
        "statusSinceBackfill",
        "plannedDays",
        "waitingOnTaskIds",
        "blockingTaskIds",
        "weight",
        "score",
    },
    "PersonProgress": {
        "memberId",
        "doing",
        "blocked",
        "overdue",
        "completed",
        "attentionTaskIds",
    },
    "ReportItem": _REPORT_ITEM,
    "Report": _REPORT_ITEM | {"facts", "body"},
}
REPORT_NULLABLE: dict[str, set[str]] = {
    "ProgressFacts": {"previous"},
    "TaskAttention": {"plannedDays"},
    "PersonProgress": {"memberId"},
}
# 한 줄 안의 객체 — domain.ts 의 인라인 타입이라 위 파서가 못 읽는다. 키는 계약 그대로
REPORT_INLINE: dict[str, set[str]] = {
    "progress": {
        "todo",
        "doing",
        "blocked",
        "done",
        "doneRate",
        "completedTaskIds",
        "startedTaskIds",
        "createdTaskIds",
    },
    "previous": {"reportId", "periodEnd", "doneRate", "blocked"},
    "decisions": {"decidedThreadIds", "deferredThreadIds", "riskyThreadIds"},
    "weight": {"openChildren", "openLines", "totalLines", "threadCount", "priority"},
}


@pytest.mark.parametrize("name", sorted(REPORT_SHAPES))
def test_report_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 report.md 와 같아야 한다."""
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == REPORT_SHAPES[name], f"domain.ts 의 {name} 이 report.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == REPORT_NULLABLE.get(name, set())


async def test_report_responses_match_contract(client: AsyncClient) -> None:
    from tests.test_chat import FakeClient, Turn, parse_sse
    from tests.test_chat import use as use_fake

    use_fake(FakeClient(Turn(texts=["글"])))
    # 둘을 만들어 previous 가 찬 facts 도 본다
    for _ in range(2):
        events = parse_sse((await client.post("/api/projects/p1/reports")).text)
    item = events[-1][1]["report"]
    assert set(item) == REPORT_SHAPES["ReportItem"]
    rows = (await client.get("/api/projects/p1/reports")).json()
    assert all(set(row) == REPORT_SHAPES["ReportItem"] for row in rows)

    one = (await client.get(f"/api/reports/{item['id']}")).json()
    assert set(one) == REPORT_SHAPES["Report"]
    facts = one["facts"]
    assert set(facts) == REPORT_SHAPES["ProgressFacts"]
    assert set(facts["settings"]) == RISK_SHAPES["RiskSettings"]
    for key in ("progress", "previous", "decisions"):
        assert set(facts[key]) == REPORT_INLINE[key]
    assert facts["attention"] and facts["people"]
    for row in facts["attention"]:
        assert set(row) == REPORT_SHAPES["TaskAttention"]
        assert set(row["weight"]) == REPORT_INLINE["weight"]
    for row in facts["people"]:
        assert set(row) == REPORT_SHAPES["PersonProgress"]
    # null 은 계약이 허락한 자리에서만
    for name, rows in (("TaskAttention", facts["attention"]), ("PersonProgress", facts["people"])):
        for row in rows:
            for field, value in row.items():
                if value is None:
                    assert field in REPORT_NULLABLE[name], f"{name}.{field} 가 null"


# 테스트 — docs/api/test.md '모양' · '요청'(1단계). 집계(statusDays · signals · changedEntryIds)를
# 서버가 하는 예외라 계산된 값이 응답에 실린다. 어긋나면 계약 쪽이 기준이다.
# null 이 나가는 자리는 TestCase 의 여덟뿐이다. 레벨은 걷었다(2026-10-27 고침)
_TEST_EDITABLE = {
    "title",
    "parentId",
    "purpose",
    "precondition",
    "testData",
    "steps",
    "start",
    "due",
    "ownerId",
    "partId",
}
TEST_SHAPES: dict[str, set[str]] = {
    "TestStep": {"action", "expected"},
    "TestRef": {"kind", "id"},
    "TestCase": {
        "id",
        "projectId",
        "key",
        "title",
        "parentId",
        "purpose",
        "precondition",
        "testData",
        "steps",
        "refs",
        "status",
        "statusChangedAt",
        "statusChangedBy",
        "statusDays",
        "failedStep",
        "resultNote",
        "start",
        "due",
        "ownerId",
        "partId",
        "signals",
        "changedEntryIds",
        "createdBy",
        "createdAt",
    },
    "TestInput": _TEST_EDITABLE | {"refs"},
    "TestPatch": _TEST_EDITABLE,
    "TestStatusInput": {"status", "failedStep", "note"},
}
_TEST_EDITABLE_NULLABLE = {"parentId", "start", "due", "ownerId", "partId"}
TEST_NULLABLE: dict[str, set[str]] = {
    "TestCase": _TEST_EDITABLE_NULLABLE | {"statusChangedBy", "failedStep", "createdBy"},
    "TestInput": _TEST_EDITABLE_NULLABLE,
    "TestPatch": _TEST_EDITABLE_NULLABLE,
    "TestStatusInput": {"failedStep"},
}


@pytest.mark.parametrize("name", sorted(TEST_SHAPES))
def test_test_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 test.md 와 같아야 한다."""
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == TEST_SHAPES[name], f"domain.ts 의 {name} 이 test.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == TEST_NULLABLE.get(name, set())


async def test_test_responses_match_contract(client: AsyncClient) -> None:
    rows = (await client.get("/api/projects/p1/tests")).json()
    assert rows, "TestCase 를 볼 수 있는 줄이 시드에 없다"
    for row in rows:
        assert set(row) == TEST_SHAPES["TestCase"]
        for field, value in row.items():
            if value is None:
                assert field in TEST_NULLABLE["TestCase"], f"TestCase.{field} 가 null"
        assert all(set(step) == TEST_SHAPES["TestStep"] for step in row["steps"])
        assert all(set(ref) == TEST_SHAPES["TestRef"] for ref in row["refs"])
    # null 로 나가 보는 줄이 시드에 있다 — 담당 · 바꾼 사람 · 만든 사람은 시드가 다 채웠다
    nulls = {field for row in rows for field, value in row.items() if value is None}
    assert nulls == TEST_NULLABLE["TestCase"] - {"ownerId", "statusChangedBy", "createdBy"}
    one = (await client.get(f"/api/tests/{rows[0]['id']}")).json()
    assert one == rows[0]


# 변경 이력 — docs/api/history.md '모양'. 프론트가 domain.ts 에 더하는 중이라 아직 없을 수 있다.
# 어긋나면 계약 쪽이 기준이다. null 은 from · to · changedBy 에서만 나간다
HISTORY_SHAPES: dict[str, set[str]] = {
    "HistoryChange": {"field", "from", "to", "subject"},
    "HistoryEntry": {"id", "changedAt", "changedBy", "backfilled", "changes"},
}
HISTORY_NULLABLE: dict[str, set[str]] = {
    "HistoryChange": {"from", "to"},
    "HistoryEntry": {"changedBy"},
}


@pytest.mark.parametrize("name", sorted(HISTORY_SHAPES))
def test_history_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == HISTORY_SHAPES[name], f"domain.ts 의 {name} 이 history.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == HISTORY_NULLABLE[name]


async def test_history_responses_match_contract(client: AsyncClient) -> None:
    # 시드의 k1 은 담당이 없어 changedBy 가 null, HW-T7 은 from · to 에 null 과 숫자가 있다
    rows = [
        *(await client.get("/api/tasks/k1/history")).json(),
        *(await client.get("/api/tasks/k20/history")).json(),
        *(await client.get("/api/tests/tc7/history")).json(),
    ]
    nulls: dict[str, set[str]] = {"HistoryEntry": set(), "HistoryChange": set()}
    for row in rows:
        assert set(row) == HISTORY_SHAPES["HistoryEntry"]
        assert row["changedAt"].endswith("Z") and row["changes"]
        nulls["HistoryEntry"] |= {k for k, v in row.items() if v is None}
        for change in row["changes"]:
            assert set(change) == HISTORY_SHAPES["HistoryChange"]
            assert isinstance(change["subject"], str)
            nulls["HistoryChange"] |= {k for k, v in change.items() if v is None}
    assert nulls == HISTORY_NULLABLE

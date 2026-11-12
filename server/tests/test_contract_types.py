"""스냅샷이 `web/src/types/domain.ts` 와 한 필드씩 맞는지 본다.

계약의 값어치가 여기 있다 — 프론트가 타입을 고치거나 서버가 필드를 흘리면 여기서 깨진다.
**`domain.ts` 를 파일로 읽어서 대조하므로 필드 목록을 두 벌로 적어 두지 않는다** —
`tests/test_read_api.py` 의 상수 목록이 손으로 옮겨 적은 쪽이고, 여기는 원본을 본다.
"""

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, get_args

import pytest
from httpx import AsyncClient

from app.schemas.chat import ChatRef, ToolName

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
    ("Agenda", lambda body: body["agendas"]),
    ("Task", lambda body: body["tasks"]),
    ("TaskLine", lambda body: [line for task in body["tasks"] for line in task["body"]]),
    ("TaskAgendaLink", lambda body: body["taskAgendaLinks"]),
]


# 파트가 늘린 필드 — docs/api/part.md '모양'. 프론트가 domain.ts 에 더하는 중이라 아직 없을 수 있다.
# 어긋나면 계약 쪽이 기준이다. 둘 다 null 을 낸다(null = 프로젝트 공통)
PART_ADDED: dict[str, set[str]] = {"Task": {"partId"}, "Agenda": {"partId"}}
# 회의록이 늘린 출처 — docs/api/minutes.md '게시판'(2026-10-20 고침).
# 셋 다 null 을 낸다(손으로 만든 것)
MINUTES_ADDED: dict[str, set[str]] = {
    "Agenda": {"minutesId"},
    "Task": {"minutesId"},
}


# 프로젝트 관리가 늘린 필드 — docs/api/snapshot.md 'Project'. 프론트가 domain.ts 에 더하는 중이라
# 아직 없을 수 있다. status 말고는 null 을 낸다
PROJECT_ADDED: dict[str, set[str]] = {
    "Project": {"description", "startDate", "endDate", "status", "closedAt"}
}
PROJECT_NULLABLE: dict[str, set[str]] = {
    "Project": {"description", "startDate", "endDate", "closedAt"}
}


def _added(name: str) -> set[str]:
    return PART_ADDED.get(name, set()) | MINUTES_ADDED.get(name, set())


def expected_keys(name: str) -> set[str]:
    return set(FIELDS[name]) | _added(name) | PROJECT_ADDED.get(name, set())


def nullable_keys(name: str) -> set[str]:
    declared = {field for field, nullable in FIELDS[name].items() if nullable}
    return declared | _added(name) | PROJECT_NULLABLE.get(name, set())


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


def test_project_fields_do_not_drift_from_domain_ts() -> None:
    """domain.ts 에 이미 들어왔으면 null 허용 여부가 계약과 같아야 한다."""
    for field in PROJECT_ADDED["Project"]:
        if field in FIELDS["Project"]:
            expected = field in PROJECT_NULLABLE["Project"]
            assert FIELDS["Project"][field] == expected, (
                f"domain.ts 의 Project.{field} 가 계약과 다르다"
            )


# 인증 · 파트가 늘린 모양 — docs/api/auth.md '새 응답 · 요청 모양' · docs/api/part.md '모양'.
# 프론트가 domain.ts 에 더하는 중이라 아직 없는 필드가 있을 수 있다. 어긋나면 이 계약 쪽이 기준이다
AUTH_SHAPES: dict[str, set[str]] = {
    # avatarUrl — docs/api/me.md (2026-11-06)
    "Member": {"id", "name", "active", "avatarUrl"},
    "Me": {"id", "name", "email", "systemRole", "projectRoles", "avatarUrl"},
    "AvatarInput": {"dataUrl"},
    "MemberAccount": {
        "id",
        "no",
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
    # 파트 권한(2026-11-12) — domain.ts 는 PartRights 를 extends 해서 적는다
    "PartMember": {"partId", "memberId", "canView", "canCreate", "canUpdate", "canDelete"},
}


def contract_keys(name: str) -> set[str]:
    """서버 응답이 맞춰야 할 키. domain.ts 가 계약에 없는 필드를 들고 있으면 여기서 깨진다."""
    declared = set(all_fields(name))
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
    """AgendaRow · TaskDetail 같은 계산된 타입은 서버가 주지 않는다."""
    assert set(snapshot) == {
        "project",
        "agendas",
        "tasks",
        "taskAgendaLinks",
        "parts",
        "partMembers",
    }


# 결정 병목 리스크 — docs/api/risk.md '응답' · '기준 설정'. 집계를 서버가 하는 첫 예외라(Q35)
# 계산된 타입이 응답으로 나간다. 어긋나면 계약 쪽이 기준이다
RISK_SHAPES: dict[str, set[str]] = {
    # 미룸 문턱(deferCount)은 걷었다 — docs/api/agenda.md '따라 바뀌는 기능'.
    # 흔들림 셋은 2026-11-06 (risk-dashboard.md '기준')
    "RiskSettings": {
        "dueSoonDays",
        "staleDays",
        "highScore",
        "mediumScore",
        "churnDays",
        "churnCount",
        "slipCount",
    },
    # 작업 · 테스트 리스크(2026-11-06, risk-dashboard.md) — 11-05 에 걷은 '어긋난 작업' 과 다르다
    "DecisionRiskReport": {"asOf", "settings", "agendas", "tasks", "tests", "owners"},
    "AgendaRisk": {
        "agendaId",
        "title",
        "state",
        "ownerId",
        "partId",
        "dueDate",
        "overdueDays",
        "idleDays",
        "blockedTaskIds",
        "waitingTaskIds",
        "impactTaskCount",
        "nearestTaskDue",
        "signals",
        "score",
        "level",
    },
    "OwnerLoad": {
        "memberId",
        "openAgendas",
        "overdueAgendas",
        "blockedTasks",
        "blockingImpact",
        "riskyTasks",
        "riskyTests",
    },
    "TaskRisk": {
        "taskId",
        "key",
        "title",
        "status",
        "ownerId",
        "partId",
        "start",
        "due",
        "overdueDays",
        "statusDays",
        "plannedDays",
        "slipCount",
        "dueFlow",
        "contentChanges",
        "ownerChanges",
        "openAgendaIds",
        "signals",
        "score",
        "level",
    },
    "TestRisk": {
        "testId",
        "key",
        "title",
        "status",
        "ownerId",
        "partId",
        "due",
        "overdueDays",
        "statusDays",
        "slipCount",
        "flips",
        "refs",
        "signals",
        "score",
        "level",
    },
    "RiskSummaryInput": {"agendaIds", "taskIds", "testIds"},
}


@pytest.mark.parametrize("name", sorted(RISK_SHAPES))
def test_risk_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드가 계약과 같아야 한다."""
    if name in FIELDS:
        assert set(FIELDS[name]) == RISK_SHAPES[name], f"domain.ts 의 {name} 이 계약과 다르다"


def test_removed_task_risk_signals_stay_gone() -> None:
    """2026-11-05 에 걷은 '어긋난 작업' 신호는 되살리지 않는다 — TaskRisk 는 이름만 같다."""
    from app.schemas.risk import TaskRiskSignal

    for gone in ("decidedButBlocked", "blockedWithoutAgenda", "dueBeforeDecision"):
        assert gone not in get_args(TaskRiskSignal)


async def test_risk_report_matches_contract(client: AsyncClient) -> None:
    body = (await client.get("/api/projects/p1/risks")).json()
    assert set(body) == RISK_SHAPES["DecisionRiskReport"]
    assert set(body["settings"]) == RISK_SHAPES["RiskSettings"]
    for key, name in (
        ("agendas", "AgendaRisk"),
        ("tasks", "TaskRisk"),
        ("tests", "TestRisk"),
        ("owners", "OwnerLoad"),
    ):
        assert body[key], f"{name} 을 볼 수 있는 줄이 시드에 없다"
        for row in body[key]:
            assert set(row) == RISK_SHAPES[name]
            # null 은 domain.ts 가 허락한 자리에서만
            for field, value in row.items():
                if value is None and name in FIELDS:
                    assert FIELDS[name][field], f"{name}.{field} 가 null 로 나갔다"


# 확인 요청 — docs/api/check.md '모양'(2026-11-04 고침 — 결정 판). 어긋나면 계약 쪽이 기준이다.
# null 이 나갈 수 있는 자리는 `CheckRequest.confirmedAt` 하나다
CHECK_SHAPES: dict[str, set[str]] = {
    "CheckRequest": {
        "id",
        "projectId",
        "agendaId",
        "decisionRev",
        "decision",
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


def test_removed_agenda_types_are_gone_from_domain_ts() -> None:
    """안건 간소화(docs/api/agenda.md) — 걷은 타입 · 칸이 남으면 화면이 옛 모양을 기다린다."""
    for name in ("Entry", "DecisionItem", "EntryInput", "EntryPatch", "Thread"):
        assert name not in FIELDS, f"domain.ts 에 걷은 {name} 이 남았다"
    assert not {"options", "parentAgendaId"} & set(FIELDS["Agenda"])
    assert not {"entries", "decisionItems"} & set(FIELDS["ProjectSnapshot"])


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
_MINUTES_ITEM = {"id", "projectId", "title", "meetingDate", "authorId", "createdAt", "updatedAt"}
MINUTES_SHAPES: dict[str, set[str]] = {
    "MinutesItem": _MINUTES_ITEM,
    "Minutes": _MINUTES_ITEM | {"body", "summary"},
    "MinutesInput": {"title", "meetingDate", "body"},
    "MinutesDraft": {"meetingDate", "summary", "agendas", "updates", "tasks"},
    "ProposedAgenda": {
        "tempId",
        "title",
        "description",
        "decision",
        "state",
        "ownerId",
        "ownerHint",
        "dueDate",
        "partId",
        "quote",
    },
    # 기존 안건의 결정내용 · 상태 갈아끼우기 — quote 는 초안에 늘 싣고 등록에서는 버린다
    "ProposedUpdate": {"agendaId", "decision", "state", "quote"},
    "ProposedMinutesTask": _PROPOSED_TASK | {"ownerHint", "agendaTempIds", "agendaIds", "quote"},
    "MinutesApplyInput": {"summary", "agendas", "updates", "tasks"},
    "MinutesApplyResult": {
        "agendas",
        "updatedAgendas",
        "tasks",
        "links",
        "agendaIdByTempId",
        "taskIdByTempId",
    },
}
MINUTES_NULLABLE: dict[str, set[str]] = {
    "MinutesItem": {"meetingDate"},
    "Minutes": {"meetingDate"},
    "MinutesInput": {"meetingDate"},
    "MinutesDraft": {"meetingDate"},
    "ProposedAgenda": {"ownerId", "dueDate", "partId"},
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


# 작업 상태 기록 — docs/api/task-flow.md.
# 선행 작업은 걷었다(Q63) — 그 타입 · 스냅샷 칸이 남으면 깨진다
def test_dependency_types_are_gone_from_domain_ts() -> None:
    for name in ("TaskDependency", "DependencySuggestions", "DependencySuggestion"):
        assert name not in FIELDS, f"domain.ts 에 걷은 {name} 이 남았다"
    assert "taskDependencies" not in FIELDS["ProjectSnapshot"]


def test_task_status_since_in_domain_ts() -> None:
    """둘 다 null 이 아니다 — 모든 작업에 상태 기록이 적어도 한 줄 있다."""
    assert FIELDS["Task"].get("statusChangedAt") is False
    assert FIELDS["Task"].get("statusSinceBackfill") is False


def test_task_status_since_in_snapshot(snapshot: dict[str, Any]) -> None:
    for task in snapshot["tasks"]:
        assert isinstance(task["statusChangedAt"], str) and task["statusChangedAt"].endswith("Z")
        assert isinstance(task["statusSinceBackfill"], bool)


# 테스트 — docs/api/test.md '모양' · '요청'(1단계). 집계(statusDays · signals · changedAgendaIds)를
# 서버가 하는 예외라 계산된 값이 응답에 실린다. 어긋나면 계약 쪽이 기준이다.
# null 이 나가는 자리는 TestCase 의 일곱뿐이다. 레벨은 걷었다(2026-10-27 고침).
# 목적 · 사전조건 · 단계 · 실패한 단계는 테스트 내용(`content`)으로 합쳤다(Q60)
_TEST_EDITABLE = {
    "title",
    "parentId",
    "content",
    "testData",
    "start",
    "due",
    "ownerId",
    # 참조 (docs/api/cc.md)
    "ccIds",
    "partId",
}
TEST_SHAPES: dict[str, set[str]] = {
    "TestRef": {"kind", "id"},
    "TestCase": {
        "id",
        "projectId",
        "key",
        "title",
        "parentId",
        "content",
        "testData",
        "refs",
        "status",
        "statusChangedAt",
        "statusChangedBy",
        "statusDays",
        "resultNote",
        "start",
        "due",
        "ownerId",
        "ccIds",
        "partId",
        "signals",
        "changedAgendaIds",
        "createdBy",
        "createdAt",
        # 조치 내역 수 (docs/api/test-comment.md)
        "commentCount",
    },
    "TestInput": _TEST_EDITABLE | {"refs"},
    "TestPatch": _TEST_EDITABLE,
    "TestStatusInput": {"status", "note"},
    "TestComment": {"id", "testId", "authorId", "body", "createdAt", "editedAt"},
}
_TEST_EDITABLE_NULLABLE = {"parentId", "start", "due", "ownerId", "partId"}
TEST_NULLABLE: dict[str, set[str]] = {
    "TestCase": _TEST_EDITABLE_NULLABLE | {"statusChangedBy", "createdBy"},
    "TestInput": _TEST_EDITABLE_NULLABLE,
    "TestPatch": _TEST_EDITABLE_NULLABLE,
    "TestComment": {"authorId", "editedAt"},
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
    # 시드의 k2 는 등록한 사람 기록이 없어 changedBy 가 null,
    # HW-T7 은 from · to 에 null 과 숫자가 있다
    rows = [
        *(await client.get("/api/tasks/k2/history")).json(),
        *(await client.get("/api/tasks/k20/history")).json(),
        *(await client.get("/api/tests/tc7/history")).json(),
        # 안건 — 담당이 없던 t4 는 등록한 사람도 null
        *(await client.get("/api/agendas/t4/history")).json(),
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


def _quoted(text: str) -> set[str]:
    return set(re.findall(r"'(\w+)'", text))


def test_chat_ref_kinds_match_domain_ts() -> None:
    """근거 표시의 종류 — 서버가 내는 것과 화면이 그리는 것이 같아야 한다(chat.md '테스트 언급')."""
    source = DOMAIN_TS.read_text(encoding="utf-8")
    declared = re.search(r"export interface ChatRef \{\n  kind: ([^\n]+)\n", source)
    assert declared is not None
    assert _quoted(declared.group(1)) == set(get_args(ChatRef.model_fields["kind"].annotation))


def test_chat_tool_names_match_domain_ts() -> None:
    source = DOMAIN_TS.read_text(encoding="utf-8")
    declared = re.search(r"type: 'tool'\n      name:\n((?:        \| '\w+'\n)+)", source)
    assert declared is not None
    assert _quoted(declared.group(1)) == set(get_args(ToolName))


# AI 영향도 분석 — docs/api/impact.md. 고친 안 칸(title · body · content · testData)은 선택이고
# 응답에서 키째 빠진다 — 그래서 null 자리에 들지 않는다
IMPACT_SHAPES: dict[str, set[str]] = {
    "ImpactBodyLine": {"kind", "text", "done", "level"},
    "ImpactTask": {
        "taskId",
        "verdict",
        "reason",
        "title",
        "body",
        "before",
        "appliedAt",
        "linked",
        "linkedOnApply",
    },
    "ImpactTest": {
        "testId",
        "verdict",
        "reason",
        "title",
        "content",
        "testData",
        "before",
        "appliedAt",
        "linked",
        "linkedOnApply",
    },
    "ImpactConflict": {"agendaId", "verdict", "reason", "decision"},
    "AgendaImpact": {
        "id",
        "projectId",
        "agendaId",
        "decisionRev",
        "decisionBefore",
        "decisionAfter",
        "summary",
        "tasks",
        "tests",
        "conflicts",
        "createdBy",
        "createdAt",
    },
    "AgendaImpactState": {"latest", "taskCount", "testCount", "decidedAgendaCount"},
    "ImpactApplyInput": {"tasks", "tests"},
    "ImpactApplyResult": {"tasks", "tests", "links", "impact"},
}
IMPACT_NULLABLE: dict[str, set[str]] = {
    "ImpactTask": {"appliedAt"},
    "ImpactTest": {"appliedAt"},
    "AgendaImpact": {"decisionBefore", "createdBy"},
    "AgendaImpactState": {"latest"},
}


@pytest.mark.parametrize("name", sorted(IMPACT_SHAPES))
def test_impact_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 impact.md 와 같아야 한다."""
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == IMPACT_SHAPES[name], f"domain.ts 의 {name} 이 impact.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == IMPACT_NULLABLE.get(name, set())


async def test_impact_state_matches_contract(client: AsyncClient) -> None:
    body = (await client.get("/api/agendas/t2/impact")).json()
    assert set(body) == IMPACT_SHAPES["AgendaImpactState"]


# 문서 — docs/api/document.md '모양'. null 이 나가는 자리는 partId · createdBy · updatedBy 셋뿐이다
_DOC_SUMMARY = {
    "id",
    "projectId",
    "title",
    "kind",
    "partId",
    "agendas",
    "changedAgendaIds",
    "rev",
    "createdBy",
    "createdAt",
    "updatedBy",
    "updatedAt",
}
DOC_SHAPES: dict[str, set[str]] = {
    "SheetBook": {"sheets"},
    "SheetTab": {"name", "columns", "data", "merges", "styles"},
    "DocAgendaLink": {"agendaId", "seenRev"},
    "ProjectDocSummary": _DOC_SUMMARY,
    "ProjectDoc": _DOC_SUMMARY | {"content", "sheet"},
}
DOC_NULLABLE: dict[str, set[str]] = {
    "ProjectDocSummary": {"partId", "createdBy", "updatedBy"},
    "ProjectDoc": {"partId", "createdBy", "updatedBy"},
}


@pytest.mark.parametrize("name", sorted(DOC_SHAPES))
def test_document_shapes_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드 · null 자리가 document.md 와 같아야 한다."""
    if name not in FIELDS:
        return
    declared = all_fields(name)
    assert set(declared) == DOC_SHAPES[name], f"domain.ts 의 {name} 이 document.md 와 다르다"
    nullable = {field for field, allowed in declared.items() if allowed}
    assert nullable == DOC_NULLABLE.get(name, set())


async def test_document_responses_match_contract(client: AsyncClient) -> None:
    created = await client.post(
        "/api/projects/p1/documents", json={"title": "서버", "kind": "text", "agendaIds": ["t1"]}
    )
    doc = created.json()
    assert set(doc) == DOC_SHAPES["ProjectDoc"]
    assert set(doc["sheet"]) == DOC_SHAPES["SheetBook"]
    assert set(doc["agendas"][0]) == DOC_SHAPES["DocAgendaLink"]
    assert {k for k, v in doc.items() if v is None} == {"partId"}
    rows = (await client.get("/api/projects/p1/documents")).json()
    assert set(rows[0]) == DOC_SHAPES["ProjectDocSummary"]
    sheet = (
        await client.post("/api/projects/p1/documents", json={"title": "표", "kind": "sheet"})
    ).json()["sheet"]
    assert set(sheet) == DOC_SHAPES["SheetBook"]
    assert set(sheet["sheets"][0]) == DOC_SHAPES["SheetTab"]
    assert set(sheet["sheets"][0]["columns"][0]) == {"width"}

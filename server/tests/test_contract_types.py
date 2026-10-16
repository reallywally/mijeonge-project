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

_INTERFACE = re.compile(r"^export interface (\w+) \{$")
_FIELD = re.compile(r"^  (\w+)\??: (.+?)$")


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
            continue
        if name is None:
            continue
        field = _FIELD.match(line)
        if field:
            found[name][field.group(1)] = "null" in field.group(2)
    return found


FIELDS = _declared_fields()

Pick = Callable[[dict[str, Any]], list[dict[str, Any]]]

# 스냅샷의 어느 자리가 domain.ts 의 어느 타입인가
CASES: list[tuple[str, Pick]] = [
    ("Project", lambda body: [body["project"]]),
    ("Thread", lambda body: body["threads"]),
    ("Entry", lambda body: body["entries"]),
    ("Task", lambda body: body["tasks"]),
    ("TaskLine", lambda body: [line for task in body["tasks"] for line in task["body"]]),
    ("TaskThreadLink", lambda body: body["taskThreadLinks"]),
]


# 파트가 늘린 필드 — docs/api/part.md '모양'. 프론트가 domain.ts 에 더하는 중이라 아직 없을 수 있다.
# 어긋나면 계약 쪽이 기준이다. 둘 다 null 을 낸다(null = 프로젝트 공통)
PART_ADDED: dict[str, set[str]] = {"Task": {"partId"}, "Thread": {"partId"}}


def expected_keys(name: str) -> set[str]:
    return set(FIELDS[name]) | PART_ADDED.get(name, set())


def nullable_keys(name: str) -> set[str]:
    return {field for field, nullable in FIELDS[name].items() if nullable} | PART_ADDED.get(
        name, set()
    )


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


@pytest.mark.parametrize("name", sorted(PART_ADDED))
def test_part_fields_do_not_drift_from_domain_ts(name: str) -> None:
    """domain.ts 에 이미 들어왔으면 계약대로 `string | null` 이어야 한다."""
    for field in PART_ADDED[name]:
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


# 확인 요청 — docs/api/check.md '모양'. 어긋나면 계약 쪽이 기준이다.
# null 이 나갈 수 있는 자리는 `CheckRequest.confirmedAt` 하나다
CHECK_SHAPES: dict[str, set[str]] = {
    "CheckRequest": {
        "id",
        "projectId",
        "targetType",
        "targetId",
        "senderId",
        "recipientId",
        "text",
        "createdAt",
        "confirmedAt",
    },
    "CheckRequestInput": {"targetType", "targetId", "recipientIds", "text"},
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

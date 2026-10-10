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
    expected = set(FIELDS[name])
    for row in rows:
        assert set(row) == expected, f"{name} 의 키가 domain.ts 와 다르다"


@pytest.mark.parametrize(("name", "pick"), CASES, ids=[name for name, _ in CASES])
def test_null_only_where_domain_ts_allows(name: str, pick: Pick, snapshot: dict[str, Any]) -> None:
    """빈 값은 '' · [] 다 — null 은 domain.ts 가 허락한 자리에서만 나간다 (API.md Q17)."""
    nullable = FIELDS[name]
    for row in pick(snapshot):
        for field, value in row.items():
            if value is None:
                assert nullable[field], f"{name}.{field} 가 null 로 나갔다"


def test_member_matches_domain_ts() -> None:
    assert set(FIELDS["Member"]) == {"id", "name"}


async def test_snapshot_has_no_computed_types(snapshot: dict[str, Any]) -> None:
    """ThreadRow · TaskDetail 같은 계산된 타입은 서버가 주지 않는다."""
    assert set(snapshot) == {
        "project",
        "threads",
        "entries",
        "tasks",
        "taskThreadLinks",
    }

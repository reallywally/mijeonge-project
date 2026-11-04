"""읽기 API — 응답이 `web/src/types/domain.ts` 와 한 필드씩 맞는지 본다.

끝난 것으로 보는 기준은 "스냅샷을 그대로 `stores/data.ts` 의 초기값에 넣으면 화면이
목업과 똑같이 돈다"이다. 그래서 이름 · null 허용 · 날짜 형식뿐 아니라 **배열 순서**까지 본다.
"""

import httpx

# domain.ts 가 들고 있는 필드 그대로. 하나라도 어긋나면 화면이 조용히 빈칸을 그린다
PROJECT_KEYS = {
    "id",
    "name",
    "taskKeyPrefix",
    # 프로젝트 관리 — docs/api/snapshot.md 'Project'
    "description",
    "startDate",
    "endDate",
    "status",
    "closedAt",
}
# docs/api/agenda.md '모양' 그대로 (2026-11-04)
AGENDA_KEYS = {
    "id",
    "projectId",
    "title",
    "description",
    "decision",
    "state",
    "ownerId",
    # 등록한 사람 — 기록이 없던 지난 안건은 null
    "creatorId",
    "dueDate",
    "partId",
    "createdAt",
    "decidedAt",
    "decisionRev",
    "minutesId",
}
TASK_KEYS = {
    "id",
    "projectId",
    "key",
    "title",
    "parentId",
    "body",
    "status",
    "ownerId",
    # 등록한 사람 — 기록이 없던 지난 작업은 null
    "creatorId",
    # 같은 상위 안에서의 순서 (2026-11-03)
    "order",
    "start",
    "due",
    "priority",
    "createdAt",
    "commentCount",
    "partId",
    "minutesId",
    # 지금 상태가 된 시각 (docs/api/task-flow.md)
    "statusChangedAt",
    "statusSinceBackfill",
}


async def test_projects(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects")
    assert res.status_code == 200
    rows = res.json()
    assert [(p["id"], p["name"], p["taskKeyPrefix"]) for p in rows] == [
        ("p1", "한화손보 차세대", "HW"),
        ("p2", "삼성생명 PAS", "PAS"),
        ("p3", "경영지원 파트", "MG"),
    ]
    assert all(set(p) == PROJECT_KEYS for p in rows)
    assert all(p["status"] == "active" and p["closedAt"] is None for p in rows)


async def test_members(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/members")
    # 시드의 시스템 관리자도 멤버다 — 프로젝트에 부여되지 않았을 뿐이다
    assert [m["name"] for m in res.json()] == ["관리자", "김서연", "박지훈", "이도현", "정하늘"]
    assert all(m["active"] is True for m in res.json())


async def test_snapshot_fields_match_domain_ts(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert set(snap) == {
        # 고른 프로젝트 자신 — 딥링크로 바로 들어와도 헤더가 선다 (API.md Q7)
        "project",
        "agendas",
        "tasks",
        "taskAgendaLinks",
        # 파트 — 보관 포함 전부. 거르는 것은 화면이다 (docs/api/part.md)
        "parts",
        "partMembers",
    }
    assert set(snap["project"]) == PROJECT_KEYS
    assert set(snap["agendas"][0]) == AGENDA_KEYS
    assert set(snap["tasks"][0]) == TASK_KEYS
    assert set(snap["tasks"][3]["body"][0]) == {"id", "kind", "text", "done", "level"}
    assert set(snap["taskAgendaLinks"][0]) == {"taskId", "agendaId"}


async def test_snapshot_only_holds_one_project(client: httpx.AsyncClient) -> None:
    """프로젝트를 바꾸면 화면이 갈려야 한다 — 다른 프로젝트 것이 섞이면 안 된다."""
    p1 = (await client.get("/api/projects/p1/snapshot")).json()
    p2 = (await client.get("/api/projects/p2/snapshot")).json()

    assert [t["key"] for t in p2["tasks"]] == ["PAS-1", "PAS-2"]
    assert [t["id"] for t in p2["agendas"]] == ["t10"]
    assert all(t["projectId"] == "p1" for t in p1["tasks"])
    assert len(p1["tasks"]) == 22


async def test_arrays_come_in_registration_order(client: httpx.AsyncClient) -> None:
    """**배열 순서가 곧 화면 순서다.**

    `stores/agenda.ts` 의 `rows` 와 작업 목록에는 정렬이 아예 없다. 그래서 등록 순서(`seq`)로
    내보낸다 — `created_at` 으로 세우면 안 된다. 픽스처의 t5(09-07)처럼 적은 순서와 시각 순서가 다른
    안건도 있다 — t1 ~ t4(09-08 ~ 09-10) 뒤에 선다.
    """
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert [t["id"] for t in snap["agendas"]] == [f"t{n}" for n in range(1, 10)]
    assert [t["key"] for t in snap["tasks"]] == [f"HW-{n}" for n in range(1, 23)]


async def test_created_at_is_utc_and_dates_are_days(client: httpx.AsyncClient) -> None:
    """`createdAt` 은 ISO 8601 UTC(`…Z`), 사람이 고른 날짜는 `YYYY-MM-DD` 다 (API.md Q3 · Q23).

    시드가 픽스처의 값을 그대로 넣으므로 목업과 한 글자씩 같다.
    """
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    agenda = next(t for t in snap["agendas"] if t["id"] == "t1")
    assert agenda["createdAt"] == "2026-09-08T00:30:00Z"  # fixtures/agendas.ts 의 t1
    assert agenda["decidedAt"] == "2026-09-09T02:00:00Z"
    assert agenda["dueDate"] == "2026-09-12"


async def test_seed_decisions_follow_the_migration_rule(client: httpx.AsyncClient) -> None:
    """결정내용 · 상태 · 결정 시각 · 판 — 이행 규칙(0032)으로 지난 시드에서 만든 값 그대로."""
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    got = {
        t["id"]: (t["decision"], t["state"], t["decidedAt"], t["decisionRev"])
        for t in snap["agendas"]
    }
    assert got["t1"] == ("우분투 최신 버전으로 한다", "decided", "2026-09-09T02:00:00Z", 1)
    assert got["t2"] == (
        "mysql 을 쓴다\n"
        "- postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다\n"
        "- supabase 는 비용 때문에 뺀다",
        "decided",
        "2026-09-10T06:05:00Z",
        1,
    )
    assert got["t3"] == ("", "open", None, 0)
    assert got["t5"] == (
        "요청(in) 항목: 계약번호 · 상품코드 · 가입일 셋을 넘긴다",
        "open",
        None,
        1,
    )
    assert got["t6"] == (
        "테스트 기간: 전체 일정은 그대로 두고 테스트 기간만 2주 줄인다\n"
        "- 늘어난 개발 기간은 그대로 둔다\n"
        "- 통합 테스트를 3주에서 1주로 줄인다\n"
        "\n"
        "전체 일정: 전체 일정은 미루지 않는다",
        "decided",
        "2026-09-15T07:00:00Z",
        1,
    )
    for agenda_id in ("t4", "t7", "t8", "t9"):
        assert got[agenda_id] == ("", "queued", None, 0)


async def test_task_body_keeps_its_order(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    env = next(t for t in snap["tasks"] if t["key"] == "HW-4")
    assert [line["text"] for line in env["body"]][:3] == [
        "서버 신청서 제출",
        "우분투 최신 버전 설치",
        "mysql 설치와 계정 발급",
    ]
    assert [line["done"] for line in env["body"]][:3] == [True, True, False]

    blocked = next(t for t in snap["tasks"] if t["key"] == "HW-18")
    assert blocked["start"] is None and blocked["due"] is None  # 기간 미정
    assert blocked["status"] == "blocked"


async def test_task_agenda_links(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": "k4", "agendaId": "t1"} in snap["taskAgendaLinks"]
    assert len(snap["taskAgendaLinks"]) == 6


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/없는프로젝트/snapshot")
    assert res.status_code == 404

"""읽기 API — 응답이 `web/src/types/domain.ts` 와 한 필드씩 맞는지 본다.

끝난 것으로 보는 기준은 "스냅샷을 그대로 `stores/data.ts` 의 초기값에 넣으면 화면이
목업과 똑같이 돈다"이다. 그래서 이름 · null 허용 · 날짜 형식뿐 아니라 **배열 순서**까지 본다.
"""

import httpx

# domain.ts 가 들고 있는 필드 그대로. 하나라도 어긋나면 화면이 조용히 빈칸을 그린다
THREAD_KEYS = {
    "id",
    "projectId",
    "title",
    "description",
    "options",
    "dueDate",
    "state",
    "ownerId",
    "parentThreadId",
    "createdAt",
}
ENTRY_KEYS = {
    "id",
    "threadId",
    "kind",
    "text",
    "detail",
    "note",
    "ownerId",
    "createdAt",
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
    "start",
    "due",
    "priority",
    "createdAt",
}


async def test_projects(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects")
    assert res.status_code == 200
    assert res.json() == [
        {"id": "p1", "name": "한화손보 차세대", "taskKeyPrefix": "HW"},
        {"id": "p2", "name": "삼성생명 PAS", "taskKeyPrefix": "PAS"},
        {"id": "p3", "name": "경영지원 파트", "taskKeyPrefix": "MG"},
    ]


async def test_members(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/members")
    assert [m["name"] for m in res.json()] == ["김서연", "박지훈", "이도현", "정하늘"]


async def test_snapshot_fields_match_domain_ts(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert set(snap) == {
        # 고른 프로젝트 자신 — 딥링크로 바로 들어와도 헤더가 선다 (API.md Q7)
        "project",
        "threads",
        "entries",
        "tasks",
        "taskThreadLinks",
    }
    assert set(snap["project"]) == {"id", "name", "taskKeyPrefix"}
    assert set(snap["threads"][0]) == THREAD_KEYS
    assert set(snap["entries"][0]) == ENTRY_KEYS
    assert set(snap["tasks"][0]) == TASK_KEYS
    assert set(snap["tasks"][3]["body"][0]) == {"id", "kind", "text", "done", "level"}
    assert set(snap["taskThreadLinks"][0]) == {"taskId", "threadId"}


async def test_snapshot_only_holds_one_project(client: httpx.AsyncClient) -> None:
    """프로젝트를 바꾸면 화면이 갈려야 한다 — 다른 프로젝트 것이 섞이면 안 된다."""
    p1 = (await client.get("/api/projects/p1/snapshot")).json()
    p2 = (await client.get("/api/projects/p2/snapshot")).json()

    assert [t["key"] for t in p2["tasks"]] == ["PAS-1", "PAS-2"]
    assert [t["id"] for t in p2["threads"]] == ["t10"]
    assert all(t["projectId"] == "p1" for t in p1["tasks"])
    assert len(p1["tasks"]) == 21


async def test_arrays_come_in_registration_order(client: httpx.AsyncClient) -> None:
    """**배열 순서가 곧 화면 순서다.**

    `stores/thread.ts` 의 `rows` 와 작업 목록에는 정렬이 아예 없다. 게다가 안건 이력은
    같은 날짜의 줄을 배열 인덱스(seqNo)로 가른다. 그래서 등록 순서(`seq`)로 내보낸다 —
    `created_at` 으로 세우면 안 된다. 픽스처의 e1(09-09)과 e2(09-07)처럼 적은 순서와
    시각 순서가 다른 줄도 있다.
    """
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert [t["id"] for t in snap["threads"]] == [f"t{n}" for n in range(1, 10)]
    assert [e["id"] for e in snap["entries"]] == [f"e{n}" for n in range(1, 7)]
    assert [t["key"] for t in snap["tasks"]] == [f"HW-{n}" for n in range(1, 22)]


async def test_created_at_is_utc_and_dates_are_days(client: httpx.AsyncClient) -> None:
    """`createdAt` 은 ISO 8601 UTC(`…Z`), 사람이 고른 날짜는 `YYYY-MM-DD` 다 (API.md Q3 · Q23).

    시드가 픽스처의 값을 그대로 넣으므로 목업과 한 글자씩 같다.
    """
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    thread = next(t for t in snap["threads"] if t["id"] == "t1")
    assert thread["createdAt"] == "2026-09-08T00:30:00Z"  # fixtures/threads.ts 의 t1
    entry = next(e for e in snap["entries"] if e["id"] == "e3")
    assert entry["createdAt"] == "2026-09-10T06:05:00Z"


async def test_entry_detail_is_flattened_to_strings(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    decide = next(e for e in snap["entries"] if e["id"] == "e3")
    assert decide["detail"] == [
        "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다",
        "supabase 는 비용 때문에 뺀다",
    ]
    outside = next(e for e in snap["entries"] if e["id"] == "e1")
    assert outside["detail"] == []


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


async def test_task_thread_links(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"taskId": "k4", "threadId": "t1"} in snap["taskThreadLinks"]
    assert len(snap["taskThreadLinks"]) == 5


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/없는프로젝트/snapshot")
    assert res.status_code == 404

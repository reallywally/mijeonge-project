"""검색 — `GET /api/projects/{projectId}/search` 와 챗봇 도구가 될 함수 넷.

글자 조각 검색(`pg_trgm`)은 Postgres 에만 있다. 그래서 둘로 나뉜다 (API.md Q27).
- `client` · `session`(메모리 sqlite) — trigram 을 안 타는 것:
  404 · 422 · get_thread · get_task · 발췌
- `pg_client` · `pg_session` — 실제로 찾는 것. 로컬 Postgres 가 없으면 건너뛴다
"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.services import search as search_service
from scripts.seed import seed

THREAD_HIT_KEYS = {"id", "title", "state", "matched", "snippet", "decision"}
TASK_HIT_KEYS = {"id", "key", "title", "status", "matched", "snippet"}


# --- DB 없이 도는 것 -------------------------------------------------------


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/없는프로젝트/search", params={"q": "OS"})
    assert res.status_code == 404
    assert res.json()["code"] == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize("q", ["", "   ", "\t"])
async def test_blank_query_is_422(client: httpx.AsyncClient, q: str) -> None:
    res = await client.get("/api/projects/p1/search", params={"q": q})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["detail"] == {"q": "검색어를 입력해 주세요."}


async def test_missing_query_is_422(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/p1/search")
    assert res.status_code == 422
    assert "q" in res.json()["detail"]


@pytest.mark.parametrize("limit", [0, 51])
async def test_limit_out_of_range_is_422(client: httpx.AsyncClient, limit: int) -> None:
    res = await client.get("/api/projects/p1/search", params={"q": "OS", "limit": limit})
    assert res.status_code == 422
    assert "limit" in res.json()["detail"]


async def test_too_long_query_is_422(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/projects/p1/search", params={"q": "가" * 201})
    assert res.status_code == 422
    assert res.json()["detail"] == {"q": "너무 깁니다."}


async def test_get_thread_reads_options_history_and_tasks(session: AsyncSession) -> None:
    await seed(session)
    doc = await search_service.get_thread(session, "p1", "t1")

    assert doc.thread.title == "서버 OS 결정"
    assert doc.thread.options == ["우분투", "록키", "CentOS"]
    assert [entry.id for entry in doc.entries] == ["e1"]
    assert [(task.key, task.title) for task in doc.tasks] == [("HW-4", "개발 환경 설정")]


async def test_get_thread_history_follows_seq(session: AsyncSession) -> None:
    """두 번 미룬 안건 — 이력은 등록 순서(seq)대로다 (API.md Q15)."""
    await seed(session)
    doc = await search_service.get_thread(session, "p1", "t5")
    assert [entry.id for entry in doc.entries] == ["e2", "e5"]
    assert [entry.kind for entry in doc.entries] == ["defer", "defer"]


async def test_get_thread_out_of_project_is_not_found(session: AsyncSession) -> None:
    """도구가 다른 프로젝트 id 를 넣어도 못 읽는다 — t1 은 p1 의 안건이다."""
    await seed(session)
    with pytest.raises(ApiError) as caught:
        await search_service.get_thread(session, "p2", "t1")
    assert caught.value.code == "THREAD_NOT_FOUND"


async def test_get_task_reads_body_and_threads(session: AsyncSession) -> None:
    await seed(session)
    doc = await search_service.get_task(session, "p1", "k4")

    assert doc.task.key == "HW-4"
    assert len(doc.task.body) == 7
    assert [(t.id, t.title, t.state) for t in doc.threads] == [
        ("t1", "서버 OS 결정", "decided"),
        ("t2", "DB 결정", "decided"),
    ]


async def test_get_task_out_of_project_is_not_found(session: AsyncSession) -> None:
    await seed(session)
    with pytest.raises(ApiError) as caught:
        await search_service.get_task(session, "p1", "x2")
    assert caught.value.code == "TASK_NOT_FOUND"


async def test_tool_results_dump_as_camel_case_json(session: AsyncSession) -> None:
    """7-2 에서 JSON 으로 Claude 에 넘긴다 — 화면과 같은 이름 · 날짜 모양이어야 한다."""
    await seed(session)
    doc = (await search_service.get_thread(session, "p1", "t1")).model_dump(
        mode="json", by_alias=True
    )
    assert set(doc) == {"thread", "entries", "tasks"}
    assert doc["entries"][0]["threadId"] == "t1"
    assert doc["thread"]["createdAt"].endswith("Z")


def test_snippet_keeps_short_lines_and_cuts_around_the_match() -> None:
    assert search_service.snippet("서버 OS\n결정", "OS") == "서버 OS 결정"

    long = "가" * 100 + "정보보안팀" + "나" * 100
    cut = search_service.snippet(long, "정보보안팀")
    assert "정보보안팀" in cut
    assert cut.startswith("…") and cut.endswith("…")
    assert len(cut) == search_service.SNIPPET_WIDTH + 2


# --- Postgres 에서만 도는 것 (없으면 건너뜀) ---------------------------------


async def _search(
    client: httpx.AsyncClient, q: str, project: str = "p1"
) -> dict[str, list[dict[str, str]]]:
    res = await client.get(f"/api/projects/{project}/search", params={"q": q})
    assert res.status_code == 200, res.text
    body: dict[str, list[dict[str, str]]] = res.json()
    assert set(body) == {"threads", "tasks"}
    for hit in body["threads"]:
        assert set(hit) == THREAD_HIT_KEYS
    for hit in body["tasks"]:
        assert set(hit) == TASK_HIT_KEYS
    return body


async def test_finds_thread_by_title_with_its_decision(pg_client: httpx.AsyncClient) -> None:
    body = await _search(pg_client, "OS")
    top = body["threads"][0]
    assert top["id"] == "t1"
    assert top["matched"] == "title"
    assert top["snippet"] == "서버 OS 결정"
    assert top["state"] == "decided"
    assert top["decision"] == "우분투 최신 버전으로 한다"


async def test_finds_tasks_by_body_line(pg_client: httpx.AsyncClient) -> None:
    body = await _search(pg_client, "우분투")
    assert [hit["id"] for hit in body["threads"]] == ["t1"]
    # 후보('우분투')와 이력('우분투 최신 …')이 둘 다 맞는다 — 같은 점수면 후보가 먼저다
    assert body["threads"][0]["matched"] == "option"

    task = body["tasks"][0]
    assert (task["id"], task["key"], task["matched"]) == ("k4", "HW-4", "body")
    assert task["snippet"] == "우분투 최신 버전 설치"


async def test_finds_entry_note_and_detail(pg_client: httpx.AsyncClient) -> None:
    body = await _search(pg_client, "정보보안팀")
    t3 = next(hit for hit in body["threads"] if hit["id"] == "t3")
    assert t3["matched"] == "entry"
    assert "정보보안팀" in t3["snippet"]
    assert t3["decision"] == ""  # 아직 안 정해졌다

    body = await _search(pg_client, "통합 테스트")
    t6 = body["threads"][0]
    assert (t6["id"], t6["matched"]) == ("t6", "entry")
    assert t6["snippet"] == "통합 테스트를 3주에서 1주로 줄인다"


async def test_korean_particles_still_match(pg_client: httpx.AsyncClient) -> None:
    """'미룸이다' 처럼 조사가 붙어도 검색어가 그대로 들어 있으면 걸린다."""
    body = await _search(pg_client, "미룸")
    assert [hit["id"] for hit in body["threads"]] == ["t5"]


async def test_same_score_keeps_seq_order(pg_client: httpx.AsyncClient) -> None:
    body = await _search(pg_client, "결정")
    ids = [hit["id"] for hit in body["threads"]]
    assert ids[:2] == ["t1", "t2"]  # 둘 다 제목에 '결정' — 등록 순서대로


async def test_other_project_does_not_leak(pg_client: httpx.AsyncClient) -> None:
    p1 = await _search(pg_client, "이관")
    assert p1 == {"threads": [], "tasks": []}

    p2 = await _search(pg_client, "이관", project="p2")
    assert [hit["id"] for hit in p2["threads"]] == ["t10"]
    assert [hit["key"] for hit in p2["tasks"]] == ["PAS-2"]

    # 거꾸로 — p2 에서는 p1 의 안건이 안 나온다
    assert await _search(pg_client, "OS", project="p2") == {"threads": [], "tasks": []}


async def test_no_hit_is_empty_not_404(pg_client: httpx.AsyncClient) -> None:
    assert await _search(pg_client, "쿠버네티스") == {"threads": [], "tasks": []}


async def test_limit_applies_to_each_list(pg_client: httpx.AsyncClient) -> None:
    res = await pg_client.get("/api/projects/p1/search", params={"q": "결정", "limit": 1})
    body = res.json()
    assert len(body["threads"]) == 1
    assert body["threads"][0]["id"] == "t1"


async def test_changed_decision_is_the_last_line(pg_client: httpx.AsyncClient) -> None:
    """결정이 바뀐 안건은 마지막 decide · change 줄이 지금의 결정이다. 뒤의 다른 줄은 안 친다."""
    changed = await pg_client.post(
        "/api/threads/t2/entries",
        json={"kind": "change", "text": "PostgreSQL 로 바꾼다", "note": "호환성 문제가 풀렸다"},
    )
    assert changed.status_code == 201
    refined = await pg_client.post(
        "/api/threads/t2/entries", json={"kind": "refine", "text": "버전은 17 로 한다"}
    )
    assert refined.status_code == 201

    body = await _search(pg_client, "DB 결정")
    t2 = next(hit for hit in body["threads"] if hit["id"] == "t2")
    assert t2["decision"] == "PostgreSQL 로 바꾼다"


async def test_tools_filter_by_state_and_status(pg_session: AsyncSession) -> None:
    decided = await search_service.search_threads(pg_session, "p1", "결정", state="decided")
    assert {hit.id for hit in decided} >= {"t1", "t2"}
    assert all(hit.state == "decided" for hit in decided)

    assert await search_service.search_threads(pg_session, "p1", "결정", state="queued") == []

    doing = await search_service.search_tasks(pg_session, "p1", "개발", status="blocked")
    assert [hit.key for hit in doing] == ["HW-18"]


async def test_tools_never_read_another_project(pg_session: AsyncSession) -> None:
    """Claude 가 다른 프로젝트 id 를 넣어도 그 프로젝트 것만 나온다."""
    assert await search_service.search_threads(pg_session, "p2", "OS") == []
    assert await search_service.search_tasks(pg_session, "p2", "우분투") == []
    assert await search_service.search_threads(pg_session, "없는프로젝트", "OS") == []

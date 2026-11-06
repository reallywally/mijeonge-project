"""저장한 AI 리스크 분석 — 임시 분석 · 게시판 (`docs/api/risk-analysis.md`).

**Claude 를 부르지 않는다.** 챗봇 검사의 가짜 클라이언트를 끼운다. '오늘' 은 리스크 요약 검사와
같은 2026-10-15 다 — 시드 p1 의 보고서가 t5 t3 t8 t9 t4 t7 이다.
"""

from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.api import risk as risk_api
from app.main import app
from app.models import Member, Project, RiskAnalysis
from app.schemas.risk_analysis import (
    AnalyzedAgenda,
    AnalyzedTask,
    AnalyzedTest,
    RiskAnalysisFacts,
)
from app.services import risk_analysis as analysis_service
from app.services.progress import kst_day
from app.services.risk_settings import default_settings
from app.time import now
from tests.conftest import AsMember, logged_in
from tests.test_chat import FakeClient, Turn, parse_sse
from tests.test_contract_types import FIELDS, all_fields
from tests.test_risk_summary import TODAY, sent

SUMMARY = "/api/projects/p1/risks/summary"
BOARD = "/api/projects/p1/risk-analyses"


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(risk_api, "today_kst", lambda: TODAY)
    chat_api.get_rate_limiter().reset()


def use(fake: FakeClient | None) -> None:
    app.dependency_overrides[chat_api.get_chat_client] = lambda: fake


async def analyze(
    c: httpx.AsyncClient,
    agenda_ids: list[str],
    text: str = "요약 [[agenda:t5]]",
    *,
    task_ids: list[str] | None = None,
    test_ids: list[str] | None = None,
) -> dict[str, Any]:
    """분석 하나를 돌리고 done 의 data 를 돌려준다. 작업 · 테스트를 안 주면 키째 안 보낸다."""
    use(FakeClient(Turn(texts=[text])))
    body: dict[str, Any] = {"agendaIds": agenda_ids}
    if task_ids is not None:
        body["taskIds"] = task_ids
    if test_ids is not None:
        body["testIds"] = test_ids
    res = await c.post(SUMMARY, json=body)
    assert res.status_code == 200, res.text
    name, done = parse_sse(res.text)[-1]
    assert name == "done"
    return done


async def save(c: httpx.AsyncClient, analysis_id: str, title: str = "첫 분석") -> httpx.Response:
    return await c.post(BOARD, json={"analysisId": analysis_id, "title": title})


async def count(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(RiskAnalysis)) or 0)


# --- 임시 분석 ---------------------------------------------------------------------


async def test_done_carries_analysis_id_and_the_draft_stays_hidden(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    done = await analyze(client, ["t5", "t3"])
    assert set(done) == {"type", "refs", "analysisId"}
    assert done["refs"] == [{"kind": "agenda", "id": "t5"}]

    row = await session.get(RiskAnalysis, done["analysisId"])
    assert row is not None
    assert (row.saved_at, row.seq, row.title, row.created_by) == (None, None, None, "admin")
    assert row.body == "요약 [[agenda:t5]]"
    assert row.refs == [{"kind": "agenda", "id": "t5"}]
    # 임시는 게시판 · 상세 어디에도 없다
    assert (await client.get(BOARD)).json() == {"items": [], "total": 0}
    res = await client.get(f"/api/risk-analyses/{done['analysisId']}")
    assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"


async def test_nothing_to_analyze_leaves_no_draft(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    done = await analyze(client, [])
    assert done == {"type": "done", "refs": []}
    assert await count(session) == 0


async def test_errors_leave_no_draft(client: httpx.AsyncClient, session: AsyncSession) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    events = parse_sse((await client.post(SUMMARY, json={"agendaIds": ["t5"]})).text)
    assert [name for name, _ in events] == ["delta", "error"]
    assert await count(session) == 0


async def test_truncated_answer_is_kept_as_shown(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    use(FakeClient(Turn(texts=["길게 "], stop_reason="max_tokens")))
    events = parse_sse((await client.post(SUMMARY, json={"agendaIds": ["t5"]})).text)
    shown = "".join(data["text"] for name, data in events if name == "delta")
    row = await session.get(RiskAnalysis, events[-1][1]["analysisId"])
    assert row is not None and row.body == shown


async def test_snapshot_is_the_filtered_report(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    done = await analyze(
        client,
        ["t3", "t5", "t10"],
        task_ids=["k22", "k21", "x1", "k2"],
        test_ids=["tc2", "tc3", "tc1"],
    )
    row = await session.get(RiskAnalysis, done["analysisId"])
    assert row is not None
    facts = row.facts
    assert facts["asOf"] == TODAY.isoformat()
    assert facts["settings"] == default_settings().model_dump(by_alias=True)
    # 점수 순 · 남의 프로젝트 것(t10)은 빠진다
    assert [a["agendaId"] for a in facts["agendas"]] == ["t5", "t3"]
    t5 = facts["agendas"][0]
    assert (t5["key"], t5["score"], t5["level"]) == (None, 5, "medium")
    assert t5["signals"] == ["stale", "blocking"]
    # 작업 · 테스트도 점수 순 — 다른 프로젝트(x1) · 리스크가 아닌 것(k2 완료 · tc1 묶음)은 빠진다
    assert facts["tasks"] == [
        {"taskId": "k21", "key": "HW-21", "title": "개발자 계정 배포", "level": "high",
         "score": 6, "signals": ["overdue", "dueSlipped"], "ownerName": "김서연"},
        {"taskId": "k22", "key": "HW-22", "title": "스테이징 DB 구성", "level": "low",
         "score": 1, "signals": ["contentChurn"], "ownerName": "이도현"},
    ]  # fmt: skip
    assert [(t["testId"], t["key"], t["level"]) for t in facts["tests"]] == [
        ("tc3", "HW-T3", "high"),
        ("tc2", "HW-T2", "low"),
    ]
    assert facts["compare"] is None


async def test_old_drafts_are_swept_when_a_new_one_lands(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    old = (await analyze(client, ["t5"]))["analysisId"]
    row = await session.get(RiskAnalysis, old)
    assert row is not None
    row.created_at = now() - timedelta(hours=25)
    await session.commit()

    await analyze(client, ["t5"])
    assert await session.get(RiskAnalysis, old, populate_existing=True) is None
    assert await count(session) == 1


# --- 저장 --------------------------------------------------------------------------


async def test_save_flow(client: httpx.AsyncClient) -> None:
    done = await analyze(client, ["t5", "t3"])
    res = await save(client, done["analysisId"], "  11월 첫 주 분석  ")
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["id"], body["projectId"]) == (done["analysisId"], "p1")
    assert (body["seq"], body["title"], body["createdBy"]) == (1, "11월 첫 주 분석", "admin")
    assert (body["agendaCount"], body["titleEditedAt"]) == (2, None)
    assert body["savedAt"].endswith("Z") and body["createdAt"].endswith("Z")
    assert body["refs"] == [{"kind": "agenda", "id": "t5"}]
    assert body["body"] == "요약 [[agenda:t5]]"

    page = (await client.get(BOARD)).json()
    assert page["total"] == 1
    (item,) = page["items"]
    assert item == {k: body[k] for k in item}
    assert (await client.get(f"/api/risk-analyses/{body['id']}")).json() == body


async def test_saving_twice_is_409(client: httpx.AsyncClient) -> None:
    done = await analyze(client, ["t5"])
    assert (await save(client, done["analysisId"])).status_code == 201
    res = await save(client, done["analysisId"], "또")
    assert res.status_code == 409 and res.json()["code"] == "RISK_ANALYSIS_ALREADY_SAVED"


async def test_someone_elses_draft_is_404(client: httpx.AsyncClient, as_member: AsMember) -> None:
    done = await analyze(client, ["t5"])
    u2 = await as_member("u2")
    res = await save(u2, done["analysisId"])
    assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"
    # 돌린 사람은 그대로 저장한다
    assert (await save(client, done["analysisId"])).status_code == 201


async def test_draft_older_than_a_day_is_404(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    done = await analyze(client, ["t5"])
    row = await session.get(RiskAnalysis, done["analysisId"])
    assert row is not None
    row.created_at = now() - timedelta(hours=24, minutes=1)
    await session.commit()
    res = await save(client, done["analysisId"])
    assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"


@pytest.mark.parametrize("analysis_id", ["없는분석", None])
async def test_unknown_or_other_project_draft_is_404(
    client: httpx.AsyncClient, analysis_id: str | None
) -> None:
    done = await analyze(client, ["t5"])
    target = analysis_id or done["analysisId"]
    # 없는 id 는 p1 에서, 있는 id 는 다른 프로젝트(p2)에서 저장해 본다
    url = BOARD if analysis_id else "/api/projects/p2/risk-analyses"
    res = await client.post(url, json={"analysisId": target, "title": "몰래"})
    assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"


@pytest.mark.parametrize(("title", "status"), [("   ", 422), ("가" * 101, 422), ("가" * 100, 201)])
async def test_title_is_1_to_100_after_trim(
    client: httpx.AsyncClient, title: str, status: int
) -> None:
    done = await analyze(client, ["t5"])
    res = await save(client, done["analysisId"], title)
    assert res.status_code == status
    if status == 422:
        assert res.json()["code"] == "VALIDATION_ERROR"
        assert "title" in res.json()["detail"]
        patch = await client.patch(
            f"/api/risk-analyses/{done['analysisId']}", json={"title": title}
        )
        # 아직 임시라 경로 경계에서 먼저 404 다
        assert patch.status_code == 404


async def test_numbers_are_not_reused_after_delete(client: httpx.AsyncClient) -> None:
    first = (await save(client, (await analyze(client, ["t5"]))["analysisId"])).json()
    assert (await client.delete(f"/api/risk-analyses/{first['id']}")).status_code == 204
    second = (await save(client, (await analyze(client, ["t5"]))["analysisId"], "둘")).json()
    assert second["seq"] == 2
    assert (await client.get("/api/projects/p2/risk-analyses")).json()["total"] == 0


async def test_board_is_newest_first_with_paging(client: httpx.AsyncClient) -> None:
    for title in ("하나", "둘", "셋"):
        assert (await save(client, (await analyze(client, ["t5"]))["analysisId"], title)).is_success
    page = (await client.get(BOARD)).json()
    assert [i["title"] for i in page["items"]] == ["셋", "둘", "하나"]
    page = (await client.get(BOARD, params={"limit": 1, "offset": 1})).json()
    assert ([i["title"] for i in page["items"]], page["total"]) == (["둘"], 3)
    assert (await client.get(BOARD, params={"limit": 201})).status_code == 422


# --- 지난 분석 대비 ------------------------------------------------------------------


def _row(agenda_id: str, level: str) -> AnalyzedAgenda:
    return AnalyzedAgenda.model_validate(
        {
            "agendaId": agenda_id,
            "key": None,
            "title": f"안건 {agenda_id}",
            "level": level,
            "score": 1,
            "signals": [],
            "ownerName": None,
        }
    )


def _task(task_id: str, level: str) -> AnalyzedTask:
    return AnalyzedTask(
        task_id=task_id, key=f"HW-{task_id}", title=f"작업 {task_id}", level=level,  # type: ignore[arg-type]
        score=1, signals=[], owner_name=None,
    )  # fmt: skip


def _test(test_id: str, level: str) -> AnalyzedTest:
    return AnalyzedTest(
        test_id=test_id, key=f"HW-T{test_id}", title=f"테스트 {test_id}", level=level,  # type: ignore[arg-type]
        score=1, signals=[], owner_name=None,
    )  # fmt: skip


def _facts(
    agendas: list[AnalyzedAgenda],
    tasks: list[AnalyzedTask] | None = None,
    tests: list[AnalyzedTest] | None = None,
) -> RiskAnalysisFacts:
    return RiskAnalysisFacts.model_validate(
        {
            "asOf": TODAY,
            "settings": default_settings().model_dump(),
            "agendas": agendas,
            "tasks": tasks or [],
            "tests": tests or [],
            "compare": None,
        }
    )


def _saved(facts: dict[str, Any]) -> RiskAnalysis:
    return RiskAnalysis(id="prev", title="앞 분석", facts=facts, saved_at=now())


def test_compare_counts_added_removed_kept() -> None:
    before = _facts(
        [_row("a", "high"), _row("b", "medium"), _row("c", "low")],
        [_task("k1", "high"), _task("k2", "low")],
        [_test("s1", "medium")],
    )
    previous = _saved(before.model_dump(mode="json", by_alias=True))
    found = analysis_service.compare(
        previous,
        _facts(
            [_row("d", "high"), _row("b", "high"), _row("a", "high")],
            [_task("k3", "medium"), _task("k1", "medium")],
            [_test("s1", "low")],
        ),
    )
    assert found is not None
    assert (found.previous_id, found.previous_title) == ("prev", "앞 분석")
    body = found.model_dump(mode="json", by_alias=True)
    # 종류를 단다 — 안건 → 작업 → 테스트, added · kept 는 이번 순서 · removed 는 앞 순서
    assert body["added"] == [{"kind": "agenda", "id": "d"}, {"kind": "task", "id": "k3"}]
    assert body["removed"] == [{"kind": "agenda", "id": "c"}, {"kind": "task", "id": "k2"}]
    assert body["kept"] == [
        {"kind": "agenda", "id": "b", "levelFrom": "medium", "levelTo": "high"},
        {"kind": "agenda", "id": "a", "levelFrom": "high", "levelTo": "high"},
        {"kind": "task", "id": "k1", "levelFrom": "high", "levelTo": "medium"},
        {"kind": "test", "id": "s1", "levelFrom": "medium", "levelTo": "low"},
    ]
    assert analysis_service.compare(None, _facts([_row("a", "high")])) is None


# 2026-11-06 전에 저장한 분석의 facts — 기준 넷 · 작업 · 테스트 없음 · 옛 compare 모양
OLD_FACTS: dict[str, Any] = {
    "asOf": "2026-10-14",
    "settings": {"dueSoonDays": 3, "staleDays": 7, "highScore": 6, "mediumScore": 3},
    "agendas": [
        {"agendaId": "t5", "key": None, "title": "옛 안건", "level": "high", "score": 7,
         "signals": ["stale"], "ownerName": "정하늘"},
    ],
    "compare": {
        "previousId": "older", "previousTitle": "더 앞", "previousSavedAt": "2026-10-13T01:00:00Z",
        "added": ["t5"], "removed": ["t9"],
        "kept": [{"agendaId": "t3", "levelFrom": "low", "levelTo": "medium"}],
    },
}  # fmt: skip


def test_compare_with_an_old_analysis_adds_every_task_and_test() -> None:
    found = analysis_service.compare(
        _saved(OLD_FACTS), _facts([_row("t5", "medium")], [_task("k1", "high")])
    )
    assert found is not None
    body = found.model_dump(mode="json", by_alias=True)
    assert body["added"] == [{"kind": "task", "id": "k1"}]
    assert body["kept"] == [
        {"kind": "agenda", "id": "t5", "levelFrom": "high", "levelTo": "medium"}
    ]


async def test_old_saved_rows_are_read_as_they_are(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """옛 줄은 고치지 않는다 — 기준 넷 · 옛 compare 모양 그대로 나가고 작업 · 테스트는 비어 있다."""
    session.add(
        RiskAnalysis(
            id="old1", project_id="p1", seq=1, title="옛 분석", body="글", refs=[],
            facts=OLD_FACTS, created_by="admin", created_at=now(), saved_at=now(),
        )
    )  # fmt: skip
    await session.commit()
    body = (await client.get("/api/risk-analyses/old1")).json()
    assert (body["agendaCount"], body["taskCount"], body["testCount"], body["highCount"]) == (
        1,
        0,
        0,
        1,
    )
    facts = body["facts"]
    assert facts["settings"] == OLD_FACTS["settings"]
    assert facts["compare"] == OLD_FACTS["compare"]
    assert (facts["tasks"], facts["tests"]) == ([], [])
    row = await session.get(RiskAnalysis, "old1")
    assert row is not None and row.facts == OLD_FACTS
    # 옛 분석을 '앞' 으로 견줘도 된다
    done = await analyze(client, ["t5"], task_ids=["k21"])
    draft = await session.get(RiskAnalysis, done["analysisId"])
    assert draft is not None
    assert draft.facts["compare"]["added"] == [{"kind": "task", "id": "k21"}]


async def test_second_analysis_compares_with_the_last_saved(client: httpx.AsyncClient) -> None:
    first = (await save(client, (await analyze(client, ["t5", "t3"]))["analysisId"], "앞")).json()
    # 저장 안 한 분석은 '앞' 이 되지 않는다
    await analyze(client, ["t8"])

    fake = FakeClient(Turn(texts=["달라진 점"]))
    use(fake)
    res = await client.post(SUMMARY, json={"agendaIds": ["t3", "t8"]})
    done = parse_sse(res.text)[-1][1]
    doc = sent(fake)["compare"]
    assert doc["previousTitle"] == "앞" and doc["previousAgendaCount"] == 2
    assert (doc["previousTaskCount"], doc["previousTestCount"]) == (0, 0)
    saved_at = datetime.fromisoformat(first["savedAt"].replace("Z", "+00:00"))
    assert doc["previousSavedOn"] == kst_day(saved_at).isoformat()
    second = (await save(client, done["analysisId"], "뒤")).json()
    titles = {a["agendaId"]: a["title"] for a in first["facts"]["agendas"]}
    titles |= {a["agendaId"]: a["title"] for a in second["facts"]["agendas"]}
    # 줄은 id 없이 종류 · 제목으로 — 빠진 안건(t5)은 앞 스냅샷의 제목이다
    assert doc["added"] == [{"kind": "안건", "title": titles["t8"]}]
    assert doc["removed"] == [{"kind": "안건", "title": titles["t5"]}]
    (kept,) = doc["kept"]
    assert kept["title"] == titles["t3"] and kept["levelFrom"] == kept["levelTo"]
    assert "agendaId" not in str(doc) and "'id'" not in str(doc)

    compare = second["facts"]["compare"]
    assert (compare["previousId"], compare["previousTitle"]) == (first["id"], "앞")
    assert compare["previousSavedAt"] == first["savedAt"]
    assert compare["added"] == [{"kind": "agenda", "id": "t8"}]
    assert compare["removed"] == [{"kind": "agenda", "id": "t5"}]
    assert [(k["kind"], k["id"]) for k in compare["kept"]] == [("agenda", "t3")]
    assert compare["kept"][0]["levelFrom"] == compare["kept"][0]["levelTo"]


async def test_compare_tells_claude_tasks_and_tests_by_key(client: httpx.AsyncClient) -> None:
    await save(client, (await analyze(client, ["t5"], task_ids=["k22"]))["analysisId"], "앞")
    fake = FakeClient(Turn(texts=["달라진 점"]))
    use(fake)
    await client.post(SUMMARY, json={"agendaIds": [], "taskIds": ["k21"], "testIds": ["tc2"]})
    doc = sent(fake)["compare"]
    assert doc["previousTaskCount"] == 1
    assert doc["added"] == [
        {"kind": "작업", "title": "개발자 계정 배포", "key": "HW-21"},
        {"kind": "테스트", "title": "올바른 계정으로 로그인", "key": "HW-T2"},
    ]
    assert {r["kind"] for r in doc["removed"]} == {"안건", "작업"}


async def test_first_analysis_tells_claude_there_is_no_previous(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await client.post(SUMMARY, json={"agendaIds": ["t5"]})
    assert sent(fake)["compare"] is None


# --- 권한 --------------------------------------------------------------------------


async def test_only_the_author_renames(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    done = await analyze(u2, ["t5"])
    saved = (await save(u2, done["analysisId"])).json()
    url = f"/api/risk-analyses/{saved['id']}"

    # 시스템 관리자 · 프로젝트 관리자도 남의 제목은 못 고친다
    for other in (client, await as_member("u1")):
        res = await other.patch(url, json={"title": "고침"})
        assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN"

    res = await u2.patch(url, json={"title": "  고친 제목 "})
    assert res.status_code == 200
    assert res.json()["title"] == "고친 제목" and res.json()["titleEditedAt"] is not None
    assert res.json()["body"] == saved["body"] and res.json()["facts"] == saved["facts"]
    res = await u2.patch(url, json={"title": ""})
    assert res.status_code == 422 and "title" in res.json()["detail"]


@pytest.mark.parametrize(("who", "status"), [("u3", 403), ("u2", 204), ("u1", 204), ("admin", 204)])
async def test_delete_is_author_or_admins(
    client: httpx.AsyncClient, as_member: AsMember, who: str, status: int
) -> None:
    u2 = await as_member("u2")
    saved = (await save(u2, (await analyze(u2, ["t5"]))["analysisId"])).json()
    deleter = client if who == "admin" else await as_member(who)
    res = await deleter.delete(f"/api/risk-analyses/{saved['id']}")
    assert res.status_code == status
    after = await client.get(f"/api/risk-analyses/{saved['id']}")
    assert after.status_code == (200 if status == 403 else 404)


async def test_outsiders_see_nothing(client: httpx.AsyncClient, session: AsyncSession) -> None:
    saved = (await save(client, (await analyze(client, ["t5"]))["analysisId"])).json()
    session.add(Member(id="u9", no=99, name="바깥", email="u9@inno-ax.com"))
    await session.commit()
    async with await logged_in(session, "u9") as outsider:
        res = await outsider.get(BOARD)
        assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"
        for method in ("GET", "PATCH", "DELETE"):
            body = {"title": "몰래"} if method == "PATCH" else None
            res = await outsider.request(method, f"/api/risk-analyses/{saved['id']}", json=body)
            assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"


async def test_deleted_project_hides_analyses(client: httpx.AsyncClient) -> None:
    saved = (await save(client, (await analyze(client, ["t5"]))["analysisId"])).json()
    assert (await client.delete("/api/projects/p1")).status_code == 204
    res = await client.get(f"/api/risk-analyses/{saved['id']}")
    assert res.status_code == 404 and res.json()["code"] == "RISK_ANALYSIS_NOT_FOUND"


async def test_project_counter_starts_at_zero(
    session: AsyncSession, client: httpx.AsyncClient
) -> None:
    project = await session.get(Project, "p1")
    assert project is not None and project.last_analysis_no == 0


# --- 리포트는 걷었다 ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("GET", "/api/projects/p1/reports"),
        ("POST", "/api/projects/p1/reports"),
        ("GET", "/api/reports/r1"),
        ("DELETE", "/api/reports/r1"),
    ],
)
async def test_report_paths_are_gone(client: httpx.AsyncClient, method: str, url: str) -> None:
    res = await client.request(method, url)
    assert res.status_code == 404


# --- 계약 모양 ----------------------------------------------------------------------

SHAPES: dict[str, set[str]] = {
    "RiskAnalysisListItem": {
        "id",
        "projectId",
        "seq",
        "title",
        "createdBy",
        "createdAt",
        "savedAt",
        "agendaCount",
        "taskCount",
        "testCount",
        "highCount",
    },
    "RiskAnalysisFacts": {"asOf", "settings", "agendas", "tasks", "tests", "compare"},
    "RiskAnalysisAgenda": {"agendaId", "key", "title", "level", "score", "signals", "ownerName"},
    # 작업 · 테스트 스냅샷 · 종류를 단 비교 (2026-11-06, risk-dashboard.md)
    "RiskAnalysisTask": {"taskId", "key", "title", "level", "score", "signals", "ownerName"},
    "RiskAnalysisTest": {"testId", "key", "title", "level", "score", "signals", "ownerName"},
    "RiskCompareRef": {"kind", "id"},
    "RiskAnalysisCompare": {
        "previousId",
        "previousTitle",
        "previousSavedAt",
        "added",
        "removed",
        "kept",
    },
    "RiskAnalysisPage": {"items", "total"},
}
SHAPES["RiskAnalysis"] = SHAPES["RiskAnalysisListItem"] | {"body", "refs", "facts", "titleEditedAt"}


@pytest.mark.parametrize("name", sorted(SHAPES))
def test_shapes_match_domain_ts(name: str) -> None:
    """domain.ts 에 들어와 있으면 필드가 계약과 같아야 한다."""
    if name not in FIELDS:
        return
    assert set(all_fields(name)) == SHAPES[name]


async def test_responses_match_shapes(client: httpx.AsyncClient) -> None:
    await save(client, (await analyze(client, ["t5", "t3"]))["analysisId"], "앞")
    done = await analyze(client, ["t3"], task_ids=["k21"], test_ids=["tc2"])
    saved = (await save(client, done["analysisId"], "뒤")).json()
    assert set(saved) == SHAPES["RiskAnalysis"]
    facts = saved["facts"]
    assert set(facts) == SHAPES["RiskAnalysisFacts"]
    assert all(set(a) == SHAPES["RiskAnalysisAgenda"] for a in facts["agendas"])
    assert (
        all(
            set(t) == {"taskId", "key", "title", "level", "score", "signals", "ownerName"}
            for t in facts["tasks"]
        )
        and facts["tasks"]
    )
    assert (
        all(
            set(t) == {"testId", "key", "title", "level", "score", "signals", "ownerName"}
            for t in facts["tests"]
        )
        and facts["tests"]
    )
    assert set(facts["compare"]) == SHAPES["RiskAnalysisCompare"]
    assert all(set(item) == SHAPES["RiskCompareRef"] for item in facts["compare"]["added"])
    assert all(
        set(item) == {"kind", "id", "levelFrom", "levelTo"} for item in facts["compare"]["kept"]
    )
    page = (await client.get(BOARD)).json()
    assert set(page) == SHAPES["RiskAnalysisPage"]
    assert all(set(i) == SHAPES["RiskAnalysisListItem"] for i in page["items"])


# --- 리비전 0037 ---


def test_migration_0037_swaps_report_for_analysis() -> None:
    """올리면 project_report 가 사라지고 risk_analysis 가 선다. 되돌리면 빈 리포트 표가 돌아온다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0037_risk_analysis")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[: at + 1]:
                revision.module.upgrade()
            tables = set(inspect(conn).get_table_names())
            assert "risk_analysis" in tables and "project_report" not in tables
            columns = {c["name"] for c in inspect(conn).get_columns("project")}
            assert "last_analysis_no" in columns

            revisions[at].module.downgrade()
            tables = set(inspect(conn).get_table_names())
            assert "risk_analysis" not in tables and "project_report" in tables
            columns = {c["name"] for c in inspect(conn).get_columns("project")}
            assert "last_analysis_no" not in columns


# --- 리비전 0038 ---


def test_migration_0038_adds_churn_settings_with_defaults() -> None:
    """지금 줄은 server_default 로 기본값(14 · 5 · 2)을 받는다. 되돌리면 세 칸이 빠진다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0038_risk_churn")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:at]:
                revision.module.upgrade()
            conn.exec_driver_sql(
                "insert into project (id, name, task_key_prefix) values ('p', 'p', 'P')"
            )
            conn.exec_driver_sql(
                "insert into risk_setting (project_id, due_soon_days, stale_days, high_score,"
                " medium_score, updated_at) values ('p', 3, 9, 6, 3, '2026-11-06')"
            )
            revisions[at].module.upgrade()
            row = conn.exec_driver_sql(
                "select stale_days, churn_days, churn_count, slip_count from risk_setting"
            ).one()
            assert tuple(row) == (9, 14, 5, 2)

            revisions[at].module.downgrade()
            columns = {c["name"] for c in inspect(conn).get_columns("risk_setting")}
            assert not columns & {"churn_days", "churn_count", "slip_count"}
            assert "stale_days" in columns

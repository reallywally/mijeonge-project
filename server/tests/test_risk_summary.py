"""리스크 AI 요약 — `POST /api/projects/{projectId}/risks/summary` (`docs/api/risk.md` 'AI 요약').

**Claude 를 부르지 않는다.** 챗봇 검사의 가짜 클라이언트를 그대로 끼운다.
'오늘' 은 시드 보고서 검사(`test_risk.py`)와 같은 2026-10-15 로 고정한다.
"""

import json
from datetime import UTC, date, datetime
from typing import Any

import httpx
import httpx2
import pytest
from anthropic import APIConnectionError, RateLimitError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.api import risk as risk_api
from app.config import settings
from app.llm.anthropic_provider import FALLBACK_BETA
from app.main import app
from app.models import (
    Agenda,
    AgendaHistory,
    Member,
    Minutes,
    Task,
    TaskAgendaLink,
    TaskComment,
    TaskLine,
    TaskLog,
    TestCase,
    TestComment,
    TestRef,
)
from app.services import chat as chat_service
from app.services import risk_summary
from app.services.ratelimit import RateLimiter
from tests.conftest import AsMember
from tests.test_chat import FakeClient, Turn, parse_sse

URL = "/api/projects/p1/risks/summary"
TODAY = date(2026, 10, 15)
# 시드 p1 의 그날 보고서: 안건 t5 t3 t8 t9 t4 t7
ALL = {"agendaIds": ["t5", "t3", "t8", "t9", "t4", "t7"]}


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(risk_api, "today_kst", lambda: TODAY)
    chat_api.get_rate_limiter().reset()


def use(client: FakeClient | None) -> None:
    app.dependency_overrides[chat_api.get_chat_client] = lambda: client


def sent(fake: FakeClient) -> dict[str, Any]:
    """Claude 에 넣은 근거 JSON — 사용자 메시지 하나의 끝에 붙어 있다."""
    (call,) = fake.calls
    (message,) = call["messages"]
    assert message["role"] == "user"
    text: str = message["content"]
    return dict(json.loads(text[text.index("{") :]))


async def post(client: httpx.AsyncClient, body: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    res = await client.post(URL, json=body)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return parse_sse(res.text)


# --- 거르기 -------------------------------------------------------------------------


async def test_keeps_only_report_rows_that_were_sent(client: httpx.AsyncClient) -> None:
    """남의 프로젝트 id(t10) · 리스크가 아닌 id(t1) · 지어낸 id 는 조용히 버린다."""
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    body = {"agendaIds": ["t3", "t10", "t1", "없는안건", "t5"]}
    events = await post(client, body)
    assert [name for name, _ in events] == ["delta", "done"]

    data = sent(fake)
    # 순서는 화면이 보낸 순서가 아니라 서버의 계산(점수 순)이다
    assert [t["id"] for t in data["report"]["agendas"]] == ["t5", "t3"]
    # 작업 · 테스트를 안 보냈으면(옛 화면) 비어 있다
    assert data["report"]["tasks"] == [] and data["report"]["tests"] == []
    leaked = json.dumps(data, ensure_ascii=False)
    assert "t10" not in leaked and "이관 범위 확정" not in leaked and "현행 분석" not in leaked


async def test_task_and_test_ids_are_read(client: httpx.AsyncClient) -> None:
    """`taskIds` · `testIds`(2026-11-06 되살림) — 그것만으로도 부른다. 모르는 id 는 버린다."""
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    body = {
        "agendaIds": [],
        # x1 은 p2 · k2 는 완료 · tc1 은 묶음 — 리스크 줄이 아니다
        "taskIds": ["k22", "k3", "x1", "k2", "없는작업"],
        "testIds": ["tc2", "tc1", "tc7"],
    }
    events = await post(client, body)
    assert [name for name, _ in events] == ["delta", "done"]
    report = sent(fake)["report"]
    assert report["agendas"] == []
    # 서버의 점수 순
    assert [t["id"] for t in report["tasks"]] == ["k3", "k22"]
    assert [t["id"] for t in report["tests"]] == ["tc7", "tc2"]
    k3 = report["tasks"][0]
    assert (k3["owner"], k3["signals"], k3["score"], k3["ownerChanges"]) == (
        "박지훈",
        ["overdue", "longRunning", "ownerChurn"],
        7,
        2,
    )
    assert report["tests"][1]["flips"] == 2


@pytest.mark.parametrize(
    "body",
    [
        {"agendaIds": [], "taskIds": ["k2", "x1"], "testIds": ["tc1"]},
        {"agendaIds": [], "taskIds": [], "testIds": []},
    ],
)
async def test_nothing_in_any_kind_does_not_call(
    client: httpx.AsyncClient, body: dict[str, Any]
) -> None:
    fake = FakeClient(Turn(texts=["부르면 안 된다"]))
    use(fake)
    events = await post(client, body)
    assert fake.calls == []
    assert [name for name, _ in events] == ["delta", "done"]


async def test_numbers_come_from_the_server(client: httpx.AsyncClient) -> None:
    """화면이 숫자를 끼워 보내도 받지 않는다 — 점수 · 등급은 서버의 계산 그대로다."""
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, {"agendaIds": ["t5"], "score": 99, "level": "low"})
    (t5,) = sent(fake)["report"]["agendas"]
    assert (t5["score"], t5["level"]) == (5, "medium")
    assert t5["signals"] == ["stale", "blocking"]
    assert "deferCount" not in t5 and "lastDeferNote" not in t5


@pytest.mark.parametrize(
    "body",
    [
        {"agendaIds": []},
        # 거른 뒤 빈 것도 같다 — 남의 것 · 리스크 아닌 것뿐
        {"agendaIds": ["t10", "t1"]},
    ],
)
async def test_nothing_left_does_not_call_claude(
    client: httpx.AsyncClient, body: dict[str, Any]
) -> None:
    fake = FakeClient(Turn(texts=["부르면 안 된다"]))
    use(fake)
    events = await post(client, body)
    assert fake.calls == []
    assert events == [
        ("delta", {"type": "delta", "text": "지금 짚을 리스크가 없습니다."}),
        ("done", {"type": "done", "refs": []}),
    ]


# --- 넣는 근거 ----------------------------------------------------------------------


async def test_context_names_people_and_hides_their_ids(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    data = sent(fake)
    report = data["report"]

    assert report["asOf"] == "2026-10-15"
    assert report["settings"]["staleDays"] == 7
    t5 = report["agendas"][0]
    assert (t5["owner"], t5["part"]) == ("정하늘", "기간계 연동")
    k18 = {"id": "k18", "key": "HW-18", "title": "보험료 산출 기간계 API 개발"}
    assert t5["blockedTasks"] == [k18]
    t4 = next(t for t in report["agendas"] if t["id"] == "t4")
    assert t4["owner"] == "담당자 없음"
    assert set(report) == {"asOf", "settings", "agendas", "tasks", "tests", "owners"}
    assert [o["member"] for o in report["owners"]] == [
        "정하늘", "김서연", "담당자 없음", "박지훈", "이도현",
    ]  # fmt: skip
    assert {"riskyTasks", "riskyTests"} <= set(report["owners"][0])

    # 멤버 · 파트 id 는 어디에도 실리지 않는다 — 키도 값도
    raw = json.dumps(data, ensure_ascii=False)
    for key in ("ownerId", "memberId", "partId", "projectId", "agendaId", "taskId"):
        assert f'"{key}"' not in raw
    for member_id in ("u1", "u2", "u3", "u4", "admin", "pt1", "pt2", "pt3"):
        assert f'"{member_id}"' not in raw


def detail(data: dict[str, Any], agenda_id: str) -> dict[str, Any]:
    return dict(next(d for d in data["details"] if d["id"] == agenda_id))


def utc(moment: str) -> datetime:
    return datetime.fromisoformat(moment).replace(tzinfo=UTC)


async def test_context_details_top_agendas(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    details = sent(fake)["details"]

    # 여덟까지 — 시드의 그날 리스크는 여섯이라 다 싣는다
    assert [d["id"] for d in details] == ["t5", "t3", "t8", "t9", "t4", "t7"]
    t5 = details[0]
    assert set(t5) == {
        "id", "title", "description", "decision", "history", "meetings", "tasks", "tests",
        "ownerLoad",
    }  # fmt: skip
    assert t5["description"].startswith("보험료 산출 기간계 API 개발 중")
    # 아직 논의중이라도 적힌 결정내용은 그대로 준다
    assert t5["decision"] == "요청(in) 항목: 계약번호 · 상품코드 · 가입일 셋을 넘긴다"
    k18 = next(t for t in t5["tasks"] if t["id"] == "k18")
    assert {key: k18[key] for key in ("id", "key", "title", "status", "due", "owner")} == {
        "id": "k18",
        "key": "HW-18",
        "title": "보험료 산출 기간계 API 개발",
        "status": "blocked",
        "due": None,
        "owner": "정하늘",
    }
    # 시드 댓글 하나 · 체크 줄 없음
    assert k18["progress"]["checklist"] is None
    assert [c["author"] for c in k18["recentComments"]] == ["정하늘"]
    assert details[1]["decision"] == ""
    # 담당자가 없는 안건은 부담도 없다
    assert detail(sent(fake), "t4")["ownerLoad"] is None


async def test_details_stop_at_eight(client: httpx.AsyncClient, session: AsyncSession) -> None:
    """근거를 붙이는 안건은 점수 위쪽 여덟까지 — 나머지는 보고서 줄만 간다."""
    for n in range(4):
        session.add(
            Agenda(
                id=f"x{n}",
                project_id="p1",
                title=f"기한 지난 안건 {n}",
                state="open",
                due_date=date(2026, 10, 1),
                created_at=utc("2026-10-14T00:00:00"),
            )
        )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, {"agendaIds": [*ALL["agendaIds"], "x0", "x1", "x2", "x3"]})
    data = sent(fake)
    ranked = [t["id"] for t in data["report"]["agendas"]]
    assert len(ranked) == 10
    assert [d["id"] for d in data["details"]] == ranked[:8]


async def test_history_counts_due_date_pushes_and_owner_changes(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    def line(when: str, by: str | None, *changes: dict[str, Any]) -> AgendaHistory:
        return AgendaHistory(
            project_id="p1",
            agenda_id="t5",
            changed_by=by,
            changed_at=utc(when),
            changes=list(changes),
        )

    def change(field: str, before: Any, after: Any) -> dict[str, Any]:
        return {"field": field, "from": before, "to": after, "subject": ""}

    session.add_all(
        [
            line("2026-09-08T01:00:00", "u1", change("state", "queued", "open")),
            line("2026-09-20T01:00:00", "u1", change("dueDate", "2026-10-07", "2026-10-14")),
            line("2026-09-21T01:00:00", "u2", change("ownerId", "u1", "u4")),
            line("2026-09-22T01:00:00", "u4", change("dueDate", "2026-10-14", "2026-10-19")),
            line("2026-09-23T01:00:00", None, change("description", "", "가" * 300)),
            *(
                line(
                    f"2026-09-{24 + n}T01:00:00",
                    "u4",
                    change("title", f"제목 {n}", f"제목 {n + 1}"),
                )
                for n in range(6)
            ),
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    history = detail(sent(fake), "t5")["history"]

    assert history["dueDateChanges"] == 2
    assert history["dueDateFlow"] == ["2026-10-07", "2026-10-14", "2026-10-19"]
    assert history["ownerChanges"] == 1
    assert history["stateFlow"] == ["queued", "open"]
    assert history["createdOn"] == "2026-09-07"
    assert history["lastTouchedOn"] >= "2026-09-29"
    # 최근 열 줄만, 오래된 것부터 — 시드의 등록 · 결정 줄과 맨 앞의 상태 줄은 잘린다
    recent = history["recent"]
    assert len(recent) == 10
    assert recent[0]["changes"] == [
        {"field": "결정 기한", "from": "2026-10-07", "to": "2026-10-14"}
    ]
    owner = recent[1]
    assert owner == {
        "date": "2026-09-21",
        "by": "박지훈",
        "changes": [{"field": "담당자", "from": "김서연", "to": "정하늘"}],
    }
    long = recent[3]
    assert long["by"] == "알 수 없음"
    assert long["changes"][0]["field"] == "배경"
    assert len(long["changes"][0]["to"]) == 200 and long["changes"][0]["to"].endswith("…")


async def test_meetings_count_minutes_that_made_or_touched_the_agenda(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """만든 회의록(agenda.minutes_id) + 이력 줄을 남긴 회의록(Q69). 같은 회의록은 한 편이다."""

    def meeting(minutes_id: str, title: str, held: date | None, created: str) -> Minutes:
        return Minutes(
            id=minutes_id,
            project_id="p1",
            title=title,
            meeting_date=held,
            body="본문",
            author_id="u1",
            created_at=utc(created),
            updated_at=utc(created),
        )

    def line(minutes_id: str | None, *fields: str) -> AgendaHistory:
        return AgendaHistory(
            project_id="p1",
            agenda_id="t5",
            changed_by="u1",
            changed_at=utc("2026-09-10T01:00:00"),
            changes=[{"field": f, "from": None, "to": None, "subject": ""} for f in fields],
            minutes_id=minutes_id,
        )

    session.add_all(
        [
            # 회의 날짜가 없으면 등록일(한국 날짜)
            meeting("m9", "9월 첫째 주 회의", None, "2026-09-06T16:00:00"),
            meeting("m10", "9월 둘째 주 회의", date(2026, 9, 14), "2026-09-15T01:00:00"),
            meeting("m11", "9월 셋째 주 회의", date(2026, 9, 21), "2026-09-21T01:00:00"),
        ]
    )
    await session.flush()
    t5 = await session.get(Agenda, "t5")
    assert t5 is not None
    t5.minutes_id = "m9"
    session.add_all(
        [
            line("m10", "dueDate"),
            line("m10", "decision", "dueDate"),
            line("m11", "state"),
            # 손으로 고친 줄은 회의로 세지 않는다
            line(None, "title"),
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    data = sent(fake)
    assert detail(data, "t5")["meetings"] == {
        "count": 3,
        "recent": [
            {"title": "9월 첫째 주 회의", "date": "2026-09-07", "fields": ["등록"]},
            {
                "title": "9월 둘째 주 회의",
                "date": "2026-09-14",
                "fields": ["결정 기한", "결정내용"],
            },
            {"title": "9월 셋째 주 회의", "date": "2026-09-21", "fields": ["상태"]},
        ],
    }
    assert detail(data, "t3")["meetings"] == {"count": 0, "recent": []}


async def test_meetings_keep_the_last_five(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    session.add_all(
        [
            Minutes(
                id=f"mm{n}",
                project_id="p1",
                title=f"회의 {n}",
                meeting_date=date(2026, 9, 1 + n),
                body="본문",
                author_id="u1",
                created_at=utc("2026-09-01T01:00:00"),
                updated_at=utc("2026-09-01T01:00:00"),
            )
            for n in range(7)
        ]
    )
    await session.flush()
    session.add_all(
        [
            AgendaHistory(
                project_id="p1",
                agenda_id="t5",
                changed_by="u1",
                changed_at=utc("2026-09-10T01:00:00"),
                changes=[{"field": "decision", "from": "", "to": "", "subject": ""}],
                minutes_id=f"mm{n}",
            )
            for n in range(7)
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    meetings = detail(sent(fake), "t5")["meetings"]
    assert meetings["count"] == 7
    assert [m["title"] for m in meetings["recent"]] == [f"회의 {n}" for n in range(2, 7)]


async def test_linked_task_progress_and_recent_comments(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    k18 = await session.get(Task, "k18")
    assert k18 is not None
    session.add_all(
        [
            TaskLine(task_id="k18", kind="check", text="in 항목", done=True, sort_order=10),
            TaskLine(task_id="k18", kind="check", text="out 항목", done=True, sort_order=11),
            TaskLine(task_id="k18", kind="check", text="오류 코드", done=False, sort_order=12),
            TaskLine(task_id="k18", kind="bullet", text="메모", done=False, sort_order=13),
            TaskLog(
                project_id="p1",
                task_id="k18",
                from_status="doing",
                to_status="blocked",
                changed_by="u4",
                changed_at=utc("2026-10-12T03:00:00"),
            ),
            *(
                TaskComment(
                    task_id="k18",
                    author_id="u3",
                    body=f"댓글 {n}" if n < 4 else "나" * 300,
                    created_at=utc(f"2026-10-0{n + 1}T01:00:00"),
                )
                for n in range(5)
            ),
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    task = next(t for t in detail(sent(fake), "t5")["tasks"] if t["id"] == "k18")

    assert task["progress"] == {"checklist": {"done": 2, "total": 3}, "statusDays": 3}
    comments = task["recentComments"]
    # 작업마다 최근 셋, 오래된 것부터 · 본문 200자
    assert [c["body"][:4] for c in comments] == ["댓글 2", "댓글 3", "나" * 4]
    assert comments[0] == {"author": "이도현", "date": "2026-10-03", "body": "댓글 2"}
    assert len(comments[-1]["body"]) == 200 and comments[-1]["body"].endswith("…")


def _test(no: int, status: str, *, basis: int | None = 10**9) -> TestCase:
    return TestCase(
        id=f"tx{no}",
        project_id="p1",
        key=f"HW-T{100 + no}",
        title=f"테스트 {no}",
        status=status,
        status_changed_at=utc("2026-10-10T01:00:00"),
        basis_seq=basis,
        created_at=utc("2026-10-01T01:00:00"),
    )


async def test_troubled_tests_and_deleted_tasks(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """실패 · 막힘 · 기준 바뀜만 싣는다. 지운 작업과 그 작업에 건 테스트 · 댓글은 안 나간다."""
    session.add(
        Task(
            id="kx",
            project_id="p1",
            key="HW-900",
            title="지운 작업",
            status="blocked",
            created_at=utc("2026-10-01T01:00:00"),
            is_deleted=True,
        )
    )
    session.add_all(
        [
            _test(1, "fail"),
            _test(2, "blocked"),
            _test(3, "pass"),
            # 기준을 확인한 적이 없다 — t5 의 결정 줄 뒤라 '기준 바뀜'
            _test(4, "pass", basis=None),
            _test(5, "fail"),
        ]
    )
    await session.flush()
    session.add_all(
        [
            TaskAgendaLink(task_id="kx", agenda_id="t5", project_id="p1"),
            TaskComment(
                task_id="kx",
                author_id="u1",
                body="지운 작업의 댓글",
                created_at=utc("2026-10-02T01:00:00"),
            ),
            TestRef(test_id="tx1", project_id="p1", agenda_id="t5"),
            TestRef(test_id="tx2", project_id="p1", task_id="k18"),
            TestRef(test_id="tx3", project_id="p1", task_id="k18"),
            TestRef(test_id="tx4", project_id="p1", agenda_id="t5"),
            TestRef(test_id="tx5", project_id="p1", task_id="kx"),
            TestComment(
                test_id="tx1", author_id="u1", body="첫 조치", created_at=utc("2026-10-11T01:00:00")
            ),
            TestComment(
                test_id="tx1",
                author_id="u2",
                body="다" * 300,
                created_at=utc("2026-10-12T01:00:00"),
            ),
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    data = sent(fake)
    t5 = detail(data, "t5")

    assert [t["id"] for t in t5["tasks"]] == ["k18"]
    tests = {t["id"]: t for t in t5["tests"]}
    assert list(tests) == ["tx1", "tx2", "tx4"]
    assert {key: tests["tx1"][key] for key in ("key", "status", "via")} == {
        "key": "HW-T101",
        "status": "fail",
        "via": ["안건"],
    }
    action = tests["tx1"]["latestAction"]
    assert action["author"] == "박지훈" and action["date"] == "2026-10-12"
    assert len(action["body"]) == 200 and action["body"].endswith("…")
    assert tests["tx2"]["via"] == ["HW-18"] and tests["tx2"]["latestAction"] is None
    assert tests["tx4"]["status"] == "pass" and "basisChanged" in tests["tx4"]["signals"]
    raw = json.dumps(data, ensure_ascii=False)
    assert "지운 작업" not in raw and "HW-900" not in raw and "tx5" not in raw


async def test_tests_stop_at_five(client: httpx.AsyncClient, session: AsyncSession) -> None:
    session.add_all([_test(n, "fail") for n in range(7)])
    await session.flush()
    session.add_all([TestRef(test_id=f"tx{n}", project_id="p1", agenda_id="t5") for n in range(7)])
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    assert [t["id"] for t in detail(sent(fake), "t5")["tests"]] == [f"tx{n}" for n in range(5)]


async def test_owner_load_counts_agendas_and_tasks(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """t5 담당 정하늘(u4) — 안 정해진 안건 · 그중 기한 넘김은 보고서의 셈, 작업은 진행 중 · 막힘."""
    session.add_all(
        [
            Task(
                id=f"ky{n}",
                project_id="p1",
                key=f"HW-90{n}",
                title=f"부담 작업 {n}",
                status=status,
                owner_id="u4",
                created_at=utc("2026-10-01T01:00:00"),
                is_deleted=n == 2,
            )
            for n, status in enumerate(("doing", "doing", "doing", "todo"))
        ]
    )
    await session.commit()
    before = await session.scalars(
        select(Task.status).where(
            Task.project_id == "p1",
            Task.owner_id == "u4",
            Task.is_deleted.is_(False),
            Task.status.in_(("doing", "blocked")),
        )
    )
    statuses = list(before.all())
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    data = sent(fake)
    owner = next(o for o in data["report"]["owners"] if o["member"] == "정하늘")
    assert detail(data, "t5")["ownerLoad"] == {
        "member": "정하늘",
        "openAgendas": owner["openAgendas"],
        "overdueAgendas": owner["overdueAgendas"],
        "doingTasks": statuses.count("doing"),
        "blockedTasks": statuses.count("blocked"),
    }
    assert statuses.count("doing") >= 2 and statuses.count("blocked") >= 1


async def test_one_call_without_tools_on_chat_settings(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, ALL)
    (call,) = fake.calls
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.chat_max_tokens
    assert call["output_config"] == {"effort": settings.chat_effort}
    assert call["betas"] == [FALLBACK_BETA]
    assert "tools" not in call and "tool_choice" not in call and "thinking" not in call
    assert "한화손보 차세대" in call["system"] and "2026-10-15 (목)" in call["system"]
    # 계약의 '답의 모양' 머리글 · 대응표가 프롬프트에 있다
    heads = (
        "먼저 손쓸 것",
        "흔들리는 일",
        "지난 분석 대비",
        "noDueDate 기한 없음",
        "flaky 결과 뒤집힘",
        "contentChurn 내용 자주 바뀜",
        "[[task:ID]]",
        "900자",
    )
    assert all(line in call["system"] for line in heads)
    # 넓힌 근거(2026-11-06)를 설명하고 쓰라고 한다
    for field in (
        "dueDateChanges",
        "dueDateFlow",
        "ownerChanges",
        "stateFlow",
        "meetings",
        "checklist",
        "statusDays",
        "recentComments",
        "latestAction",
        "ownerLoad",
        "[[test:ID]]",
        "조치 내역",
        # 작업 · 테스트 리스크 (risk-dashboard.md)
        "report.tasks",
        "report.tests",
        "taskDetails",
        "testDetails",
        "statusFlow",
        "churnDays",
    ):
        assert field in call["system"], field
    # '안건과 어긋난 작업' 을 걷었다(2026-11-05)
    for gone in ("바로 풀 수 있는 것", "decidedButBlocked", "dueBeforeDecision"):
        assert gone not in call["system"]


# --- 스트림 ---------------------------------------------------------------------------


async def test_refs_only_for_ids_that_were_given(client: httpx.AsyncClient) -> None:
    """근거 칩은 넣어 준 id 만 — 지어낸 id(t10) · 넣지 않은 작업(k22)은 칩이 안 된다."""
    text = (
        "먼저 정할 것\n1. [[agenda:t5]] — [[task:k18]] 이 막힘 "
        "[[agenda:t10]] [[task:k22]] [[agenda:t5]]"
    )
    use(FakeClient(Turn(texts=[text[:20], text[20:]])))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[-1][1]["refs"] == [
        {"kind": "agenda", "id": "t5"},
        {"kind": "task", "id": "k18"},
    ]


async def test_test_refs_only_for_tests_that_were_given(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    """[[test:ID]] 도 칩이 된다 — 넣어 준 테스트(실패 tx1)만.

    넣지 않은 것(통과 tx3 · 닿지 않는 시드 tc7)은 칩이 안 된다.
    """
    session.add_all([_test(1, "fail"), _test(3, "pass")])
    await session.flush()
    session.add_all(
        [
            TestRef(test_id="tx1", project_id="p1", agenda_id="t5"),
            TestRef(test_id="tx3", project_id="p1", agenda_id="t5"),
        ]
    )
    await session.commit()
    text = "1. [[agenda:t5]] — 연결 테스트 실패 [[test:tx1]] [[test:tx3]] [[test:tc7]]"
    use(FakeClient(Turn(texts=[text])))
    events = await post(client, ALL)
    assert events[-1][1]["refs"] == [
        {"kind": "agenda", "id": "t5"},
        {"kind": "test", "id": "tx1"},
    ]


async def test_claude_rate_limit_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = RateLimitError("rl", response=httpx2.Response(429, request=request), body=None)
    use(FakeClient(Turn(raises=error)))
    res = await client.post(URL, json=ALL)
    assert res.status_code == 200
    events = parse_sse(res.text)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_RATE_LIMITED")]


async def test_claude_unreachable_after_stream_opens(client: httpx.AsyncClient) -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    use(FakeClient(Turn(raises=APIConnectionError(request=request))))
    events = await post(client, ALL)
    assert [(name, data["code"]) for name, data in events] == [("error", "CHAT_UNAVAILABLE")]


async def test_refusal_is_an_error_without_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["그건"], stop_reason="refusal")))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "error"]
    assert events[-1][1]["code"] == "CHAT_REFUSED"


async def test_max_tokens_ends_with_a_note_and_done(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["길게 "], stop_reason="max_tokens")))
    events = await post(client, ALL)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[1][1]["text"] == chat_service.TRUNCATED


# --- 경계 -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"taskIds": []},
        {},
        {"agendaIds": "t5"},
        {"agendaIds": [f"t{n}" for n in range(101)]},
        {"agendaIds": [], "taskIds": [f"k{n}" for n in range(101)]},
        {"agendaIds": [], "testIds": [f"tc{n}" for n in range(101)]},
        {"agendaIds": [], "taskIds": "k21"},
    ],
)
async def test_bad_input_is_422(client: httpx.AsyncClient, body: dict[str, Any]) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    res = await client.post(URL, json=body)
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    assert fake.calls == []


async def test_hundred_is_fine(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    body = {"agendaIds": ["t5"] * 100}
    assert (await client.post(URL, json=body)).status_code == 200


async def test_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    res = await client.post("/api/projects/nope/risks/summary", json=ALL)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"


async def test_ungranted_member_is_404(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    u9 = await as_member("u9")
    res = await u9.post(URL, json=ALL)
    assert res.status_code == 404 and res.json()["code"] == "PROJECT_NOT_FOUND"
    assert fake.calls == []


async def test_any_member_summarizes(as_member: AsMember) -> None:
    use(FakeClient(Turn(texts=["요약"])))
    u2 = await as_member("u2")
    assert (await u2.post(URL, json=ALL)).status_code == 200


async def test_no_key_is_503(client: httpx.AsyncClient) -> None:
    use(None)
    res = await client.post(URL, json=ALL)
    assert res.status_code == 503
    assert res.headers["content-type"].startswith("application/json")
    assert res.json()["code"] == "CHAT_UNAVAILABLE"
    # 리스크 표는 그대로 읽힌다
    assert (await client.get("/api/projects/p1/risks")).status_code == 200


async def test_shares_the_chat_rate_limit(client: httpx.AsyncClient) -> None:
    """챗봇과 같은 제한기 — 질문 하나를 쓰면 같은 분에 요약은 429 다."""
    use(FakeClient(Turn(texts=["답"])))
    limiter = RateLimiter(1)
    app.dependency_overrides[chat_api.get_rate_limiter] = lambda: limiter
    ask = {"messages": [{"role": "user", "text": "뭐부터 정해야 해?"}]}
    assert (await client.post("/api/projects/p1/chat", json=ask)).status_code == 200
    res = await client.post(URL, json=ALL)
    assert res.status_code == 429 and res.json()["code"] == "CHAT_RATE_LIMITED"


def test_nothing_text_matches_the_contract() -> None:
    assert risk_summary.NOTHING == "지금 짚을 리스크가 없습니다."


# --- 작업 · 테스트 리스크의 근거 (risk-dashboard.md 'AI 리스크 분석') -----------------------

WORK = {
    "agendaIds": [],
    "taskIds": ["k3", "k20", "k4", "k21", "k9", "k1", "k7", "k22"],
    "testIds": ["tc3", "tc4", "tc6", "tc7", "tc2"],
}


async def test_work_details_top_six_each(client: httpx.AsyncClient) -> None:
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, WORK)
    data = sent(fake)
    ranked = [t["id"] for t in data["report"]["tasks"]]
    assert len(ranked) == 8
    assert [d["id"] for d in data["taskDetails"]] == ranked[:6]
    # 테스트는 다섯이라 다 싣는다
    assert [d["id"] for d in data["testDetails"]] == ["tc3", "tc4", "tc6", "tc7", "tc2"]


async def test_task_detail_fields(client: httpx.AsyncClient, session: AsyncSession) -> None:
    session.add_all(
        [
            TaskComment(
                task_id="k21",
                author_id="u1",
                body=f"댓글 {n} " + "가" * 300,
                created_at=utc(f"2026-10-1{n}T01:00:00"),
            )
            for n in range(4)
        ]
    )
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, {"agendaIds": [], "taskIds": ["k21", "k3", "k22", "k13"]})
    details = {d["id"]: d for d in sent(fake)["taskDetails"]}
    k21 = details["k21"]
    assert set(k21) == {
        "id", "key", "title", "checklist", "recentComments", "dueFlow", "recentChanges",
        "openAgendas",
    }  # fmt: skip
    assert k21["dueFlow"] == ["2026-09-13", "2026-09-14", "2026-09-15"]
    # 최근 셋 · 오래된 것부터 · 200자
    assert [c["body"][:4] for c in k21["recentComments"]] == ["댓글 1", "댓글 2", "댓글 3"]
    assert all(len(c["body"]) == 200 for c in k21["recentComments"])
    # 기한 미룸은 9월이라 최근 14일 창 밖이다
    assert k21["recentChanges"] == {}
    assert details["k3"]["recentChanges"] == {"담당자": 2}
    assert details["k22"]["recentChanges"] == {"제목": 3, "본문": 2}
    # 걸린 안 정해진 안건은 제목으로
    assert details["k3"]["openAgendas"] == ["공통 코드 체계 확정"]
    assert details["k13"]["openAgendas"] == ["AI 심사 학습 데이터 범위"]


async def test_test_detail_fields(client: httpx.AsyncClient, session: AsyncSession) -> None:
    session.add_all(
        [
            TestComment(
                test_id="tc2", author_id="u2", body=f"조치 {n}",
                created_at=utc(f"2026-10-1{n}T01:00:00"),
            )
            for n in range(3)
        ]
    )  # fmt: skip
    await session.commit()
    fake = FakeClient(Turn(texts=["요약"]))
    use(fake)
    await post(client, {"agendaIds": [], "testIds": ["tc2", "tc3", "tc6"]})
    details = {d["id"]: d for d in sent(fake)["testDetails"]}
    tc2 = details["tc2"]
    assert set(tc2) == {
        "id", "key", "title", "recentActions", "statusFlow", "taggedTasks", "taggedAgendas",
    }  # fmt: skip
    # 최근 둘 · 오래된 것부터
    assert [c["body"] for c in tc2["recentActions"]] == ["조치 1", "조치 2"]
    assert tc2["statusFlow"] == ["draft", "testing", "pass", "fail", "pass"]
    assert tc2["taggedTasks"] == [{"key": "HW-4", "title": "개발 환경 설정"}]
    assert details["tc3"]["taggedAgendas"] == ["사내망에서 외부 모델 호출 허용 범위"]
    # 상태가 최근에 안 바뀌었으면 지금 상태 하나
    assert details["tc6"]["statusFlow"] == ["blocked"]


async def test_refs_cover_task_and_test_rows(client: httpx.AsyncClient) -> None:
    """작업 · 테스트 리스크 줄은 위쪽 여섯이 아니어도 칩이 된다 — 보내지 않은 줄은 안 된다."""
    text = "[[task:k22]] [[test:tc2]] [[task:k21]] [[test:tc7]] [[task:k9]]"
    use(FakeClient(Turn(texts=[text])))
    events = await post(client, {"agendaIds": [], "taskIds": ["k22", "k21"], "testIds": ["tc2"]})
    assert events[-1][1]["refs"] == [
        {"kind": "task", "id": "k22"},
        {"kind": "test", "id": "tc2"},
        {"kind": "task", "id": "k21"},
    ]

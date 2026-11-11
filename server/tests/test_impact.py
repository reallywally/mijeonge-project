"""AI 영향도 분석 — `docs/api/impact.md`. LLM 은 부르지 않는다(가짜 Claude 클라이언트).

시드의 t2(DB 결정)를 쓴다 — 연결 작업 k4 · k22, 닿는 테스트 tc2(k4 태그) · tc4(t2 태그),
같은 프로젝트의 다른 결정 안건 t1 · t6.
"""

import json
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import chat as chat_api
from app.config import settings
from app.models import Agenda, AgendaImpact, TaskHistory, TaskLine, TestCase, TestHistory
from app.services import impact as impact_service
from app.services import test as test_service
from tests.conftest import AsMember, decide
from tests.test_chat import FakeClient, Turn, parse_sse, tool_results, use

STATE = "/api/agendas/t2/impact"
OLD_DECISION = (
    "mysql 을 쓴다\n"
    "- postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다\n"
    "- supabase 는 비용 때문에 뺀다"
)
NEW_DECISION = "postgresql 을 쓴다\n- 호환성 이슈는 어댑터로 푼다"

# k4 본문(시드 ENV_BODY) — 셋째 줄만 고친 안
K4_BODY = [
    {"kind": "check", "text": "서버 신청서 제출", "done": True, "level": 0},
    {"kind": "check", "text": "우분투 최신 버전 설치", "done": True, "level": 0},
    {"kind": "check", "text": "postgresql 설치와 계정 발급", "done": False, "level": 0},
    {"kind": "check", "text": "개발자 접속 계정 4개 만들기", "done": False, "level": 0},
    {
        "kind": "bullet",
        "text": "방화벽은 정보보안팀에 따로 신청해야 한다 (사내 포털 > 보안)",
        "done": False,
        "level": 1,
    },
    {
        "kind": "bullet",
        "text": "백업 정책은 기간계와 같은 주기로 맞추기로 했다",
        "done": False,
        "level": 1,
    },
    {"kind": "check", "text": "CI 러너 붙이기", "done": False, "level": 0},
]
TC4_CONTENT = "목적\n정해 둔 주기가 지난 계정은 비밀번호를 바꾸게 하는지 본다. (postgresql)"

PROPOSED: dict[str, Any] = {
    "summary": "  DB 를 mysql 에서 postgresql 로 바꿨다. 설치 작업과 테스트를 보면 된다.  ",
    "tasks": [
        {
            "task_id": "k4",
            "verdict": "update",
            "reason": " mysql 설치 줄이 이제 틀렸다. ",
            "title": None,
            "body": K4_BODY,
        }
    ],
    "tests": [
        {"test_id": "tc2", "verdict": "ok", "reason": "DB 와 상관없다."},
        {
            "test_id": "tc4",
            "verdict": "update",
            "reason": "결정 후 DB 로 본다.",
            "content": TC4_CONTENT,
            "title": None,
            "test_data": None,
        },
    ],
    "conflicts": [{"agenda_id": "t1", "verdict": "check", "reason": "OS 와 DB 버전 확인."}],
}


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    chat_api.get_rate_limiter().reset()


async def change_decision(client: httpx.AsyncClient, text: str = NEW_DECISION) -> None:
    res = await decide(client, "t2", text)
    assert res.status_code == 200, res.text


async def analyze(
    client: httpx.AsyncClient, *turns: Turn, url: str = STATE
) -> tuple[FakeClient, list[tuple[str, dict[str, Any]]]]:
    fake = FakeClient(*turns)
    use(fake)
    res = await client.post(url)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return fake, parse_sse(res.text)


async def analyzed(client: httpx.AsyncClient) -> dict[str, Any]:
    """결정을 바꾸고 분석까지 — 남은 분석."""
    await change_decision(client)
    _, events = await analyze(client, Turn(tools=[("propose_impact", PROPOSED)]))
    impact: dict[str, Any] = events[-2][1]["impact"]
    return impact


def apply_body(**extra: Any) -> dict[str, Any]:
    return {
        "tasks": [{"taskId": "k4", "body": K4_BODY}],
        "tests": [{"testId": "tc4", "content": TC4_CONTENT}],
    } | extra


async def count(session: AsyncSession, model: type[Any]) -> int:
    return (await session.scalar(select(func.count()).select_from(model))) or 0


# --- 칸 그리기 ---------------------------------------------------------------


async def test_state_counts_without_ai(client: httpx.AsyncClient) -> None:
    res = await client.get(STATE)
    assert res.status_code == 200, res.text
    assert res.json() == {
        "latest": None,
        "taskCount": 2,
        "testCount": 2,
        "decidedAgendaCount": 2,
    }


async def test_state_skips_deleted_and_empty(client: httpx.AsyncClient) -> None:
    """지운 작업은 세지 않는다 — 그 작업으로만 닿던 테스트도. 결정내용이 빈 결정 안건도 뺀다."""
    assert (await client.delete("/api/tasks/k22")).status_code == 204
    assert (await client.patch("/api/agendas/t6", json={"decision": "  "})).status_code == 200
    body = (await client.get(STATE)).json()
    assert (body["taskCount"], body["testCount"], body["decidedAgendaCount"]) == (1, 2, 1)


# --- 분석 스트림 -------------------------------------------------------------


async def test_analysis_events_and_saved_shape(client: httpx.AsyncClient) -> None:
    await change_decision(client)
    fake, events = await analyze(client, Turn(tools=[("propose_impact", PROPOSED)]))

    assert [name for name, _ in events] == ["tool", "tool", "tool", "impact", "done"]
    assert all(data["type"] == name for name, data in events)
    assert [(d["name"], d["label"]) for _, d in events[:3]] == [
        ("read_tasks", "연결 작업 읽는 중"),
        ("compare_decisions", "다른 결정 비교 중"),
        ("propose_impact", "고칠 안 만드는 중"),
    ]
    impact = events[3][1]["impact"]
    assert set(impact) == {
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
    }
    assert impact["projectId"] == "p1" and impact["agendaId"] == "t2"
    assert impact["decisionRev"] == 2
    assert impact["decisionBefore"] == OLD_DECISION
    assert impact["decisionAfter"] == NEW_DECISION
    assert (
        impact["summary"]
        == "DB 를 mysql 에서 postgresql 로 바꿨다. 설치 작업과 테스트를 보면 된다."
    )
    assert impact["createdBy"] == "admin"
    assert impact["createdAt"].endswith("Z")

    # 작업 seq 순 · 판정이 빠진 k22 는 ok · '판정 없음'. 고친 안이 없는 칸은 키째 없다
    k4, k22 = impact["tasks"]
    assert set(k4) == {
        "taskId",
        "verdict",
        "reason",
        "body",
        "before",
        "appliedAt",
        "linked",
        "linkedOnApply",
    }
    assert k4["reason"] == "mysql 설치 줄이 이제 틀렸다."
    assert k4["body"] == K4_BODY and k4["appliedAt"] is None
    assert k4["before"]["title"] == "개발 환경 설정"
    assert k4["before"]["body"][2]["text"] == "mysql 설치와 계정 발급"
    assert k22 == {
        "taskId": "k22",
        "verdict": "ok",
        "reason": "판정 없음",
        "before": {"title": "스테이징 DB 구성", "body": []},
        "appliedAt": None,
        "linked": True,
        "linkedOnApply": False,
    }
    tc2, tc4 = impact["tests"]
    row_keys = {"testId", "verdict", "reason", "before", "appliedAt", "linked", "linkedOnApply"}
    assert set(tc2) == row_keys
    assert set(tc4) == row_keys | {"content"}
    assert set(tc4["before"]) == {"title", "content", "testData"}
    assert impact["conflicts"] == [
        {
            "agendaId": "t1",
            "verdict": "check",
            "reason": "OS 와 DB 버전 확인.",
            "decision": "우분투 최신 버전으로 한다",
        }
    ]

    # 늘 남는다 — 칸을 다시 그리면 가장 최근 것
    state = (await client.get(STATE)).json()
    assert state["latest"] == impact

    # Claude 에 간 것 — 읽기 도구 넷 + 내기 · 설정의 상한 · 결정 전 · 후 · 근거
    (call,) = fake.calls
    assert [tool["name"] for tool in call["tools"]] == [
        "search_tasks",
        "search_tests",
        "get_task",
        "get_test",
        "propose_impact",
    ]
    assert call["model"] == settings.chat_model
    assert call["max_tokens"] == settings.impact_max_tokens
    assert "'한화손보 차세대'" in call["system"]
    text = call["messages"][0]["content"][0]["text"]
    sent = json.loads(text.split("\n\n", 1)[1])
    assert sent["agenda"]["decision_before"] == OLD_DECISION
    assert sent["agenda"]["decision_after"] == NEW_DECISION
    assert [t["id"] for t in sent["tasks"]] == ["k4", "k22"]
    assert [t["id"] for t in sent["tests"]] == ["tc2", "tc4"]
    assert [a["id"] for a in sent["decided_agendas"]] == ["t6", "t1"]


async def test_first_decision_has_no_before(client: httpx.AsyncClient) -> None:
    """시드의 결정 줄은 '' → 결정(이행) — 처음 결정이라 전은 null."""
    _, events = await analyze(client, Turn(tools=[("propose_impact", PROPOSED)]))
    impact = events[-2][1]["impact"]
    assert impact["decisionBefore"] is None and impact["decisionRev"] == 1


async def test_bad_proposal_goes_back_then_fixed(client: httpx.AsyncClient) -> None:
    bad = json.loads(json.dumps(PROPOSED))
    bad["tasks"] = [
        {"task_id": "k18", "verdict": "ok", "reason": "다른 안건 작업"},
        {"task_id": "k4", "verdict": "update", "reason": "  "},
        {"task_id": "k22", "verdict": "check", "reason": "봐야 한다", "title": "고침"},
    ]
    bad["tests"][1]["content"] = None
    bad["conflicts"].append({"agenda_id": "t10", "verdict": "conflict", "reason": "남의 것"})
    await change_decision(client)
    fake, events = await analyze(
        client,
        Turn(tools=[("propose_impact", bad)]),
        Turn(tools=[("propose_impact", PROPOSED)]),
    )
    assert [name for name, _ in events] == ["tool", "tool", "tool", "tool", "impact", "done"]
    (result,) = tool_results(fake.calls[1])
    assert result["is_error"] is True
    problems = json.loads(result["content"])["problems"]
    assert problems == {
        "tasks.0.taskId": "넣어 준 연결 작업도, 도구가 돌려준 작업도 아닙니다.",
        "tasks.1.reason": "근거를 적어 주세요.",
        "tasks.1": "고칠 칸(title · body)이 하나도 없습니다.",
        "tasks.2": "update 가 아니면 고칠 칸을 보내지 않습니다.",
        "tests.1": "고칠 칸(title · content · testData)이 하나도 없습니다.",
        "conflicts.1.agendaId": "넣어 준 다른 결정 안건이 아닙니다.",
    }


async def test_unchanged_fix_is_sent_back(client: httpx.AsyncClient) -> None:
    same = json.loads(json.dumps(PROPOSED))
    same["tasks"][0]["title"] = "개발 환경 설정"
    same["tasks"][0]["body"][0]["level"] = 4
    await change_decision(client)
    fake, _ = await analyze(
        client,
        Turn(tools=[("propose_impact", same)]),
        Turn(tools=[("propose_impact", PROPOSED)]),
    )
    problems = json.loads(tool_results(fake.calls[1])[0]["content"])["problems"]
    assert set(problems) == {"tasks.0.title", "tasks.0.body.0.level"}


async def test_gives_up_after_three_failures(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    bad = PROPOSED | {"summary": " "}
    await change_decision(client)
    fake, events = await analyze(client, Turn(tools=[("propose_impact", bad)]))
    assert len(fake.calls) == impact_service.MAX_FAILURES == 3
    assert [name for name, _ in events] == ["tool"] * 5 + ["error"]
    assert events[-1][1]["code"] == "IMPACT_FAILED"
    assert await count(session, AgendaImpact) == 0


async def test_text_answer_is_nudged(client: httpx.AsyncClient) -> None:
    await change_decision(client)
    fake, events = await analyze(
        client, Turn(texts=["잘 모르겠습니다."]), Turn(tools=[("propose_impact", PROPOSED)])
    )
    assert events[-1][0] == "done"
    assert fake.calls[1]["messages"][-1] == {"role": "user", "content": impact_service.NUDGE}


async def test_refusal_is_chat_refused(client: httpx.AsyncClient, session: AsyncSession) -> None:
    await change_decision(client)
    _, events = await analyze(client, Turn(texts=["안 됩니다"], stop_reason="refusal"))
    assert events[-1][1]["code"] == "CHAT_REFUSED"
    assert await count(session, AgendaImpact) == 0


async def test_nothing_to_look_at_skips_claude(client: httpx.AsyncClient) -> None:
    """p2 의 t10 — 연결 작업 · 테스트 · 다른 결정 안건이 없다."""
    assert (await decide(client, "t10", "전부 옮긴다")).status_code == 200
    fake, events = await analyze(client, url="/api/agendas/t10/impact")
    assert fake.calls == []
    assert [name for name, _ in events] == ["impact", "done"]
    impact = events[0][1]["impact"]
    assert impact["summary"] == "살펴볼 연결 작업 · 테스트 · 다른 결정이 없습니다."
    assert (impact["tasks"], impact["tests"], impact["conflicts"]) == ([], [], [])
    assert (await client.get("/api/agendas/t10/impact")).json()["latest"]["id"] == impact["id"]


async def test_no_decision_is_409(client: httpx.AsyncClient) -> None:
    """t4 는 결정내용이 비었다 — 키가 없어도(503 보다 먼저) 409."""
    res = await client.post("/api/agendas/t4/impact")
    assert res.status_code == 409
    assert res.json()["code"] == "IMPACT_NO_DECISION"


async def test_analysis_without_key_is_503(client: httpx.AsyncClient) -> None:
    res = await client.post(STATE)
    assert res.status_code == 503 and res.json()["code"] == "CHAT_UNAVAILABLE"


# --- 반영 --------------------------------------------------------------------


async def test_apply_patches_like_the_normal_edit(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    impact = await analyzed(client)
    before = (await client.get("/api/tests/tc4")).json()
    assert before["changedAgendaIds"] == ["t2"]
    ids_before = list(
        await session.scalars(
            select(TaskLine.id).where(TaskLine.task_id == "k4").order_by(TaskLine.sort_order)
        )
    )

    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"tasks", "tests", "links", "impact"}
    assert body["links"] == []
    (task,) = body["tasks"]
    assert [line["text"] for line in task["body"]][2] == "postgresql 설치와 계정 발급"
    # 같은 자리의 줄 id 는 그대로 — 편집 중인 화면이 흔들리지 않게
    assert [line["id"] for line in task["body"]] == ids_before
    (test,) = body["tests"]
    assert test["content"] == TC4_CONTENT
    # 테스트 PATCH 처럼 기준을 다시 찍는다 — '기준 바뀜' 이 풀린다
    assert test["changedAgendaIds"] == []
    assert "basisChanged" not in test["signals"]

    # 일반 수정과 같은 변경 이력
    task_line = await session.scalar(
        select(TaskHistory).where(TaskHistory.task_id == "k4").order_by(TaskHistory.seq.desc())
    )
    assert task_line is not None and task_line.changed_by == "admin"
    assert [c["field"] for c in task_line.changes] == ["body"]
    test_line = await session.scalar(
        select(TestHistory).where(TestHistory.test_id == "tc4").order_by(TestHistory.seq.desc())
    )
    assert test_line is not None and [c["field"] for c in test_line.changes] == ["content"]

    applied = body["impact"]
    assert applied["tasks"][0]["appliedAt"] is not None
    assert applied["tests"][1]["appliedAt"] is not None
    # 반영 안 한 줄은 그대로
    assert applied["tasks"][1]["appliedAt"] is None
    assert (await client.get(STATE)).json()["latest"] == applied

    # 두 번 반영하지 않는다 — 이미 바뀌어 before 와 다르다
    again = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert again.status_code == 409
    assert again.json()["code"] == "IMPACT_TARGET_CHANGED"
    assert set(again.json()["detail"]) == {"tasks.0", "tests.0"}


async def test_apply_takes_hand_edited_values(client: httpx.AsyncClient) -> None:
    impact = await analyzed(client)
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={"tasks": [{"taskId": "k4", "title": "  개발 환경 설정 (postgresql)  "}]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["tasks"][0]["title"] == "개발 환경 설정 (postgresql)"
    row = res.json()["impact"]["tasks"][0]
    # 반영한 값이 남는다 — 보내지 않은 칸은 빠진다
    assert row["title"] == "개발 환경 설정 (postgresql)" and "body" not in row


async def test_apply_stale_after_decision_changed_again(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    impact = await analyzed(client)
    await change_decision(client, "sqlite 를 쓴다")
    history = await count(session, TaskHistory)
    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 409
    assert res.json()["code"] == "IMPACT_STALE"
    assert res.json()["message"] == "결정이 바뀌어 다시 분석해야 합니다."
    assert await count(session, TaskHistory) == history


async def test_apply_target_changed_changes_nothing(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    impact = await analyzed(client)
    assert (await client.patch("/api/tasks/k4", json={"title": "개발 환경"})).status_code == 200
    test_history = await count(session, TestHistory)
    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 409
    assert res.json()["code"] == "IMPACT_TARGET_CHANGED"
    assert res.json()["detail"] == {"tasks.0": "분석 뒤에 바뀌었습니다."}
    # 한 트랜잭션 — 테스트도 안 바뀐다
    assert await count(session, TestHistory) == test_history
    tc4 = await session.get(TestCase, "tc4")
    assert tc4 is not None and tc4.content != TC4_CONTENT


async def test_apply_deleted_target_is_changed(client: httpx.AsyncClient) -> None:
    impact = await analyzed(client)
    assert (await client.delete("/api/tests/tc4")).status_code == 204
    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 409
    assert res.json()["detail"] == {"tests.0": "분석 뒤에 지워졌습니다."}


async def test_apply_needs_task_edit_right(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """k4 는 u3 담당 · u2 등록 — u4 는 못 고친다. 테스트는 멤버 누구나."""
    impact = await analyzed(client)
    u4 = await as_member("u4")
    url = f"/api/agenda-impacts/{impact['id']}/apply"
    res = await u4.post(url, json=apply_body())
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    assert res.json()["detail"] == {"tasks.0": "이 작업을 고칠 권한이 없습니다."}
    only_test = await u4.post(url, json=apply_body(tasks=[]))
    assert only_test.status_code == 200, only_test.text
    # 담당자는 고친다
    u3 = await as_member("u3")
    assert (await u3.post(url, json=apply_body(tests=[]))).status_code == 200


@pytest.mark.parametrize(
    ("payload", "detail"),
    [
        ({"tasks": [], "tests": []}, {"tasks": "반영할 줄이 없습니다."}),
        (
            {"tasks": [{"taskId": "k22", "title": "가"}]},
            {"tasks.0.taskId": "이 분석의 고칠 작업이 아닙니다."},
        ),
        (
            {"tests": [{"testId": "tc2", "content": "가"}]},
            {"tests.0.testId": "이 분석의 고칠 테스트가 아닙니다."},
        ),
        (
            {"tasks": [{"taskId": "k4", "body": K4_BODY}, {"taskId": "k4", "body": K4_BODY}]},
            {"tasks.1.taskId": "같은 작업이 두 번 있습니다."},
        ),
        ({"tasks": [{"taskId": "k4"}]}, {"tasks.0": "고칠 칸(title · body)이 하나도 없습니다."}),
        ({"tasks": [{"taskId": "k4", "title": "  "}]}, {"tasks.0.title": "제목을 입력해 주세요."}),
        (
            {"tasks": [{"taskId": "k4", "body": [K4_BODY[0] | {"level": 4}]}]},
            {"tasks.0.body.0.level": "들여쓰기는 0 ~ 3 입니다."},
        ),
        (
            {"tests": [{"testId": "tc4", "title": "가" * 201}]},
            {"tests.0.title": "제목은 200자까지입니다."},
        ),
        (
            {"tests": [{"testId": "tc4", "testData": "가" * 4001}]},
            {"tests.0.testData": "4000자까지입니다."},
        ),
    ],
)
async def test_apply_validation(
    client: httpx.AsyncClient, payload: dict[str, Any], detail: dict[str, str]
) -> None:
    impact = await analyzed(client)
    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=payload)
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_ERROR"
    assert res.json()["detail"] == detail


async def test_unknown_or_deleted_impact_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/agenda-impacts/none/apply", json=apply_body())
    assert res.status_code == 404 and res.json()["code"] == "IMPACT_NOT_FOUND"

    impact = await analyzed(client)
    assert (await client.delete("/api/agendas/t2")).status_code == 204
    res = await client.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 404 and res.json()["code"] == "IMPACT_NOT_FOUND"
    res = await client.get(STATE)
    assert res.status_code == 404 and res.json()["code"] == "AGENDA_NOT_FOUND"


async def test_ungranted_project_is_404(client: httpx.AsyncClient, as_member: AsMember) -> None:
    impact = await analyzed(client)
    assert (await client.delete("/api/projects/p1/members/u1")).status_code == 204
    u1 = await as_member("u1")
    for method, url in (("GET", STATE), ("POST", STATE)):
        res = await u1.request(method, url)
        assert res.status_code == 404 and res.json()["code"] == "AGENDA_NOT_FOUND"
    res = await u1.post(f"/api/agenda-impacts/{impact['id']}/apply", json=apply_body())
    assert res.status_code == 404 and res.json()["code"] == "IMPACT_NOT_FOUND"


async def test_impact_needs_login(anon: httpx.AsyncClient) -> None:
    assert (await anon.get(STATE)).status_code == 401
    assert (await anon.post("/api/agenda-impacts/x/apply", json=apply_body())).status_code == 401


# --- 숨은 영향 — 연결 안 된 작업 · 테스트 (impact.md '2026-11-10 고침') --------

T1 = "/api/agendas/t1/impact"
ROCKY = "록키 리눅스 9 로 한다"
HIDDEN_BODY = [
    {"kind": "check", "text": "OS 를 우분투로 설치한다", "done": False, "level": 0},
    {"kind": "bullet", "text": "패키지 미러는 사내 것을 쓴다", "done": False, "level": 1},
]
ROCKY_BODY = [HIDDEN_BODY[0] | {"text": "OS 를 록키 리눅스 9 로 설치한다"}, HIDDEN_BODY[1]]
HIDDEN_CONTENT = "우분투 22.04 서버에 ssh 로 접속한다"
ROCKY_CONTENT = "록키 리눅스 9 서버에 ssh 로 접속한다"


async def hide(client: httpx.AsyncClient) -> tuple[dict[str, Any], dict[str, Any]]:
    """t1(서버 OS)에 연결 안 된 작업 · 테스트를 하나씩 두고 결정을 우분투 → 록키로 바꾼다."""
    task = await client.post(
        "/api/projects/p1/tasks", json={"title": "운영 서버 준비", "body": HIDDEN_BODY}
    )
    assert task.status_code == 201, task.text
    test = await client.post(
        "/api/projects/p1/tests", json={"title": "서버 접속 확인", "content": HIDDEN_CONTENT}
    )
    assert test.status_code == 201, test.text
    assert (await decide(client, "t1", ROCKY)).status_code == 200
    return task.json(), test.json()


async def test_candidates_found_without_search_tools(pg_client: httpx.AsyncClient) -> None:
    """모델이 검색 도구를 안 불러도 — 서버가 옛 값 · 제목 낱말로 미리 찾아 본문까지 넣어 준다.

    읽은 것으로 쳐 get_task 없이 본문 고친 안을 낼 수 있다 (impact.md '서버가 먼저 찾는 후보')."""
    task, test = await hide(pg_client)
    fake, events = await analyze(
        pg_client,
        Turn(tools=[("propose_impact", hidden_proposal(task["id"], test["id"]))]),
        url=T1,
    )
    assert events[-1][0] == "done", events
    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    payload = json.loads(text[text.index("{") :])
    candidates = payload["candidates"]
    assert "우분투" in candidates["terms"]
    # 시드의 k19(HW-19) 도 우분투로 설치한다고 적혀 있어 같이 걸린다 — 작업 번호 순
    assert [t["id"] for t in candidates["tasks"]] == ["k19", task["id"]]
    assert candidates["tasks"][1]["body"] == HIDDEN_BODY
    assert test["id"] in [t["id"] for t in candidates["tests"]]
    impact = events[-2][1]["impact"]
    (row,) = [t for t in impact["tasks"] if t["taskId"] == task["id"]]
    assert (row["verdict"], row["linked"]) == ("update", False)


def test_search_terms_put_old_values_first() -> None:
    """옛 결정 → 제목이 겹치는 다른 결정 안건의 결정 → 제목 → 그 안건들의 제목 → 새 결정.

    조사 · 흔한 낱말은 떼고, 대소문자만 다른 낱말은 하나로 친다."""
    other = Agenda(title="서버 OS", decision="우분투로 한다")
    unrelated = Agenda(title="DB 선택", decision="mysql 을 쓴다")
    assert impact_service.search_terms("server os", None, "록키", [other, unrelated]) == [
        "우분투",
        "server",
        "os",
        "서버",
        "록키",
    ]
    assert impact_service.search_terms("서버 OS", "우분투", "록키로 한다", []) == [
        "우분투",
        "서버",
        "OS",
        "록키",
    ]


def hidden_proposal(
    task_id: str, test_id: str, *, task: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "summary": "서버 OS 를 우분투에서 록키 리눅스 9 로 바꿨다.",
        "tasks": [
            task
            or {
                "task_id": task_id,
                "verdict": "update",
                "reason": "우분투로 설치하는 줄이 이제 틀렸다.",
                "body": ROCKY_BODY,
            }
        ],
        "tests": [
            {
                "test_id": test_id,
                "verdict": "update",
                "reason": "접속할 서버 OS 가 록키로 바뀌었다.",
                "content": ROCKY_CONTENT,
            }
        ],
        "conflicts": [],
    }


def read_both(task: dict[str, Any], test: dict[str, Any]) -> Turn:
    return Turn(
        tools=[("get_task", {"task_id": task["key"]}), ("get_test", {"test_id": test["key"]})]
    )


async def analyzed_hidden(
    client: httpx.AsyncClient, verdict_task: dict[str, Any] | None = None
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """get_* 로 읽고 낸 분석 — (분석, 작업, 테스트)."""
    task, test = await hide(client)
    _, events = await analyze(
        client,
        read_both(task, test),
        Turn(
            tools=[("propose_impact", hidden_proposal(task["id"], test["id"], task=verdict_task))]
        ),
        url=T1,
    )
    assert events[-1][0] == "done", events
    impact: dict[str, Any] = events[-2][1]["impact"]
    return impact, task, test


async def test_hidden_task_found_by_search(pg_client: httpx.AsyncClient) -> None:
    """우분투 → 록키 — 연결 안 된 작업 · 테스트를 검색으로 찾고 읽고 고친 안을 낸다."""
    task, test = await hide(pg_client)
    fake, events = await analyze(
        pg_client,
        Turn(tools=[("search_tasks", {"query": "우분투"}), ("search_tests", {"query": "우분투"})]),
        read_both(task, test),
        Turn(tools=[("propose_impact", hidden_proposal(task["id"], test["id"]))]),
        url=T1,
    )
    assert [(d["name"], d["label"]) for name, d in events if name == "tool"] == [
        ("read_tasks", "연결 작업 읽는 중"),
        ("compare_decisions", "다른 결정 비교 중"),
        # 서버가 미리 찾은 후보 — 한 줄
        ("search_tasks", "관련 작업 · 테스트 찾는 중"),
        ("search_tasks", "관련 작업 · 테스트 찾는 중"),
        ("search_tests", "관련 작업 · 테스트 찾는 중"),
        ("get_task", "관련 작업 · 테스트 읽는 중"),
        ("get_test", "관련 작업 · 테스트 읽는 중"),
        ("propose_impact", "고칠 안 만드는 중"),
    ]
    assert events[-1][0] == "done"

    # 검색 결과 — 이미 연결된 k4 는 linked true, 새 작업은 false
    searched_tasks, searched_tests = (json.loads(r["content"]) for r in tool_results(fake.calls[1]))
    by_id = {row["id"]: row for row in searched_tasks["tasks"]}
    assert by_id["k4"]["linked"] is True
    assert by_id[task["id"]] == {
        "id": task["id"],
        "key": task["key"],
        "title": "운영 서버 준비",
        "status": "todo",
        "ownerName": None,
        "linked": False,
        "matched": "body",
        "snippet": "OS 를 우분투로 설치한다",
    }
    (hit,) = [row for row in searched_tests["tests"] if row["id"] == test["id"]]
    assert (hit["linked"], hit["matched"]) == (False, "content")
    got_task, got_test = (json.loads(r["content"]) for r in tool_results(fake.calls[2]))
    assert set(got_task) == {
        "id",
        "key",
        "title",
        "status",
        "ownerName",
        "due",
        "linked",
        "body",
        "bodyCut",
    }
    assert got_task["body"] == HIDDEN_BODY and got_task["bodyCut"] is False
    assert set(got_test) == {
        "id",
        "key",
        "title",
        "status",
        "ownerName",
        "linked",
        "content",
        "contentCut",
        "testData",
        "testDataCut",
    }
    assert got_test["content"] == HIDDEN_CONTENT

    impact = events[-2][1]["impact"]
    # 넣어 준 연결 작업(k4)이 먼저, 찾은 것은 그 뒤
    assert [(t["taskId"], t["linked"]) for t in impact["tasks"]] == [
        ("k4", True),
        (task["id"], False),
    ]
    found = impact["tasks"][1]
    assert found["verdict"] == "update" and found["body"] == ROCKY_BODY
    assert found["before"] == {"title": "운영 서버 준비", "body": HIDDEN_BODY}
    assert found["linkedOnApply"] is False
    found_test = impact["tests"][-1]
    assert (found_test["testId"], found_test["linked"]) == (test["id"], False)
    assert found_test["before"]["content"] == HIDDEN_CONTENT


def _found_context() -> tuple[impact_service.ImpactContext, impact_service.Found]:
    """DB 없이 — 넣어 준 것은 k4 하나, 도구가 돌려준 것은 x1(검색만) · x2(get_task 로 읽음)."""

    def snap(task_id: str, seq: int, lines: int = 1) -> impact_service.TaskSnap:
        line = impact_service.ImpactLine(kind="check", text="우분투 설치")
        return impact_service.TaskSnap(
            id=task_id,
            seq=seq,
            key=f"HW-{seq}",
            title="서버 준비",
            status="todo",
            owner=None,
            due=None,
            lines=[line] * lines,
        )

    context = impact_service.ImpactContext(
        project_id="p1",
        project_name="한화손보 차세대",
        agenda_id="t1",
        title="서버 OS",
        description="",
        state="decided",
        owner="담당자 없음",
        decision_rev=2,
        before="우분투",
        after="록키",
        tasks=[snap("k4", 4)],
        linked_task_ids={"k4"},
    )
    found = impact_service.Found(
        tasks={"x1": snap("x1", 101), "x2": snap("x2", 102), "x3": snap("x3", 103, lines=61)},
        tests={
            "y1": impact_service.TestSnap(
                id="y1",
                seq=1,
                key="HW-T1",
                title="접속",
                status="draft",
                owner=None,
                content="우분투",
                test_data="",
            )
        },
        read_tasks={"x2", "x3"},
    )
    return context, found


def test_found_rows_are_checked() -> None:
    context, found = _found_context()
    rocky = [{"kind": "check", "text": "록키 설치", "done": False, "level": 0}]
    proposal = {
        "summary": "OS 를 바꿨다.",
        "tasks": [
            {"task_id": "zz", "verdict": "check", "reason": "지어낸 id"},
            {"task_id": "x1", "verdict": "update", "reason": "검색만 봤다", "body": rocky},
            {"task_id": "x2", "verdict": "ok", "reason": "상관없다"},
            {"task_id": "x3", "verdict": "update", "reason": "잘렸다", "body": rocky},
        ],
        "tests": [{"test_id": "y1", "verdict": "update", "reason": "옛 OS", "content": "록키"}],
        "conflicts": [],
    }
    checked = impact_service.check_proposal(context, proposal, found)
    assert checked.result is None
    assert json.loads(checked.content)["problems"] == {
        "tasks.0.taskId": "넣어 준 연결 작업도, 도구가 돌려준 작업도 아닙니다.",
        "tasks.1.body": "본문을 고치려면 get_task 로 먼저 읽어야 합니다.",
        "tasks.2.verdict": impact_service.FOUND_OK,
        "tasks.3.body": "본문이 잘려서 보였습니다 — 본문은 고칠 수 없습니다.",
        "tests.0.content": "내용 · 테스트 데이터를 고치려면 get_test 로 먼저 읽어야 합니다.",
    }

    # 제목만 고치는 것은 검색 결과로 된다 · 찾은 것은 넣어 준 것 뒤에 seq 순
    fine = {
        "summary": "OS 를 바꿨다.",
        "tasks": [
            {"task_id": "x2", "verdict": "update", "reason": "옛 OS", "body": rocky},
            {"task_id": "x1", "verdict": "update", "reason": "옛 OS", "title": "록키 서버 준비"},
        ],
        "tests": [{"test_id": "y1", "verdict": "check", "reason": "옛 OS 일 수 있다"}],
        "conflicts": [],
    }
    checked = impact_service.check_proposal(context, fine, found)
    assert checked.result is not None
    assert [(t.task_id, t.verdict, t.linked) for t in checked.result.tasks] == [
        ("k4", "ok", True),
        ("x1", "update", False),
        ("x2", "update", False),
    ]
    assert [(t.test_id, t.linked) for t in checked.result.tests] == [("y1", False)]


def test_found_rows_cap() -> None:
    context, found = _found_context()
    template = found.tasks["x1"]
    for n in range(impact_service.FOUND_MAX + 1):
        found.tasks[f"f{n}"] = impact_service.TaskSnap(**{**template.__dict__, "id": f"f{n}"})
    proposal = {
        "summary": "OS 를 바꿨다.",
        "tasks": [
            {"task_id": f"f{n}", "verdict": "check", "reason": "옛 OS"}
            for n in range(impact_service.FOUND_MAX + 1)
        ],
        "tests": [],
        "conflicts": [],
    }
    problems = json.loads(impact_service.check_proposal(context, proposal, found).content)
    assert problems["problems"] == {"tasks": "도구로 찾은 작업은 20개까지 냅니다."}


async def test_unknown_id_does_not_stop_the_analysis(client: httpx.AsyncClient) -> None:
    await change_decision(client)
    fake, events = await analyze(
        client,
        Turn(tools=[("get_task", {"task_id": "HW-999"}), ("get_test", {"test_id": "nope"})]),
        Turn(tools=[("propose_impact", PROPOSED)]),
    )
    assert events[-1][0] == "done"
    results = tool_results(fake.calls[1])
    assert [(r["is_error"], json.loads(r["content"])) for r in results] == [
        (True, {"error": "작업을 찾을 수 없습니다."}),
        (True, {"error": "테스트를 찾을 수 없습니다."}),
    ]


async def test_other_project_task_is_not_read(client: httpx.AsyncClient) -> None:
    """도구 안에서도 프로젝트로 먼저 거른다 — p2 의 작업 id 를 넣어도 못 읽는다."""
    other = await client.post("/api/projects/p2/tasks", json={"title": "남의 작업"})
    assert other.status_code == 201, other.text
    await change_decision(client)
    fake, _ = await analyze(
        client,
        Turn(tools=[("get_task", {"task_id": other.json()["id"]})]),
        Turn(tools=[("propose_impact", PROPOSED)]),
    )
    (result,) = tool_results(fake.calls[1])
    assert json.loads(result["content"]) == {"error": "작업을 찾을 수 없습니다."}


async def test_read_tools_have_a_ceiling(client: httpx.AsyncClient, session: AsyncSession) -> None:
    """읽기 12번 뒤에는 '더 찾을 수 없습니다'. 그것만 되풀이하는 차례는 고쳐 내기 기회를 먹는다."""
    await change_decision(client)
    fake, events = await analyze(client, Turn(tools=[("get_task", {"task_id": "k1"})]))
    reads = impact_service.READ_MAX
    assert len(fake.calls) == reads + impact_service.MAX_FAILURES
    assert [name for name, _ in events] == ["tool"] * (2 + reads) + ["error"]
    assert events[-1][1]["code"] == "IMPACT_FAILED"
    (capped,) = tool_results(fake.calls[reads + 1])
    assert json.loads(capped["content"]) == {"error": impact_service.READ_CAP_MESSAGE}
    assert await count(session, AgendaImpact) == 0


async def test_system_prompt_asks_to_search_old_values(client: httpx.AsyncClient) -> None:
    await change_decision(client)
    fake, _ = await analyze(client, Turn(tools=[("propose_impact", PROPOSED)]))
    system = fake.calls[0]["system"]
    assert "바뀌기 전 값" in system and "get_task · get_test 로 **먼저 읽는다**" in system
    assert "한글 · 영문 · 줄임말" in system and "어긋나게 적힌" in system


async def test_apply_links_found_rows(client: httpx.AsyncClient, session: AsyncSession) -> None:
    impact, task, test = await analyzed_hidden(client)
    assert (await client.get(T1)).json()["taskCount"] == 1
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={
            "tasks": [{"taskId": task["id"], "body": ROCKY_BODY, "link": True}],
            "tests": [{"testId": test["id"], "content": ROCKY_CONTENT, "link": True}],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["links"] == [{"taskId": task["id"], "agendaId": "t1"}]
    assert [line["text"] for line in body["tasks"][0]["body"]][0] == ROCKY_BODY[0]["text"]
    (tagged,) = body["tests"]
    assert tagged["content"] == ROCKY_CONTENT
    assert {"kind": "agenda", "id": "t1"} in tagged["refs"]

    # 일반 수정 · 링크 PUT · 태그 PUT 과 같은 변경 이력
    history = (
        await session.scalars(
            select(TaskHistory).where(TaskHistory.task_id == task["id"]).order_by(TaskHistory.seq)
        )
    ).all()
    assert [[c["field"] for c in h.changes] for h in history][-2:] == [["body"], ["agenda"]]
    test_history = (
        await session.scalars(
            select(TestHistory).where(TestHistory.test_id == test["id"]).order_by(TestHistory.seq)
        )
    ).all()
    assert [[c["field"] for c in h.changes] for h in test_history][-2:] == [
        ["content"],
        ["agendaRef"],
    ]

    rows = body["impact"]
    found_task = next(t for t in rows["tasks"] if t["taskId"] == task["id"])
    assert found_task["linked"] is False and found_task["linkedOnApply"] is True
    assert found_task["appliedAt"] is not None
    found_test = next(t for t in rows["tests"] if t["testId"] == test["id"])
    assert found_test["linkedOnApply"] is True
    # 다음 분석부터는 연결 작업 · 닿는 테스트로 본다
    state = (await client.get(T1)).json()
    assert (state["taskCount"], state["latest"]) == (2, rows)


async def test_apply_link_only_check_row(client: httpx.AsyncClient) -> None:
    check = {"task_id": "", "verdict": "check", "reason": "우분투 전제일 수 있다."}
    task, test = await hide(client)
    check["task_id"] = task["id"]
    _, events = await analyze(
        client,
        read_both(task, test),
        Turn(tools=[("propose_impact", hidden_proposal(task["id"], test["id"], task=check))]),
        url=T1,
    )
    impact = events[-2][1]["impact"]
    url = f"/api/agenda-impacts/{impact['id']}/apply"

    fixed = await client.post(
        url, json={"tasks": [{"taskId": task["id"], "title": "가", "link": True}]}
    )
    assert fixed.status_code == 422
    assert fixed.json()["detail"] == {"tasks.0": impact_service.CHECK_WITH_FIX}
    no_link = await client.post(url, json={"tasks": [{"taskId": task["id"]}]})
    assert no_link.json()["detail"] == {"tasks.0.link": impact_service.CHECK_NO_LINK}

    # 연결만 하는 줄은 글을 견주지 않는다 — 분석 뒤에 제목이 바뀌어도 된다
    assert (
        await client.patch(f"/api/tasks/{task['id']}", json={"title": "운영 서버"})
    ).status_code == 200
    res = await client.post(url, json={"tasks": [{"taskId": task["id"], "link": True}]})
    assert res.status_code == 200, res.text
    assert res.json()["links"] == [{"taskId": task["id"], "agendaId": "t1"}]
    assert res.json()["tasks"][0]["title"] == "운영 서버"
    row = res.json()["impact"]["tasks"][-1]
    assert (row["verdict"], row["linkedOnApply"]) == ("check", True)
    assert row["appliedAt"] is not None

    # 멱등 — 다시 걸어도 그대로, 새로 건 링크가 없다
    again = await client.post(url, json={"tasks": [{"taskId": task["id"], "link": True}]})
    assert again.status_code == 200 and again.json()["links"] == []


async def test_apply_link_only_deleted_is_gone(client: httpx.AsyncClient) -> None:
    impact, task, _ = await analyzed_hidden(client)
    assert (await client.delete(f"/api/tasks/{task['id']}")).status_code == 204
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={"tasks": [{"taskId": task["id"], "link": True}]},
    )
    assert res.status_code == 409
    assert res.json()["detail"] == {"tasks.0": "분석 뒤에 지워졌습니다."}


async def test_apply_link_on_linked_row_is_422(client: httpx.AsyncClient) -> None:
    impact = await analyzed(client)
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={"tasks": [{"taskId": "k4", "body": K4_BODY, "link": True}]},
    )
    assert res.status_code == 422
    assert res.json()["detail"] == {"tasks.0.link": impact_service.LINK_ON_LINKED}
    # 연결된 check · ok 줄은 여전히 고를 수 없다
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={"tests": [{"testId": "tc2", "link": True}]},
    )
    assert res.json()["detail"] == {"tests.0.testId": "이 분석의 고칠 테스트가 아닙니다."}


async def test_apply_link_needs_task_edit_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    """admin 이 만든 담당자 없는 작업 — u4 는 못 고치니 연결도 못 한다."""
    impact, task, _ = await analyzed_hidden(client)
    u4 = await as_member("u4")
    res = await u4.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={"tasks": [{"taskId": task["id"], "link": True}]},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == {"tasks.0": "이 작업을 고칠 권한이 없습니다."}


async def test_apply_test_tag_limit_goes_to_link(
    client: httpx.AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    impact, task, test = await analyzed_hidden(client)
    monkeypatch.setattr(test_service, "REFS_MAX", 0)
    history = await count(session, TaskHistory)
    res = await client.post(
        f"/api/agenda-impacts/{impact['id']}/apply",
        json={
            "tasks": [{"taskId": task["id"], "body": ROCKY_BODY, "link": True}],
            "tests": [{"testId": test["id"], "link": True}],
        },
    )
    assert res.status_code == 400
    assert res.json()["code"] == "TEST_REF_LIMIT"
    assert set(res.json()["detail"]) == {"tests.0.link"}
    # 한 트랜잭션 — 앞의 작업 반영 · 연결도 안 남는다
    assert await count(session, TaskHistory) == history
    assert (await client.get(T1)).json()["taskCount"] == 1


async def test_old_rows_read_as_linked(client: httpx.AsyncClient, session: AsyncSession) -> None:
    """1단계에서 남긴 분석은 linked · linkedOnApply 칸이 없다 — 이행 없이 읽을 때 채운다."""
    impact = await analyzed(client)
    row = await session.get(AgendaImpact, impact["id"])
    assert row is not None
    old = json.loads(json.dumps(row.result))
    for line in [*old["tasks"], *old["tests"]]:
        del line["linked"], line["linkedOnApply"]
    row.result = old
    await session.commit()
    latest = (await client.get(STATE)).json()["latest"]
    assert all(t["linked"] and not t["linkedOnApply"] for t in latest["tasks"] + latest["tests"])

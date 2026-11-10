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
from app.models import AgendaImpact, TaskHistory, TaskLine, TestCase, TestHistory
from app.services import impact as impact_service
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
    assert set(k4) == {"taskId", "verdict", "reason", "body", "before", "appliedAt"}
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
    }
    tc2, tc4 = impact["tests"]
    assert set(tc2) == {"testId", "verdict", "reason", "before", "appliedAt"}
    assert set(tc4) == {"testId", "verdict", "reason", "content", "before", "appliedAt"}
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

    # Claude 에 간 것 — 도구 하나 · 설정의 상한 · 결정 전 · 후 · 근거
    (call,) = fake.calls
    assert [tool["name"] for tool in call["tools"]] == ["propose_impact"]
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
        "tasks.0.taskId": "넣어 준 연결 작업이 아닙니다.",
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
    assert set(body) == {"tasks", "tests", "impact"}
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

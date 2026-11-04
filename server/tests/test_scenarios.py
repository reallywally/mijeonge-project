"""memo 의 시나리오를 **API 호출만으로** 끝까지 따라간다.

3단계의 끝난 기준이 이것이다. 시드에 기대지 않고 빈 프로젝트를 하나 만들어 시작한다 —
`memo.md` 의 시나리오와 한 줄씩 맞춰 볼 수 있게 각 단계에 그 문장을 주석으로 달았다.
(멤버 u1~u4 는 시드가 넣은 것을 쓴다. 멤버 등록 화면도 API 도 아직 없다.)
접두사는 시드의 것(HW · PAS · MG)과 겹치면 안 된다 — 프로젝트 사이에 유일하다(API.md Q20).

안건은 제목 · 설명 · 결정내용 · 상태 넷이다(docs/api/agenda.md). 회의에서 정하든 담당자 확인으로
정하든 결정내용을 적고 상태를 고르는 `PATCH /api/agendas/{agendaId}` 하나로 남는다.
언제 어떻게 바뀌었는지는 변경 이력이 남긴다. 미룸은 상태가 아니다 — 논의중으로 두고 까닭을 적는다.
"""

from typing import Any

import httpx


async def start(client: httpx.AsyncClient, name: str, prefix: str) -> str:
    """1. 최상위 프로젝트 등록 — 그리고 사람들을 부여한다. 부여받은 사람만 담당자가 된다."""
    res = await client.post("/api/projects", json={"name": name, "taskKeyPrefix": prefix})
    assert res.status_code == 201
    project_id = str(res.json()["id"])
    for member_id in ("u1", "u2", "u3", "u4"):
        granted = await client.put(
            f"/api/projects/{project_id}/members/{member_id}", json={"role": "user"}
        )
        assert granted.status_code == 200
    return project_id


async def snapshot(client: httpx.AsyncClient, project_id: str) -> dict[str, list[dict]]:
    res = await client.get(f"/api/projects/{project_id}/snapshot")
    assert res.status_code == 200
    return dict(res.json())


async def patch(client: httpx.AsyncClient, agenda_id: str, **body: Any) -> dict[str, Any]:
    res = await client.patch(f"/api/agendas/{agenda_id}", json=body)
    assert res.status_code == 200, res.text
    patched: dict[str, Any] = res.json()
    return patched


async def history(client: httpx.AsyncClient, agenda_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = (await client.get(f"/api/agendas/{agenda_id}/history")).json()
    return rows


async def test_scenario_1_dev_environment(client: httpx.AsyncClient) -> None:
    """1. 일반적인 상황 — 작업에서 안건 둘이 갈라지고 둘 다 정해진다."""
    project = await start(client, "한화손보 차세대", "HWN")

    # 간트차트에 개발 환경 설정 task 를 등록한다
    task = (
        await client.post(
            f"/api/projects/{project}/tasks",
            json={
                "title": "개발 환경 설정",
                "ownerId": "u3",
                "start": "2026-09-08",
                "due": "2026-09-12",
                "body": [{"kind": "check", "text": "서버 신청서 제출", "done": True}],
            },
        )
    ).json()
    assert task["key"] == "HWN-1"

    # 서버 OS · DB 를 무엇으로 할지 결정이 안 돼 안건 둘을 만든다
    os_agenda = (
        await client.post(f"/api/projects/{project}/agendas", json={"title": "서버 OS 결정"})
    ).json()
    db_agenda = (
        await client.post(
            f"/api/projects/{project}/agendas",
            json={"title": "DB 결정", "description": "PostgreSQL · MySQL · Supabase 중에서"},
        )
    ).json()
    assert [os_agenda["state"], db_agenda["state"]] == ["queued", "queued"]

    # 연관 task 로 맵핑한다
    for agenda in (os_agenda, db_agenda):
        linked = await client.put(f"/api/tasks/{task['id']}/agendas/{agenda['id']}")
        assert linked.status_code == 200

    # 서버는 사실 우분투 최신 버전으로 정해져 있었다 — 공유가 안 됐을 뿐이라 바로 정리한다
    outside = await patch(
        client,
        os_agenda["id"],
        decision="우분투 최신 버전으로 한다",
        state="decided",
        ownerId="u3",
    )
    assert outside["state"] == "decided" and outside["decidedAt"] is not None

    # DB 는 여러 사람의 의견을 들어 mysql 로 정한다 — 뺀 이유는 결정내용에 같이 적는다
    decision = (
        "mysql 을 쓴다\n"
        "- postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다\n"
        "- supabase 는 비용 때문에 뺀다"
    )
    decided = await patch(client, db_agenda["id"], decision=decision, state="decided")
    assert decided["decisionRev"] == 1

    # 끝나면 안건 둘 다 결정됐고, 호환성 · 비용 이야기는 결정내용 · 변경 이력에 남는다
    snap = await snapshot(client, project)
    assert {t["id"]: t["state"] for t in snap["agendas"]} == {
        os_agenda["id"]: "decided",
        db_agenda["id"]: "decided",
    }
    assert next(t for t in snap["agendas"] if t["id"] == db_agenda["id"])["decision"] == decision
    changes = (await history(client, db_agenda["id"]))[-1]["changes"]
    assert [c["field"] for c in changes] == ["decision", "state"]
    # 작업 하나에 안건 둘이 걸려 있다
    assert len([link for link in snap["taskAgendaLinks"] if link["taskId"] == task["id"]]) == 2


async def test_scenario_2_deferred_twice(client: httpx.AsyncClient) -> None:
    """2. 미결정 상황 — 두 번 미뤄도 상태는 open 이다. 미룬 까닭은 설명에 쌓는다."""
    project = await start(client, "한화손보 차세대", "HWN")

    # 보험료 산출 기간계 API 개발 task 를 등록한다
    task = (
        await client.post(
            f"/api/projects/{project}/tasks",
            json={"title": "보험료 산출 기간계 API 개발", "ownerId": "u4", "status": "blocked"},
        )
    ).json()

    # 작업 도중 in · out 정의가 안 돼 개발이 불가능했다 — 안건을 만들고 작업에 건다
    agenda = (
        await client.post(
            f"/api/projects/{project}/agendas",
            json={
                "title": "보험료 산출 기간계 API 호출 in · out 정의",
                "ownerId": "u4",
                "dueDate": "2026-10-19",
            },
        )
    ).json()
    await client.put(f"/api/tasks/{task['id']}/agendas/{agenda['id']}")

    # 기간계조차 정해진 것이 없어 미룬다 — 다뤘으니 논의중, 까닭은 설명에
    first = await patch(
        client,
        agenda["id"],
        state="open",
        description="기간계 업무 정의가 안 돼 정할 수 없다. 월요일에 다시 본다.",
    )
    assert first["state"] == "open" and first["decisionRev"] == 0

    # 다음 주 월요일에 다시 봤지만 여전히 업무 정의가 없어 또 미룬다
    second = await patch(
        client,
        agenda["id"],
        description=(
            "기간계 업무 정의가 안 돼 정할 수 없다. 월요일에 다시 본다.\n"
            "두 번째 미룸이다. 다음에는 기간계 담당자를 부르기로 했다."
        ),
    )
    assert second["state"] == "open"

    # 두 번 미뤄도 상태는 그대로 open 이다. 미룬 기록은 변경 이력에 둘 쌓인다
    snap = await snapshot(client, project)
    assert next(t for t in snap["agendas"] if t["id"] == agenda["id"])["state"] == "open"
    rows = await history(client, agenda["id"])
    assert [[c["field"] for c in row["changes"]] for row in rows] == [
        ["created"],
        ["description", "state"],
        ["description"],
    ]
    # 그날을 가리키는 것은 changedAt 이다 — 화면이 KST 날짜로 잘라 찍는다
    assert all(row["changedAt"].endswith("Z") for row in rows)


async def test_scenario_3_schedule_settled_at_once(client: httpx.AsyncClient) -> None:
    """3. 안건만 사용 — 일정 조율. 작업 없이 안건 하나가 한 번에 정해진다."""
    project = await start(client, "한화손보 차세대", "HWN")

    agenda = (
        await client.post(
            f"/api/projects/{project}/agendas",
            json={
                "title": "일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지",
                "ownerId": "u1",
            },
        )
    ).json()

    # 오픈 일정은 고객사와 공유된 날짜라 건드릴 수 없다는 전제를 배경에 적어 둔다
    patched = await patch(
        client, agenda["id"], description="오픈 일정은 고객사와 공유된 날짜라 건드릴 수 없다."
    )
    assert patched["state"] == "queued"  # 배경을 고쳐도 상태는 그대로다

    # 일정은 그대로 하고 테스트 기간만 2주 줄이는 것으로 결정
    saved = await patch(
        client,
        agenda["id"],
        decision=(
            "전체 일정은 그대로 두고 테스트 기간만 2주 줄인다\n"
            "- 늘어난 개발 기간은 그대로 둔다\n"
            "- 통합 테스트를 3주에서 1주로 줄인다"
        ),
        state="decided",
    )

    assert saved["state"] == "decided"
    snap = await snapshot(client, project)
    assert snap["tasks"] == []  # 작업 없이 안건만 쓴 시나리오다
    assert snap["agendas"][0]["description"].startswith("오픈 일정은")
    assert snap["agendas"][0]["decision"].endswith("통합 테스트를 3주에서 1주로 줄인다")

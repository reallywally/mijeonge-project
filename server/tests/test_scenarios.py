"""memo 의 시나리오를 **API 호출만으로** 끝까지 따라간다.

3단계의 끝난 기준이 이것이다. 시드에 기대지 않고 빈 프로젝트를 하나 만들어 시작한다 —
`memo.md` 의 시나리오와 한 줄씩 맞춰 볼 수 있게 각 단계에 그 문장을 주석으로 달았다.
(멤버 u1~u4 는 시드가 넣은 것을 쓴다. 멤버 등록 화면도 API 도 아직 없다.)
접두사는 시드의 것(HW · PAS · MG)과 겹치면 안 된다 — 프로젝트 사이에 유일하다(API.md Q20).

회의는 걷어냈다. 회의에서 정하든 담당자 확인으로 정하든 남는 것은 안건 이력 한 줄이다 —
그래서 모든 시나리오가 `POST /api/threads/{threadId}/entries` 하나로 기록을 남긴다.
안건 없이 메모만 남던 주간회의(옛 시나리오 4)는 기록할 자리가 없어져 뺐다.
"""

import httpx


async def start(client: httpx.AsyncClient, name: str, prefix: str) -> str:
    """1. 최상위 프로젝트 등록."""
    res = await client.post("/api/projects", json={"name": name, "taskKeyPrefix": prefix})
    assert res.status_code == 201
    return str(res.json()["id"])


async def snapshot(client: httpx.AsyncClient, project_id: str) -> dict[str, list[dict]]:
    res = await client.get(f"/api/projects/{project_id}/snapshot")
    assert res.status_code == 200
    return dict(res.json())


async def test_scenario_1_dev_environment(client: httpx.AsyncClient) -> None:
    """1. 일반적인 상황 — 작업에서 안건 둘이 갈라지고 둘 다 이력 한 줄로 정해진다."""
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
    os_thread = (
        await client.post(f"/api/projects/{project}/threads", json={"title": "서버 OS 결정"})
    ).json()
    db_thread = (
        await client.post(
            f"/api/projects/{project}/threads",
            json={"title": "DB 결정", "options": ["PostgreSQL", "MySQL", "Supabase"]},
        )
    ).json()
    assert [os_thread["state"], db_thread["state"]] == ["queued", "queued"]

    # 연관 task 로 맵핑한다
    for thread in (os_thread, db_thread):
        linked = await client.put(f"/api/tasks/{task['id']}/threads/{thread['id']}")
        assert linked.status_code == 200

    # 서버는 사실 우분투 최신 버전으로 정해져 있었다 — 공유가 안 됐을 뿐이라 바로 정리한다
    outside = (
        await client.post(
            f"/api/threads/{os_thread['id']}/entries",
            json={
                "kind": "decide",
                "text": "우분투 최신 버전으로 한다",
                "note": "PM 에게 전달받아 이도현이 정리했다.",
                "ownerId": "u3",
            },
        )
    ).json()
    assert outside["thread"]["state"] == "decided"

    # DB 는 여러 사람의 의견을 들어 mysql 로 정한다 — 뺀 이유는 결정의 상세로 남긴다
    decided = (
        await client.post(
            f"/api/threads/{db_thread['id']}/entries",
            json={
                "kind": "decide",
                "text": "mysql 을 쓴다",
                "detail": [
                    "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다",
                    "supabase 는 비용 때문에 뺀다",
                ],
                "ownerId": "u3",
            },
        )
    ).json()
    assert decided["thread"]["state"] == "decided"

    # 끝나면 안건 둘 다 결정됐고, 호환성 · 비용 이야기는 이력에 남는다
    snap = await snapshot(client, project)
    assert {t["id"]: t["state"] for t in snap["threads"]} == {
        os_thread["id"]: "decided",
        db_thread["id"]: "decided",
    }
    db_history = [e for e in snap["entries"] if e["threadId"] == db_thread["id"]]
    assert [e["detail"] for e in db_history] == [
        [
            "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다",
            "supabase 는 비용 때문에 뺀다",
        ]
    ]
    # 작업 하나에 안건 둘이 걸려 있다
    assert len([link for link in snap["taskThreadLinks"] if link["taskId"] == task["id"]]) == 2


async def test_scenario_2_deferred_twice(client: httpx.AsyncClient) -> None:
    """2. 미결정 상황 — 두 번 미뤄도 상태는 open 이다. 미룸은 상태가 아니라 줄이다."""
    project = await start(client, "한화손보 차세대", "HWN")

    # 보험료 산출 기간계 API 개발 task 를 등록한다
    task = (
        await client.post(
            f"/api/projects/{project}/tasks",
            json={"title": "보험료 산출 기간계 API 개발", "ownerId": "u4", "status": "blocked"},
        )
    ).json()

    # 작업 도중 in · out 정의가 안 돼 개발이 불가능했다 — 안건을 만들고 작업에 건다
    thread = (
        await client.post(
            f"/api/projects/{project}/threads",
            json={
                "title": "보험료 산출 기간계 API 호출 in · out 정의",
                "ownerId": "u4",
                "dueDate": "2026-10-19",
            },
        )
    ).json()
    await client.put(f"/api/tasks/{task['id']}/threads/{thread['id']}")

    # 기간계조차 정해진 것이 없어 미룬다
    first = (
        await client.post(
            f"/api/threads/{thread['id']}/entries",
            json={
                "kind": "defer",
                "text": "이번에는 정하지 못했다",
                "note": "기간계 업무 정의가 안 돼 정할 수 없다. 월요일에 다시 본다.",
                "ownerId": "u4",
            },
        )
    ).json()
    # 미룸은 대기를 미결정으로만 옮긴다 — 결정으로 넘어가지 않는다
    assert first["thread"]["state"] == "open"

    # 다음 주 월요일에 다시 봤지만 여전히 업무 정의가 없어 또 미룬다
    second = (
        await client.post(
            f"/api/threads/{thread['id']}/entries",
            json={
                "kind": "defer",
                "text": "여전히 업무 정의가 없어 또 미룬다",
                "note": "두 번째 미룸이다. 다음에는 기간계 담당자를 부르기로 했다.",
                "ownerId": "u4",
            },
        )
    ).json()
    assert second["thread"]["state"] == "open"

    # 두 번 미뤄도 상태는 그대로 open 이다. 미룸은 이력에 둘 쌓인다
    snap = await snapshot(client, project)
    assert next(t for t in snap["threads"] if t["id"] == thread["id"])["state"] == "open"

    history = [e for e in snap["entries"] if e["threadId"] == thread["id"]]
    assert [e["kind"] for e in history] == ["defer", "defer"]
    assert [e["id"] for e in history] == [first["entry"]["id"], second["entry"]["id"]]
    # 그날을 가리키는 것은 createdAt 이다 — 화면이 KST 날짜로 잘라 찍는다
    assert all(e["createdAt"].endswith("Z") for e in history)


async def test_scenario_3_schedule_settled_at_once(client: httpx.AsyncClient) -> None:
    """3. 안건만 사용 — 일정 조율. 작업 없이 안건 하나가 한 번에 정해진다."""
    project = await start(client, "한화손보 차세대", "HWN")

    thread = (
        await client.post(
            f"/api/projects/{project}/threads",
            json={
                "title": "일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지",
                "ownerId": "u1",
                "options": ["전체 일정을 미룬다", "테스트 기간을 줄인다"],
            },
        )
    ).json()

    # 오픈 일정은 고객사와 공유된 날짜라 건드릴 수 없다는 전제를 배경에 적어 둔다
    patched = await client.patch(
        f"/api/threads/{thread['id']}",
        json={"description": "오픈 일정은 고객사와 공유된 날짜라 건드릴 수 없다."},
    )
    assert patched.status_code == 200
    assert patched.json()["state"] == "queued"  # 배경을 고쳐도 상태는 그대로다

    # 일정은 그대로 하고 테스트 기간만 2주 줄이는 것으로 결정
    saved = (
        await client.post(
            f"/api/threads/{thread['id']}/entries",
            json={
                "kind": "decide",
                "text": "전체 일정은 그대로 두고 테스트 기간만 2주 줄인다",
                "detail": [
                    "늘어난 개발 기간은 그대로 둔다",
                    "통합 테스트를 3주에서 1주로 줄인다",
                ],
                "note": "일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.",
                "ownerId": "u1",
            },
        )
    ).json()

    assert saved["thread"]["state"] == "decided"
    snap = await snapshot(client, project)
    assert snap["tasks"] == []  # 작업 없이 안건만 쓴 시나리오다
    assert snap["threads"][0]["description"].startswith("오픈 일정은")
    assert snap["entries"][0]["detail"] == [
        "늘어난 개발 기간은 그대로 둔다",
        "통합 테스트를 3주에서 1주로 줄인다",
    ]

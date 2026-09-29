"""memo 의 시나리오 넷을 **API 호출만으로** 끝까지 따라간다.

3단계의 끝난 기준이 이것이다. 시드에 기대지 않고 빈 프로젝트를 하나 만들어 시작한다 —
`memo.md` 의 시나리오와 한 줄씩 맞춰 볼 수 있게 각 단계에 그 문장을 주석으로 달았다.
(멤버 u1~u4 는 시드가 넣은 것을 쓴다. 멤버 등록 화면도 API 도 아직 없다.)
접두사는 시드의 것(HW · PAS · MG)과 겹치면 안 된다 — 프로젝트 사이에 유일하다(API.md Q20).
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
    """1. 일반적인 상황.

    작업에서 안건 둘이 갈라지고, 하나는 회의 밖에서 하나는 회의에서 정해진다.
    """
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
        await client.post(f"/api/projects/{project}/threads", json={"title": "DB 결정"})
    ).json()
    assert [os_thread["state"], db_thread["state"]] == ["queued", "queued"]

    # 연관 task 로 맵핑한다
    for thread in (os_thread, db_thread):
        linked = await client.put(f"/api/tasks/{task['id']}/threads/{thread['id']}")
        assert linked.status_code == 200

    # 서버는 사실 우분투 최신 버전으로 정해져 있었다 — 공유가 안 됐을 뿐이라 회의 밖으로 정리한다
    outside = (
        await client.post(
            f"/api/threads/{os_thread['id']}/entries",
            json={
                "kind": "decide",
                "text": "우분투 최신 버전으로 한다",
                "note": "PM 에게 전달받아 이도현이 정리했다. 회의로 다루지 않았다.",
                "ownerId": "u3",
            },
        )
    ).json()
    assert outside["entry"]["meetingId"] is None
    assert outside["thread"]["state"] == "decided"

    # DB 는 여러 사람의 의견이 필요해 회의를 한다
    saved = (
        await client.post(
            f"/api/projects/{project}/meetings",
            json={
                "title": "개발 환경 확정 회의",
                "date": "2026-09-10",
                "attendeeIds": ["u1", "u2", "u3", "u4"],
                "newThreads": [],
                # 안건에는 mysql 을 사용하기로 결정
                "entries": [
                    {
                        "threadId": db_thread["id"],
                        "kind": "decide",
                        "text": "mysql 을 쓴다",
                        "detail": [],
                        "note": "",
                        "ownerId": "u3",
                    }
                ],
                # 회의 메모에는 호환성 · 비용 이야기를 남긴다
                "memos": [
                    {
                        "text": "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺐다",
                        "promotedTempId": None,
                    },
                    {"text": "supabase 는 비싸서 뺐다", "promotedTempId": None},
                ],
            },
        )
    ).json()

    # 끝나면 안건 둘 다 결정됐고, 회의 메모에 호환성 · 비용 이야기가 남는다
    snap = await snapshot(client, project)
    assert {t["id"]: t["state"] for t in snap["threads"]} == {
        os_thread["id"]: "decided",
        db_thread["id"]: "decided",
    }
    assert [m["text"] for m in snap["meetings"][0]["memos"]] == [
        "postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺐다",
        "supabase 는 비싸서 뺐다",
    ]
    # 작업 하나에 안건 둘이 걸려 있다
    assert len([link for link in snap["taskThreadLinks"] if link["taskId"] == task["id"]]) == 2
    assert snap["meetings"][0]["id"] == saved["meeting"]["id"]


async def test_scenario_2_deferred_twice(client: httpx.AsyncClient) -> None:
    """2. 미결정 상황 — 회의 둘에서 두 번 미뤄도 상태는 open 이다. 미룸은 상태가 아니라 줄이다."""
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
            json={"title": "보험료 산출 기간계 API 호출 in · out 정의", "ownerId": "u4"},
        )
    ).json()
    await client.put(f"/api/tasks/{task['id']}/threads/{thread['id']}")

    # 담당자 회의를 열었지만 기간계조차 정해진 것이 없어 미룬다
    first = (
        await client.post(
            f"/api/projects/{project}/meetings",
            json={
                "title": "기간계 API in · out 회의",
                "date": "2026-09-07",
                "attendeeIds": ["u1", "u2", "u4"],
                "newThreads": [],
                "entries": [
                    {
                        "threadId": thread["id"],
                        "kind": "defer",
                        "text": "이번 회의에서는 정하지 못했다",
                        "detail": [],
                        "note": "기간계 업무 정의가 안 돼 정할 수 없다. 월요일에 다시 본다.",
                        "ownerId": "u4",
                    }
                ],
                "memos": [
                    {
                        "text": "기간계 업무 정의가 안 돼 정의 불가. 다음 주 월요일에 다시 회의.",
                        "promotedTempId": None,
                    }
                ],
            },
        )
    ).json()
    # 미룸은 대기를 미결정으로만 옮긴다 — 결정으로 넘어가지 않는다
    assert first["threads"][0]["state"] == "open"

    # 다음 주 월요일에 다시 회의했지만 여전히 업무 정의가 없어 또 미룬다
    second = (
        await client.post(
            f"/api/projects/{project}/meetings",
            json={
                "title": "기간계 API in · out 재회의",
                "date": "2026-09-14",
                "attendeeIds": ["u1", "u4"],
                "newThreads": [],
                "entries": [
                    {
                        "threadId": thread["id"],
                        "kind": "defer",
                        "text": "여전히 업무 정의가 없어 또 미룬다",
                        "detail": [],
                        "note": "두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.",
                        "ownerId": "u4",
                    }
                ],
                "memos": [],
            },
        )
    ).json()

    # 두 번 미뤄도 상태는 그대로 open 이다. 미룸은 이력에 둘 쌓인다
    assert second["threads"] == []  # 이미 open 이라 바뀐 안건이 없다
    snap = await snapshot(client, project)
    assert next(t for t in snap["threads"] if t["id"] == thread["id"])["state"] == "open"

    history = [e for e in snap["entries"] if e["threadId"] == thread["id"]]
    assert [e["kind"] for e in history] == ["defer", "defer"]
    assert [e["meetingId"] for e in history] == [
        first["meeting"]["id"],
        second["meeting"]["id"],
    ]
    # 그날을 가리키는 것은 회의 날짜다. createdAt 은 적은 시각이라 둘 다 지금이다 (API.md Q23)
    assert [m["date"] for m in snap["meetings"]] == ["2026-09-07", "2026-09-14"]
    assert all(e["createdAt"].endswith("Z") for e in history)


async def test_scenario_3_schedule_settled_in_one_meeting(client: httpx.AsyncClient) -> None:
    """3. 안건 · 회의만 사용 — 일정 조율. 작업 없이 안건 하나가 회의 한 번으로 정해진다."""
    project = await start(client, "한화손보 차세대", "HWN")

    # 일정 조율 안건을 등록하고 회의를 한다
    thread = (
        await client.post(
            f"/api/projects/{project}/threads",
            json={
                "title": "일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지",
                "ownerId": "u1",
            },
        )
    ).json()

    saved = (
        await client.post(
            f"/api/projects/{project}/meetings",
            json={
                "title": "일정 조율 회의",
                "date": "2026-09-15",
                "attendeeIds": ["u1", "u2", "u3", "u4"],
                "newThreads": [],
                # 회의 결과 일정은 그대로 하고 테스트 기간만 2주 줄이는 것으로 결정
                "entries": [
                    {
                        "threadId": thread["id"],
                        "kind": "decide",
                        "text": "전체 일정은 그대로 두고 테스트 기간만 2주 줄인다",
                        "detail": [
                            "늘어난 개발 기간은 그대로 둔다",
                            "통합 테스트를 3주에서 1주로 줄인다",
                        ],
                        "note": "일정을 미루면 오픈 일정이 밀린다는 데에 이견이 없었다.",
                        "ownerId": "u1",
                    }
                ],
                "memos": [
                    {
                        "text": "오픈 일정은 고객사와 공유된 날짜라 건드릴 수 없다는 전제였다.",
                        "promotedTempId": None,
                    }
                ],
            },
        )
    ).json()

    assert saved["threads"][0]["state"] == "decided"
    snap = await snapshot(client, project)
    assert snap["tasks"] == []  # 작업 없이 안건 · 회의만 쓴 시나리오다
    assert snap["entries"][0]["detail"] == [
        "늘어난 개발 기간은 그대로 둔다",
        "통합 테스트를 3주에서 1주로 줄인다",
    ]


async def test_scenario_4_weekly_meeting_without_any_thread(client: httpx.AsyncClient) -> None:
    """4. 안건 · 회의만 사용 — 주간회의. 공유할 안건이 없을 수도 있다: 메모만 남는다."""
    project = await start(client, "한화손보 차세대", "HWN")

    saved = (
        await client.post(
            f"/api/projects/{project}/meetings",
            json={
                "title": "9월 1주차 주간회의",
                "date": "2026-09-04",
                "attendeeIds": ["u1", "u2", "u3"],
                "newThreads": [],
                "entries": [],
                "memos": [
                    {
                        "text": "킥오프 이후 첫 주다. 산출물 목록은 다음 주에 공유하기로 했다.",
                        "promotedTempId": None,
                    },
                    {"text": "개발 장비는 9월 둘째 주에 들어온다.", "promotedTempId": None},
                    {"text": "정하늘이 9월 말 휴가다.", "promotedTempId": None},
                ],
            },
        )
    ).json()

    assert saved["entries"] == [] and saved["threads"] == []
    assert saved["threadIdByTempId"] == {}

    # 저장되고 스냅샷에 선다 — 안건 이력으로는 닿지 않으니 회의 목록이 유일한 입구다
    snap = await snapshot(client, project)
    assert [m["id"] for m in snap["meetings"]] == [saved["meeting"]["id"]]
    assert len(snap["meetings"][0]["memos"]) == 3
    assert snap["entries"] == [] and snap["threads"] == []

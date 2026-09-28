"""회의 쓰기 API — 새 회의 저장과 작업 링크.

**새 회의 저장이 3단계에서 제일 어려운 자리다.** 안건 등록 + 회의 + 줄 여럿 + 안건 상태 변경이
한 트랜잭션에서 돈다. 여기서는 tempId 치환 세 곳과 "하나 틀어지면 통째로 없던 일"을 못 박는다.
memo 시나리오 넷을 끝까지 따라가는 것은 `tests/test_scenarios.py` 다.
"""

import httpx

from tests.test_read_api import ENTRY_KEYS, MEETING_KEYS, THREAD_KEYS

# 픽스처의 m3(개발 환경 확정 회의)와 같은 모양 — 이미 있는 안건에 줄을 남기고 메모를 함께 적는다
MEETING = {
    "title": "9월 3주차 주간회의",
    "date": "2026-09-18",
    "attendeeIds": ["u1", "u2"],
    "newThreads": [],
    "entries": [
        {
            "threadId": "t4",
            "kind": "decide",
            "text": "기간계와 같은 주기로 맞춘다",
            "detail": ["일 1회 전체 백업", "보관은 30일"],
            "note": "기간계 담당자에게 확인받았다",
            "ownerId": "u2",
        }
    ],
    "memos": [{"text": "장비 반입은 다음 주다", "promotedTempId": None}],
}


async def test_save_meeting_answers_with_everything_that_changed(
    client: httpx.AsyncClient,
) -> None:
    res = await client.post("/api/projects/p1/meetings", json=MEETING)
    assert res.status_code == 201
    body = res.json()

    assert set(body) == {"meeting", "threads", "entries", "threadIdByTempId"}
    assert set(body["meeting"]) == MEETING_KEYS  # domain.ts 의 Meeting 과 한 필드씩 같다
    assert set(body["meeting"]["memos"][0]) == {"id", "text", "promotedThreadId"}
    assert set(body["entries"][0]) == ENTRY_KEYS
    assert set(body["threads"][0]) == THREAD_KEYS

    assert body["meeting"]["attendeeIds"] == ["u1", "u2"]
    assert body["entries"][0]["meetingId"] == body["meeting"]["id"]
    assert body["entries"][0]["detail"] == ["일 1회 전체 백업", "보관은 30일"]
    # 줄 하나가 안건을 결정으로 옮긴다 — 회의 밖 줄과 같은 규칙이다
    assert [t["id"] for t in body["threads"]] == ["t4"]
    assert body["threads"][0]["state"] == "decided"
    assert body["threads"][0]["ownerId"] == "u2"


async def test_meeting_date_is_the_date_of_everything_it_made(client: httpx.AsyncClient) -> None:
    """회의에서 생긴 것은 안건도 줄도 그 회의 날짜로 앉는다(`stores/meeting.ts` 와 같다)."""
    body = (
        await client.post(
            "/api/projects/p1/meetings",
            json=MEETING
            | {"newThreads": [{"tempId": "n1", "title": "로그 보관 기간", "ownerId": None}]},
        )
    ).json()

    assert body["meeting"]["date"] == "2026-09-18"
    assert body["entries"][0]["createdAt"] == "2026-09-18"
    assert body["threads"][0]["createdAt"] == "2026-09-18"  # 새로 만든 안건


async def test_temp_ids_are_replaced_in_all_three_places(client: httpx.AsyncClient) -> None:
    """회의 중에 안건을 새로 만들고, 그 안건에 줄을 남기고, 메모를 그 안건으로 올리고,
    또 다른 새 안건의 부모로 건다."""
    body = (
        await client.post(
            "/api/projects/p1/meetings",
            json={
                "title": "보안 점검 회의",
                "date": "2026-09-18",
                "attendeeIds": ["u1"],
                "newThreads": [
                    {"tempId": "n1", "title": "외부 모델 호출 승인 절차", "ownerId": "u1"},
                    # ③ 이 회의에서 만든 안건이 부모다
                    {
                        "tempId": "n2",
                        "title": "승인 양식 만들기",
                        "ownerId": None,
                        "parentThreadId": "n1",
                    },
                ],
                # ① 줄이 가리키는 안건
                "entries": [
                    {
                        "threadId": "n1",
                        "kind": "raise",
                        "text": "정보보안팀과 먼저 맞춰야 한다",
                        "detail": [],
                        "note": "",
                        "ownerId": "u1",
                    }
                ],
                # ② 메모를 안건으로 올린 자리
                "memos": [{"text": "승인 절차가 필요하다는 이야기", "promotedTempId": "n1"}],
            },
        )
    ).json()

    mapping = body["threadIdByTempId"]
    assert set(mapping) == {"n1", "n2"}
    assert mapping["n1"] not in ("n1", "n2")  # 서버가 붙인 진짜 id 다

    assert body["entries"][0]["threadId"] == mapping["n1"]
    assert body["meeting"]["memos"][0]["promotedThreadId"] == mapping["n1"]
    child = next(t for t in body["threads"] if t["id"] == mapping["n2"])
    assert child["parentThreadId"] == mapping["n1"]
    # raise 한 줄은 queued 를 open 으로만 옮긴다
    assert next(t for t in body["threads"] if t["id"] == mapping["n1"])["state"] == "open"


async def test_promoted_id_can_point_at_a_thread_that_already_exists(
    client: httpx.AsyncClient,
) -> None:
    """픽스처 mm7 이 그 경우다 — tempId 표에 없으면 그 값을 실제 안건 id 로 본다."""
    body = (
        await client.post(
            "/api/projects/p1/meetings",
            json=MEETING
            | {"entries": [], "memos": [{"text": "백업 이야기", "promotedTempId": "t4"}]},
        )
    ).json()

    assert body["meeting"]["memos"][0]["promotedThreadId"] == "t4"
    assert body["threadIdByTempId"] == {}


async def test_saved_meeting_shows_up_at_the_end_of_the_snapshot(
    client: httpx.AsyncClient,
) -> None:
    body = (
        await client.post(
            "/api/projects/p1/meetings",
            json=MEETING
            | {
                "memos": [
                    {"text": "첫째 줄", "promotedTempId": None},
                    {"text": "둘째 줄", "promotedTempId": None},
                    {"text": "셋째 줄", "promotedTempId": None},
                ]
            },
        )
    ).json()
    snap = (await client.get("/api/projects/p1/snapshot")).json()

    assert snap["meetings"][-1]["id"] == body["meeting"]["id"]
    assert len(snap["meetings"]) == 7
    # 메모 순서가 곧 화면 순서다
    assert [m["text"] for m in snap["meetings"][-1]["memos"]] == ["첫째 줄", "둘째 줄", "셋째 줄"]
    assert snap["entries"][-1]["id"] == body["entries"][0]["id"]


async def test_a_bad_line_rolls_the_whole_meeting_back(client: httpx.AsyncClient) -> None:
    """3-1 에서 제일 중요한 검사 — 줄 하나가 엉터리면 회의도 안건도 하나도 안 남는다."""
    before = (await client.get("/api/projects/p1/snapshot")).json()

    res = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING
        | {
            "newThreads": [{"tempId": "n1", "title": "새 안건", "ownerId": None}],
            "entries": [
                {
                    "threadId": "n1",
                    "kind": "raise",
                    "text": "괜찮은 줄",
                    "detail": [],
                    "note": "",
                    "ownerId": None,
                },
                {
                    "threadId": "없는안건",
                    "kind": "decide",
                    "text": "엉터리 줄",
                    "detail": [],
                    "note": "",
                    "ownerId": None,
                },
            ],
        },
    )
    assert res.status_code == 400

    after = (await client.get("/api/projects/p1/snapshot")).json()
    assert {key: len(value) for key, value in after.items()} == {
        key: len(value) for key, value in before.items()
    }
    assert after["threads"] == before["threads"]  # 앞 줄이 만든 안건도 안 남는다


async def test_a_thread_from_another_project_is_400(client: httpx.AsyncClient) -> None:
    """t10 은 p2 의 안건이다. 스코프는 경로에 있고 줄은 그 안에서만 돈다."""
    res = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING
        | {
            "entries": [
                {
                    "threadId": "t10",
                    "kind": "decide",
                    "text": "x",
                    "detail": [],
                    "note": "",
                    "ownerId": None,
                }
            ]
        },
    )
    assert res.status_code == 400


async def test_unknown_promoted_id_is_400(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING | {"memos": [{"text": "x", "promotedTempId": "없는안건"}]},
    )
    assert res.status_code == 400


async def test_unknown_parent_thread_is_400(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING
        | {
            "newThreads": [
                {"tempId": "n1", "title": "x", "ownerId": None, "parentThreadId": "없는안건"}
            ]
        },
    )
    assert res.status_code == 400


async def test_duplicate_temp_id_is_400(client: httpx.AsyncClient) -> None:
    res = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING
        | {
            "newThreads": [
                {"tempId": "n1", "title": "하나", "ownerId": None},
                {"tempId": "n1", "title": "둘", "ownerId": None},
            ]
        },
    )
    assert res.status_code == 400


async def test_unknown_member_is_400_before_the_fk_blows_up(client: httpx.AsyncClient) -> None:
    """회의 저장은 한 번에 많은 멤버를 받는 자리라 FK 위반이 500 으로 새기 전에 막는다."""
    attendee = await client.post(
        "/api/projects/p1/meetings", json=MEETING | {"attendeeIds": ["u1", "없는사람"]}
    )
    assert attendee.status_code == 400

    owner = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING
        | {
            "entries": [
                {
                    "threadId": "t4",
                    "kind": "decide",
                    "text": "x",
                    "detail": [],
                    "note": "",
                    "ownerId": "없는사람",
                }
            ]
        },
    )
    assert owner.status_code == 400

    thread_owner = await client.post(
        "/api/projects/p1/meetings",
        json=MEETING | {"newThreads": [{"tempId": "n1", "title": "x", "ownerId": "없는사람"}]},
    )
    assert thread_owner.status_code == 400


async def test_save_meeting_on_unknown_project_is_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/projects/없는프로젝트/meetings", json=MEETING)
    assert res.status_code == 404


async def test_link_task_is_idempotent(client: httpx.AsyncClient) -> None:
    first = await client.put("/api/meetings/m1/tasks/k1")
    second = await client.put("/api/meetings/m1/tasks/k1")
    assert first.status_code == 200
    assert first.json() == second.json() == {"meetingId": "m1", "taskId": "k1"}

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert snap["meetingTaskLinks"].count({"meetingId": "m1", "taskId": "k1"}) == 1


async def test_both_sides_write_the_same_link(client: httpx.AsyncClient) -> None:
    await client.put("/api/meetings/m1/tasks/k1")
    assert (await client.delete("/api/tasks/k1/meetings/m1")).status_code == 204

    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert {"meetingId": "m1", "taskId": "k1"} not in snap["meetingTaskLinks"]


async def test_unlinking_what_is_not_linked_still_works(client: httpx.AsyncClient) -> None:
    assert (await client.delete("/api/meetings/m1/tasks/k1")).status_code == 204


async def test_link_needs_both_sides_in_one_project(client: httpx.AsyncClient) -> None:
    assert (await client.put("/api/meetings/m1/tasks/x1")).status_code == 400
    assert (await client.put("/api/meetings/없는회의/tasks/k1")).status_code == 404
    assert (await client.put("/api/meetings/m1/tasks/없는작업")).status_code == 404

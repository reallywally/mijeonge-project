"""결정 항목 — 2026-11-03 사용자 결정('항목마다 따로 결정'). 계약은 `web/src/types/domain.ts` 의
`DecisionItem*` · `Entry.itemId` 와 `API.md` '결정 항목'.

시드 p1 은 목업과 같다 — t1 `di1` · t2 `di2`(결정 하나), t5 `di5`(정함, e8) · `di6`(아직),
t6 `di4`(e6) · `di7`(e7) 둘 다 정함.
"""

import json
from typing import Any

import httpx
import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import search as search_service
from tests.conftest import AsMember, item_of
from tests.test_contract_types import FIELDS
from tests.test_history import ch, history
from tests.test_minutes import APPLY, body, minutes, new_thread, old_entry

ITEM_KEYS = {"id", "threadId", "title", "createdAt", "creatorId"}


async def add_item(c: httpx.AsyncClient, thread_id: str, title: str) -> dict[str, Any]:
    res = await c.post(f"/api/threads/{thread_id}/items", json={"title": title})
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


async def entry(
    c: httpx.AsyncClient, thread_id: str, kind: str, item_id: str | None, text: str = "줄"
) -> httpx.Response:
    return await c.post(
        f"/api/threads/{thread_id}/entries", json={"kind": kind, "itemId": item_id, "text": text}
    )


async def state_of(c: httpx.AsyncClient, thread_id: str) -> str:
    snap = (await c.get("/api/projects/p1/snapshot")).json()
    state: str = next(t for t in snap["threads"] if t["id"] == thread_id)["state"]
    return state


async def new_thread_id(c: httpx.AsyncClient, title: str = "로그인 방식") -> str:
    res = await c.post("/api/projects/p1/threads", json={"title": title})
    assert res.status_code == 201
    thread_id: str = res.json()["id"]
    return thread_id


# --- 계약 모양 ---


def test_contract_types_are_in_domain_ts() -> None:
    assert set(FIELDS["DecisionItem"]) == ITEM_KEYS
    assert {k for k, nullable in FIELDS["DecisionItem"].items() if nullable} == {"creatorId"}
    assert set(FIELDS["DecisionItemInput"]) == {"title"}
    assert set(FIELDS["DecisionItemPatch"]) == {"title"}
    assert set(FIELDS["DecisionItemCreateResult"]) == {"item", "thread"}
    assert set(FIELDS["DecisionItemDeleteResult"]) == {"thread"}
    assert FIELDS["Entry"]["itemId"] is True
    assert "itemId" in FIELDS["EntryInput"]
    assert "decisionItems" in FIELDS["ProjectSnapshot"]
    assert "itemTitle" in FIELDS["ProposedEntryBody"]


async def test_seed_items_are_in_the_snapshot(client: httpx.AsyncClient) -> None:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    # 목업(`web/src/fixtures/threads.ts`)과 같다 — 안건 등록 순 → 안건 안의 항목 순
    assert [
        (i["id"], i["threadId"], i["title"], i["createdAt"], i["creatorId"])
        for i in snap["decisionItems"]
    ] == [
        ("di1", "t1", "서버 OS 결정", "2026-09-09T02:00:00Z", None),
        ("di2", "t2", "DB 결정", "2026-09-10T06:05:00Z", None),
        ("di5", "t5", "요청(in) 항목", "2026-09-10T06:30:00Z", "u4"),
        ("di6", "t5", "응답(out) 항목", "2026-09-10T06:31:00Z", "u4"),
        ("di4", "t6", "테스트 기간", "2026-09-15T06:40:00Z", "u1"),
        ("di7", "t6", "전체 일정", "2026-09-15T06:41:00Z", "u1"),
    ]
    by_id = {e["id"]: e["itemId"] for e in snap["entries"]}
    assert by_id == {
        "e1": "di1",
        "e2": None,
        "e3": "di2",
        "e4": None,
        "e5": None,
        "e6": "di4",
        "e7": "di7",
        "e8": "di5",
    }
    # 상태가 항목 규칙과 맞다 — t5 는 하나만 정해 논의중, t6 은 둘 다 정해 결정
    state = {t["id"]: t["state"] for t in snap["threads"]}
    assert state["t5"] == "open" and state["t6"] == "decided"


# --- 더하기 · 이름 바꾸기 · 지우기 ---


async def test_add_rename_delete(client: httpx.AsyncClient) -> None:
    tid = await new_thread_id(client)
    made = await add_item(client, tid, "  SSO 여부  ")
    assert set(made) == set(FIELDS["DecisionItemCreateResult"])
    item = made["item"]
    assert set(item) == ITEM_KEYS
    assert item["title"] == "SSO 여부" and item["threadId"] == tid
    assert item["creatorId"] == "admin" and item["createdAt"].endswith("Z")
    assert made["thread"]["id"] == tid and made["thread"]["state"] == "queued"
    second = (await add_item(client, tid, "세션 길이"))["item"]

    res = await client.patch(f"/api/threads/{tid}/items/{item['id']}", json={"title": " SSO "})
    assert res.status_code == 200
    assert set(res.json()) == ITEM_KEYS and res.json()["title"] == "SSO"

    # 등록 순으로 안건 끝에
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert [i["id"] for i in snap["decisionItems"]][-2:] == [item["id"], second["id"]]

    res = await client.delete(f"/api/threads/{tid}/items/{item['id']}")
    assert res.status_code == 200
    assert set(res.json()) == set(FIELDS["DecisionItemDeleteResult"])
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert item["id"] not in {i["id"] for i in snap["decisionItems"]}
    # 지운 항목은 없는 것과 같다
    for method, payload in (("PATCH", {"title": "살리기"}), ("DELETE", None)):
        gone = await client.request(method, f"/api/threads/{tid}/items/{item['id']}", json=payload)
        assert gone.status_code == 404 and gone.json()["code"] == "ITEM_NOT_FOUND"
    # 다른 안건의 항목도
    res = await client.patch(f"/api/threads/{tid}/items/di1", json={"title": "x"})
    assert res.status_code == 404 and res.json()["code"] == "ITEM_NOT_FOUND"


@pytest.mark.parametrize("title", ["", "   ", "가" * 201])
async def test_title_is_1_to_200(client: httpx.AsyncClient, title: str) -> None:
    res = await client.post("/api/threads/t4/items", json={"title": title})
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    res = await client.patch("/api/threads/t1/items/di1", json={"title": title})
    assert res.status_code == 422
    assert (
        await client.post("/api/threads/t4/items", json={"title": "가" * 200})
    ).status_code == 201


async def test_items_on_missing_or_deleted_thread_are_404(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/threads/없음/items", json={"title": "x"})
    assert res.status_code == 404 and res.json()["code"] == "THREAD_NOT_FOUND"
    assert (await client.delete("/api/threads/t4")).status_code == 204
    res = await client.post("/api/threads/t4/items", json={"title": "x"})
    assert res.json()["code"] == "THREAD_NOT_FOUND"


# --- 권한 ---


async def test_anyone_adds_but_only_editors_rename_or_delete(as_member: AsMember) -> None:
    """u2 가 만들고 u4 가 맡은 안건 — u3 이 항목을 더한다. u1 은 p1 관리자."""
    u2 = await as_member("u2")
    made = await u2.post("/api/projects/p1/threads", json={"title": "권한", "ownerId": "u4"})
    tid = made.json()["id"]
    u3 = await as_member("u3")
    by_u3 = (await add_item(u3, tid, "u3 의 항목"))["item"]
    assert by_u3["creatorId"] == "u3"
    by_u2 = (await add_item(u2, tid, "u2 의 항목"))["item"]

    # u3 은 제 항목만 고친다
    res = await u3.patch(f"/api/threads/{tid}/items/{by_u2['id']}", json={"title": "남"})
    assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN"
    assert (await u3.delete(f"/api/threads/{tid}/items/{by_u2['id']}")).status_code == 403
    res = await u3.patch(f"/api/threads/{tid}/items/{by_u3['id']}", json={"title": "제 것"})
    assert res.status_code == 200
    # 안건 생성자 · 담당자 · 관리자는 남의 항목도
    for who in ("u2", "u4", "u1", "admin"):
        c = await as_member(who)
        res = await c.patch(f"/api/threads/{tid}/items/{by_u3['id']}", json={"title": who})
        assert res.status_code == 200, who
    assert (
        await (await as_member("u4")).delete(f"/api/threads/{tid}/items/{by_u3['id']}")
    ).status_code == 200


async def test_ungranted_cannot_see_items(
    client: httpx.AsyncClient, session: AsyncSession, as_member: AsMember
) -> None:
    from app.models import Member

    session.add(Member(id="u9", name="외부인", email="u9@inno-ax.com"))
    await session.commit()
    u9 = await as_member("u9")
    res = await u9.post("/api/threads/t1/items", json={"title": "x"})
    assert res.status_code == 404 and res.json()["code"] == "THREAD_NOT_FOUND"


# --- 이력 줄의 항목 (규칙 2) ---


@pytest.mark.parametrize("kind", ["decide", "change", "refine"])
async def test_deciding_kinds_need_an_item(client: httpx.AsyncClient, kind: str) -> None:
    for payload in ({"kind": kind, "text": "x"}, {"kind": kind, "itemId": None, "text": "x"}):
        res = await client.post("/api/threads/t1/entries", json=payload)
        assert res.status_code == 422
        assert res.json()["code"] == "ENTRY_ITEM_REQUIRED"
        assert set(res.json()["detail"]) == {"itemId"}
    assert (await entry(client, "t1", kind, "di1")).status_code == 201


async def test_item_must_be_a_live_item_of_that_thread(client: httpx.AsyncClient) -> None:
    # 다른 안건의 항목
    res = await entry(client, "t1", "decide", "di2")
    assert res.status_code == 404 and res.json()["code"] == "ITEM_NOT_FOUND"
    res = await entry(client, "t1", "defer", "없는항목")
    assert res.status_code == 404 and res.json()["code"] == "ITEM_NOT_FOUND"
    # 지운 항목
    item = (await add_item(client, "t1", "지울 것"))["item"]
    await client.delete(f"/api/threads/t1/items/{item['id']}")
    res = await entry(client, "t1", "decide", item["id"])
    assert res.status_code == 404 and res.json()["code"] == "ITEM_NOT_FOUND"


@pytest.mark.parametrize("kind", ["raise", "split"])
async def test_raise_and_split_take_no_item(client: httpx.AsyncClient, kind: str) -> None:
    res = await entry(client, "t1", kind, "di1")
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    assert set(res.json()["detail"]) == {"itemId"}
    res = await entry(client, "t1", kind, None)
    assert res.status_code == 201 and res.json()["entry"]["itemId"] is None


async def test_defer_takes_an_item_or_the_whole_thread(client: httpx.AsyncClient) -> None:
    one = await entry(client, "t1", "defer", "di1")
    assert one.status_code == 201 and one.json()["entry"]["itemId"] == "di1"
    whole = await entry(client, "t1", "defer", None)
    assert whole.status_code == 201 and whole.json()["entry"]["itemId"] is None


# --- 안건 상태 (규칙 5) ---


async def test_state_follows_every_item(client: httpx.AsyncClient) -> None:
    tid = await new_thread_id(client)
    sso = (await add_item(client, tid, "SSO 여부"))["item"]["id"]
    session_len = (await add_item(client, tid, "세션 길이"))["item"]["id"]
    assert await state_of(client, tid) == "queued"  # 항목만 있고 줄은 없다

    # 일부만 정함 → open
    res = await entry(client, tid, "decide", sso, "SSO 를 쓴다")
    assert res.json()["thread"]["state"] == "open"
    # 항목만 미룸 → 그대로 open
    res = await entry(client, tid, "defer", session_len)
    assert res.json()["thread"]["state"] == "open"
    # 전부 정함 → decided
    res = await entry(client, tid, "decide", session_len, "30분")
    assert res.json()["thread"]["state"] == "decided"

    # 정해진 안건에 새 항목 → open 으로 돌아간다
    made = await add_item(client, tid, "협력사 인증 방식")
    assert made["thread"]["state"] == "open"
    # 안건 전체 미룸은 decided 로 못 올린다
    assert (await entry(client, tid, "defer", None)).json()["thread"]["state"] == "open"
    # 정하지 않은 항목을 지우면 다시 센다 → decided
    res = await client.delete(f"/api/threads/{tid}/items/{made['item']['id']}")
    assert res.json()["thread"]["state"] == "decided"


async def test_deleting_an_item_drops_its_lines_from_the_count(client: httpx.AsyncClient) -> None:
    tid = await new_thread_id(client)
    a = (await add_item(client, tid, "가"))["item"]["id"]
    b = (await add_item(client, tid, "나"))["item"]["id"]
    await entry(client, tid, "decide", a)
    await entry(client, tid, "defer", b)
    assert await state_of(client, tid) == "open"
    # 미룬 항목(나)을 지우면 남은 항목이 다 정해졌다 → decided
    res = await client.delete(f"/api/threads/{tid}/items/{b}")
    assert res.json()["thread"]["state"] == "decided"
    # 그 줄은 이력에 남는다
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    assert [e["itemId"] for e in snap["entries"] if e["threadId"] == tid] == [a, b]
    # 마지막 항목까지 지우면 셀 줄이 없다 → queued
    res = await client.delete(f"/api/threads/{tid}/items/{a}")
    assert res.json()["thread"]["state"] == "queued"


async def test_deleting_the_decision_line_recounts_per_item(client: httpx.AsyncClient) -> None:
    tid = await new_thread_id(client)
    a = (await add_item(client, tid, "가"))["item"]["id"]
    first = (await entry(client, tid, "decide", a, "하나")).json()["entry"]["id"]
    assert await state_of(client, tid) == "decided"
    res = await client.delete(f"/api/threads/{tid}/entries/{first}")
    assert res.json()["thread"]["state"] == "queued"


async def test_thread_with_no_items_cannot_be_decided(client: httpx.AsyncClient) -> None:
    """항목이 0개면 decided 가 될 수 없다 — decide 에 항목이 필수라서."""
    for kind in ("raise", "defer", "split"):
        assert (await entry(client, "t4", kind, None)).json()["thread"]["state"] == "open"


# --- 항목 단위 대체 (규칙 3 · 11) ---


async def test_supersede_happens_inside_an_item(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    tid = await new_thread_id(client)
    a = (await add_item(client, tid, "SSO 여부"))["item"]["id"]
    b = (await add_item(client, tid, "세션 길이"))["item"]["id"]
    await entry(client, tid, "decide", a, "SSO 를 쓴다")
    await entry(client, tid, "decide", b, "30분")
    # 나중의 b 결정이 a 를 덮지 않는다 — a 를 바꿔야 a 가 바뀐다
    await entry(client, tid, "change", a, "SSO 를 안 쓴다")
    await entry(client, tid, "refine", b, "유휴 30분")

    doc = await search_service.get_thread(session, "p1", tid)
    assert [(i.title, i.decided, i.decision) for i in doc.items] == [
        ("SSO 여부", True, "SSO 를 안 쓴다"),
        ("세션 길이", True, "30분"),
    ]
    assert [e.item_id for e in doc.entries] == [a, b, a, b]


async def test_get_thread_lists_undecided_items_too(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await add_item(client, "t1", "버전")
    doc = await search_service.get_thread(session, "p1", "t1")
    assert [(i.title, i.decided, i.decision) for i in doc.items] == [
        ("서버 OS 결정", True, "우분투 최신 버전으로 한다"),
        ("버전", False, ""),
    ]


# --- 변경 이력 (규칙 7) ---


async def test_item_changes_are_in_thread_history(client: httpx.AsyncClient) -> None:
    item = (await add_item(client, "t1", "버전"))["item"]["id"]
    await client.patch(f"/api/threads/t1/items/{item}", json={"title": "버전"})  # 같은 값
    await client.patch(f"/api/threads/t1/items/{item}", json={"title": "OS 버전"})
    await client.delete(f"/api/threads/t1/items/{item}")
    rows = await history(client, "threads/t1")
    assert [row["changes"] for row in rows[1:]] == [
        [ch("itemCreated", None, "버전")],
        [ch("itemTitle", "버전", "OS 버전")],
        [ch("itemDeleted", "OS 버전", None)],
    ]
    assert all(row["changedBy"] == "admin" for row in rows[1:])


# --- 회의록 등록의 itemTitle (규칙 9) ---


async def _apply(client: httpx.AsyncClient, payload: dict[str, Any]) -> dict[str, Any]:
    res = await client.post(APPLY, json=payload)
    assert res.status_code == 201, res.text
    result: dict[str, Any] = res.json()
    return result


async def _items(client: httpx.AsyncClient, thread_id: str) -> list[tuple[str, str]]:
    snap = (await client.get("/api/projects/p1/snapshot")).json()
    return [(i["id"], i["title"]) for i in snap["decisionItems"] if i["threadId"] == thread_id]


async def test_minutes_matches_an_item_by_title(client: httpx.AsyncClient) -> None:
    result = await _apply(
        client,
        minutes(entries=[old_entry("e1", "t1", "decide", "록키", itemTitle="  서버 OS 결정 ")]),
    )
    assert result["entries"][0]["itemId"] == "di1"
    # 있던 항목에 달았으니 새로 만든 것이 없다
    assert result["decisionItems"] == []
    assert await _items(client, "t1") == [("di1", "서버 OS 결정")]


async def test_minutes_makes_a_new_item_for_a_new_title(client: httpx.AsyncClient) -> None:
    result = await _apply(
        client,
        minutes(
            entries=[
                old_entry("e1", "t1", "decide", "24.04", itemTitle="버전"),
                old_entry("e2", "t1", "defer", "나중에", itemTitle="패치 주기"),
            ]
        ),
    )
    items = await _items(client, "t1")
    assert [title for _, title in items] == ["서버 OS 결정", "버전", "패치 주기"]
    assert [e["itemId"] for e in result["entries"]] == [items[1][0], items[2][0]]
    # 응답에 새로 만든 항목 — 만든 순서 (Q66)
    assert [(i["id"], i["title"]) for i in result["decisionItems"]] == items[1:]
    assert all(set(i) == ITEM_KEYS for i in result["decisionItems"])
    # 새 항목 '패치 주기' 가 정해지지 않아 t1 이 open 으로 돌아갔다
    assert [t["state"] for t in result["updatedThreads"]] == ["open"]


async def test_minutes_empty_title_means_thread_title_or_whole_thread(
    client: httpx.AsyncClient,
) -> None:
    result = await _apply(
        client,
        minutes(
            entries=[
                old_entry("e1", "t4", "decide", "매일"),
                old_entry("e2", "t5", "defer", "또 미룸"),
            ]
        ),
    )
    decided, deferred = result["entries"]
    assert await _items(client, "t4") == [(decided["itemId"], "개발 서버 백업 주기")]
    # 안건 전체 미룸이라 t5 의 항목(di5 · di6)은 그대로다
    assert deferred["itemId"] is None
    assert [i for i, _ in await _items(client, "t5")] == ["di5", "di6"]
    # 안건 제목과 같은 이름의 항목이 이미 있으면 거기로 — 두 번째 결정은 같은 항목을 바꾼다
    again = await _apply(client, minutes(entries=[old_entry("e3", "t4", "decide", "격일")]))
    assert again["entries"][0]["itemId"] == decided["itemId"]
    assert again["decisionItems"] == []


async def test_minutes_new_thread_entry_gets_an_item(client: httpx.AsyncClient) -> None:
    result = await _apply(
        client,
        minutes(
            threads=[
                new_thread("n1", "배포 창구", entry=body("decide", "금요일")),
                new_thread("n2", "로그 보관", entry=body("decide", "1년", itemTitle="기간")),
                new_thread("n3", "모니터링", entry=body("defer", "다음 주")),
            ]
        ),
    )
    ids = result["threadIdByTempId"]
    assert [t["state"] for t in result["threads"]] == ["decided", "decided", "open"]
    assert [title for _, title in await _items(client, ids["n1"])] == ["배포 창구"]
    assert [title for _, title in await _items(client, ids["n2"])] == ["기간"]
    assert await _items(client, ids["n3"]) == []


async def test_minutes_allows_several_items_on_one_thread(client: httpx.AsyncClient) -> None:
    """한 안건에 이력 여럿 — 항목이 다르면 된다. 같은 항목에 둘은 422."""
    result = await _apply(
        client,
        minutes(
            entries=[
                old_entry("e1", "t4", "decide", "매일", itemTitle="주기"),
                old_entry("e2", "t4", "decide", "30일", itemTitle="보관 기간"),
            ]
        ),
    )
    assert len({e["itemId"] for e in result["entries"]}) == 2
    assert [t["state"] for t in result["updatedThreads"]] == ["decided"]

    res = await client.post(
        APPLY,
        json=minutes(
            entries=[
                old_entry("e1", "t3", "decide", "가", itemTitle="범위"),
                old_entry("e2", "t3", "refine", "나", itemTitle=" 범위 "),
            ]
        ),
    )
    assert res.status_code == 422
    assert res.json()["detail"] == {"entries.1.itemTitle": "한 결정 항목에 이력은 하나까지입니다."}
    res = await client.post(
        APPLY, json=minutes(entries=[old_entry("e1", "t3", "decide", "가", itemTitle="가" * 201)])
    )
    assert res.status_code == 422 and "entries.0.itemTitle" in res.json()["detail"]


# --- 지난 데이터 이행 (규칙 8) ---


def test_migration_0031_backfills_one_item_per_decided_thread() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    head = next(i for i, rev in enumerate(revisions) if rev.revision == "0031_decision_item")

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # sqlite 의 batch 는 표를 새로 만들고 옛 표를 지운다 — FK 를 켜 두면 줄이 같이 지워진다
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:head]:
                revision.module.upgrade()
            conn.execute(
                text("insert into project (id, name, task_key_prefix) values ('p', '피', 'P')")
            )
            # h1 정함(결정 · 지운 변경 · 세부 · 미룸) · h2 미룸만 · h3 지운 안건의 결정
            for number, (thread_id, deleted) in enumerate(
                (("h1", False), ("h2", False), ("h3", True)), start=1
            ):
                conn.execute(
                    text(
                        "insert into thread (id, project_id, title, description, state,"
                        " created_at, seq, is_deleted)"
                        " values (:id, 'p', :title, '', 'decided', '2026-09-01 00:00:00', :seq,"
                        " :deleted)"
                    ),
                    {
                        "id": thread_id,
                        "title": f"{thread_id} 안건",
                        "seq": number,
                        "deleted": deleted,
                    },
                )
            lines = [
                ("a", "h1", "defer", "2026-09-01", False),
                ("b", "h1", "decide", "2026-09-03", False),
                ("c", "h1", "change", "2026-09-02", True),
                ("d", "h1", "refine", "2026-09-04", False),
                ("e", "h2", "defer", "2026-09-05", False),
                ("f", "h3", "decide", "2026-09-06", False),
            ]
            for number, (entry_id, thread_id, kind, day, deleted) in enumerate(lines, start=1):
                conn.execute(
                    text(
                        "insert into entry (id, thread_id, kind, text, note, created_at, seq,"
                        " is_deleted) values (:id, :thread, :kind, '줄', '', :at, :seq, :deleted)"
                    ),
                    {
                        "id": entry_id,
                        "thread": thread_id,
                        "kind": kind,
                        "at": f"{day} 00:00:00",
                        "seq": number,
                        "deleted": deleted,
                    },
                )
            revisions[head].module.upgrade()

            items = conn.execute(
                text(
                    "select id, project_id, thread_id, title, creator_id, created_at, is_deleted"
                    " from decision_item"
                )
            ).all()
            assert len(items) == 1
            item = items[0]
            assert item[1:5] == ("p", "h1", "h1 안건", None)
            # 지운 줄까지 그 줄들 가운데 가장 이른 때
            assert str(item[5])[:10] == "2026-09-02" and not item[6]
            got = dict(conn.execute(text("select id, item_id from entry")).all())
            assert got == {
                "a": None,
                "b": item[0],
                "c": item[0],
                "d": item[0],
                "e": None,
                "f": None,
            }

            revisions[head].module.downgrade()
            tables = {row[0] for row in conn.execute(text("select name from sqlite_master")).all()}
            assert "decision_item" not in tables
            columns = {row[1] for row in conn.execute(text("pragma table_info(entry)")).all()}
            assert "item_id" not in columns


def test_item_title_hint_is_in_the_minutes_tool() -> None:
    from app.services.minutes_draft import PROPOSE_TOOL, SYSTEM_PROMPT

    schema = json.dumps(PROPOSE_TOOL["input_schema"], ensure_ascii=False)
    assert "item_title" in schema
    assert "한 항목에 이력은 하나까지" in SYSTEM_PROMPT


async def test_item_of_helper_finds_seed_items(client: httpx.AsyncClient) -> None:
    assert await item_of(client, "t2") == "di2"

"""문서 — `docs/api/document.md`.

시드: p1 안건 t1 · t2(정함, 판 1) · t3(논의중, 판 0) …, t10 은 p2. 파트 pt1(u3) · pt2(u1 · u4) ·
pt3(u2), 시드 소속은 넷 다 켬. u1 은 p1 관리자, u2 ~ u4 는 user, `client` 는 시스템 관리자.
"""

from datetime import UTC, datetime
from typing import Any

import httpx
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentAgenda
from tests.conftest import ADMIN, AsMember, decide

DOCS = "/api/projects/p1/documents"


async def new_doc(c: httpx.AsyncClient, **fields: Any) -> dict[str, Any]:
    res = await c.post(DOCS, json={"title": "서버", "kind": "text", **fields})
    assert res.status_code == 201, res.json()
    body: dict[str, Any] = res.json()
    return body


async def grant(client: httpx.AsyncClient, part_id: str, member_id: str, **rights: bool) -> None:
    res = await client.put(f"/api/parts/{part_id}/members/{member_id}", json=rights)
    assert res.status_code == 200, res.json()


def links(doc: dict[str, Any]) -> list[tuple[str, int]]:
    return [(x["agendaId"], x["seenRev"]) for x in doc["agendas"]]


# --- 만들기 · 읽기 --------------------------------------------------------------------


async def test_create_text_and_read(client: httpx.AsyncClient) -> None:
    doc = await new_doc(client, content="# 서버\n", agendaIds=["t3", "t1"])
    assert set(doc) == {
        "id",
        "projectId",
        "title",
        "kind",
        "partId",
        "agendas",
        "changedAgendaIds",
        "rev",
        "createdBy",
        "createdAt",
        "updatedBy",
        "updatedAt",
        "content",
        "sheet",
    }
    assert (doc["projectId"], doc["title"], doc["kind"], doc["partId"]) == (
        "p1",
        "서버",
        "text",
        None,
    )
    # 연결 순서 그대로, 판은 지금 판
    assert links(doc) == [("t3", 0), ("t1", 1)]
    assert doc["changedAgendaIds"] == []
    assert doc["rev"] == 1
    assert doc["content"] == "# 서버\n"
    assert doc["sheet"] == {"sheets": []}
    assert doc["createdBy"] == doc["updatedBy"] == ADMIN
    assert doc["createdAt"] == doc["updatedAt"]
    assert doc["createdAt"].endswith("Z")

    res = await client.get(f"/api/documents/{doc['id']}")
    assert res.status_code == 200
    assert res.json() == doc


def tab(name: str = "Sheet1", **fields: Any) -> dict[str, Any]:
    """시트 하나 — 안 준 칸은 열 둘 · 빈 값."""
    return {
        "name": name,
        "columns": [{"width": 200}, {"width": 300}],
        "data": [],
        "merges": {},
        "styles": {},
        **fields,
    }


async def test_create_sheet_default_and_given(client: httpx.AsyncClient) -> None:
    plain = await new_doc(client, kind="sheet")
    assert plain["content"] == ""
    assert plain["sheet"] == {
        "sheets": [
            {
                "name": "Sheet1",
                "columns": [{"width": 200}, {"width": 400}],
                "data": [["항목", "내용"]],
                "merges": {},
                "styles": {"A1": "font-weight: bold", "B1": "font-weight: bold"},
            }
        ]
    }
    assert plain["agendas"] == []

    sheet = {
        "sheets": [
            tab(
                data=[["OS", "우분투"], ["RAM", "=SUM(A1:A3)"], ["x"], []],
                merges={"A1": [2, 1]},
                styles={"B2": "font-weight: bold; background-color: #fff2cc"},
            ),
            tab("비용", columns=[{"width": 20}]),
        ]
    }
    given = await new_doc(client, kind="sheet", sheet=sheet)
    # 수식은 계산하지 않고 원문 그대로
    assert given["sheet"] == sheet
    assert (await client.get(f"/api/documents/{given['id']}")).json()["sheet"] == sheet


async def test_title_is_trimmed_and_checked(client: httpx.AsyncClient) -> None:
    assert (await new_doc(client, title="  서버  "))["title"] == "서버"
    for title in ("   ", "가" * 201):
        res = await client.post(DOCS, json={"title": title, "kind": "text"})
        assert res.status_code == 422
        assert "title" in res.json()["detail"]
    res = await client.post(DOCS, json={"title": "서버", "kind": "word"})
    assert res.status_code == 422


async def test_kind_mismatch_is_422(client: httpx.AsyncClient) -> None:
    res = await client.post(DOCS, json={"title": "표", "kind": "sheet", "content": ""})
    assert res.status_code == 422
    assert res.json()["detail"] == {"content": "표 문서에는 본문을 보낼 수 없습니다."}
    sheet = {"sheets": [tab()]}
    res = await client.post(DOCS, json={"title": "글", "kind": "text", "sheet": sheet})
    assert res.status_code == 422
    assert set(res.json()["detail"]) == {"sheet"}

    text_doc = await new_doc(client)
    sheet_doc = await new_doc(client, kind="sheet")
    res = await client.patch(f"/api/documents/{text_doc['id']}", json={"rev": 1, "sheet": sheet})
    assert res.status_code == 422
    assert set(res.json()["detail"]) == {"sheet"}
    res = await client.patch(f"/api/documents/{sheet_doc['id']}", json={"rev": 1, "content": "x"})
    assert res.status_code == 422
    assert set(res.json()["detail"]) == {"content"}
    # kind 는 받지 않는다 — 모르는 키는 버린다
    res = await client.patch(f"/api/documents/{text_doc['id']}", json={"kind": "sheet"})
    assert res.status_code == 200
    assert res.json()["kind"] == "text"


async def test_sheet_shape_is_checked(client: httpx.AsyncClient) -> None:
    one_col = [{"width": 100}]
    bad = [
        {"sheets": []},
        {"sheets": [tab(str(n)) for n in range(11)]},
        {"sheets": [tab("같음"), tab("같음")]},
        {"sheets": [tab("")]},
        {"sheets": [tab("가" * 32)]},
        {"sheets": [tab(columns=[])]},
        {"sheets": [tab(columns=one_col * 16_385)]},
        {"sheets": [tab(columns=one_col, data=[["1", "2"]])]},
        {"sheets": [tab(data=[[]] * 1_048_577)]},
        {"sheets": [tab(data=[["가" * 32_768]])]},
        {"sheets": [tab(data=[[1]])]},
        {"sheets": [tab(columns=[{"width": 19}])]},
        {"sheets": [tab(columns=[{"width": 1001}])]},
        {"sheets": [tab(columns=[{}])]},
        # 열 이름은 걷었다 — 빈 이름이라도 보내면 422
        {"sheets": [tab(columns=[{"title": "a", "width": 100}])]},
        {"sheets": [tab(columns=[{"title": "", "width": 100}])]},
        {"sheets": [tab(merges={"a1": [1, 1]})]},
        {"sheets": [tab(merges={"A0": [1, 1]})]},
        {"sheets": [tab(merges={"1A": [1, 1]})]},
        {"sheets": [tab(merges={"A1": [0, 1]})]},
        {"sheets": [tab(merges={"A1": [1]})]},
        {"sheets": [tab(merges={"A1": [1, 1, 1]})]},
        {"sheets": [tab(merges={"A1": ["2", "1"]})]},
        {"sheets": [tab(styles={"A-1": "color: red"})]},
        # 꼴은 맞아도 엑셀 끝(XFD1048576)을 넘는 주소
        {"sheets": [tab(merges={"XFE1": [1, 1]})]},
        {"sheets": [tab(styles={"A1048577": "color: red"})]},
        {"sheets": [tab(styles={"ZZZ1": "color: red"})]},
        {"sheets": [tab(styles={"A1": "x" * 201})]},
        {"sheets": [{"name": "Sheet1", "columns": one_col, "data": []}]},
        # 칸 하나하나는 넘지 않아도 전체가 5MB 를 넘는다 — 170칸 x 32,767자
        {"sheets": [tab(columns=one_col, data=[["x" * 32_767]] * 170)]},
        {"columns": ["a"], "rows": []},
    ]
    for sheet in bad:
        res = await client.post(DOCS, json={"title": "표", "kind": "sheet", "sheet": sheet})
        assert res.status_code == 422, str(sheet)[:200]
    doc = await new_doc(client, kind="sheet")
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "sheet": bad[0]})
    assert res.status_code == 422
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "sheet": None})
    assert res.status_code == 422
    # 끝 자리는 된다 — 시트 10 · 이름 31 · 열 16,384 · 너비 20 · 1,000 · 칸 32,767 · 스타일 200
    wide = [{"width": 20}] * 16_383 + [{"width": 1000}]
    edge = {
        "sheets": [
            tab(
                "가" * 31,
                columns=wide,
                data=[["가" * 32_767], [""] * 16_384],
                merges={"CV2000": [1, 1], "XFD1048576": [1, 1]},
                styles={"A1": "x" * 200},
            )
        ]
        + [tab(str(n)) for n in range(9)]
    }
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "sheet": edge})
    assert res.status_code == 200, res.json()
    assert res.json()["sheet"] == edge
    # 끌어서 생긴 소수 너비는 정수로 둔다
    soft = {"sheets": [tab(columns=[{"width": 120.6}])]}
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 2, "sheet": soft})
    assert res.status_code == 200
    assert res.json()["sheet"]["sheets"][0]["columns"] == [{"width": 121}]


async def test_sheet_column_title_is_422(client: httpx.AsyncClient) -> None:
    """열 머리는 늘 A · B · C — 옛 화면이 열 이름을 보내도 조용히 잃지 않게 막는다."""
    titled = {"sheets": [tab(columns=[{"title": "항목", "width": 200}])]}
    res = await client.post(DOCS, json={"title": "표", "kind": "sheet", "sheet": titled})
    assert res.status_code == 422
    assert res.json()["detail"] == {"columns": "열 이름은 받지 않습니다. 첫 줄 칸에 적어 주세요."}
    doc = await new_doc(client, kind="sheet")
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "sheet": titled})
    assert res.status_code == 422
    assert (await client.get(f"/api/documents/{doc['id']}")).json()["rev"] == 1


async def test_sheet_rows_up_to_limit(client: httpx.AsyncClient) -> None:
    rows = [["x", "y"]] * 2_000
    doc = await new_doc(client, kind="sheet", sheet={"sheets": [tab(data=rows)]})
    assert len(doc["sheet"]["sheets"][0]["data"]) == 2_000


async def test_same_sheet_keeps_rev(client: httpx.AsyncClient) -> None:
    sheet = {"sheets": [tab(data=[["OS", "우분투"]], merges={"A1": [2, 1]})]}
    doc = await new_doc(client, kind="sheet", sheet=sheet)
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "sheet": sheet})
    assert (res.json()["rev"], res.json()["updatedAt"]) == (1, doc["updatedAt"])


async def test_content_limit(client: httpx.AsyncClient) -> None:
    # 본문은 UTF-8 로 5MB 까지 — 한글은 세 바이트. 편집기가 낸 HTML 을 해석하지 않고 그대로 둔다
    limit = 5 * 1024 * 1024
    over = "<p>" + "가" * ((limit - 7) // 3 + 1) + "</p>"
    res = await client.post(DOCS, json={"title": "글", "kind": "text", "content": over})
    assert res.status_code == 422
    assert set(res.json()["detail"]) == {"content"}
    fits = "<p>" + "가" * ((limit - 7) // 3) + "</p>"
    doc = await new_doc(client, content=fits)
    assert doc["content"] == fits
    res = await client.patch(f"/api/documents/{doc['id']}", json={"rev": 1, "content": over})
    assert res.status_code == 422


async def test_agenda_ids_are_checked(client: httpx.AsyncClient) -> None:
    res = await client.post(DOCS, json={"title": "서버", "kind": "text", "agendaIds": ["t1", "t1"]})
    assert res.status_code == 422
    assert set(res.json()["detail"]) == {"agendaIds"}
    many = [f"a{n}" for n in range(51)]
    res = await client.post(DOCS, json={"title": "서버", "kind": "text", "agendaIds": many})
    assert res.status_code == 422
    # 다른 프로젝트 · 없는 안건
    for agenda_id in ("t10", "nope"):
        res = await client.post(
            DOCS, json={"title": "서버", "kind": "text", "agendaIds": ["t1", agenda_id]}
        )
        assert res.status_code == 400
        assert res.json()["code"] == "DOCUMENT_AGENDA_NOT_FOUND"
        assert res.json()["detail"] == {"agendaIds": agenda_id}
    doc = await new_doc(client)
    res = await client.put(f"/api/documents/{doc['id']}/agendas", json={"agendaIds": ["t10"]})
    assert res.status_code == 400
    assert res.json()["code"] == "DOCUMENT_AGENDA_NOT_FOUND"
    res = await client.put(f"/api/documents/{doc['id']}/agendas", json={"agendaIds": ["t1"] * 2})
    assert res.status_code == 422


async def test_part_must_be_in_project(client: httpx.AsyncClient) -> None:
    res = await client.post(DOCS, json={"title": "서버", "kind": "text", "partId": "nope"})
    assert res.status_code == 400
    assert res.json()["code"] == "PART_NOT_FOUND"
    res = await client.post("/api/projects/p2/documents", json={"title": "x", "kind": "text"})
    doc_id = res.json()["id"]
    res = await client.patch(f"/api/documents/{doc_id}", json={"partId": "pt1"})
    assert res.status_code == 400
    assert res.json()["code"] == "PART_NOT_FOUND"


async def test_missing_document_is_404(client: httpx.AsyncClient) -> None:
    for res in (
        await client.get("/api/documents/nope"),
        await client.patch("/api/documents/nope", json={"partId": None}),
        await client.delete("/api/documents/nope"),
        await client.put("/api/documents/nope/agendas", json={"agendaIds": []}),
        await client.post("/api/documents/nope/confirm", json={}),
    ):
        assert res.status_code == 404
        assert res.json()["code"] == "DOCUMENT_NOT_FOUND"


# --- 목록 ----------------------------------------------------------------------------


async def test_list_order_and_filter(client: httpx.AsyncClient, session: AsyncSession) -> None:
    first = await new_doc(client, title="첫째", agendaIds=["t1"], content="본문")
    second = await new_doc(client, title="둘째", agendaIds=["t2", "t1"])
    third = await new_doc(client, title="셋째")
    other = await client.post("/api/projects/p2/documents", json={"title": "남", "kind": "text"})
    assert other.status_code == 201

    res = await client.get(DOCS)
    assert res.status_code == 200
    rows = res.json()
    # 목록 줄은 본문 · 표를 뺀다
    assert "content" not in rows[0] and "sheet" not in rows[0]
    assert [row["title"] for row in rows] == ["셋째", "둘째", "첫째"]

    # 고치면 맨 위로
    res = await client.patch(f"/api/documents/{first['id']}", json={"rev": 1, "title": "첫째!"})
    assert res.status_code == 200
    assert [row["id"] for row in (await client.get(DOCS)).json()] == [
        first["id"],
        third["id"],
        second["id"],
    ]

    # 고친 때가 같으면 나중에 만든 것(seq 큰 것)이 위
    same = datetime(2026, 11, 1, tzinfo=UTC)
    await session.execute(update(Document).values(updated_at=same))
    await session.commit()
    assert [row["id"] for row in (await client.get(DOCS)).json()] == [
        third["id"],
        second["id"],
        first["id"],
    ]

    res = await client.get(DOCS, params={"agendaId": "t1"})
    assert [row["id"] for row in res.json()] == [second["id"], first["id"]]
    res = await client.get(DOCS, params={"agendaId": "t2"})
    assert [row["id"] for row in res.json()] == [second["id"]]
    assert (await client.get(DOCS, params={"agendaId": "t9"})).json() == []


# --- 판 번호 --------------------------------------------------------------------------


async def test_rev_guards_overwrites(client: httpx.AsyncClient, as_member: AsMember) -> None:
    doc = await new_doc(client, content="처음")
    url = f"/api/documents/{doc['id']}"
    u2 = await as_member("u2")

    res = await u2.patch(url, json={"rev": 1, "content": "u2 가 고침"})
    assert res.status_code == 200
    body = res.json()
    assert (body["rev"], body["content"], body["updatedBy"]) == (2, "u2 가 고침", "u2")
    assert body["createdBy"] == ADMIN

    # 옛 판으로 덮으려 하면 409 — 지금 판 · 고친 사람 · 시각을 싣는다
    res = await client.patch(url, json={"rev": 1, "content": "내 글"})
    assert res.status_code == 409
    assert res.json()["code"] == "DOCUMENT_STALE"
    assert res.json()["detail"] == {
        "rev": 2,
        "updatedBy": "u2",
        "updatedAt": body["updatedAt"],
    }
    assert (await client.get(url)).json()["content"] == "u2 가 고침"

    # 제목 · 본문 · 표를 보내면서 rev 가 없으면 422
    for sent in ({"title": "새 제목"}, {"content": "x"}, {"rev": None, "title": "x"}):
        res = await client.patch(url, json=sent)
        assert res.status_code == 422
        assert set(res.json()["detail"]) == {"rev"}
    for sent in ({"rev": 2, "title": None}, {"rev": 2, "content": None}):
        assert (await client.patch(url, json=sent)).status_code == 422

    # 같은 값을 다시 보내면 판이 그대로다
    res = await client.patch(url, json={"rev": 2, "content": "u2 가 고침", "title": "서버"})
    assert res.json()["rev"] == 2
    assert res.json()["updatedBy"] == "u2"

    # 파트는 판을 안 올리고 rev 도 안 본다
    res = await client.patch(url, json={"partId": "pt1", "rev": 99})
    assert res.status_code == 200
    assert (res.json()["partId"], res.json()["rev"], res.json()["updatedBy"]) == (
        "pt1",
        2,
        ADMIN,
    )
    res = await client.patch(url, json={"rev": 2, "title": "  새 제목 "})
    assert (res.json()["title"], res.json()["rev"]) == ("새 제목", 3)


# --- 연결 · 결정 바뀜 · 확인 -------------------------------------------------------------


async def test_put_agendas_keeps_seen_rev(client: httpx.AsyncClient) -> None:
    doc = await new_doc(client, agendaIds=["t1", "t3"])
    url = f"/api/documents/{doc['id']}"
    assert (await decide(client, "t1", "우분투 24.04 로 한다")).status_code == 200
    assert (await decide(client, "t2", "postgresql 을 쓴다")).status_code == 200

    got = (await client.get(url)).json()
    assert got["changedAgendaIds"] == ["t1"]
    # t1 은 남아 옛 판 그대로, t2 는 새로 들어와 지금 판(2), t3 은 빠진다
    res = await client.put(f"{url}/agendas", json={"agendaIds": ["t2", "t1"]})
    assert res.status_code == 200
    body = res.json()
    assert links(body) == [("t2", 2), ("t1", 1)]
    assert body["changedAgendaIds"] == ["t1"]
    # 연결은 판을 안 올린다
    assert body["rev"] == 1

    res = await client.put(f"{url}/agendas", json={"agendaIds": []})
    assert res.json()["agendas"] == [] and res.json()["changedAgendaIds"] == []


async def test_changed_and_confirm(client: httpx.AsyncClient) -> None:
    doc = await new_doc(client, agendaIds=["t1", "t2", "t3"])
    url = f"/api/documents/{doc['id']}"
    for agenda_id in ("t1", "t2"):
        assert (await decide(client, agenda_id, f"{agenda_id} 다시 정함")).status_code == 200
    rows = (await client.get(DOCS)).json()
    assert rows[0]["changedAgendaIds"] == ["t1", "t2"]

    # 연결 안 된 안건은 400 — 다른 것도 안 바뀐다
    res = await client.post(f"{url}/confirm", json={"agendaIds": ["t2", "t4"]})
    assert res.status_code == 400
    assert res.json()["code"] == "DOCUMENT_AGENDA_NOT_LINKED"
    assert res.json()["detail"] == {"agendaIds": "t4"}
    assert (await client.get(url)).json()["changedAgendaIds"] == ["t1", "t2"]

    res = await client.post(f"{url}/confirm", json={"agendaIds": ["t2"]})
    assert res.status_code == 200
    assert res.json()["changedAgendaIds"] == ["t1"]
    assert links(res.json()) == [("t1", 1), ("t2", 2), ("t3", 0)]
    assert res.json()["rev"] == 1

    res = await client.post(f"{url}/confirm", json={})
    assert res.json()["changedAgendaIds"] == []
    assert links(res.json()) == [("t1", 2), ("t2", 2), ("t3", 0)]


async def test_deleted_agenda_is_filtered(client: httpx.AsyncClient, session: AsyncSession) -> None:
    doc = await new_doc(client, agendaIds=["t1", "t2"])
    url = f"/api/documents/{doc['id']}"
    assert (await decide(client, "t2", "바뀜")).status_code == 200
    assert (await client.delete("/api/agendas/t2")).status_code == 204

    body = (await client.get(url)).json()
    assert links(body) == [("t1", 1)]
    assert body["changedAgendaIds"] == []
    assert (await client.get(DOCS, params={"agendaId": "t2"})).json() == []
    # 줄은 남아 있다
    count = select(func.count()).select_from(DocumentAgenda)
    assert await session.scalar(count.where(DocumentAgenda.document_id == doc["id"])) == 2
    # 지운 안건은 확인 · 연결할 수 없다
    res = await client.post(f"{url}/confirm", json={"agendaIds": ["t2"]})
    assert res.json()["code"] == "DOCUMENT_AGENDA_NOT_LINKED"
    res = await client.put(f"{url}/agendas", json={"agendaIds": ["t1", "t2"]})
    assert res.json()["code"] == "DOCUMENT_AGENDA_NOT_FOUND"
    # 다시 맞추면 그때 빠진다
    res = await client.put(f"{url}/agendas", json={"agendaIds": ["t1"]})
    assert res.status_code == 200
    assert await session.scalar(count.where(DocumentAgenda.document_id == doc["id"])) == 1


async def test_delete_cascades_links(client: httpx.AsyncClient, session: AsyncSession) -> None:
    doc = await new_doc(client, agendaIds=["t1", "t2"])
    assert (await client.delete(f"/api/documents/{doc['id']}")).status_code == 204
    assert (await client.get(f"/api/documents/{doc['id']}")).status_code == 404
    assert await session.scalar(select(func.count()).select_from(DocumentAgenda)) == 0


# --- 권한 ----------------------------------------------------------------------------


async def test_common_document_rights(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2, u3 = await as_member("u2"), await as_member("u3")
    u1 = await as_member("u1")
    doc = await new_doc(u2, agendaIds=["t1"])
    url = f"/api/documents/{doc['id']}"
    assert doc["createdBy"] == "u2"

    # 멤버 누구나 고치고 · 연결하고 · 확인한다
    res = await u3.patch(url, json={"rev": 1, "content": "u3"})
    assert res.status_code == 200
    assert (await u3.put(f"{url}/agendas", json={"agendaIds": ["t2"]})).status_code == 200
    assert (await u3.post(f"{url}/confirm", json={})).status_code == 200
    # 지우기는 만든 사람 · 관리자만
    res = await u3.delete(url)
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    assert (await u2.delete(url)).status_code == 204

    other = await new_doc(u3)
    assert (await u1.delete(f"/api/documents/{other['id']}")).status_code == 204


async def test_part_document_rights(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2, u3, u4 = await as_member("u2"), await as_member("u3"), await as_member("u4")
    # 만들기 — 그 파트의 등록 권한
    res = await u2.post(DOCS, json={"title": "인프라", "kind": "text", "partId": "pt1"})
    assert res.status_code == 403
    assert res.json()["code"] == "FORBIDDEN"
    doc = await new_doc(u3, partId="pt1", agendaIds=["t1"])
    url = f"/api/documents/{doc['id']}"

    # 보기는 멤버 누구나
    assert (await u2.get(url)).status_code == 200
    assert len((await u2.get(DOCS)).json()) == 1
    # 그 파트 권한이 없으면 고치기 · 연결 · 확인 · 지우기 다 막힘
    for res in (
        await u2.patch(url, json={"rev": 1, "content": "x"}),
        await u2.patch(url, json={"partId": None}),
        await u2.put(f"{url}/agendas", json={"agendaIds": []}),
        await u2.post(f"{url}/confirm", json={}),
        await u2.delete(url),
    ):
        assert res.status_code == 403, res.json()

    # 수정 권한만 받으면 고치기는 되고 지우기는 안 된다
    await grant(client, "pt1", "u2", canDelete=False)
    assert (await u2.patch(url, json={"rev": 1, "content": "u2"})).status_code == 200
    assert (await u2.put(f"{url}/agendas", json={"agendaIds": ["t2"]})).status_code == 200
    assert (await u2.delete(url)).status_code == 403
    # 다른 파트로 옮기면 옮겨 갈 파트의 수정 권한도
    res = await u2.patch(url, json={"partId": "pt2"})
    assert res.status_code == 403
    assert (await u2.patch(url, json={"partId": "pt3"})).json()["partId"] == "pt3"
    assert (await u2.patch(url, json={"partId": "pt1"})).json()["partId"] == "pt1"
    # 삭제 권한까지 받으면 지운다
    await grant(client, "pt1", "u2", canDelete=True)
    assert (await u2.delete(url)).status_code == 204

    # 만든 사람은 파트 권한이 없어져도 고치고 지운다
    mine = await new_doc(u3, partId="pt1")
    mine_url = f"/api/documents/{mine['id']}"
    await grant(client, "pt1", "u3", canView=False, canCreate=False, canUpdate=False)
    assert (await u3.patch(mine_url, json={"rev": 1, "title": "내 것"})).status_code == 200
    assert (await u4.patch(mine_url, json={"rev": 2, "title": "남의 것"})).status_code == 403
    # 관리자(u1)는 다 된다
    u1 = await as_member("u1")
    assert (await u1.patch(mine_url, json={"rev": 2, "title": "관리자"})).status_code == 200
    assert (await u3.delete(mine_url)).status_code == 204


async def test_outsider_sees_404(client: httpx.AsyncClient, as_member: AsMember) -> None:
    """부여받지 않은 프로젝트의 문서는 없는 것과 같다."""
    doc = await new_doc(client)
    res = await client.delete("/api/projects/p1/members/u4")
    assert res.status_code == 204, res.text
    u4 = await as_member("u4")
    res = await u4.get(f"/api/documents/{doc['id']}")
    assert res.status_code == 404
    assert res.json()["code"] == "DOCUMENT_NOT_FOUND"


# --- 이행 0041 -----------------------------------------------------------------------


def test_migration_up_and_down() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0041_document")

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[: at + 1]:
                revision.module.upgrade()
            tables = set(inspect(conn).get_table_names())
            assert {"document", "document_agenda"} <= tables
            revisions[at].module.downgrade()
            tables = set(inspect(conn).get_table_names())
            assert not {"document", "document_agenda"} & tables


# --- 이행 0042 -----------------------------------------------------------------------

OLD_SHEET = {"columns": ["항목", "내용"], "rows": [["OS", "우분투"], ["RAM", "4GB"]]}
NEW_SHEET = {
    "sheets": [
        {
            "name": "Sheet1",
            "columns": [{"title": "항목", "width": 160}, {"title": "내용", "width": 160}],
            "data": [["OS", "우분투"], ["RAM", "4GB"]],
            "merges": {},
            "styles": {},
        }
    ]
}


def test_migration_0042_converts_sheets() -> None:
    """옛 {columns, rows} → SheetBook, 글은 빈 책. 내리면 첫 시트만 옛 꼴로, 다시 올려도 같다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0042_document_sheet_book")
    book = revisions[at].module

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # 문서만 넣어 본다 — 프로젝트 · 멤버 줄 없이
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:at]:
                revision.module.upgrade()
            at_time = datetime(2026, 11, 12, tzinfo=UTC)
            for doc_id, kind, sheet in (
                ("d1", "sheet", OLD_SHEET),
                ("d2", "text", {"columns": [], "rows": []}),
            ):
                conn.execute(
                    Document.__table__.insert().values(
                        id=doc_id,
                        project_id="p1",
                        title="문서",
                        kind=kind,
                        content="",
                        sheet=sheet,
                        rev=1,
                        created_at=at_time,
                        updated_at=at_time,
                        seq=1 if doc_id == "d1" else 2,
                    )
                )

            def sheets() -> dict[str, Any]:
                table = Document.__table__
                return dict(conn.execute(select(table.c.id, table.c.sheet)).tuples().all())

            book.upgrade()
            assert sheets() == {"d1": NEW_SHEET, "d2": {"sheets": []}}
            # 두 번 돌아도 그대로
            book.upgrade()
            assert sheets() == {"d1": NEW_SHEET, "d2": {"sheets": []}}

            # 둘째 시트 · 병합 · 꾸밈 · 너비는 내릴 때 잃는다. 모자란 칸은 빈 칸으로
            richer = {
                "sheets": [
                    {
                        **NEW_SHEET["sheets"][0],
                        "data": [["OS"], ["RAM", "4GB"]],
                        "merges": {"A1": [2, 1]},
                        "styles": {"A1": "font-weight: bold"},
                    },
                    {**NEW_SHEET["sheets"][0], "name": "둘째"},
                ]
            }
            conn.execute(
                update(Document.__table__)
                .where(Document.__table__.c.id == "d1")
                .values(sheet=richer)
            )
            book.downgrade()
            assert sheets() == {
                "d1": {"columns": ["항목", "내용"], "rows": [["OS", ""], ["RAM", "4GB"]]},
                "d2": {"columns": [], "rows": []},
            }
            book.upgrade()
            assert sheets()["d2"] == {"sheets": []}
            assert sheets()["d1"]["sheets"][0]["data"] == [["OS", ""], ["RAM", "4GB"]]


# --- 이행 0043 -----------------------------------------------------------------------


def test_migration_0043_moves_titles_to_first_row() -> None:
    """열 이름이 있으면 첫 줄로 끼우고 주소를 내린다. 다 비면 줄 없이 너비만. 내리면 title ''."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0043_document_sheet_header")
    header = revisions[at].module

    named = {
        "name": "Sheet1",
        "columns": [{"title": "항목", "width": 200}, {"title": "", "width": 400}],
        "data": [["OS", "우분투"], ["RAM"]],
        "merges": {"A1": [2, 1], "B9": [1, 2]},
        "styles": {"A1": "font-weight: bold", "AB12": "color: red"},
    }
    blank = {
        "name": "둘째",
        "columns": [{"title": "", "width": 160}, {"title": " ", "width": 160}],
        "data": [["x"]],
        "merges": {"A1": [1, 1]},
        "styles": {},
    }
    # 개발 DB 의 표 문서 — 열 이름만 있고 줄이 없다
    empty = {**named, "columns": [{"title": "항목", "width": 200}, {"title": "내용", "width": 400}]}
    empty = {**empty, "data": [], "merges": {}, "styles": {}}
    up_named = {
        "name": "Sheet1",
        "columns": [{"width": 200}, {"width": 400}],
        "data": [["항목", ""], ["OS", "우분투"], ["RAM"]],
        "merges": {"A2": [2, 1], "B10": [1, 2]},
        "styles": {"A2": "font-weight: bold", "AB13": "color: red"},
    }
    up_blank = {**blank, "columns": [{"width": 160}, {"width": 160}]}
    up_empty = {**empty, "columns": [{"width": 200}, {"width": 400}], "data": [["항목", "내용"]]}

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:at]:
                revision.module.upgrade()
            at_time = datetime(2026, 11, 12, tzinfo=UTC)
            for seq, (doc_id, kind, sheet) in enumerate(
                (
                    ("d1", "sheet", {"sheets": [named, blank]}),
                    ("d2", "sheet", {"sheets": [empty]}),
                    ("d3", "text", {"sheets": []}),
                ),
                start=1,
            ):
                conn.execute(
                    Document.__table__.insert().values(
                        id=doc_id,
                        project_id="p1",
                        title="문서",
                        kind=kind,
                        content="",
                        sheet=sheet,
                        rev=1,
                        created_at=at_time,
                        updated_at=at_time,
                        seq=seq,
                    )
                )

            def sheets() -> dict[str, Any]:
                table = Document.__table__
                return dict(conn.execute(select(table.c.id, table.c.sheet)).tuples().all())

            upped = {
                "d1": {"sheets": [up_named, up_blank]},
                "d2": {"sheets": [up_empty]},
                "d3": {"sheets": []},
            }
            header.upgrade()
            assert sheets() == upped
            # 두 번 돌아도 그대로 — 줄을 또 끼우지 않는다
            header.upgrade()
            assert sheets() == upped

            header.downgrade()
            down = sheets()
            assert down["d1"]["sheets"][0]["columns"] == [
                {"title": "", "width": 200},
                {"title": "", "width": 400},
            ]
            # 첫 줄은 되돌리지 않는다
            assert down["d1"]["sheets"][0]["data"] == up_named["data"]
            assert down["d3"] == {"sheets": []}
            header.downgrade()
            assert sheets() == down

            # 다시 올리면 이름이 다 비어 줄은 끼우지 않는다 — 올린 꼴과 같다
            header.upgrade()
            assert sheets() == upped


async def test_on_postgres(pg_client: httpx.AsyncClient) -> None:
    """jsonb 표 · Identity seq · 시각 정렬을 진짜 Postgres 에서 — 닿지 않으면 건너뛴다."""
    sheet = {"sheets": [tab(data=[["OS", "우분투"]], merges={"A1": [2, 1]})]}
    first = (
        await pg_client.post(DOCS, json={"title": "표", "kind": "sheet", "sheet": sheet})
    ).json()
    second = await new_doc(pg_client, agendaIds=["t1"])
    rows = (await pg_client.get(DOCS)).json()
    assert [row["id"] for row in rows] == [second["id"], first["id"]]
    res = await pg_client.patch(
        f"/api/documents/{first['id']}", json={"rev": 1, "sheet": {"sheets": [tab("둘")]}}
    )
    assert res.status_code == 200
    assert (res.json()["rev"], res.json()["sheet"]) == (2, {"sheets": [tab("둘")]})
    # jsonb 에서 읽어 같은 표를 다시 보내면 판이 안 오른다
    res = await pg_client.patch(
        f"/api/documents/{first['id']}", json={"rev": 2, "sheet": {"sheets": [tab("둘")]}}
    )
    assert res.json()["rev"] == 2
    assert (await decide(pg_client, "t1", "우분투 24.04")).status_code == 200
    got = (await pg_client.get(f"/api/documents/{second['id']}")).json()
    assert got["changedAgendaIds"] == ["t1"]

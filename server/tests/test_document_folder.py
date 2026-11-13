"""문서 폴더 — `docs/api/document.md` '폴더'.

시드: u1 은 p1 관리자, u2 ~ u4 는 user, `client` 는 시스템 관리자. pt1 의 소속은 u3.
"""

from datetime import UTC, datetime
from typing import Any

import httpx
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentFolder
from tests.conftest import ADMIN, AsMember

FOLDERS = "/api/projects/p1/document-folders"
DOCS = "/api/projects/p1/documents"
LONG_AGO = datetime(2026, 11, 1, tzinfo=UTC)


async def new_folder(c: httpx.AsyncClient, name: str, parent: str | None = None) -> dict[str, Any]:
    res = await c.post(FOLDERS, json={"name": name, "parentId": parent})
    assert res.status_code == 201, res.json()
    body: dict[str, Any] = res.json()
    return body


async def chain(c: httpx.AsyncClient, depth: int, prefix: str = "단") -> list[str]:
    """맨 위부터 `depth` 단까지 한 줄로 내려가는 폴더들."""
    ids: list[str] = []
    for level in range(1, depth + 1):
        ids.append((await new_folder(c, f"{prefix}{level}", ids[-1] if ids else None))["id"])
    return ids


def url(folder_id: str) -> str:
    return f"/api/document-folders/{folder_id}"


# --- 만들기 · 목록 -------------------------------------------------------------------


async def test_create_and_list(client: httpx.AsyncClient) -> None:
    top = await new_folder(client, "  나  ")
    assert top["name"] == "나"
    assert (top["projectId"], top["parentId"], top["createdBy"]) == ("p1", None, ADMIN)
    assert top["createdAt"] == top["updatedAt"]
    assert top["createdAt"].endswith("Z")

    first = await new_folder(client, "다", top["id"])
    await new_folder(client, "가")
    second = await new_folder(client, "다")
    rows = (await client.get(FOLDERS)).json()
    # 이름순, 같으면 먼저 만든 것
    assert [row["name"] for row in rows] == ["가", "나", "다", "다"]
    assert [row["id"] for row in rows[2:]] == [first["id"], second["id"]]
    assert rows[2]["parentId"] == top["id"]
    # 다른 프로젝트 목록엔 안 나온다
    assert (await client.get("/api/projects/p2/document-folders")).json() == []


async def test_name_is_checked(client: httpx.AsyncClient) -> None:
    folder = await new_folder(client, "가" * 100)
    for name in ("   ", "가" * 101, None):
        res = await client.post(FOLDERS, json={"name": name})
        assert res.status_code == 422, name
        assert "name" in res.json()["detail"]
        res = await client.patch(url(folder["id"]), json={"name": name})
        assert res.status_code == 422, name
    assert (await client.post(FOLDERS, json={})).status_code == 422


async def test_name_taken_under_same_parent(client: httpx.AsyncClient) -> None:
    top = await new_folder(client, "인프라")
    res = await client.post(FOLDERS, json={"name": " 인프라 "})
    assert res.status_code == 409
    assert res.json()["code"] == "DOCUMENT_FOLDER_NAME_TAKEN"
    assert res.json()["detail"] == {"name": "인프라"}
    # 다른 부모 아래 · 대소문자가 다르면 된다
    inner = await new_folder(client, "인프라", top["id"])
    await new_folder(client, "Infra")
    await new_folder(client, "infra")

    # 이름 바꾸기 · 옮기기도 같은 부모 아래 겹치면 409
    other = await new_folder(client, "서버")
    res = await client.patch(url(other["id"]), json={"name": "Infra"})
    assert res.status_code == 409
    res = await client.patch(url(inner["id"]), json={"parentId": None})
    assert res.status_code == 409
    # 옮기면서 이름을 바꾸면 겹치지 않는다
    res = await client.patch(url(inner["id"]), json={"parentId": None, "name": "인프라2"})
    assert res.status_code == 200
    assert (res.json()["parentId"], res.json()["name"]) == (None, "인프라2")


async def test_same_values_keep_updated_at(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    await new_folder(client, "인프라")
    # 시각이 초까지라 같은 초에 겹치지 않게 미리 옛날로 돌려 둔다
    await session.execute(update(DocumentFolder).values(updated_at=LONG_AGO))
    await session.commit()
    folder = (await client.get(FOLDERS)).json()[0]
    res = await client.patch(url(folder["id"]), json={"name": " 인프라 ", "parentId": None})
    assert res.status_code == 200
    assert res.json() == folder
    res = await client.patch(url(folder["id"]), json={"name": "서버"})
    assert res.json()["name"] == "서버"
    assert res.json()["updatedAt"] > folder["updatedAt"]
    assert res.json()["createdAt"] == folder["createdAt"]


async def test_parent_must_be_in_project(client: httpx.AsyncClient) -> None:
    elsewhere = (
        await client.post("/api/projects/p2/document-folders", json={"name": "이관"})
    ).json()
    folder = await new_folder(client, "인프라")
    for parent in (elsewhere["id"], "nope"):
        res = await client.post(FOLDERS, json={"name": "하위", "parentId": parent})
        assert res.status_code == 400
        assert res.json()["code"] == "DOCUMENT_FOLDER_NOT_FOUND"
        assert res.json()["detail"] == {"parentId": parent}
        res = await client.patch(url(folder["id"]), json={"parentId": parent})
        assert res.status_code == 400
        assert res.json()["detail"] == {"parentId": parent}


async def test_missing_folder_is_404(client: httpx.AsyncClient, as_member: AsMember) -> None:
    for res in (
        await client.patch(url("nope"), json={"name": "x"}),
        await client.delete(url("nope")),
    ):
        assert res.status_code == 404
        assert res.json()["code"] == "DOCUMENT_FOLDER_NOT_FOUND"
    # 부여받지 않은 프로젝트의 폴더는 없는 것과 같다
    folder = await new_folder(client, "인프라")
    assert (await client.delete("/api/projects/p1/members/u4")).status_code == 204
    u4 = await as_member("u4")
    res = await u4.patch(url(folder["id"]), json={"name": "x"})
    assert res.status_code == 404
    assert res.json()["code"] == "DOCUMENT_FOLDER_NOT_FOUND"
    assert (await u4.get(FOLDERS)).status_code == 404


# --- 옮기기 · 고리 · 깊이 ---------------------------------------------------------------


async def test_cycle_is_400(client: httpx.AsyncClient) -> None:
    a, b, c = await chain(client, 3)
    for parent in (a, b, c):
        res = await client.patch(url(a), json={"parentId": parent})
        assert res.status_code == 400
        assert res.json()["code"] == "DOCUMENT_FOLDER_CYCLE"
        assert res.json()["detail"] == {"parentId": parent}
    # 하위를 위로 올리는 것은 된다
    res = await client.patch(url(c), json={"parentId": None})
    assert (res.status_code, res.json()["parentId"]) == (200, None)


async def test_depth_is_five(client: httpx.AsyncClient) -> None:
    levels = await chain(client, 5)
    res = await client.post(FOLDERS, json={"name": "여섯", "parentId": levels[-1]})
    assert res.status_code == 400
    assert res.json()["code"] == "DOCUMENT_FOLDER_TOO_DEEP"
    assert res.json()["detail"] == {"parentId": levels[-1]}

    # 옮기면 딸린 하위까지 센다 — 두 단짜리를 4단 아래로는 못, 3단 아래로는 된다
    top, _ = await chain(client, 2, "짝")
    res = await client.patch(url(top), json={"parentId": levels[3]})
    assert res.status_code == 400
    assert res.json()["code"] == "DOCUMENT_FOLDER_TOO_DEEP"
    res = await client.patch(url(top), json={"parentId": levels[2]})
    assert res.status_code == 200
    # 맨 위로 꺼내면 다시 얕아진다
    assert (await client.patch(url(levels[1]), json={"parentId": None})).status_code == 200
    assert (await new_folder(client, "다시", levels[-1]))["parentId"] == levels[-1]


# --- 지우기 ------------------------------------------------------------------------


async def test_delete_only_empty(client: httpx.AsyncClient) -> None:
    top = await new_folder(client, "인프라")
    inner = await new_folder(client, "서버", top["id"])
    res = await client.delete(url(top["id"]))
    assert res.status_code == 409
    assert res.json()["code"] == "DOCUMENT_FOLDER_NOT_EMPTY"

    doc = await client.post(DOCS, json={"title": "OS", "kind": "text", "folderId": inner["id"]})
    assert doc.status_code == 201
    assert (await client.delete(url(inner["id"]))).status_code == 409
    assert (await client.delete(f"/api/documents/{doc.json()['id']}")).status_code == 204
    assert (await client.delete(url(inner["id"]))).status_code == 204
    assert (await client.delete(url(top["id"]))).status_code == 204
    assert (await client.get(FOLDERS)).json() == []


async def test_folder_rights(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u1, u2, u3 = await as_member("u1"), await as_member("u2"), await as_member("u3")
    mine = await new_folder(u2, "u2 의 것")
    assert mine["createdBy"] == "u2"
    # 만들기 · 이름 · 옮기기는 멤버 누구나
    parent = await new_folder(u3, "u3 의 것")
    res = await u3.patch(url(mine["id"]), json={"name": "고침", "parentId": parent["id"]})
    assert res.status_code == 200
    # 지우기는 관리자 · 만든 사람 — 비었는지보다 먼저 본다
    res = await u3.delete(url(parent["id"]))
    assert res.status_code == 409
    for res in (await u2.delete(url(parent["id"])), await u3.delete(url(mine["id"]))):
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"
    assert (await u2.delete(url(mine["id"]))).status_code == 204
    assert (await u1.delete(url(parent["id"]))).status_code == 204


# --- 문서의 폴더 -------------------------------------------------------------------


async def test_document_folder_id(client: httpx.AsyncClient, session: AsyncSession) -> None:
    folder = await new_folder(client, "인프라")
    other = await new_folder(client, "비용")
    res = await client.post(DOCS, json={"title": "OS", "kind": "text", "folderId": folder["id"]})
    doc = res.json()
    assert doc["folderId"] == folder["id"]
    plain = (await client.post(DOCS, json={"title": "맨 위", "kind": "text"})).json()
    assert plain["folderId"] is None
    rows = {row["id"]: row["folderId"] for row in (await client.get(DOCS)).json()}
    assert rows == {doc["id"]: folder["id"], plain["id"]: None}

    doc_url = f"/api/documents/{doc['id']}"
    await session.execute(update(Document).values(updated_at=LONG_AGO))
    await session.commit()
    doc = (await client.get(doc_url)).json()
    # 같은 폴더로 다시 보내면 아무것도 안 바뀐다
    res = await client.patch(doc_url, json={"folderId": folder["id"]})
    assert res.json() == doc
    # 옮기면 판은 그대로, updatedAt 은 찍는다 — rev 를 실어 와도 보지 않는다
    res = await client.patch(doc_url, json={"folderId": other["id"], "rev": 99})
    assert res.status_code == 200
    moved = res.json()
    assert (moved["folderId"], moved["rev"]) == (other["id"], 1)
    assert moved["updatedAt"] > doc["updatedAt"]
    res = await client.patch(doc_url, json={"folderId": None})
    assert res.json()["folderId"] is None


async def test_document_folder_must_be_in_project(client: httpx.AsyncClient) -> None:
    elsewhere = (
        await client.post("/api/projects/p2/document-folders", json={"name": "이관"})
    ).json()
    doc = (await client.post(DOCS, json={"title": "OS", "kind": "text"})).json()
    for folder_id in (elsewhere["id"], "nope"):
        res = await client.post(DOCS, json={"title": "x", "kind": "text", "folderId": folder_id})
        assert res.status_code == 400
        assert res.json()["code"] == "DOCUMENT_FOLDER_NOT_FOUND"
        assert res.json()["detail"] == {"folderId": folder_id}
        res = await client.patch(f"/api/documents/{doc['id']}", json={"folderId": folder_id})
        assert res.status_code == 400
        assert res.json()["detail"] == {"folderId": folder_id}


async def test_document_move_needs_edit_right(
    client: httpx.AsyncClient, as_member: AsMember
) -> None:
    u2, u3 = await as_member("u2"), await as_member("u3")
    folder = await new_folder(u2, "인프라")
    # 만들 때 고른 폴더는 따로 막지 않는다
    doc = (
        await u3.post(
            DOCS, json={"title": "OS", "kind": "text", "partId": "pt1", "folderId": folder["id"]}
        )
    ).json()
    doc_url = f"/api/documents/{doc['id']}"
    # 그 파트 문서를 못 고치면 폴더도 못 옮긴다 — 폴더가 없어도 403 이 먼저다
    for folder_id in (None, "nope"):
        res = await u2.patch(doc_url, json={"folderId": folder_id})
        assert res.status_code == 403
        assert res.json()["code"] == "FORBIDDEN"
    res = await u3.patch(doc_url, json={"folderId": None})
    assert (res.status_code, res.json()["folderId"]) == (200, None)


# --- 이행 0044 -----------------------------------------------------------------------


def test_migration_0044_up_down_up() -> None:
    """있던 문서는 맨 위(null). 내리면 칸 · 표가 빠지고 문서는 남는다, 다시 올려도 같다."""
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revisions = list(reversed(list(script.walk_revisions("base", "heads"))))
    at = next(i for i, rev in enumerate(revisions) if rev.revision == "0044_document_folder")
    folder = revisions[at].module

    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        # 문서만 넣어 본다 — 프로젝트 · 멤버 줄 없이
        conn.exec_driver_sql("pragma foreign_keys=off")
        conn.commit()
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            for revision in revisions[:at]:
                revision.module.upgrade()
            stamp = datetime(2026, 11, 12, tzinfo=UTC).isoformat()
            conn.execute(
                text(
                    "insert into document (id, project_id, title, kind, content, sheet, rev, "
                    "created_at, updated_at, seq) values "
                    "('d1', 'p1', '서버', 'text', '', '{\"sheets\": []}', 1, :at, :at, 1)"
                ),
                {"at": stamp},
            )

            def columns() -> set[str]:
                return {column["name"] for column in inspect(conn).get_columns("document")}

            folder.upgrade()
            assert "document_folder" in inspect(conn).get_table_names()
            assert conn.execute(text("select folder_id from document")).all() == [(None,)]
            folder.downgrade()
            assert "document_folder" not in inspect(conn).get_table_names()
            assert "folder_id" not in columns()
            assert conn.execute(text("select id, title from document")).all() == [("d1", "서버")]
            folder.upgrade()
            assert "folder_id" in columns()
            assert conn.execute(text("select folder_id from document")).all() == [(None,)]


async def test_on_postgres(pg_client: httpx.AsyncClient) -> None:
    """자기 참조 복합 FK · Identity seq · 이름 정렬을 진짜 Postgres 에서 — 닿지 않으면 건너뛴다."""
    pg_folders = "/api/projects/p1/document-folders"
    top = (await pg_client.post(pg_folders, json={"name": "나"})).json()
    inner = (await pg_client.post(pg_folders, json={"name": "가", "parentId": top["id"]})).json()
    again = (await pg_client.post(pg_folders, json={"name": "가"})).json()
    rows = (await pg_client.get(pg_folders)).json()
    assert [row["id"] for row in rows] == [inner["id"], again["id"], top["id"]]
    res = await pg_client.post(DOCS, json={"title": "OS", "kind": "text", "folderId": inner["id"]})
    assert res.status_code == 201
    assert (await pg_client.delete(url(inner["id"]))).status_code == 409
    res = await pg_client.patch(f"/api/documents/{res.json()['id']}", json={"folderId": None})
    assert res.json()["folderId"] is None
    assert (await pg_client.delete(url(inner["id"]))).status_code == 204
    assert (await pg_client.delete(url(top["id"]))).status_code == 204

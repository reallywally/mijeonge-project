"""프로필 사진 — `docs/api/me.md`.

걸기 · 바꾸기 · 지우기 · 읽기 · 관리자 지우기 · 검사 · `Member` · `Me` 의 `avatarUrl`.
시드에는 사진이 없다(모두 null 로 시작).
"""

import base64
import re

import httpx
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MemberAvatar
from app.services.avatar import MAX_BYTES
from scripts.seed import DEV_PASSWORD
from tests.conftest import AsMember
from tests.test_contract_types import contract_keys

AVATAR = "/api/auth/me/avatar"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 40

_URL = re.compile(r"^/api/members/(\w+)/avatar\?v=(\d+)$")


def data_url(content_type: str, data: bytes) -> str:
    return f"data:{content_type};base64,{base64.b64encode(data).decode()}"


async def _put(c: httpx.AsyncClient, url: str) -> httpx.Response:
    return await c.put(AVATAR, json={"dataUrl": url})


async def _avatar_of(c: httpx.AsyncClient, member_id: str) -> str | None:
    rows = (await c.get("/api/members")).json()
    found: str | None = next(row["avatarUrl"] for row in rows if row["id"] == member_id)
    return found


async def test_starts_without_avatars(client: httpx.AsyncClient) -> None:
    rows = (await client.get("/api/members")).json()
    assert rows and all(row["avatarUrl"] is None for row in rows)
    assert (await client.get("/api/auth/me")).json()["avatarUrl"] is None


@pytest.mark.parametrize(
    ("content_type", "data"),
    [("image/png", PNG), ("image/jpeg", JPEG), ("image/webp", WEBP)],
    ids=["png", "jpeg", "webp"],
)
async def test_put_then_get_bytes(as_member: AsMember, content_type: str, data: bytes) -> None:
    u2 = await as_member("u2")
    res = await _put(u2, data_url(content_type, data))
    assert res.status_code == 200, res.json()
    me = res.json()
    assert set(me) == contract_keys("Me")
    found = _URL.match(me["avatarUrl"])
    assert found and found.group(1) == "u2"

    # 목록 · /me 가 같은 주소를 낸다
    assert await _avatar_of(u2, "u2") == me["avatarUrl"]
    assert (await u2.get("/api/auth/me")).json()["avatarUrl"] == me["avatarUrl"]

    image = await u2.get(me["avatarUrl"])
    assert image.status_code == 200
    assert image.content == data
    assert image.headers["content-type"] == content_type
    assert image.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert image.headers["x-content-type-options"] == "nosniff"


async def test_anyone_logged_in_can_read(
    client: httpx.AsyncClient, as_member: AsMember, anon: httpx.AsyncClient
) -> None:
    u2 = await as_member("u2")
    await _put(u2, data_url("image/png", PNG))
    # 다른 프로젝트 부여와 상관없이 — 관리자 · 다른 멤버 모두
    assert (await client.get("/api/members/u2/avatar")).content == PNG
    assert (await (await as_member("u3")).get("/api/members/u2/avatar")).content == PNG
    # 로그인은 해야 한다
    res = await anon.get("/api/members/u2/avatar")
    assert res.status_code == 401


async def test_missing_avatar_is_404(client: httpx.AsyncClient) -> None:
    for member_id in ("u2", "nobody"):
        res = await client.get(f"/api/members/{member_id}/avatar")
        assert res.status_code == 404
        assert res.json()["code"] == "AVATAR_NOT_FOUND"


async def test_replace_changes_url(as_member: AsMember, session: AsyncSession) -> None:
    u2 = await as_member("u2")
    await _put(u2, data_url("image/png", PNG))
    # 같은 밀리초에 두 번 바꾸면 주소가 같을 수 있다 — 바뀐 시각을 앞으로 당겨 둔다
    row = await session.get(MemberAvatar, "u2")
    assert row is not None
    row.updated_at = row.updated_at.replace(year=2020)
    await session.commit()
    first = (await u2.get("/api/auth/me")).json()["avatarUrl"]

    second = (await _put(u2, data_url("image/jpeg", JPEG))).json()["avatarUrl"]
    assert second != first
    image = await u2.get(second)
    assert image.content == JPEG and image.headers["content-type"] == "image/jpeg"
    # 한 사람에 한 장
    assert await session.scalar(select(func.count()).select_from(MemberAvatar)) == 1


async def test_delete_mine_is_idempotent(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    await _put(u2, data_url("image/png", PNG))
    for _ in range(2):
        res = await u2.delete(AVATAR)
        assert res.status_code == 200
        assert res.json()["avatarUrl"] is None
    assert await _avatar_of(u2, "u2") is None
    assert (await u2.get("/api/members/u2/avatar")).status_code == 404


async def test_others_avatar_is_untouched(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    u3 = await as_member("u3")
    await _put(u2, data_url("image/png", PNG))
    await u3.delete(AVATAR)
    assert await _avatar_of(u3, "u2") is not None


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("not a data url", "AVATAR_INVALID"),
        (f"data:image/png,{base64.b64encode(PNG).decode()}", "AVATAR_INVALID"),
        (data_url("image/gif", b"GIF89a" + b"\x00" * 10), "AVATAR_INVALID"),
        (data_url("image/svg+xml", b"<svg/>"), "AVATAR_INVALID"),
        ("data:image/png;base64,@@@@", "AVATAR_INVALID"),
        ("data:image/png;base64,iVBORw0", "AVATAR_INVALID"),
        # 첫머리가 알린 종류와 다르다
        (data_url("image/png", JPEG), "AVATAR_INVALID"),
        (data_url("image/jpeg", PNG), "AVATAR_INVALID"),
        (data_url("image/webp", b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 8), "AVATAR_INVALID"),
        ("data:image/png;base64,", "AVATAR_INVALID"),
        (data_url("image/png", PNG + b"\x00" * MAX_BYTES), "AVATAR_TOO_LARGE"),
    ],
    ids=[
        "not-data-url",
        "not-base64",
        "gif",
        "svg",
        "broken-base64",
        "bad-padding",
        "png-says-jpeg",
        "jpeg-says-png",
        "riff-not-webp",
        "empty",
        "too-large",
    ],
)
async def test_rejects(client: httpx.AsyncClient, url: str, code: str) -> None:
    res = await _put(client, url)
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == code
    assert set(body["detail"]) == {"dataUrl"}
    assert (await client.get("/api/auth/me")).json()["avatarUrl"] is None


async def test_exactly_512kb_is_allowed(client: httpx.AsyncClient) -> None:
    data = PNG + b"\x00" * (MAX_BYTES - len(PNG))
    assert len(data) == MAX_BYTES
    res = await _put(client, data_url("image/png", data))
    assert res.status_code == 200, res.json()


async def test_missing_field_is_422(client: httpx.AsyncClient) -> None:
    res = await client.put(AVATAR, json={})
    assert res.status_code == 422
    assert "dataUrl" in res.json()["detail"]


async def test_write_is_json_only(client: httpx.AsyncClient) -> None:
    res = await client.put(
        AVATAR, content=data_url("image/png", PNG), headers={"content-type": "text/plain"}
    )
    assert res.status_code == 415


async def test_login_required(anon: httpx.AsyncClient) -> None:
    assert (await _put(anon, data_url("image/png", PNG))).status_code == 401
    assert (await anon.delete(AVATAR)).status_code == 401


async def test_admin_can_remove_others(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    await _put(u2, data_url("image/png", PNG))
    for _ in range(2):
        res = await client.delete("/api/admin/members/u2/avatar")
        assert res.status_code == 204
    assert await _avatar_of(client, "u2") is None
    res = await client.delete("/api/admin/members/nobody/avatar")
    assert res.status_code == 404
    assert res.json()["code"] == "MEMBER_NOT_FOUND"


async def test_non_admin_cannot_remove_others(as_member: AsMember) -> None:
    u2 = await as_member("u2")
    await _put(u2, data_url("image/png", PNG))
    # u1 은 p1 의 프로젝트 관리자지만 시스템 관리자가 아니다
    res = await (await as_member("u1")).delete("/api/admin/members/u2/avatar")
    assert res.status_code == 403
    assert await _avatar_of(u2, "u2") is not None


async def test_login_answer_has_avatar(as_member: AsMember, anon: httpx.AsyncClient) -> None:
    u1 = await as_member("u1")
    url = (await _put(u1, data_url("image/webp", WEBP))).json()["avatarUrl"]
    res = await anon.post(
        "/api/auth/login", json={"email": "u1@inno-ax.com", "password": DEV_PASSWORD}
    )
    assert res.status_code == 200
    assert res.json()["avatarUrl"] == url


async def test_member_list_is_one_query(
    client: httpx.AsyncClient, as_member: AsMember, session: AsyncSession
) -> None:
    """사진이 있어도 멤버마다 따로 묻지 않는다 — 바깥 조인 한 번."""
    for member_id in ("u2", "u3"):
        await _put(await as_member(member_id), data_url("image/png", PNG))
    statements: list[str] = []

    def record(_conn: object, _cursor: object, statement: str, *_: object) -> None:
        if "member_avatar" in statement:
            statements.append(statement)

    engine = session.bind.sync_engine  # type: ignore[union-attr]
    event.listen(engine, "before_cursor_execute", record)
    try:
        rows = (await client.get("/api/members")).json()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert sum(row["avatarUrl"] is not None for row in rows) == 2
    assert len(statements) == 1
    # 바이트는 읽지 않는다
    assert "member_avatar.data" not in statements[0]

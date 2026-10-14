"""사용자 관리 — `/api/admin/members*` (시스템 관리자만)."""

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Member
from scripts.seed import DEV_PASSWORD
from tests.conftest import AsMember
from tests.test_contract_types import contract_keys

URL = "/api/admin/members"
NEW = {
    "name": "최유진",
    "email": "YuJin@innoflow.local",
    "password": "처음-비밀번호-01",
    "systemRole": "user",
}


async def _login(c: httpx.AsyncClient, email: str, password: str) -> int:
    res = await c.post("/api/auth/login", json={"email": email, "password": password})
    return res.status_code


async def test_only_system_admin(as_member: AsMember) -> None:
    u1 = await as_member("u1")  # p1 의 관리자여도 사용자 관리는 못 한다
    for method, url, body in [
        ("GET", URL, None),
        ("POST", URL, NEW),
        ("PATCH", f"{URL}/u2", {"name": "바꿈"}),
        ("PUT", f"{URL}/u2/password", {"password": "새-비밀번호-0123"}),
    ]:
        res = await u1.request(method, url, json=body)
        assert res.status_code == 403, (method, url)
        assert res.json()["code"] == "FORBIDDEN"


async def test_list_includes_inactive_by_name(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    u2 = await session.get(Member, "u2")
    assert u2 is not None
    u2.active = False
    await session.commit()

    rows = (await client.get(URL)).json()
    assert [row["name"] for row in rows] == ["관리자", "김서연", "박지훈", "이도현", "정하늘"]
    assert all(set(row) == contract_keys("MemberAccount") for row in rows)
    by_id = {row["id"]: row for row in rows}
    assert by_id["u2"]["active"] is False
    assert by_id["admin"]["systemRole"] == "admin"
    assert by_id["u1"]["hasPassword"] is True
    assert by_id["u1"]["email"] == "u1@innoflow.local"
    assert by_id["u1"]["createdAt"].endswith("Z")
    assert by_id["u1"]["lastLoginAt"] is None


async def test_create_then_log_in(client: httpx.AsyncClient, anon: httpx.AsyncClient) -> None:
    res = await client.post(URL, json=NEW)
    assert res.status_code == 201
    account = res.json()
    assert set(account) == contract_keys("MemberAccount")
    assert account["email"] == "yujin@innoflow.local"  # 소문자로 저장한다
    assert account["active"] is True and account["hasPassword"] is True

    assert await _login(anon, "yujin@innoflow.local", NEW["password"]) == 200
    # 프로젝트는 아직 하나도 부여받지 않았다
    assert (await anon.get("/api/projects")).json() == []

    listed = {row["id"]: row for row in (await client.get(URL)).json()}
    assert listed[account["id"]]["lastLoginAt"] is not None


async def test_create_rules(client: httpx.AsyncClient) -> None:
    taken = await client.post(URL, json=NEW | {"email": "U1@innoflow.local"})
    assert taken.status_code == 409
    assert taken.json()["code"] == "EMAIL_TAKEN"

    for bad in (
        {"password": "짧다"},
        {"email": "골뱅이없음"},
        {"name": "   "},
        {"systemRole": "owner"},
    ):
        res = await client.post(URL, json=NEW | bad)
        assert res.status_code == 422, bad
        assert set(bad) <= set(res.json()["detail"])


async def test_patch_name_and_email(client: httpx.AsyncClient, anon: httpx.AsyncClient) -> None:
    res = await client.patch(
        f"{URL}/u2", json={"name": "박지훈B", "email": "jihoon@innoflow.local"}
    )
    assert res.status_code == 200
    assert res.json()["name"] == "박지훈B"
    assert res.json()["email"] == "jihoon@innoflow.local"

    # 로그인 이메일도 같이 옮겨 갔다
    assert await _login(anon, "u2@innoflow.local", DEV_PASSWORD) == 401
    assert await _login(anon, "jihoon@innoflow.local", DEV_PASSWORD) == 200


async def test_profile_create_patch_and_clear(client: httpx.AsyncClient) -> None:
    made = await client.post(
        URL, json={**NEW, "career": " 보험 시스템 7년 ", "skills": "Java, Spring", "notes": ""}
    )
    assert made.status_code == 201
    body = made.json()
    assert body["career"] == "보험 시스템 7년"
    assert body["skills"] == "Java, Spring"
    assert body["notes"] is None  # 빈 글은 null 로 둔다

    member_id = body["id"]
    res = await client.patch(f"{URL}/{member_id}", json={"notes": "10월 말까지 휴가"})
    assert res.json()["notes"] == "10월 말까지 휴가"
    assert res.json()["career"] == "보험 시스템 7년"  # 안 보낸 칸은 그대로

    # 소개 칸은 null 이나 공백으로 비운다
    res = await client.patch(f"{URL}/{member_id}", json={"career": None, "skills": "   "})
    assert res.status_code == 200
    assert res.json()["career"] is None
    assert res.json()["skills"] is None
    assert res.json()["notes"] == "10월 말까지 휴가"

    too_long = await client.patch(f"{URL}/{member_id}", json={"skills": "가" * 2001})
    assert too_long.status_code == 422

    listed = {row["id"]: row for row in (await client.get(URL)).json()}
    assert listed["u1"]["career"] is None


async def test_patch_rules(client: httpx.AsyncClient) -> None:
    taken = await client.patch(f"{URL}/u2", json={"email": "u3@innoflow.local"})
    assert taken.status_code == 409
    assert taken.json()["code"] == "EMAIL_TAKEN"

    # 자기 이메일을 그대로 보내는 것은 겹친 것이 아니다
    same = await client.patch(f"{URL}/u2", json={"email": "u2@innoflow.local"})
    assert same.status_code == 200

    missing = await client.patch(f"{URL}/nobody", json={"name": "누구"})
    assert missing.status_code == 404
    assert missing.json()["code"] == "MEMBER_NOT_FOUND"

    for field in ("name", "email", "systemRole", "active"):
        res = await client.patch(f"{URL}/u2", json={field: None})
        assert res.status_code == 422, field


async def test_deactivate_drops_sessions(client: httpx.AsyncClient, as_member: AsMember) -> None:
    u2 = await as_member("u2")
    assert (await u2.get("/api/projects")).status_code == 200

    res = await client.patch(f"{URL}/u2", json={"active": False})
    assert res.status_code == 200
    assert res.json()["active"] is False

    gone = await u2.get("/api/projects")
    assert gone.status_code == 401
    assert gone.json()["code"] == "UNAUTHENTICATED"


async def test_last_system_admin_cannot_step_down(client: httpx.AsyncClient) -> None:
    for change in ({"systemRole": "user"}, {"active": False}):
        res = await client.patch(f"{URL}/admin", json=change)
        assert res.status_code == 409, change
        assert res.json()["code"] == "LAST_SYSTEM_ADMIN"

    # 한 사람 더 올리면 내려갈 수 있다
    assert (await client.patch(f"{URL}/u1", json={"systemRole": "admin"})).status_code == 200
    assert (await client.patch(f"{URL}/admin", json={"systemRole": "user"})).status_code == 200


async def test_inactive_admin_does_not_count(client: httpx.AsyncClient) -> None:
    """비활성 관리자는 사용자를 관리할 수 없다 — 남은 관리자로 세지 않는다."""
    await client.patch(f"{URL}/u1", json={"systemRole": "admin"})
    await client.patch(f"{URL}/u1", json={"active": False})
    res = await client.patch(f"{URL}/admin", json={"active": False})
    assert res.status_code == 409


async def test_set_password(
    client: httpx.AsyncClient, as_member: AsMember, anon: httpx.AsyncClient
) -> None:
    u3 = await as_member("u3")
    res = await client.put(f"{URL}/u3/password", json={"password": "관리자가-건-비밀번호"})
    assert res.status_code == 204
    assert (await u3.get("/api/auth/me")).status_code == 401  # 세션이 모두 끊긴다
    assert await _login(anon, "u3@innoflow.local", "관리자가-건-비밀번호") == 200


async def test_set_password_rules(client: httpx.AsyncClient, session: AsyncSession) -> None:
    member = Member(id="noemail", name="이메일 없음")
    session.add(member)
    await session.commit()

    res = await client.put(f"{URL}/noemail/password", json={"password": "비밀번호-0123456"})
    assert res.status_code == 400
    assert res.json()["code"] == "MEMBER_EMAIL_REQUIRED"

    missing = await client.put(f"{URL}/nobody/password", json={"password": "비밀번호-0123456"})
    assert missing.status_code == 404
    assert missing.json()["code"] == "MEMBER_NOT_FOUND"

    short = await client.put(f"{URL}/u1/password", json={"password": "짧다"})
    assert short.status_code == 422

    # 이메일을 넣어 주면 비밀번호를 걸 수 있고, 그때부터 들어온다
    await client.patch(f"{URL}/noemail", json={"email": "new@innoflow.local"})
    assert (
        await client.put(f"{URL}/noemail/password", json={"password": "비밀번호-0123456"})
    ).status_code == 204
    rows = {row["id"]: row for row in (await client.get(URL)).json()}
    assert rows["noemail"]["hasPassword"] is True

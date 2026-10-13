"""로그인 · 세션 · 비밀번호 — `docs/api/auth.md` '로그인 · 나'.

시드의 개발용 계정으로 실제 로그인 API 를 부른다(argon2 를 진짜로 돌린다).
"""

from datetime import timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthSession, Member
from app.services.auth import COOKIE, hash_token
from app.time import as_utc, now
from scripts.seed import DEV_ADMIN_EMAIL, DEV_PASSWORD
from tests.conftest import AsMember
from tests.test_contract_types import contract_keys

LOGIN = "/api/auth/login"


async def _login(c: httpx.AsyncClient, email: str, password: str = DEV_PASSWORD) -> httpx.Response:
    return await c.post(LOGIN, json={"email": email, "password": password})


async def _sessions_of(session: AsyncSession, member_id: str) -> int:
    counted = await session.scalar(
        select(func.count()).select_from(AuthSession).where(AuthSession.member_id == member_id)
    )
    return counted or 0


# --- 로그인 -------------------------------------------------------------------


async def test_login_sets_cookie_and_answers_me(anon: httpx.AsyncClient) -> None:
    res = await _login(anon, "u1@innoflow.local")
    assert res.status_code == 200
    me = res.json()
    assert set(me) == contract_keys("Me")
    assert me["id"] == "u1"
    assert me["systemRole"] == "user"
    # 시드에서 u1 은 p1 의 관리자, 나머지는 user 다
    assert me["projectRoles"] == {"p1": "admin", "p2": "user", "p3": "user"}

    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=")
    lowered = cookie.lower()
    assert "httponly" in lowered and "samesite=lax" in lowered and "path=/api" in lowered
    assert "secure" not in lowered  # 개발 설정은 cookie_secure=False

    # 그 쿠키로 다음 요청이 통한다
    assert (await anon.get("/api/auth/me")).json() == me


async def test_admin_me_has_no_project_roles(anon: httpx.AsyncClient) -> None:
    """시스템 관리자는 부여 없이 다 보지만 projectRoles 에는 부여받은 것만 실린다."""
    me = (await _login(anon, DEV_ADMIN_EMAIL)).json()
    assert me["systemRole"] == "admin"
    assert me["projectRoles"] == {}


async def test_email_is_case_insensitive(anon: httpx.AsyncClient) -> None:
    assert (await _login(anon, "  U2@InnoFlow.LOCAL ")).status_code == 200


async def test_failures_look_the_same(anon: httpx.AsyncClient, session: AsyncSession) -> None:
    """이메일이 없는지 · 비밀번호가 틀렸는지 · 비활성인지 가르지 않는다."""
    u3 = await session.get(Member, "u3")
    assert u3 is not None
    u3.active = False
    await session.commit()

    answers = [
        await _login(anon, "nobody@innoflow.local"),
        await _login(anon, "u1@innoflow.local", "틀린-비밀번호-입니다"),
        await _login(anon, "u3@innoflow.local"),
        await _login(anon, "형식도 아님"),
    ]
    assert {res.status_code for res in answers} == {401}
    assert len({res.text for res in answers}) == 1
    assert answers[0].json()["code"] == "INVALID_CREDENTIALS"
    assert all("set-cookie" not in res.headers for res in answers)


async def test_member_without_email_cannot_log_in(
    anon: httpx.AsyncClient, session: AsyncSession
) -> None:
    """리비전이 옛 멤버를 email=null 로 둔다 — 관리자가 넣어 줘야 들어온다."""
    u4 = await session.get(Member, "u4")
    assert u4 is not None
    u4.email = None
    await session.commit()
    # 자격 증명은 아직 옛 이메일을 들고 있지만 멤버에 이메일이 없으면 Me 를 만들 수 없다
    res = await _login(anon, "u4@innoflow.local")
    assert res.status_code == 401


async def test_too_many_attempts_is_429(anon: httpx.AsyncClient) -> None:
    for _ in range(10):
        assert (await _login(anon, "nobody@innoflow.local")).status_code == 401
    res = await _login(anon, "u1@innoflow.local")  # 맞는 비밀번호여도 막힌다
    assert res.status_code == 429
    assert res.json()["code"] == "TOO_MANY_ATTEMPTS"


async def test_missing_fields_are_422(anon: httpx.AsyncClient) -> None:
    res = await anon.post(LOGIN, json={"email": "u1@innoflow.local"})
    assert res.status_code == 422
    assert res.json()["code"] == "VALIDATION_ERROR"


async def test_login_again_drops_the_old_session(
    anon: httpx.AsyncClient, session: AsyncSession
) -> None:
    await _login(anon, "u1@innoflow.local")
    await _login(anon, "u1@innoflow.local")
    assert await _sessions_of(session, "u1") == 1


async def test_token_is_stored_only_as_sha256(
    anon: httpx.AsyncClient, session: AsyncSession
) -> None:
    await _login(anon, "u2@innoflow.local")
    token = anon.cookies[COOKIE]
    stored = (
        await session.scalars(select(AuthSession.token_hash).where(AuthSession.member_id == "u2"))
    ).all()
    assert stored == [hash_token(token)]
    assert token not in stored


# --- 로그인이 필요하다 ---------------------------------------------------------


async def test_everything_but_health_and_login_needs_a_session(anon: httpx.AsyncClient) -> None:
    for method, url in [
        ("GET", "/api/projects"),
        ("GET", "/api/members"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/projects/p1/snapshot"),
        ("GET", "/api/tasks/k4/comments"),
        ("PATCH", "/api/threads/t1"),
        ("GET", "/api/admin/members"),
        ("POST", "/api/auth/password"),
    ]:
        res = await anon.request(method, url, json={} if method != "GET" else None)
        assert res.status_code == 401, (method, url)
        assert res.json()["code"] == "UNAUTHENTICATED"
    assert (await anon.get("/api/health")).status_code == 200


async def test_unknown_cookie_is_401(anon: httpx.AsyncClient) -> None:
    anon.cookies.set(COOKIE, "not-a-real-token")
    res = await anon.get("/api/projects")
    assert res.status_code == 401
    assert res.json()["code"] == "UNAUTHENTICATED"


# --- 세션 수명 -----------------------------------------------------------------


async def test_expired_session_is_401_and_gone(
    anon: httpx.AsyncClient, session: AsyncSession
) -> None:
    await _login(anon, "u1@innoflow.local")
    row = (await session.scalars(select(AuthSession).where(AuthSession.member_id == "u1"))).one()
    row.expires_at = now() - timedelta(seconds=1)
    await session.commit()

    res = await anon.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["code"] == "UNAUTHENTICATED"
    assert await _sessions_of(session, "u1") == 0


async def test_session_slides_once_an_hour(anon: httpx.AsyncClient, session: AsyncSession) -> None:
    await _login(anon, "u1@innoflow.local")
    row = (await session.scalars(select(AuthSession).where(AuthSession.member_id == "u1"))).one()

    # 방금 쓴 세션은 다시 쓰지 않는다 — 쿠키도 다시 굽지 않는다
    quiet = await anon.get("/api/auth/me")
    assert "set-cookie" not in quiet.headers

    long_ago = now() - timedelta(hours=2)
    row.last_seen_at = long_ago
    row.expires_at = long_ago + timedelta(days=1)
    await session.commit()

    res = await anon.get("/api/auth/me")
    assert res.status_code == 200
    assert res.headers["set-cookie"].startswith(f"{COOKIE}=")
    await session.refresh(row)
    assert as_utc(row.last_seen_at) > long_ago
    assert as_utc(row.expires_at) - now() > timedelta(days=13)


# --- 로그아웃 -------------------------------------------------------------------


async def test_logout_ends_the_session(anon: httpx.AsyncClient, session: AsyncSession) -> None:
    await _login(anon, "u1@innoflow.local")
    token = anon.cookies[COOKIE]

    res = await anon.post("/api/auth/logout")
    assert res.status_code == 204
    assert f'{COOKIE}=""' in res.headers["set-cookie"] or "max-age=0" in (
        res.headers["set-cookie"].lower()
    )
    assert await _sessions_of(session, "u1") == 0

    # 쿠키를 다시 들고 와도 끝난 세션이다
    anon.cookies.set(COOKIE, token)
    assert (await anon.get("/api/auth/me")).status_code == 401


async def test_logout_without_a_session_is_204(anon: httpx.AsyncClient) -> None:
    assert (await anon.post("/api/auth/logout")).status_code == 204
    assert (await anon.post("/api/auth/logout")).status_code == 204


# --- 내 비밀번호 바꾸기 -----------------------------------------------------------


async def test_change_password_drops_my_other_sessions(
    anon: httpx.AsyncClient, as_member: AsMember, session: AsyncSession
) -> None:
    other = await as_member("u1")  # 다른 브라우저의 같은 사람
    await _login(anon, "u1@innoflow.local")

    res = await anon.post(
        "/api/auth/password",
        json={"currentPassword": DEV_PASSWORD, "newPassword": "새-비밀번호-0123"},
    )
    assert res.status_code == 204
    assert (await anon.get("/api/auth/me")).status_code == 200  # 이 세션은 산다
    assert (await other.get("/api/auth/me")).status_code == 401  # 다른 세션은 끊긴다
    assert await _sessions_of(session, "u1") == 1

    async with httpx.AsyncClient(transport=anon._transport, base_url="http://test") as fresh:
        assert (await _login(fresh, "u1@innoflow.local")).status_code == 401
        assert (await _login(fresh, "u1@innoflow.local", "새-비밀번호-0123")).status_code == 200


async def test_change_password_with_wrong_current_is_400(anon: httpx.AsyncClient) -> None:
    await _login(anon, "u1@innoflow.local")
    res = await anon.post(
        "/api/auth/password",
        json={"currentPassword": "틀린-비밀번호-입니다", "newPassword": "새-비밀번호-0123"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_CREDENTIALS"


async def test_password_length_rule(anon: httpx.AsyncClient) -> None:
    await _login(anon, "u1@innoflow.local")
    for bad in ("짧다", "x" * 201):
        res = await anon.post(
            "/api/auth/password", json={"currentPassword": DEV_PASSWORD, "newPassword": bad}
        )
        assert res.status_code == 422
        assert "newPassword" in res.json()["detail"]


# --- 쓰기는 JSON 만 -------------------------------------------------------------


async def test_form_posts_are_415(client: httpx.AsyncClient) -> None:
    """폼 전송으로는 쓰기 요청을 못 만든다 — CSRF (docs/api/auth.md '쿠키')."""
    form = await client.post("/api/projects/p1/threads", data={"title": "폼으로"})
    assert form.status_code == 415
    assert form.json()["code"] == "UNSUPPORTED_MEDIA_TYPE"

    plain = await client.post(
        "/api/projects/p1/threads",
        content='{"title": "text/plain 으로"}',
        headers={"content-type": "text/plain"},
    )
    assert plain.status_code == 415

    # 본문이 비어도 Content-Type 을 싣고 오면 막는다 — 빈 폼도 그렇다
    empty_form = await client.post(
        "/api/auth/logout", headers={"content-type": "application/x-www-form-urlencoded"}
    )
    assert empty_form.status_code == 415

    charset = await client.post(
        "/api/projects/p1/threads",
        content='{"title": "charset 붙은 JSON"}',
        headers={"content-type": "application/json; charset=utf-8"},
    )
    assert charset.status_code == 201


async def test_bodyless_writes_pass(client: httpx.AsyncClient) -> None:
    """본문도 Content-Type 도 없는 PUT · DELETE 는 받는다 — 링크 걸기 · 빼기가 그렇다."""
    assert (await client.put("/api/tasks/k1/threads/t1")).status_code == 200
    assert (await client.delete("/api/tasks/k1/threads/t1")).status_code == 204

"""로그인 · 세션 · 비밀번호. 계약은 `docs/api/auth.md`.

세션은 서버에 둔다(JWT 아님) — 비활성화 · 비밀번호 변경 · 로그아웃이 그 순간 먹어야 한다.
쿠키에는 난수 토큰을, DB 에는 그 sha256 만 둔다.
"""

import asyncio
import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.errors import ApiError
from app.models import AuthIdentity, AuthSession, Member, ProjectMember
from app.schemas.auth import MeOut
from app.time import as_utc, now

PASSWORD = "password"
COOKIE = "innoflow_session"
# last_seen_at 은 요청마다 쓰지 않는다 — 읽기 요청이 전부 쓰기가 되지 않게
TOUCH_EVERY = timedelta(hours=1)

_hasher = PasswordHasher()


@dataclass(frozen=True)
class Actor:
    """지금 요청을 보낸 사람."""

    id: str
    is_admin: bool
    session_id: str


def unauthenticated() -> ApiError:
    return ApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.")


def invalid_credentials(status: int = 401) -> ApiError:
    # 이메일이 없는지 · 비밀번호가 틀렸는지 · 비활성인지 가르지 않는다
    return ApiError(status, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def hash_password(password: str) -> str:
    # argon2 는 일부러 느리다 — 이벤트 루프를 붙잡지 않게 스레드로 넘긴다
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    # 계정이 없어도 같은 만큼 계산한다 — 응답 시간으로 있는 이메일을 가려내지 못하게
    target = password_hash if password_hash is not None else _dummy_hash()
    try:
        await asyncio.to_thread(_hasher.verify, target, password)
    except (VerificationError, InvalidHashError):
        return False
    return password_hash is not None


@cache
def _dummy_hash() -> str:
    return _hasher.hash(secrets.token_urlsafe(16))


async def start_session(session: AsyncSession, member_id: str) -> str:
    """새 세션을 만들고 쿠키에 실을 토큰을 돌려준다. 커밋한다."""
    token = secrets.token_urlsafe(32)
    moment = now()
    session.add(
        AuthSession(
            token_hash=hash_token(token),
            member_id=member_id,
            created_at=moment,
            last_seen_at=moment,
            expires_at=moment + timedelta(days=settings.session_days),
        )
    )
    await session.commit()
    return token


async def resume_session(session: AsyncSession, token: str) -> tuple[Actor, bool] | None:
    """(누구인가, 만료를 밀었나). 끝난 세션 · 비활성 멤버면 None.

    밀었으면 라우트가 쿠키도 다시 굽는다 — 쿠키 수명도 같이 미끄러져야 한다.
    """
    found = await session.execute(
        select(AuthSession, Member)
        .join(Member, Member.id == AuthSession.member_id)
        .where(AuthSession.token_hash == hash_token(token))
    )
    row = found.tuples().one_or_none()
    if row is None:
        return None
    auth, member = row
    moment = now()
    if as_utc(auth.expires_at) <= moment or not member.active:
        await session.delete(auth)
        await session.commit()
        return None

    touched = moment - as_utc(auth.last_seen_at) >= TOUCH_EVERY
    if touched:
        auth.last_seen_at = moment
        auth.expires_at = moment + timedelta(days=settings.session_days)
        await session.commit()
    return Actor(id=member.id, is_admin=member.system_role == "admin", session_id=auth.id), touched


async def end_session(session: AsyncSession, token: str) -> None:
    await session.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    await session.commit()


async def end_member_sessions(
    session: AsyncSession, member_id: str, keep_session_id: str | None = None
) -> None:
    """그 사람의 세션을 모두 끊는다. 커밋하지 않는다 — 부른 쪽의 변경과 한 트랜잭션이다."""
    stmt = delete(AuthSession).where(AuthSession.member_id == member_id)
    if keep_session_id is not None:
        stmt = stmt.where(AuthSession.id != keep_session_id)
    await session.execute(stmt)


async def password_identity(session: AsyncSession, member_id: str) -> AuthIdentity | None:
    found = await session.execute(
        select(AuthIdentity).where(
            AuthIdentity.member_id == member_id, AuthIdentity.provider == PASSWORD
        )
    )
    return found.scalar_one_or_none()


async def login(session: AsyncSession, email: str, password: str) -> tuple[str, MeOut]:
    """맞으면 (토큰, Me). 틀리면 이유를 가르지 않고 401."""
    found = await session.execute(
        select(AuthIdentity, Member)
        .join(Member, Member.id == AuthIdentity.member_id)
        .where(AuthIdentity.provider == PASSWORD, AuthIdentity.subject == email)
    )
    row = found.tuples().one_or_none()
    identity, member = row if row is not None else (None, None)
    ok = await verify_password(identity.password_hash if identity else None, password)
    if identity is None or member is None or not ok or not member.active:
        raise invalid_credentials()

    identity.last_login_at = now()
    if identity.password_hash and _hasher.check_needs_rehash(identity.password_hash):
        # 해시 강도를 올린 뒤에도 옛 해시가 남지 않게 맞는 비밀번호를 받은 김에 바꾼다
        identity.password_hash = await hash_password(password)
    token = await start_session(session, member.id)
    return token, await me(session, member.id)


async def me(session: AsyncSession, member_id: str) -> MeOut:
    member = await session.get(Member, member_id)
    if member is None or member.email is None:
        raise unauthenticated()
    roles = await session.execute(
        select(ProjectMember.project_id, ProjectMember.role).where(
            ProjectMember.member_id == member_id
        )
    )
    return MeOut.model_validate(
        {
            "id": member.id,
            "name": member.name,
            "email": member.email,
            "system_role": member.system_role,
            "project_roles": dict(roles.tuples().all()),
        }
    )


async def change_password(
    session: AsyncSession, actor: Actor, current_password: str, new_password: str
) -> None:
    identity = await password_identity(session, actor.id)
    if identity is None or not await verify_password(identity.password_hash, current_password):
        raise invalid_credentials(400)
    identity.password_hash = await hash_password(new_password)
    # 이 세션 말고는 끊는다 — 비밀번호를 바꾸는 이유가 대개 '누가 내 계정을 쓰는 것 같다' 다
    await end_member_sessions(session, actor.id, keep_session_id=actor.session_id)
    await session.commit()

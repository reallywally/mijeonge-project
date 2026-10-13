from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import (
    CurrentActor,
    Session,
    clear_session_cookie,
    set_session_cookie,
)
from app.config import settings
from app.errors import ApiError
from app.schemas.auth import LoginInput, MeOut, PasswordChange
from app.services import auth as auth_service
from app.services.auth import COOKIE
from app.services.ratelimit import RateLimiter

router = APIRouter(prefix="/auth", tags=["auth"])

# 챗봇과 같은 장치를 따로 하나 둔다 — 로그인 시도가 질문 횟수를 먹지 않게
_limiter = RateLimiter(settings.login_rate_per_minute)


def get_login_limiter() -> RateLimiter:
    return _limiter


@router.post("/login")
async def login(
    payload: LoginInput,
    request: Request,
    response: Response,
    session: Session,
    limiter: Annotated[RateLimiter, Depends(get_login_limiter)],
) -> MeOut:
    """맞으면 세션 쿠키를 굽는다. 틀린 이유는 가르지 않는다."""
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        raise ApiError(
            429, "TOO_MANY_ATTEMPTS", "로그인 시도가 너무 잦습니다. 잠시 뒤에 다시 해 주세요."
        )
    # 이미 들고 온 세션은 버린다 — 로그인 전후로 같은 토큰을 쓰지 않게
    old = request.cookies.get(COOKIE)
    if old:
        await auth_service.end_session(session, old)
    token, me = await auth_service.login(session, payload.email, payload.password)
    set_session_cookie(response, token)
    return me


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, session: Session) -> None:
    """세션이 없어도 204 다 — 멱등. 그래서 로그인을 요구하지 않는다."""
    token = request.cookies.get(COOKIE)
    if token:
        await auth_service.end_session(session, token)
    clear_session_cookie(response)


@router.get("/me")
async def me(actor: CurrentActor, session: Session) -> MeOut:
    return await auth_service.me(session, actor.id)


@router.post("/password", status_code=204)
async def change_password(payload: PasswordChange, actor: CurrentActor, session: Session) -> None:
    """이 세션 말고 내 다른 세션은 모두 끊는다."""
    await auth_service.change_password(
        session, actor, payload.current_password, payload.new_password
    )

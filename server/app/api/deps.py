"""라우트가 같이 쓰는 의존성 — 로그인 · 프로젝트 경계 · 권한 · JSON 만 받기.

프로젝트 경계는 라우터 단위로 건다(`main.py` 의 `require_scope`).
엔드포인트마다 검사를 적지 않는다 — 경로에 `project_id` · `task_id` · `thread_id` ·
`comment_id` · `part_id` 가 있으면 그 레코드의 프로젝트로 본다.
"""

from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.services import access
from app.services import auth as auth_service
from app.services.access import Scope
from app.services.auth import COOKIE, Actor

Session = Annotated[AsyncSession, Depends(get_session)]

_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.session_days * 24 * 3600,
        path="/api",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE, path="/api", httponly=True, samesite="lax", secure=settings.cookie_secure
    )


async def require_json(request: Request) -> None:
    """쓰기 요청은 `application/json` 만 받는다 — 폼 전송으로는 못 만든다.

    CSRF 를 막는 줄이다(docs/api/auth.md '쿠키').

    본문도 Content-Type 도 없는 요청은 통과시킨다(링크 PUT · DELETE · 로그아웃). 폼 전송은 본문이
    비어도 Content-Type 을 싣고 오니 여기서 걸린다. 이유는 server/PLAN.md 8단계.
    """
    if request.method not in _WRITE_METHODS:
        return
    content_type = request.headers.get("content-type")
    if content_type is None:
        has_body = request.headers.get("content-length", "0") != "0" or (
            "transfer-encoding" in request.headers
        )
        if not has_body:
            return
    elif content_type.split(";")[0].strip().lower() == "application/json":
        return
    raise ApiError(
        415, "UNSUPPORTED_MEDIA_TYPE", "요청 본문은 JSON(application/json)이어야 합니다."
    )


async def current_actor(request: Request, response: Response, session: Session) -> Actor:
    token = request.cookies.get(COOKIE)
    if not token:
        raise auth_service.unauthenticated()
    resumed = await auth_service.resume_session(session, token)
    if resumed is None:
        raise auth_service.unauthenticated()
    actor, touched = resumed
    if touched:
        # 쿠키 수명도 같이 민다. 스트림 응답(채팅)에는 실리지 않는다 — 다음 요청이 민다
        set_session_cookie(response, token)
    return actor


CurrentActor = Annotated[Actor, Depends(current_actor)]


async def require_scope(request: Request, actor: CurrentActor, session: Session) -> Scope | None:
    """로그인 + 경로가 가리키는 프로젝트를 볼 수 있는지. 라우터 전체에 건다."""
    return await access.resolve_scope(session, actor, dict(request.path_params))


async def project_scope(scope: Annotated[Scope | None, Depends(require_scope)]) -> Scope:
    # 경로에 프로젝트를 품은 이름이 없는 라우트에 이 의존성을 걸면 코드가 틀린 것이다
    assert scope is not None, "프로젝트 경로가 아닌 곳에 project_scope 를 걸었다"
    return scope


ProjectScope = Annotated[Scope, Depends(project_scope)]


async def require_project_admin(scope: ProjectScope) -> Scope:
    if not scope.can_manage:
        raise access.forbidden()
    return scope


ProjectAdmin = Annotated[Scope, Depends(require_project_admin)]


async def require_system_admin(actor: CurrentActor) -> Actor:
    if not actor.is_admin:
        raise access.forbidden()
    return actor


SystemAdmin = Annotated[Actor, Depends(require_system_admin)]

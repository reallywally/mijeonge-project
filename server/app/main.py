from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, chat, comment, health, project, search, task, thread
from app.api.deps import require_json, require_scope
from app.config import settings
from app.errors import install_error_handlers

# 쓰기 요청은 JSON 만 받는다 — 폼 전송으로 만든 요청(CSRF)을 막는다 (docs/api/auth.md '쿠키')
app = FastAPI(title="innoFlow API", dependencies=[Depends(require_json)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 오류도 계약이다 — 기본 {"detail": ...} 로 새지 않게 넷을 다 받는다
install_error_handlers(app)

# 로그인 없이 열리는 것은 health · 로그인 · 로그아웃뿐이다. 나머지는 auth 라우터 안에서 건다
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

# 프로젝트 안의 레코드를 다루는 라우터 — 로그인 + 경로가 가리키는 프로젝트의 부여를
# 여기 한 곳에서 본다. 새 라우터를 붙일 때도 이 목록에 넣는다
for scoped in (
    project.router,
    task.router,
    comment.router,
    thread.router,
    search.router,
    chat.router,
):
    app.include_router(scoped, prefix="/api", dependencies=[Depends(require_scope)])

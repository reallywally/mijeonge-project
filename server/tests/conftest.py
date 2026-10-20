"""테스트용 DB · 로그인한 클라이언트.

`client` 는 **시스템 관리자(`admin`)로 로그인한** 클라이언트다 — 인증 전부터 있던 검사가 권한에
막히지 않고 그대로 돈다. 다른 사람으로 부르려면 `as_member("u2")`, 로그인 없이는 `anon`.
세션은 로그인 API 를 거치지 않고 DB 에 바로 만든다 — argon2 를 검사마다 돌리지 않게.

기본은 메모리 sqlite 다 — 모델 메타데이터로 테이블을 세운다. 검사 넷은 DB 없이 돈다.
Postgres 고유 동작이 필요한 검사(지금은 `pg_trgm` 검색 · API.md Q27)만 `pg_session` · `pg_client` 를
쓴다. 로컬 Postgres(`docker compose up -d db`)가 없으면 그 검사는 건너뛴다.
"""

import os
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import AsyncExitStack
from typing import Any

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import event, func, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.api.auth import get_login_limiter
from app.db import get_session
from app.main import app
from app.models import (
    Base,
    CheckRequest,
    Entry,
    Minutes,
    ProjectReport,
    Task,
    TaskComment,
    TaskLog,
    Thread,
)
from app.services import auth as auth_service
from app.services.auth import COOKIE
from scripts.seed import seed

# 시드의 시스템 관리자. `client` 가 이 사람으로 부른다
ADMIN = "admin"

AsMember = Callable[[str], Awaitable[httpx.AsyncClient]]

# 등록 순서 열을 가진 것들. Postgres 에서는 Identity 가 채운다
SEQ_MODELS = (Thread, Entry, Task, TaskComment, CheckRequest, Minutes, TaskLog, ProjectReport)


@event.listens_for(Engine, "connect")
def _sqlite_fk_on(dbapi_connection: object, _record: object) -> None:
    """sqlite 는 FK 를 기본으로 안 본다. 켜 둬야 참조 오류와 프로젝트 경계가 잡힌다.

    aiosqlite 로 붙으면 이 자리에 오는 것은 sqlite3 의 connection 이 아니라 SQLAlchemy 의
    어댑터라(`sqlalchemy.dialects.sqlite.aiosqlite`), 모듈 이름을 sqlite3 로만 보면 pragma 가
    한 번도 안 걸린다 — 부모 · 링크의 복합 FK(API.md Q13 · Q16)가 테스트에서 통째로 놀게 된다.
    """
    module = dbapi_connection.__class__.__module__
    if module.startswith("sqlite3") or "sqlite" in module:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("pragma foreign_keys=on")
        cursor.close()


@event.listens_for(Session, "before_flush")
def _fill_seq(session: Session, _ctx: Any, _instances: Any) -> None:
    """**테스트 전용 대역이다.** sqlite 에는 이 자리에 해당하는 것이 없어 손으로 채운다.

    `seq` 는 Postgres 의 Identity 가 정답이고 모델도 그대로 둔다. 그런데 sqlite 는 Identity 를
    무시해 NOT NULL 열만 남아서, 쓰기 API 가 만드는 새 레코드마다 INSERT 가 터진다.
    그래서 여기서만 max(seq)+1 을 넣는다 — 앱 코드는 이 사정을 모른다.
    진짜 Identity 동작은 Postgres 에서 확인할 일이고, 그 자리는 6단계(트랜잭션 격리)다.
    """
    pending = [row for row in session.new if isinstance(row, SEQ_MODELS) and row.seq is None]
    if not pending:
        return
    with session.no_autoflush:
        for model in SEQ_MODELS:
            rows = [row for row in pending if isinstance(row, model)]
            if not rows:
                continue
            top = session.execute(select(func.max(model.seq))).scalar() or 0
            for step, row in enumerate(rows, start=1):
                row.seq = top + step


@pytest.fixture
async def session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest.fixture(autouse=True)
def _fresh_login_limiter() -> None:
    # 로그인 횟수 제한은 프로세스 하나에 하나다 — 앞 검사의 시도가 뒤로 넘어오지 않게
    get_login_limiter().reset()


def _new_client(cookie: str | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={COOKIE: cookie} if cookie else None,
    )


async def logged_in(session: AsyncSession, member_id: str) -> httpx.AsyncClient:
    """그 사람의 세션 쿠키를 든 클라이언트. 닫는 것은 부른 쪽이다."""
    return _new_client(await auth_service.start_session(session, member_id))


async def _app_on(
    session: AsyncSession, member_id: str | None = ADMIN
) -> AsyncGenerator[httpx.AsyncClient, None]:
    async def use_test_session() -> AsyncGenerator[AsyncSession, None]:
        yield session

    app.dependency_overrides[get_session] = use_test_session
    c = await logged_in(session, member_id) if member_id else _new_client()
    async with c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def client(session: AsyncSession) -> AsyncGenerator[httpx.AsyncClient, None]:
    """시드가 들어간 DB 를 물린 앱 — 시스템 관리자로 로그인해 있다. ASGI 에 직접 붙는다."""
    await seed(session)
    async for c in _app_on(session):
        yield c


@pytest.fixture
async def anon(client: httpx.AsyncClient) -> AsyncGenerator[httpx.AsyncClient, None]:
    """같은 앱 · 같은 DB, 쿠키 없이."""
    async with _new_client() as c:
        yield c


@pytest.fixture
async def as_member(
    client: httpx.AsyncClient, session: AsyncSession
) -> AsyncGenerator[AsMember, None]:
    """`await as_member("u2")` — 같은 앱 · 같은 DB 에 그 사람으로 로그인한 클라이언트."""
    async with AsyncExitStack() as stack:

        async def make(member_id: str) -> httpx.AsyncClient:
            return await stack.enter_async_context(await logged_in(session, member_id))

        yield make


# 개발 DB(innoflow)와 따로 둔다 — 테스트가 스키마를 통째로 지우고 다시 세운다
PG_TEST_URL = make_url(
    os.environ.get(
        "TEST_DATABASE_URL", "postgresql+asyncpg://innoflow:innoflow@localhost:5432/innoflow_pytest"
    )
)


async def _ensure_pg_database() -> None:
    """테스트 DB 가 없으면 만든다. 서버에 닿지 않으면 건너뛴다 — 띄우는 것은 사람 몫이다."""
    admin = create_async_engine(
        PG_TEST_URL.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        connect_args={"timeout": 2},
    )
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("select 1 from pg_database where datname = :name"),
                {"name": PG_TEST_URL.database},
            )
            if not exists:
                await conn.execute(text(f'create database "{PG_TEST_URL.database}"'))
    except (OSError, SQLAlchemyError) as exc:
        pytest.skip(
            f"Postgres 에 닿지 않아 건너뛴다 ({PG_TEST_URL.host}:{PG_TEST_URL.port}): {exc}"
        )
    finally:
        await admin.dispose()


@pytest.fixture
async def pg_session() -> AsyncGenerator[AsyncSession, None]:
    """진짜 Postgres 위의 시드. 마이그레이션 대신 모델로 세운다 — 리비전은 test_schema 가 본다."""
    await _ensure_pg_database()
    engine = create_async_engine(PG_TEST_URL)
    async with engine.begin() as conn:
        await conn.execute(text("drop schema if exists public cascade"))
        await conn.execute(text("create schema public"))
        # 0006 리비전과 같다 — 인덱스의 gin_trgm_ops 가 확장에 있다
        await conn.execute(text("create extension if not exists pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        await seed(s)
        yield s
    await engine.dispose()


@pytest.fixture
async def pg_client(pg_session: AsyncSession) -> AsyncGenerator[httpx.AsyncClient, None]:
    async for c in _app_on(pg_session):
        yield c

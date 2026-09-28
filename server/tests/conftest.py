"""테스트용 DB.

Postgres 없이 도는 것만 여기에 둔다 — 메모리 sqlite 에 모델 메타데이터로 테이블을 세운다.
Postgres 고유 동작(트랜잭션 격리 · 동시성 · 실제 타입)이 필요해지면 그때 컨테이너를 물린다.
"""

from collections.abc import AsyncGenerator

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db import get_session
from app.main import app
from app.models import Base
from scripts.seed import seed


@event.listens_for(Engine, "connect")
def _sqlite_fk_on(dbapi_connection: object, _record: object) -> None:
    """sqlite 는 FK 를 기본으로 안 본다. 켜 둬야 시드의 참조 오류가 잡힌다."""
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("pragma foreign_keys=on")
        cursor.close()


@pytest.fixture
async def session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest.fixture
async def client(session: AsyncSession) -> AsyncGenerator[httpx.AsyncClient, None]:
    """시드가 들어간 DB 를 물린 앱. 서버를 띄우지 않고 ASGI 에 직접 붙는다."""
    await seed(session)

    async def use_test_session() -> AsyncGenerator[AsyncSession, None]:
        yield session

    app.dependency_overrides[get_session] = use_test_session
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()

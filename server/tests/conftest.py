"""테스트용 DB.

Postgres 없이 도는 것만 여기에 둔다 — 메모리 sqlite 에 모델 메타데이터로 테이블을 세운다.
Postgres 고유 동작(트랜잭션 격리 · 동시성 · 실제 타입)이 필요해지면 그때 컨테이너를 물린다.
"""

from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.db import get_session
from app.main import app
from app.models import Base, Entry, Task, Thread
from scripts.seed import seed

# 등록 순서 열을 가진 셋. Postgres 에서는 Identity 가 채운다
SEQ_MODELS = (Thread, Entry, Task)


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

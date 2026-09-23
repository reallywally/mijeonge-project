# innoFlow 서버

회의 · 안건 · 작업을 한 곳에서 관리하는 사내 웹앱의 API 서버.
FastAPI + SQLAlchemy 2.0(async) + asyncpg + PostgreSQL, 의존성은 uv 로 관리한다.

무엇을 어떤 순서로 만드는지는 [PLAN.md](./PLAN.md) 에 있다.

## 띄우기

```bash
cp .env.example .env
docker compose up -d                  # postgres:17, localhost:5432
uv sync
uv run fastapi dev app/main.py        # http://localhost:8000
```

`GET /api/health` → `{"status": "ok"}` 로 확인한다. 이 엔드포인트는 DB 를 찌르지 않는다.

## 검사

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest
```

테스트는 httpx `ASGITransport` 로 앱에 직접 붙는다 — 서버를 띄워 둘 필요가 없다.

## 구조

| 무엇 | 어디 |
| --- | --- |
| 앱 · 설정 | `app/main.py` · `app/config.py` |
| DB 세션 | `app/db.py` |
| 라우트 | `app/api/<domain>.py` |
| 요청 · 응답 스키마 | `app/schemas/<domain>.py` |
| ORM 모델 | `app/models/<domain>.py` |
| 도메인 규칙 · 집계 | `app/services/<domain>.py` |
| 마이그레이션 | `alembic/versions/` |
| 테스트 | `tests/test_<domain>.py` |

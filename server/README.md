# innoFlow 서버

회의 · 안건 · 작업을 한 곳에서 관리하는 사내 웹앱의 API 서버.
FastAPI + SQLAlchemy 2.0(async) + asyncpg + PostgreSQL, 의존성은 uv 로 관리한다.

무엇을 어떤 순서로 만드는지는 [PLAN.md](./PLAN.md) 에 있다.

## 띄우기

```bash
cp .env.example .env
docker compose up -d                  # postgres:17, localhost:5432
uv sync
uv run alembic upgrade head           # 테이블 만들기
uv run python -m scripts.seed         # 픽스처와 같은 데이터 넣기
uv run fastapi dev app/main.py        # http://localhost:8000
```

`GET /api/health` → `{"status": "ok"}` 로 확인한다. 이 엔드포인트는 DB 를 찌르지 않는다.

맥에서 `docker compose` 가 `unknown shorthand flag: 'd' in -d` 로 죽으면 **Docker Desktop 을
아직 한 번도 실행 안 한 것이다** — compose 플러그인 링크(`~/.docker/cli-plugins`)를 첫 실행 때
만든다. `open -a Docker` 로 한 번 띄우면 된다. 멈출 때는 `docker compose down`
(데이터는 `innoflow-pgdata` 볼륨에 남고, `-v` 를 붙이면 같이 지워진다).

**Postgres 가 있어야 하는 것은 `alembic` · `seed` · 앱 구동뿐이다.** 검사 넷은 DB 없이 돈다 —
테스트는 메모리 sqlite 에 모델로 테이블을 세운다(`tests/conftest.py`).

## API

| 무엇 | 어디 |
| --- | --- |
| 살아 있나 | `GET /api/health` |
| 프로젝트 목록 | `GET /api/projects` |
| 멤버 목록 | `GET /api/members` |
| 프로젝트 스냅샷 | `GET /api/projects/{projectId}/snapshot` |

스냅샷은 그 프로젝트의 레코드 전부(`threads` · `entries` · `meetings` · `tasks` · 링크 둘)를
한 번에 준다 — 화면의 `stores/data.ts` 가 들고 있는 것과 같은 모양이다. 집계는 여전히 화면이 한다.

**배열 순서까지가 계약이다.** 안건 · 작업 목록에는 정렬이 없어서 배열 순서가 곧 화면 순서다.
등록 순서(`seq`)로 내보낸다.

## 마이그레이션

```bash
uv run alembic upgrade head                                   # 최신까지
uv run alembic revision --autogenerate -m "무엇을 바꿨는지"   # 모델을 고친 뒤
uv run alembic downgrade -1                                   # 한 칸 되돌리기
```

접속 URL 은 `alembic.ini` 가 아니라 `.env` 한 곳에서만 온다(`alembic/env.py` 가 읽어 넣는다).
자동 생성 결과는 그대로 믿지 말고 열어서 확인한다. 모델만 고치고 리비전을 안 만들면
`tests/test_schema.py` 가 잡는다.

## 검사

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

테스트는 httpx `ASGITransport` 로 앱에 직접 붙는다 — 서버를 띄워 둘 필요가 없다.

## 구조

| 무엇 | 어디 |
| --- | --- |
| 앱 · 설정 | `app/main.py` · `app/config.py` |
| DB 세션 | `app/db.py` |
| 라우트 | `app/api/<domain>.py` |
| 요청 · 응답 스키마 | `app/schemas/<domain>.py` (경계 규칙은 `app/schemas/base.py`) |
| 시각 · 날짜 | `app/time.py` |
| ORM 모델 | `app/models/<domain>.py` |
| 도메인 규칙 · 집계 | `app/services/<domain>.py` |
| 마이그레이션 | `alembic/versions/` |
| 시드 | `scripts/seed.py` |
| 테스트 | `tests/test_<domain>.py` |

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
| 프로젝트 목록 · 등록 | `GET` · `POST /api/projects` |
| 멤버 목록 | `GET /api/members` |
| 프로젝트 스냅샷 | `GET /api/projects/{projectId}/snapshot` |
| 작업 등록 | `POST /api/projects/{projectId}/tasks` |
| 작업 수정 | `PATCH /api/tasks/{taskId}` (상태 · 담당자 · 기간 · 상위 작업을 하나로 받는다) |
| 작업 본문 줄 토글 | `PATCH /api/tasks/{taskId}/lines/{lineId}` |
| 작업 ↔ 안건 | `PUT` · `DELETE /api/tasks/{taskId}/threads/{threadId}` |
| 작업 ↔ 회의 | `PUT` · `DELETE /api/tasks/{taskId}/meetings/{meetingId}` |
| 안건 등록 | `POST /api/projects/{projectId}/threads` |
| 회의 밖 줄 | `POST /api/threads/{threadId}/entries` |
| **새 회의 저장** | `POST /api/projects/{projectId}/meetings` |
| 회의 ↔ 작업 | `PUT` · `DELETE /api/meetings/{meetingId}/tasks/{taskId}` |

스냅샷은 그 프로젝트의 레코드 전부(`threads` · `entries` · `meetings` · `tasks` · 링크 둘)를
한 번에 준다 — 화면의 `stores/data.ts` 가 들고 있는 것과 같은 모양이다. 집계는 여전히 화면이 한다.

**배열 순서까지가 계약이다.** 안건 · 작업 목록에는 정렬이 없어서 배열 순서가 곧 화면 순서다.
등록 순서(`seq`)로 내보낸다.

쓰기는 **바뀐 레코드를 그대로 돌려준다** — 스냅샷을 다시 받지 않아도 되게. 줄 하나가 안건
상태까지 바꾸므로 `POST /threads/{id}/entries` 는 `{entry, thread}` 를 같이 준다. 링크는
`PUT`/`DELETE` 라 두 번 눌러도 결과가 같고, 없는 링크를 지워도 204 다.

**새 회의 저장이 제일 큰 자리다.** 안건 등록 · 회의 · 줄 여럿 · 안건 상태 변경이 **한 트랜잭션**에서
돈다(하나 틀어지면 통째로 없던 일이다). 회의 중에 처음 만든 안건은 화면이 `tempId` 로 가리키는데,
서버가 실제 id 를 미리 만들어 **줄 · 메모 · 하위 안건의 부모** 세 곳을 치환하고
`threadIdByTempId` 로 돌려준다. 응답의 `threads` 는 이 저장으로 바뀐 안건 전부다.
memo 의 시나리오 넷을 API 호출만으로 따라가는 검사가 `tests/test_scenarios.py` 에 있다.

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

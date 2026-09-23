---
name: backend
description: server/ 의 FastAPI 백엔드를 만들거나 고칠 때 쓴다 — 새 API 추가, 스키마·모델 변경, Alembic 마이그레이션, 쿼리·집계 로직, pytest 작성. server/ 를 건드리는 작업이면 이 에이전트를 쓴다. 화면(web/) 은 frontend 에이전트가 맡는다.
tools: Read, Write, Edit, Bash, Grep, Glob
---

회의 · 안건 · 작업을 한 곳에서 관리하는 사내 웹앱(innoFlow)의 서버를 만든다.
`server/` 안에서만 일한다. `web/` 는 읽기만 한다 — 고치지 않는다.

## 스펙이 어디 있나

- `memo.md` — 엔티티(project · task · meeting · agenda), 연관 관계, 화면 목록, 시나리오. **제품 결정의 기준**
- `web/src/types/domain.ts` — **API 계약의 기준**. 화면이 이미 이 모양으로 돌고 있다
- `web/src/stores/*.ts` — 지금 목업이 무엇을 계산해 화면에 주는지. 서버가 넘겨받을 후보가 여기 있다
- `web/PLAN.md` — 프론트가 정해 둔 것과 남은 것

프론트가 이미 정해 놓은 이름·모양을 서버가 바꾸지 않는다. 바꿔야 할 이유가 있으면
임의로 고르지 말고 무엇이 왜 어긋나는지 말하고 확인을 받는다.

## 스택과 규칙

Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0(async) + asyncpg + Alembic + PostgreSQL.
의존성은 **uv** 로 관리한다 (`uv sync` · `uv run ...`). pip · poetry 를 섞지 않는다.

- **Postgres 로 간다.** Supabase 를 쓰게 되어도 그쪽이 Postgres 라 DB 접근 코드는 같다.
  Supabase 의 인증 · 스토리지 · 실시간은 쓰지 않는다 (정해지면 이 문서를 고친다)
- 라우트 · 서비스 · 리포지토리 모두 `async def`. 동기 드라이버(psycopg2)를 끌어들이지 않는다
- SQLAlchemy 는 **2.0 스타일**(`Mapped[...]` · `mapped_column` · `select()`). `Query` API 금지
- **인증은 아직 없다.** 로그인 · 토큰 · 권한을 미리 만들지 않는다. 담당자는 `member` 를 id 로 가리킬 뿐이다
- 타입 힌트는 전부 단다. 스키마는 Pydantic 모델, ORM 은 SQLAlchemy 모델 — **둘을 겸하지 않는다**
- 주석과 에러 메시지는 한국어. 주석은 "왜"만 짧게 단다. 파일마다 설명 블록을 붙이지 않는다

### 계약 — 프론트와 어긋나지 않게

- **JSON 키는 프론트 타입 그대로 camelCase.** 파이썬 안에서는 snake_case 를 쓰고,
  경계에서 Pydantic 의 `alias_generator=to_camel` + `populate_by_name=True` 로 바꾼다
- **id 는 문자열.** DB 는 UUID 라도 내보낼 때 `str` 이다 (프론트가 `id: string` 으로 들고 있다)
- 날짜는 `date` 필드면 `YYYY-MM-DD` 문자열, `createdAt` 은 ISO 8601 UTC
- 경로는 프로젝트 안에서만 돈다 — `/api/projects/{projectId}/tasks` 처럼 스코프를 경로에 둔다.
  프로젝트 목록만 예외(`/api/projects`)
- `ThreadRow` · `ThreadDetail` · `TaskRow` 같은 **계산된 타입은 지금 프론트 스토어가 만든다.**
  서버는 원본(Thread · Entry · Meeting · Task · 링크)을 주는 것이 기본이고,
  집계를 서버로 옮기려면 화면 하나씩 옮기며 그때 스토어도 같이 고친다 (frontend 에이전트에게 넘긴다)

### 모델에서 지켜야 할 것

- **Entry 하나가 (회의 × 안건) 한 줄이다.** 옮겨 적은 사본이 아니다.
  `meeting_id` 가 null 이면 회의 없이 처리한 줄이다 — nullable 을 지운다면 모델이 틀린 것이다
- **안건 상태는 셋** — `queued` · `open` · `decided`. '미룸'은 상태가 아니라 `kind='defer'` 인 Entry 다
  (같은 안건이 여러 번 미뤄진다). memo 의 '대기 · 논의중 · 결정 · 미룸' 은 아직 안 맞춘 옛 표기다
- 작업은 `parent_id` 로 계층을 이룬다. **자기 자신 · 자손을 부모로 두면 고리가 생긴다 — 서버에서 막는다**
- 작업의 `start` · `due` 는 둘 다 null 일 수 있다(기간 미정). 둘 중 하나만 채우는 것도 허용한다
- 맵핑은 링크 테이블 둘 — `task_thread_link` · `meeting_task_link`.
  "안건 상세에서는 맵핑 불가"는 **화면의 규칙이지 모델의 제약이 아니다**. 링크는 양쪽에서 읽는다

## 파일을 어디에 두나

| 무엇 | 어디 |
| --- | --- |
| 앱 · 설정 | `server/app/main.py` · `app/config.py` |
| 라우트 | `server/app/api/<domain>.py` — project · task · thread · meeting |
| 요청 · 응답 스키마 | `server/app/schemas/<domain>.py` |
| ORM 모델 | `server/app/models/<domain>.py` |
| 도메인 규칙 · 집계 | `server/app/services/<domain>.py` — 라우트에 로직을 쌓지 않는다 |
| DB 세션 | `server/app/db.py` |
| 마이그레이션 | `server/alembic/versions/` |
| 테스트 | `server/tests/test_<domain>.py` |

## 먼저 읽을 것

새 도메인을 붙이기 전에 **같은 종류의 기존 파일을 먼저 읽고 그 패턴을 따른다.**
새 관례를 만들지 말고 있는 것을 늘린다. 아직 아무것도 없으면 위 표대로 세우고,
첫 도메인에서 정한 모양을 나머지가 그대로 따른다.

모델을 고치면 **Alembic 리비전을 같이 만든다**(`uv run alembic revision --autogenerate -m "..."`).
자동 생성 결과를 그대로 믿지 말고 열어서 확인한다.

## 다 하고 나서

```bash
cd server && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest
```

넷을 돌리고 결과를 그대로 보고한다. 실패하면 고친 뒤 다시 돌린다.
테스트는 httpx `ASGITransport` 로 앱에 직접 붙인다 — 서버를 띄워 놓고 때리지 않는다.
개발 서버(`uv run fastapi dev`)는 사용자가 띄운다 — 백그라운드로 붙잡지 않는다.

**리포는 WSL 파일시스템(`~/workspace/mijeonge-project`)에 있다.** `/mnt/c` 사본은 예전 것이라
거기서 고치면 헛일이 된다 — 경로를 먼저 확인한다.

커밋과 푸시는 사용자가 시킬 때만 한다.

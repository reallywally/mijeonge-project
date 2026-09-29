# 백엔드 개발 계획

목업으로 다 돌고 있는 화면에 진짜 서버를 붙이는 계획이다. 무엇을 만들지는
`../memo.md`(엔티티 · 화면 · 시나리오)와 `../web/src/types/domain.ts`(지금 화면이 쓰는 모양)가
정답이고, 이 문서는 **무엇을 어떤 순서로 만들지**만 적는다.

- 제품명: **innoFlow**
- 규칙과 관례는 `../.claude/agents/backend.md` 에 있다. 이 문서는 순서만 다룬다
- 프론트 계획: `../web/PLAN.md` — 그쪽 **3단계(API 계약과 `src/api/`)** 가 이 문서의 4단계와 같은 일이다

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 스택 | FastAPI + Pydantic v2 + SQLAlchemy 2.0(async) + asyncpg + Alembic | README 의 "백: fastapi". 전부 async 로 통일한다 |
| DB | **PostgreSQL** | Supabase 로 가도 그쪽이 Postgres 라 접근 코드는 같다. Supabase 의 인증 · 스토리지는 쓰지 않는다 |
| 패키지 | **uv** | 이미 깔려 있다. pip · poetry 를 섞지 않는다 |
| 계약의 기준 | `web/src/types/domain.ts` | 화면이 이미 그 모양으로 돈다. 서버가 이름을 바꾸면 화면을 두 번 고친다 |
| JSON 키 | **camelCase** (파이썬 안은 snake_case) | 위와 같은 이유. 경계에서 Pydantic alias 로 바꾼다 |
| 첫 읽기 API | **프로젝트 스냅샷 한 방** | 지금 스토어가 "레코드를 다 들고 화면에서 계산"하는 구조다. 그 모양대로 주는 것이 제일 적게 고친다. 목록 페이징 · 필터를 서버로 옮기는 건 5단계 |
| 쓰기 API | 처음부터 **도메인별로 쪼갠다** | 읽기와 달리 쓰기는 나중에 합칠 일이 없다 |
| 인증 | **안 만든다** | 지금 화면에 로그인이 없다. `currentMemberId` 가 고정값이다. 6단계에서 다시 본다 |
| 집계(`ThreadRow` · `TaskDetail` …) | **당분간 프론트가 계산한다** | 스토어에 테스트까지 붙어 있다. 서버가 같은 계산을 두 벌 갖지 않는다 |

## 지금 서 있는 자리 (2026-09-28)

- 서버는 **3단계까지 서 있다** — 모델 12개(`app/models/`) · 리비전 둘 · 시드 ·
  읽기 API 셋 · 쓰기 API 열(작업 · 안건 · 회의 · 링크 · 프로젝트 등록).
  다음은 4단계 — 프론트를 목업에서 서버로 갈아 끼우는 일이다
- **로컬 Postgres 가 돈다** — `innoflow-db` 컨테이너(postgres:17)에 스키마와 시드가 올라가 있다.
  검사 넷은 그래도 DB 없이 돈다 — 테스트가 메모리 sqlite 에 모델로 테이블을 세운다
- 프론트는 목업으로 작업 · 안건 · 회의 화면이 다 돈다(`web/PLAN.md` 2단계까지 끝남).
  스키마에서 제일 무거운 작업 · 링크 · 기간이 화면에서 확정됐다 — 계약을 잡기 좋은 자리다
- 도메인 모양은 `web/src/types/domain.ts` 와 `web/src/fixtures/*.ts` 에 다 있다.
  **픽스처가 곧 첫 시드 데이터다** (한화손보 차세대 + memo 시나리오 넷)

---

## 0단계 · 판 고르기

**목표** — 앞으로의 모든 작업이 빨라지는 것만 먼저 치운다.

- [x] `uv init` — `server/pyproject.toml`, Python 3.12
- [x] 뼈대: `app/main.py` · `app/config.py`(pydantic-settings) · `app/db.py`(async engine · session)
- [x] `GET /api/health` 하나로 앱이 뜨는 것까지 확인
- [x] ruff(lint + format) · mypy · pytest 설정. 첫 테스트는 health
- [x] 로컬 Postgres — `docker-compose.yml`(postgres:17) + `.env.example` (컨테이너는 아직 안 띄웠다)
- [x] CORS 는 `http://localhost:5173` 만 연다

**끝난 것으로 보는 기준** — `uv run fastapi dev` 로 뜨고, `ruff` · `mypy` · `pytest` 넷이 돈다.

**커밋** — `서버 판을 고른다 — fastapi · uv · ruff · pytest`

## 1단계 · 스키마와 마이그레이션

화면이 확정해 준 모양을 그대로 테이블로 옮긴다. **여기서 틀리면 나머지가 다 틀어진다.**

### 1-1 테이블

| 테이블 | 비고 |
| --- | --- |
| `project` | id · name |
| `member` | id · name. 로그인이 없어 지금은 읽기 전용이다 |
| `task` | project_id · key · title · parent_id · status · owner_id · start · due · priority · created_at |
| `task_line` | 작업 본문 한 줄 — task_id · kind(check/bullet) · text · done · level · **order** |
| `thread` | 안건 — project_id · title · state · owner_id · parent_thread_id · created_at |
| `entry` | **(회의 × 안건) 한 줄** — thread_id · meeting_id(**nullable**) · kind · text · note · owner_id · created_at |
| `entry_detail` | 결정 안에 함께 적힌 조건별 상세 줄 — entry_id · text · order |
| `meeting` | project_id · title · date · created_at |
| `meeting_attendee` | meeting_id · member_id |
| `meeting_memo` | meeting_id · text · promoted_thread_id(nullable) · order |
| `task_thread_link` | 작업 ↔ 안건 (PK 둘) |
| `meeting_task_link` | 회의 ↔ 작업 (PK 둘) |

`TaskLine` · `detail` · `memos` · `attendeeIds` 는 프론트에서 배열이라 JSONB 로 밀어넣고 싶어지지만,
**행으로 편다.** 나중에 "담당자가 참석한 회의", "안 끝난 체크박스"를 세게 된다.
대신 순서가 뜻을 가지므로 순서 열을 꼭 둔다(프론트는 배열 순서에 기대고 있다).
이름은 `sort_order` 다 — `order` 는 SQL 키워드라 쿼리마다 따옴표를 달아야 한다.

### 1-2 서버가 지켜야 할 규칙

- `entry.meeting_id` 는 **nullable** — 회의 없이 담당자 확인만으로 처리한 줄이다. 지우면 모델이 틀린 것
- 안건 상태는 **셋**(`queued` · `open` · `decided`). '미룸'은 상태가 아니라 `kind='defer'` 인 Entry 다
- **Entry 를 붙이면 안건 상태가 따라 바뀐다** (지금 스토어가 하는 계산을 서버로 옮긴다)
  - `decide` · `change` → `decided`, `ownerId` 가 있으면 안건 담당자도 그 사람으로
  - 그 밖의 kind → `queued` 였으면 `open`, 이미 `decided` 면 그대로
- `task.parent_id` 는 자기 자신 · 자손이 될 수 없다 — **서버에서 막는다**(고리 금지)
- `task.start` · `due` 는 둘 다 null 일 수 있다(기간 미정). 하나만 채우는 것도 허용
- 링크 둘은 양쪽에서 읽는다. "안건 상세에서 맵핑 불가"는 화면 규칙이지 모델 제약이 아니다
- 모든 목록 조회는 `project_id` 로 갈린다

### 1-3 마이그레이션과 시드

- [x] Alembic 초기화(async 템플릿) + 첫 리비전 `20260928_0001_initial_schema.py`.
      접속 URL 은 `alembic.ini` 대신 `alembic/env.py` 가 `.env` 에서 읽어 넣는다.
      제약 이름은 `Base.metadata` 의 naming convention 으로 고정했다 — 안 그러면 diff 가 매번 흔들린다
- [x] **첫 리비전은 autogenerate 가 아니라 메타데이터에서 직접 뽑았다** — 로컬에 Postgres 가
      없어 비교할 DB 가 없었다. 대신 `tests/test_schema.py` 가 리비전을 얹은 결과와
      `Base.metadata` 를 대조해 차이가 없음을 검사로 묶었다(head 가 둘로 갈리는 것도 같이 본다)
- [x] `scripts/seed.py` — `web/src/fixtures/*.ts` 의 값을 그대로 넣는다. id 도 픽스처의
      `p1` · `u3` · `k4` 를 그대로 쓴다. 돌릴 때마다 비우고 다시 넣는다
- [x] `tests/test_seed.py` — 시드가 픽스처대로 서는지(개수 · 시나리오 1·2 의 레코드)를 본다.
      **Postgres 없이 돈다** — 메모리 sqlite 에 FK 를 켜고 세운다(`tests/conftest.py`)
- [x] **진짜 Postgres(postgres:17 컨테이너)에 올렸다** — `alembic upgrade head` → `alembic check`
      가 "No new upgrade operations" 다. 손으로 뽑은 첫 리비전이 모델과 어긋나지 않는다는 걸
      autogenerate 로도 확인한 것이다. 시드도 들어갔고 두 번 돌려도 같은 자리다

**끝난 것으로 보는 기준** — 빈 DB 에 마이그레이션 + 시드를 돌리면 픽스처와 같은 데이터가 선다.

**커밋** — ① 스키마와 첫 리비전 ② 시드

## 2단계 · 읽기 API

- [x] `GET /api/projects` — 프로젝트 목록
- [x] `GET /api/members` — 멤버 목록
- [x] `GET /api/projects/{projectId}/snapshot` — **그 프로젝트의 레코드 전부**
      (`project` · `threads` · `entries` · `meetings` · `tasks` · `taskThreadLinks` · `meetingTaskLinks`).
      `stores/data.ts` 가 지금 들고 있는 것과 같은 모양이다. 없는 프로젝트는 404
- [x] 응답 스키마를 `domain.ts` 와 한 필드씩 맞췄다 — `tests/test_read_api.py` 가 레코드마다
      키 집합을 통째로 비교한다. 이름이 하나 어긋나면 화면이 조용히 빈칸을 그려서 눈으로는 못 잡는다
- [x] 그 목록은 손으로 옮겨 적은 것이라, `tests/test_contract_types.py` 가 **`domain.ts` 를 파일로
      읽어** 아홉 타입의 키와 null 허용 자리를 대조한다. 프론트가 타입을 고치면 여기서 깨진다
- [x] **경계** — `app/schemas/base.py` 의 `Schema`(camelCase alias + `from_attributes`)와
      `Utc`(ISO 8601 UTC · 늘 `Z` · 초까지). 도메인 스키마는 전부 이걸 상속한다
- [x] **배열 순서도 계약이다** — 이걸 놓칠 뻔했다. `stores/thread.ts` 의 `rows` 와 작업 목록에는
      정렬이 **없어서** 배열 순서가 곧 화면 순서고, 안건 이력은 같은 날짜의 줄을 배열 인덱스
      (`seqNo`)로 가른다. 픽스처 배열은 날짜순이 아니라 **등록순**이라(e1=09-09 가 e2=09-07 앞)
      `created_at` 으로 세우면 화면이 달라진다. 그래서 thread · entry · meeting · task 에
      **`seq`(Identity) 열**을 두고 그 순서로 내보낸다
- [x] 목업과 같은 화면이 나오는지 실제로 대조했다 — 스냅샷을 `data.ts` 에 꽂고 `rows` ·
      `threadDetail` · `meetingDetail` · `taskDetail` 을 픽스처로 돌린 것과 통째로 비교했다
      (일회용 vitest 로 확인하고 지웠다. 서버 쪽에는 순서 검사로 못 박아 뒀다)

**끝난 것으로 보는 기준** — 스냅샷 응답을 그대로 `data.ts` 의 초기값에 넣으면 화면이 목업과 똑같이 돈다.

**커밋** — `읽기 API — 프로젝트 스냅샷`

## 3단계 · 쓰기 API

스토어 함수 하나가 엔드포인트 하나다. **이 표가 3단계의 할 일 목록이다.**

| 스토어 | 엔드포인트 |
| --- | --- |
| `task.addTask` | `POST /api/projects/{pid}/tasks` |
| `task.setStatus` · `setOwner` · `setPeriod` | `PATCH /api/tasks/{id}` (부분 수정 하나로 받는다) |
| `task.toggleBodyLine` | `PATCH /api/tasks/{id}/lines/{lineId}` |
| `task.linkThread` · `unlinkThread` | `PUT` · `DELETE /api/tasks/{id}/threads/{threadId}` |
| `task.linkMeeting` · `unlinkMeeting` | `PUT` · `DELETE /api/tasks/{id}/meetings/{meetingId}` |
| `thread.addThread` | `POST /api/projects/{pid}/threads` |
| `thread.addOutsideEntry` | `POST /api/threads/{id}/entries` (`meetingId` 없이) |
| `meeting.saveMeeting` | `POST /api/projects/{pid}/meetings` |
| `meeting.linkTask` · `unlinkTask` | `PUT` · `DELETE /api/meetings/{id}/tasks/{taskId}` |
| 프로젝트 등록 | `POST /api/projects` |

- [x] 작업 쓰기 — 등록 · 부분 수정 · 본문 줄 토글 · 링크 둘 (`app/api/task.py`)
- [x] 안건 쓰기 — 등록 · 회의 밖 줄 (`app/api/thread.py`)
- [x] 새 회의 저장 · 회의 ↔ 작업 링크 (`app/api/meeting.py`)
- [x] 프로젝트 등록 (`POST /api/projects`) — 화면에 아직 없어 `keyPrefix` 를 받는 것으로 뒀다
- [x] 링크는 `PUT`/`DELETE` 로 뒀다 — 두 번 눌러도 같은 결과다(스토어도 중복을 막고 있다).
      없는 링크를 지워도 204 다
- [x] 응답은 **바뀐 레코드를 돌려준다**. 프론트가 스냅샷을 다시 받지 않아도 되게.
      줄 하나가 안건 상태까지 바꾸므로 회의 밖 줄은 `{entry, thread}` 를 같이 준다
- [x] **테스트 DB 는 메모리 sqlite 에 그대로 뒀다.** sqlite 가 Identity 를 무시해 새 레코드마다
      `seq` 가 비는 문제는 `tests/conftest.py` 의 `before_flush` 대역으로 막았다 —
      **테스트 전용이고 앱 코드는 이 사정을 모른다.** Postgres 로 옮기는 것은 6단계
      ('트랜잭션 롤백 격리')에서 같이 본다
- [x] **`task.key` 발번을 정했다** — `project.last_task_no` 카운터를 `update ... returning`
      한 문장으로 올려 뽑는다(0002 리비전). 최댓값+1 은 지운 뒤 재사용되고 동시 등록에 진다

### 3-1 새 회의 저장 — 제일 어려운 자리

`saveMeeting` 하나가 **안건 등록 + 회의 등록 + Entry 여러 개 + 안건 상태 변경**을 한꺼번에 한다.

- [x] 회의 중에 처음 만든 안건은 아직 id 가 없어 화면이 `tempId` 로 가리킨다.
      서버가 실제 id 를 **미리** 만들고 **`entries` · `memos` · 하위 안건의 부모까지 치환**한다.
      치환 규칙은 `stores/meeting.ts` 의 `resolve` 와 같다 — 표에 없으면 그 값을 실제 id 로 본다
      (픽스처 `mm7` 의 `promotedThreadId: 't4'` 가 그 경우다)
- [x] 전부 **한 트랜잭션**이다. 하나 틀어지면 회의가 통째로 없던 일이 된다
- [x] 응답에 `threadIdByTempId` 맵을 실어 준다. `threads` 에는 **이 저장으로 바뀐 안건 전부**가
      온다 — 새로 만든 것 + 상태나 담당자가 바뀐 기존 안건
- [x] **테스트를 먼저 썼다.** `tests/test_scenarios.py` 가 시나리오 넷을 API 호출만으로 따라간다

**실제로 해 보고 알게 된 것**

- **"커밋을 안 하면 롤백"이 아니다.** 검증을 하다 400 을 던져도, 그 전에 `session.add` 를 한 줄이라도
  했으면 **다음 요청의 autoflush 가 그걸 같이 밀어 넣는다**(세션은 요청 사이에 살아 있다).
  그래서 `save_meeting` 은 **참조 · 멤버 검증을 전부 마친 뒤에** 만들기 시작한다.
  `tests/test_meeting_api.py` 의 "줄 하나가 엉터리면 아무것도 안 남는다"가 이걸 붙잡는다
- **Entry 만드는 코드가 두 벌이 될 뻔했다** — 회의 안과 밖이 `meeting_id` 하나만 다르다.
  `services/thread.py` 의 `build_entry` 로 뽑아 나눠 쓴다. 상태 전이(`apply_entry_to_thread`)도 하나다
- **없는 멤버가 FK 위반 500 으로 샜다.** 회의 저장은 참석자 · 담당자를 한 번에 많이 받는 자리라
  여기만 먼저 400 으로 막았다. 다른 엔드포인트에 소급하지 않았다 — 에러 형식 통일은 4단계 몫이다
- **`last_task_no` 백필을 빠뜨릴 뻔했다** — 0002 리비전이 0 으로만 채우면 작업이 이미 있는 DB 에서
  다음 발번이 `HW-1` 이라 유니크에 부딪힌다. 기존 `key` 의 숫자부 최댓값으로 채운다
- tempId 를 미리 다 만들어 두니 **부모가 배열 뒤에 있어도 걸린다**. 목업 `resolve` 는 앞에 있는 것만
  보므로 서버가 조금 더 너그러운 쪽이다(계약이 어긋나지는 않는다)

**끝난 것으로 보는 기준** — memo 시나리오 넷을 API 호출만으로 끝까지 따라갈 수 있다.
`tests/test_scenarios.py` 가 시드가 아니라 빈 프로젝트에서 시작해 넷을 그대로 재현한다.

**커밋** — ① 작업 쓰기 ② 안건 쓰기 ③ 새 회의 저장 ④ 링크

## 4단계 · 프론트 붙이기 (`web/PLAN.md` 3단계와 같은 일)

- [ ] OpenAPI 스키마를 프론트에 넘기고 `openapi-typescript` 로 타입 생성 → `domain.ts` 와 대조
- [ ] 에러 응답 형식을 하나로 정한다 — `{ code, message, detail? }`. 화면이 그대로 보여줄 수 있게 한국어
- [ ] `VITE_USE_MOCK` 스위치가 서는 동안 목업과 서버 양쪽이 같은 화면을 내는지 본다
- [ ] 이 단계의 화면 작업은 **frontend 에이전트**가 한다. 서버는 계약과 응답만 책임진다

## 5단계 · 집계를 서버로 (데이터가 커지면)

지금은 프론트가 전부 들고 계산한다. 한 프로젝트의 작업이 수백 줄을 넘어가면 그때 옮긴다.
**화면 하나씩** 옮기고, 옮길 때 스토어 계산과 그 테스트도 같이 걷어낸다.

- [ ] 작업 목록 — 검색 · 상태 · 담당자 · 기간 미정 거르기 + 페이징 + 정렬
- [ ] 안건 목록 · 회의 목록도 같은 모양으로
- [ ] 필요해지는 인덱스: `task(project_id, status)` · `entry(thread_id, created_at)` · `entry(meeting_id)`
- [ ] 간트 · 칸반은 옮기지 않는다 — 어차피 프로젝트 전체를 본다

## 6단계 · 품질과 운영

- [ ] pytest — 도메인 규칙(고리 금지 · 상태 전이 · 회의 저장 트랜잭션)과 시나리오 넷
- [ ] 테스트 DB 는 트랜잭션 롤백으로 격리. httpx `ASGITransport` 로 앱에 직접 붙는다
- [ ] 구조적 로깅 + 요청 id
- [ ] 삭제 정책 — 지금 화면에 삭제가 없다. 생기면 soft delete 로 갈지 먼저 정한다
- [ ] 인증 — 사내 계정을 어디에 기댈지 정해진 다음
- [ ] 배포 — Dockerfile, 마이그레이션을 배포에서 언제 돌릴지

## 7단계 · 그 다음 — 메일과 AI

README 의 핵심 컨셉이지만 화면도 스펙도 아직 없다. **모델이 다 선 뒤에** 손댄다.

- [ ] 회의 참석자에게 메일 보내기 (회의 저장 뒤, 그날 남긴 줄을 모아서)
- [ ] AI — "땡땡 기능 보안 수준 어떻게 하기로 했지?" 같은 질문에 안건 이력으로 답하기,
      회의 전 체크리스트 뽑기. DB 에 다 쌓여 있는 것이 이 제품의 강점이다

---

## 진행 상황

| 단계 | 상태 |
| --- | --- |
| 0 판 고르기 | 끝남 (2026-09-23) — 검사 넷 통과. DB 컨테이너는 아직 안 띄웠다 |
| 1 스키마와 마이그레이션 | **끝남** (2026-09-28) — 테이블 12개 · 첫 리비전 · 시드. Postgres 에 올려 확인까지 |
| 2 읽기 API | **끝남** (2026-09-28) — 프로젝트 · 멤버 · 스냅샷. 목업 화면과 대조 확인 |
| 3 쓰기 API | **끝남** (2026-09-28) — 작업 · 안건 · 회의 · 링크 · 프로젝트 등록. 시나리오 넷을 API 로 재현 |
| 3-c `createdAt` 되돌리기 | **끝남** (2026-09-29) — `Z`·초까지, 저장도 UTC, 회의 줄은 적은 시각. 빈 접두사는 안 넣은 것 (`API.md` Q23 · Q24) |
| 3-b 계약 메우기 | **끝남** (2026-09-28) — 오류 형식 · 링크와 부모의 프로젝트 경계 · `Project` 모양 ·
  `domain.ts` 대조 검사. 리비전 `0003_contract_gaps` |
| 4 프론트 붙이기 | 시작 전 |
| 5 집계를 서버로 | 시작 전 |
| 6 품질과 운영 | 시작 전 |
| 7 메일과 AI | 시작 전 |

## 아직 안 정한 것

- **DB 를 어디에 둘지** — 로컬/사내 Postgres 인지 Supabase 호스팅인지. 접근 코드는 같지만
  마이그레이션을 누가 돌리고 접속 정보를 어디에 둘지가 갈린다
- ~~**id 형식**~~ — **`varchar(36)` 에 uuid4 hex** 로 갔다(`app/models/base.py` 의 `new_id`).
  DB 시퀀스를 안 쓴 이유는 회의 저장이 한 트랜잭션 안에서 안건 id 를 미리 알아야 해서다(3-1).
  시드는 픽스처의 `p1` · `u3` · `k4` 를 그대로 넣는다 — 목업 화면과 한 줄씩 대조하려고
- ~~**`task.key` 발번 규칙**~~ — 정했다. 접두사는 `project.key_prefix`(p1=HW · p2=PAS · p3=MG),
  번호는 **`project.last_task_no` 카운터**다. `update project set last_task_no = last_task_no + 1
  ... returning` 한 문장으로 올려 뽑으면 그 행의 잠금이 순서를 지켜 준다 — 최댓값+1 은 지운 뒤
  번호가 재사용되고 두 사람이 동시에 등록하면 같은 번호가 둘 나온다. 작업이 이미 있는 DB 는
  0002 리비전이 기존 `key` 의 숫자부 최댓값으로 백필한다
- **안건 상태 넷 vs 셋** — memo 는 대기 · 논의중 · 결정 · 미룸, 코드는 셋이다.
  서버는 코드(셋)를 따랐다. memo 를 고칠지 결정이 필요하다 (`memo.md` 의 '정해야 할 것' 6번)
- **작업 상태의 '막힘'** — memo 에 없는 다섯 번째 상태다. 확정되면 그때 memo 로 옮긴다
- **동시 편집** — 두 사람이 같은 회의를 저장하면 어떻게 되는지. 지금은 아무 잠금도 없다
- **에러 응답 형식** — 4단계에서 `{ code, message, detail? }` 로 정하기로 해 뒀는데 아직이다.
  지금 404 는 FastAPI 기본(`{"detail": "그런 프로젝트가 없다"}`)이다
- **새로 만든 것이 목록 어디에 서는지** — 목업 `stores/*.ts` 는 새 안건 · 회의를 배열 **맨 앞**에
  꽂는데(`unshift`) 서버 스냅샷은 `seq` 오름차순이라 **맨 뒤**다. 지금은 화면이 목업이라 안 드러나지만
  4단계에서 붙이면 방금 만든 것이 딴 자리에 뜬다. 스토어를 뒤에 붙이는 쪽으로 고칠지,
  서버가 내림차순으로 줄지 정해야 한다(안건 이력은 배열 인덱스를 `seqNo` 로 쓰므로 같이 봐야 한다)
- **링크 배열 순서** — 지금은 id 순이다. 화면이 링크를 순서로 쓰지 않아 상관없지만,
  쓰게 되면 링크에도 등록 순서가 필요해진다
- ~~**타임존**~~ — 다시 정했다(2026-09-29 · `API.md` Q23). **저장도 내보내기도 UTC 다** —
  `createdAt` 은 ISO 8601 UTC 로 늘 `Z` 로 끝나고 초까지만 낸다(`app/time.py` 의 `iso_z`).
  한 번은 'KST 기준 날짜로 자른다' 로 정했었는데, 그 이유였던 프론트의 옛 `monthDay`(`9월 NaN일`)가
  Q3 에서 사라졌다. 자르면 같은 날 여러 줄의 시각을 잃고 화면이 만든 줄(`nowIso()`)과 형식이 두 벌이 된다.
  오프셋(`+09:00`)도 안 내보낸다 — 프론트 `localDay` 가 `Z` 가 아니면 문자열을 잘라 읽는다.
  naive 는 UTC 로 본다(sqlite 검사가 오프셋을 버린다). 한국 시간으로 찍는 것은 프론트 몫이다
- **작업 댓글 · 상태 변경 기록** — 프론트가 모델에 없어서 뺐다. 두기로 하면 `task_comment` ·
  `task_log` 를 서버가 먼저 세운다

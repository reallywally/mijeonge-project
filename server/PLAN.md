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

## 지금 서 있는 자리 (2026-09-23)

- 서버는 **0단계까지 서 있다** — FastAPI 앱 · 설정 · DB 세션 · `/api/health` 와 검사 넷.
  도메인은 아직 하나도 없다(모델 · 마이그레이션 · API 전부 1단계부터)
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
대신 순서가 뜻을 가지므로 `order` 열을 꼭 둔다(프론트는 배열 순서에 기대고 있다).

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

- [ ] Alembic 초기화 + 첫 리비전. **자동 생성 결과를 열어서 확인한다**
- [ ] `scripts/seed.py` — `web/src/fixtures/*.ts` 의 값을 그대로 넣는다.
      화면을 목업일 때와 똑같이 보이게 하는 것이 목표다(비교가 곧 검증이다)

**끝난 것으로 보는 기준** — 빈 DB 에 마이그레이션 + 시드를 돌리면 픽스처와 같은 데이터가 선다.

**커밋** — ① 스키마와 첫 리비전 ② 시드

## 2단계 · 읽기 API

- [ ] `GET /api/projects` — 프로젝트 목록
- [ ] `GET /api/members` — 멤버 목록
- [ ] `GET /api/projects/{projectId}/snapshot` — **그 프로젝트의 레코드 전부**
      (`threads` · `entries` · `meetings` · `tasks` · `taskThreadLinks` · `meetingTaskLinks`).
      `stores/data.ts` 가 지금 들고 있는 것과 같은 모양이다
- [ ] 응답 스키마를 `domain.ts` 와 한 필드씩 맞춰 본다 — 이름 · null 허용 · 날짜 형식

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

- 링크는 `PUT`/`DELETE` 로 둔다 — 두 번 눌러도 같은 결과여야 한다(스토어도 중복을 막고 있다)
- 응답은 **바뀐 레코드를 돌려준다**. 프론트가 스냅샷을 다시 받지 않아도 되게

### 3-1 새 회의 저장 — 제일 어려운 자리

`saveMeeting` 하나가 **안건 등록 + 회의 등록 + Entry 여러 개 + 안건 상태 변경**을 한꺼번에 한다.

- 회의 중에 처음 만든 안건은 아직 id 가 없어 화면이 `tempId` 로 가리킨다.
  서버가 실제 id 를 만들고 **`entries` · `memos` · 하위 안건의 부모까지 치환**한다
- 전부 **한 트랜잭션**이다. 하나 틀어지면 회의가 통째로 없던 일이 되어야 한다
- 응답에 `threadIdByTempId` 맵을 실어 준다 — 화면이 방금 만든 안건을 가리킬 수 있게
- **테스트를 먼저 쓴다.** memo 시나리오 1(서버 OS · DB 결정)과 2(미룸 두 번)를 그대로 재현한다

**끝난 것으로 보는 기준** — memo 시나리오 넷을 API 호출만으로 끝까지 따라갈 수 있다.

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
| 1 스키마와 마이그레이션 | 시작 전 |
| 2 읽기 API | 시작 전 |
| 3 쓰기 API | 시작 전 |
| 4 프론트 붙이기 | 시작 전 |
| 5 집계를 서버로 | 시작 전 |
| 6 품질과 운영 | 시작 전 |
| 7 메일과 AI | 시작 전 |

## 아직 안 정한 것

- **DB 를 어디에 둘지** — 로컬/사내 Postgres 인지 Supabase 호스팅인지. 접근 코드는 같지만
  마이그레이션을 누가 돌리고 접속 정보를 어디에 둘지가 갈린다
- **id 형식** — 지금 픽스처는 `p1` · `u3` 처럼 사람이 읽는 값이다. UUID 로 갈지, DB 시퀀스로 갈지.
  어느 쪽이든 **내보낼 때는 문자열**이라 화면은 안 바뀐다
- **`task.key` 발번 규칙** — 픽스처의 `HW-4` 에서 `HW` 가 어디서 오는지(프로젝트 접두사?)와
  번호를 프로젝트별로 셀지가 안 정해졌다. 지금은 서버가 만들어야 하는 값이다
- **안건 상태 넷 vs 셋** — memo 는 대기 · 논의중 · 결정 · 미룸, 코드는 셋이다.
  서버는 코드(셋)를 따랐다. memo 를 고칠지 결정이 필요하다 (`memo.md` 의 '정해야 할 것' 6번)
- **작업 상태의 '막힘'** — memo 에 없는 다섯 번째 상태다. 확정되면 그때 memo 로 옮긴다
- **동시 편집** — 두 사람이 같은 회의를 저장하면 어떻게 되는지. 지금은 아무 잠금도 없다
- **타임존** — `createdAt` 을 UTC 로 저장하고 화면에서 KST 로 보여줄지, 애초에 날짜만 쓸지.
  `meeting.date` 와 `task.start`/`due` 는 날짜뿐이라 문제가 없고, `createdAt` 만 걸린다
- **작업 댓글 · 상태 변경 기록** — 프론트가 모델에 없어서 뺐다. 두기로 하면 `task_comment` ·
  `task_log` 를 서버가 먼저 세운다

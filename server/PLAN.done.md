# 백엔드 개발 계획 — 끝난 단계

`PLAN.md` 에서 끝난 단계를 통째로 옮겨 둔 기록이다. 지금 할 일과 진행 상황은 `PLAN.md` 에 있다.
단계가 끝나면 그 절을 여기 **아래에** 옮기고 `PLAN.md` 에는 제목과 한 줄만 남긴다. 고치지 않는다 — 그때 왜 그렇게 했는지가 남아야 한다.

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

- [x] ~~OpenAPI 스키마를 프론트에 넘기고 `openapi-typescript` 로 타입 생성~~ — **안 하기로 했다.** 계약이 `web/src/types/domain.ts` 를
      정본으로 삼고 서버가 그 모양에 맞춰 낸다(`web/PLAN.md` 3단계). 어긋남은 `tests/test_contract_types.py` 가 domain.ts 와 대조해 잡는다
- [x] 에러 응답 형식을 하나로 정한다 — `{ code, message, detail? }` (2026-09-28 · Q14). 핸들러 넷이 같은 모양으로 바꾼다
- [x] `VITE_USE_MOCK` 스위치 — 개발 기본은 서버, `'true'` 면 목업, vitest 는 목업 (2026-10-11 · `web/src/api/mode.ts`)
- [x] 화면 작업은 **frontend 에이전트**가 했다 — `src/api/` · 부팅 · 쓰기 동기화 (`web/PLAN.md` 3단계)

## 8단계 · 인증과 권한 — 누가 부르는지 서버가 안다

계약은 `../docs/api/auth.md`, 화면은 `../web/PLAN.md` 8단계가 맡는다. 관리자가 DB 에 손으로 등록하는
이메일 + 비밀번호 로그인이고(스스로 가입 없음), 자격 증명을 `auth_identity` 로 떼어 둬서 SSO(OIDC)는
줄 하나로 더한다. 권한은 시스템 관리자 · 프로젝트 관리자 · 일반 사용자 셋.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 세션 | 서버 세션 + HttpOnly 쿠키 `innoflow_session`(`Path=/api` · `SameSite=Lax` · 운영은 `Secure`). DB 에는 토큰의 sha256 만 | 비활성화 · 비밀번호 변경 · 로그아웃이 그 순간 먹어야 한다. DB 가 새도 세션을 못 훔친다 |
| 수명 | 마지막 요청에서 14일(`session_days`). `last_seen_at` · `expires_at` 은 **한 시간에 한 번만** 밀고, 그때 쿠키도 다시 굽는다 | 읽기 요청이 전부 쓰기가 되지 않게 |
| 비밀번호 | `argon2-cffi` 의 `PasswordHasher` 기본값. 해시 · 검증은 `asyncio.to_thread` 로 | 일부러 느린 계산이라 이벤트 루프를 붙잡지 않게. 없는 이메일도 가짜 해시로 같은 만큼 계산한다(응답 시간으로 계정을 못 가리게) |
| 프로젝트 경계 | **라우터 단위 의존성 하나** — `app/api/deps.py` 의 `require_scope` 를 `main.py` 가 프로젝트 라우터 여섯에 건다. 경로에 `project_id` · `task_id` · `thread_id` · `comment_id` 가 있으면 그 레코드의 프로젝트를 찾아 본다(`app/services/access.py`) | 엔드포인트마다 검사를 적으면 하나는 빠진다. 새 라우트는 경로 이름만 맞추면 따라 걸린다 |
| 404 와 403 | 부여받지 않은 프로젝트(의 레코드)는 원래 없을 때와 같은 404, 부여는 받았는데 모자라면 403 `FORBIDDEN` | 403 은 그런 것이 있다는 것을 알려 준다 |
| 로그인 제한 | 챗봇의 `RateLimiter` 를 `app/services/ratelimit.py` 로 옮겨 같이 쓴다. 인스턴스는 따로(로그인 IP 당 분당 10회 · `login_rate_per_minute`) | 새 장치를 만들지 않는다. 로그인 시도가 질문 횟수를 먹지 않게 |
| JSON 만 | 앱 전체 의존성 `require_json` — 쓰기 메서드에 `Content-Type` 이 있으면 `application/json` 이어야 하고, 본문이 있는데 `Content-Type` 이 없어도 막는다. 어기면 415 `UNSUPPORTED_MEDIA_TYPE` (`API.md` Q29) | 계약의 CSRF 줄 |
| 본문 없는 쓰기 | **`Content-Type` 도 본문도 없으면 통과** — 링크 PUT · DELETE, 프로젝트 멤버 DELETE, 로그아웃 POST | 폼 전송은 본문이 비어도 `Content-Type` 을 싣고 오니 여전히 막힌다. PUT · PATCH · DELETE 는 메서드만으로 교차 출처 사전 요청(preflight)이 걸려 남의 사이트가 못 보낸다. 본문 없는 POST 로 효과가 나는 것은 로그아웃뿐이고(남이 나를 로그아웃시키는 정도), 그마저 `SameSite=Lax` 가 교차 사이트 요청에 쿠키를 안 붙인다. 화면의 `request()` 는 본문이 없으면 `Content-Type` 을 안 싣는다 — 막으면 프론트를 같이 고쳐야 한다 |
| 담당자 | 새로 지정하는 담당자는 **그 프로젝트의 활성 멤버**(`project_member` 줄 + `member.active`). 이미 걸린 담당자를 그대로 두는 수정 · 안건 담당자를 그대로 적는 이력 줄은 막지 않는다 | 계약. 빠진 사람의 옛 기록을 고칠 때마다 담당자를 지우게 하지 않는다 |

### 할 일

- [x] 리비전 `20261013_0008_auth.py` — `member` 에 `email`(유니크 · 소문자) · `system_role` · `active` · `created_at`,
      `auth_identity` · `auth_session` · `project_member`. 기존 멤버는 `user` · 활성 · 이메일 없음, 프로젝트마다 활성 멤버 전부를 `user` 로 부여
- [x] `app/services/auth.py` — 해시 · 세션 시작/이어가기/끝내기 · 로그인 · `Me` · 내 비밀번호 바꾸기(다른 세션 끊기)
- [x] `app/services/access.py` · `app/api/deps.py` — `current_actor`(401) · `require_scope`(404) · `require_project_admin` · `require_system_admin`(403) · `require_json`(415)
- [x] `app/services/member.py` — 사용자 관리(목록 · 등록 · 수정 · 비밀번호 걸기, 마지막 시스템 관리자 409 — 관리자 행을 `FOR UPDATE` 로 잠근다) · 프로젝트 멤버(목록 · 부여 · 빼기)
- [x] 라우트 — `/api/auth/*` · `/api/admin/members*` · `/api/projects/{id}/members*` · `PATCH /api/projects/{id}`
- [x] 이미 있는 API — 프로젝트 목록 거르기 · 등록은 시스템 관리자만 · 담당자 검증(작업 · 안건 · 이력 · 일괄) · 댓글 작성자는 로그인한 사람 · 수정은 작성자만 · 삭제는 작성자/프로젝트 관리자/시스템 관리자 · 챗봇 `list_members` · `propose_tasks` 는 그 프로젝트의 활성 멤버만 · `Member.active`
- [x] `scripts/create_admin.py` — `--email` · `--name`, 비밀번호는 프롬프트. 그 이메일의 멤버가 있으면 관리자로 올리고 비밀번호를 새로 건다
- [x] 시드 — `admin@innoflow.local` 시스템 관리자 + u1 ~ u4 에 `u1@innoflow.local` … 이메일, 비밀번호는 다섯 다 `innoflow-admin`.
      부여는 리비전과 같고, **u1 만 p1 관리자**로 둔다(프로젝트 관리자 화면을 개발에서 열어 보려고 — 계약 밖의 개발 편의)
- [x] 테스트 — conftest 의 `client` 가 시스템 관리자로 로그인해 있다(세션을 DB 에 바로 만든다 — 검사마다 argon2 를 돌리지 않게).
      `as_member("u2")` · `anon`. 새 검사 `test_auth_api.py` · `test_admin_members_api.py` · `test_permissions.py`
- [x] Postgres 에서 `upgrade head`(백필 확인) → `alembic check` → `downgrade -1` → `upgrade head` → 시드 · `create_admin` · 로그인까지 — 따로 만든 DB 에서 하고 지웠다

### 남은 것 · 알고 둔 것

- **본문이 가리키는 다른 프로젝트 레코드** — 작업의 `parentId` · `threadIds` 가 내가 못 보는 프로젝트의 것이면 지금처럼
  400 `*_OTHER_PROJECT` 다. 그런 id 가 있다는 것은 드러난다(id 는 uuid 라 추측은 어렵다). 숨길지는 `API.md` Q31
- **스트림 응답(채팅)에는 다시 구운 쿠키가 안 실린다** — 다음 요청이 민다. 한 시간에 한 번이라 쿠키 수명이 그만큼 늦게 밀릴 수 있다
- 챗봇의 질문 제한은 아직 IP 기준이다. 사람 기준으로 바꿀지는 쓰면서 본다
- 인증 전에 쓴 댓글 중 작성자가 비어 있는 것은 아무도 못 고친다(지우기는 관리자가 한다)
- 만료된 세션 행은 그 쿠키가 다시 올 때만 지운다. 쌓이면 주기적으로 지우는 일을 6단계(운영)에 더한다
- SSO(OIDC) — `provider='oidc:<이름>'` 줄을 더하고 처음 들어온 사람은 `email` 로 기존 멤버에 잇는다(없으면 거절)

**커밋** — ① 리비전 · 모델 ② 세션 · 로그인 ③ 권한 의존성 · 이미 있는 API ④ 관리 API ⑤ 시드 · 명령

## 7단계 · AI 챗봇 — 저장된 안건 · 작업을 찾아 답한다 — 끝난 부분

### 7-1 검색 (Claude 없이)

- [x] 리비전 `20261011_0006_search_trgm.py` — `CREATE EXTENSION IF NOT EXISTS pg_trgm` + GIN trigram 인덱스:
      `thread.title` · `thread.description` · `thread_option.text` · `entry.text` · `entry.note` ·
      `entry_detail.text` · `task.title` · `task_line.text`. 인덱스는 모델에도 있다(`models/base.py` 의
      `trgm_index`) — 안 그러면 `alembic check` 가 매번 '지워라' 로 읽는다. 확장은 Postgres 에서만 켜고
      sqlite 는 같은 이름의 보통 인덱스만 세운다(그래야 `test_schema` 의 리비전 ↔ 모델 대조가 돈다).
      downgrade 는 인덱스를 지우고 확장을 `CASCADE` 없이 지운다
- [x] `app/services/search.py` — 도구가 될 함수 넷. 전부 **`project_id` 로 먼저 거른다**
  - `search_threads(session, project_id, query, state=None, limit=10)` — 맞은 자리(`matched`) · 한 줄 발췌 ·
    마지막 `decide` · `change` 줄을 같이 낸다 (`API.md` 의 `ThreadHit`)
  - `get_thread(session, project_id, thread_id)` → `ThreadDoc` — 안건(후보 포함) + 이력 전부(`seq` 순) + 연결된 작업
  - `search_tasks(session, project_id, query, status=None, limit=10)` — 제목 · 본문 줄
  - `get_task(session, project_id, task_id)` → `TaskDoc` — 작업(본문 포함) + 연결된 안건 제목 · 상태
  - get_thread · get_task 는 HTTP 로 열지 않았다(7-2 도구 전용). 다른 프로젝트의 id 면 `THREAD_NOT_FOUND` ·
    `TASK_NOT_FOUND` 를 던진다 — 7-2 의 도구 감싸개가 받아 Claude 에 '못 찾았다' 로 넘긴다
- [x] `GET /api/projects/{projectId}/search` — `search_threads` · `search_tasks` 를 묶어 연다 (`SearchResult`)
- [x] 테스트 `tests/test_search.py` — sqlite 에서 도는 것(404 · 422 · get_thread · get_task · 발췌)과
      Postgres 에서만 도는 것(실제로 찾기 · 프로젝트 경계 · 빈 결과 · 바뀐 결정 · 도구의 state/status 거르기)으로 나눴다 (Q27)

**검색 방식** — 점수는 `GREATEST(word_similarity(q, 글), 글 ILIKE '%q%' 이면 0.9)`, **0.5 미만은 버린다.**
거르는 조건은 `q <% 글 OR 글 ILIKE '%q%'` 라 GIN 인덱스를 탄다(`EXPLAIN` 으로 BitmapOr 확인).
`<%` 의 문턱은 서버 설정이라 검색마다 `set_config('pg_trgm.word_similarity_threshold', '0.5', true)` 로
그 트랜잭션에만 박는다. 한 레코드가 여러 자리에서 맞으면 점수 → 자리(제목 · 배경 · 후보 · 이력) → 자리 안 순서로 하나만 남긴다.

**실제로 해 보고 알게 된 것**

- `similarity()` 는 글 전체와 비교해 짧은 검색어가 긴 글에서 다 묻힌다('OS' ↔ '서버 OS 결정' 0.33).
  `word_similarity()` 는 글 안의 가장 비슷한 조각과 비교해 1.0 이다
- 한국어는 조사가 붙는다 — '미룸' ↔ '두 번째 미룸이다' 의 낱말 유사도는 0.67 이다. 그래서 '그대로 들어 있으면 0.9'
  를 같이 둔다. 1 이 아니라 0.9 라 낱말째 맞은 것이 앞에 선다
- en_US.utf8 로케일의 Postgres 17 에서 한글도 낱말로 쪼개진다(`show_trgm` 으로 확인)
- 리비전은 **개발 DB(`innoflow`)에 올리지 않았다** — 같은 컨테이너를 다른 worktree 도 쓴다. 따로 만든 DB 에
  `upgrade head` → `alembic check`("No new upgrade operations") → `downgrade -1` → 다시 `upgrade head` 로 확인하고 지웠다.
  개발 DB 는 사람이 `uv run alembic upgrade head` 로 올린다

### 7-2 채팅

- [x] `uv add anthropic`(1.13.0) · `config.py` 에 `anthropic_api_key: SecretStr | None` · `chat_model`(`claude-sonnet-5-5`) ·
      `chat_effort`(`low`) · `chat_max_tokens`(8000) · `chat_timeout_seconds` · `chat_rate_per_minute`(10)
- [x] `app/services/chat.py` — 도구 루프
  - 도구 정의는 7-1 함수 넷을 감싼 것. 도구 결과는 **JSON 문자열**(camelCase · id · 상태 · 이력 kind 그대로).
    입력은 `schemas/chat.py` 의 모델로 검증하고, `project_id` 는 **경로에서 온 것만** 넘긴다 — 도구 입력에 없다.
    못 찾음(`THREAD_NOT_FOUND` 등) · 잘못된 입력 · 없는 도구는 `is_error` 인 도구 결과로 Claude 에 돌려준다
  - 시스템 프롬프트에 `API.md` '답하는 규칙' 넷 + 근거 표시 `[[thread:ID]]` · `[[task:ID]]` + 프로젝트 이름
  - `client.beta.messages.stream` 으로 받아 `text` 이벤트를 바로 `delta` 로 흘린다. 도구를 돌리기 직전마다 `tool` 이벤트.
    차례가 바뀌어 다시 글이 나오면 앞 글과 붙지 않게 `\n\n` 을 끼운다
  - 루프 상한 **6회**(Claude 호출 횟수). 5번째 도구 결과에 '더 찾지 말고 지금까지로 답하라' 를 덧붙이고,
    6번째에도 도구를 부르면 돌리지 않고 '정리하지 못했다' 한 줄로 끝낸다. `max_tokens` 에 닿으면 끊었다는 줄을 붙이고 `done`
  - `stop_reason == "refusal"` → `error` 이벤트(`CHAT_REFUSED`). `fallbacks="default"` + 베타 `server-side-fallback-2026-07-01`
  - `thinking` 은 넘기지 않고, `tool_choice` 는 `{"type": "auto"}` 로 명시한다. effort 는 `output_config={"effort": ...}`
  - 도구 하나를 돌릴 때마다 `session.rollback()` — 읽기뿐이라 다음 Claude 호출 동안 트랜잭션을 붙잡지 않는다
- [x] `app/api/chat.py` — `StreamingResponse(media_type="text/event-stream")`. 스트림 전(404 · 422 · 503 · 429)은 JSON,
      뒤(Claude 429 → `CHAT_RATE_LIMITED`, 그 밖의 SDK 오류 → `CHAT_UNAVAILABLE`, 거절 → `CHAT_REFUSED`, 나머지 → `INTERNAL_ERROR`)는 `error` 이벤트.
      클라이언트는 첫 요청에 한 번 만들고 키가 없으면 `None` — 앱은 뜨고 채팅만 503
- [x] 제한 — 메시지 1 ~ 20개 · 질문 2,000자 · 답 20,000자(지난 답을 그대로 돌려받으니 질문 상한을 걸면 긴 답 뒤로 다 막힌다) · 공백뿐 · 마지막이 user 아님은 422. IP 당 분당 10회(`RateLimiter`, 메모리 · 미끄러지는 창)
- [x] 테스트 `tests/test_chat.py` 33개 — **Claude 를 부르지 않는다.** 가짜 클라이언트가 `beta.messages.stream` 모양만 흉내 내고
      마지막 메시지는 SDK 의 진짜 `BetaMessage` 다. ① 도구 → 답 ② SSE 순서 · 모양 ③ 루프 상한 ④ 키 없음 503
      ⑤ 다른 프로젝트 id(t10 · x1)를 넣어도 못 읽음 + 요청 파라미터(모델 · effort · fallbacks · tool_choice · thinking 없음) · 422 · 429 · 거절.
      검색 도구의 프로젝트 경계는 Postgres 에서만(`pg_session`) 본다

**실제로 해 보고 알게 된 것**

- (SDK 1.13.0 소스로 확인) `fallbacks` · `betas` 는 **`client.beta.messages`** 에만 있다(`client.messages.stream` 에는 없다). 그래서 루프 전체가 beta 쪽이다
- effort 는 최상위 인자가 아니라 `output_config={"effort": "low"}` 다(`BetaOutputConfigParam`)
- 대체 모델이 넘겨받으면 `content` 에 `fallback` 블록이 끼고(델타 없음), 차례를 이어 보낼 때 `BetaMessage.to_param()` 이
  thinking · fallback 블록까지 그대로 싣는다 — 손으로 블록을 다시 짜지 않는다
- 스트리밍 응답 안에서 DB 세션을 쓴다. FastAPI 0.141 의 `yield` 의존성은 응답을 다 보낸 뒤에 닫혀서 그대로 된다

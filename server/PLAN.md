# 백엔드 개발 계획

목업으로 다 돌고 있는 화면에 진짜 서버를 붙이는 계획이다. 무엇을 만들지는
`../memo.md`(엔티티 · 화면 · 시나리오)와 `../web/src/types/domain.ts`(지금 화면이 쓰는 모양)가
정답이고, 이 문서는 **무엇을 어떤 순서로 만들지**만 적는다.

- 제품명: **innoFlow**
- 규칙과 관례는 `../.claude/agents/backend.md` 에 있다. 이 문서는 순서만 다룬다
- 끝난 단계의 자세한 기록은 `PLAN.done.md` 다. 단계가 끝나면 절을 그리로 옮기고 여기에는 제목과 한 줄만 남긴다
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
| 인증 | ~~안 만든다~~ → **8단계에서 세웠다** — 서버 세션 쿠키 · 권한 셋 (`../docs/api/auth.md`) | 처음에는 화면에 로그인이 없어 미뤘다. 2026-10-13 사용자가 정했다 |
| 집계(`ThreadRow` · `TaskDetail` …) | **당분간 프론트가 계산한다** | 스토어에 테스트까지 붙어 있다. 서버가 같은 계산을 두 벌 갖지 않는다 |

## 지금 서 있는 자리 (2026-09-28)

옛 스냅샷이라 `PLAN.done.md` 로 옮겼다. 지금 자리는 아래 '진행 상황' 표를 본다.

---

## 0단계 · 판 고르기

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 1단계 · 스키마와 마이그레이션

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 2단계 · 읽기 API

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 3단계 · 쓰기 API

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 4단계 · 프론트 붙이기 (`web/PLAN.md` 3단계와 같은 일)

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

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
- [x] 인증 — **8단계로 옮겼다** (이메일 + 비밀번호, 나중에 SSO 를 더할 자리를 둔다)
- [ ] 배포 — Dockerfile, 마이그레이션을 배포에서 언제 돌릴지

## 7단계 · AI 챗봇 — 저장된 안건 · 작업을 찾아 답한다

README 의 두 번째 핵심 컨셉이다. "서버 OS 뭐로 하기로 했지?" 에 **안건 이력으로** 답한다.
계약은 `../docs/api/chat.md`이고, 화면은 `../web/PLAN.md` 7단계가 맡는다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 방식 | **Claude + 도구 사용(tool use)**. 서버가 검색 함수 넷을 도구로 쥐여 주고 루프를 돈다 | 질문 → 검색어 → 안건 찾기 → 이력 읽기 → 답을 Claude 가 스스로 돈다. 스냅샷 통째 넣기는 프로젝트가 커지면 비싸고 느리다 |
| 검색 | **Postgres `pg_trgm`** (trigram 유사도). 벡터 검색은 평가에서 놓치는 게 보이면 | 기본 전문검색(`tsvector`)은 한국어를 못 쪼갠다. 동의어("OS" ↔ "운영체제")는 Claude 가 검색어를 여러 벌 던져 메운다 |
| SDK | `anthropic` 의 **async 클라이언트** (`AsyncAnthropic`) | 앱 전체가 async 다. 동기 클라이언트를 스레드로 돌리지 않는다 |
| 모델 | **`claude-sonnet-5-5` · effort `low`** — `config.py` 의 `chat_model` · `chat_effort` 로만 바꾼다 (Q25 닫힘) | 찾아서 요약하는 일이라 Sonnet 으로 충분하다. Sonnet 5.5 는 effort 기본값이 `high` 라 `low` 를 **명시한다**. 평가셋에서 모자라면 effort → 모델 순으로 올린다 |
| 대화 | **서버에 남기지 않는다** — 화면이 지난 질문 · 답을 `messages` 로 보내고, 창을 닫으면 끝난다 (Q26 닫힘) | 로그인이 없어 남겨도 누구 것인지 못 가린다 |
| 키 | `ANTHROPIC_API_KEY` 를 `.env` 로만. 없으면 앱은 뜨고 채팅만 503 `CHAT_UNAVAILABLE` | 키가 없는 개발 환경에서도 나머지 화면이 돌아야 한다 |

### 7-1 검색 (Claude 없이)

**끝났다.** 자세한 기록은 `PLAN.done.md` 에 있다.

### 7-2 채팅

**끝났다.** 자세한 기록은 `PLAN.done.md` 에 있다.

### 7-3 평가셋

검사 넷은 코드가 맞는지만 본다. 답이 맞는지는 따로 본다 — **실제 API 를 부르니 돈이 든다. 사람이 돌린다.**

- [ ] `server/evals/chat_cases.yaml` — 시드(한화손보 차세대 + memo 시나리오 넷)로 15 ~ 20개
  - 표현을 바꾼 질문("운영체제 뭐 쓰기로 했지?"), 결정이 **바뀐** 안건, 아직 **안 정해진** 안건, **없는** 내용
  - 각 줄에 기대하는 근거 id 와 답에 들어가야 할 말
- [ ] `server/scripts/eval_chat.py` — 돌리고 ① 기대 근거를 찾았나 ② 최신 결정을 말했나 ③ 없는 걸 지어내지 않았나를 센다
- [ ] 놓치는 질문이 많으면 7-4 를 연다

### 7-4 그 다음 (필요해지면)

- [ ] 벡터 검색 — `pgvector` + 임베딩(Claude 에는 임베딩 API 가 없어 별도 제공자가 필요하다)
- [ ] "이 안건을 정하려면 무엇을 체크해야 하나" — 같은 도구에 비슷한 과거 안건 · 연결된 작업을 엮는다
- [ ] 지금 열려 있는 안건 · 작업 id 를 같이 받아 "이거" 로 가리킬 수 있게 (계약 변경)
- [ ] 메일 보내기 — 회의를 걷어내 대상이 사라졌다. 다시 필요해지면 안건 단위로 본다

**커밋** — ① 검색 ② 채팅 ③ 평가셋

## 8단계 · 인증과 권한 — 누가 부르는지 서버가 안다

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

### 남은 것 · 알고 둔 것

- **본문이 가리키는 다른 프로젝트 레코드** — 작업의 `parentId` · `threadIds` 가 내가 못 보는 프로젝트의 것이면 지금처럼
  400 `*_OTHER_PROJECT` 다. 그런 id 가 있다는 것은 드러난다(id 는 uuid 라 추측은 어렵다). **그대로 두기로 했다**(Q31 닫힘 · `docs/api/decisions.md`)
- **스트림 응답(채팅)에는 다시 구운 쿠키가 안 실린다** — 다음 요청이 민다. 한 시간에 한 번이라 쿠키 수명이 그만큼 늦게 밀릴 수 있다
- 챗봇의 질문 제한은 아직 IP 기준이다. 사람 기준으로 바꿀지는 쓰면서 본다
- 인증 전에 쓴 댓글 중 작성자가 비어 있는 것은 아무도 못 고친다(지우기는 관리자가 한다)
- 만료된 세션 행은 그 쿠키가 다시 올 때만 지운다. 쌓이면 주기적으로 지우는 일을 6단계(운영)에 더한다
- SSO(OIDC) — `provider='oidc:<이름>'` 줄을 더하고 처음 들어온 사람은 `email` 로 기존 멤버에 잇는다(없으면 거절)

## 9단계 · 파트 — 보기 범위(권한 아님)

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 10단계 · 결정 병목 리스크 — 안 정해진 안건이 막는 일을 먼저 보인다

`../docs/agent-proposal.md` 검토의 1순위다. "무엇이 안 정해져서 무엇이 멈췄나 · 멈출 건가" 를 규칙으로 계산하고,
API 와 챗봇 도구가 같은 계산을 쓴다. 계약은 `../docs/api/risk.md`(합의 — Q33 ~ Q35 닫힘), 화면은 `../web/PLAN.md` 11단계다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 데이터 | 계산은 **안건 · 이력 · 작업 · 연결만**. 새 테이블은 기준을 담는 `risk_setting` 하나 | 먼저 써 보고 모자란 것(`task_log`)을 더한다 |
| 자리 | `app/services/risk.py` 의 `decision_risks(session, project_id, *, today)` 하나 | API · 챗봇 도구가 같은 함수를 부른다. `today` 를 인자로 받아야 검사가 날짜에 안 흔들린다 |
| 쿼리 | 안 정해진 안건 · 그 이력 요약(defer 수 · 마지막 시각 · 마지막 defer note) · 연결 · 프로젝트의 작업(id · parent · status · due · owner · part)을 **몇 번의 select 로 읽고 계산은 파이썬에서** | 한 프로젝트가 수백 줄 규모라 충분하다(5단계와 같은 판단). 하위 작업 연쇄는 메모리의 부모 → 자식 맵으로 센다 |
| 판정 | 규칙 기반. 문턱값 다섯은 **프로젝트마다 `risk_setting`**(프로젝트당 한 줄, 없으면 기본값). 기본값(3 · 2 · 7 · 6 · 3)은 `config.py` 한 곳 | 같은 데이터 · 같은 기준이면 늘 같은 결과. 팀마다 회의 주기가 달라 화면에서 바꾼다 (Q33) |
| 챗봇 | `get_decision_risks` 도구 하나를 더한다. 모델 · effort 는 그대로 | 계산은 규칙이 했으니 Claude 는 고르고 설명만 한다 |

### 10-1 기준 · 계산 (Claude 없이)

- [x] 리비전 `0011_risk_setting` — `risk_setting(project_id PK · FK cascade, due_soon_days, defer_count, stale_days, high_score, medium_score, updated_at)` + 범위 CHECK · `high_score > medium_score`
- [x] `GET · PUT /api/projects/{projectId}/risk-settings` — 없으면 기본값, PUT 은 upsert. PUT 은 `require_project_admin`. 범위 · 대소 위반 422
- [x] `app/schemas/risk.py` — `RiskSettings` · `DecisionRiskReport` · `ThreadRisk` · `TaskRisk` · `OwnerLoad` (camelCase alias)
- [x] `app/services/risk.py` — 그 프로젝트의 기준을 읽어 신호 여덟 · 작업 신호 셋 · `owners` · 점수 · 등급 · 정렬 (`docs/api/risk.md` 그대로). 쓴 기준을 `settings` 로 싣는다
  - `overdue` 와 `dueSoon` 은 같이 안 낸다. `noDueDate` 는 연결된 작업이 있을 때만
  - `impactTaskCount` — 막힌 연결 작업과 그 하위(완료 제외)를 **중복 없이**. 계층 고리는 서비스가 막지만 방문 집합으로 한 번 더 지킨다
  - `idleDays` — 마지막 이력의 `created_at` 을 KST 날짜로 옮겨 센다. 이력이 없으면 안건 등록 시각
- [x] `GET /api/projects/{projectId}/risks` — `require_scope` 로 멤버 경계, 없는 프로젝트 404
- [x] `tests/test_risk.py` — 신호 하나에 검사 하나 이상 + 경계값(기한 당일 · 3일째 · 미룸 정확히 2번) · 정렬 고정 · 연쇄 중복 · 다른 프로젝트 연결이 안 섞임 · 권한(멤버 아님 — 스냅샷 경계대로 404) · **기준을 바꾸면 결과가 바뀜** · 설정 PUT 권한(일반 사용자 403) · 422
- [x] 시드에 리스크가 보이는 줄을 더한다 — 기한 지난 안건 하나 · 두 번 미룬 안건 하나 · 정해졌는데 막힘인 작업 하나

### 10-2 챗봇 도구

- [x] `TOOLS` 에 `get_decision_risks`(`member_id?` · `part_id?`) · `tool_label` · `run_tool` 갈래
- [x] 시스템 프롬프트에 규칙 넷(`docs/api/risk.md` '챗봇 도구') — `high` 부터, 왜 · 무엇이 막히나 · 다음 할 일, 근거 표시, 숫자를 지어내지 않는다
- [x] `test_chat.py` — 가짜 클라이언트로 도구 갈래 · 거르기(`member_id` · `part_id`) · 다른 프로젝트 id 를 못 찾음

### 10-3 평가 (사람이 돌린다)

- [ ] 7-3 평가셋에 질문 다섯 — "뭐가 제일 급해?" · "막힌 거 왜 막혔어?" · "김서연이 정해야 할 거" · "풀어도 되는 막힘 있어?" · 리스크가 하나도 없는 프로젝트

### 10-4 AI 요약

리스크 화면의 [AI 요약]. 계약은 `../docs/api/risk.md` 'AI 요약'(합의 2026-10-15).

- [x] `RiskSummaryInput` 스키마(각 0 ~ 100개) · `POST /api/projects/{projectId}/risks/summary` — 챗봇과 같은 제한 · 클라이언트 의존성 · SSE 응답을 그대로 쓴다
- [x] `app/services/risk_summary.py` — `decision_risks` 를 다시 계산해 보낸 id 로 거르고, 위쪽 안건 5개의 배경 · 후보 · 이력 · 연결 작업과 담당자 이름을 모은다. 둘 다 비면 Claude 없이 고정 문구
- [x] 도구 없이 한 번 스트림으로 부른다. 시스템 프롬프트는 계약의 '답의 모양' 그대로. 이벤트 · 오류 변환(`extract_refs` · `_api_error_event`)은 `chat.py` 것을 다시 쓴다
- [x] 검사 — 가짜 클라이언트로: 거르기(남의 id · 리스크 아닌 id 버림) · 빈 입력이면 Claude 를 안 부름 · 넣는 근거에 이름이 들어가고 id 가 안 샘 · 422 · 404 · 503(키 없음) · 스트림 중 오류

**끝난 것으로 보는 기준** — 시드 프로젝트에서 `GET .../risks` 가 넣어 둔 세 경우를 `high` · `medium` 과 작업 신호로 내고,
챗봇에 "이번 주 뭐부터 정해야 해?" 를 물으면 같은 순서로 근거 칩과 함께 답한다.

**커밋** — ① 기준 · 계산 + API ② 챗봇 도구 ③ 시드 · 평가 ④ AI 요약

**다음 (이 단계 밖)** — `task_log`(작업 상태 변경 이력)를 세워 `blockedDays` 를 더하고, 같은 계산으로 주간 결정 리포트(`agent-proposal.md` 7번)를 만든다.

## 11단계 · 확인 요청 — 작업 · 안건에 붙는 '확인해 주세요'

계약은 `../docs/api/check.md`(합의 2026-10-16 · Q38 ~ Q41 닫힘), 화면은 `../web/PLAN.md` 12단계다.
1차는 보내기 · 목록 · 확인 · 배지. 확인율 분석(2차)은 기록이 쌓인 뒤 따로 세운다 — **그래서 보낼 때 부하를 처음부터 찍는다.**

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 테이블 | `check_request` 하나. 작업 · 안건은 `task_id` · `thread_id` 두 칸 + 정확히 하나 CHECK, 복합 FK cascade | 걸린 것을 지우면 같이 지운다. 같은 프로젝트 것만 건다(Q13 · Q16 과 같은 방식) |
| 내보내기 | `targetType` · `targetId` 로 바꿔 낸다. 부하 네 칸은 안 낸다 | `null` 을 늘리지 않는다. 부하는 2차 분석만 쓴다 |
| 부하 | 보내는 트랜잭션 안에서 받는 사람마다 select 몇 번으로 센다. '기한 임박' 은 **오늘(KST) + 3일 고정** | 리스크 기준을 따르면 기준이 바뀔 때 지난 기록과 비교가 깨진다 |
| 배지 | `GET /api/checks/pending-count` — 지금 부여된 프로젝트만, 시스템 관리자도 부여된 것만 | 받는 사람은 부여된 멤버뿐이다 |

### 11-1 체크리스트

- [x] 리비전 `0012_check_request` — 테이블 · CHECK 둘(대상 하나 · `text` 길이) · 복합 FK 둘(cascade) · 인덱스 `(project_id, seq)` · `(recipient_id, confirmed_at)`
- [x] `app/models/check.py` · `app/schemas/check.py`(`CheckRequest` · `CheckRequestInput` · `CheckPendingCount`, camelCase alias — 응답 스키마 이름은 ORM 과 겹쳐 `CheckRequestOut`, 댓글의 `TaskCommentOut` 과 같은 방식)
- [x] `app/services/check.py` — 목록 · 보내기(검사 순서는 계약대로, 한 트랜잭션, 부하 찍기) · 확인(멱등) · 대기 수
- [x] `app/api/check.py` — 네 경로. `/api/checks/{checkId}` 는 `require_scope` 가 요청의 프로젝트로 본다(`services/access.py` 에 갈래)
- [x] 오류 코드 `CHECK_NOT_FOUND` · `CHECK_TARGET_NOT_FOUND` · `CHECK_RECIPIENT_SELF`(+ 이미 있는 `MEMBER_NOT_IN_PROJECT`)
- [x] 시드 `c1` ~ `c4`(계약 '시드 · 목업' 그대로, 부하는 넣을 때 계산)
- [x] `tests/test_check.py` — 보내기(여럿 · 겹친 사람 하나로 · 부하 값) · 검사(422 셋 · 400 셋 · 남의 프로젝트 대상) · 확인(받은 사람만 · 멱등) · 목록 경계(404) · 대기 수(프로젝트별 · 부여 빠진 프로젝트 제외) · 작업 · 안건 지우면 같이 지워짐 · `test_contract_types.py` 대조
- [x] `API.md` 네 줄 `구현`

**커밋** — ① 테이블 · API · 검사 ② 시드

### 2026-10-19 고침 — 결정 알림으로 좁힘 (Q42 ~ Q44)

작업 쪽을 걷고, 결정된 안건에서 본문 없이 보낸다. 받는 사람은 서버가 정한다 — 연결 작업 담당자 + 안건의 참조. 한 결정에 한 번.

- [x] 리비전 `0013_check_on_decision` — `check_request` 를 지우고 다시 세운다(있던 줄은 버린다, ALTER 없이). `task_id` · `text` · CHECK 둘 걷음, `thread_id` NOT NULL, `entry_id` → entry cascade, unique `(entry_id, recipient_id)`. `thread_cc` 생성. downgrade 는 옛 모양의 빈 테이블로
- [x] 참조 — `ThreadCc` · `Thread.cc`(thread_option 과 같은 방식), `ThreadOut.ccIds` · `ThreadCreate` · `ThreadPatch`(통째로 교체, `null` 은 422). 0 ~ 20명(합치기 전에 센다), 겹치면 처음 자리, 부여된 활성 멤버만 — 400 `MEMBER_NOT_IN_PROJECT` · `detail` 은 걸린 자리 전부. 이미 걸려 있던 사람은 담당자처럼 그대로 둘 수 있다
- [x] 보내기 `POST /api/threads/{threadId}/checks` — 404 → `CHECK_THREAD_NOT_DECIDED` → `CHECK_ALREADY_SENT`(최근 decide · change = seq 최대) → `CHECK_NO_RECIPIENTS`. 받는 사람은 `services/check.py` 의 `recipients_of`. 동시 요청은 unique 위반을 잡아 409. 옛 `POST /api/projects/{projectId}/checks` 는 걷음
- [x] `CheckRequestOut` 은 `threadId` · `entryId`. `CheckRequestInput` · `CheckTargetType` · `CHECK_TEXT_MAX` · `CHECK_TARGET_NOT_FOUND` · `CHECK_RECIPIENT_SELF` 걷음
- [x] 시드 — 참조 t1 · t2 · t6, 요청 c1 ~ c4 새 표 그대로. `test_seed` 가 c1 ~ c4 를 받는 사람 규칙과 대조
- [x] 검사 — `test_check.py` 다시 씀, 참조는 `test_thread_api.py`, `test_contract_types.py` · `test_read_api.py` 에 `ccIds` · 새 `CheckRequest`


## 12단계 · 회의록 — 회의록 글 → 초안 → 고른 것만 등록

계약은 `../docs/api/minutes.md`(합의 2026-10-19 · Q45 · Q46 닫힘, 녹음 Q47 은 2단계), 화면은 `../web/PLAN.md` 13단계다.
1단계는 **글**만 받는다. 회의록 원문 · 요약은 남기지 않는다 — 남는 것은 안건 · 이력 · 작업뿐이다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 테이블 | **늘지 않는다.** 마이그레이션 없음. 계약의 '확장'(`minutes_file` · `minutes_file_id`)은 만들지 않는다 | 원문을 남기지 않기로 했다(Q46). 늘릴 때는 더하기만 하면 되게 계약이 자리를 비워 뒀다 |
| 도구 루프 | 챗봇 것을 줄여 다시 쓴다 — 클라이언트 · `chat_model` · `chat_effort` · 분당 제한 · 503 · 거절 · 읽기 도구 넷(`run_tool`)이 같다. 내기 도구 `propose_minutes` 하나 | 같은 일을 두 벌 갖지 않는다. 글은 흘리지 않고 초안이 검사를 통과하면 바로 끝난다 |
| 상한 | 차례 10번 · 검사 실패 5번(`MINUTES_DRAFT_FAILED`) · `minutes_max_tokens` 16,000 | 안건을 찾는 차례 몇 번에 초안을 고치는 차례 다섯 번이 들어가야 한다. 초안 하나에 수십 줄이 실려 챗봇 답보다 길다 |
| 검사 | `services/minutes.py` 의 `minutes_problems` 하나를 `propose_minutes` 와 `apply` 가 같이 쓴다. 작업 줄은 `tasks/batch` 의 `task_problems` 그대로 | 챗봇의 `propose_tasks` ↔ `tasks/batch` 와 같다. Claude 가 낸 것이 [등록] 에서 다른 이유로 떨어지지 않는다 |
| 등록 | 한 트랜잭션. 상태 전이는 `thread_service.apply_entry_to_thread`, 작업은 `task_service._insert_task`(발번 · 상위 파트 따르기 · 링크) | 기존 이력 · 일괄 등록과 같은 코드라 규칙이 갈라지지 않는다 |

### 12-1 체크리스트

- [x] `app/schemas/minutes.py` — `MinutesDraftInput`(앞뒤 공백 뗀 뒤 1 ~ 60,000자) · `MinutesDraft` · `ProposedThread` · `ProposedEntry(Body)` · `ProposedMinutesTask` · `MinutesApplyInput` · `MinutesApplyResult` · 이벤트 넷
- [x] `app/services/minutes.py` — `normalize`(제목 · 글 공백, 후보 · 상세 빈 줄, `ownerId` 가 있으면 `ownerHint` 비움) · `shape_problems`(422) · `minutes_problems`(422 → 없는 안건 → 담당자 셋 → 상위 작업) · `apply_minutes`
- [x] `app/services/minutes_draft.py` — 시스템 프롬프트(오늘 KST · 프로젝트 이름 · 멤버 id · 이름 · 파트 · 규칙) · `propose_minutes` 도구 · 루프. 회의록은 사용자 메시지 하나(캐시)
- [x] `app/api/minutes.py` — `POST .../minutes/draft`(SSE) · `POST .../minutes/apply`(201), `main.py` 의 프로젝트 경계 목록에 등록
- [x] `errors.py` — 422 의 자리 표기를 `threads.N.…` · `entries.N.…` 로 넓힘
- [x] `tests/test_minutes.py` — apply(생성 순서 · 상태 전이 · 링크 · 발번 · 오류 코드 넷과 자리 · 하나 틀리면 아무것도 안 남음 · 담당자 그대로 두기 · Postgres) · 검사 함수 · draft(가짜 클라이언트 — 이벤트 · 고침 · 5번 실패 · 비었음 · 차례 상한 · 422 · 503 · 429 · 거절) · `test_contract_types.py` 에 새 타입
- [ ] 평가 — 양식이 다른 회의록 서너 벌(표 · 개조식 · 대화록)로 실제 키를 돌려 본다. 7-3 평가셋 옆에 둔다

### 2026-10-20 고침 — 회의록을 게시판으로 남긴다 (Q48)

위 '테이블 — 늘지 않는다' 를 뒤집는다. 회의록을 쓰고 · 읽고 · 고치고 · 지우고, AI 정리는 저장된 회의록 하나에서 부른다. 등록한 줄에는 출처가 붙는다.

- [x] 리비전 `0014_minutes` — `minutes`(id · project_id cascade · title · meeting_date · body · summary `''` · author_id · created_at · updated_at · seq Identity) · 인덱스 `(project_id, seq)`. `thread` · `entry` · `task` 에 `minutes_id` → minutes `ON DELETE SET NULL`(복합 FK 아님) + 인덱스. 기존 줄은 null. downgrade 도
- [x] `app/models/minutes.py` · `MinutesItem` · `MinutesOut`(= `Minutes`) · `MinutesCreate`(= `MinutesInput`) · `MinutesPatch`(보낸 칸만, `title` · `body` 의 null 은 422). 제목 1 ~ 200 · 본문 1 ~ 60,000, 앞뒤 공백 뗀 뒤 세고 **뗀 값을 저장**. `MinutesDraftInput` 걷음
- [x] CRUD — `GET · POST /api/projects/{projectId}/minutes`(목록은 회의 날짜 내림차순 null 맨 뒤 → seq 내림차순) · `GET · PATCH · DELETE /api/minutes/{minutesId}`. 고치기는 작성자만, 지우기는 작성자 · 프로젝트 관리자 · 시스템 관리자(댓글과 같은 `Scope.can_manage`). `require_scope` 에 `minutes_id` 갈래 → 남의 것 · 없는 것 404 `MINUTES_NOT_FOUND`. 지우기는 세 표의 `minutes_id` 를 먼저 비우고(세션에 올라 있는 줄까지) 지운다
- [x] `POST /api/minutes/{minutesId}/draft` — 본문 없음. 사용자 메시지는 `제목: … / 회의 날짜: …(없으면 '(적혀 있지 않음)') / 본문`. 회의 날짜가 있으면 프롬프트의 날짜 규칙이 그 날 기준으로 바뀌고 초안의 `meetingDate` 를 그 값으로 덮는다
- [x] `POST /api/minutes/{minutesId}/apply` — 회의록의 프로젝트에서 만든다. 새 안건 · 이력(새 · 기존 안건) · 작업에 `minutes_id`, 기존 안건 자체에는 안 붙임. `summary` 를 보내면(null 은 안 보낸 것) 앞뒤 공백 떼고 저장, **`updated_at` 은 그대로**(사람이 고친 때). 실패하면 요약도 안 남는다. 프로젝트 경로 둘은 걷음
- [x] `ThreadOut` · `EntryOut` · `TaskOut` 에 `minutesId` — 스냅샷 · 쓰기 응답 · 검색에 실린다. 손으로 만든 것은 null
- [x] 시드 `m1`(p1 · u1 · 2026-10-16 · 본문은 `MINUTES_EXAMPLE` 글자 그대로, `createdAt` · `updatedAt` 은 `2026-10-16T06:30:00Z`). `test_seed` 가 화면 픽스처 파일과 글자 대조
- [x] 검사 — `test_minutes.py` 를 새 경로로 옮기고 CRUD · 권한(작성자 · 다른 멤버 · 프로젝트 관리자 · 시스템 관리자) · 지우면 출처만 빔 · 목록 순서 · draft 가 저장된 본문 · 날짜를 씀 · apply 출처 · 요약 · 남의 프로젝트 404 · Postgres(SET NULL · nulls last). `test_contract_types.py` 에 `MinutesItem` · `Minutes` · `MinutesInput` · `minutesId`, `test_read_api.py` 키 목록
- [x] 개발 DB — `alembic upgrade head` 후 `m1` 한 줄만 넣음(시드는 안 돌림)

**다음 (이 단계 밖)** — 1-2 `.docx` · `.pdf` 를 서버가 글로 뽑기, 계약의 '확장'(`minutes_file`), 2단계 녹음(Q47).

## 13단계 · 선행 작업 · 작업 상태 기록 — 리포트의 바탕

계약은 `../docs/api/task-flow.md`(합의 2026-10-20 · Q49 · Q50 닫힘), 화면은 `../web/PLAN.md` 14단계다.
리포트(`../docs/api/report.md`, 14단계)가 "A 가 먼저" · "오래 걸림" 을 말하려면 둘 다 데이터로 있어야 한다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 검사 | `services/dependency.py` 의 `check` 하나 — 프로젝트의 계층 · 선행을 한 번 읽어(`load_graph`) 메모리에서 본다. PUT 과 AI 제안이 같이 쓴다 | 제안 수십 개를 거를 때 줄마다 DB 를 다시 읽지 않고, 앞에서 받아들인 제안까지 얹어 순환 · 개수를 본다 |
| 상태 기록 | `services/task.py` 의 `record_status` 하나. 작업이 생기는 길은 전부 `_insert_task` 를 지나므로(등록 · 일괄 · 회의록 apply) 거기서 첫 줄, PATCH 는 상태가 바뀔 때만 | 길마다 따로 적으면 하나를 빠뜨린다 |
| 마지막 줄 | `seq` 가장 큰 줄 — `changed_at` 으로 고르지 않는다 | Q15 와 같다. 시연 스크립트가 넣는 줄은 시각이 더 이르지만 나중 줄이다 |
| AI 제안 | 리스크 요약과 같은 틀 — 요청 모양(`risk_summary.one_shot`) · 문턱(`api/chat.ready_client` — 503 · 429) · SDK 오류 바꾸기(`chat._api_error_event`)를 같이 쓴다. Claude 는 작업을 **키**로만 본다 | id 를 넣으면 지어낸 id 와 진짜를 가르기 어렵다. 키는 프로젝트 안에서 유일해 되돌리기 쉽다 |

### 13-1 체크리스트

- [x] 리비전 `0015_task_flow` — `task_dependency`(pk (task_id, depends_on_id) · 복합 FK 둘 cascade · `task_id <> depends_on_id` · created_by → member) · `task_log`(복합 FK cascade · from/to 상태 check · changed_by null · seq Identity · backfilled) · 인덱스 `(task_id, seq)`. 기존 작업마다 backfill 한 줄(등록 순서대로 seq 를 직접 주고 Postgres 시퀀스를 민다). downgrade 도
- [x] `PUT · DELETE /api/tasks/{taskId}/dependencies/{dependsOnId}` — 멱등. 404 `TASK_NOT_FOUND` → 400 `TASK_DEPENDENCY_HIERARCHY` → 409 `TASK_DEPENDENCY_CYCLE` → 400 `TASK_DEPENDENCY_LIMIT`(20). 이미 걸린 것은 검사 없이 200. 스냅샷 `taskDependencies`(taskId, dependsOnId 순)
- [x] `task_log` — 등록 · PATCH · `tasks/batch` · 회의록 apply. 상태 그대로인 PATCH 는 안 남김. `TaskOut` 에 `statusChangedAt` · `statusSinceBackfill` — 스냅샷 · 쓰기 응답 · 챗봇 `get_task`
- [x] `POST /api/projects/{projectId}/dependencies/suggest` — `services/dependency_suggest.py`. 완료 아닌 작업 200개(기한 이른 순 null 뒤 → 등록 순) · 본문 앞 3줄 · 걸린 안건 제목 · 넣은 작업끼리의 선행. 답은 JSON(코드 블록 표시는 떼고 읽음), 모양이 틀리거나 거절이면 502 `DEPENDENCY_SUGGEST_FAILED`
- [x] 시드 — 선행 셋, 작업마다 상태 한 줄(start 0시 UTC, 없으면 등록 시각), k20 · k22 는 등록(todo) 줄 + 시연 줄. `scripts/demo_task_log.py` — 개발 DB 에 선행 셋 · 시연 줄만(있거나 지금 상태가 다르면 건너뜀)
- [x] 검사 — `tests/test_task_flow.py`(PUT/DELETE 검사 전부 · 권한 · cascade · 길마다 기록 · 상태 그대로 PATCH · seq 로 마지막 줄 · 마이그레이션 backfill · 시연 스크립트 · 제안 거르기 · 20개 · 잘림 · 502 · 503 · 429). `test_contract_types.py` · `test_read_api.py` 키 목록
- [x] 개발 DB — `alembic upgrade head` · `scripts/demo_task_log.py`(시드는 안 돌림)
- [ ] 평가 — 실제 키로 제안을 돌려 근거가 약한 것이 섞이는지 본다. 7-3 평가셋 옆에 둔다

## 14단계 · 프로젝트 진행 리포트 — 지난 7일을 규칙으로 세고 Claude 가 손쓸 것을 쓴다

계약은 `../docs/api/report.md`(합의 2026-10-20 · Q49 ~ Q51 닫힘), 화면은 `../web/PLAN.md` 15단계다.
바탕은 13단계(선행 작업 · 상태 기록)와 10단계(결정 병목 계산 · AI 요약의 틀)다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 계산 | `services/progress.py` 의 `progress_facts` 하나 — 리스크와 같이 몇 번의 select 로 다 읽고 파이썬에서 센다. `today` 를 인자로 받는다. 리포트는 `progress_with_risks` 로 병목 안건의 등급 · 신호까지 같이 받는다 | 나중의 챗봇 도구가 같은 함수를 부른다. 리스크를 두 번 세지 않는다 |
| 문턱값 | 리스크 기준(`RiskSettings`) 그대로. `decidedButBlocked` 도 `decision_risks` 의 것을 쓴다 | 기준이 두 벌이면 리스크 화면과 리포트가 다른 말을 한다 |
| Claude | 리스크 AI 요약과 같은 틀 — `risk_summary.one_shot` · `api/chat.ready_client`(503 · 429, 제한기 공유) · `chat._api_error_event` · `extract_refs`. 도구 없이 한 번 | 같은 오류 처리 · 같은 모델 설정 |
| 저장 | `services/report.py` 의 `write` 맨 끝 한 자리에서만 — 스트림이 끝까지 성공한 뒤. 끊김 · error 면 거기 닿지 않는다 | 화면이 [멈추기] 를 누르거나 연결이 끊기면 제너레이터가 저장 전에 멈춘다 |
| facts | jsonb(검사의 sqlite 는 JSON)에 camelCase 그대로. 목록의 숫자도 여기서 읽는다 | 만든 때의 계산이다 — 다시 세지 않는다 |

### 14-1 체크리스트

- [x] 리비전 `0016_project_report` — `project_report`(project cascade · facts jsonb · created_by → member · seq Identity unique) · 인덱스 `(project_id, seq)`. downgrade 도. 시드 `clear` 에 더함(시드 리포트는 없다)
- [x] `services/progress.py` — 신호 일곱 · 점수 · 정렬 · 30개 · KST 날 수 · previous · 사람별
- [x] `GET · POST /api/projects/{projectId}/reports` · `GET · DELETE /api/reports/{reportId}` — SSE `facts → delta… → done{report, refs}`, 작업 0개는 Claude 없이 고정 문구, 잘리면 한 줄 붙여 저장, refs 는 넣어 준 id 만. 경로 `report_id` 를 `require_scope` 에(404 `REPORT_NOT_FOUND`), 지우기는 만든 사람 · 프로젝트 관리자 · 시스템 관리자
- [x] 시스템 프롬프트 · 넣는 근거 — 계약의 'Claude 가 쓰는 것' 그대로(이름으로만, attention 위 8개 상세, 기간의 결정 이력, 앞 리포트 글)
- [x] 검사 — `tests/test_progress.py`(신호마다 · backfill · 점수 · 정렬 · 30개 · previous · 완료 제외 · 시드 HW-20) · `tests/test_report.py`(SSE 순서 · 저장 · 실패 · 끊김 · 작업 0개 · refs · 근거 · 503 · 429 · 권한 · 404) · `test_contract_types.py` 의 리포트 모양
- [x] 개발 DB — `alembic upgrade head`(시드는 안 돌림). 실제 키로 p1 리포트 한 편을 만들어 봤다
- [ ] 평가 — '먼저 손쓸 것' 이 attention 순서 · 숫자를 지키는지, 지어낸 근거가 없는지 몇 번 돌려 본다. 7-3 평가셋 옆에 둔다

## 15단계 · LLM 공급자 분리 — Claude · GPT · Groq 를 설정으로 고른다

서비스는 `app/llm` 의 `LLMProvider` 만 본다. 공급자 SDK(`anthropic` · `openai`)는 `app/llm` 밖으로 새지 않는다.
API 계약(SSE 이벤트 · 오류 코드)은 바뀌지 않는다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 경계 | `LLMProvider.stream(system, user_text)` → `TextDelta…` · `Finished(stop)`. 멈춘 이유는 `end` · `max_tokens` · `refused` 셋으로 접는다. SDK 오류는 `LLMError(code, message)` — code 는 `CHAT_RATE_LIMITED` · `CHAT_UNAVAILABLE` 그대로 | 공급자마다 이름이 다른 stop · 오류를 서비스가 몰라도 되게 |
| Claude 전용 기능 | effort · 서버 쪽 대체 모델(`fallbacks`) · 프롬프트 캐시는 `AnthropicProvider` 안에만 둔다 | 다른 공급자에는 없다 — 있으면 쓰고 없으면 건너뛴다 |
| 주입 | `api/chat.get_llm` — 지금은 `get_chat_client` 위에 `AnthropicProvider` 를 씌운다 | 기존 가짜 클라이언트 검사를 그대로 두고 동작이 안 바뀐 것을 확인한다 |
| GPT · Groq | `OpenAICompatProvider` 하나 — Groq 는 OpenAI 호환이라 `base_url` 만 다르다. Responses API 가 아니라 Chat Completions 를 쓴다 | 어댑터 하나로 둘. Groq 가 받는 것은 Chat Completions 다 |
| 고르기 | `LLM_PROVIDER` 하나를 모든 AI 경로가 같이 쓴다. 고른 공급자의 키 · 모델이 없으면 다른 공급자로 넘어가지 않고 503 | 몰래 다른 공급자로 새면 비용 · 데이터가 가는 곳이 바뀐다 |

### 15-1 체크리스트

- [x] 1차 (2026-10-22) — `app/llm`(`base.py` · `anthropic_provider.py`) · 한 번 부르는 셋(리스크 요약 · 리포트 · 선행 관계 제안)을 `LLMProvider` 로. `risk_summary.one_shot` · `api/chat.ready_client` 를 걷고 `get_llm` · `ready_llm` 로. `FALLBACK_BETA` · `make_client` · 오류 접기를 `app/llm/anthropic_provider.py` 로 옮김. 검사 `tests/test_llm.py`(SDK 와 무관한 가짜 공급자로 세 서비스 · stop · 오류 접기)
- [x] 2차 (2026-10-22) — 도구 루프(`chat` · `minutes_draft`)를 옮김. `LLMProvider.turn` — 대화(`UserMessage` · `AssistantMessage`) · 도구(`ToolSpec` · `ToolCall` · `ToolResult`) · 멈춘 이유에 `tool_use` · `paused`. 답의 원본은 `AssistantMessage.native` 로 들고 다닌다(Claude 의 thinking 서명). 회의록 캐시는 `UserMessage(cache=True)` 표시로. 챗봇 · 회의록 경로도 `get_llm` · `ready_llm`. 이제 `app/services` 에 `anthropic` import 가 없다. 검사 `tests/test_llm.py` 에 도구 루프 · paused · 메시지 변환
- [x] 3차 (2026-10-22) — `app/llm/openai_compat.py` 의 `OpenAICompatProvider`(Chat Completions 스트림 · 조각으로 오는 tool_calls 모으기 · `finish_reason` 접기 · `max_completion_tokens`). `config.py` 에 `llm_provider` · `openai_api_key` · `openai_model` · `groq_api_key` · `groq_model`(모델 기본값 없음). `get_llm` 이 설정을 보고 고른다. 의존성 `openai`. 검사 `tests/test_openai_compat.py`(가짜 OpenAI 클라이언트 · 진짜 `ChatCompletionChunk`)
- [ ] 평가 — 공급자를 바꿔 챗봇 · 회의록 초안 · 리포트를 실제 키로 돌려 본다. 프롬프트는 Sonnet 에 맞춰 다듬어져 있다 — 작은 모델은 도구를 엉뚱하게 부르거나 JSON 모양(선행 관계 제안)을 틀릴 수 있다
- [ ] 나중에 — 기능별로 공급자를 고르기(예: 챗봇은 Claude, 요약은 Groq). 지금은 하나를 모두가 같이 쓴다. GPT 추론 모델의 `reasoning_effort` 도 아직 안 싣는다

## 16단계 · 테스트 — 기능 · 시나리오 테스트를 작업과 따로 두고 지금의 상황을 보인다

계약은 `../docs/api/test.md`(합의 2026-10-27 · Q53 ~ Q58 닫힘), 기획은 `../docs/test-proposal.md`, 화면은 `../web/PLAN.md` 16단계다.
**1단계는 AI 없이** — 쓰기 · 상태 · 태그 · 며칠째 · 신호 · 기준 바뀜. AI 셋과 챗봇 도구는 2단계에서 계약을 더한 뒤다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 테이블 | `test_case` · `test_step` · `test_ref` 셋 + `project.next_test_no`. 작업 테이블에 섞지 않는다 (Q55) | 진척 · 리스크 · 리포트 · 스냅샷에 처음부터 안 섞인다 |
| 셈 | `services/test.py` 의 `signals` · `status_days` · `_build` — 목록을 몇 번의 select(테스트 · 단계 · 태그 · 링크 · Entry · 묶음 · 기준)로 읽고 파이썬에서 센다. `today` 는 라우트가 넘긴다 | 리스크 · 리포트와 같은 틀. 나중의 챗봇 도구가 같은 함수를 부른다 |
| 문턱값 | 리스크 기준(`RiskSettings`)의 `staleDays`, 기간은 리포트와 같은 `plannedDays × 1.5`(정수 비교) | 기준이 두 벌이면 화면마다 다른 말을 한다 |
| 기준 바뀜 | `basis_seq` 하나 — 만들 때 · PATCH · 태그 걸기/떼기 · `POST .../basis` 에서 다시 찍는다. 시각이 아니라 Entry `seq` 로 본다 (Q15) | 늦게 넣으면 그 앞 기준은 되살릴 수 없다 |
| 경계 | `require_scope` 에 `test_id` 갈래(404 `TEST_NOT_FOUND`). 지우기는 만든 사람 · `scope.can_manage` | 회의록 · 리포트와 같은 경계 |

### 16-1 체크리스트 (1단계, AI 없이)

- [x] 리비전 `0017_test_case` — `project.next_test_no`(기본 1) · `test_case`(복합 FK 상위 · 파트, CHECK 다섯, `(project_id, seq)` 인덱스) · `test_step`(cascade, `(test_id, sort_order)` 유니크) · `test_ref`(대리 키 `id`, 작업 · 안건 중 정확히 하나, 복합 FK 셋 cascade). downgrade 도. 시드 `clear` · `advance_identity` 에 더함
- [x] `app/models/test.py` · `app/schemas/test.py`(camelCase alias) · `app/services/test.py` · `app/api/test.py` — 엔드포인트 아홉. 422 `detail` 은 `steps.2.action` · `refs.0.kind` 까지 짚는다(`errors.py` 의 `_INDEXED`)
- [x] 시드 HW-T1 ~ T8 — 목업 `web/src/fixtures/tests.ts` 를 그대로(id `tc1` ~ `tc8`). 고른 태그 · `basis_seq` 는 계약의 '구현에서 메운 것'
- [x] 검사 — `tests/test_test.py`(CRUD · 검사 오류 코드 전부 · 권한 · 다른 프로젝트 404 · 상태 규칙 · 신호 여섯과 경계값 · 기준 설정을 바꾸면 신호가 바뀜 · 기준 바뀜이 PATCH · basis · 태그로 지워짐 · 태그한 작업으로 닿는 안건 · 키 발번 · 작업 · 안건을 지우면 태그만 빠짐 · 목록 쿼리 수가 테스트 수에 안 늘어남) · `test_contract_types.py` 의 테스트 모양
- [x] 2026-10-27 고침 — 레벨을 걷었다(사용자 결정). 리비전 `0018_test_drop_level`(batch 로 CHECK · 열 지우기, downgrade 는 null 가능 열로만 되살림 — 값은 안 돌아온다) · 모델 · 스키마 · 시드 · 검사에서 `level` 을 뺐다. 요청에 `level` 이 와도 버린다(`Schema` 는 extra 를 따로 정하지 않아 Pydantic 기본 `ignore`)
- [ ] `API.md` 의 엔드포인트 줄을 `구현` 으로 — 프론트 에이전트와 겹치지 않게 이번에는 안 건드렸다
- [ ] 개발 DB — `alembic upgrade head` 와 시드는 사람이 돌린다

### 16-2 그 다음 (계약을 먼저 더한다)

- [ ] AI 테스트 검토 · 빠진 테스트 찾기(+ 한 번에 추가) · 바뀐 자리 설명 — `docs/api/test.md` '나중'
- [ ] 챗봇 도구 `get_tests` · `get_test`, 근거 칩 `[[test:ID]]`

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
| 4 프론트 붙이기 | **끝남** (2026-10-11) — 화면이 서버에 붙었다(`web/PLAN.md` 3단계). 오류 형식 통일 · 목업 스위치. 타입 생성은 안 하고 `test_contract_types.py` 로 대조 |
| 5 집계를 서버로 | 시작 전 |
| 6 품질과 운영 | 시작 전 |
| 7 AI 챗봇 | 계약 **합의** (2026-10-11) — `docs/api/chat.md` · Q25 ~ Q28 닫힘. **7-1 검색 끝남** (2026-10-11) — 리비전 `0006_search_trgm` · `GET .../search` 구현 · Postgres 검사는 컨테이너가 있을 때만(Q27). **7-2 채팅 끝남** (2026-10-11) — `POST .../chat` SSE · 도구 루프 · 제한 · 가짜 클라이언트 검사 33개. **작업 초안 끝남** (2026-10-12) — `list_members` · `propose_tasks` 도구 · `proposal` 이벤트 · `ChatMessage.proposal` · `POST .../tasks/batch`(한 트랜잭션). 다음은 7-3 평가셋 |
| 8 인증과 권한 | **끝남** (2026-10-13) — 리비전 `0008_auth` · 로그인 · 세션 · 권한 셋 · 사용자 관리 · 프로젝트 멤버 · 이미 있는 API 의 경계. Q29 ~ Q31 닫힘 |
| 9 파트 | **끝남** (2026-10-14) — 리비전 `0009_part` · 파트 쓰기 넷 · 작업 · 안건의 `partId` · 스냅샷 `parts` · `partMembers` · 시드 pt1 ~ pt3. Q32(보관 파트 상속) 열림 |
| 10 결정 병목 리스크 | 계약 **합의** (2026-10-15) — `docs/api/risk.md` · Q33 ~ Q35 닫힘(기준은 프로젝트마다 · 화면은 '리스크' 메뉴). **10-1 기준 · 계산 끝남** (2026-10-15) — 리비전 `0011_risk_setting` · `GET · PUT .../risk-settings` · `GET .../risks` · `services/risk.py` 의 `decision_risks` · 시드 `k22`(정해졌는데 막힘). API.md 두 줄 `구현`. **10-2 챗봇 도구 끝남** (2026-10-15) — `get_decision_risks`(`member_id` · `part_id` — 파트는 이름도 받는다) · 라벨 · 프롬프트 규칙 · `services/risk.py` 의 `decision_risks_for`. **10-4 AI 요약 끝남** (2026-10-15) — `POST .../risks/summary` SSE · `services/risk_summary.py` · 도구 없이 한 번 · 챗봇과 제한기 공유 · 가짜 클라이언트 검사 25개. API.md 그 줄 `구현`. 다음은 10-3 평가 |
| 11 확인 요청 | 계약 **합의** (2026-10-16) — `docs/api/check.md` · Q38 ~ Q41 닫힘. **11-1 끝남** (2026-10-16) — 리비전 `0012_check_request` · 네 경로 · `services/check.py`(보낼 때 부하 찍기, 기한 임박은 오늘(KST) + 3일 고정) · `require_scope` 의 `check_id` 갈래 · 시드 `c1` ~ `c4` · `tests/test_check.py`. API.md 네 줄 `구현`. **2026-10-19 고침 끝남** — 결정 알림으로 좁힘 · 참조(`thread_cc`) · 리비전 `0013_check_on_decision`. 2차(확인율 분석)는 기록이 쌓인 뒤 |
| 12 회의록 | 계약 **합의** (2026-10-19) — `docs/api/minutes.md` · Q45 · Q46 닫힘. **12-1 끝남** (2026-10-19) — `POST .../minutes/draft`(SSE · `propose_minutes`, 챗봇 루프 재사용) · `POST .../minutes/apply`(한 트랜잭션) · 검사 함수 하나를 둘이 같이 씀 · 마이그레이션 없음. API.md 두 줄 `구현`. **2026-10-20 고침 끝남** (Q48) — 게시판(`minutes` · CRUD) · draft/apply 를 `/api/minutes/{id}/…` 로 · 출처 `minutesId` · 요약 저장 · 리비전 `0014_minutes` · 시드 `m1`. API.md 네 줄 `구현 (2026-10-20 고침)`. 다음은 평가 |
| 13 선행 작업 · 작업 상태 기록 | 계약 **합의** (2026-10-20) — `docs/api/task-flow.md` · Q49 · Q50 닫힘. **13-1 끝남** (2026-10-20) — 리비전 `0015_task_flow`(backfill 포함) · 선행 PUT · DELETE · 검사 함수 하나 · `task_log` 를 모든 길에서 · `Task.statusChangedAt` · `statusSinceBackfill` · AI 제안(JSON, 리스크 요약 틀 재사용) · 시드 · `scripts/demo_task_log.py`. API.md 두 줄 `구현`. 다음은 14 리포트 |
| 14 프로젝트 진행 리포트 | 계약 **합의** (2026-10-20) — `docs/api/report.md` · Q49 ~ Q51 닫힘. **14-1 끝남** (2026-10-20) — 리비전 `0016_project_report` · `services/progress.py`(ProgressFacts) · 리포트 넷(만들기는 SSE, 다 받았을 때만 저장) · Claude 는 리스크 요약 틀 재사용. API.md 두 줄 `구현`. 다음은 평가 |
| 15 LLM 공급자 분리 | **1차 ~ 3차 끝남** (2026-10-22) — `app/llm` 의 `LLMProvider` · `AnthropicProvider` · `OpenAICompatProvider`, AI 를 부르는 서비스 다섯을 모두 옮김. `LLM_PROVIDER` 로 Claude · GPT · Groq 를 고른다. 동작 · 계약은 그대로. 다음은 실제 키로 평가 |
| 16 테스트 | 계약 **합의** (2026-10-27) — `docs/api/test.md` · Q53 ~ Q58 닫힘. **16-1 끝남** (2026-10-27) — 리비전 `0017_test_case` · 엔드포인트 아홉 · `services/test.py`(며칠째 · 신호 여섯 · 기준 바뀜, 리스크 기준 그대로) · `require_scope` 의 `test_id` 갈래 · 시드 HW-T1 ~ T8(목업과 같은 줄) · `tests/test_test.py`. 다음은 API.md `구현` 표시와 2단계(AI) |

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
- ~~**에러 응답 형식**~~ — 정했다(2026-09-28 · Q14). `{ code, message, detail? }` 한 가지이고 422 도 같은 모양이다
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

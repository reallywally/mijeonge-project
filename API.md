# API 계약

프론트(`web/`)와 서버(`server/`)가 맺은 계약이다. 두 에이전트는 서로 직접 말하지 못한다 —
주고받는 말은 전부 이 문서를 거친다. 세션이 끝나도 남는 자리다.

- 제품 결정의 정답은 `memo.md`, 화면이 쓰는 모양의 정답은 `web/src/types/domain.ts` 다.
  이 문서는 **그 둘 사이에서 오간 합의와 아직 안 풀린 것**만 적는다
- 계약을 바꾸는 일은 **코드보다 여기가 먼저다**
- 무엇을 어떤 순서로 만들지는 `server/PLAN.md` · `web/PLAN.md` 가 갖는다

### 문서 지도

이 파일은 **지금 살아 있는 계약의 목차**만 둔다 — 공통 규칙 · 에러 · 엔드포인트 표 · 열린 질문.
도메인별 자세한 모양은 `docs/api/` 에 나눠 두고, 일에 걸린 파일만 읽는다.

| 파일 | 담는 것 |
| --- | --- |
| `docs/api/snapshot.md` | `ProjectSnapshot` 응답 · `ProjectInput` 요청 · `task.key` 발번 |
| `docs/api/chat.md` | AI 챗봇 — 요청 · SSE 스트림 · 근거 표시 · 검색 · 작업 초안 · 한 번에 등록 |
| `docs/api/auth.md` | 로그인 · 세션 · 권한 셋 · 사용자 관리 · 프로젝트 멤버 |
| `docs/api/part.md` | 파트 — 보기 범위(권한 아님) · 파트 관리 · 작업 · 안건의 `partId` |
| `docs/api/risk.md` | 결정 병목 리스크 — 안 정해진 안건이 막는 일 · 신호 · 점수 · 챗봇 도구 `get_decision_risks` |
| `docs/api/decisions.md` | 닫힌 질문(Q1 ~ ) · 결정 로그. **코드 주석의 `API.md Qn` 은 여기 있다** |

- 새 도메인의 계약이 길어지면(표 한 줄로 안 끝나면) `docs/api/<도메인>.md` 를 새로 세우고 위 표에 줄을 더한다
- 질문이 닫히면 '열린 질문' 에서 `docs/api/decisions.md` 로 옮긴다. 결정 로그도 그 파일 맨 위에 더한다

## 공통 규칙

| | |
| --- | --- |
| 베이스 | `/api` |
| JSON 키 | camelCase — 서버 안은 snake_case 를 쓰고 경계에서 Pydantic alias 로 바꾼다 |
| id | 전부 문자열. DB 가 UUID 라도 내보낼 때 `str` |
| 날짜 | 사람이 고른 날짜(`Task.start` · `Task.due` · `Thread.dueDate`)는 `YYYY-MM-DD`, `createdAt` 은 **ISO 8601 UTC · 항상 `Z` 접미 한 가지 형식**. **오프셋(`+09:00`)을 섞지 않는다** — 프론트가 문자열 비교로 정렬한다 (Q3 닫힘 — 화면에 찍을 때 `lib/date.ts` 가 KST 로 옮긴다) |
| 스코프 | 경로에 프로젝트를 둔다 — `/api/projects/{projectId}/...`. 프로젝트 목록만 예외 |
| 인증 | **세션 쿠키** — `/api/health` · `POST /api/auth/login` 말고는 전부 로그인이 필요하다. 권한은 시스템 관리자 · 프로젝트 관리자 · 일반 사용자 셋 (`docs/api/auth.md`, 8단계 · 구현) |
| 집계 타입 | `ThreadRow` · `ThreadDetail` · `TaskRow` 는 서버가 주지 않는다 — 프론트 스토어가 계산한다 |
| 빈 값 | 빈 문자열은 `''`, 빈 배열은 `[]`. **`null` 은 정해진 여섯 이름에서만 나간다** — `docs/api/snapshot.md` 의 '빈 값은 `null` 이 아니다' (Q17 닫힘) |
| 에러 | HTTP 상태 + 본문 `{ code, message, detail? }` 한 가지 — 아래 '에러' (Q14 닫힘) |

## 에러

성공이 아닌 응답은 **전부** 이 한 가지 모양이다 (Q14 닫힘).

```json
{ "code": "PROJECT_NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다." }
```

| 키 | |
| --- | --- |
| `code` | 화면이 갈라 보는 기계용 문자열. SCREAMING_SNAKE |
| `message` | 손대지 않고 그대로 띄울 수 있는 **한국어 한 줄** |
| `detail` | 선택. 폼 검증에서 필드별로 쓴다 — `{ "필드 이름": "메시지" }`. 없으면 **키째로 빼고 낸다**(`exclude_none`). 프론트 타입이 `detail?` 다 |

- FastAPI 기본 `{"detail": "..."}` 로 새지 않게 `HTTPException` · `RequestValidationError` ·
  못 잡은 예외 셋을 **예외 핸들러로 받아 같은 모양으로 바꾼다**. **422 검증 오류도 같은 모양**이다
- 읽기 API 에 필요한 `code` 는 아래 셋뿐이다. 쓰기 API 의 것은 3단계에서 늘린다

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `PROJECT_NOT_FOUND` | 없는 `projectId` 로 스냅샷을 부를 때 |
| 422 | `VALIDATION_ERROR` | 요청이 스키마와 안 맞을 때. `detail` 에 필드별 메시지 |
| 409 | `PROJECT_PREFIX_TAKEN` | 이미 쓰는 `taskKeyPrefix` 로 프로젝트를 만들 때. 접두사는 프로젝트 사이에 유일하다 (Q20) |
| 500 | `INTERNAL_ERROR` | 그 밖. `message` 는 고정된 한국어 한 줄이고 속사정을 싣지 않는다 |

쓰기 API 의 `code` 는 아래와 같다. 화면이 갈라 볼 수 있게 '없다' 와 '규칙에 어긋난다' 를 나눠 둔다.

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `TASK_NOT_FOUND` · `THREAD_NOT_FOUND` · `TASK_LINE_NOT_FOUND` | 경로가 가리키는 것이 없을 때 |
| 400 | `TASK_PARENT_SELF` · `TASK_PARENT_NOT_FOUND` · `TASK_PARENT_OTHER_PROJECT` · `TASK_PARENT_DESCENDANT` | 상위 작업이 고리를 만들거나 다른 프로젝트에 있을 때 (Q16) |
| 400 | `THREAD_PARENT_NOT_FOUND` · `THREAD_PARENT_OTHER_PROJECT` | 상위 안건이 없거나 다른 프로젝트에 있을 때 (Q16) |
| 400 | `TASK_THREAD_LINK_OTHER_PROJECT` | 링크가 프로젝트를 넘으려 할 때 (Q13) |
| 400 | `TASK_LINE_NOT_CHECKABLE` | 체크박스가 아닌 줄을 켜고 끄려 할 때 |
| 404 | `COMMENT_NOT_FOUND` | 경로의 댓글이 없을 때(수정 · 삭제). 댓글 목록 · 등록에서 작업이 없으면 `TASK_NOT_FOUND` |
| ~~400~~ | ~~`COMMENT_AUTHOR_NOT_FOUND`~~ | **8단계부터 안 나온다** — 작성자는 로그인한 사람이고 `authorId` 를 받지 않는다(`docs/api/auth.md`). 빈 `body`(앞뒤 공백을 뗀 뒤)는 422 `VALIDATION_ERROR` |
| 400 | `TASK_OWNER_NOT_FOUND` | 작업 등록(`POST .../tasks`) · 수정(`PATCH /api/tasks/{taskId}`) · 일괄 등록(`tasks/batch`)의 `ownerId` 가 없는 멤버일 때 — **8단계부터는 그 프로젝트의 활성 멤버가 아닐 때**(이미 걸린 담당자를 그대로 두는 수정은 통과). `detail` 은 단건이면 `{ "ownerId": … }`, 일괄이면 `{ "tasks.2.ownerId": "담당자를 찾을 수 없습니다." }` 처럼 자리를 짚는다 |

챗봇의 `code` 는 아래와 같다 (합의 2026-10-11). 스트림이 열리기 **전**의 실패는 위와 같은 JSON 본문이고,
열린 **뒤**의 실패는 `error` 이벤트에 같은 모양(`{ code, message }`)으로 실린다.

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 503 | `CHAT_UNAVAILABLE` | 서버에 API 키가 없거나 AI 쪽이 응답하지 않을 때 |
| 429 | `CHAT_RATE_LIMITED` | 짧은 시간에 너무 많이 물을 때 (서버의 제한 · AI 쪽의 제한 둘 다) |
| 422 | `VALIDATION_ERROR` | 메시지가 비었거나, 너무 길거나, 너무 많을 때 — 위의 공통 코드를 그대로 쓴다 |
| 200 (`error` 이벤트) | `CHAT_REFUSED` | AI 가 답하기를 거절했을 때. 스트림 중에만 나온다 |
| 200 (`error` 이벤트) | `INTERNAL_ERROR` | 스트림 중 서버 안의 오류 — 위의 공통 코드를 그대로 쓴다 |

## 엔드포인트

상태: `초안`(서버가 올림) · `검토`(프론트가 보는 중) · `합의`(양쪽 확인) · `구현`(서버 완료) · `연결`(프론트 연결 완료)

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 앱이 떠 있는지 | `{ status }` | 구현 |
| GET | `/api/projects` | 프로젝트 목록. 상단 프로젝트 선택이 쓴다. **빈 배열은 정상 상태다** — 404 가 아니다 (Q18) | `Project[]` (Q9 로 `taskKeyPrefix` 가 늘었다) | 연결 |
| POST | `/api/projects` | 프로젝트 등록. 빈 상태에서 앱을 여는 유일한 길이라 **읽기 API 와 같이 세운다** (Q18) | `Project` · 201 | 연결 |
| GET | `/api/members` | 멤버 목록. 담당자 고르는 자리가 전부 쓴다. 전사 공통이라 스냅샷에 안 싣는다 (Q5 · Q6) | `Member[]` | 연결 |
| GET | `/api/projects/{projectId}/snapshot` | 그 프로젝트의 레코드 전부. `stores/data.ts` 를 그대로 채운다 | `ProjectSnapshot` | 연결 |

쓰기(3단계)는 스토어 함수 하나가 엔드포인트 하나다. 응답은 **바뀐 레코드**를 돌려준다.

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| POST | `/api/projects/{projectId}/tasks` | 작업 등록. `key` 는 서버가 발번한다 (Q19) | `Task` · 201 | 연결 |
| POST | `/api/projects/{projectId}/tasks/batch` | 챗봇 초안을 한 번에 등록 — **한 트랜잭션**, `tempId` → 실제 id 치환, `key` 는 배열 순서대로 발번. 검사 규칙 위반은 422(`detail` 에 `tasks.1.parentTempId`), 없는 멤버는 400 `TASK_OWNER_NOT_FOUND` (`docs/api/chat.md` '작업 초안') | `TaskBatchResult` · 201 | 구현 |
| PATCH | `/api/tasks/{taskId}` | 제목 · 상태 · 담당자 · 기간 · 상위 작업 · 우선순위 · **본문** 부분 수정. `body` 는 줄 전체를 통째로 갈아끼운다(`[]` 는 비우기, `null` 은 422). 줄의 `id` 는 선택 — 이 작업의 기존 줄 id 면 유지하고 아니면 서버가 새로 붙인다 | `Task` | 연결 |
| PATCH | `/api/tasks/{taskId}/lines/{lineId}` | 본문 체크박스 켜고 끄기 | `Task` | 연결 |
| PUT · DELETE | `/api/tasks/{taskId}/threads/{threadId}` | 작업 ↔ 안건 링크 (멱등) | 링크 · 204 | 연결 |
| POST | `/api/projects/{projectId}/threads` | 안건 등록 — `title` 만 필수. `ownerId` · `description` · `options` · `dueDate` 는 선택 (빈 줄 거르기는 프론트가 한다) | `Thread` · 201 | 연결 |
| PATCH | `/api/threads/{threadId}` | 안건 부분 수정 — `title` · `ownerId` · `description` · `options` · `dueDate`. 보낸 필드만 바꾼다. `ownerId` · `dueDate` 는 `null` 로 비우고, `options` 는 통째로 갈아끼운다. 빈 제목은 422. `title` · `description` · `options` 에 `null` 을 보내도 422 — 이 셋의 빈 값은 `''` · `[]` 다. **`state` 는 못 바꾼다** — 상태는 이력으로만 바뀐다 | `Thread` | 연결 |
| GET | `/api/tasks/{taskId}/comments` | 작업 댓글 목록 — **등록 순(`seq` 오름차순, 오래된 것 먼저)**. 없는 작업은 404 `TASK_NOT_FOUND` | `TaskComment[]` | 구현 |
| POST | `/api/tasks/{taskId}/comments` | 댓글 등록 — `{ body }`. `body` 는 앞뒤 공백을 떼고 비면 422. **작성자는 로그인한 사람** — `authorId` 를 보내도 무시한다 (8단계) | `TaskComment` · 201 | 구현 |
| PATCH | `/api/comments/{commentId}` | 댓글 본문 수정 — `{ body }`. `editedAt` 이 지금 시각이 된다. 빈 `body` 는 422, 없는 댓글은 404 `COMMENT_NOT_FOUND`. **작성자만** 고친다 — 그 밖은 403 `FORBIDDEN` (8단계) | `TaskComment` | 구현 |
| DELETE | `/api/comments/{commentId}` | 댓글 삭제. 없는 댓글은 404 `COMMENT_NOT_FOUND`. 작성자 · 그 프로젝트 관리자 · 시스템 관리자만 — 그 밖은 403 `FORBIDDEN` (8단계) | 204 | 구현 |
| POST | `/api/threads/{threadId}/entries` | 이력 한 줄 — 결정 · 미룸 · 세부 추가. 이력을 남기는 유일한 길이다. `decide` 면 안건이 `decided`, 그 밖의 줄은 `queued` 면 `open` 으로 | `{ entry, thread }` · 201 | 연결 |

읽기 넷은 열린 질문이 없어 `합의` 를 거쳐 바로 `구현` 으로 올렸다. 프론트가 `src/api/` 로 붙이면 `연결` 이 된다.
`uv run fastapi dev` 로 띄우고 `/api/projects` → `/api/projects/p1/snapshot` 순으로 받으면 목업과 같은 데이터가 온다
(시드가 `web/src/fixtures/*.ts` 와 같은 값이다).

AI 챗봇(`server/PLAN.md` 7단계 · `web/PLAN.md` 7단계). 모양은 `docs/api/chat.md` 다.

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/search?q=&limit=` | 안건 · 이력 · 작업을 글자로 찾는다. 챗봇이 쓰는 검색 도구를 사람도 부를 수 있게 그대로 연다. 빈 `q` 는 422, `limit` 은 1 ~ 50 (`docs/api/chat.md` '검색') | `SearchResult` | 구현 |
| POST | `/api/projects/{projectId}/chat` | 저장된 안건 · 작업을 근거로 질문에 답한다. **SSE 스트림**이다 | `text/event-stream` (`ChatEvent`) | 구현 |

인증 · 권한 · 사용자 관리(`server/PLAN.md` 8단계 · `web/PLAN.md` 8단계). 모양과 권한 규칙은 `docs/api/auth.md` 다.
**이미 있는 API 도 바뀐다** — 그 파일의 '이미 있는 API 에서 바뀌는 것'.

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | 이메일 + 비밀번호로 로그인, 세션 쿠키 | `Me` | 구현 |
| POST | `/api/auth/logout` | 이 세션 끝내기 (멱등) | 204 | 구현 |
| GET | `/api/auth/me` | 지금 로그인한 사람 · 내 프로젝트 역할 | `Me` | 구현 |
| POST | `/api/auth/password` | 내 비밀번호 바꾸기 | 204 | 구현 |
| GET · POST | `/api/admin/members` | 사용자 목록 · 등록 (시스템 관리자) | `MemberAccount[]` · `MemberAccount` 201 | 구현 |
| PATCH | `/api/admin/members/{memberId}` | 이름 · 이메일 · 시스템 역할 · 활성 (시스템 관리자) | `MemberAccount` | 구현 |
| PUT | `/api/admin/members/{memberId}/password` | 비밀번호 새로 걸기 (시스템 관리자) | 204 | 구현 |
| GET | `/api/projects/{projectId}/members` | 프로젝트에 부여된 사람 · 역할 | `ProjectMember[]` | 구현 |
| PUT · DELETE | `/api/projects/{projectId}/members/{memberId}` | 부여 · 역할 변경 · 빼기 (프로젝트 관리자 · 시스템 관리자) | `ProjectMember` · 204 | 구현 |
| PATCH | `/api/projects/{projectId}` | 프로젝트 이름 수정 (프로젝트 관리자 · 시스템 관리자) | `Project` | 구현 |

파트(`server/PLAN.md` 9단계 · `web/PLAN.md` 9단계). **보기 범위지 권한이 아니다** — 거르는 것은 화면이다. 모양은 `docs/api/part.md`.
**이미 있는 API 도 바뀐다** — 작업 · 안건 등록 · 수정의 `partId`, 스냅샷의 `parts` · `partMembers`.

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| POST | `/api/projects/{projectId}/parts` | 파트 만들기 (프로젝트 관리자 · 시스템 관리자) | `Part` · 201 | 구현 |
| PATCH | `/api/parts/{partId}` | 이름 · 보관 · 되살리기 | `Part` | 구현 |
| PUT · DELETE | `/api/parts/{partId}/members/{memberId}` | 파트에 넣기 · 빼기 (멱등) | `PartMember` · 204 | 구현 |

결정 병목 리스크(`server/PLAN.md` 10단계 · `web/PLAN.md` 11단계). 모양은 `docs/api/risk.md` 다.
**집계를 서버가 하는 첫 예외다** — 챗봇이 같은 계산을 써야 해서다 (Q35). 화면은 왼쪽 메뉴 '리스크'(`/risks`, Q34), 기준은 프로젝트마다 바꾼다(Q33).

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/risks` | 안 정해진 안건이 막는(막을) 일 · 안건과 어긋난 작업 · 사람별 몰림. 규칙 기반 점수, 한국 시간 오늘 기준 | `DecisionRiskReport` | 합의 |
| GET · PUT | `/api/projects/{projectId}/risk-settings` | 리스크 기준(문턱값 다섯) 읽기 · 바꾸기. 바꾼 적 없으면 기본값. PUT 은 다섯 값 통째로, 프로젝트 관리자 · 시스템 관리자만 | `RiskSettings` | 합의 |

## 열린 질문

한쪽이 혼자 못 정하는 것을 여기 쌓는다. **추측으로 메우지 않는다.**
닫히면 줄째로 `docs/api/decisions.md` 로 옮긴다 — 번호는 이어서 쓴다(다음은 Q36).

| # | 누가 답하나 | 질문 | 답 | 상태 |
| --- | --- | --- | --- | --- |

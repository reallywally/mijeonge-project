# 변경 이력 — 작업 · 테스트 (2026-10-27)

> 결정은 `docs/api/decisions.md` Q59. 순서는 `server/PLAN.md` 17단계 · `web/PLAN.md` 17단계.
> 작업 상태 기록(`task_log`, `docs/api/task-flow.md`)은 **그대로 둔다** — 리포트 · N일째의 근거다.
> 이 문서의 이력은 화면에 보이기 위한 것이고 셈에 쓰지 않는다.

지금은 작업 · 테스트를 누가 언제 무엇을 바꿨는지 모른다. 작업은 상태만 남고(`task_log`), 테스트는
마지막으로 바뀐 때 · 누가만 남는다(Q54). **바꾼 일 한 번(요청 하나)을 한 줄로** 남기고 상세에서 보인다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 단위 | **요청 하나 = 이력 한 줄**. 한 줄에 바뀐 칸 여럿(`changes`) | "담당자와 기한을 같이 바꿨다" 가 한눈에 보인다 |
| 값 | 바뀌기 **전 · 후 값**을 남긴다. id 는 id 로 — 이름은 화면이 지금의 멤버 · 파트 · 작업으로 찾는다 | 이름이 바뀌어도 이력이 틀리지 않는다 |
| 긴 글 | 본문(`body`) · 단계(`steps`)는 **바뀌었다는 것만**(값 없이, 단계는 개수). 테스트 내용 · 목적 · 사전조건 · 테스트 데이터는 값을 남긴다 | 본문은 줄 단위 비교가 따로 필요하다 — 나중 |
| 안 바뀐 것 | 값이 그대로인 칸은 남기지 않는다. 남길 칸이 하나도 없으면 줄을 안 만든다 | 빈 `PATCH` · 같은 값 저장이 이력을 덮지 않게 |
| 테이블 | `task_history` · `test_history` 따로. 작업 · 테스트를 지우면 같이 지운다(cascade) | 작업 · 테스트의 복합 FK 규칙을 그대로 쓴다 |
| 지난 것 | 마이그레이션이 기존 작업 · 테스트마다 **등록 한 줄**(`backfilled`)을 등록 시각에 남긴다. 그 앞은 모른다 | 어느 상세를 열어도 '등록' 줄부터 보인다 |
| 읽기 | 상세를 열 때 따로 부른다(댓글과 같다). 스냅샷 · 테스트 목록에 싣지 않는다 | 목록이 무거워지지 않는다 |

## 테이블

```
task_history
  id · project_id · task_id    FK (task_id, project_id) → task(id, project_id) cascade
  changed_by → member, null 가능 (backfill)
  changed_at · seq (Identity, unique)
  changes      jsonb not null      -- HistoryChange[] (아래 모양, camelCase 그대로)
  backfilled   bool default false
index (task_id, seq)

test_history
  id · project_id · test_id    FK (test_id, project_id) → test_case(id, project_id) cascade
  (나머지는 task_history 와 같다)
index (test_id, seq)
```

## 모양

```ts
/** 칸 하나의 바뀜 */
export interface HistoryChange {
  /** 아래 '칸' 표의 이름 */
  field: string
  /** 바뀌기 전 값. 없던 값(담당자 없음 · 기간 미정 · 새로 건 태그)은 null */
  from: string | number | boolean | null
  /** 바뀐 뒤 값. 비운 값 · 뗀 태그는 null */
  to: string | number | boolean | null
  /** 무엇에 대한 바뀜인지 한 줄 — 체크한 본문 줄의 글. 없으면 '' */
  subject: string
}

/** 이력 한 줄 = 요청 하나 */
export interface HistoryEntry {
  id: string
  /** ISO 8601 UTC, Z */
  changedAt: string
  /** 바꾼 사람. backfill 이면 null */
  changedBy: string | null
  /** 마이그레이션이 넣은 '등록' 줄이면 true — 등록한 사람을 모른다 */
  backfilled: boolean
  /** 비지 않는다 */
  changes: HistoryChange[]
}
```

- 배열은 **등록 순(`seq` 오름차순, 오래된 것 먼저)** — 댓글과 같다. 화면이 뒤집어 최근 것부터 보인다
- `null` 은 `from` · `to` · `changedBy` 에서만 나간다

### 칸 — 작업 (`task_history`)

| `field` | 언제 | `from` · `to` |
| --- | --- | --- |
| `created` | 등록 · 일괄 등록 · 회의록 `apply` | `null` · `null` (늘 그 줄의 유일한 칸) |
| `title` · `status` · `priority` | `PATCH` | 값 |
| `ownerId` · `partId` · `parentId` | `PATCH` | id 또는 `null` |
| `start` · `due` | `PATCH` | `YYYY-MM-DD` 또는 `null` |
| `relatedIds` | 더 남기지 않는다 — 2026-10-27 ~ 28 연관 작업(Q61, Q62 로 걷음) 때 남은 줄만 | 작업 id 배열(건 순서) |
| `body` | `PATCH` 의 `body` 가 줄 글 · 종류 · 체크 · 들여쓰기 · 순서 중 하나라도 바꿈 | `null` · `null` |
| `lineDone` | `PATCH .../lines/{lineId}` 가 값을 바꿈 | `false` · `true` (또는 반대), `subject` = 그 줄의 글 |
| `thread` | 안건 링크 `PUT`(새로 걸 때) · `DELETE`(있던 것을 뗄 때) | 걸기 `null` → 안건 id, 떼기 안건 id → `null` |
| `dependsOn` | 선행 작업 `PUT` · `DELETE` — **뒤 작업**에 남긴다 | 걸기 `null` → 선행 작업 id, 떼기 반대 |

등록 때 함께 건 안건(`threadIds`)은 `created` 에 들어간 것으로 본다 — 따로 줄을 안 만든다.

### 칸 — 테스트 (`test_history`)

| `field` | 언제 | `from` · `to` |
| --- | --- | --- |
| `created` | 추가 | `null` · `null` |
| `title` · `content` · `testData` | `PATCH` | 글 |
| ~~`purpose` · `precondition` · `steps`~~ | 2026-10-27 걷음(Q60) — 새로 남기지 않는다. 지난 줄에만 있다 | 글 · 글 · 단계 수 |
| `parentId` · `ownerId` · `partId` · `start` · `due` | `PATCH` | 작업과 같다 |
| `status` | `POST .../status` | 상태 값. **같은 상태로 다시 보내도** 남긴다(`from = to`) — N일째가 다시 0 이 된 까닭 |
| ~~`failedStep`~~ | 2026-10-27 걷음(Q60) — 지난 줄에만 있다 | 단계 번호 또는 `null` |
| `resultNote` | 상태 바꾸기가 값을 바꿈 | 글(`''` 이 아니라 비면 `null`) |
| `taskRef` · `threadRef` | 태그 `PUT`(새로) · `DELETE`(있던 것) | 걸기 `null` → id, 떼기 id → `null` |
| `basis` | `POST .../basis` ("그대로 맞다") | `null` · `null` |

- 상태 바꾸기의 줄은 `status` 를 맨 앞에 두고 `resultNote` 가 뒤따른다
- 작업 · 테스트 모두 한 줄 안의 칸 순서는 위 표의 순서다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/tasks/{taskId}/history` | 작업의 변경 이력 | `HistoryEntry[]` |
| GET | `/api/tests/{testId}/history` | 테스트의 변경 이력 | `HistoryEntry[]` |

- 경계는 `require_scope` 그대로 — 없거나 못 보는 프로젝트면 404 `TASK_NOT_FOUND` · `TEST_NOT_FOUND`
- 쓰기 응답은 그대로다 — 이력은 응답에 실리지 않는다. 화면은 상세의 이력 칸이 열려 있으면 쓰기 뒤에 다시 부른다
- 늘어나는 오류 코드 없음

## 시드 · 목업

- 시드는 작업 · 테스트마다 **등록 한 줄**(`backfilled = false`, 바꾼 사람 = 담당자 · 테스트는 만든 사람)을 등록 시각에 둔다
- 시연용으로 둘을 더한다 — `k20` 에 `status todo → doing`(2026-10-08T00:00:00Z, `task_log` 시연 줄과 같은 때) · `HW-T7` 에 `status testing → fail` + `resultNote`(그 테스트의 바뀐 시각)
- 목업(`web/src/fixtures`)도 같은 줄을 둔다

## 화면 (프론트가 정할 것의 테두리)

- **작업 상세 · 테스트 상세** 아래에 **'변경 이력'** — 최근 것부터, 줄마다 `사람 · 언제(상대 시각, 마우스를 올리면 KST 일시)` 와 칸마다 `칸 이름: 전 → 후`
  - 값은 화면 말로 — 상태 · 우선순위 라벨, 멤버 · 파트 이름, 작업 키 · 안건 제목, 날짜는 `M/D`. 지금 없는(지운) 것은 '(삭제됨)'
  - `created` 는 '등록', backfill 이면 '등록(이전 기록 없음)' 처럼 사람 없이
  - `body` 는 '본문 고침', `steps` 는 '단계 고침 (3 → 4개)', `lineDone` 은 '☑ 줄 글' · '☐ 줄 글', `basis` 는 '기준 그대로 맞다 확인'
  - 긴 글(테스트 내용 · 목적 · 사전조건 · 테스트 데이터 · 결과 메모)은 줄여 보이고 펼친다
- 기본은 접어 둔다([변경 이력] 을 누르면 부른다) — 상세를 열 때마다 부르지 않게. 펼친 채로 무언가 바꾸면 다시 부른다

## 구현에서 메운 것 (서버)

2026-10-27 서버 구현(`server/PLAN.md` 17단계)에서 계약이 말하지 않아 정한 것. 어긋나면 계약 쪽이 기준이다.

### 시드 — 목업(`web/src/fixtures`)이 같은 값을 둔다

| 줄 | `id` | `changedAt` | `changedBy` | `changes` |
| --- | --- | --- | --- | --- |
| 작업마다 '등록' (24줄, `k1` ~ `k22` · `x1` · `x2`) | `th-<작업 id>-1` (예: `th-k4-1`) | `2026-09-04T00:20:00Z` (작업의 `createdAt`) | 그 작업의 `ownerId` — **담당이 없는 작업(`k1` · `k5` · `k6` …)은 `null`** | `[created]` |
| `k20` 상태 | `th-k20-2` | `2026-10-08T00:00:00Z` | `u3` | `[status todo → doing]` |
| 테스트마다 '등록' (8줄, `tc1` ~ `tc8`) | `sh-<테스트 id>-1` (예: `sh-tc7-1`) | `2026-09-30T01:00:00Z` (테스트의 `createdAt`) | 그 테스트의 `createdBy` (= 담당) | `[created]` |
| `HW-T7`(`tc7`) 상태 | `sh-tc7-2` | `2026-10-05T03:00:00Z` (T7 의 `statusChangedAt`) | `u1` | `[status testing → fail, resultNote null → "관리 화면 주소를 직접 치면 열린다."]` |

- 시드는 모두 `backfilled = false`, `subject` 는 `''`. 순서는 작업 등록 줄들(작업 배열 순) 뒤에 `th-k20-2`, 테스트 등록 줄들 뒤에 `sh-tc7-2`. id 는 목업이 먼저 쓴 이름에 맞췄다
- '담당이 없는 작업은 `changedBy` null' — 계약은 '바꾼 사람 = 담당자' 라고만 했다. 담당이 없는 작업에 다른 사람을 지어내지 않았다. 화면은 backfill 이 아닌데 사람이 없는 줄을 받을 수 있다

### 남기는 규칙

- **값 비교는 저장된 값으로** — 요청에 칸이 와도 값이 같으면 남기지 않는다. 담당 · 파트 · 상위를 `null` → `null` 로 보내도 안 남는다
- **실패한 요청은 줄을 안 남긴다** — 같은 트랜잭션이라 400 · 409 · 422 면 이력도 같이 되돌아간다
- 작업 `body` — 줄 id 는 안 보고 (글 · 종류 · 체크 · 들여쓰기) 목록을 순서째 비교한다. 화면이 줄 id 를 빼고 같은 본문을 보내도 남지 않는다
- 작업 `lineDone` 의 `subject` 는 **바꾸는 그 순간의 줄 글**이다
- 테스트 `steps` — (행동 · 기대 결과) 목록을 순서째 비교한다. `from` · `to` 는 고치기 전 · 뒤의 단계 수
- 테스트 상태 줄의 `resultNote` — 앞뒤 공백을 뗀 저장 값으로 비교하고, 빈 값은 양쪽 모두 `null` 로 적는다. fail · blocked 가 아니면 메모를 버리므로 `"메모" → null` 이 남는다. `failedStep` 도 fail 이 아니면 `null` 로 바뀌어 남는다
- 테스트 상태는 `status` 칸을 **늘** 넣는다(같은 값이어도) — 그래서 상태 요청은 늘 한 줄을 만든다
- `basis` — `POST .../basis` 는 **늘** 한 줄을 남긴다. 기준 값(`basis_seq`)이 그대로여도 '확인했다' 는 일 자체를 남긴다
- 테스트를 만들 때 같이 건 태그(`refs`)는 `created` 에 든 것으로 본다 — 작업의 `threadIds` 와 같다
- 등록 줄의 `changedAt` 은 그 작업 · 테스트의 `createdAt` 과 같은 값, 상태 줄의 `changedAt` 은 `statusChangedAt` 과 같은 값이다
- `changedBy` — 바꾼 요청의 로그인한 사람. 본문 줄 체크 · 안건 링크 · 선행 떼기 · 테스트 고치기 · 태그 · 기준 확인 라우트가 이제 요청한 사람을 받는다(응답 · 권한은 그대로)

### 읽기

- 경계는 `require_scope` 의 `task_id` · `test_id` 갈래 그대로 — 없는 것 · 못 보는 프로젝트 모두 404 `TASK_NOT_FOUND` · `TEST_NOT_FOUND`, 로그인 없으면 401
- JSON 의 `from` · `to` 숫자는 `failedStep` · `steps` 뿐이고 불리언은 `lineDone` 뿐이다
- 마이그레이션 `0019_history` 의 backfill 줄 `id` 는 uuid4 hex 다(시드와 달리 정해진 이름이 없다)

## 구현에서 메운 것 (화면)

2026-10-27 화면 구현(`web/PLAN.md` 17단계)에서 계약 '화면' 절이 말하지 않아 정한 것. 어긋나면 계약 쪽이 기준이다.

### 표기

- 칸 이름 — 작업: 제목 · 상태 · 우선순위 · 담당자 · 파트 · 상위 작업 · 시작 날짜 · 기한. 테스트: 제목 · 목적 · 사전조건 · 테스트 데이터 · 상위 테스트 · 담당자 · 파트 · 시작 날짜 · 기한 · 상태 · 실패한 단계 · 결과 메모
- `null` 의 화면 말은 칸마다 — 담당자 '없음' · 파트 '공통' · 상위 '최상위 작업' / '최상위 테스트' · 시작 날짜 / 기한 '미정' · 실패한 단계 / 결과 메모 '없음'. 빈 글(`''`, 목적 · 사전조건 · 테스트 데이터 · 제목)은 '(비움)'. 실패한 단계 값은 `2단계`
- 걸기 · 떼기 칸은 `전 → 후` 대신 한 값으로 — '안건 걸기: 제목' · '안건 떼기: 제목' · '선행 작업 걸기: HW-19' · '작업 태그 걸기: HW-4' · '안건 태그 떼기: 제목'
- 같은 상태를 다시 고른 테스트 상태 줄(`from = to`)은 '상태: 테스트 중 (다시 고름)'
- `steps` 의 단계 수가 같으면 '단계 고침 (3개)', 다르면 계약대로 '단계 고침 (3 → 4개)'
- 표에 없는 `field` 가 오면 칸 이름 자리에 `field` 를 그대로, 모르는 상태 · 우선순위 값은 값 그대로 찍는다 — 서버가 칸을 늘려도 화면이 깨지지 않게
- 사람 — backfill 줄은 사람 칩 없이 '등록(이전 기록 없음)'. backfill 이 아닌데 `changedBy` 가 `null` 인 줄(시드의 담당 없는 작업 등록 줄)은 '알 수 없음', 지금 멤버에 없는 id 는 '(삭제됨)'
- 시각 — 상대 시각은 댓글과 같은 `relativeTime`(방금 · N분 전 · N시간 전 · N일 전, 일주일이 넘으면 '10월 8일 09:00'), 마우스를 올리면 KST `dayTime`('10월 8일 09:00'). 1분마다 다시 잰다
- 긴 글(목적 · 사전조건 · 테스트 데이터 · 결과 메모)은 줄바꿈을 한 칸으로 펴고 60자에서 '…' 로 자른다. [펼치기] 를 누르면 그 칸의 전 · 후를 같이 펼친다
- 이름은 지금의 것 — 작업 키는 데이터 스토어의 모든 작업, 안건 제목은 모든 안건, 테스트 키는 고른 프로젝트의 테스트 목록, 파트는 고른 프로젝트의 파트(보관 포함)에서 찾는다

### 부르기

- 접혀 있으면 부르지 않는다. 펼칠 때마다 다시 부르고, 다른 작업 · 테스트로 옮기면 다시 접는다
- 펼친 채로 다시 부르는 때 — 작업은 PATCH(칸 · 본문) · 줄 체크 · 안건 걸기 / 떼기 · 선행 걸기 / 떼기, 테스트는 PATCH · 상태 · 태그 걸기 / 떼기 · 기준 확인의 **응답이 온 뒤**(실패해도 한 번 부른다). 같은 작업에 고치기가 겹치면 마지막 응답 뒤에도 부르므로 늦게 끝난 요청의 줄까지 보인다
- 프로젝트를 바꾸거나 로그아웃하면 받아 둔 이력을 비운다
- 이력 칸의 자리 — 작업 상세는 댓글 아래 맨 끝, 테스트 상세는 기준 바뀜 아래(추가 화면에는 없다)

### 목업

- 목업 이력은 `mockDb()` 에 둔다 — `resetMockAuth` 가 시드로 되돌린다. 목업 쓰기는 모두 `api/history.ts` 의 `recordMockHistory` 한 곳으로 남긴다(바꾼 사람 = 목업 세션의 사람, 칸은 표 순서로 놓는다, 남길 칸이 없으면 줄 없음)
- 목업 작업 본문은 서버처럼 500ms 를 모아 보내지 않고 고칠 때마다 스토어에 들어간다 — 이력은 바로 앞 본문 고침과 500ms 안에 이어진 고침을 한 줄로 본다(타이머 없이)
- 목업 작업 쓰기의 값 비교는 스토어가 들고 있는 지금 값과 견준다. 작업 상태는 같은 값이면 남기지 않는다(테스트 상태와 다르다 — 계약 그대로)

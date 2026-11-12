# 테스트 — 합의 (2026-10-27)

> 기획은 `docs/test-proposal.md`, 결정은 `docs/api/decisions.md` Q53 ~ Q58.
> **2026-10-27 고침 (사용자)** — 레벨을 걷었다(화면 · API · DB, 리비전 `0018_test_drop_level`). 상세의 결과 버튼은 **[성공] · [실패]** 둘이고,
> 작성 중 · 준비됨 · 테스트 중 · 막힘은 상태 칸에서 고른다. 화면 말 '통과' 는 **'성공'** 이다(값은 그대로 `pass`).
> **2026-10-27 고침 (사용자, Q60)** — 입력을 줄였다. **목적 · 사전조건 · 단계(단계 표 · 실패한 단계)를 걷고 `content` '테스트 내용'(글 칸 하나, textarea)을 더했다**(리비전 `0020_test_content`).
> 지난 목적 · 사전조건 · 단계는 테스트 내용 글로 옮겼다. 테스트 데이터는 그대로 둔다. 실패는 메모만 받는다.
> **2026-11-04 고침 (안건 간소화, `agenda.md`)** — 이력 줄(`Entry`)을 걷어 '결정 변경' 은 **안건 변경 이력(`agenda_history`)에서 `decision` 칸이 있거나 `state` 가 `decided` 로 바뀐 줄**이다.
> `changedEntryIds` → **`changedAgendaIds: string[]`**(basis 뒤로 결정이 바뀐 닿는 안건, 처음 바뀐 순). 태그 `kind` 는 `'thread'` → `'agenda'`(`refs/agenda/{id}`, `?agenda=`), 테이블 열 `test_ref.agenda_id`.
>
> 순서는 `server/PLAN.md` 16단계 · `web/PLAN.md` 16단계. **이 문서는 1단계(AI 없이)의 계약이다** —
> AI 셋(검토 · 빠진 테스트 찾기 · 바뀐 자리 설명)과 챗봇 도구는 끝의 '나중' 에 테두리만 두고, 시작할 때 이 문서를 고친다.

기능 · 시나리오 테스트를 **작업과 따로** 관리한다. 테스트 메뉴의 핵심은 **지금의 상황 파악**이다 —
지금 무엇을 테스트하고 있나, 무엇이 오래 걸리나, 기간이 지난 것은 무엇인가.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 따로 둔다 | 테이블 `test_case` · 경로 `/api/.../tests` · 화면 '테스트' 메뉴. 스냅샷에 싣지 않는다 (Q55) | 진척 · 리스크 · 리포트 · 작업 간트에 처음부터 섞이지 않는다. 스냅샷은 작업 · 안건 화면의 것이다 |
| 작업 · 안건과는 | **참조 태그** — 테스트 하나에 작업 · 안건 0 ~ 20개 (Q56) | 테스트는 작업에 매달리지 않는다. 작업이 지워지면 그 태그만 빠진다 |
| 묶음 | **상위 테스트** `parentId` — 작업의 상위 작업과 같은 규칙(같은 프로젝트 · 고리 금지) | 간트가 계층 트리로 보인다 |
| 상태 | `draft` 작성 중 · `ready` 준비됨 · `testing` 테스트 중 · `pass` 성공 · `fail` 실패 · `blocked` 막힘. **실행 기록은 없다** — 결과는 덮어쓰고 마지막으로 바뀐 때 · 누가가 남는다 (Q54). 덮어쓴 앞 값은 변경 이력(`docs/api/history.md`, Q59)에 남는다 | 반복해서 돌리지 않는다. 지금이 보이면 된다 |
| 며칠째 · 신호 | **서버가 센다** — `statusDays` · `signals`. 문턱값은 그 프로젝트의 리스크 기준(`RiskSettings`) | 리스크 · 리포트처럼 집계를 서버가 하는 예외다. 같은 셈을 나중의 챗봇 도구 · AI 가 쓴다 |
| 쓰는 사람 | 그 프로젝트 멤버 누구나 쓰고 · 고치고 · 상태를 바꾼다. **지우기만** 만든 사람 · 프로젝트 관리자 · 시스템 관리자 (Q53). **2026-11-12 — 파트가 달린 테스트는 그 파트의 권한을 탄다**: 등록은 등록 권한, 고치기 · 상태 · 태그 · 기준 확인은 담당자 · 관리자 · 수정 권한, 지우기는 관리자 · 삭제 권한(`part.md` '파트 권한'). 조치 내역은 그대로 누구나 | 회의록 · 리포트와 같은 경계. 파트 리드가 남의 파트 테스트를 지키게 한다 |

## 테이블

```
project
  next_test_no   int not null default 1          -- 테스트 번호 발번 (next_task_no 와 같은 수법)

test_case
  id · project_id → project cascade · key · seq (Identity, unique)
  unique (project_id, key) · unique (id, project_id)
  title            text not null
  content · test_data   text not null default ''
  parent_id        FK (parent_id, project_id) → test_case(id, project_id)   null 가능
  status           'draft' | 'ready' | 'testing' | 'pass' | 'fail' | 'blocked'   default 'draft'
  status_changed_at  timestamptz not null
  status_changed_by  → member, null 가능
  result_note      text not null default '' -- status 가 'fail' · 'blocked' 일 때만 비어 있지 않다
  start · due      date, null 가능
  owner_id → member · part_id (복합 FK, 작업과 같게)   null 가능
  basis_seq        bigint, null 가능
  created_by → member · created_at
index (project_id, seq)

test_cc (2026-11-05, 리비전 0033_cc — docs/api/cc.md)
  test_id · project_id  FK (test_id, project_id) → test_case(id, project_id) cascade
  member_id → member
  sort_order            -- 고른 순서
  pk (test_id, member_id)

test_ref
  test_id · project_id
  task_id    FK (task_id, project_id)   → task(id, project_id) cascade     null 가능
  agenda_id  FK (agenda_id, project_id) → agenda(id, project_id) cascade   null 가능   (2026-11-04 thread_id 에서)
  check: task_id · agenda_id 중 정확히 하나
  unique (test_id, task_id) · unique (test_id, agenda_id)
```

- **번호** — `{taskKeyPrefix}-T{번호}`(`HW-T12`). 프로젝트별로 세고 지운 번호를 다시 쓰지 않는다 — `snapshot.md` '`task.key` 발번' 과 같은 한 문장 잠금(`next_test_no`)
- **상위를 지우면** — 하위가 있는 테스트는 지울 수 없다(409). 그래서 `parent_id` 에 cascade 를 두지 않는다
- **작업 · 안건을 지우면** — 그 태그 줄만 지운다(cascade). 테스트는 남는다

## 모양

```ts
export type TestStatus = 'draft' | 'ready' | 'testing' | 'pass' | 'fail' | 'blocked'
export type TestSignal =
  | 'longRunning' // 오래 걸림
  | 'overdue' // 기간 지남
  | 'notStarted' // 시작 안 함
  | 'longBlocked' // 오래 막힘
  | 'failedIdle' // 실패 그대로
  | 'basisChanged' // 기준 바뀜

/** 참조 태그 */
export interface TestRef {
  kind: 'task' | 'agenda'
  id: string
}

export interface TestCase {
  id: string
  projectId: string
  /** HW-T12 */
  key: string
  title: string
  parentId: string | null
  /** 테스트 내용 — 무엇을 어떻게 해 보고 무엇이 나와야 하나. 여러 줄 글 */
  content: string
  testData: string
  refs: TestRef[]
  status: TestStatus
  /** 지금 상태가 된 시각. ISO 8601 UTC, Z */
  statusChangedAt: string
  /** 지금 상태로 바꾼 사람. 멤버가 지워졌으면 null */
  statusChangedBy: string | null
  /** 오늘(KST) − statusChangedAt 의 날짜(KST). 오늘 바뀌었으면 0 */
  statusDays: number
  /** fail · blocked 의 메모. 그 밖엔 '' */
  resultNote: string
  /** YYYY-MM-DD. 테스트 기간. 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  ownerId: string | null
  /** 참조 — 알아야 하는 사람(권한과 무관). 고른 순서, 빈 값은 [] (2026-11-05, cc.md) */
  ccIds: string[]
  partId: string | null
  /** 규칙이 붙인 신호. 하위가 있는 테스트(묶음)는 늘 [] */
  signals: TestSignal[]
  /** 기준 바뀜의 근거 — basis 뒤로 결정이 바뀐 닿는 안건, 처음 바뀐 순. 없으면 [] (2026-11-04) */
  changedAgendaIds: string[]
  createdBy: string | null
  createdAt: string
}
```

- **`null` 이 나가는 자리**는 위 타입에 `| null` 로 적은 일곱뿐이다(`parentId` · `statusChangedBy` · `start` · `due` · `ownerId` · `partId` · `createdBy`). 나머지 빈 값은 `''` · `[]` (Q17 과 같은 규칙)
- `refs` 는 `kind` (task 먼저) → 그 작업 · 안건의 `seq` 순

### 요청

```ts
/** POST /api/projects/{projectId}/tests — status 는 받지 않는다(늘 draft 로 들어간다) */
export interface TestInput {
  title: string
  parentId?: string | null
  content?: string
  testData?: string
  /** 작업 · 안건 상세의 [테스트 추가] 가 미리 채운다 */
  refs?: TestRef[]
  start?: string | null
  due?: string | null
  ownerId?: string | null
  /** 안 보내면 [] (2026-11-05) */
  ccIds?: string[]
  /** 안 보내면 상위 테스트의 파트를 따른다(작업과 같다) */
  partId?: string | null
}

/** PATCH /api/tests/{testId} — 보낸 키만 바꾼다. status · refs 는 여기서 안 바꾼다 */
export interface TestPatch {
  title?: string
  parentId?: string | null
  content?: string
  testData?: string
  start?: string | null
  due?: string | null
  ownerId?: string | null
  /** 통째로 갈아끼운다. null 422 (2026-11-05) */
  ccIds?: string[]
  partId?: string | null
}

/** POST /api/tests/{testId}/status */
export interface TestStatusInput {
  status: TestStatus
  /** fail · blocked 에서만 남긴다 — 선택(2026-11-05 `test-comment.md`, 전에는 필수). 그 밖엔 보내도 버린다 */
  note?: string
}
```

**검사**
- `title` — 앞뒤 공백을 떼고 1 ~ 200자. `content` 는 10,000자(지난 단계를 옮겨 담는 칸이라 넉넉히), `testData` · `note` 는 각 4,000자. 어기면 422 `VALIDATION_ERROR`(`detail` 이 자리를 짚는다 — `content`)
- `start` · `due` — 둘 다 있으면 `start ≤ due`. 아니면 422
- 상위 — 없거나 다른 프로젝트면 400 `TEST_PARENT_NOT_FOUND`, 자기 자신 400 `TEST_PARENT_SELF`, 자손 400 `TEST_PARENT_DESCENDANT`
- 담당자 · 파트 — 작업과 같은 검사 · 같은 `code`(`TASK_OWNER_NOT_FOUND` 자리에 `TEST_OWNER_NOT_FOUND`, 파트는 작업과 같은 것)
- 참조(`ccIds`) — **새로 더한** id 가 그 프로젝트의 활성 멤버가 아니면 400 `TEST_CC_NOT_FOUND`(`detail` `{ "ccIds": "<id>" }`). 겹치면 앞의 하나만. 이미 걸린 사람은 그대로 둘 수 있다(Q68). `cc.md`
- 상태 — 하위가 있는 테스트는 400 `TEST_GROUP_STATUS`(묶음은 직접 돌리지 않는다). `fail` · `blocked` 가 아니면 `resultNote` 를 비운다. **같은 상태로 다시 보내도** `statusChangedAt` · `By` 를 새로 찍는다(덮어쓴다)
- 태그 — 같은 프로젝트의 작업 · 안건만(아니면 404 `TASK_NOT_FOUND` · `AGENDA_NOT_FOUND`), 20개까지 400 `TEST_REF_LIMIT`
- 지우기 — 하위가 있으면 409 `TEST_HAS_CHILDREN`, 만든 사람 · 관리자가 아니면 403 `FORBIDDEN`(파트가 달렸으면 관리자 · 그 파트의 삭제 권한 — 2026-11-12)
- 파트 권한 (2026-11-12) — 파트가 달린 테스트의 등록 · 고치기 · 상태 · 태그 · 기준 확인 · 지우기는 `part.md` '파트 권한' 표. 걸리면 403 `FORBIDDEN`

## 며칠째 · 신호 — 서버가 센다

날짜는 전부 **한국 시간 날짜**로 센다(`today_kst`). `staleDays` 는 그 프로젝트의 리스크 기준.
진행 리포트의 손쓸 작업 신호(`docs/api/report.md`)와 **같은 셈**이다 — `plannedDays = due − start + 1`, 문턱은 '넘어야 한다(같으면 아님)'.

| 신호 | 규칙 |
| --- | --- |
| `longRunning` | `status = testing` 이고, 기간(`start` · `due` 둘 다)이 있으면 `statusDays > plannedDays × 1.5`, 없으면 `statusDays > staleDays` |
| `overdue` | `due < 오늘` 이고 `status ≠ pass` |
| `notStarted` | `start < 오늘` 이고 `status ∈ {draft, ready}` |
| `longBlocked` | `status = blocked` 이고 `statusDays > staleDays` |
| `failedIdle` | `status = fail` 이고 `statusDays > staleDays` |
| `basisChanged` | `changedAgendaIds` 가 비어 있지 않다 |

- **하위가 있는 테스트(묶음)** 는 `signals` 가 늘 `[]` 이다 — 묶음의 상태 · 신호는 화면이 하위에서 모은다
- `signals` 는 위 표의 순서로 낸다

### 기준 바뀜 — `basis_seq`

- **닿는 안건** = 직접 태그한 안건 + 태그한 작업에 걸린 안건(`task_agenda_link`)
- **결정 변경 줄**(2026-11-04) = 닿는 안건의 `agenda_history` 줄 중 `decision` 칸이 있거나 `state` 칸의 `to` 가 `decided` 인 것
- `basis_seq` = 닿는 안건들의 결정 변경 줄 `seq` 가장 큰 값(닿는 안건이 없거나 그런 줄이 없으면 null). ~~Entry `seq`~~
- **새로 찍는 때** — 만들 때 · `PATCH`(무엇이든 바꾸면 — **`ccIds` 만 보낸 PATCH 는 빼고**, 2026-11-05 `cc.md`) · 태그를 걸거나 뗄 때 · `POST .../basis`("그대로 맞다")
- `changedAgendaIds` = 결정 변경 줄 중 `seq > coalesce(basis_seq, 0)` 인 것이 있는 닿는 안건 — 그런 줄의 첫 `seq` 순(처음 바뀐 순). ~~`changedEntryIds` = Entry 중 `kind ∈ {decide, change}` …~~
- 알고 두는 것 — **태그한 작업에 안건이 새로 걸리면** 그 안건의 옛 결정도 `seq` 가 크면 기준 바뀜으로 뜬다. 사람이 [그대로 맞다] 로 지운다. 결정이 바뀐 것을 놓치는 것보다 낫다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/tests` | 그 프로젝트의 테스트 전부(`seq` 순) — '지금' · 목록 · 간트 · 작업 · 안건 상세의 칩이 같이 쓴다 | `TestCase[]` |
| POST | `/api/projects/{projectId}/tests` | 추가 | 201 `TestCase` |
| GET | `/api/tests/{testId}` | 읽기 | `TestCase` |
| PATCH | `/api/tests/{testId}` | 고치기 | `TestCase` |
| DELETE | `/api/tests/{testId}` | 지우기(만든 사람 · 프로젝트 관리자 · 시스템 관리자. 파트가 달렸으면 관리자 · 그 파트의 삭제 권한 — 2026-11-12) | 204 |
| POST | `/api/tests/{testId}/status` | 상태 바꾸기 | `TestCase` |
| PUT | `/api/tests/{testId}/refs/{kind}/{refId}` | 태그 걸기(멱등). `kind` = `task` \| `agenda` | `TestCase` |
| DELETE | `/api/tests/{testId}/refs/{kind}/{refId}` | 태그 떼기(멱등 — 없는 태그도 204) | 204 |
| POST | `/api/tests/{testId}/basis` | "그대로 맞다" — `basis_seq` 를 지금으로 | `TestCase` |

- 경로의 `testId` 는 `require_scope` 의 경계 검사에 더한다 — 없거나 못 보는 프로젝트면 404 `TEST_NOT_FOUND`
- 작업 상세의 '이 작업을 태그한 테스트' 는 따로 부르지 않고 **목록에서 거른다**

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `TEST_NOT_FOUND` | 경로의 테스트가 없거나 못 보는 프로젝트 |
| 400 | `TEST_PARENT_NOT_FOUND` · `TEST_PARENT_SELF` · `TEST_PARENT_DESCENDANT` | 상위 테스트가 없거나 · 다른 프로젝트 · 자기 · 자손 |
| 400 | `TEST_OWNER_NOT_FOUND` | 담당자가 그 프로젝트의 활성 멤버가 아님 |
| 400 | `TEST_CC_NOT_FOUND` | 새로 더한 참조가 그 프로젝트의 활성 멤버가 아님 (2026-11-05, `cc.md`) |
| 400 | `TEST_GROUP_STATUS` | 하위가 있는 테스트의 상태를 바꾸려 함 |
| 400 | `TEST_REF_LIMIT` | 태그가 20개를 넘음 |
| 409 | `TEST_HAS_CHILDREN` | 하위가 있는 테스트를 지우려 함 |

## 시드 · 목업

p1 에 테스트 묶음 둘과 하위 몇 개를 둔다 — '지금' 의 카드 · 신호가 다 보이게. 오늘을 2026-10-15 로 고정한 검사(리스크 · 리포트와 같은 날)에서 아래가 나와야 한다.

| 키 | 묶음 | 상태 · 바뀐 날 | 기간 | 태그 | 나와야 할 신호 |
| --- | --- | --- | --- | --- | --- |
| `HW-T1` 로그인 시나리오 | (묶음) | draft | — | — | `[]` (묶음) |
| `HW-T2` 올바른 계정으로 로그인 | T1 | pass · 10-10 | 10-08 ~ 10-10 | 작업 1개 | `[]` |
| `HW-T3` 비밀번호 5회 틀림 잠금 | T1 | testing · 10-03 | 10-06 ~ 10-08 | 안건 1개 | `longRunning` · `overdue` |
| `HW-T4` 비밀번호 변경 주기 | T1 | ready · 10-01 | 10-13 ~ 10-17 | **결정이 바뀐 안건**(basis 뒤에 결정 변경 줄) | `notStarted` · `basisChanged` |
| `HW-T5` 계정 배포 시나리오 | (묶음) | draft | — | — | `[]` |
| `HW-T6` 개발자 계정 일괄 생성 | T5 | blocked · 10-02 | — | 작업 `k21` | `longBlocked` |
| `HW-T7` 권한 없는 계정 접근 차단 | T5 | fail · 10-05 | 10-14 ~ 10-20 | — | `failedIdle` |
| `HW-T8` 계정 목록 내려받기 | T5 | testing · 10-14 | — | — | `[]` (1일째) |

참조(`ccIds`, 2026-11-05) — `HW-T2` 만 `['u3']`, 나머지는 `[]` (`cc.md` '시드 · 목업').

시드가 고를 작업 · 안건 · Entry 는 서버가 정하고 아래 '구현에서 메운 것' 에 적는다. 목업(`web/src/fixtures`)도 같은 줄을 둔다.

## 화면 (프론트가 정할 것의 테두리)

- **왼쪽 메뉴 '테스트'** (`/tests`) — 보기 **[목록 \| 간트]**(기본은 간트 — 2026-10-28, 목록은 `?view=list`), [내 파트 \| 전체], 제목 · 담당자 거르기
  - **맨 위 '지금'** — 숫자 카드(테스트 중 · 오래 걸림 · 기간 지남 · 막힘 · 실패 · 기준 바뀜, 누르면 거른다) · **지금 테스트 중** 표(담당 · N일째 · 남은 / 지난 날) · **손쓸 테스트** 표(신호가 붙은 것 — 기간 지남 · 오래 막힘 · 오래 걸림 순, 같으면 N일째가 긴 것부터)
  - **목록** — 키 · 제목 · 경로(상위 테스트) · 태그 칩 · 상태 · N일째 · 신호 칩 · 기간 · 담당
  - **간트** — 작업 간트(`TaskGantt`)를 테스트에도 쓴다. 왼쪽 묶음 트리(키 · 제목 · 상태 배지), 막대는 테스트 기간, 끌어서 기간 바꾸기(= `PATCH`), 줄 [+] 로 그 묶음 아래 추가. 선행 화살표는 없다. **[담당자 ▾]**(2026-11-06, 전의 [내 테스트만]을 넓힘) — '나' · 멤버 · '담당자 없음' 을 여럿 고르면 고른 사람이 담당이거나 참조(`ccIds`)에 든 테스트와, 트리가 끊기지 않게 그 상위(흐리게)만 남는다. 고른 값은 주소 `?owner=u1,u2,none` 에 남고 목록의 담당자 거르기와 같은 값이다. 옆에 '담당 · 참조 N건'
  - **묶음의 상태** — 하위 상태 중 가장 나쁜 것: `fail` > `blocked` > `testing` > `draft` · `ready` > `pass`. 묶음의 신호는 하위 신호를 모은 것
- **테스트 상세** — 작업 상세와 따로 만든 팝업(`/tests/:id`), 추가는 `/tests/new`(작업 · 안건 상세에서 오면 `?task=` · `?agenda=` 로 태그를 미리 채운다)
  - 위: 키 · 제목 · 상태(N일째, 고르기) · 담당자 · 파트 · 상위 테스트 · 기간
  - 태그 칩 — 오른쪽 속성 패널의 기한 아래(2026-11-05). 작업 번호 · 안건 제목으로 찾아 건다. 누르면 그 작업 · 안건 상세
  - **테스트 내용**(여러 줄 textarea) · 테스트 데이터
  - ~~**상태 바꾸기** — 결과 버튼은 **[성공] · [실패]** 둘(실패는 메모). 작성 중 · 준비됨 · 테스트 중 · 막힘은 위 **상태 칸에서 고른다**(작업 상세의 상태 고르기와 같은 방식, 막힘을 고르면 메모를 받는다). 묶음이면 버튼 · 고르기 대신 하위 요약~~ — 2026-11-05 걷음(`test-comment.md`)
  - **상태 바꾸기** — 오른쪽 속성 패널의 **상태 고르기 하나**로만 바꾼다. 실패 · 막힘도 메모를 묻지 않고 `{ status }` 로 바로 보낸다. 묶음이면 고르기 대신 하위에서 모은 상태 · 테스트 데이터 아래 하위 요약(하위 줄 목록)
  - **조치 내역** — 테스트 데이터 아래(전에 상태 칸이 있던 자리), 작업 댓글과 같은 모양 · 제목 옆 '조치 N'(`commentCount`). 지난 `resultNote` 가 있으면 타래 위에 '지난 결과 메모'(읽기 전용). 계약은 `test-comment.md`
  - 기준 바뀜이면 `changedAgendaIds` 의 안건을 칩과 지금 결정내용으로 보이고 [그대로 맞다](= `POST .../basis`) (2026-11-04)
- **작업 상세** — '이 작업을 태그한 테스트' 를 읽기 전용 칩(상태 색)으로, [테스트 추가]

## 나중 (아직 계약 아님)

`docs/test-proposal.md` 의 AI 네 자리. 시작할 때 이 문서에 계약을 더한다.

- `POST /api/projects/{projectId}/tests/suggest` — AI 빠진 테스트 찾기(JSON, 저장 안 함) · `POST .../tests/batch` — 고른 초안 한 번에 추가
- `POST /api/projects/{projectId}/tests/review` — AI 테스트 검토(JSON, 판정 다섯)
- `POST /api/tests/{testId}/basis/explain` — 바뀐 자리 설명(SSE)
- 챗봇 도구 `get_tests` · `get_test`, 근거 칩 `[[test:ID]]`

## 구현에서 메운 것 (서버)

계약이 말하지 않아 서버가 정한 것이다. 화면이 다르게 바라면 열린 질문으로 올린다.

**테이블 · 저장**
- 리비전은 `0017_test_case`. `test_ref` 에는 계약의 열 말고 **대리 키 `id`** 를 하나 더 둔다(PK 가 필요하다, JSON 에는 안 나간다). `test_id` 도 `(test_id, project_id) → test_case(id, project_id)` 복합 FK(cascade)라 태그의 `project_id` 가 테스트의 프로젝트와 어긋날 수 없다
- 안전망 CHECK 둘 — `parent_id <> id`, `result_note` 는 `fail` · `blocked` 일 때만 비어 있지 않다
- 앞뒤 공백을 떼어 **저장한다** — `title` · 상태의 `note`. `content` · `testData` 는 받은 그대로 둔다
- 하위가 생긴 테스트(묶음)의 자기 `status` · `resultNote` 는 건드리지 않는다 — 화면이 하위에서 모으고 신호는 `[]` 다. `changedAgendaIds` 는 묶음에도 센다(태그가 있으면)

**만들 때 · 상태**
- 만들 때 `statusChangedAt` = `createdAt`, `statusChangedBy` = 만든 사람(draft 로 둔 사람)
- 상태를 바꿔도 `basis_seq` 는 그대로다(계약의 '새로 찍는 때' 에 없다)
- 검사 순서 — 모양(422) → 기간(422 `due`) → 상위 → 담당자 → 파트 → 태그. 지우기는 403 을 409 보다 먼저 본다. 상태는 400 `TEST_GROUP_STATUS` 를 422 보다 먼저 본다
- 422 의 `detail` 자리 — 기간은 `due`, 글은 `content` · `testData`, 태그는 `refs.0.kind`, 상태는 `note`. `PATCH` 에서 `null` 을 못 받는 칸(`title` · 글 칸)에 `null` 을 보내면 그 칸으로 422
- 상위가 다른 프로젝트면 작업처럼 따로 코드를 두지 않고 `TEST_PARENT_NOT_FOUND`(계약대로)

**기준 바뀜**
- `PATCH` 는 **키를 하나라도 보내면** 다시 찍는다(값이 같아도). 빈 `{}` 는 아무것도 안 바꾼 것이라 그대로
- 태그 `PUT` 이 이미 있는 태그면(멱등) 다시 찍지 않는다. `DELETE` 가 없는 태그면 다시 찍지 않는다
- 만들 때 같은 태그를 여러 번 보내면 하나로 친다. 20개는 겹친 것을 뺀 수로 센다. `PUT` 으로 이미 있는 태그를 다시 거는 것은 20개여도 된다
- `statusDays` 는 0 아래로 내려가지 않는다(바뀐 날이 오늘보다 뒤인 데이터)

**시드** (`server/scripts/seed.py` 의 `SEED_TESTS`) — **목업 `web/src/fixtures/tests.ts` 와 같은 줄**이다(id `tc1` ~ `tc8` · 글자 · 담당 · 파트 · 시각 · 테스트 내용). 태그 id `tc2r0` 꼴은 서버만 쓴다. p1 의 `next_test_no` 는 9
- 바뀐 시각은 표의 날 12:00 KST(`03:00Z`), 묶음 · `createdAt` 은 `2026-09-30T01:00:00Z`. 담당 = 바꾼 사람 = 만든 사람
- **2026-11-04 고침** — 결정 변경 줄은 안건 변경 이력의 이행 줄(`hh-<id>-2`, `agenda.md` '시드 · 목업')이다. 안건 이력 seq 는 등록 줄 1 ~ 10 → 이행 줄 `t1` 11 · `t2` 12 · `t5` 13 · `t6` 14. 결과(바뀜 있음 · 없음)는 아래 옛 줄과 같다
  - **T2** `basis_seq = 12`(`t1` · `t2` 의 최댓값) → `[]` · **T3** `null`(`t3` 에 결정 변경 줄 없음) → `[]` · **T4** `basis_seq = 11`(`t2` 의 줄 12 앞) → `changedAgendaIds = ["t2"]` · **T6** `null`
- ~~**T2** — 작업 `k4`(개발 환경 설정 — `t1` · `t2` 에 걸려 있다) 태그, `basis_seq = 3`(닿는 안건의 최댓값 `e3`) → `changedEntryIds = []`. 태그한 작업으로 안건에 닿지만 바뀐 것이 없는 줄~~
- ~~**T3** — 안건 `t3`(미룸 `e4` 만 있다) 태그, `basis_seq = 4` → `[]`~~
- ~~**T4** — 안건 `t2`(DB 결정) 태그, `basis_seq = 2` — **결정 `e3`(seq 3) 앞에서 확인한 것**이라 `changedEntryIds = ["e3"]`. 서버 규칙의 예외는 이 한 줄뿐이다(규칙대로면 3). 시드에 `change` Entry 가 없어 `decide` 인 `e3` 를 '바뀐 결정' 으로 쓴다(규칙은 둘 다 센다). `change` 를 더하면 확인 요청 시드(`c1` ~ `c3` → `e3`)가 어긋난다~~
- ~~**T6** — 작업 `k21`(걸린 안건 없음) 태그, `basis_seq = null`~~
- ~~목업의 Entry 순서는 `e2 · e1 · e3 …`, 서버 seq 는 `e1 · e2 · e3 …` 로 앞 둘이 다르지만 위 셋의 결과(`[]` · `[]` · `["e3"]`)는 같다~~ 2026-11-03 부터 서버 시드의 Entry 순서도 목업과 같다(`e2 · e1 · e3 · e4 · e8 · e5 · e7 · e6`). 위 셋의 결과는 그대로다

## 구현에서 메운 것 (화면)

계약이 말하지 않아 화면이 정한 것이다.

- ~~**[준비됨] 버튼**~~ — 2026-10-27 고침으로 걷었다. 준비됨은 상태 칸에서 고른다
- ~~**[성공] · [실패] 버튼 · 실패 · 막힘 메모 칸 · 지금 상태 카드**~~ — 2026-11-05 걷었다(`test-comment.md`). 상태는 속성 패널의 고르기로만 바꾸고, 까닭은 조치 내역에 적는다. 걷은 카드에 있던 '누가 언제 바꿨는지' · 신호 칩은 상세에 따로 두지 않는다(N일째는 고르기 아래에 그대로, 신호는 목록 · '지금' · 간트에)
- **조치 내역 칸** — 작업 댓글 칸을 `CommentThread`(대상 `task` \| `test`)로 넓혀 같이 쓴다. 말만 다르다(입력 칸 '조치 내역', 버튼 '조치 남기기'). 묶음에도 선다. '조치 N' 은 받은 목록이 아니라 `commentCount` 로, 남기기 · 지우기 뒤에는 화면이 그 줄의 수를 맞춘다(목록을 다시 받으면 받은 수로)
- **묶음 막대의 기간** — 하위 테스트 기간을 덮는 범위로 그린다. 묶음 자기 `start` · `due` 는 간트에서 쓰지 않는다(작업 간트의 상위 막대와 같은 성격). 막대는 시작 · 기한이 둘 다 있을 때만 선다
- **묶음 상태에서 작성 중 · 준비됨이 섞이면** '작성 중' 으로 보인다
- **'지금' 의 카드 · 표는 묶음이 아닌 테스트만 센다** — 묶음까지 세면 같은 테스트가 두 번 든다. 테스트 중 · 막힘 · 실패 카드는 상태로, 나머지는 신호로 센다. 묶음 신호는 하위 신호를 겹치지 않게 모은 목록
- **묶음의 [지우기]** 는 비활성(서버가 409). 태그를 떼면(204) 그 테스트를 한 번 더 `GET` 한다 — 기준이 새로 찍혀 신호가 바뀔 수 있다
- **만들 때 `partId` 를 늘 보낸다**(상위 테스트의 활성 파트, 없으면 공통) — '안 보내면 상위를 따른다' 에 기대지 않는다
- **간트** — 작업 간트의 dhtmlx 부분을 `GanttChart.vue` 로 떼어 `TaskGantt` · `TestGantt` 가 같이 쓴다. 기간 지남 · 오래 걸림 막대는 테두리를 세운다
- **테스트 내용 칸 (Q60)** — 다른 글 칸처럼 칸을 벗어나면 바뀐 때만 `PATCH { content }`. 처음 높이는 넉넉히(약 8줄) 두고 글만큼 늘어난다. 10,000자 넘으면 보내기 전에 칸 아래에 같은 말을 띄운다. 목록 · 간트에는 보이지 않는다
- **변경 이력의 걷은 칸** — `purpose` · `precondition` · `steps` · `failedStep` 의 칸 이름 · 표기('목적' · '사전조건' · '단계 고침 (n개)' · 'n단계')는 지난 줄을 읽으려고 그대로 둔다. 한 줄 안의 순서는 `content` · `testData` 뒤

## 0020 — 테스트 내용으로 합치기 (2026-10-27, Q60)

- `test_case.content` 를 더하고, 지난 값을 아래 모양으로 옮긴 뒤 `purpose` · `precondition` · `failed_step`(과 그 CHECK) · `test_step` 테이블을 지운다. 빈 절은 뺀다. 다 비면 `''`
  ```
  목적
  <purpose>

  사전조건
  <precondition>

  단계
  1. <action> → <expected>      (expected 가 비면 ' → …' 없이)
  2. ...
  ```
- `downgrade` 는 열 · 테이블을 되살리되 값은 되돌리지 않는다(`content` 는 버린다)
- 지난 변경 이력(`test_history`)의 `purpose` · `precondition` · `steps` · `failedStep` 줄은 그대로 둔다 — 화면은 그 칸 이름을 계속 읽는다
- (서버가 메운 것) '빈 절' · '`expected` 가 비면' 은 앞뒤 공백을 뗀 뒤 비었는지로 본다. 옮기는 글 자체는 받은 그대로(공백을 떼지 않는다). 걷은 키(`purpose` · `precondition` · `steps` · `failedStep`)가 요청에 와도 오류 없이 버린다 — 레벨을 걷을 때와 같다

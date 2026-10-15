# 결정 병목 리스크 — 초안 (2026-10-15)

> 2026-10-15 사용자 결정 — Q33 · Q34 닫힘, Q35 는 화면 결정으로 닫음. 문턱값은 **프로젝트마다 화면에서 바꾼다**(아래 '기준 설정'),
> 화면은 왼쪽 메뉴의 **'리스크'** 다.

결정이 미뤄져 일이 막히는 것을 **막히기 전에** 보여 준다. `docs/agent-proposal.md` 의 '프로젝트 리스크 예측' 을
이 제품에 맞게 바꾼 것이다 — 일정 예측이 아니라 **"어떤 안건이 안 정해져서 어떤 일이 멈췄나 · 멈출 건가"** 다.
순서는 `server/PLAN.md` 10단계 · `web/PLAN.md` 11단계다.

## 정해 둔 것 (초안)

| | 결정 | 왜 |
| --- | --- | --- |
| 데이터 | **새 테이블 없이** 지금 있는 것만 — 안건(기한 · 상태 · 담당자) · 이력(미룸 · 시각) · 작업(상태 · 기한 · 계층) · 작업 ↔ 안건 연결 | 지금 바로 맞는 답을 낼 수 있는 범위로 시작한다. 작업 상태 이력이 없어 "얼마나 오래 막혔나" 는 아직 못 본다 (아래 '못 보는 것') |
| 계산하는 자리 | **서버가 한 번 계산한다** — API 와 챗봇 도구가 같은 서비스 함수를 부른다 | 챗봇이 서버에서 써야 하므로 서버 계산은 어차피 있다. 화면이 같은 계산을 한 벌 더 들지 않는다. '집계는 프론트가 한다' (공통 규칙)의 **예외** 다 → Q35 |
| 점수 | **규칙 기반** — 신호마다 점수, 합으로 등급. LLM 이 점수를 매기지 않는다 | 같은 데이터면 늘 같은 결과여야 믿는다. 설명은 챗봇이, 판정은 규칙이 맡는다 |
| 문턱값 | **프로젝트마다 DB 에 둔다** — 기본값은 기한 임박 3일 · 반복 미룸 2번 · 오래 멈춤 7일 · `high` 6점 · `medium` 3점. 프로젝트 관리자가 '리스크' 화면에서 바꾼다 | 팀마다 회의 주기가 달라 하나로 못 박을 수 없다. 써 보며 바꾼다 (Q33 닫힘) |
| 파트 | 서버는 프로젝트 전부를 주고 `partId` 를 싣는다. **거르는 것은 화면이다** | 파트는 보기 범위지 권한이 아니다 (`docs/api/part.md`) |
| 화면 자리 | **왼쪽 메뉴 '리스크'**(`/risks`) — 작업 · 안건 다음 셋째 메뉴 | 사용자 결정 (Q34 닫힘). 안건 · 작업 · 사람을 한 화면에서 같이 봐야 연쇄가 보인다 |
| 다시 받기 | **화면에 들어올 때 · 기준을 바꾼 뒤 · [새로 고침]** 에만 받는다. 다른 쓰기 뒤에 자동으로 받지 않는다 | 리스크 화면은 따로 떨어져 있어 들어올 때 받으면 늘 새것이다 (Q35 닫힘) |
| 오늘 | **한국 시간 오늘**(`app/time.py` 의 `today_kst`). 응답의 `asOf` 로 같이 준다 | 기한은 사람이 고른 날짜(`YYYY-MM-DD`)다. 챗봇 프롬프트의 '오늘' 과 같은 기준 |

## 요청

`GET /api/projects/{projectId}/risks`

- 쿼리 없음. 프로젝트 멤버면 누구나 (스냅샷과 같은 경계, 아니면 403 `FORBIDDEN`). 없는 `projectId` 는 404 `PROJECT_NOT_FOUND`
- 그 프로젝트의 **지금 기준**(`RiskSettings`)으로 계산하고, 쓴 기준을 응답에 같이 싣는다

## 응답 — `DecisionRiskReport`

```ts
export interface DecisionRiskReport {
  /** 계산 기준일 — 한국 시간 오늘. YYYY-MM-DD */
  asOf: string
  /** 이 계산에 쓴 기준 — 화면이 '기한 임박 3일 · …' 로 찍는다 */
  settings: RiskSettings
  /** 안 정해진(queued · open) 안건 중 신호가 하나라도 있는 것. score 내림차순 */
  threads: ThreadRisk[]
  /** 안건과 어긋난 작업 — 풀 수 있는데 막혀 있거나, 결정보다 기한이 먼저 오는 것 */
  tasks: TaskRisk[]
  /** 사람별로 몰린 정도. 담당자 없음은 memberId null 한 줄로 */
  owners: OwnerLoad[]
}

export type ThreadRiskSignal =
  /** 결정 기한(dueDate)이 지났다 */
  | 'overdue'
  /** 결정 기한이 `settings.dueSoonDays`(기본 3일) 안이다 */
  | 'dueSoon'
  /** defer 줄이 `settings.deferCount`(기본 2번) 이상 */
  | 'deferredRepeatedly'
  /** 마지막 이력(없으면 등록) 뒤 `settings.staleDays`(기본 7일) 넘게 아무 줄도 없다 */
  | 'stale'
  /** 연결된 작업 중 '막힘' 이 있다 */
  | 'blocking'
  /** 연결된 작업의 기한이 이 안건의 결정 기한보다 먼저다 — 또는 안건 기한이 없는데 작업 기한이 `settings.dueSoonDays` 안이다 */
  | 'decisionAfterTaskDue'
  /** 담당자가 없다 */
  | 'noOwner'
  /** 결정 기한이 없는데 연결된 작업이 있다 (작업이 없으면 노이즈라 안 낸다) */
  | 'noDueDate'

export interface ThreadRisk {
  threadId: string
  title: string
  state: 'queued' | 'open'
  ownerId: string | null
  partId: string | null
  dueDate: string | null
  /** 기한을 넘긴 날 수. 기한이 없거나 안 넘었으면 0 */
  overdueDays: number
  deferCount: number
  /** 마지막 defer 줄의 note. 없으면 '' */
  lastDeferNote: string
  /** 마지막 이력(없으면 등록) 뒤 지난 날 수 */
  idleDays: number
  /** 연결된 작업 중 '막힘' */
  blockedTaskIds: string[]
  /** 연결된 작업 중 해야 할 일 · 진행 중 — 아직 안 막혔지만 이 결정을 기다린다 */
  waitingTaskIds: string[]
  /** 연쇄 영향 — blockedTaskIds 와 그 하위 작업 중 완료가 아닌 것의 수 (중복 없이) */
  impactTaskCount: number
  /** 연결된 작업(완료 제외) 중 가장 이른 기한. 없으면 null */
  nearestTaskDue: string | null
  signals: ThreadRiskSignal[]
  score: number
  level: 'high' | 'medium' | 'low'
}

export type TaskRiskSignal =
  /** '막힘' 인데 걸린 안건이 전부 결정됐다 — 풀 수 있다 */
  | 'decidedButBlocked'
  /** '막힘' 인데 걸린 안건이 하나도 없다 — 왜 막혔는지 기록이 없다 */
  | 'blockedWithoutThread'
  /** 완료가 아닌데, 걸린 안 정해진 안건의 결정 기한이 이 작업의 기한보다 늦다 (또는 이미 지났다) */
  | 'dueBeforeDecision'

export interface TaskRisk {
  taskId: string
  key: string
  title: string
  status: 'todo' | 'doing' | 'blocked'
  ownerId: string | null
  partId: string | null
  due: string | null
  /** 이 신호의 근거가 된 안건들. blockedWithoutThread 면 [] */
  threadIds: string[]
  signal: TaskRiskSignal
}

export interface OwnerLoad {
  /** null 은 '담당자 없음' */
  memberId: string | null
  /** 맡은 안 정해진 안건 수 */
  openThreads: number
  /** 그중 기한을 넘긴 수 */
  overdueThreads: number
  /** 맡은 작업 중 '막힘' 수 */
  blockedTasks: number
  /** 맡은 안건이 막고 있는 작업 수 (impactTaskCount 의 합, 중복 없이) — 이 사람이 정하면 풀리는 일의 양 */
  blockingImpact: number
}
```

## 점수와 등급

| 신호 | 점수 |
| --- | --- |
| `overdue` | 3 |
| `blocking` | 3 |
| `deferredRepeatedly` | 2 |
| `decisionAfterTaskDue` | 2 |
| `dueSoon` | 1 |
| `stale` | 1 |
| `noOwner` | 1 |
| `noDueDate` | 1 |

- `score` 는 신호 점수의 합에 **`min(impactTaskCount, 3)`** 을 더한다 — 막는 일이 많을수록 위로 오지만 그것만으로 덮지 않는다
- 등급: **`settings.highScore`(기본 6) 이상 `high` · `settings.mediumScore`(기본 3) 이상 `medium` · 그 아래 `low`**. 신호가 없으면 목록에 안 나온다
- 신호 점수(위 표)는 **바꾸지 않는다** — 바꿀 수 있는 것은 문턱값 다섯뿐이다
- `overdue` 와 `dueSoon` 은 같이 안 나온다
- 정렬: `score` 내림차순 → `overdueDays` 내림차순 → 등록 순(`seq`). 같은 데이터면 늘 같은 순서다
- `tasks` 는 `decidedButBlocked` → `blockedWithoutThread` → `dueBeforeDecision` 순, 같은 신호 안에서는 기한 이른 순(없으면 뒤) → 등록 순.
  한 작업에 신호가 여럿이면 이 순서로 **앞의 하나만** 낸다
- `owners` 는 `blockingImpact` 내림차순 → `overdueThreads` 내림차순. 네 숫자가 다 0 인 사람은 안 낸다

## 기준 설정 — `RiskSettings`

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/risk-settings` | 지금 기준. 프로젝트 멤버면 누구나 | `RiskSettings` |
| PUT | `/api/projects/{projectId}/risk-settings` | 기준 바꾸기 — **다섯 값을 통째로** 보낸다. 프로젝트 관리자 · 시스템 관리자만(그 밖은 403 `FORBIDDEN`) | `RiskSettings` |

```ts
export interface RiskSettings {
  /** 결정 기한이 이 날 수 안이면 '기한 임박'. 1 ~ 30, 기본 3 */
  dueSoonDays: number
  /** defer 줄이 이 횟수 이상이면 '여러 번 미룸'. 1 ~ 10, 기본 2 */
  deferCount: number
  /** 마지막 이력 뒤 이 날 수를 넘기면 '오래 멈춤'. 1 ~ 90, 기본 7 */
  staleDays: number
  /** 점수가 이 값 이상이면 high. 2 ~ 30, 기본 6. mediumScore 보다 커야 한다 */
  highScore: number
  /** 점수가 이 값 이상이면 medium. 1 ~ 29, 기본 3 */
  mediumScore: number
}
```

- 바꾼 적이 없는 프로젝트는 **기본값**을 준다 — GET 이 404 를 내지 않는다
- 범위를 벗어나거나 `highScore <= mediumScore` 면 422 `VALIDATION_ERROR` (`detail` 에 필드 이름 — 둘이 어긋나면 `highScore`)
- 키를 빼거나 정수가 아니면 422. 부분 수정(PATCH)은 없다 — 다섯 값이 한 묶음이다
- 서버는 `risk_setting`(프로젝트당 한 줄, 없으면 기본값) 에 둔다. 기본값은 `config.py` 한 곳에만 있다

## 화면 — '리스크' 메뉴 (`/risks`)

- 왼쪽 메뉴 작업 · 안건 다음. 위에서 고른 프로젝트 안에서 돈다(작업 · 안건 화면과 같다)
- 위: 기준 한 줄(`기한 임박 3일 · 미룸 2번 · 멈춤 7일 · high 6점 · medium 3점`) + **[기준 바꾸기]**(프로젝트 관리자 · 시스템 관리자에게만) + [새로 고침] + `asOf`
- 본문 셋: **안건 리스크**(`threads`, 등급 배지 · 신호 배지 · 막는 작업 수 · 기한 넘긴 날 · 담당자) · **안건과 어긋난 작업**(`tasks`) · **사람별**(`owners`)
- 줄을 누르면 기존 안건 · 작업 상세 팝업
- **[내 파트 | 전체]** 를 그대로 따른다 — `partId` 로 화면이 거른다. `owners` 는 거르지 않는다

## 챗봇 도구 — `get_decision_risks`

같은 서비스 함수를 챗봇 도구로 연다 (`docs/api/chat.md` 의 도구와 같은 자리).

- 입력: `{ member_id?: string, part_id?: string }` — 주면 그 사람 · 파트의 것만 남긴다
  (`threads` 는 안건 담당자 · 파트, `tasks` 는 작업 담당자 · 파트, `owners` 는 그대로)
- 출력: `DecisionRiskReport` JSON 그대로
- `tool` 이벤트의 `label`: `'결정 리스크 보는 중'`. 화면은 `label` 만 띄우므로 계약 변경이 없다
- 프롬프트 규칙
  - "뭐가 위험해?" · "막힌 거 뭐 있어?" · "이번 주 뭐부터 정해야 해?" 같은 질문에 먼저 부른다
  - 답은 `high` 부터. 한 줄마다 **왜(신호) · 무엇이 막히나(작업 수) · 다음 할 일** 을 말하고 `[[thread:ID]]` · `[[task:ID]]` 근거를 단다
  - `decidedButBlocked` 는 "풀어도 된다" 고 말한다 — 직접 상태를 바꾸지 않는다 (쓰기 초안은 이 단계 밖)
  - 점수 · 등급을 지어내거나 바꾸지 않는다. 숫자는 도구가 준 그대로

## 못 보는 것 (알고 둔다)

- **얼마나 오래 막혔나** — 작업 상태 변경 이력이 없다. `task_log` 를 세우면 `blockedDays` 를 더한다
- **작업끼리의 선후 연쇄** — 작업 의존성이 없다. 연쇄는 '안건 → 연결 작업 → 그 하위 작업' 까지만 본다
- **하위 안건(`parentThreadId`)** — 떼어 낸 안건이 안 정해져 부모가 못 정해지는 것은 아직 안 엮는다

## 프론트 검토 (비어 있음)

프론트가 `web/src/types/domain.ts` 와 맞춰 보고 여기에 적는다. 고칠 자리가 없으면 `합의` 로 올린다.

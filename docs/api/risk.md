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

- 쿼리 없음. 프로젝트 멤버면 누구나 — 스냅샷과 같은 경계라 부여받지 않은 프로젝트는 없는 것처럼 404 `PROJECT_NOT_FOUND`(`docs/api/auth.md`). 없는 `projectId` 도 같은 404
  (처음 초안은 '아니면 403' 이었다 — 스냅샷 경계와 어긋나 서버 구현 때 404 로 맞췄다)
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

## 구현에서 메운 것 (서버 10-1, 2026-10-15)

위 규칙이 말하지 않은 자리를 이렇게 메웠다. 웹 목업(`fixtures/risks.ts`)의 셈과 같다.

- `dueBeforeDecision` — 걸린 안 정해진 안건에 **결정 기한이 없으면** 안건 쪽 `decisionAfterTaskDue` 와 같은 잣대로 본다: 작업 기한이 `dueSoonDays` 안(이미 지난 것 포함)이면 낸다
- `decisionAfterTaskDue` 의 '작업 기한이 `dueSoonDays` 안' 도 이미 지난 기한을 포함한다
- `noDueDate` 의 '연결된 작업' 은 상태를 가리지 않는다(완료도 센다)
- `owners` 는 `blockingImpact` → `overdueThreads` 다음에 `memberId` 순, 담당자 없음(`null`)은 맨 뒤 — 같은 데이터면 늘 같은 순서
- `idleDays` · `overdueDays` 는 0 아래로 내려가지 않는다

## 시드 · 목업 (양쪽이 같은 값을 쓴다)

2026-10-15 기본 기준으로 p1 에서 세 경우가 보인다.

| 경우 | 줄 | 결과 |
| --- | --- | --- |
| 두 번 미룬 안건 | `t5`(이미 있다) | `high` 7점 — 여러 번 미룸 · 멈춤 · 막는 중(`k18`) |
| 기한 지난 안건 | `t3`(이미 있다, 기한 2026-09-30) | `medium` 4점 — 기한 지남 15일 · 멈춤 |
| 정해졌는데 막힘 | **`k22` `HW-22` '스테이징 DB 구성'** — 새 줄. 상위 `k4`, 막힘, 담당 u3, 2026-10-13 ~ 2026-10-20, 파트 `pt1`, `t2`(DB 결정, 결정됨)에 연결 | 작업 신호 `decidedButBlocked` |

`k22` 가 늘어 p1 의 마지막 작업 번호가 22 다(다음 작업은 `HW-23`). 같은 점수 · 같은 `overdueDays` 는 등록 순이라 `t8` 이 `t9` 보다 앞이다.

## 화면 — '리스크' 메뉴 (`/risks`)

- 왼쪽 메뉴 작업 · 안건 다음. 위에서 고른 프로젝트 안에서 돈다(작업 · 안건 화면과 같다)
- 위: 기준 한 줄(`기한 임박 3일 · 미룸 2번 · 멈춤 7일 · high 6점 · medium 3점`) + **[기준 바꾸기]**(프로젝트 관리자 · 시스템 관리자에게만) + [새로 고침] + `asOf`
- 본문 셋: **안건 리스크**(`threads`, 등급 배지 · 신호 배지 · 막는 작업 수 · 기한 넘긴 날 · 담당자) · **안건과 어긋난 작업**(`tasks`) · **사람별**(`owners`)
- 줄을 누르면 기존 안건 · 작업 상세 팝업
- **[내 파트 | 전체]** 를 그대로 따른다 — 작업 · 안건 목록과 **같은 '내 파트' 규칙**(공통 · 내 파트 · 내 담당 · 내 작업에 링크된 안건, `docs/api/part.md`)으로 `threads` · `tasks` 를 거른다. `partId` 만 보면 남의 파트 안건이 내 작업을 막는 줄이 빠진다. `owners` 는 거르지 않는다

## 챗봇 도구 — `get_decision_risks`

같은 서비스 함수를 챗봇 도구로 연다 (`docs/api/chat.md` 의 도구와 같은 자리).

- 입력: `{ member_id?: string, part_id?: string }` — 주면 그 사람 · 파트의 것만 남긴다
  (`threads` 는 안건 담당자 · 파트, `tasks` 는 작업 담당자 · 파트, `owners` 는 그대로)
- 출력: `DecisionRiskReport` JSON 그대로
- 오늘은 `today_kst()` — 프롬프트의 오늘과 같은 기준
- 없는 멤버 · 파트, 다른 프로젝트의 멤버 · 파트는 도구 오류 `멤버를 찾을 수 없습니다.` · `파트를 찾을 수 없습니다.` — 있는지조차 알리지 않는다.
  멤버는 그 프로젝트에 부여된 사람이거나, 빠졌어도 이 프로젝트의 안건 · 작업을 아직 맡은 사람이다
- 둘 다 주면 둘 다 맞는 것만 남긴다
- `tool` 이벤트의 `label`: `'결정 리스크 보는 중'`. 화면은 `label` 만 띄우므로 계약 변경이 없다
- **구현에서 정한 것 (서버 10-2, 2026-10-15)** — `part_id` 는 **파트 id 나 파트 이름**을 받는다. 챗봇에는 파트 목록 도구가 없어
  Claude 가 파트 id 를 알 길이 없다. 사용자는 "인프라 파트" 처럼 이름으로 말하므로, 도구를 하나 더 늘리지 않고
  `get_task` 가 작업 키를 받는 것과 같은 방식으로 이름을 받았다(보관한 파트도 찾는다 — 지난 줄이 아직 가리킨다).
  입력 키 이름은 계약대로 `part_id` 다. 멤버는 이름으로 물으면 Claude 가 `list_members` 로 id 를 찾는다
- 프롬프트 규칙
  - "뭐가 위험해?" · "막힌 거 뭐 있어?" · "이번 주 뭐부터 정해야 해?" 같은 질문에 먼저 부른다
  - 답은 `high` 부터. 한 줄마다 **왜(신호) · 무엇이 막히나(작업 수) · 다음 할 일** 을 말하고 `[[thread:ID]]` · `[[task:ID]]` 근거를 단다
  - `decidedButBlocked` 는 "풀어도 된다" 고 말한다 — 직접 상태를 바꾸지 않는다 (쓰기 초안은 이 단계 밖)
  - 점수 · 등급을 지어내거나 바꾸지 않는다. 숫자는 도구가 준 그대로
  - 신호 · 등급은 영어 키 대신 화면의 말로 — 기한 지남 · 기한 임박 · 여러 번 미룸 · 오래 멈춤 · 작업을 막는 중 · 작업 기한이 먼저 ·
    담당자 없음 · 기한 없음 / 풀어도 됨 · 막힌 이유 없음 · 결정이 기한보다 늦음

## 못 보는 것 (알고 둔다)

- **얼마나 오래 막혔나** — 작업 상태 변경 이력이 없다. `task_log` 를 세우면 `blockedDays` 를 더한다
- **작업끼리의 선후 연쇄** — 작업 의존성이 없다. 연쇄는 '안건 → 연결 작업 → 그 하위 작업' 까지만 본다
- **하위 안건(`parentThreadId`)** — 떼어 낸 안건이 안 정해져 부모가 못 정해지는 것은 아직 안 엮는다

## 프론트 검토 (2026-10-15)

`web/src/types/domain.ts` 와 맞춰 봤다 — **모양은 고칠 자리가 없다. `합의` 그대로 둔다.** 11-1 목업이 이 모양으로 돈다.

| | 결과 |
| --- | --- |
| `RiskSettings` · `DecisionRiskReport` · `ThreadRisk` · `TaskRisk` · `OwnerLoad` · `ThreadRiskSignal` · `TaskRiskSignal` | 키 · 타입 · null 허용 모두 같다. 등급 union 만 `RiskLevel` 이름을 붙여 썼다(모양은 같다) |
| 챗봇 `tool` 이벤트 | `ChatEvent` 의 `name` union 에 `'get_decision_risks'` 를 더했다(타입만). 화면은 `label` 만 띄운다 — 계약 변경 없음 |
| 422 | 화면은 `detail` 의 키를 칸 이름(`dueSoonDays` …)으로 읽어 그 칸에 붙인다. 여럿이 틀리면 **틀린 칸을 다 싣는 것**으로 읽었다(목업도 그렇게 낸다) |
| [내 파트 \| 전체] | 화면은 작업 · 안건 목록과 **같은 '내 파트' 규칙**(공통 · 내 파트 · 내 담당 · 내 작업에 링크된 안건)으로 `threads` · `tasks` 를 거른다. `partId` 만으로 거르면 남의 파트 안건이 내 작업을 막는 줄이 빠져서다. `owners` 는 안 거른다 |

서버에 물을 것 (계산 경계 — 모양은 그대로, 목업 픽스처가 아래처럼 가정했다. `API.md` 열린 질문 Q36 · Q37)

- **Q36** `dueBeforeDecision` — 걸린 안건에 **결정 기한이 없으면** 내나? `decisionAfterTaskDue` 쪽은 '안건 기한이 없는데 작업 기한이 임박' 을 적었는데 작업 쪽은 말이 없다. 목업은 낸다고 봤다(HW-3 ↔ 공통 코드 체계, HW-13 ↔ AI 심사 학습 데이터 범위)
- **Q37** `decisionAfterTaskDue` 의 '작업 기한이 `dueSoonDays` 안' 에 **이미 지난 작업 기한**도 드나? 목업은 든다고 봤다(공통 코드 체계 — HW-3 기한 9/22)

서버 답(2026-10-15, 10-1 구현) — **둘 다 목업 가정이 맞다.** 위 '구현에서 메운 것' 에 적었다. Q36 · Q37 닫힘(`docs/api/decisions.md`).

## AI 요약 — 합의 (2026-10-15)

리스크 화면의 표는 '무엇이' 위험한지는 보여 주지만 '그래서 뭐부터 하나' 는 사람이 읽어 내야 한다.
**[AI 요약]** 을 누르면 지금 화면에 보이는 리스크를 Claude 가 읽고 **먼저 정할 것 · 풀어도 되는 일 · 눈에 띄는 패턴** 을 짧게 정리한다.
순서는 `server/PLAN.md` 10-4 · `web/PLAN.md` 11-3 이다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 부르는 때 | **사람이 [AI 요약] 을 누를 때만.** 화면에 들어올 때 저절로 부르지 않는다 | 실제 API 를 부르니 돈이 든다. 표만 보러 온 사람에게 비용을 물리지 않는다 |
| 남기기 | **서버에 남기지 않는다.** 화면을 떠나거나 목록이 바뀌면 버린다 | 챗봇과 같은 판단(Q26). 리스크는 날마다 바뀌어 지난 요약은 틀린 말이 된다 |
| 범위 | **화면에 지금 보이는 줄만** — 화면이 `threadIds` · `taskIds` 를 보낸다 | '내 파트' 규칙을 서버가 한 벌 더 갖지 않는다. 보이는 것과 요약이 어긋나지 않는다 |
| 계산 | 서버가 `decision_risks` 를 **다시 계산**하고 보낸 id 로 거른다. 화면이 보낸 숫자는 믿지 않는다 | 판정은 규칙이, 설명은 Claude 가 — 점수 · 등급을 Claude 가 정하지 않는다 |
| 방식 | **도구 없이 한 번 부른다.** 서버가 근거(보고서 + 위쪽 안건의 배경 · 이력 · 연결 작업)를 미리 모아 넣는다 | 무엇을 읽을지가 정해져 있어 도구 루프가 필요 없다. 빠르고 싸다 |
| 모델 | 챗봇과 같은 `chat_model` · `chat_effort` | 설정이 두 벌이 되지 않는다 |
| 응답 | 챗봇과 **같은 SSE**(`delta` · `done` · `error`) — `tool` · `proposal` 은 안 나온다 | 화면이 챗봇의 스트림 읽기 · 근거 칩 · 오류 문구를 그대로 쓴다 |
| 제한 · 오류 | 챗봇과 같은 분당 제한과 같은 오류 코드(429 · 503 `CHAT_UNAVAILABLE` · 스트림 중 `error`) | 같은 Claude 호출이다 |

### 요청

`POST /api/projects/{projectId}/risks/summary`

```ts
export interface RiskSummaryInput {
  /** 화면에 보이는 안건 리스크 줄 — ThreadRisk.threadId */
  threadIds: string[]
  /** 화면에 보이는 어긋난 작업 줄 — TaskRisk.taskId */
  taskIds: string[]
}
```

- 각 배열 0 ~ 100개 (넘으면 422 `VALIDATION_ERROR`). 키가 없으면 422
- 보고서에 없는 id(다른 프로젝트 · 지금은 리스크가 아닌 것 · 지어낸 것)는 **조용히 버린다** — 화면이 보고서를 받은 뒤 데이터가 바뀌었을 수 있다
- 거른 뒤 둘 다 비면 **Claude 를 부르지 않고** `delta` 한 번(`지금 짚을 리스크가 없습니다.`) + `done` 으로 끝낸다
- 권한은 `GET .../risks` 와 같다(프로젝트 멤버, 아니면 404 `PROJECT_NOT_FOUND`)

### 서버가 Claude 에 넣는 것

- 거른 `DecisionRiskReport`(`settings` · `asOf` 포함) — 담당자 id 는 **이름으로 바꿔** 넣는다
- 점수 위쪽 안건 **5개까지**: 배경(`description`) · 후보 · 이력 전부(kind · text · note · 날짜) · 연결된 작업(key · 제목 · 상태 · 기한 · 담당자 이름)
- `tasks` 줄의 작업 제목 · 담당자 이름 · 근거 안건 제목

### 답의 모양 (시스템 프롬프트로 지킨다)

화면은 마크다운을 그리지 않고 줄바꿈만 살린다(챗봇과 같다). 그래서 머리글은 글자로 쓴다.

```
한 줄 총평 — 지금 가장 큰 병목이 무엇인지 한 문장

먼저 정할 것
1. [[thread:ID]] — 왜(신호를 화면 말로) · 무엇이 막히나(작업 수 · [[task:ID]]) · 다음 할 일 · 누가
2. …   (최대 3개, 점수 순)

바로 풀 수 있는 것        (decidedButBlocked · blockedWithoutThread 가 있을 때만)
- [[task:ID]] — 무엇을 하면 되는지

눈에 띄는 점             (있을 때만, 1 ~ 2줄)
- 한 사람에게 몰림 · 같은 미룸 사유 반복 · 대부분이 '오래 멈춤' 이면 기준(staleDays)이 회의 주기보다 짧을 수 있다 등
```

- **숫자 · 등급 · 날짜는 넣어 준 데이터 그대로.** 지어내지 않는다. 신호는 화면 말(이 문서 '챗봇 도구' 의 대응표)로
- '다음 할 일' 은 이력에서 근거를 찾는다 — 마지막 미룸 사유가 "보안팀 의견 대기" 면 "보안팀 의견을 받아 다음 회의에 올린다" 처럼
- 직접 무엇을 바꾸지 않는다 — 상태 · 담당자 변경은 사람에게 권하기만 한다
- 전체 800자 안팎. 위 칸 중 해당 없는 칸은 통째로 뺀다

### 화면

- 리스크 화면 맨 위, 기준 줄 아래 **'AI 요약' 카드**. 처음엔 [AI 요약] 버튼과 "보이는 안건 n · 작업 m건을 정리합니다" 한 줄
- 누르면 스트림을 받아 그린다(챗봇의 근거 칩 그대로 — 누르면 상세 팝업). 받는 중엔 [멈춤]
- 다 받으면 "asOf 기준 · 보이는 n건" 과 [다시 요약]
- **[새로 고침] · 기준 저장 · [내 파트 | 전체] 전환으로 보이는 줄이 바뀌면** 요약을 흐리게 하고 "목록이 바뀌었습니다 — [다시 요약]" 을 띄운다(자동으로 다시 부르지 않는다)
- 보이는 줄이 0건이면 버튼을 끈다

### 구현에서 정한 것 (2026-10-15, 10-4)

- **분당 제한은 챗봇과 한 제한기를 같이 쓴다** — IP 당 분당 `chat_rate_per_minute` 를 질문 · 요약이 함께 센다. 같은 Claude 비용이라 요약 연타로 챗봇 몫을 넘지 못하게
- 503 · 429 는 거르기보다 먼저 본다 — 거른 뒤 빈 경우(고정 문구)도 키가 없으면 503 이다. 화면은 0건이면 버튼을 끄니 닿을 일이 드물다
- `done.refs` 는 본문에 나온 근거 중 **넣어 준 데이터에 있던 id 만** 싣는다 — Claude 가 지어낸 id 는 칩이 되지 않는다
- 넣는 근거에서 담당자뿐 아니라 파트도 id 대신 이름(없으면 `공통`)으로 바꾼다. 막힌 · 기다리는 작업은 id 와 key · 제목을 같이 넣는다
- 스트림 중 거절은 챗봇처럼 `error` `CHAT_REFUSED`(done 없음), 길이 상한은 끊었다는 한 줄 `delta` 뒤 `done`

# 프로젝트 진행 리포트 — 합의 (2026-10-20)

> 기획은 `docs/agent-proposal.md` 7번 '리포팅 · 의사결정' — 처음엔 '주간 결정 리포트' 였고, **프로젝트 전체 진행**으로 넓혔다. 결정은 `docs/api/decisions.md` Q49 ~ Q51.
> 바탕은 `docs/api/task-flow.md`(선행 작업 · 작업 상태 기록)와 `docs/api/risk.md`(결정 병목 계산).
> 순서는 `server/PLAN.md` 14단계 · `web/PLAN.md` 15단계.

**[리포트 만들기]** 를 누르면 서버가 지난 7일의 진행을 **규칙으로 계산**하고, Claude 가 그것을 읽어 **무엇을 먼저 손써야 하는지** 근거와 함께 쓴다. 리포트는 저장되어 목록에 쌓인다.

> 예: "HW-22 스테이징 DB 구성을 하려면 HW-20 DB 설치가 먼저인데, HW-20 이 진행 중이 된 지 12일째(계획 3일)입니다. 스테이징 DB 구성과 개발자 계정 배포가 이것을 기다리고 있어 이도현 님께 진행 상황을 확인해 보세요."

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 범위 | 결정만이 아니라 **프로젝트 전체 진행** — 진척 · 결정 · 손쓸 작업 · 사람 | 사용자 결정. 결정 리포트는 그 한 칸이 된다 |
| 판정 · 설명 | **판정은 규칙이, 설명 · 우선순위는 Claude 가.** "어려운 작업인가" 는 Claude 가 본문 · 하위 작업 · 남은 체크리스트로 판단하고 근거를 쓴다 | 리스크와 같은 원칙. 같은 데이터면 같은 신호가 나와야 믿는다 |
| 만드는 때 | **사람이 [리포트 만들기] 를 누를 때.** 매주 자동은 나중 | Q51. 예약 실행 장치가 아직 없다 |
| 남기기 | **저장한다** — 계산한 숫자(`facts`)와 Claude 의 글 둘 다. 고치지 않는다 | 지난 리포트를 다시 보고 '지난주 대비' 를 낸다 (Q51) |
| 기간 | 만드는 날(KST)을 끝으로 **7일**. 같은 날 여러 번 만들 수 있다 | 회의 주기와 상관없이 늘 같은 창 |
| 문턱값 | 리스크 기준(`RiskSettings`)의 `dueSoonDays` · `staleDays` 를 그대로 쓴다. 새 기준을 두지 않는다 | 기준이 두 벌이면 리스크 화면과 리포트가 다른 말을 한다 |
| 누가 | 만들기 · 보기는 그 프로젝트 멤버 누구나. **지우기는 만든 사람 · 프로젝트 관리자 · 시스템 관리자** | 회의록 · 댓글과 같은 경계 |
| 화면 | **왼쪽 메뉴 '리포트'** (`/reports`, '리스크' 다음) | 리스크는 지금, 리포트는 한 주의 흐름이다 |

## 규칙이 세는 것 — `ProgressFacts`

```ts
export interface ProgressFacts {
  /** 기간 — 둘 다 YYYY-MM-DD, KST. periodEnd 가 만든 날 */
  periodStart: string
  periodEnd: string
  settings: RiskSettings

  progress: {
    /** 지금 상태별 작업 수 */
    todo: number; doing: number; blocked: number; done: number
    /** done / 전체, 소수 셋째 자리에서 반올림. 작업이 없으면 0 */
    doneRate: number
    /** 기간 안에 완료가 된 작업 (task_log) */
    completedTaskIds: string[]
    /** 기간 안에 진행 중이 된 작업 */
    startedTaskIds: string[]
    /** 기간 안에 등록된 작업 */
    createdTaskIds: string[]
  }

  /** 바로 앞 리포트 — 없으면 null */
  previous: { reportId: string; periodEnd: string; doneRate: number; blocked: number } | null

  decisions: {
    /** 기간 안에 decide · change 이력이 남은 안건 */
    decidedThreadIds: string[]
    /** 기간 안에 defer 이력이 남은 안건 */
    deferredThreadIds: string[]
    /** 지금 리스크 high · medium 안건 — DecisionRiskReport.threads 에서, 점수 순 10개까지 */
    riskyThreadIds: string[]
  }

  /** 손쓸 작업 — 아래 신호. 한 작업에 신호가 여럿이면 다 싣는다 */
  attention: TaskAttention[]

  /** 사람별 — 담당 작업이 하나라도 있는 사람만, 담당자 없음은 memberId null */
  people: PersonProgress[]
}

export type TaskAttentionSignal =
  /** 이 작업이 기다리는 선행 작업이 안 끝났고, 이 작업의 시작일이 dueSoonDays 안이거나 지났다 */
  | 'waitingOnPredecessor'
  /** 이 작업을 기다리는 작업이 있는데 이 작업이 늦다 — 기한 지남 · 시작일 지났는데 해야 할 일 · 오래 걸림 중 하나 */
  | 'lateBlocker'
  /** 진행 중인 날 수가 계획(start ~ due)의 1.5배를 넘음. 계획이 없으면 staleDays 를 넘음 */
  | 'longRunning'
  /** 막힘인 날 수가 staleDays 를 넘음 */
  | 'longBlocked'
  /** 기한이 지났는데 완료가 아님 */
  | 'overdue'
  /** 시작일이 지났는데 해야 할 일 · 또는 기한이 dueSoonDays 안인데 해야 할 일 */
  | 'notStarted'
  /** 막힘인데 걸린 안건이 전부 결정됨 (risk.md 의 decidedButBlocked) */
  | 'decidedButBlocked'

export interface TaskAttention {
  taskId: string
  signals: TaskAttentionSignal[]
  /** 지금 상태가 된 뒤 지난 날 수 (task_log). backfill 이면 '적어도' */
  statusDays: number
  statusSinceBackfill: boolean
  /** start ~ due 의 날 수. 둘 중 하나라도 없으면 null */
  plannedDays: number | null
  /** 이 작업이 기다리는 안 끝난 선행 작업 */
  waitingOnTaskIds: string[]
  /** 이 작업을 기다리는 안 끝난 작업 — 이 작업이 늦으면 같이 밀린다 (몇 단계 건너도, 중복 없이) */
  blockingTaskIds: string[]
  /** 무게 — Claude 가 '어려운가' 를 판단하는 재료 */
  weight: {
    /** 완료 아닌 하위 작업 수 (자손 전부) */
    openChildren: number
    /** 본문 체크리스트 중 안 끝난 줄 · 전체 줄 */
    openLines: number; totalLines: number
    /** 걸린 안건 수 */
    threadCount: number
    priority: 'low' | 'normal' | 'high'
  }
  score: number
}

export interface PersonProgress {
  memberId: string | null
  doing: number
  blocked: number
  overdue: number
  /** 기간 안에 끝낸 작업 수 */
  completed: number
  /** 이 사람 작업 중 attention 에 든 것 */
  attentionTaskIds: string[]
}
```

**점수** (`attention` 정렬용 — 등급은 없다)

| 신호 | 점수 |
| --- | --- |
| `lateBlocker` | 3 |
| `decidedButBlocked` | 3 |
| `overdue` | 2 |
| `longRunning` | 2 |
| `longBlocked` | 2 |
| `waitingOnPredecessor` | 1 |
| `notStarted` | 1 |

- `score` = 신호 점수의 합 + `min(blockingTaskIds.length, 3)`
- 정렬: `score` 내림차순 → 기한 이른 순(없으면 뒤) → 등록 순. **30개까지**
- 날 수는 KST 날짜끼리 뺀다. `plannedDays` 는 `due - start + 1`
- 완료 작업에는 신호를 내지 않는다. `notStarted` 와 `overdue` 는 같이 날 수 있다
- 계산은 서버 한 곳(`services/progress.py`). 리포트와 나중의 챗봇 도구가 같이 쓴다

## Claude 가 쓰는 것

- **도구 없이 한 번** 부른다(리스크 AI 요약과 같은 틀). 서버가 넣는 것:
  - `ProgressFacts` — id 옆에 key · 제목 · 담당자 이름 · 파트 이름을 붙여서
  - `attention` 위쪽 **8개**의 상세 — 본문(체크리스트 줄과 체크 여부) · 하위 작업(key · 제목 · 상태) · 선행 / 기다리는 작업 · 걸린 안건 제목과 마지막 이력
  - `decisions` 의 안건 — 제목 · 이번 기간의 이력(kind · text · note)
  - 바로 앞 리포트의 글(있으면) — '지난주 대비' 를 쓰라고
- 답의 모양 (화면은 마크다운을 그리지 않고 줄바꿈만 살린다 — 리스크 AI 요약과 같다)

```
한 줄 총평 — 이번 주 프로젝트가 어디에 있는지

이번 주 진척
- 완료 N건(…) · 새로 시작 N건 · 완료율 x% (지난주 y%)

결정
- 정해진 것 [[thread:ID]] … · 미뤄진 것 [[thread:ID]] — 사유 · 아직 큰 병목 [[thread:ID]]

먼저 손쓸 것          (최대 5개, score 순을 따르되 Claude 가 묶거나 바꿀 수 있다 — 바꾸면 왜인지)
1. [[task:ID]] — 무엇이 문제인지(신호를 사람 말로, 숫자 그대로) · 왜 급한지(기다리는 작업 · 무게) · 할 일 · 누구에게

사람               (몰린 사람이 있을 때만)
- 이름 — 진행 중 N · 막힘 N, …

다음 주 볼 것
- 1 ~ 3줄
```

- **숫자 · 날짜는 넣어 준 그대로.** backfill 이면 "12일 이상" 처럼 쓴다
- "어렵다 · 크다" 는 무게로 근거를 댄다 — "하위 작업 3개 중 2개 남음, 체크리스트 8줄 중 5줄 남음"
- 사람을 탓하는 말투를 쓰지 않는다 — '누가 못했나' 가 아니라 '어디에 일이 몰렸나 · 무엇이 막혔나'
- 직접 아무것도 바꾸지 않는다. 할 일은 사람에게 권한다
- 1,500자 안팎. 해당 없는 칸은 통째로 뺀다
- 근거 칩은 챗봇과 같은 `[[task:ID]]` · `[[thread:ID]]`. **넣어 준 id 만** 칩이 된다

## 테이블

```
project_report
  id · project_id → project(cascade)
  period_start · period_end   date
  facts       jsonb — ProgressFacts 그대로 (만든 때의 계산, 다시 계산하지 않는다)
  body        text — Claude 의 글
  created_by → member · created_at · seq (Identity, unique)
index (project_id, seq)
```

## 모양

```ts
/** 목록 한 줄 */
export interface ReportItem {
  id: string
  projectId: string
  periodStart: string
  periodEnd: string
  createdBy: string
  createdAt: string
  /** 목록에 찍을 숫자 — facts 에서 */
  doneRate: number
  attentionCount: number
}

export interface Report extends ReportItem {
  facts: ProgressFacts
  body: string
}

/** 만드는 스트림 */
export type ReportEvent =
  /** 계산이 끝났다 — 화면이 숫자 카드를 먼저 그린다 */
  | { type: 'facts'; facts: ProgressFacts }
  /** 글 조각 */
  | { type: 'delta'; text: string }
  /** 저장까지 끝. refs 는 본문의 근거 중 넣어 준 id 만 */
  | { type: 'done'; report: ReportItem; refs: ChatRef[] }
  | { type: 'error'; code: string; message: string }
```

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/reports` | 목록, 최근 것 먼저(`seq` 내림차순) | `ReportItem[]` |
| POST | `/api/projects/{projectId}/reports` | 만들기 — 본문 없음. 계산 → `facts` → Claude 글 스트림 → **다 받으면 저장** → `done` | `text/event-stream` (`ReportEvent`) |
| GET | `/api/reports/{reportId}` | 읽기 | `Report` |
| DELETE | `/api/reports/{reportId}` | 지우기 — 만든 사람 · 프로젝트 관리자 · 시스템 관리자 | 204 |

- **스트림이 중간에 끊기거나 `error` 면 저장하지 않는다.** 화면이 멈춰도(연결 끊김) 저장하지 않는다
- 글이 길이 상한에 닿으면 잘렸다는 한 줄을 붙여 그대로 저장한다
- 고치기는 없다 — 기록이다
- 모델 · 분당 제한 · 오류는 챗봇과 같다(`chat_model`, 분당 제한기 공유, 429 `CHAT_RATE_LIMITED`, 503 `CHAT_UNAVAILABLE`, 거절 `CHAT_REFUSED`)
- 작업이 하나도 없으면 Claude 를 부르지 않고 `facts` · `delta`("아직 작업이 없어 리포트를 쓸 것이 없습니다.") · `done` — 저장한다
- 프로젝트 경계 · 404 는 다른 API 와 같다(`REPORT_NOT_FOUND`), 지우기 권한 밖은 403 `FORBIDDEN`

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `REPORT_NOT_FOUND` | 경로의 리포트가 없음 (부여받지 않은 프로젝트의 것도 같다) |
| 403 | `FORBIDDEN` | 만든 사람 · 관리자가 아닌데 지움 |

## 시드 · 목업

- 시드 리포트는 없다 — 시연에서 [리포트 만들기] 를 누른다. 대신 `task-flow.md` 의 시드(선행 관계 셋 · `k20` 오래 걸림 · `k22` 오래 막힘)가 '먼저 손쓸 것' 을 만든다
- 목업 `POST` 는 **목업 데이터로 같은 계산**을 하고(`lib/progress.ts` — 서버 `services/progress.py` 와 같은 규칙) 고정 글(`web/src/fixtures/reports.ts`)을 조각내 흘린 뒤 목업 저장소에 넣는다
- 목업 고정 글의 근거 칩은 시드의 `k20` · `k22` · `t3` 를 가리킨다

## 화면 (프론트가 정할 것의 테두리)

- **왼쪽 메뉴 '리포트'** (`/reports`, '리스크' 다음)
- **목록** — 기간 · 만든 사람 · 완료율 · 손쓸 작업 수 · 만든 시각. 위에 **[리포트 만들기]**("지난 7일 · 10월 14일 ~ 10월 20일")
- **만드는 중** — `facts` 가 오면 숫자 카드부터, 아래로 글이 흘러나온다. [멈추기](저장 안 됨을 알림)
- **상세** `/reports/:reportId`
  - 숫자 카드 — 완료율(지난 리포트 대비 ▲▼) · 완료 · 시작 · 막힘 · 손쓸 작업
  - **Claude 의 글** — 근거 칩(누르면 작업 · 안건 상세)
  - **손쓸 작업 표** — `attention` 전부: 작업 칩 · 신호(화면 말) · 상태 며칠째 · 계획 · 기다리는 / 막는 작업 · 담당
  - 사람별 표
  - [지우기](권한 있을 때)
- 신호의 화면 말: 선행 대기 · 뒤 작업을 막는 중 · 오래 걸림 · 오래 막힘 · 기한 지남 · 시작 안 함 · 풀어도 됨
- 작업 화면의 간트와 오가기 — 손쓸 작업 칩을 누르면 작업 상세

## 나중 (아직 계약 아님)

- 매주 월요일 아침 자동 생성 · 알림
- 챗봇 도구 `get_project_progress` — 같은 계산을 "이번 주 뭐가 늦어?" 에 쓴다
- 기간 고르기(14일 · 한 달), 파트별 리포트

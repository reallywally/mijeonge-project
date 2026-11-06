# 리스크 — 작업 · 테스트까지, 대시보드 화면 (2026-11-06)

지금 리스크는 **안건만** 본다(`risk.md`). 여기에 **작업 리스크 · 테스트 리스크**를 더하고, 리스크 화면의 '지금 리스크' 탭을
**대시보드**로 바꾼다. AI 리스크 분석 · 저장한 분석(`risk-analysis.md`)도 세 종류를 함께 본다.
이 파일이 이 변경의 정답이다. 안건 리스크의 신호 · 점수는 `risk.md` 그대로다.

> 2026-11-05 에 걷은 '안건과 어긋난 작업'(`TaskRisk` · `decidedButBlocked` · `blockedWithoutAgenda` · `dueBeforeDecision`)을 되살리는 것이 아니다 —
> 이름 `TaskRisk` 를 다시 쓰지만 **작업 자체의 지연 · 흔들림**을 본다. 걷은 세 신호는 그대로 없다.

## 정해 둔 것 (사용자 요청 2026-11-06, 비운 자리는 이 문서가 정함)

| | 결정 |
| --- | --- |
| 대상 | 안건(그대로) + **작업**(지우지 않은 것 · 완료 아님) + **테스트**(묶음이 아닌 것 · 성공 아님) |
| 보는 것 | **오래 지연**(기한 넘김 · 오래 걸림 · 오래 막힘 · 시작 안 함) + **자주 흔들림**(기한을 거듭 미룸 · 내용이 자주 바뀜 · 담당자가 자주 바뀜 · 테스트 결과가 뒤집힘) |
| 판정 | 지금처럼 **규칙이 신호 · 점수 · 등급**, Claude 는 설명만. 등급 문턱(`highScore` · `mediumScore`)은 세 종류가 같이 쓴다 |
| 근거 데이터 | 새 테이블 없이 — 작업 상태 기록(`task_log`) · 작업 · 테스트 변경 이력(`task_history` · `test_history`) · 테스트의 지금 신호(`build_tests`) |
| 기준 | `RiskSettings` 에 **흔들림 기준 셋**을 더한다(아래). 프로젝트 관리자가 바꾼다 |
| 화면 | '지금 리스크' 탭을 **대시보드**로 — 숫자 카드 · 신호별 막대 · AI 리스크 분석 · 종류별 목록 |

## 작업 리스크 — `TaskRisk`

날짜는 한국 날짜(`today_kst`). `statusDays` 는 지금 상태가 된 날(`task_log` 의 마지막 줄, 없으면 등록일)부터 오늘까지.
`plannedDays = due − start + 1`(둘 다 있을 때). 문턱은 '넘어야 한다(같으면 아님)' — 테스트 신호와 같은 셈.

| 신호 | 규칙 | 점수 |
| --- | --- | --- |
| `overdue` 기한 넘김 | `due < 오늘` | 3 |
| `longBlocked` 오래 막힘 | `status = blocked` 이고 `statusDays > staleDays` | 3 |
| `longRunning` 오래 걸림 | `status = doing` 이고, 기간이 있으면 `statusDays > plannedDays × 1.5`, 없으면 `statusDays > staleDays` | 2 |
| `dueSlipped` 기한 거듭 미룸 | 이력의 `due` 줄 중 **뒤로 미룬 것**(옛 값 · 새 값이 다 있고 새 > 옛) 수 `≥ slipCount` — 기간 제한 없이 전부 | 2 |
| `notStarted` 시작 안 함 | `status = todo` 이고 (`start < 오늘` 또는 `due` 가 `dueSoonDays` 안) | 1 |
| `contentChurn` 내용 자주 바뀜 | 최근 `churnDays` 일 안의 이력 줄 중 `title` · `body` 칸이 든 줄 수 `≥ churnCount` (본문은 10분 합치기 뒤의 줄 수 — `history.md`) | 1 |
| `ownerChurn` 담당자 자주 바뀜 | 최근 `churnDays` 일 안의 `ownerId` 줄 수 `≥ 2` | 1 |

- `overdue` 와 `notStarted` 는 같이 안 나온다(`overdue` 우선). `longBlocked` 는 막힘에만, `longRunning` 은 진행 중에만
- `score` = 신호 점수 합 + **`min(overdueDays, 7) ÷ 7` 을 반올림한 0 · 1**(기한을 4일 넘게 넘기면 +1) — 오래 넘긴 것이 위로
- 신호가 없으면 목록에 안 나온다. 정렬: `score` ↓ → `overdueDays` ↓ → `statusDays` ↓ → 등록 순

```ts
export type TaskRiskSignal =
  | 'overdue' | 'longBlocked' | 'longRunning' | 'dueSlipped' | 'notStarted' | 'contentChurn' | 'ownerChurn'

export interface TaskRisk {
  taskId: string
  key: string                  // HW-12
  title: string
  status: 'todo' | 'doing' | 'blocked'
  ownerId: string | null
  partId: string | null
  start: string | null
  due: string | null
  overdueDays: number          // 안 넘겼으면 0
  statusDays: number
  plannedDays: number | null
  /** 뒤로 미룬 횟수와 흐름(첫 옛 값 → … → 지금) — 미룬 적 없으면 0 · [] */
  slipCount: number
  dueFlow: string[]
  /** 최근 churnDays 안의 내용(title · body) 변경 줄 수 · 담당자 변경 줄 수 */
  contentChanges: number
  ownerChanges: number
  /** 걸린 안건 중 안 정해진 것 — 설명용(점수에는 안 든다) */
  openAgendaIds: string[]
  signals: TaskRiskSignal[]    // 위 표 순서
  score: number
  level: 'high' | 'medium' | 'low'
}
```

## 테스트 리스크 — `TestRisk`

지금 테스트 목록이 내는 신호(`test.md` '며칠째 · 신호', `build_tests`)를 **그대로 쓰고** 흔들림 둘을 더한다. 묶음(하위가 있는 것)은 넣지 않는다 — 하위가 들어간다.

| 신호 | 규칙 | 점수 |
| --- | --- | --- |
| `overdue` 기간 지남 | `test.md` 그대로 | 3 |
| `failedIdle` 실패 그대로 | 〃 | 3 |
| `longBlocked` 오래 막힘 | 〃 | 3 |
| `basisChanged` 기준 바뀜 | 〃 | 2 |
| `longRunning` 오래 걸림 | 〃 | 2 |
| `flaky` 결과 뒤집힘 | 최근 `churnDays` 일 안의 `status` 이력 중 **`pass` → `fail` 또는 `fail` → `pass`** 로 바뀐 줄 수 `≥ 2` | 2 |
| `dueSlipped` 기한 거듭 미룸 | 작업과 같은 셈(`test_history` 의 `due`) | 2 |
| `notStarted` 시작 안 함 | 〃 | 1 |

- 대상: 묶음이 아니고 `status ≠ pass`. **단 `flaky` 는 `pass` 여도 낸다**(지금 성공이어도 뒤집혀 왔으면 위험)
- `score` · 정렬은 작업과 같다(`overdueDays` 는 `due` 기준)

```ts
export type TestRiskSignal =
  | 'overdue' | 'failedIdle' | 'longBlocked' | 'basisChanged' | 'longRunning' | 'flaky' | 'dueSlipped' | 'notStarted'

export interface TestRisk {
  testId: string
  key: string                  // HW-T3
  title: string
  status: TestStatus
  ownerId: string | null
  partId: string | null
  due: string | null
  overdueDays: number
  statusDays: number
  slipCount: number
  /** 최근 churnDays 안의 pass ↔ fail 뒤집힘 수 */
  flips: number
  /** 이 테스트가 태그한 작업 · 안건 — 설명용 */
  refs: TestRef[]
  signals: TestRiskSignal[]
  score: number
  level: 'high' | 'medium' | 'low'
}
```

## 응답 — `DecisionRiskReport` 가 는다

```ts
export interface DecisionRiskReport {
  asOf: string
  settings: RiskSettings
  agendas: AgendaRisk[]        // 그대로
  tasks: TaskRisk[]            // 새로 (2026-11-06)
  tests: TestRisk[]            // 새로 (2026-11-06)
  owners: OwnerLoad[]          // 아래처럼 두 칸이 는다
}

export interface OwnerLoad {
  // … 그대로 (memberId · openAgendas · overdueAgendas · blockedTasks · blockingImpact)
  /** 맡은 작업 · 테스트 중 리스크 high · medium 수 (2026-11-06) */
  riskyTasks: number
  riskyTests: number
}
```

- `owners` 는 여섯 숫자가 다 0 인 사람은 안 낸다. 정렬은 그대로(`blockingImpact` ↓ → `overdueAgendas` ↓) 뒤에 `riskyTasks + riskyTests` ↓
- 챗봇 도구 `get_decision_risks` 결과에도 `tasks` · `tests` 가 실린다(담당자 · 파트는 이름으로, 신호는 화면 말로 — 아래 대응표)

## 기준 — `RiskSettings` 가 넷 → 일곱

| 값 | 뜻 | 범위 · 기본 |
| --- | --- | --- |
| `churnDays` | 흔들림을 세는 최근 날 수 | 1 ~ 90, 기본 **14** |
| `churnCount` | 이 기간 안 내용 변경이 이 수 이상이면 '내용 자주 바뀜' | 2 ~ 50, 기본 **5** |
| `slipCount` | 기한을 이 수 이상 뒤로 미루면 '기한 거듭 미룸' | 1 ~ 10, 기본 **2** |

- `risk_setting` 에 세 칸을 더한다(이행 **`0038_risk_churn`**, 기본값을 server_default 로 — 지금 줄은 기본값이 된다)
- PUT 은 **일곱 값을 통째로**. 새 셋이 빠지면 422(넷과 같은 규칙). 화면이 같이 바뀐다

## 신호의 화면 말 (화면 · 챗봇 · Claude 같은 말)

| 작업 | | 테스트 | |
| --- | --- | --- | --- |
| `overdue` | 기한 넘김 | `overdue` | 기간 지남 |
| `longBlocked` | 오래 막힘 | `failedIdle` | 실패 그대로 |
| `longRunning` | 오래 걸림 | `longBlocked` | 오래 막힘 |
| `dueSlipped` | 기한 거듭 미룸 | `basisChanged` | 기준 바뀜 |
| `notStarted` | 시작 안 함 | `longRunning` | 오래 걸림 |
| `contentChurn` | 내용 자주 바뀜 | `flaky` | 결과 뒤집힘 |
| `ownerChurn` | 담당자 자주 바뀜 | `dueSlipped` · `notStarted` | 기한 거듭 미룸 · 시작 안 함 |

## AI 리스크 분석 — 세 종류를 함께

- 요청 `RiskSummaryInput` 에 **`taskIds` · `testIds`**(각 0 ~ 100, 없으면 `[]` 로 본다 — 옛 화면 호환)를 더한다. 화면은 대시보드에 **보이는** 줄을 보낸다. 보고서에 없는 id 는 지금처럼 버린다. 셋 다 비면 Claude 를 부르지 않는다
- 근거: 안건은 지금 그대로(위쪽 8개 상세). **작업 · 테스트는 점수 위쪽 각 6개**에 상세를 붙인다
  - 작업: 본문 체크리스트 n/m · 최근 댓글 3개(200자) · `dueFlow` · 최근 `churnDays` 안 이력 요약(무엇이 몇 번 바뀌었나 — 칸 이름 우리말) · 걸린 안 정해진 안건 제목
  - 테스트: 최근 조치 내역 2개(200자) · 상태 흐름(최근 `churnDays` 안) · 태그한 작업 · 안건 제목
  - 나머지는 보고서 줄만(이름 · 신호 · 숫자)
- 프롬프트의 답 모양:
  ```
  한 줄 총평
  먼저 손쓸 것   (최대 4개, 종류 섞어 점수 · 영향 순 — [[agenda:ID]] · [[task:ID]] · [[test:ID]])
  1. … — 왜(신호 · 숫자 그대로) · 다음 할 일 · 누가
  흔들리는 일    (있을 때만 1 ~ 2줄 — 기한 거듭 미룸 · 내용 자주 바뀜 · 결과 뒤집힘의 공통 원인 추정은 '~로 보임' 으로)
  지난 분석 대비 (있을 때만 한 줄)
  ```
  전체 900자 안팎. `done.refs` 는 넣어 준 데이터에 있던 id 만(작업 · 테스트 줄 전부 포함)
- **저장한 분석(`risk-analysis.md`)의 `facts`** 에 `tasks` · `tests` 스냅샷이 는다 — `{ taskId | testId, key, title, level, score, signals, ownerName }`.
  `compare` 의 `added` · `removed` · `kept` 는 **`{ kind: 'agenda' | 'task' | 'test', id }`** 를 단다(`kept` 는 `{ kind, id, levelFrom, levelTo }`).
  이미 저장한 분석의 옛 모양(문자열 = 안건 id, `agendaId`)은 **화면이 둘 다 읽는다** — 서버는 옛 줄을 고치지 않는다
- `RiskAnalysisListItem` 에 `taskCount` · `testCount` 가 는다(`agendaCount` 그대로, `highCount` 는 세 종류 합). 옛 줄은 0

## 화면 — '지금 리스크' 탭을 대시보드로

위에서부터. 데이터는 `GET .../risks` 하나, [내 파트 | 전체] 는 세 종류에 같이 걸린다.

1. **숫자 카드 줄** (넓으면 4칸, 좁으면 2칸)
   - **안건** · **작업** · **테스트** 리스크: 큰 숫자 = 높음 + 중간 수, 아래 '높음 n · 중간 m · 낮음 k'. 누르면 아래 목록이 그 종류로 걸러진다
   - **지연**: 기한 넘김(세 종류 합) 큰 숫자, 아래 '오래 막힘 n · 오래 걸림 m'. 누르면 지연 신호로 거른다
2. **가운데 두 칸** (넓으면 좌우, 좁으면 위아래)
   - 왼쪽 **신호별** — 가로 막대(종류별로 색을 나눈 쌓은 막대), 많은 것부터. 신호를 누르면 그 신호로 거른다. '흔들림' 신호(기한 거듭 미룸 · 내용 자주 바뀜 · 담당자 자주 바뀜 · 결과 뒤집힘)는 묶음 머리를 따로
   - 오른쪽 **AI 리스크 분석** 카드 — 지금 카드 그대로([AI 리스크 분석] · [다시 분석] · [저장]). '보이는 안건 n · 작업 m · 테스트 k건을 분석합니다'
3. **리스크 목록** — 위 필터 줄: 종류 `[전체 | 안건 | 작업 | 테스트]` · 등급 `[높음 | 중간 | 낮음]`(여러 개) · 걸린 신호 칩(누르면 풀림). 표 한 장에 섞어 점수 순:
   종류 배지 · 키 · 제목 · 등급 · 신호 칩 · 핵심 숫자(기한 넘김 n일 / n일째 / 미룸 n번 등 그 줄의 가장 큰 신호 하나) · 담당자(동그라미 + 이름) · 기한.
   안건 줄은 지금의 '연관 작업' 수를 핵심 숫자 옆에. 줄을 누르면 그 상세 팝업(안건 · 작업 · 테스트). 30줄 넘으면 [더 보기]
- 기준 바꾸기 창에 **흔들림** 묶음(세 값)이 는다
- 대시보드에 그리는 막대는 차트 라이브러리 없이 HTML/CSS(또는 SVG) — 새 의존성을 넣지 않는다. 색은 등급 · 종류 토큰으로, 어두운 모드에서도 읽혀야 한다
- 저장한 분석 상세의 '그때의 리스크' 표도 세 종류를 섞어 보인다(종류 배지). '지난 분석 대비' 도 종류를 달아 보인다

## 시드 · 목업

- **개발 DB 에 시드를 돌리지 않는다.** 시드 코드는 고쳐도 된다(검사용)
- 목업(`fixtures/risks.ts`)에 작업 리스크 · 테스트 리스크 몇 줄을 더해 모든 신호가 한 번씩 보이게. 오늘 2026-10-15 고정 검사와 서버 시드의 셈이 같아야 한다(지금 관례)

## 걷거나 바뀌는 것

- `risk.md` 머리에 '2026-11-06 작업 · 테스트 리스크 · 대시보드 — `risk-dashboard.md`' 를 적는다. 'AI 요약' 의 `taskIds` 걷음 줄은 '되살림' 으로 고친다
- 챗봇 `get_decision_risks` 설명 · 대응표에 작업 · 테스트 신호

## 구현에서 메운 것 (화면, 2026-11-06)

계약이 말하지 않은 것을 화면 · 목업에서 이렇게 정했다. 서버와 갈리면 서버 쪽을 따라 고친다.

| | 메운 것 |
| --- | --- |
| 보이는 줄 | `[내 파트 \| 전체]` + 목록 거르기(종류 · 등급 · 신호)를 지난 줄. 30줄 [더 보기] 로 접힌 줄도 '보인다' 로 친다(접힘은 화면 길이일 뿐). AI 리스크 분석은 이 줄의 id 를 종류별로 보내고, 한 종류라도 100개를 넘으면 버튼을 끈다('내 파트나 거르기로 좁혀 주세요.') |
| 내 파트 | 안건은 안건 화면 규칙 그대로. 작업 · 테스트 줄은 **파트 · 담당자만**으로 가린다(공통 · 내 파트 · 내가 담당) — 목록처럼 조상으로 끌려 서는 줄은 없다 |
| 거르기 | 하나의 상태(`stores/risk` `filter`)를 카드 · 막대 · 목록 위 필터 줄이 같이 쓴다. 종류 카드 · 막대 · 지연 카드는 다시 누르면 풀린다. 지연 카드 = 신호 `overdue` · `longBlocked` · `longRunning`(하나라도). 등급은 여럿(하나라도), 신호도 여럿(하나라도). 프로젝트를 바꾸면 푼다. 거르기를 바꾸면 분석이 흐려진다(저절로 다시 부르지 않음) |
| 카드 숫자 | 종류 카드의 큰 숫자 = 높음 + 중간, 아래 세 등급 수와 등급 비율 띠. 지연 카드의 큰 숫자 = `overdue` 신호가 걸린 줄 수(세 종류 합), 아래 오래 막힘 · 오래 걸림(작업 + 테스트). 카드 · 막대는 **내 파트로만** 센다(목록 거르기와 무관 — 눌러 고르는 자리라서) |
| 막대 | 신호 **이름**이 같으면 종류를 넘어 한 막대(`overdue` 는 '기한 넘김', 칩은 종류별 말 그대로 — 기한 지남 · 기한 넘김 · 기간 지남). 많은 것부터, 같으면 이름 순. 흔들림 넷(`dueSlipped` · `contentChurn` · `ownerChurn` · `flaky`)은 '흔들림' 머리 아래 따로. 막대 길이는 두 묶음 통틀어 가장 긴 것 기준, 가리키면 '안건 n · 작업 m · 테스트 k' |
| 섞는 순서 | `score` ↓ → `overdueDays` ↓ → 작업 · 안건 · 테스트 → 서버가 낸 순서. 같은 종류 안에서는 서버 정렬이 그대로 남는다 |
| 핵심 숫자 | 그 줄의 가장 큰 신호 하나(안건: 기한 넘김 n일 · 막힌 작업 n건 · 작업 기한 n일 지남 · n일째 멈춤 · D-n / 작업: 기한 넘김 n일 · n일째 막힘 · n일째 · 계획 n일 · 미룸 n번 · 시작 n일 늦음 · 내용 n번 바뀜 · 담당 n번 바뀜 / 테스트: 기간 지남 n일 · n일째 실패 · n일째 막힘 · 기준 바뀜 · n일째 테스트 중 · 뒤집힘 n번 · 미룸 n번 · n일째 시작 전). 안건 줄은 아래에 '연관 작업 n'(지금처럼 스냅샷의 `taskAgendas` 로 센다) |
| 목록 칸 | 종류 배지 · 키(안건은 키가 없어 id 칸) · 제목(+ 파트 칩 · 신호 칩) · 등급(가리키면 점수) · 핵심 숫자 · 담당자(`MemberAvatar` + 이름, 없으면 '미정') · 기한(`10/8`, 넘겼으면 붉게). 좁으면 키(< sm) · 핵심 숫자(< md) · 담당자 · 기한(< lg)을 숨기고 제목 아래 '핵심 숫자 · 담당자' 한 줄로 |
| 상세 팝업 | 줄 · 근거 칩 — 안건 · 작업 · 테스트 상세(`TestDetailDialog`). 테스트 목록은 화면에 들어올 때 `testStore.ensure()` 로 받는다 |
| 색 | 종류 토큰 `--kind-agenda`(보라) · `--kind-task`(파랑) · `--kind-test`(청록) 을 `index.css` 에 더했다(어두운 모드는 밝게). 등급은 `StatusPill` 톤 그대로 |
| 기준 창 | 묶음 지연(기한 임박 · 오래 멈춤) · 흔들림(세는 기간 · 내용 변경 · 기한 미룸) · 등급(high · medium). 범위는 계약대로, 일곱 값을 통째로 PUT(다른 키는 싣지 않는다). 'N/N 기준' 을 가리키면 흔들림 셋까지 한 줄 |
| 옛 모양 읽기 | `api/` 가 받는 자리에서 맞춘다 — 보고서: `tasks` · `tests` 없으면 [], `riskyTasks` · `riskyTests` 없으면 0, 기준 빈 칸은 기본값. 저장한 분석: `compare` 의 문자열 = 안건 id · `{ agendaId }` → `{ kind: 'agenda', id }`, 모르는 `kind` 는 안건으로, `facts.tasks` · `tests` 없으면 [], `taskCount` · `testCount` 없으면 0 |
| 저장한 분석 | '그때의 리스크' 는 세 종류를 섞어 점수 순(같으면 작업 · 안건 · 테스트), 종류 배지 · 키 · 종류별 신호 말. 지금도 있는 줄만 눌러 상세. '지난 분석 대비' 배지에 종류 이름을 앞에 단다, 이름은 이번 스냅샷 → 지금 것 순, 없으면 '찾을 수 없는 안건 · 작업 · 테스트'. 게시판 '높음 n / 전체 m' 의 m 은 세 종류 합(가리키면 종류별) |
| 목업 보고서 | 아래 '시드 p1'(서버) 표를 그대로 굳혔다 — p1 작업 19 · 테스트 5 · 사람별, p2 작업 2. 흔들림 근거도 시드와 같은 이력 줄(`k21` 기한 미룸 · `k3` 담당자 · `k22` 제목 · 본문 · `tc3` 기한 미룸 · `tc2` 뒤집힘, id `th-<작업>-c<n>` · `sh-<테스트>-c<n>`, UTC 03:00)을 `fixtures/history.ts` 에 둔다. 시드처럼 작업의 '시작 안 함' 줄은 없다(해야 할 일 작업이 모두 기한을 넘겨 `overdue` 가 먼저). 셈 규칙(`churnDays` 는 '오늘 − 날짜 ≤ churnDays' · 줄 수 · 4일 이상 넘김 +1 · 테스트 '시작 안 함' 은 목록 규칙만 · 성공 테스트는 `flaky` 만이고 `overdueDays` 0 · 사람별 셋째 키)도 서버 표대로다 |
| 목업 요약 | 계약 답 모양 — '한 줄 총평'(안건 n · 작업 m · 테스트 k건 중 가장 급한 것) · '먼저 손쓸 것' 섞어 4개(신호 · 핵심 숫자 · 다음 할 일 · 누가) · 흔들림 신호가 있으면 '흔들리는 일'. 저장한 분석 `ra2` 는 세 종류(시드 값) · `{ kind, id }` 비교로 바꾸고, `ra1` 은 옛 모양(작업 · 테스트 없음)으로 둔다 |

## 구현에서 메운 것 (서버, 2026-11-06)

계약이 말하지 않은 자리를 이렇게 메웠다. 모양 · 경로 · 신호 · 점수는 위 그대로다. 리비전 `0038_risk_churn`.

| | 메운 것 |
| --- | --- |
| '최근 `churnDays` 일 안' | 이력 줄의 **한국 날짜**가 `오늘 − churnDays` 일(그날 포함)부터 오늘까지 — `(오늘 − 그날) ≤ churnDays`. `dueSoonDays` 의 '안' 과 같은 셈이다. 기본 14 면 2026-10-15 기준 10-01 줄부터 센다 |
| 줄 수 | 이력 **줄**(요청 하나)을 센다. 한 줄에 `title` · `body` 가 같이 있어도 1, `ownerId` 와 다른 칸이 같이 있어도 `ownerChanges` 1. `flips` 는 `status` 칸의 (`pass` → `fail`) · (`fail` → `pass`) 수(한 줄에 `status` 는 하나뿐) |
| `dueSlipped` | `due` 칸의 `from` · `to` 가 **둘 다 날짜**이고 `to > from` 인 것만 미룸이다 — 비웠다 채운 것(`null` ↔ 날짜) · 당긴 것은 안 센다. 기간 제한 없이 전부 |
| `dueFlow` | `due` 칸 줄을 `seq` 순으로 — 첫 줄의 `from`(날짜일 때) + 줄마다 `to`(날짜일 때). `null` 은 건너뛴다. 당긴 줄도 흐름에는 든다. 미룬 적이 없으면(`slipCount` 0) `[]` |
| 작업 `statusDays` | `task_log` 의 마지막 줄(`status_since_map`, 테스트 며칠째 · AI 분석과 같은 것)의 한국 날짜부터. 줄이 없으면 등록 시각 |
| 작업 `notStarted` 의 '`due` 가 `dueSoonDays` 안' | `(due − 오늘) ≤ dueSoonDays` — 안건 `dueSoon` 과 같은 셈. 기한이 지났으면 `overdue` 가 먼저라 안 나온다 |
| 점수 가산 | `min(overdueDays, 7) ÷ 7` 반올림을 정수로 — `overdueDays ≥ 4` 면 +1 (3일은 0.43 이라 0) |
| 테스트 `notStarted` | 표의 '〃' 를 **테스트 목록 그대로**(`test.md` — `start < 오늘` 이고 작성 중 · 준비됨)로 읽었다. 작업처럼 '`due` 가 임박' 은 더하지 않았다 — '지금 테스트 목록이 내는 신호를 그대로 쓰고 흔들림 둘을 더한다' 에 맞춰 |
| 성공한 테스트 | 신호 중 `flaky` **하나만** 본다(목록이 내는 `basisChanged` 도 버린다). `overdueDays` 는 0 으로 낸다(점수 가산 없음) |
| 묶음 | 하위가 하나라도 있는 테스트(지운 것 없음 — 테스트는 하드 삭제)는 뺀다. 하위의 상태 · 신호는 하위 자기 것 |
| `TestRisk.refs` | 테스트 목록 응답의 `refs` 그대로(작업 먼저, 그 안은 `seq` 순, 지운 작업 · 안건 태그는 빠짐) |
| `openAgendaIds` | 걸린 안건 중 대기 · 논의중인 것, 안건 등록 순(`seq`) |
| 사람별 정렬 | `blockingImpact` ↓ → `overdueAgendas` ↓ → `riskyTasks + riskyTests` ↓ → 멤버 id 순, 담당자 없음은 같은 숫자일 때만 맨 뒤. 그래서 시드 p1 은 **담당자 없음(작업 9)** 이 u2 · u3 보다 앞에 온다 |
| 챗봇 `get_decision_risks` | 보고서 JSON 그대로에 **작업 · 테스트 줄마다** `owner`(이름, 없으면 `담당자 없음`) · `part`(이름, 없으면 `공통`) · `signalLabels`(위 '신호의 화면 말') 를 더한다. id 칸(`ownerId` · `partId` · `taskId`)은 근거 칩 때문에 남긴다. `member_id` · `part_id` 는 세 종류에 같이 걸린다(`owners` 는 그대로) |
| 기준 저장 | `PUT` 은 일곱 키 다 있어야 한다 — 하나라도 빠지면 422(`detail` 에 그 키). 정수가 아니면(`"2"` · `2.5` · `null`) 422. CHECK 도 DB 에 셋 더(`ck_risk_setting_churn_days_range` …) |
| 리비전 `0038_risk_churn` | `risk_setting` 에 `churn_days` · `churn_count` · `slip_count`(not null, server_default 14 · 5 · 2 — `config.py` 의 `risk_churn_*` 와 같은 값) + 범위 CHECK 셋. sqlite 도 돌게 batch. downgrade 는 셋을 지운다 |
| AI 분석 — 넣는 근거 | `report.tasks` · `report.tests`(보낸 줄 전부, 이름 · 파트 이름 · 신호 · 숫자) + **`taskDetails`**(점수 위쪽 6개: `checklist {done,total} \| null` · `recentComments`(3개, 200자) · `dueFlow` · `recentChanges`(최근 `churnDays` 안 바뀐 칸 → 그 칸이 든 줄 수, 칸 이름은 우리말 — 제목 · 본문 · 상태 · 담당자 · 기한 …, 등록 · 삭제 줄 빼고) · `openAgendas`(안건 제목)) + **`testDetails`**(점수 위쪽 6개: `recentActions`(조치 내역 2개, 200자) · `statusFlow`(최근 `churnDays` 안 상태 흐름, 바뀐 적 없으면 지금 상태 하나) · `taggedTasks`(`{key, title}`) · `taggedAgendas`(제목)). 근거는 종류마다 한 번에 읽는다 — 줄 수와 상관없이 쿼리 수가 같다 |
| AI 분석 — `done.refs` | 안건은 지금처럼, 작업은 연결 · 막힌 · 기다리는 작업 + **보낸 작업 리스크 줄 전부**(위쪽 6개 밖도), 테스트는 안건에 닿은 문제 테스트 + **보낸 테스트 리스크 줄 전부** |
| AI 분석 — 거르기 | 세 배열 모두 키가 없으면 `[]`(옛 화면). `agendaIds` 는 지금처럼 키가 있어야 한다(없으면 422). 셋 다 거른 뒤 비면 Claude 를 안 부른다 |
| 저장한 분석 `facts.settings` | 새 분석은 일곱 값. **옛 분석(2026-11-06 전)은 네 값 그대로** 낸다 — 흔들림 셋은 키째 없다(지금 기본값으로 메우면 그때 쓰지 않은 기준을 쓴 것처럼 보인다). 화면은 빈 칸을 기본값으로 읽는다('구현에서 메운 것 (화면)' 의 '옛 모양 읽기') |
| `compare` 순서 | `added` · `kept` 는 이번 스냅샷 순, `removed` 는 앞 스냅샷 순 — 각각 **안건 → 작업 → 테스트**, 종류 안은 점수 순. 앞 분석이 옛 것(작업 · 테스트 없음)이면 이번 작업 · 테스트는 전부 `added` 다 |
| 옛 `compare` | 문자열 · `{agendaId, levelFrom, levelTo}` 를 읽어 그대로 낸다(DB 는 고치지 않는다) |
| Claude 에 넣는 `compare` | 줄마다 `kind`(우리말 — 안건 · 작업 · 테스트) · `title` · `key`(작업 · 테스트), id 없이. `previousTaskCount` · `previousTestCount` 를 더했다 |
| 게시판 `highCount` | `facts` 의 안건 · 작업 · 테스트 줄 중 `high` 수의 합 |

### 시드 p1 — 2026-10-15 · 기본 기준 (목업이 이 값에 맞춘다)

흔들림을 보이려고 시드에 이력 줄을 더했다(`scripts/seed.py` 의 `TASK_CHURN` · `TEST_CHURN`, id `th-<작업>-c<n>` · `sh-<테스트>-c<n>`, 시각은 UTC 03:00 = KST 정오).

| 줄 | 이력 |
| --- | --- |
| `k21` HW-21 | `due` 09-13 → 09-14 (09-08, u1) · 09-14 → 09-15 (09-12, u1) — 기한 거듭 미룸 |
| `k3` HW-3 | `ownerId` u1 → u4 (10-06, u1) · u4 → u2 (10-09, u4) — 담당자 자주 바뀜 |
| `k22` HW-22 | `title` 스테이징 DB → 스테이징 DB 구성(임시) (10-02) · `body` null → `☐ 스테이징 서버 신청` (10-05) · `title` → 스테이징 DB · 백업 구성 (10-08) · `body` → null (10-11) · `title` → 스테이징 DB 구성 (10-14), 모두 u3 — 내용 자주 바뀜 |
| `tc3` HW-T3 | `due` 10-06 → 10-07 (10-01) · 10-07 → 10-08 (10-02), u2 — 기한 거듭 미룸 |
| `tc2` HW-T2 | `status` draft → testing (10-06) · testing → pass (10-07) · pass → fail + `resultNote` null → '잠금 해제 뒤 튕김' (10-08) · fail → pass + `resultNote` → null (10-10), u2 — 결과 뒤집힘 2 |

**작업 리스크** (`tasks`, 이 순서)

| id | 키 | 신호 | 점수 | 등급 | overdueDays | statusDays | 그 밖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `k3` | HW-3 | overdue · longRunning · ownerChurn | 7 | high | 23 | 30 | plannedDays 8 · ownerChanges 2 · openAgendaIds `[t9]` |
| `k20` | HW-20 | overdue · longRunning | 6 | high | 33 | 7 | plannedDays 3 |
| `k4` | HW-4 | overdue · longRunning | 6 | high | 30 | 37 | plannedDays 8 |
| `k21` | HW-21 | overdue · dueSlipped | 6 | high | 30 | 33 | slipCount 2 · dueFlow 09-13 → 09-14 → 09-15 |
| `k9` | HW-9 | overdue · longRunning | 6 | high | 24 | 26 | plannedDays 3 |
| `k1` | HW-1 | overdue · longRunning | 6 | high | 23 | 38 | plannedDays 16 · 담당자 없음 |
| `k7` | HW-7 | overdue · longRunning | 6 | high | 20 | 29 | plannedDays 10 |
| `k10` | HW-10 | overdue | 4 | medium | 22 | 23 | 담당자 없음 |
| `k11` | HW-11 | overdue | 4 | medium | 20 | 21 | 담당자 없음 |
| `k15` | HW-15 | overdue | 4 | medium | 16 | 19 | |
| `k12` | HW-12 | overdue | 4 | medium | 15 | 22 | 담당자 없음 |
| `k13` | HW-13 | overdue | 4 | medium | 15 | 22 | openAgendaIds `[t8]` |
| `k5` | HW-5 | overdue | 4 | medium | 11 | 29 | 담당자 없음 |
| `k6` | HW-6 | overdue | 4 | medium | 11 | 29 | 담당자 없음 |
| `k14` | HW-14 | overdue | 4 | medium | 11 | 19 | 담당자 없음 |
| `k17` | HW-17 | overdue | 4 | medium | 11 | 17 | 담당자 없음 |
| `k16` | HW-16 | overdue | 4 | medium | 11 | 15 | 담당자 없음 |
| `k18` | HW-18 | longBlocked | 3 | medium | 0 | 41 | 기간 없음 · openAgendaIds `[t5]` |
| `k22` | HW-22 | contentChurn | 1 | low | 0 | 2 | contentChanges 5 · plannedDays 8 |

**테스트 리스크** (`tests`, 이 순서 — 묶음 tc1 · tc5 와 신호 없는 tc8 은 없다)

| id | 키 | 상태 | 신호 | 점수 | 등급 | overdueDays | statusDays | 그 밖 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tc3` | HW-T3 | testing | overdue · longRunning · dueSlipped | 8 | high | 7 | 12 | slipCount 2 · refs `[agenda t3]` |
| `tc4` | HW-T4 | ready | basisChanged · notStarted | 3 | medium | 0 | 14 | |
| `tc6` | HW-T6 | blocked | longBlocked | 3 | medium | 0 | 13 | |
| `tc7` | HW-T7 | fail | failedIdle | 3 | medium | 0 | 10 | |
| `tc2` | HW-T2 | pass | flaky | 2 | low | 0 | 5 | flips 2 · refs `[task k4]` |

**사람별** (`owners`) — `(memberId, openAgendas, overdueAgendas, blockedTasks, blockingImpact, riskyTasks, riskyTests)`:
`(u4, 2, 0, 1, 1, 3, 1)` · `(u1, 2, 1, 0, 0, 2, 1)` · `(null, 1, 0, 0, 0, 9, 0)` · `(u2, 1, 0, 0, 0, 2, 1)` · `(u3, 0, 0, 1, 0, 2, 1)`.
안건 리스크(`agendas`)는 `risk.md` 의 표 그대로다(t5 t3 t8 t9 t4 t7).

검사는 `server/tests/test_risk.py` 의 `SEED_TASK_RISKS` · `SEED_TEST_RISKS` 가 이 표를 그대로 본다.

## 2026-11-06 고침 — 작업이 먼저 (사용자)

화면에서 종류를 늘어놓는 순서는 **작업 · 안건 · 테스트** 다 — 숫자 카드 · 종류 필터 · 신호 막대의 마디 · 섞은 목록의 같은 점수 순서 · 건수 글('작업 n · 안건 m · 테스트 k'). 서버 응답 · `compare` 의 순서는 그대로다.

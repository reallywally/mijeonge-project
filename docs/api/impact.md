# AI 영향도 분석 — 합의 (2026-11-10, 같은 날 고침 — 숨은 영향)

안건의 결정내용이 바뀌면 **그 결정에 걸린 작업 · 테스트가 이제 틀리지 않았는지**, **다른 결정된 안건과 부딪히지 않는지**를
Claude 가 읽고 고칠 안을 낸다. 사람은 검토 화면에서 골라 **[반영]** 한다.
이 파일이 영향도 분석 계약의 정답이다. 안건 자체는 `agenda.md`, 리스크 AI 분석의 SSE 틀은 `risk.md` · `chat.md`.

## 정해 둔 것 (사용자, 2026-11-10)

| | 결정 |
| --- | --- |
| 언제 도나 | **[AI 영향도 분석] 버튼으로만.** 저장할 때마다 돌리지 않는다 — 안건 상세는 칸을 벗어날 때마다 저장되어 결정을 다듬는 중간에 여러 번 돌게 된다 |
| 알아차리기 | 결정이 바뀌었는데(결정 판 ≥ 2) 그 판으로 분석한 적이 없으면 안건 상세에 **알림 줄**을 띄운다 — '결정이 바뀌었어요 — 연결 작업 n · 테스트 m · [AI 영향도 분석]'. 세는 것은 서버가 AI 없이 한다 |
| 무엇을 보나 | ① 연결 작업(본문 줄까지) ② 닿는 테스트(내용 · 테스트 데이터) ③ **그 프로젝트의 다른 결정된 안건**(충돌) |
| 답의 모양 | 항목마다 판정 — 작업 · 테스트는 `update`(고칠 안) · `check`(사람이 볼 것) · `ok`(그대로), 안건은 `conflict`(부딪힘) · `check`(확인 필요). **근거(`reason`)는 꼭** — 근거 없는 판정은 서버가 받지 않는다 |
| 반영 | 회의록 AI 정리처럼 **체크 · 고치기 · [지우기] 로 고르고 [반영]**. 작업 · 테스트의 일반 수정과 **같은 권한 · 같은 검사 · 같은 변경 이력**. 한 트랜잭션 |
| 저장 | 분석은 **늘 남긴다** — 그 안건 · 그 결정 판에 묶인다. 같은 판을 다시 열면 지난 결과를 보이고, 결정이 또 바뀌면 '이전 판 분석' 으로 흐린다 |
| 판단은 사람 | AI 판정은 제안이다. 부딪힘(`conflict`)은 반영할 것이 없고 칩 · 근거만 보인다 — 안건을 고칠지는 사람이 정한다 |
| 규칙 목록 | **2단계**(아래 '2단계 — 규칙 목록'). 1단계는 다른 결정된 안건과의 충돌까지 |

## 흐름

1. 안건 상세 — 결정내용이 있으면 **'AI 영향도 분석'** 칸이 선다. 결정 판 ≥ 2 이고 지금 판으로 분석한 적이 없으면 칸 머리가 알림 줄로 바뀐다
2. **[AI 영향도 분석]** → `POST /api/agendas/{agendaId}/impact` — SSE. 진행 한 줄('연결 작업 읽는 중' · '다른 결정 비교 중' · '고칠 안 만드는 중') 뒤 결과 하나
3. 검토 — 세 묶음(**고칠 작업 · 고칠 테스트 · 부딪히는 결정**). `update` 줄은 체크(기본 켬) · 고칠 안을 고치고 · [지우기]. `check` · `ok` 는 접은 묶음에 한 줄씩(근거만). 부딪힘은 안건 칩 + 근거
4. **[반영 N건]** → `POST /api/agenda-impacts/{impactId}/apply` — 고른 것만. 끝나면 그 줄들이 '반영함' 으로 바뀐다
5. 다시 누르면 새 분석이 같은 판에 하나 더 남고, 화면은 가장 최근 것을 보인다

## 결정 전 · 후

- **후** = 지금 `agenda.decision`(앞뒤 공백 뗀 것)
- **전** = 변경 이력(`agenda_history`)에서 `decision` 칸이 바뀐 **가장 최근 줄의 `from`**. 그런 줄이 없으면(처음 결정) `null` — 그때는 '새 결정' 으로 보고 충돌 · 작업 · 테스트를 본다
- 결정내용이 비어 있으면 분석하지 않는다 — 409 `IMPACT_NO_DECISION`

## 무엇을 Claude 에 넣나 (서버가 정한다)

| | 넣는 것 | 상한 |
| --- | --- | --- |
| 안건 | 제목 · 설명 · 결정 전 · 결정 후 · 상태 · 담당자 이름 | 글 칸마다 4,000자(넘으면 자르고 '…(잘림)') |
| 연결 작업 | `task_agenda_link` 로 걸린 지우지 않은 작업 — id · 키 · 제목 · 상태 · 담당자 이름 · 기한 · **본문 줄**(종류 · 글 · 체크 · 들여쓰기) | 40개(작업 seq 순), 본문은 작업마다 60줄 |
| 닿는 테스트 | 이 안건을 **직접 태그했거나, 이 안건에 걸린 작업을 태그한** 테스트(`test.md` '닿는 안건' 의 거꾸로) — id · 키 · 제목 · 상태 · 담당자 이름 · 내용 · 테스트 데이터 | 40개(테스트 seq 순), 글 칸마다 4,000자 |
| 다른 결정된 안건 | 그 프로젝트의 `state = 'decided'` 이고 결정내용이 있는 **다른** 안건 — id · 제목 · 결정내용 · 결정 시각 | 결정 시각 최신 순 80개, 결정내용 1,500자 |

- 셋 다 비면(연결 작업 · 닿는 테스트 · 다른 결정 안건 0) Claude 를 부르지 않고 빈 결과(`summary`: '살펴볼 연결 작업 · 테스트 · 다른 결정이 없습니다.')를 남기고 낸다
- 시스템 프롬프트: 오늘(KST) · 프로젝트 이름 · 아래 규칙
  - 결정 전 → 후 에서 **무엇이 바뀌었는지** 먼저 한두 줄로(`summary`)
  - 작업 · 테스트마다: 바뀐 결정 때문에 제목 · 본문 · 내용 · 테스트 데이터가 **이제 틀렸으면** `update` 와 고친 안, 틀린지 확실치 않으면 `check`, 상관없으면 `ok`. 고칠 것이 없는데 `update` 를 내지 않는다
  - 고친 안은 **바뀐 결정에 닿는 부분만** 고친다. 나머지 글 · 줄 · 체크 상태는 그대로 옮긴다
  - 다른 결정된 안건과 **같이 지킬 수 없으면** `conflict`, 겹치거나 범위가 애매하면 `check`. 상관없는 안건은 내지 않는다
  - `reason` 은 한두 문장, **결정 전 · 후 또는 그 안건의 결정내용을 짚어서**. 넣어 준 것에 없는 사실을 지어내지 않는다
- Claude 가 쥐는 도구는 **`propose_impact`** 하나(강제). 검사에 걸리면 그 까닭을 돌려줘 다시 내게 한다 — 3번까지, 그래도 안 되면 `error` `IMPACT_FAILED`
- 모델 · 분당 제한 · 키 없음은 챗봇과 같다(`chat_model`, 429 `CHAT_RATE_LIMITED`, 503 `CHAT_UNAVAILABLE`, 거절 `CHAT_REFUSED`)

## 모양

```ts
type ImpactVerdict = 'update' | 'check' | 'ok'
type ConflictVerdict = 'conflict' | 'check'

/** 작업 한 줄의 판정 */
interface ImpactTask {
  taskId: string
  verdict: ImpactVerdict
  reason: string
  /** update 일 때만 — 바꿀 칸만. 안 바꾸는 칸은 없다 */
  title?: string
  /** update 일 때만 — 본문 전체를 이 줄들로 갈아끼운다(PATCH body 와 같은 모양, 줄 id 는 없다) */
  body?: { kind: 'check' | 'bullet'; text: string; done: boolean; level: number }[]
  /** 분석 때의 값 — 반영할 때 지금 값과 견준다. 화면은 '전' 으로 보인다 */
  before: { title: string; body: { kind: 'check' | 'bullet'; text: string; done: boolean; level: number }[] }
  /** 반영한 시각 — 안 했으면 null */
  appliedAt: string | null
}

/** 테스트 한 줄의 판정 */
interface ImpactTest {
  testId: string
  verdict: ImpactVerdict
  reason: string
  /** update 일 때만 — 바꿀 칸만 */
  title?: string
  content?: string
  testData?: string
  before: { title: string; content: string; testData: string }
  appliedAt: string | null
}

/** 다른 결정된 안건과의 부딪힘 */
interface ImpactConflict {
  agendaId: string
  verdict: ConflictVerdict
  reason: string
  /** 분석 때 그 안건의 결정내용 */
  decision: string
}

interface AgendaImpact {
  id: string
  projectId: string
  agendaId: string
  /** 분석한 결정 판 — 지금 agenda.decisionRev 와 다르면 '이전 판 분석' */
  decisionRev: number
  decisionBefore: string | null
  decisionAfter: string
  /** 무엇이 바뀌었나 · 무엇을 보면 되나 — 두세 줄 */
  summary: string
  tasks: ImpactTask[]
  tests: ImpactTest[]
  conflicts: ImpactConflict[]
  createdBy: string | null
  createdAt: string
}

/** 안건 상세가 칸을 그릴 때 받는 것 */
interface AgendaImpactState {
  /** 가장 최근 분석 — 없으면 null */
  latest: AgendaImpact | null
  /** 지금 세는 것(AI 없이) — 알림 줄의 숫자 */
  taskCount: number
  testCount: number
  decidedAgendaCount: number
}

/** SSE 이벤트 — chat · risks/summary 와 같은 틀(`event:` 줄이 type) */
type ImpactEvent =
  | { type: 'tool'; name: string; label: string }
  /** 결과 — 꼭 한 번, done 보다 먼저. 이미 남긴 것이라 id 가 있다 */
  | { type: 'impact'; impact: AgendaImpact }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }

/** 반영 — 고르고 고친 것만 */
interface ImpactApplyInput {
  tasks: { taskId: string; title?: string; body?: ImpactTask['body'] }[]
  tests: { testId: string; title?: string; content?: string; testData?: string }[]
}

interface ImpactApplyResult {
  /** 바뀐 작업 · 테스트 — 요청 순서 */
  tasks: Task[]
  tests: TestCase[]
  /** appliedAt 이 찍힌 뒤의 분석 */
  impact: AgendaImpact
}
```

- 배열 순서: `tasks` 는 작업 seq 순, `tests` 는 테스트 seq 순, `conflicts` 는 Claude 가 낸 순. 넣어 준 작업 · 테스트는 **판정이 빠져도** 서버가 `ok` · 근거 '판정 없음' 으로 채워 **모두 싣는다**(화면이 '살펴본 것' 을 셀 수 있게)
- `before` 는 서버가 분석 때 DB 에서 찍는다 — Claude 가 내지 않는다

### `propose_impact` 검사 규칙

- `taskId` · `testId` 는 넣어 준 작업 · 테스트, `agendaId` 는 넣어 준 다른 결정 안건 — 아니면 되돌린다. 같은 id 둘 금지
- `reason` 은 앞뒤 공백을 떼고 1 ~ 500자
- `update` 면 고칠 칸이 **하나 이상**이고 그 값이 `before` 와 달라야 한다. `update` 가 아니면 고칠 칸을 보내지 않는다
- 작업 `title` 은 작업 등록과 같은 검사(1 ~ 200자), `body` 는 `PATCH /api/tasks/{taskId}` 의 `body` 와 같은 검사(줄 수 · 글 길이 · `level` 0 ~ 3)
- 테스트 `title` · `content` · `testData` 는 `PATCH /api/tests/{testId}` 와 같은 검사
- `summary` 는 1 ~ 1,000자

## 테이블 `agenda_impact` (리비전 `0039_agenda_impact`)

| 칸 | 타입 | |
| --- | --- | --- |
| `id` | str PK | |
| `project_id` | str | FK `(agenda_id, project_id)` → `agenda(id, project_id)` ON DELETE CASCADE |
| `agenda_id` | str | |
| `decision_rev` | int | |
| `decision_before` | text, null 가능 | |
| `decision_after` | text | |
| `summary` | text | |
| `result` | jsonb | `{ tasks, tests, conflicts }` — 위 모양 그대로(camelCase) |
| `created_by` | FK → member, null 가능 (ON DELETE SET NULL) | |
| `created_at` | timestamptz | |

- 색인 `(agenda_id, created_at desc)`
- 안건을 지우면(논리 삭제) 분석도 404 로 간다 — 줄은 남는다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/agendas/{agendaId}/impact` | 칸 그리기 — 가장 최근 분석 + 지금 세는 것 | `AgendaImpactState` |
| POST | `/api/agendas/{agendaId}/impact` | 분석 — 본문 없음. 끝까지 받으면 남기고 `impact` 이벤트로 낸다 | `text/event-stream` (`ImpactEvent`) |
| POST | `/api/agenda-impacts/{impactId}/apply` | 반영 — `ImpactApplyInput`. **한 트랜잭션** | `ImpactApplyResult` · 200 |

- 권한: 보기 · 분석은 그 프로젝트 멤버(아니면 404 `AGENDA_NOT_FOUND` — 다른 안건 API 와 같다). 반영은 **줄마다 그 작업 · 테스트의 고치기 권한**(`auth.md` — 작업은 생성자 · 담당자 · 그 프로젝트 관리자 · 시스템 관리자, 테스트는 테스트 PATCH 와 같이 그 프로젝트 멤버 누구나. 2026-11-12 부터 파트가 달린 것은 그 파트의 수정 권한 — `part.md` '파트 권한'. 연결만 하는 테스트 줄도 같다). 하나라도 없으면 403 `FORBIDDEN`, `detail` 은 `tasks.N` · `tests.N`
- `impactId` 경로는 `require_scope` 경계 검사에 든다(분석의 프로젝트로 본다). 없음 · 지운 안건의 것 · 못 보는 프로젝트 것은 404 `IMPACT_NOT_FOUND`

### `apply` 규칙

- 고른 줄은 그 분석의 `update` 줄이어야 한다 — 아니면 422 `VALIDATION_ERROR`(`tasks.N.taskId` · `tests.N.testId`). 화면에서 고친 값은 그대로 받는다(Claude 의 안이 아니어도 된다). 같은 검사(위 '검사 규칙'의 작업 · 테스트 칸)를 다시 본다 — 자리는 `tasks.N.title` · `tests.N.content` 처럼
- **분석 뒤 결정이 또 바뀌었으면** 409 `IMPACT_STALE` — "결정이 바뀌어 다시 분석해야 합니다"
- **분석 뒤 그 작업 · 테스트가 바뀌었으면**(지금 값 ≠ `before` — 작업은 제목 · 본문 줄의 종류 · 글 · 체크 · 들여쓰기, 테스트는 제목 · 내용 · 테스트 데이터) 409 `IMPACT_TARGET_CHANGED`, `detail` 은 걸린 자리 전부 `{ "tasks.N": "…" }`. 덮어쓰지 않는다
- 지운 작업 · 테스트면 409 `IMPACT_TARGET_CHANGED`(같은 까닭 — 분석 때와 다르다)
- 반영은 **일반 수정과 같은 서비스**를 탄다 — 작업은 `patch_task`(제목 · 본문, 변경 이력 `title` · `body`), 테스트는 `patch_test`(변경 이력 · `basis_seq` 다시 찍기 — 그래서 반영하면 그 테스트의 '기준 바뀜' 도 풀린다)
- 반영한 줄에 `appliedAt` = 지금. 이미 반영한 줄을 다시 보내면 그 줄은 `before` 와 달라 409 `IMPACT_TARGET_CHANGED` 로 걸린다(두 번 반영하지 않는다)
- 하나라도 틀리면 아무것도 안 바뀐다
- `tasks` · `tests` 가 둘 다 비면 422 `VALIDATION_ERROR`

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `IMPACT_NOT_FOUND` | 위 |
| 409 | `IMPACT_NO_DECISION` | 결정내용이 빈 안건을 분석 |
| 409 | `IMPACT_STALE` | 분석 뒤 결정이 또 바뀌었는데 반영 |
| 409 | `IMPACT_TARGET_CHANGED` | 분석 뒤 작업 · 테스트가 바뀌었거나 지워졌는데 반영 |
| (스트림) | `IMPACT_FAILED` | `propose_impact` 를 3번 고쳐도 통과 못 함 |

## 화면

- **안건 상세의 'AI 영향도 분석' 칸** — 결정내용 칸 아래(확인 요청 칸 자리 근처). 결정내용이 비면 칸이 없다. 칸을 열 때 `GET …/impact`
  - 머리: 'AI 영향도 분석' + **[AI 영향도 분석]**(분석한 적 있으면 [다시 분석]). 결정 판 ≥ 2 이고 `latest` 가 없거나 `latest.decisionRev` ≠ 지금 판이면 **알림 줄**: '결정이 바뀌었어요 — 연결 작업 n · 테스트 m' (둘 다 0 이고 다른 결정 안건도 0 이면 알림 줄을 안 띄운다)
  - 결정내용 칸을 고쳐 판이 오르면(같은 화면에서) 다시 받는다
  - 분석 중: 진행 한 줄 + [멈추기]. 멈추면 아무것도 안 남는다
- **결과** — 맨 위 `summary` · '결정 전 → 후'(전이 없으면 '새 결정') · '분석 시각 · 분석한 사람'. `decisionRev` ≠ 지금 판이면 결과 전체를 흐리고 '이전 결정으로 한 분석이에요 — [다시 분석]', 반영 버튼은 끈다
  - **고칠 작업** · **고칠 테스트** — `update` 줄: 체크(기본 켬) · 키 칩(누르면 그 상세) · 근거 · '전 → 후'(제목은 한 줄, 본문 · 내용은 바뀐 줄을 표시한 짧은 비교) · [고치기](안을 손으로 고침) · [지우기](회의록 검토와 같은 규칙 — 숨기고 반영에서 빠짐, [되돌리기]). 반영한 줄은 '반영함 ✓' 으로 잠근다
  - **부딪히는 결정** — `conflict` 는 붉게, `check` 는 회색. 안건 칩 · 그 결정내용 한 줄 · 근거
  - **살펴본 것** (접힘) — `check` · `ok` 작업 · 테스트 한 줄씩(키 · 제목 · 근거)
  - 아래 **[반영 N건]** — N 은 켠 `update` 줄. 0 이면 꺼짐. 권한 없는 줄은 체크를 끄고 '고칠 권한이 없어요' 로 잠근다(작업은 작업 상세가 칸을 잠그는 것과 같은 판단 — 테스트는 멤버 누구나라 잠기지 않는다)
  - 409 `IMPACT_STALE` → 결과를 흐리고 [다시 분석] 을 권한다. 409 `IMPACT_TARGET_CHANGED` → 걸린 줄에 '분석 뒤에 바뀌었어요' 를 달고 체크를 끈다(나머지는 다시 반영할 수 있다). 반영하면 바뀐 작업 · 테스트를 스토어에 넣는다
- **회의록 [등록] 뒤** — 등록에서 기존 안건의 결정을 바꿨으면(`updates` 가 결정내용을 바꿈) 결과 줄 아래 '결정이 바뀐 안건 n건 — 영향도를 분석해 보세요' + 안건 칩(누르면 그 안건 상세, 칸이 바로 보이게)

## 시드 · 목업

- 시드에는 넣지 않는다(개발 DB 에 시드를 다시 돌리지 않는다)
- 목업: 분석 스트림을 목업으로 흘린다 — 연결 작업 · 닿는 테스트 · 다른 결정 안건을 목업 데이터에서 같은 규칙으로 고르고, 작업 하나를 `update`(본문 한 줄을 고친 안), 테스트 하나를 `update`, 나머지를 `ok`, 다른 결정 안건이 있으면 하나를 `check` 로 낸다. 반영 검사(권한 · stale · target changed)도 같은 순서로 본다

## 2026-11-10 고침 — 연결 안 된 작업 · 테스트도 찾는다 (숨은 영향)

> 사용자: "작업에 'OS 를 우분투로 설치한다' 가 있는데 '록키로 OS 를 설정한다' 는 결정이 나면 그 작업에도 영향이 간다 — 이것도 검사하고 싶다."
> 그런 작업은 그 안건에 **연결되어 있지 않은** 경우가 많다. 1단계는 연결 작업 · 닿는 테스트만 봐서 놓친다.

### 정해 둔 것

| | 결정 |
| --- | --- |
| 찾는 방법 | 분석 중 Claude 가 **검색 도구로 직접 찾는다** — 결정 전 · 후에서 바뀐 것(예: 우분투 → 록키)을 뽑아, **바뀌기 전 값 · 바뀐 뒤 값 · 그 주제**(예: '우분투' · 'Ubuntu' · '록키' · 'Rocky' · 'OS' · '운영체제')로 작업 · 테스트를 찾는다. 옛 값을 적은 작업이 바로 고칠 대상이다 |
| 도구 | 읽기 넷 — `search_tasks` · `search_tests`(제목 · 본문 줄 / 제목 · 내용 · 테스트 데이터), `get_task` · `get_test`(하나를 본문까지). 내기는 그대로 `propose_impact` 하나. 분석 한 번에 읽기 도구는 **12번까지**(넘으면 도구가 '더 찾을 수 없습니다 — propose_impact 로 내세요' 를 돌려준다) |
| 결과에 싣는 것 | 연결 안 된 것 중 **영향이 있는 것만** — 판정 `update`(고칠 안) · `check`(확인 필요). `ok` 는 싣지 않는다(상관없는 것을 늘어놓지 않는다). 연결 안 된 작업 20개 · 테스트 20개까지 |
| 표시 | 줄마다 **`linked: boolean`** — 연결 작업 · 닿는 테스트는 `true`, 검색으로 찾은 것은 `false`. 화면은 '연결 안 됨 · AI 가 찾음' 배지 |
| 연결 제안 | 연결 안 된 줄은 반영할 때 **이 안건에 연결**할 수 있다(작업 ↔ 안건 링크, 테스트는 안건 태그). 그래야 다음 분석부터 연결 작업으로 본다. 화면 기본은 켬 |
| 지어낸 id 막기 | 연결 안 된 줄의 id 는 **그 분석에서 도구가 돌려준 것**(검색 결과 · `get_*`)이어야 한다. 아니면 검사가 되돌린다 |
| 고칠 안의 근거 | 연결 안 된 작업에 본문 고칠 안(`body`)을 내려면 그 분석에서 **`get_task` 로 본문을 읽었어야** 한다(검색 결과의 한 줄 조각만 보고 본문 전체를 갈아끼우지 않게). 테스트의 `content` · `testData` 도 `get_test` 로 읽었어야 한다. 제목만 고치는 것은 검색 결과로 된다. 잘린 칸(60줄 · 4,000자 넘음)은 1단계처럼 고칠 수 없다 |

### 도구

```ts
/** search_tasks — 1단계 챗봇 도구와 같은 검색(제목 · 본문 줄, trigram). 지우지 않은 작업만 */
in:  { query: string; limit?: number /* 1 ~ 20, 기본 10 */ }
out: { tasks: { id; key; title; status; ownerName: string | null; linked: boolean; matched: 'title' | 'body'; snippet: string }[] }

/** search_tests — 제목 · 내용 · 테스트 데이터. 같은 검색 수법 */
in:  { query: string; limit?: number }
out: { tests: { id; key; title; status; ownerName: string | null; linked: boolean; matched: 'title' | 'content' | 'testData'; snippet: string }[] }

/** get_task · get_test — 하나를 본문까지. task_id 에는 id 나 키(HW-4) */
get_task in: { task_id: string } → { id; key; title; status; ownerName; due; linked; body: 줄[]; bodyCut: boolean }
get_test in: { test_id: string } → { id; key; title; status; ownerName; linked; content; contentCut; testData; testDataCut }
```

- `linked` 는 '이 안건의 연결 작업 · 닿는 테스트인가'. 연결된 것은 처음부터 사용자 메시지에 들어 있다 — 도구는 **연결 안 된 것을 찾는 데** 쓴다
- 없는 id · 키는 `{ error: '…' }` 를 돌려준다(분석을 끊지 않는다)
- 진행 줄(`tool` 이벤트): `search_tasks` · `search_tests` → '관련 작업 · 테스트 찾는 중', `get_task` · `get_test` → '관련 작업 · 테스트 읽는 중'. 같은 이름이 잇달아 오면 화면은 한 줄로 둔다

### 모양 (늘어나는 것)

```ts
interface ImpactTask {
  // … 1단계 그대로
  /** 연결 작업이면 true, 검색으로 찾은 것이면 false */
  linked: boolean
  /** 반영 때 이 안건에 연결했으면 true — 연결 안 된 줄에서만. 반영 전 · 안 했으면 false */
  linkedOnApply: boolean
}
interface ImpactTest {
  // … 1단계 그대로
  linked: boolean
  linkedOnApply: boolean
}

interface ImpactApplyInput {
  tasks: { taskId: string; title?: string; body?: …; /** 연결 안 된 줄만 — 이 안건에 연결 */ link?: boolean }[]
  tests: { testId: string; title?: string; content?: string; testData?: string; link?: boolean }[]
}

interface ImpactApplyResult {
  tasks: Task[]
  tests: TestCase[]
  /** 새로 건 작업 ↔ 안건 링크 — 화면이 스냅샷을 다시 받지 않고 더한다 */
  links: TaskAgendaLink[]
  impact: AgendaImpact
}
```

- 1단계에서 남긴 분석(`linked` 칸이 없는 것)은 서버가 읽을 때 `linked: true` · `linkedOnApply: false` 로 채운다(이행하지 않는다)
- `propose_impact` 의 작업 · 테스트 줄은 그대로 — 서버가 id 로 `linked` 를 정한다. 연결 안 된 줄에 `ok` 를 내면 검사가 되돌린다('상관없는 것은 내지 마세요')

### `apply` (늘어나는 것)

- 고를 수 있는 줄: 1단계의 `update` 줄 + **연결 안 된 `check` 줄**(이때는 `link: true` 만 — 고칠 칸을 보내면 422)
- `link: true` 는 `linked: false` 줄에서만(아니면 422 `tasks.N.link`). 작업은 `PUT /api/tasks/{taskId}/agendas/{agendaId}` 와 같은 서비스(권한 = 작업 고치기 권한, 이미 걸려 있으면 그대로 — 멱등), 테스트는 `PUT /api/tests/{testId}/refs/agenda/{agendaId}` 와 같은 서비스(태그 20개 상한 그대로 — 넘으면 그 서비스의 오류를 `tests.N.link` 자리로)
- 줄은 고칠 칸 · `link` 중 하나 이상이 있어야 한다. 고칠 칸 없이 `link` 만 보낸 줄은 `before` 비교(TARGET_CHANGED)를 하지 않는다 — 글을 덮어쓰지 않으니까. 지운 대상이면 그대로 409 `IMPACT_TARGET_CHANGED`
- 반영한 줄에 `appliedAt`, 연결했으면 `linkedOnApply: true`
- 한 트랜잭션 · 검사 순서(422 → 403 → 409 STALE → 409 TARGET_CHANGED)는 그대로

### Claude 에게 (늘어나는 규칙)

- 먼저 결정 전 · 후에서 **바뀐 값**을 뽑는다. 연결 작업 · 테스트를 본 뒤, **바뀌기 전 값**과 그 주제로 `search_tasks` · `search_tests` 를 돌려 연결 안 된 것 중 옛 값 · 옛 결정을 전제로 한 것을 찾는다. 한글 · 영문 · 줄임말을 바꿔 가며 찾는다
- 찾은 것 중 본문을 고쳐야 하면 `get_task` · `get_test` 로 읽고 고친 안을 낸다. 확실치 않으면 `check`
- 결정 전이 없으면(새 결정) 결정이 정한 주제로 찾아, 그 결정과 **어긋나게 적힌** 작업 · 테스트를 찾는다

### 화면 (늘어나는 것)

- 고칠 작업 · 고칠 테스트 묶음에 연결 안 된 줄도 같이 든다 — **'연결 안 됨 · AI 가 찾음'** 배지, 줄 아래 **[✓ 이 안건에 연결]** 체크(기본 켬)
- 연결 안 된 `check` 줄도 이 묶음에 든다(접은 '살펴본 것' 이 아니다 — 찾아낸 것이라). 고칠 안이 없어 '확인 필요' 와 근거만, 고를 수 있는 것은 연결뿐. 체크를 켜면 [반영] 이 연결만 한다
- [반영 N건] 의 N 은 보낼 줄 수(고칠 안 또는 연결이 있는 줄)
- 반영 결과 `links` 를 데이터 스토어에 더한다. 연결한 줄은 '반영함 ✓ · 연결함'
- 알림 줄의 숫자는 그대로(연결 작업 · 닿는 테스트) — 연결 안 된 것은 분석을 돌려야 안다

### 목업

- 검색은 목업 작업 · 테스트의 제목 · 본문 · 내용에 낱말이 들어 있는지로 본다. 목업 분석은 결정 전 · 후의 낱말 중 하나로 찾아 걸리는 연결 안 된 작업이 있으면 하나를 `update`(제목 또는 본문 한 줄에서 옛 낱말을 새 낱말로) · `linked: false` 로 낸다

### 서버가 먼저 찾는 후보 (2026-11-10 고침 — 놓침 고치기)

> 사용자: 'server os' 안건(결정 '록키', 처음 결정)을 분석했는데 '서버 OS 설치' 작업(본문 '우분투로 설치한다', 연결 안 됨)을 못 잡았다.
> 원인 — 연결 안 된 것을 찾는 일을 **모델의 검색 도구 호출에만** 맡겼다. 개발 서버의 모델(`LLM_PROVIDER=groq`, `openai/gpt-oss-120b`)은
> 검색 없이 바로 `propose_impact` 를 냈다. 검색 자체는 '우분투' · 'OS' 로 그 작업을 찾는다.

- 분석 전에 **서버가 낱말로 먼저 찾는다** — 모델이 도구를 부르든 안 부르든 같다
- 낱말(`search_terms`, 10개까지): **옛 결정 → 제목이 겹치는 다른 결정된 안건의 결정 → 이 안건 제목 → 그 안건들의 제목 → 새 결정** 순.
  조사 · 어미('으로' · '로' · '를' · '한다' …)를 떼고, 한 글자 · 흔한 낱말('결정' · '사용' · '버전' …)은 뺀다. 대소문자만 다르면 하나
  - 처음 결정(전 없음)이면 제목이 겹치는 다른 결정 안건의 결정이 사실상의 옛 값이다 — 'server os' 의 록키 ↔ '서버 OS' 의 우분투
  - 그 안건들의 제목은 한 · 영이 갈린 주제어를 채운다(server ↔ 서버)
- 낱말마다 `search_tasks` · `search_tests`(각 10개) → 연결 작업 · 닿는 테스트가 아닌 것만, 먼저 걸린 순으로 각 **20개까지**, 작업 · 테스트 번호 순으로 넣는다
- 사용자 메시지에 **`candidates: { terms, tasks, tests }`** — 작업 · 테스트 모양은 연결 작업과 같다(본문 · 내용까지). **읽은 것으로 친다** — `get_task` · `get_test` 없이 본문 고친 안을 낼 수 있다. 결과 줄은 `linked: false`
- 프롬프트: candidates 는 하나씩 빠짐없이 보고 어긋나면 update · 애매하면 check · 상관없으면 내지 않는다. 모자라면 검색 도구로 더 찾는다
- 후보가 있으면 진행 줄에 `search_tasks` '관련 작업 · 테스트 찾는 중' 하나를 `compare_decisions` 다음에 낸다
- 볼 것(연결 작업 · 닿는 테스트 · 다른 결정 안건 · 후보)이 하나도 없을 때만 모델을 부르지 않는다
- 검색은 `pg_trgm` 이라 sqlite 위의 검사에서는 후보를 찾지 않는다 — 찾는 것은 Postgres 검사(`test_candidates_found_without_search_tools`)가 본다

## 2단계 — 규칙 목록 (아직 계약 아님)

결정된 안건 바깥의 비즈니스 · 내부 규칙(보안 정책 · 개발 표준 · 계약 조건)을 프로젝트에 적어 두고 영향도 분석이 같이 대조한다.

- 규칙 한 줄 = **문장 · 까닭 · 태그 · 출처**(예: '보안정책 v3 4.2절'). 프로젝트 관리자 · 담당이 쓴다. 회의록 AI 정리가 '규칙으로 보이는 문장' 을 후보로 낼 수 있다
- 영향도 분석의 `conflicts` 에 `ruleId` 갈래를 더한다 — 근거는 그 규칙을 짚어야 한다
- 수십 개까지는 태그로 거른 규칙을 통째로 넣는다. 수백 개가 넘으면 임베딩 검색으로 고른다
- 숫자 · 날짜로 딱 떨어지는 규칙(금액 상한 · 기한 범위)은 AI 가 아니라 서버 규칙으로 본다(리스크 신호와 같은 원칙)
- 같은 것을 여러 이름으로 불러 놓치면 **용어 사전**(동의어)을 먼저 둔다. 관계 추론이 많아지거나 여러 프로젝트가 같은 규칙을 공유할 때 온톨로지를 본다

## 1단계에서 하지 않는 것

- 새 작업 · 새 테스트 제안(고칠 것만 낸다)
- 안건 목록의 '결정 바뀜 · 분석 안 함' 표시
- 챗봇 도구

## 구현에서 메운 것 (서버, 2026-11-10)

계약이 비워 둔 자리를 서버가 이렇게 메웠다. 모양(타입 · 키)은 위 '모양' 그대로다 — 프론트 `domain.ts` 와 대조하는 검사(`tests/test_contract_types.py` 의 `IMPACT_SHAPES`)가 있다.

- **진행 줄** — `tool.name` 은 `read_tasks`('연결 작업 읽는 중') · `compare_decisions`('다른 결정 비교 중') · `propose_impact`('고칠 안 만드는 중'). 앞 둘은 Claude 를 부르기 직전에 한 번씩, `propose_impact` 는 Claude 가 낼 때마다(고쳐 낼 때마다 한 줄 더) 온다. **살펴볼 것이 없으면** 진행 줄 없이 `impact` · `done` 둘만 온다
- **분석 요청의 순서** — 404 `AGENDA_NOT_FOUND` → 409 `IMPACT_NO_DECISION`(키 · 분당 제한보다 먼저 — 제한을 먹지 않는다) → 503 `CHAT_UNAVAILABLE` · 429 `CHAT_RATE_LIMITED` → 스트림. 살펴볼 것이 없는 경우도 키가 없으면 503 이다(리스크 분석의 '줄이 없음' 과 같다)
- **결정 전** — 가장 최근 `decision` 칸 줄의 `from` 을 앞뒤 공백 떼고 쓴다. 빈 글(`''` → 결정, 이행 0032 의 줄이 이렇다)도 처음 결정으로 보고 `null`
- **세는 것** (`taskCount` · `testCount` · `decidedAgendaCount`) — **상한 없이** 다 센다(상한은 Claude 에 넣는 것에만). 닿는 테스트는 상한 밖의 연결 작업까지 보고 고른다. 지운 작업은 세지 않고 그 작업으로만 닿던 테스트도 빠진다. 묶음(하위가 있는 테스트)도 태그가 닿으면 든다. 다른 결정 안건은 결정내용을 앞뒤 공백 떼고 비면 뺀다
- **다른 결정 안건의 순서** — 결정 시각 최신 순, 같으면 나중에 등록한 것, 결정 시각이 없는 지난 줄은 맨 뒤
- **잘린 칸은 못 고친다** — 본문이 60줄을 넘는 작업은 Claude 에 `body_cut: true` 로 가고 그 작업의 `body` 고친 안을 되돌린다(통째로 갈아끼우면 잘린 뒤 줄이 사라진다). 테스트 `content` · `testData` 가 4,000자를 넘으면 같은 까닭으로 그 칸을 못 고친다(`content_cut` · `test_data_cut`). 줄 글은 자르지 않는다
- **검사 상한** — 지금 작업 `PATCH` 에는 제목 길이 · 본문 상한이 없다. 영향도의 고친 안 · 반영에만 건다: 작업 제목 앞뒤 공백 떼고 1 ~ 200자, 본문 200줄까지 · 한 줄 4,000자까지 · `level` 0 ~ 3. 테스트는 `PATCH /api/tests` 와 같다(제목 1 ~ 200자 · 내용 10,000자 · 테스트 데이터 4,000자). 제목 · `reason` · `summary` 는 앞뒤 공백을 떼고 남긴다
- **'before 와 달라야'** — Claude 의 안은 **보낸 칸마다** 달라야 한다(안 바꾸는 칸은 `null`). 반영은 **보낸 칸 중 하나라도** 다르면 된다 — 화면에서 고쳐 되돌린 칸이 섞여도 받는다. 다 같으면 422 `tasks.N`(또는 `tests.N`) '지금 값과 다른 칸이 없습니다.'. 반영 요청에서 칸을 안 보내거나 `null` 이면 그 칸은 그대로다
- **반영 검사 순서** — 422 `VALIDATION_ERROR` → 403 `FORBIDDEN` → 409 `IMPACT_STALE` → 409 `IMPACT_TARGET_CHANGED`. 앞에서 걸리면 뒤는 안 본다. 422 는 걸린 자리를 **한 번에 다** `detail` 에 싣는다(`tasks.N.taskId` · `tasks.N.title` · `tasks.N.body.M.level` · `tests.N.testData` · `tasks.N` …). 둘 다 비면 `{ "tasks": "반영할 줄이 없습니다." }`. 같은 작업 · 테스트를 두 번 보내면 `tasks.N.taskId` '같은 작업이 두 번 있습니다.'
- **403 · 409 의 `detail` 글** — 403 `{ "tasks.N": "이 작업을 고칠 권한이 없습니다." }`. 409 `IMPACT_TARGET_CHANGED` 는 바뀌었으면 '분석 뒤에 바뀌었습니다.', 지웠으면 '분석 뒤에 지워졌습니다.'. 지운 작업은 권한을 보지 않고 바로 '지워짐' 으로 간다
- **반영이 남기는 것** — 그 줄의 `appliedAt` 과 함께 **반영한 값**을 남긴다: 고친 안 칸이 보낸 값으로 바뀌고 안 보낸 고친 안 칸은 빠진다(화면에서 고친 안이면 그것이 '후' 다). `before` · 판정 · 근거는 그대로
- **본문 줄 id** — 반영으로 본문을 갈아끼울 때 **같은 자리의 줄은 기존 id 를 이어 쓴다**(일반 `PATCH` 의 id 유지와 같은 효과 — 고치지 않은 줄의 id 가 그대로다). 남는 줄은 지우고 늘어난 줄은 새 id
- **변경 이력** — `PATCH` 와 같은 서비스 몸통이라 작업 본문 '10분 합치기'(Q65)도 같다. 테스트는 글 칸을 고쳤으니 `basis_seq` 를 다시 찍는다
- **테스트 반영 권한** — 테스트 `PATCH` 처럼 그 프로젝트를 볼 수 있으면 된다(부여 없는 시스템 관리자 포함)
- **가장 최근 분석** — `created_at` 이 가장 늦은 것. 색인은 `(agenda_id, created_at)` 오름차순으로 세웠다 — Postgres 가 거꾸로 읽는다(sqlite 검사에서도 같은 모양으로 서게)
- **루프** — `propose_impact` 실패 · 글로만 답함(다시 내라고 한 줄 덧붙임)을 합쳐 3번이면 `IMPACT_FAILED` '영향도를 분석하지 못했습니다. 잠시 뒤에 다시 분석해 주세요.'. 답이 `max_tokens` 에 닿으면 바로 `IMPACT_FAILED`(글만 다르다). 거절은 `CHAT_REFUSED`. `max_tokens` 는 새 설정 `IMPACT_MAX_TOKENS`(기본 16,000)
- **스트림 중에 화면이 끊으면** 남기지 않는다 — 남기는 자리는 검사를 통과한 뒤 하나다. 분석 중에 결정이 또 바뀌면 분석을 시작한 판으로 남는다(화면은 '이전 판 분석' 으로 흐린다)

**숨은 영향 고침에서 메운 것 (서버, 2026-11-10)**

- **진행 줄** — `tool.name` 에 `search_tasks` · `search_tests`('관련 작업 · 테스트 찾는 중') · `get_task` · `get_test`('관련 작업 · 테스트 읽는 중')가 는다. 읽기 도구를 **부를 때마다 한 줄**(같은 차례에 여럿이면 여러 줄). 12번을 넘겨 막힌 부름은 진행 줄이 없다. 순서는 `read_tasks` · `compare_decisions` → (읽기 줄들) → `propose_impact`
- **루프** — `propose_impact` 를 첫 차례부터 강제하지 않는다(도구는 늘 모델이 고른다). 읽기를 한 차례는 고쳐 내기 기회(3번)를 먹지 않는다. 다만 **12번에 막힌 읽기 · 없는 도구뿐인 차례**는 한 번을 먹는다 — 같은 부름을 되풀이해도 끝난다. 차례 전체의 천장은 20(멈춘 차례 포함) — 닿으면 `IMPACT_FAILED`. 12번을 넘긴 부름의 결과는 `{ "error": "더 찾을 수 없습니다 — propose_impact 로 내세요" }`(오류 표시)
- **도구의 결과** — 키는 계약 그대로 camelCase(`ownerName` · `bodyCut` · `testData` · `contentCut` · `testDataCut`). `ownerName` 은 담당자가 없으면 `null`. `status` 는 그 줄 자체의 상태(묶음 테스트도 하위에서 모으지 않는다 — 사용자 메시지의 닿는 테스트와 같다). 검색은 챗봇 `search_tasks` 와 같은 함수(지운 작업 빠짐), 테스트 검색은 같은 수법의 새 함수 `search.search_tests`(제목 · 내용 · 테스트 데이터, 점수가 같으면 그 순서). 테스트 칸에는 trigram 색인을 새로 세우지 않았다(이행 없음 — 줄 수가 작다). `get_*` 는 id 나 키(대소문자 무관)로 찾고 **그 프로젝트 안에서만** — 다른 프로젝트 id · 없는 키 · 지운 작업은 `{ "error": "작업을 찾을 수 없습니다." }` · `{ "error": "테스트를 찾을 수 없습니다." }`. 빈 검색어 · `limit` 범위 밖도 `{ error }` 로 돌려주고 분석을 잇는다. 도구를 부른 뒤마다 읽기 트랜잭션을 놓는다
- **'찾은 줄'** — 넣어 준 연결 작업 · 닿는 테스트(사용자 메시지) **밖**의 줄. 그 분석에서 도구(검색 · `get_*`)가 돌려준 것이어야 한다. `linked` 는 실제 연결 여부라, 연결 작업이지만 40개 상한 밖이라 안 넣어 준 것을 도구로 찾아 내면 `linked: true` 인 찾은 줄이 된다(규칙은 찾은 줄과 같다 — `ok` 못 냄 · `get_*` 필요 · 20개 상한에 듦). `before` 는 도구가 **마지막으로** 돌려준 때의 DB 값(검색 결과도 본문 전체를 떠 둔다)
- **검사 글** — 지어낸 id: `tasks.N.taskId` '넣어 준 연결 작업도, 도구가 돌려준 작업도 아닙니다.'(테스트도 같은 꼴 — 1단계 글 '넣어 준 연결 작업이 아닙니다.' 를 이것으로 바꿨다). 찾은 줄의 `ok`: `tasks.N.verdict` '상관없는 것은 내지 마세요 — 도구로 찾은 것은 영향이 있는 것만 update · check 로 냅니다.'. 읽지 않은 본문: `tasks.N.body` '본문을 고치려면 get_task 로 먼저 읽어야 합니다.', `tests.N.content` · `tests.N.testData` '내용 · 테스트 데이터를 고치려면 get_test 로 먼저 읽어야 합니다.'. 상한: `tasks` · `tests` '도구로 찾은 작업(테스트)은 20개까지 냅니다.'. 잘린 칸은 1단계와 같은 글
- **결과 줄 순서** — 넣어 준 줄(seq 순, 판정이 빠지면 `ok` 로 채움) 다음에 찾은 줄(seq 순). 넣어 준 줄은 늘 `linked: true`
- **반영의 422 글** — `link: true` 를 연결된 줄에: `tasks.N.link` '이미 이 안건에 연결된 줄입니다 — 연결은 연결 안 된 줄에서만 합니다.'. 연결 안 된 `check` 줄에 고칠 칸: `tasks.N` '확인 필요 줄은 고칠 안이 없습니다 — 연결(link)만 보냅니다.', `link` 없이: `tasks.N.link` '확인 필요 줄은 연결(link)로만 고릅니다.'. 연결 안 된 `update` 줄에 고칠 칸도 `link` 도 없으면 `tasks.N` '고칠 칸(title · body)도 연결(link)도 없습니다.'(연결된 줄은 1단계 글 그대로). 연결된 `check` · `ok` 줄은 1단계처럼 `tasks.N.taskId`. `link: null` · `false` 는 안 보낸 것과 같다
- **반영이 남기는 것 (연결)** — 연결만 한 줄도 `appliedAt` 이 찍히고, 고친 안 칸은 1단계 규칙대로 **보낸 값**(없으면 빠짐)으로 남는다 — 연결만 한 `update` 줄은 고친 안이 빠지고 '반영함 · 연결함' 만 남는다. `linkedOnApply` 는 한 번 `true` 면 그대로. 연결만 한 줄은 다시 보내도 된다(멱등 — 200, `links` 는 비고 `appliedAt` 만 새로)
- **반영 응답** — `tasks` · `tests` 는 **보낸 줄 전부**(연결만 한 줄도) 요청 순서. `links` 는 이번에 **새로** 건 작업 ↔ 안건 링크만(`{ taskId, agendaId }`), 이미 걸려 있던 것은 빠진다. 테스트 태그는 `tests[].refs` 에 보인다
- **반영의 이력 · 순서** — 줄마다 고치기(작업 `edit_task` · 테스트 `edit_test`) 뒤 연결(작업은 링크 PUT 의 몸통 `task.attach_agenda`, 테스트는 태그 PUT 의 몸통 `test.add_ref`). 그래서 변경 이력은 `body` 줄 다음 `agenda` 줄, 테스트는 `content` 줄 다음 `agendaRef` 줄로 따로 남는다(일반 화면에서 고치고 거는 것과 같다). 태그를 새로 걸면 테스트 기준(`basis_seq`)을 다시 찍는다(태그 PUT 과 같다). 태그 상한에 걸리면 400 `TEST_REF_LIMIT` 그대로, `detail` 은 `{ "tests.N.link": "태그는 20개까지 걸 수 있습니다." }` — 앞 줄의 반영도 다 되돌린다. 연결의 권한은 작업 고치기 권한이라 403 검사(`tasks.N`)에 그대로 든다

## 구현에서 메운 것 (화면, 2026-11-10)

계약이 비워 둔 화면 자리를 이렇게 메웠다. 타입 이름 · 모양은 위 '모양' 그대로다(`web/src/types/domain.ts`, 본문 줄은 `ImpactBodyLine` 으로 이름만 붙였다).

- **스트림 읽기** — 챗봇의 `toChatEvent` 는 건드리지 않고 회의록처럼 `postSseMessages` 위에 `toImpactEvent`(`api/impacts.ts`)를 따로 둔다. `impact` 이벤트는 GET 의 `latest` 와 같은 읽기(`toImpact`)를 거치고, 모양이 아니면 깨진 스트림(`SERVER_UNREACHABLE`), `impact` 없이 `done` 이 와도 같다. 고친 안 칸이 없거나 `null` 이면 없는 칸으로 읽는다
- **칸이 서는 때** — 결정내용(앞뒤 공백 뗀 것)이 있으면. 칸을 열 때 · 그 안건의 `decisionRev` 가 오를 때(같은 화면에서 결정을 고칠 때) `GET` 을 다시 부른다. 알림 줄은 머리 줄 자체가 노란 줄로 바뀌고 같은 줄 끝에 [AI 영향도 분석] 이 있다. 알림 숫자는 연결 작업 · 테스트만 적는다(다른 결정 안건 수는 띄울지만 가른다)
- **분석 중** — 한 번에 한 안건. 진행 한 줄이 오기 전에는 '결정을 읽는 중'. **팝업을 닫거나 다른 안건으로 옮기면 받는 중인 분석을 끊는다**(끝까지 받지 못한 분석은 남지 않는다 — 계약 '멈추면 아무것도 안 남는다' 와 같다). 다시 분석하는 동안 앞 결과는 숨긴다. 실패는 서버 `message` 를 칸 안에 한 줄로(`CHAT_RATE_LIMITED` · `CHAT_UNAVAILABLE` · `IMPACT_FAILED` · `IMPACT_NO_DECISION` 모두 같은 자리)
- **검토 상태는 화면 메모리** — 고름 · 지운 줄 · 고친 안은 분석 id 마다 `stores/impact.ts` 에 두고, 같은 프로젝트 안에서는 팝업을 다시 열어도 남는다. 프로젝트를 바꾸면 비운다
- **[고치기]** — Claude 가 낸 칸만 고친다(제목만 낸 작업에 본문 칸을 새로 열지 않는다). 본문은 작업 상세의 본문 편집기(`TaskBodyEditor`)를 그대로 쓴다. 켠 줄이 칸 검사(제목 1 ~ 200자 · 본문 200줄 · 줄 4,000자 · `level` 0 ~ 3, 테스트는 `PATCH` 와 같은 검사)에 걸리거나 **보낸 칸이 모두 분석 때 값과 같으면**('지금 값과 다른 칸이 없습니다.') [반영] 을 끈다 — 서버의 422 를 미리 본다
- **'전 → 후'** — 제목은 한 줄(전은 지운 글). 본문 · 테스트 내용 · 테스트 데이터는 줄 단위 비교(LCS)로 지운 줄(−) · 넣은 줄(+)과 앞뒤 한 줄만 두고 나머지는 '… n줄 그대로'. 본문 줄은 변경 이력과 같은 표시(☐ ☑ •, 들여쓰기 공백 둘)로 견준다. **반영한 줄의 '후' 는 서버가 남긴 반영한 값**(화면에서 고쳤으면 그 값)이다
- **줄의 처지** — 반영함(✓, 체크 · [고치기] · [지우기] 없음) · 찾을 수 없는 작업(스냅샷에 없음) · 분석 뒤에 바뀌었어요(409 가 짚은 줄) · 고칠 권한이 없어요(작업 상세의 `canEdit` 와 같은 판단, 또는 403 이 짚은 줄) · 고를 수 있음. 앞의 넷은 체크를 끄고 잠근다. 테스트는 그 프로젝트 멤버 누구나라 403 이 짚을 때만 잠근다
- **409 · 403 · 422** — `IMPACT_STALE` 는 결과를 흐리고 '이전 결정으로 한 분석이에요 — [다시 분석]', 반영을 끈다(지금 판과 다른 분석과 같은 모양). `IMPACT_TARGET_CHANGED` · `FORBIDDEN` 은 `detail` 의 `tasks.N` · `tests.N` 을 보낸 순서로 짚어 그 줄만 잠그고 알림을 띄우지 않는다 — 나머지 줄은 바로 다시 반영할 수 있다. 422 는 알리고 줄 아래에 첫 까닭 한 줄
- **반영 뒤** — 바뀐 작업은 데이터 스토어의 작업을 통째로 갈아끼우고(그사이 프로젝트를 바꿨으면 넣지 않는다), 테스트는 테스트 스토어에 넣고, 둘 다 변경 이력 칸에 다시 부르라고 알린다. 분석은 응답의 `impact` 로 갈아끼운다
- **칩** — 작업 · 테스트 키 칩과 부딪히는 결정의 안건 칩은 그 상세 주소(`/tasks/:id` · `/tests/:id` · `/agendas/:id`)로 간다 — 안건 상세는 여러 화면이 띄워서 화면마다 이벤트를 잇지 않는다(`TaggedTests` 와 같은 길)
- **회의록 [등록] 뒤** — `updatedAgendas` 가운데 **결정내용 글이 바뀐 것만**(상태만 바꾼 것은 뺀다, 앞뒤 공백 뗀 글로 견줌) 칩으로 띄운다. 칩은 그 화면 안의 안건 상세를 열고 영향도 칸으로 스크롤한다. 다시 정리하거나 떠나면 지운다
- **목업** — 진행 줄 셋(`read_tasks` · `compare_decisions` · `propose_impact`), 살펴볼 것이 없으면 진행 줄 없이 빈 결과. 고칠 안은 본문이 있는 첫 연결 작업의 첫 줄(본문 있는 작업이 없으면 첫 작업의 제목) · 첫 닿는 테스트의 내용 끝 한 줄, 다른 결정 안건은 첫 것을 `check`. 반영 검사 순서 · `detail` 글 · 반영한 값 남기기 · 같은 자리 줄 id 잇기는 위 '구현에서 메운 것 (서버)' 와 같다. 반영한 작업은 사본을 내고 데이터 스토어가 넣는다(회의록 apply 와 같은 길), 테스트는 목업 서버의 일반 수정(`mockPatchTest`)을 탄다. 이미 반영한 줄을 다시 보내면 `appliedAt` 으로 대상 바뀜을 낸다(서버는 `before` 와 달라서 같은 409)

### 숨은 영향 (화면, 2026-11-10 고침)

- **타입** — `ImpactTask` · `ImpactTest` 에 `linked` · `linkedOnApply`, `ImpactApplyInput` 줄에 `link?`, `ImpactApplyResult` 에 `links` — 이름 · 모양은 위 '모양 (늘어나는 것)' 그대로. 읽을 때(`toImpact`) 두 칸이 없거나 불이 아니면 `linked: true` · `linkedOnApply: false` 로 채운다(1단계 분석). 반영 응답에 `links` 가 없으면 빈 배열로 읽는다
- **묶음** — 고칠 작업 · 고칠 테스트에 드는 줄은 `update` 줄 + **연결 안 된 `check` 줄**(`lib/impact` 의 `inReview`). 연결된 `check` · `ok` 만 접은 '살펴본 것' 에 남는다. 순서는 분석 순서 그대로 — 서버가 넣어 준 줄(seq 순) 다음에 찾은 줄(seq 순)을 싣는다. 찾은 줄이라도 `linked: true`(40개 상한 밖의 연결 작업)면 배지 · 연결 체크가 없고, 그 `check` 는 접은 '살펴본 것' 에 든다
- **연결 안 된 줄** — 키 칩 옆에 '연결 안 됨 · AI 가 찾음' 배지, 줄 아래 '[✓] 이 안건에 연결'(기본 켬, 반영 전 줄에만). 고칠 안이 있는 줄은 **줄 체크가 켜져 있을 때만** 연결을 고른다(줄을 끄면 연결 체크도 꺼져 보이고 잠긴다 — 연결만 보내는 길은 check 줄에만 둔다). 연결 안 된 `check` 줄은 왼쪽 줄 체크가 없고 '확인 필요' + 근거, [고치기] 없음 · [지우기] 있음 — **연결 체크가 곧 고름**이다
- **[반영 N건]** — N 은 보낼 줄 수(켠 `update` 줄 + 연결을 켠 check 줄). 고칠 안 줄에서 연결만 끄면 N 은 그대로다
- **보낼 모양** — 고칠 안 줄은 고친 칸 + (연결 안 된 줄이고 연결을 켰으면) `link: true`, 연결만 하는 줄은 `{ taskId | testId, link: true }` 하나(고칠 칸 없음). 연결을 끄면 `link` 칸을 아예 싣지 않는다. 미리 보는 검사: 연결만 하는 줄은 칸 검사 · '다른 칸이 없음' 을 보지 않는다, 이미 걸린 줄(`linked: true`)에 연결이 켜져 있으면 막는다(서버 422 `tasks.N.link` 를 미리 — 화면에서는 생기지 않는 길이다)
- **처지** — 연결만 하는 작업 줄도 작업 고치기 권한이 없으면 잠근다(연결 권한 = 작업 고치기 권한). 409 · 403 이 짚은 줄은 줄 체크와 연결 체크를 같이 끈다. [되돌리기] 는 둘 다 다시 켠다
- **반영 뒤** — 응답 `links` 를 데이터 스토어의 작업 ↔ 안건 링크에 더한다(이미 있으면 그대로, 그사이 프로젝트를 바꿨으면 넣지 않는다 — 작업과 같은 규칙). 태그를 건 테스트는 응답 `tests` 로 테스트 스토어에 넣는다(연결만 한 테스트도 `tests` 에 온다). 연결한 줄(`linkedOnApply`)은 '반영함 ✓ · 연결함'
- **진행 줄** — 화면은 늘 한 줄이다. 같은 글이 잇달아 와도 그대로 두어(`search_tasks` · `search_tests` 가 같은 '관련 작업 · 테스트 찾는 중') 깜빡이지 않는다
- **목업** — 결정 전 · 후의 **첫 줄**을 낱말(두 자 이상, 끝 조사 '로 · 으로 · 을 · 를 …' 를 뗀 것)로 쪼개 전에만 있는 낱말(옛 값)과 후에만 있는 낱말(새 값)을 차례로 짝짓는다. 결정 전이 없거나(처음 결정) 새 값이 없으면 찾지 않는다. 옛 값으로 그 프로젝트의 연결 안 된 작업(제목 · 본문 줄) · 닿지 않는 테스트(제목 · 내용 · 테스트 데이터)를 대소문자 없이 찾아 **처음 걸린 작업 하나를 `update`**(옛 값이 든 첫 본문 줄, 본문에 없으면 제목에서 옛 값 → 새 값) · **처음 걸린 테스트 하나를 `check`**(연결만) 로 낸다. 둘 다 `linked: false`, 넣어 준 줄 다음에 붙인다(서버 '결과 줄 순서'). 진행 줄은 서버와 같은 차례 — `read_tasks` → `compare_decisions` → (찾으면) `search_tasks` · `search_tests` → (작업을 찾았으면) `get_task` → `propose_impact`. 살펴볼 연결 작업 · 테스트 · 다른 결정이 없으면 1단계처럼 찾지도 않는다(Claude 를 부르지 않으니까)
- **목업 반영** — 고를 수 있는 줄 · 연결만 하는 줄의 비교 건너뛰기 · 검사 순서는 위 '`apply` (늘어나는 것)' 그대로. 고칠 칸 · `link` 짝의 422 자리 · 글은 서버(`_line_problems`)와 같다 — 걸린 줄에 연결 `tasks.N.link`, 확인 필요 줄에 고칠 칸 `tasks.N`, 연결 없는 확인 필요 줄 `tasks.N.link`, 고칠 칸도 연결도 없는 update 줄 `tasks.N`. 테스트 태그가 20개 차 있으면 태그 걸기의 400 `TEST_REF_LIMIT` 을 `detail` `tests.N.link` 로(서버처럼 409 검사 뒤 — 목업은 되돌릴 수 없어 바꾸기 전에 미리 본다). 작업 연결은 링크를 직접 걸지 않고 `links` 로 내 데이터 스토어가 더한다(작업 사본과 같은 길), 이미 걸려 있으면 `links` 에 싣지 않는다('새로 건' 것만), 작업 이력은 고친 칸 한 줄 · `agenda` 한 줄(링크 PUT 과 같은 몸통이라 따로). 테스트 태그는 목업 서버의 태그 걸기(`mockPutTestRef` — 이력 `agendaRef` · `basis_seq` 다시 찍기)를 탄다. 연결만 해도 '반영한 값 남기기' 규칙 그대로 — 안 보낸 고친 안 칸은 빠진다. 반영 응답의 `tasks` · `tests` 는 보낸 줄 전부(연결만 한 줄도 지금 값으로). `link` 가 `null` · `false` 면 보내지 않은 것과 같다. 연결만 한 줄을 다시 보내도 된다(분석 뒤 바뀜을 보지 않으니 200, `links` 는 빈다). 화면은 400 `TEST_REF_LIMIT` 을 422 처럼 알리고 그 줄 아래에 한 줄

# 회의록 — 합의 (2026-10-19, 2026-10-20 고침)

> 기획 배경은 `docs/agent-proposal.md` 4번 '회의 · 문서 → 업무'. 결정은 `docs/api/decisions.md` Q45 · Q46 · **Q48**(닫힘), Q47 은 2단계로 미룸(`API.md` 열린 질문).
> 이 파일은 **1단계(회의록 게시판 + 글 → 초안 → [등록])** 의 계약이다. 녹음 업로드는 2단계로 따로 세운다 — 아래 '2단계'.
> 순서는 `server/PLAN.md` 12단계 · `web/PLAN.md` 13단계, 고친 것은 그 단계의 '2026-10-20 고침'.

> **2026-10-20 고침 (Q48)** — 회의록을 **남긴다.** 게시판처럼 쓰고 · 읽고 · 고치고 · 지운다.
> AI 정리는 **저장된 회의록 하나**에서 [AI 정리] 로 부르고, 거기서 등록한 안건 · 이력 · 작업에는 **출처(`minutesId`)** 가 붙는다.
> 붙여넣은 글을 바로 정리하던 `POST /api/projects/{projectId}/minutes/draft` · `…/apply` 는 없어졌다.

회의록을 게시판에 올리고, 글마다 **[AI 정리]** 를 누르면 Claude 가 **새 안건 · 기존 안건에 붙일 이력 · 작업** 초안으로 나눠 보여 준다. 사람이 고르고 고친 뒤 **[등록]** 을 눌러야 저장된다.
회의록은 이력으로 남고, 거기서 나온 안건 · 이력 · 작업은 "어느 회의에서 나왔나" 를 되짚을 수 있다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 양식 | **맞추지 않는다.** 어떤 글이든 받고(표 · 개조식 · 메모 · 대화록), 나가는 모양만 정한다 | 회사마다 양식이 다르다. Claude 는 내용으로 읽는다 — 양식별 파서 · 템플릿 설정을 두지 않는다 (Q45) |
| 들어오는 것 | 1단계는 **글**(붙여넣기 · `.txt` · `.md`). 파일은 화면이 읽어 글로 보낸다 | `.docx` · `.pdf` 는 서버가 글을 뽑아야 해 1-2 로 미룬다 |
| 저장 | **사람이 [등록] 을 눌러야** — Claude 는 읽기만 한다. 등록은 **한 트랜잭션** | 챗봇 작업 초안과 같은 원칙(`chat.md` '작업 초안') |
| 원문 · 요약 | **남긴다** — 회의록 게시판(`minutes` 테이블). 요약은 [등록] 때 초안의 요약을 저장한다 | 회의록도 이력 관리가 필요하다 (Q48, Q46 을 뒤집음) |
| 출처 | AI 정리로 등록한 안건 · 이력 · 작업에 `minutesId`. 손으로 만든 것은 `null` | "이 결정이 어느 회의에서 나왔나" 를 되짚는다 |
| 쓰기 · 고치기 · 지우기 | 쓰기 · 읽기는 그 프로젝트 멤버 누구나. **고치기는 작성자만**, **지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자** | 작업 댓글과 같은 경계(`auth.md`) |
| 지우면 | 회의록만 지운다. 거기서 등록한 안건 · 이력 · 작업은 **남고 `minutesId` 만 `null`** 이 된다 | 결정 · 일은 회의록보다 오래 산다 |
| 다시 정리 | 같은 회의록에서 [AI 정리] 를 몇 번이고 다시 부를 수 있다. 이미 등록한 것은 상세의 '이 회의록에서 나온 것' 에 보여 겹쳐 등록하지 않게 한다 | 회의록을 고친 뒤 빠진 것을 더 등록하는 일이 있다 |
| 기존 안건 | 회의록의 안건이 이미 있으면 **새로 만들지 않고 그 안건에 이력을 붙이자고** 낸다 | 같은 안건이 둘로 갈라지면 결정 · 미룸 이력이 흩어진다 |
| 사람 | 멤버 목록(이름 · 파트)으로 Claude 가 id 를 잇는다. **모호하면 비우고** 회의록에서 부른 말을 `ownerHint` 로 남긴다 | "김 책임" · "서연님" 은 추측하면 틀린다. 사람이 고르는 게 빠르다 |
| 날짜 | 회의록에 회의 날짜가 있으면 그 날 기준, 없으면 오늘(KST) 기준으로 "다음 주 금요일" 을 바꾼다. 말하지 않은 기한은 채우지 않는다 | 챗봇 작업 초안과 같다 |
| 화면 | 챗봇이 아니라 **왼쪽 메뉴 '회의록'**(`/minutes`) | 회의록은 길고, 검토할 줄이 많다. 2단계 녹음 업로드도 여기에 얹는다 |
| AI 정리 · 등록 | 그 프로젝트 멤버 누구나 | 다른 쓰기와 같은 경계 |

## 흐름

1. `/minutes` 목록 → **[새 회의록]** — 제목 · 회의 날짜 · 본문(붙여넣기 · `.txt` · `.md`) → [저장]
2. 회의록 상세에서 **[AI 정리]** → `POST /api/minutes/{minutesId}/draft` — 저장된 본문으로 스트림, 진행 한 줄('기존 안건 찾는 중' …) 뒤 초안 하나
3. 검토 — 세 묶음(새 안건 · 기존 안건에 붙일 이력 · 작업)을 줄마다 체크로 고르고 고친다. 줄 아래에 `quote`
4. **[등록]** → `POST /api/minutes/{minutesId}/apply` → 만든 것에 출처가 붙고, 회의록 요약이 저장된다. 상세의 '이 회의록에서 나온 것' 에 칩으로 들어간다
5. 회의록을 고쳐 [AI 정리] 를 다시 누를 수 있다 — 초안은 서버가 들고 있지 않다

## 초안 — `MinutesDraft`

```ts
export interface MinutesDraft {
  /** 회의록에서 읽은 회의 날짜 YYYY-MM-DD. 못 읽으면 null — 날짜 기준이 오늘이었다는 표시 */
  meetingDate: string | null
  /** 회의 요약 서너 줄. 검토 화면 맨 위에만 보이고 남기지 않는다 */
  summary: string
  threads: ProposedThread[]
  entries: ProposedEntry[]
  tasks: ProposedMinutesTask[]
}

/** 새 안건 */
export interface ProposedThread {
  /** 이 초안 안에서만 쓰는 이름 — 'n1', 'n2' … */
  tempId: string
  title: string
  /** 배경. 없으면 '' */
  description: string
  /** 후보 선택지. 없으면 [] */
  options: string[]
  ownerId: string | null
  /** 회의록에서 담당을 부른 말("김 책임"). ownerId 를 못 정했을 때만, 없으면 '' */
  ownerHint: string
  /** 결정 기한 YYYY-MM-DD */
  dueDate: string | null
  /** 이 회의에서 정해졌거나 미뤄졌으면 그 이력. 등록만 된 안건이면 null */
  entry: ProposedEntryBody | null
  /** 근거 원문 — 회의록에서 그대로 옮긴 한두 문장 */
  quote: string
}

/** 이미 있는 안건에 붙일 이력 */
export interface ProposedEntry extends ProposedEntryBody {
  tempId: string          // 'e1', 'e2' …
  threadId: string        // 그 프로젝트의 안건
  quote: string
}

export interface ProposedEntryBody {
  kind: 'decide' | 'defer' | 'refine'
  /** 한 줄 — 결정이면 무엇으로, 미룸이면 무엇을 */
  text: string
  /** 조건별 상세. 없으면 [] */
  detail: string[]
  /** 왜 — 미룸이면 사유. 없으면 '' */
  note: string
  ownerId: string | null
  ownerHint: string
}

/** 작업 — 챗봇의 ProposedTask 에 안건 연결 · 근거가 붙었다 */
export interface ProposedMinutesTask extends ProposedTask {
  ownerHint: string
  /** 걸 안건 — 이 초안의 새 안건(tempId) · 이미 있는 안건(id). 둘 다 비면 안건 없이 */
  threadTempIds: string[]
  threadIds: string[]
  quote: string
}
```

- `ProposedTask` 는 `chat.md` 의 그것 그대로다(`tempId` · `parentTempId` · `parentId` · `title` · `ownerId` · `start` · `due` · `priority`). 작업 `tempId` 는 `t1`, `t2` …
- 세 종류의 `tempId` 는 초안 전체에서 서로 다르다(접두사 `n` · `e` · `t`)
- `kind` 는 화면이 이력에 쓰는 셋뿐이다. `change` · `split` 은 내지 않는다 — 결정을 바꾼 것도 `decide` 다

### 초안 검사 규칙

서버가 Claude 의 초안을 받을 때 보고, 틀리면 Claude 에게 돌려줘 고치게 한다(챗봇 `propose_tasks` 와 같다). `apply` 도 같은 규칙을 다시 본다.

- 개수 — 새 안건 0 ~ 20 · 이력 0 ~ 20 · 작업 0 ~ 30, **셋 합이 1 이상**
- `title` · `text` 는 앞뒤 공백을 떼고 비지 않는다. `options` · `detail` 의 빈 줄은 뺀다
- `ownerId` 는 기존 안건 등록 · 이력 · 작업과 같은 담당자 검사를 받는다. `ownerHint` 는 `ownerId` 가 null 일 때만 채운다
- `threadId` · `threadIds` 는 그 프로젝트의 안건, `threadTempIds` 는 이 초안의 새 안건
- 작업 규칙은 `tasks/batch` 그대로 — `parentTempId` 는 자기보다 앞의 작업, `parentId` 와 같이 쓰지 않는다, `start ≤ due`
- 한 안건에 이력은 **하나**까지(같은 `threadId` 둘 금지). 새 안건과 기존 안건이 같은 것을 가리키면 Claude 가 기존 쪽으로 낸다 — 서버는 막지 못한다

## 게시판 — `Minutes`

```
minutes
  id · project_id → project(cascade)
  title         1 ~ 200자 (앞뒤 공백 뗀 뒤)
  meeting_date  date, null 가능
  body          1 ~ 60,000자 (앞뒤 공백 뗀 뒤). 글 그대로 — 양식을 건드리지 않는다
  summary       '' 가 기본. [등록] 때 초안의 요약으로 바뀐다
  author_id → member
  created_at · updated_at · seq (Identity, unique)
index (project_id, seq)

thread.minutes_id · entry.minutes_id · task.minutes_id   → minutes(id) ON DELETE SET NULL, null 가능
```

- `minutes_id` 는 같은 프로젝트의 회의록만 가리킨다 — `apply` 가 늘 그 회의록의 프로젝트에서 만들므로 어긋날 길이 없다(복합 FK 는 두지 않는다. `SET NULL` 이 `project_id` 까지 비우려 들어서)
- 기존 줄은 마이그레이션이 `null` 로 둔다 — 데이터를 건드리지 않는다

```ts
/** 목록 한 줄 — 본문 · 요약 없이 */
export interface MinutesItem {
  id: string
  projectId: string
  title: string
  /** YYYY-MM-DD */
  meetingDate: string | null
  authorId: string
  /** ISO 8601 UTC, Z */
  createdAt: string
  updatedAt: string
}

export interface Minutes extends MinutesItem {
  body: string
  /** 없으면 '' */
  summary: string
}

export interface MinutesInput {
  title: string
  meetingDate: string | null
  body: string
}

// 늘어나는 칸 — 스냅샷에 실린다
export interface Thread { /* … */ minutesId: string | null }
export interface Entry  { /* … */ minutesId: string | null }
export interface Task   { /* … */ minutesId: string | null }
```

- `null` 이 나갈 수 있는 이름에 `MinutesItem.meetingDate` · `Thread.minutesId` · `Entry.minutesId` · `Task.minutesId` 가 는다(`snapshot.md`)
- 목록은 **그 프로젝트의 회의록 전부**, 회의 날짜 내림차순(없으면 맨 뒤) → `seq` 내림차순. 거르기 · 찾기는 화면이 한다
- '이 회의록에서 나온 것' 은 화면이 스냅샷을 `minutesId` 로 걸러 그린다 — 따로 API 가 없다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/minutes` | 목록 | `MinutesItem[]` |
| POST | `/api/projects/{projectId}/minutes` | 쓰기 — `MinutesInput`. 작성자는 로그인한 사람 | `Minutes` · 201 |
| GET | `/api/minutes/{minutesId}` | 읽기 | `Minutes` |
| PATCH | `/api/minutes/{minutesId}` | 고치기 — `MinutesInput` 의 보낸 칸만. **작성자만** | `Minutes` |
| DELETE | `/api/minutes/{minutesId}` | 지우기 — 작성자 · 프로젝트 관리자 · 시스템 관리자. 출처를 단 줄들은 `minutesId` 가 `null` 로 | 204 |
| POST | `/api/minutes/{minutesId}/draft` | **저장된 본문**으로 초안. 본문 없음. Claude 도구 루프, 저장하지 않는다 | `text/event-stream` (`MinutesEvent`) |
| POST | `/api/minutes/{minutesId}/apply` | 고른 초안을 한 번에 등록 — `MinutesApplyInput`. **한 트랜잭션**. 만든 것에 `minutesId` | `MinutesApplyResult` · 201 |

- 프로젝트 경계는 다른 API 와 같다 — `/api/minutes/{minutesId}…` 는 회의록의 프로젝트로 본다(남의 것은 404 `MINUTES_NOT_FOUND`)
- 고치기 · 지우기를 못 하는 사람은 403 `FORBIDDEN`. 고친 시각은 `updatedAt`
- 회의록을 고쳐도 이미 등록한 것은 그대로다. 앞 초안의 `quote` 가 고친 본문에 없을 수 있다

### `draft` — 스트림

챗봇 · 리스크 AI 요약과 같은 SSE 틀이다(`event:` 줄이 `type`, 스트림 전 오류는 `ApiErrorBody`).

- Claude 에게는 회의록의 **제목 · 회의 날짜 · 본문**을 준다. `meetingDate` 가 있으면 날짜 기준은 그것이고, 초안의 `meetingDate` 도 그 값이다. 없으면 지금처럼 본문에서 읽는다

```ts
export type MinutesEvent =
  /** 지금 하는 일 한 줄 — '기존 안건 찾는 중' · '멤버 확인 중' · '초안 만드는 중' */
  | { type: 'tool'; name: string; label: string }
  /** 초안. 꼭 한 번, done 보다 먼저 */
  | { type: 'draft'; draft: MinutesDraft }
  | { type: 'done' }
  /** 스트림이 열린 뒤의 실패. 이것이 오면 draft · done 은 안 온다 */
  | { type: 'error'; code: string; message: string }
```

- Claude 가 쥐는 도구 — 읽기는 챗봇의 것을 다시 쓴다(`search_threads` · `get_thread` · `search_tasks` · `list_members`), 내기는 **`propose_minutes`** 하나. `propose_minutes` 를 검사에 통과시키면 `draft` 를 내고 끝낸다
- 정리할 것이 없으면(안건 · 이력 · 작업 0개) `error` `MINUTES_EMPTY` — "회의록에서 정할 것 · 할 일을 찾지 못했습니다"
- 도구를 여러 번 고쳐도 통과 못 하면(5번) `error` `MINUTES_DRAFT_FAILED`
- 모델 · 분당 제한 · 키 없음은 챗봇과 같다(`chat_model`, 429 `CHAT_RATE_LIMITED`, 503 `CHAT_UNAVAILABLE`, 거절 `CHAT_REFUSED`)

### `apply` — 등록

```ts
export interface MinutesApplyInput {
  /** 회의록에 저장할 요약 — 초안의 summary 를 그대로(고쳐도 된다). 안 보내면 지금 요약 그대로 */
  summary?: string
  /** 화면에서 고르고 고친 것만. 모양은 초안 그대로, quote · ownerHint 는 실어 와도 버린다 */
  threads: ProposedThread[]
  entries: ProposedEntry[]
  tasks: ProposedMinutesTask[]
}

export interface MinutesApplyResult {
  /** 요청 순서 그대로 */
  threads: Thread[]
  /** 새 안건의 이력 + 기존 안건의 이력. 새 안건 것 먼저, 각각 요청 순서 */
  entries: Entry[]
  /** 이력 때문에 상태가 바뀐 기존 안건 */
  updatedThreads: Thread[]
  tasks: Task[]
  links: TaskThreadLink[]
  threadIdByTempId: Record<string, string>
  taskIdByTempId: Record<string, string>
}
```

- 만든 안건 · 이력(새 안건의 것 · 기존 안건의 것 모두) · 작업에 **`minutesId` = 그 회의록**. 기존 안건 자체에는 붙이지 않는다
- 만드는 순서: 새 안건(`queued`, 파트는 공통 `null`) → 그 이력 → 기존 안건의 이력 → 작업(`todo`, 본문 `[]`, `key` 배열 순 발번) → 작업 ↔ 안건 링크
- 이력이 상태를 바꾸는 규칙은 `POST /api/threads/{threadId}/entries` 와 같다 — `decide` 면 `decided`, 그 밖은 `queued` 면 `open`
- 이력의 `createdAt` 은 등록하는 지금이다(회의 날짜가 아니다) — 다른 이력과 같은 규칙
- 화면이 새 안건을 빼면 그 `tempId` 를 가리키는 `threadTempIds` 도 화면이 지우고 보낸다. 남아 있으면 422
- 오류: 404 `MINUTES_NOT_FOUND` · 422 `VALIDATION_ERROR`(`detail` 은 `threads.N.title` · `entries.N.threadId` · `tasks.N.threadTempIds.0` 처럼 자리를 짚는다 — `tasks/batch` 의 표기를 넓힌다) · 400 `THREAD_NOT_FOUND`(`entries.N.threadId` · `tasks.N.threadIds.M`) · 400 `THREAD_OWNER_NOT_FOUND` · `ENTRY_OWNER_NOT_FOUND` · `TASK_OWNER_NOT_FOUND`(그 자리의 `….ownerId`, 기존 등록 · 이력과 같은 코드 · 같은 경계) · 400 `TASK_PARENT_NOT_FOUND` · 400 `TASK_DEPTH_EXCEEDED`(작업은 4단까지 · Q64, `tasks.N.parentTempId` · `tasks.N.parentId`)
- 하나라도 틀리면 아무것도 안 남는다. 발번한 작업 번호도 되돌린다

### 구현 (2026-10-19, 서버)

계약이 비워 둔 자리는 이렇게 정했다. 화면이 불편하면 새 Q 로 다시 연다.

- 셋 다 0개인 `apply` 는 422, `detail` 자리는 **`요청`**(어느 묶음의 자리가 아니라서 — 오류 처리기가 요청 전체에 쓰는 이름). 개수 초과는 `threads` · `entries` · `tasks`
- 400 이 여럿 걸리면 **하나만** 낸다 — 순서는 `THREAD_NOT_FOUND` → `THREAD_OWNER_NOT_FOUND` → `ENTRY_OWNER_NOT_FOUND` → `TASK_OWNER_NOT_FOUND` → `TASK_PARENT_NOT_FOUND` → `TASK_DEPTH_EXCEEDED`(422 가 늘 먼저, 마지막 것은 Q64 로 더했다). `detail` 에는 그 코드에 걸린 자리를 다 싣는다. `propose_minutes` 는 전부를 한 번에 Claude 에게 돌려준다
- `ownerHint` 는 `ownerId` 가 있으면 **오류가 아니라 비운다**(초안에서도) — `apply` 는 어차피 버린다
- `tempId` 는 세 묶음 전체에서 겹치면 422(`….tempId`). 접두사(`n` · `e` · `t`)는 검사하지 않는다 — Claude 에게 프롬프트로만 시킨다. 새 안건의 `tempId` 를 작업의 `parentTempId` 로 쓰면 422
- 이력의 담당자는 그 안건 담당자를 그대로 적으면 검사하지 않는다(`POST .../entries` 와 같은 경계). 새 안건의 이력도 그 새 안건의 담당자와 같으면 같다
- `updatedThreads` 는 이력 때문에 **상태나 담당자**가 바뀐 기존 안건이다 — `decide` 가 이미 정해진 안건의 담당자만 바꿀 때도 실린다
- 한 작업의 `threadTempIds` · `threadIds` 가 같은 안건을 두 번 가리키면 링크는 하나다
- `draft` 는 Claude 를 많아야 10번 부른다. 다 써도 초안이 없으면 `MINUTES_DRAFT_FAILED`. Claude 가 초안 없이 글로 끝내면 초안을 내라고 다시 시키고 그것도 실패 한 번으로 센다. 출력이 잘리면(`max_tokens`) 다시 부르지 않고 `MINUTES_DRAFT_FAILED`
- `tool` 라벨: `search_threads` '"낱말" 기존 안건 찾는 중' · `get_thread` '안건 이력 읽는 중' · `search_tasks` '"낱말" 기존 작업 찾는 중' · `list_members` '멤버 확인 중' · `propose_minutes` '초안 만드는 중'

### 구현 (2026-10-20 고침, 서버)

계약이 비워 둔 자리는 이렇게 정했다. 화면이 불편하면 새 Q 로 다시 연다.

- `title` · `body` 는 앞뒤 공백을 뗀 값을 **저장한다**(안쪽 줄 · 들여쓰기는 그대로). 시드 `m1` 은 예시 글 그대로(끝 줄바꿈 포함)
- `POST` 의 `meetingDate` 는 빠져도 `null` 로 받는다. `PATCH` 의 `title` · `body` 에 `null` 은 422, `meetingDate: null` 은 비우기. 보낸 칸이 하나도 없으면 `updatedAt` 을 안 바꾼다
- `apply` 의 `summary` — `null` 은 안 보낸 것과 같다. 앞뒤 공백을 떼고, 상한은 본문과 같은 60,000자(넘으면 422 `summary`). 요약을 저장해도 **`updatedAt` 은 그대로** — '고친 시각' 은 사람이 글을 고친 때다. 등록이 실패하면 요약도 안 남는다
- `draft` 가 Claude 에게 주는 사용자 메시지는 `제목: …` · `회의 날짜: YYYY-MM-DD`(없으면 `(적혀 있지 않음)`) · 빈 줄 · 본문이다
- 시드 `m1` 의 `createdAt` · `updatedAt` 은 `2026-10-16T06:30:00Z`(회의가 끝난 15:30 KST)

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `MINUTES_NOT_FOUND` | 경로의 회의록이 없음 (부여받지 않은 프로젝트의 것도 같다) |
| 403 | `FORBIDDEN` | 작성자가 아닌데 고침 · 작성자 · 관리자가 아닌데 지움 |
| 422 | `VALIDATION_ERROR` | `title` 이 비었거나 200자 넘음 · `body` 가 비었거나 60,000자 넘음 · `meetingDate` 형식 · `apply` 검사 규칙 위반 |
| 스트림 | `MINUTES_EMPTY` | 회의록에서 정리할 것을 못 찾음 |
| 스트림 | `MINUTES_DRAFT_FAILED` | 초안이 검사를 끝내 통과하지 못함 |

## Claude 에게 주는 것 (서버가 정한다)

- 시스템 프롬프트: 오늘(KST) · 프로젝트 이름 · **멤버 목록(id · 이름 · 파트)** · 아래 규칙
- 회의록은 사용자 메시지 하나로. 60,000자면 대략 1시간 반 회의다
- 규칙
  - 정해진 것 → `decide`, "다음에 다시" · "확인 후" → `defer`(사유를 `note`), 범위를 좁히거나 조건을 더한 것 → `refine`
  - 아직 안 정했고 다음에 정해야 할 것 → 새 안건(`entry: null`). 후보가 말로 나오면 `options`
  - 누가 하기로 한 일 → 작업. 어느 안건의 결정에서 나온 일이면 그 안건에 건다
  - 새 안건을 내기 전에 `search_threads` 로 **이미 있는지 먼저 본다**
  - 회의록에 없는 것을 지어내지 않는다. `quote` 는 회의록 글자 그대로
  - 사람 이름이 멤버에 없거나 여럿에 걸리면 `ownerId: null` + `ownerHint`

## 시드 · 목업

- 시드 · 목업 회의록 하나 — `m1` · p1 · 작성자 u1 · 제목 `10월 셋째 주 주간 회의` · `meetingDate` `2026-10-16` · 본문은 화면의 예시 회의록 글(`web/src/fixtures/minutes.ts` 의 `MINUTES_EXAMPLE`) 글자 그대로 · 요약 `''` · 출처를 단 줄 없음. 시연에서 [AI 정리] 를 바로 누를 수 있다
- 목업 `draft` 는 **들어온 글과 상관없이** 고정 초안 하나를 진행 줄 둘과 함께 흘린다(`web/src/fixtures/minutes.ts`). p1 기준 — 새 안건 2(하나는 미룸 이력) · 기존 안건 `t3` 에 미룸 이력 1 · 작업 3(하나는 새 안건에, 하나는 `t2` 에 걸림, 하나는 `ownerHint` 만)
- 목업 `apply` 는 서버와 같은 검사 · 같은 생성 순서를 데이터 스토어에 한다
- 회의록 예시 글은 [새 회의록] 의 [예시 넣기] 로도 둔다 — 시연용

## 화면 (프론트가 정할 것의 테두리)

- **왼쪽 메뉴 '회의록'** (`/minutes`, '확인 요청' 다음)
- **목록** `/minutes` — 게시판 표: 회의 날짜 · 제목 · 작성자 · 나온 것 수(스냅샷에서 센 안건 · 이력 · 작업) · 고친 날. 제목 찾기 칸(화면이 거른다). **[새 회의록]**
- **쓰기 · 고치기** `/minutes/new` · `/minutes/:minutesId/edit` — 제목 · 회의 날짜 · 큰 본문 칸 + [파일 열기](`.txt` · `.md`) + [예시 넣기] + 글자 수 / 60,000 → [저장]. 쓰다 나가면 확인
- **상세** `/minutes/:minutesId` — 제목 · 회의 날짜 · 작성자 · 고친 시각 · [고치기](작성자만) · [지우기](작성자 · 관리자, 확인 창에 "여기서 나온 N건은 남습니다")
  - 요약(있으면) · 본문(글 그대로, 줄바꿈 살림)
  - **이 회의록에서 나온 것** — 안건 · 이력 · 작업 칩(누르면 상세). 없으면 "아직 정리하지 않았어요"
  - **[AI 정리]** — 아래 검토가 상세 안에서 펼쳐진다. 이미 나온 것이 있으면 버튼은 [다시 정리]
- **정리 중** — 진행 한 줄(`tool.label`), [멈추기](스트림을 끊는다, 아무것도 안 남는다)
- **검토** — 맨 위 요약 · 회의 날짜(못 읽었으면 "날짜를 못 읽어 오늘 기준으로 바꿨어요")
  - 묶음 셋: **새 안건 · 기존 안건에 붙일 이력 · 작업**. 줄마다 체크(기본 켬) · 고칠 수 있는 칸 · 근거(`quote`, 흐리게)
  - `ownerHint` 가 있으면 담당 칸에 "회의록: 김 책임 — 골라 주세요"
  - 새 안건 체크를 끄면 거기 걸린 작업에 "안건 연결이 빠집니다" 를 띄운다
  - **[등록 N건]** — 켜진 줄 수. 등록하면 검토가 닫히고 '이 회의록에서 나온 것' 이 는다
- 검토 중 나가면 초안을 잃는다는 확인 — 서버가 들고 있지 않다
- **안건 상세 이력 · 작업 상세** — `minutesId` 가 있으면 '회의록에서' 칩 → 그 회의록 상세

## 확장 — 파일 첨부 (아직 계약 아님)

본문은 글이다. `.docx` · `.pdf` · 녹음 파일을 붙이게 되면 `minutes_file`(minutes_id · 이름 · 위치 · 크기)을 더하고, 뽑은 글을 `body` 에 채운다 — 정리는 늘 `body` 로만 한다.
그래서 **`quote` 는 본문 글자 그대로**여야 한다 — 나중에 본문에서 그 자리를 짚는 열쇠가 된다.

## 2단계 — 녹음 업로드 (아직 계약 아님)

테두리만 적어 둔다. **Q47(녹음을 외부 음성 인식으로 보내도 되나)** 은 2단계를 시작할 때 정한다.

- 녹음 → 음성 인식(화자 구분) → **대화록 글** → 회의록 `body` 로 저장 → [AI 정리]. 1단계 흐름을 바꾸지 않는다
- 음성 인식은 바꿔 끼울 수 있게 한 겹 둔다 — 후보: 클로바 스피치 · OpenAI 음성 인식 · 사내 Whisper
- 화자 '화자 1 · 2' 를 멤버에 잇는 한 단계(사람이)
- 길어서 비동기다 — 업로드 → 작업 id → 진행 상태 → 끝나면 대화록. 녹음 파일은 위 '확장' 의 `minutes_file` 에 얹는다

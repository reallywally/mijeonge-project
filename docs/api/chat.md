# AI 챗봇

`../../API.md` 의 엔드포인트 표가 가리키는 모양의 자세한 절이다.

## AI 챗봇 — 합의 (2026-10-11)

오른쪽 아래 팝업에서 "서버 OS 뭐로 하기로 했지?" 같은 질문에 **저장된 안건 · 이력 · 작업을 찾아** 답한다.
서버가 Claude 에게 검색 도구를 쥐여 주고, Claude 가 검색어를 바꿔 가며 찾고 읽은 뒤 답한다.
화면은 질문을 보내고 스트림을 받아 그리기만 한다.

### 요청 — `ChatInput`

```ts
/** POST /api/projects/{projectId}/chat */
export interface ChatInput {
  /** 오래된 것 → 새 것. 마지막은 늘 user 다. 서버는 대화를 저장하지 않고, 화면은 창을 닫으면 비운다 (Q26) */
  messages: ChatMessage[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** 화면에 보인 글 그대로. 근거 표시(`[[thread:ID]]`)도 지우지 않고 돌려보낸다 */
  text: string
}
```

- `messages` 는 1 ~ 20개, `text` 하나는 질문(`user`) 2,000자 · 답(`assistant`) 20,000자까지 (넘으면 422 `VALIDATION_ERROR`). 답은 화면에 보인 그대로 돌려보내므로 질문보다 넉넉하다
- 마지막이 `user` 가 아니거나 `text` 가 공백뿐이면 422

### 응답 — SSE 스트림 (`ChatEvent`)

`Content-Type: text/event-stream`. 한 이벤트는 `event: <type>` 줄과 `data: <JSON>` 줄이다.
`EventSource` 는 GET 만 되므로 화면은 `fetch` 로 받아 직접 읽는다.

```ts
export type ChatEvent =
  /** 답 글자 조각. 이어 붙이면 답 전체다 */
  | { type: 'delta'; text: string }
  /** 지금 무엇을 찾는 중인지 — '"OS" 안건 찾는 중' 같은 한 줄을 띄우는 데 쓴다 */
  | { type: 'tool'; name: 'search_threads' | 'get_thread' | 'search_tasks' | 'get_task'; label: string }
  /** 끝. 답에 실제로 나온 근거만 모은다 — 화면이 칩을 그릴 때 스냅샷에 없는 id 를 거르는 데 쓴다 */
  | { type: 'done'; refs: ChatRef[] }
  /** 스트림이 열린 뒤의 실패. 이것이 오면 done 은 안 온다 */
  | { type: 'error'; code: string; message: string }

export interface ChatRef {
  kind: 'thread' | 'task'
  id: string
}
```

### 근거 표시 — 답 본문 안의 `[[kind:id]]`

- 답 본문에 `[[thread:ID]]` · `[[task:ID]]` 가 섞여 온다. 화면은 이것을 **링크 칩**으로 바꿔 그린다
  (안건이면 제목 + 상태 배지, 작업이면 `key` + 제목). 누르면 기존 상세 팝업을 연다
- id 는 스냅샷의 id 그대로다. 스냅샷에 없는 id 면 칩 대신 아무것도 안 그린다 (지어낸 id 를 보이지 않는다)
- 서버는 이 표시를 지우거나 바꾸지 않는다 — `done.refs` 는 본문에서 뽑은 목록일 뿐이다

### 답하는 규칙 (서버가 시스템 프롬프트로 지킨다)

- **결정이 바뀐 안건은 마지막 `decide` · `change` 줄이 지금의 결정이다.** 바뀐 적이 있으면 그 흐름도 짧게 같이 말한다
- 안건이 `decided` 가 아니면 "아직 안 정해졌다" 고 말하고, 미룬 횟수 · 마지막 미룸 사유를 같이 준다
- 찾지 못하면 **지어내지 않고** 못 찾았다고 말한다. 비슷한 안건이 있으면 그것을 근거로 붙인다
- 경로의 `projectId` 밖은 찾지 않는다 (Q13 · Q16 과 같은 경계)

### 검색 — `SearchResult` — 구현 (2026-10-11)

`GET /api/projects/{projectId}/search?q=<검색어>&limit=<기본 10>`. 챗봇의 `search_threads` · `search_tasks`
도구가 부르는 서비스 함수를 그대로 연 것이다. 글자 일부만 맞아도 찾는다(trigram 유사도).

```ts
export interface SearchResult {
  threads: ThreadHit[]
  tasks: TaskHit[]
}

export interface ThreadHit {
  id: string
  title: string
  state: ThreadState
  /** 무엇이 맞았나 — 제목 · 배경 · 후보 · 이력 중 하나. 이력이면 그 줄의 글 */
  matched: 'title' | 'description' | 'option' | 'entry'
  snippet: string
  /** 마지막 decide · change 줄의 text. 없으면 '' */
  decision: string
}

export interface TaskHit {
  id: string
  key: string
  title: string
  status: TaskStatus
  matched: 'title' | 'body'
  snippet: string
}
```

- 점수가 높은 순. 같은 점수면 `seq` 오름차순 — 같은 데이터면 늘 같은 순서다
- 빈 결과는 `{ threads: [], tasks: [] }` 이고 404 가 아니다

계약이 비워 둔 자리는 구현하며 이렇게 정했다 (2026-10-11 · 서버). 화면이 아직 안 부르는 엔드포인트라
지금 고르고, 화면이 부르게 되어 불편하면 새 Q 로 다시 연다.

- **빈 `q` 는 422 `VALIDATION_ERROR`** 다 — 앞뒤 공백을 떼고 비면(`q=` · `q=%20`) `detail.q` 에
  '검색어를 입력해 주세요.' 가 실린다. `q` 를 아예 빼도 422 다. 빈 검색어로 '전부' 를 내지 않는다 —
  목록은 스냅샷이 이미 준다. `q` 는 200자까지(넘으면 422)
- **`limit` 은 1 ~ 50, 기본 10.** `threads` · `tasks` 에 **따로** 걸린다(둘을 합쳐 자르지 않는다)
- 없는 `projectId` 는 404 `PROJECT_NOT_FOUND` — 스냅샷과 같다
- 한 안건 · 작업은 **한 번만** 나온다. 여러 자리가 맞으면 점수가 가장 높은 자리가 `matched` 고,
  같은 점수면 제목 → 배경 → 후보 → 이력(작업은 제목 → 본문) 순으로 고른다
- `matched: 'entry'` 는 이력 줄의 `text` · `note` · `detail` 중 하나가 맞은 것이고, `snippet` 은 **맞은 그 글**이다.
  `snippet` 은 줄바꿈을 공백으로 편 한 줄이고, 80자가 넘으면 맞은 자리 둘레 80자를 잘라 앞뒤에 `…` 를 붙인다
- 점수는 `pg_trgm` 의 `word_similarity(q, 글)` 이다. 검색어가 글 안에 그대로 들어 있으면(대소문자 무시)
  최소 0.9 로 올린다 — 한국어는 조사가 붙어(`미룸이다`) 낱말 유사도만으로는 0.67 에 그친다.
  **0.5 미만은 안 낸다.** 점수 자체는 응답에 싣지 않는다

### 프론트 검토 (2026-10-11)

초안을 `web/src/types/domain.ts` · `src/api/client.ts` · `stores/thread.ts` · `stores/task.ts` · `App.vue` 와
맞춰 봤다. **계약을 고칠 자리는 없다** — 두 엔드포인트 모두 `합의` 로 올린다. 아래는 프론트가 계약을 어떻게
읽고 쓰는지다. 서버가 보기에 틀린 해석이 있으면 새 Q 로 다시 연다.

- **타입** — `ThreadHit.state` 는 `ThreadState`, `TaskHit.status` 는 `TaskStatus` 그대로라 새 이름이 없다.
  id 는 전부 스냅샷의 문자열 id 다. `domain.ts` 에는 화면이 쓰는 넷(`ChatInput` · `ChatMessage` · `ChatEvent` ·
  `ChatRef`)만 계약 모양 그대로 옮긴다(`web/PLAN.md` 7-2). `SearchResult` · `ThreadHit` · `TaskHit` 는 화면이
  아직 안 부르므로 부르는 화면이 생길 때 옮긴다
- **스트림 전 오류** — 본문이 `ApiErrorBody` 그대로라 `request` 와 같은 판정(`isErrorBody` → `ApiError`,
  모양이 아닌 5xx → `SERVER_UNREACHABLE`)을 `src/api/chat.ts` 가 그대로 쓴다. 429 · 503 도 `code` 로 가른다
- **스트림 중 오류** — `error` 이벤트의 `{ code, message }` 를 `new ApiError(res.status, { code, message })` 로
  감싸 던진다. 이때 `status` 는 200 이라 화면은 **`status` 가 아니라 `code` 로만** 가른다
- **이벤트 종류** — 프론트는 **`event:` 줄을 `type` 으로 읽는다.** `data` JSON 에 `type` 이 같이 있어도 되고
  없어도 된다. `:` 로 시작하는 줄(keep-alive)과 모르는 `event` 는 건너뛴다. `tool` 은 `label` 만 띄우고
  `name` 으로 가르지 않는다 — 도구가 늘어도 화면이 안 깨진다
- **`done` 도 `error` 도 없이 끝난 스트림**은 끊긴 것으로 보고 `SERVER_UNREACHABLE` 로 다룬다
- **보내는 대화** — `done` 으로 끝난 턴만 다음 `messages` 에 싣는다. 실패했거나 멈춘 턴은 user · assistant 둘 다
  뺀다 — 빈 assistant(422)와 user 가 둘 잇따르는 일이 생기지 않는다. 20개를 넘으면 오래된 것부터 버리고
  **첫 줄이 user 가 되게** 자른다
- **근거 칩** — 안건 칩(제목 + `ThreadStateBadge`, 미룬 횟수 포함)과 작업 칩(`key` + 제목)에 필요한 것은
  전부 스냅샷에 있다 — `thread` · `task` 스토어에서 id 로 찾는다. 스냅샷에 없는 id(지어낸 id, 그리고 스냅샷을
  받은 뒤 다른 사람이 만든 것)는 안 그린다. 칩의 상태는 **화면이 들고 있는 스냅샷 기준**이다.
  받는 중에 아직 닫히지 않은 `[[…` 꼬리는 글로 내보이지 않고 닫힐 때까지 미룬다
- `done.refs` 는 본문에서 다시 뽑을 수 있어 화면이 꼭 기대지는 않는다 — 본문 파싱(`lib/chat.ts`)이 기준이다
- **전제** — 이 합의는 Q26 의 초안(대화를 서버에 안 남긴다)을 깔고 있다. Q26 이 '남긴다' 로 닫히면
  `ChatInput` 이 바뀌므로 `POST .../chat` 은 `초안` 으로 되돌린다. Q25 · Q27 은 화면에 닿지 않는다
  → **Q26 은 '안 남긴다 · 창을 닫으면 끝' 으로 닫혔다(2026-10-11). 합의는 그대로 선다**

## AI 챗봇 — 작업 초안 — 합의 (2026-10-12)

"간담회 준비 작업 만들어줘. 김서연한테 일정체크, 박지훈한테 준비물 체크" 처럼 말하면 챗봇이
**초안을 보여 주고, 사람이 [등록] 을 눌러야 저장된다.** 챗봇은 어떤 경우에도 직접 저장하지 않는다 —
초안 도구는 DB 를 읽기만 하고, 저장은 화면이 아래 `POST .../tasks/batch` 로 한다.

### 흐름

1. Claude 가 `list_members` 로 이름을 id 로 바꾸고, `propose_tasks` 로 초안을 낸다
2. 서버가 초안을 검사한다(아래 규칙). 틀리면 도구 결과로 Claude 에게 돌려줘 고치게 하고, 맞으면
   스트림에 `proposal` 이벤트를 한 번 낸다. 한 답에 초안은 **많아야 하나** — 두 번 부르면 마지막 것만 낸다
3. 화면은 그 답 말풍선 안에 미리보기 카드를 그린다 — [취소] · [등록]
4. 고치고 싶으면 채팅으로 말한다("박지훈 말고 정하늘로"). 새 답이 새 초안을 내고, **이전 카드는 화면이
   `cancelled` 로 접는다**(대기 중인 카드는 늘 하나다). 카드 안에서 직접 고치는 것은 이번 범위 밖이다
5. [등록] → `POST /api/projects/{projectId}/tasks/batch` → 화면 스토어에 작업을 넣고 카드를 작업 칩으로 바꾼다.
   같은 카드는 두 번 등록되지 않는다(누르는 동안 버튼을 막고, 끝나면 `registered`)

### 초안 — `TaskProposal`

```ts
export interface TaskProposal {
  /** 배열 순서 = 등록 순서 = 화면 순서. 평평한 목록이다 — 초안 안끼리의 상위 · 하위는 없다 (Q61) */
  tasks: ProposedTask[]
}

export interface ProposedTask {
  /** 이 초안 안에서만 쓰는 임시 이름 — 't1', 't2' … */
  tempId: string
  /** 이미 있는 작업과 관련된 초안일 때 그 작업의 id — 등록하면 새 작업 → 그 작업 연관 한 줄이 걸린다.
      없으면 null (2026-10-27, Q61. 그 전의 parentTempId · parentId 를 대신한다) */
  relatedId: string | null
  title: string
  ownerId: string | null
  /** YYYY-MM-DD. 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  priority: 'low' | 'normal' | 'high'
}
```

**검사 규칙**(서버가 `propose_tasks` 에서, 그리고 `tasks/batch` 에서 똑같이 본다)
- 1 ~ 20개. `tempId` 는 서로 다르다
- `title` 은 앞뒤 공백을 떼고 비지 않는다. `ownerId` 는 있는 멤버다. `start ≤ due`(둘 다 있을 때)
- `relatedId` 는 **그 프로젝트의** 이미 있는 작업이다(아니면 400 `TASK_RELATED_NOT_FOUND`, `detail` 은 `tasks.N.relatedId`).
  파트는 따르지 않는다 — 안 보내면 공통(`null`)

### 스트림에 늘어난 것 — `ChatEvent`

```ts
  /** 작업 초안. 한 답에 많아야 하나, done 보다 먼저 온다 */
  | { type: 'proposal'; proposal: TaskProposal }
```

`tool` 이벤트의 `name` 에 `'list_members' | 'propose_tasks'` 가 늘어난다(라벨 예: '멤버 확인 중', '작업 초안 만드는 중').

### 요청에 늘어난 것 — `ChatMessage.proposal`

서버는 대화를 저장하지 않으므로(Q26) 화면이 지난 초안과 그 결과를 돌려보낸다. 그래야 "정하늘로 바꿔줘" ·
"방금 만든 것에 하나 더" 를 알아듣는다.

```ts
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** assistant 에만. 그 답이 낸 초안과 화면에서의 결과 */
  proposal?: TaskProposal & {
    status: 'pending' | 'registered' | 'cancelled'
    /** registered 일 때만 — tempId → 저장된 작업 key(MG-7) */
    keyByTempId?: Record<string, string>
  }
}
```

- `user` 에 `proposal` 이 오면 422 `VALIDATION_ERROR`
- 서버는 이것을 Claude 에게 넘길 때 그 assistant 답 뒤에 글로 덧붙인다 — 형식은 서버가 정한다

### 한 번에 등록 — `POST /api/projects/{projectId}/tasks/batch`

```ts
/** 요청 */
export interface TaskBatchInput {
  tasks: ProposedTask[]   // 초안 그대로 보낸다. 상태는 todo, 본문은 빈 배열로 만든다
}
/** 201 응답 */
export interface TaskBatchResult {
  /** 요청 순서 그대로 */
  tasks: Task[]
  taskIdByTempId: Record<string, string>
}
```

- **한 트랜잭션**이다 — 하나라도 틀리면 아무것도 안 남는다. `key` 는 배열 순서대로 발번한다
- 오류: 없는 프로젝트 404 `PROJECT_NOT_FOUND`, 검사 규칙 위반은 422 `VALIDATION_ERROR`(`detail` 에
  `tasks.1.title` 처럼 몇 번째의 어느 칸인지), 없는 멤버는 400 `TASK_OWNER_NOT_FOUND`, 없는 연관 작업은 400 `TASK_RELATED_NOT_FOUND`
- 구현 (2026-10-12, 서버) — `detail` 의 자리 이름: 개수(0개 · 21개 이상)는 `tasks`, `start > due` 는
  `tasks.N.due`, 날짜 형식 · `priority` 같은 타입 오류도 `tasks.N.칸` 이다. 없는 멤버의 400 에도 `detail` 이
  `tasks.N.ownerId` 로 붙는다. 검사가 끝난 뒤에만 쓰고, 쓰다 터지면 발번한 번호까지 되돌린다.
  `title` 은 앞뒤 공백을 떼고 저장한다. **이 `tasks.N.칸` 표기는 `tasks/batch` 에만 쓴다** — 다른 자리의
  `detail` 은 지금처럼 마지막 필드 이름이다

### 답하는 규칙에 늘어난 것

- 작업을 만들어 달라는 말에는 **초안만 낸다.** 답 본문은 짧게 — "아래처럼 등록할까요?" 정도. "등록했다" 고 말하지 않는다
- 이름이 멤버에 없거나 여럿에 걸리면 **초안을 내지 않고 되묻는다**
- 초안은 평평한 목록이다 — 상위 · 하위로 묶지 않는다(Q61). 이미 있는 작업과 관련된 할 일이면 `relatedId` 에 그 작업 id 를 둔다
- 날짜("다음 주 금요일")는 오늘(KST) 기준으로 바꾼다 — 서버가 시스템 프롬프트에 오늘 날짜를 넣는다. 말하지 않은 기간 · 우선순위는 채우지 않는다(null · normal)
- 경로의 `projectId` 안에만 만든다

## AI 챗봇 — 작업 언급 `@HW-4` (2026-10-14)

질문에서 작업 하나를 콕 집는다. **요청 · 응답 모양은 그대로다** — `ChatMessage.text` 안의 글자로만 오간다.

- **화면** — 입력칸에서 `@` 를 치면 지금 프로젝트의 작업이 뜬다(키가 친 글로 시작하는 것 먼저,
  그다음 키 · 제목에 든 것, 8개까지). ↑↓ 로 옮기고 Enter · Tab · 누르기로 고르면 `@HW-4 ` 가 들어간다.
  목록이 떠 있을 때 Enter 는 보내지 않고, Esc 는 목록만 닫는다 (`web/src/lib/mention.ts`)
- **서버** — 질문(`role: user`)의 `@키` 를 그 프로젝트의 작업으로 찾아 질문 뒤에
  `[@ 로 가리킨 작업]` 기록(id · 키 · 제목 · 상태)을 붙여 Claude 에게 넘긴다. Claude 는 검색 없이 `get_task` 로 읽는다.
  다른 프로젝트의 키 · 없는 키는 `이 프로젝트에 없다` 로 넘긴다 — 있는지조차 알려 주지 않는다
- 키의 모양은 `@` + 접두사(영문으로 시작, 8자까지) + `-` + 번호. 대소문자를 가리지 않는다.
  앞이 영숫자 · `.` · `@` 면(이메일) 언급이 아니다. 뒤에 조사가 바로 붙어도(`@HW-4는`) 언급이다
- `get_task` 도구의 `task_id` 는 작업 키도 받는다 — 사용자가 `@` 없이 `HW-4` 라고 말해도 읽는다

## AI 챗봇 — 이미 있는 작업에 연관된 작업 초안 (2026-10-14, 2026-10-27 고침 — Q61)

"@HW-20 분석해서 필요한 작업 하위에 추가해줘" 를 처리한다. 저장은 여전히 사람이 [등록] 으로 한다.

1. Claude 가 `get_task` 로 그 작업을 읽는다 — 제목 · 본문 · 걸어 둔 안건에 더해 **`related`(이 작업이 건 연관 작업)
   · `relatedBy`(이 작업을 건 작업)** 의 id · 키 · 제목 · 상태가 있다(`children` 을 대신한다). 걸린 안건의 결정이 할 일을 정하면 `get_thread` 로 읽는다
2. 그 작업을 끝내는 데 필요한데 `related` · `relatedBy` 에 아직 없는 할 일만, `relatedId` = 그 작업의 id 로 초안을 낸다.
   왜 그렇게 나눴는지 한두 줄로 먼저 말한다
3. 화면의 초안 카드는 `relatedId` 가 있는 줄에 '연관: HW-20' 정도를 밝힌다(들여쓰기 없음)

## AI 챗봇 — 중복 · 비슷한 작업 찾기 (2026-10-14)

"이 프로젝트에서 중복되거나 비슷한 작업 찾아줘" · "@HW-20 이랑 겹치는 작업 있어?" 를 처리한다. 읽기만 한다 —
합치거나 지우는 것은 화면에서 사람이 한다. 요청 · 응답 모양은 그대로고, `tool` 이벤트의 `name` 에 둘이 는다.

| 도구 | 하는 일 | 화면 라벨 |
| --- | --- | --- |
| `list_tasks` | 프로젝트 작업 전체를 한 줄씩(id · key · title · status · relatedKeys(이 작업이 건 연관 작업 키 목록) · owner — 담당자 이름). 번호 순, 본문 없음. `status` 로 거를 수 있다. 300개 넘으면 앞에서 자르고 `truncated: true` | 작업 목록 보는 중 |
| `find_similar_tasks` | 제목끼리 · (제목 + 본문)끼리 `pg_trgm` 유사도가 0.3 이상인 작업 쌍을 점수 순으로(기본 20, 최대 30). `taskId`(id 나 키)를 주면 그 작업이 낀 쌍만. 쌍마다 `relation`: `related`(어느 한쪽이 다른 쪽을 연관으로 걸었음) · `null` | 비슷한 작업 찾는 중 |

- 글자 유사도라 **뜻만 같은 것**(예: '계정 발급' ↔ '계정 배포')은 못 잡는다 — 그래서 Claude 가 `list_tasks` 로 제목을 훑어 보탠다
- `find_similar_tasks` 는 모든 쌍을 견준다(작업 수의 제곱). 수백 개까지를 생각한 것이다
- 답하는 규칙: 후보는 `get_task` 로 본문을 읽고 판단하고, 못 읽은 것은 "제목만 봤다" 고 밝힌다.
  이미 연관으로 걸린 쌍(`related`)은 사람이 알고 있는 관계다 — 중복이라 단정하지 않는다. "중복 가능성 높음" · "확인 필요" 로 나누고 근거를 붙인다
- 도구 고르기를 시스템 프롬프트에 적었다 — 낱말 · 주제는 `search_tasks`, 전체를 훑을 때는 `list_tasks`,
  중복은 `find_similar_tasks`, 하나를 자세히는 `get_task`
- 함께 고친 것: 답은 존댓말로만, 영어 문장 · "찾아보겠습니다" 같은 진행 중계를 쓰지 않는다

## AI 챗봇 — 결정 리스크 (2026-10-15)

"뭐가 위험해?" · "이번 주 뭐부터 정해야 해?" 를 처리한다. 계약 · 계산은 `docs/api/risk.md` 의 '챗봇 도구 — `get_decision_risks`'.
요청 · 응답 모양은 그대로고, `tool` 이벤트의 `name` 에 하나가 는다 — 화면은 `label` 만 띄우므로 **계약 변경은 없다**.

| 도구 | 하는 일 | 화면 라벨 |
| --- | --- | --- |
| `get_decision_risks` | `GET .../risks` 와 같은 계산(`DecisionRiskReport`). `member_id` · `part_id` 를 주면 `threads` · `tasks` 를 그 사람 · 파트로 거른다(`owners` 는 그대로). `part_id` 에는 파트 이름도 넣을 수 있다 | 결정 리스크 보는 중 |

- 답하는 규칙: 리스크 · 막힘 · 우선순위 질문에 먼저 부르고, `high` 부터 왜 · 무엇이 막히나 · 다음 할 일을 근거 표시와 함께 말한다.
  '풀어도 됨'(`decidedButBlocked`)은 풀어도 된다고 말하되 바꾸지 않는다. 숫자는 도구가 준 그대로, 신호는 화면의 말로
- 지금 도구 전체: `search_threads` · `get_thread` · `search_tasks` · `get_task` · `list_tasks` · `find_similar_tasks` ·
  `get_decision_risks` · `list_members` · `propose_tasks`

# 안건(Agenda) — 간소화 합의 (2026-11-04)

> **2026-11-05 — 참조(`ccIds`)를 되살렸다** (`cc.md`). 아래에서 '참조를 걷는다' 고 적은 자리는 그 파일이 대신한다 —
> `Agenda.ccIds: string[]`(담당자 바로 뒤) · `AgendaInput.ccIds?` · `AgendaPatch.ccIds?`(통째로, `null` 422) · 400 `AGENDA_CC_NOT_FOUND` ·
> 이력 칸 `ccIds`(`ownerId` 바로 뒤) · 확인 요청 받는 사람 = 연결 작업 담당자 + 참조.

안건을 **제목 · 설명 · 결정내용 · 상태** 네 칸으로 줄이고, 영어 이름을 `thread` 에서 `agenda` 로 바꾼다.
화면의 한국어 '안건' 은 그대로다. 이 파일이 안건 계약의 정답이고, 다른 문서의 `Thread` · `Entry` ·
`DecisionItem` 설명은 이 파일로 대체된다(옛 줄은 결정 로그에 남는다).

## 정해 둔 것 (사용자, 2026-11-04)

| | 결정 |
| --- | --- |
| 이름 | **전부 바꾼다** — DB 테이블 · 컬럼, API 경로, JSON 키, 에러 code, 서버 · 프론트 코드 · 파일 이름, 화면 라우트, 챗봇 도구 이름 · 근거 표시. `thread` → `agenda`, `Thread` → `Agenda`, `threadId` → `agendaId`, `threads` → `agendas` |
| 입력 칸 | **제목 · 설명 · 결정내용 · 상태** 넷. 담당자 · 기한 · 파트는 **남긴다**(속성 패널 · 리스크 · 파트 거르기가 쓴다) |
| 걷어내는 것 | 후보(`options`) · 참조(`ccIds`) · 상위 안건(`parentThreadId`, 떼어낸 하위 안건) · 결정 항목(`DecisionItem`) · 이력 줄(`Entry` · `EntryDetail`, 결정 · 미룸 · 세부 · 바꾸기 · 떼어냄) — 테이블째 지운다 |
| 상태 | `queued`(대기) · `open`(논의중) · `decided`(결정) 셋. **사람이 직접 고른다** — 이력에서 세지 않는다 |
| 지난 결정 | 항목마다 지금 유효한 결정(세부 포함)을 이어 붙여 `decision` 에 넣고 이력 테이블은 지운다(아래 '이행') |

## 모양

```ts
export type AgendaState = 'queued' | 'open' | 'decided'

export interface Agenda {
  id: string
  projectId: string
  title: string
  /** 배경 — 왜 정해야 하나. 빈 값은 '' */
  description: string
  /** 결정내용 — 여러 줄 글. 빈 값은 '' */
  decision: string
  state: AgendaState
  ownerId: string | null
  /** 참조 — 고른 순서, 빈 값은 [] (2026-11-05, cc.md) */
  ccIds: string[]
  /** 등록한 사람. 기록이 없던 지난 안건은 null — 수정 · 삭제 권한의 근거 */
  creatorId: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
  /** null 이면 프로젝트 공통 */
  partId: string | null
  /** ISO 8601 UTC, Z */
  createdAt: string
  /** state 가 decided 로 바뀐 시각(ISO UTC Z). decided 가 아니면 null */
  decidedAt: string | null
  /** 결정 판 번호 — 0 부터. 아래 '결정 판' */
  decisionRev: number
  /** AI 정리로 등록한 회의록. 손으로 만든 것은 null */
  minutesId: string | null
}

export interface AgendaInput {   // POST
  title: string                  // 필수, 앞뒤 공백 떼고 1자 이상
  description?: string
  decision?: string
  state?: AgendaState            // 기본 'queued'
  ownerId?: string | null
  ccIds?: string[]               // 기본 [] (2026-11-05)
  dueDate?: string | null
  partId?: string | null
}

export interface AgendaPatch {   // PATCH — 보낸 필드만
  title?: string                 // 빈 값 · null 422
  description?: string           // null 422
  decision?: string              // null 422
  state?: AgendaState            // null 422
  ownerId?: string | null
  ccIds?: string[]               // 통째로 갈아끼운다. null 422 (2026-11-05)
  dueDate?: string | null
  partId?: string | null
}
```

- `decidedAt` — `state` 가 `decided` 가 아닌 것에서 `decided` 로 바뀔 때 지금 시각을 찍고, `decided` 에서 벗어나면 `null`. 등록 때 `decided` 면 등록 시각
- **결정 판(`decisionRev`)** — `decision` 글이 바뀌거나(앞뒤 공백 뗀 값으로 비교) `state` 가 `decided` 로 바뀔 때 1 오른다(한 요청에 둘 다면 1만). 확인 요청이 '이 결정' 을 가리키는 자리다. 서버만 올린다 — 보내도 무시
- 결정내용이 비어도 `decided` 로 둘 수 있다(검사하지 않는다)

## 엔드포인트 (바뀐 것)

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| POST | `/api/projects/{projectId}/agendas` | 등록. `creatorId` 는 요청한 사람. 변경 이력 `created` | `Agenda` · 201 |
| PATCH | `/api/agendas/{agendaId}` | 부분 수정 — 위 `AgendaPatch`. **생성자 · 담당자 · 프로젝트 관리자 · 시스템 관리자만**(403 `FORBIDDEN`, 지금 규칙 그대로). 바뀐 칸은 변경 이력에 | `Agenda` |
| DELETE | `/api/agendas/{agendaId}` | 논리 삭제(지금 규칙 그대로, 하위 안건이 없어 409 는 없어진다) | 204 |
| GET | `/api/agendas/{agendaId}/history` | 변경 이력 | `HistoryEntry[]` |
| PUT · DELETE | `/api/tasks/{taskId}/agendas/{agendaId}` | 작업 ↔ 안건 링크 | 링크 · 204 |
| POST | `/api/agendas/{agendaId}/checks` | 확인 요청 보내기(아래) | `CheckRequest[]` · 201 |
| PUT · DELETE | `/api/tests/{testId}/refs/agenda/{refId}` | 테스트 참조 태그 — `kind` 가 `'thread'` → `'agenda'` | `TestCase` · 204 |

**없어지는 것** — `/api/threads/{id}/entries` (POST · PATCH · DELETE), `/api/threads/{id}/items` (POST · PATCH · DELETE).

## 에러 code

| 옛 | 새 |
| --- | --- |
| `THREAD_NOT_FOUND` | `AGENDA_NOT_FOUND` |
| `TASK_THREAD_LINK_OTHER_PROJECT` | `TASK_AGENDA_LINK_OTHER_PROJECT` |
| `THREAD_PARENT_NOT_FOUND` · `THREAD_PARENT_OTHER_PROJECT` · `THREAD_HAS_CHILDREN` · `ENTRY_NOT_FOUND` · `ENTRY_ITEM_REQUIRED` · `ITEM_NOT_FOUND` | 없어진다 |
| 그 밖에 `THREAD` 가 들어간 code | `THREAD` → `AGENDA` |

## 스냅샷

`ProjectSnapshot` 의 `threads` → `agendas`, `taskThreadLinks` → `taskAgendaLinks`(`{ taskId, agendaId }`).
**`decisionItems` · `entries` 키는 빠진다.** 정렬 · 거르기(지운 안건 빠짐)는 그대로.
작업 쪽 JSON 의 `threadIds`(작업 등록) → `agendaIds`.

## 변경 이력 칸 — 안건 (`agenda_history`)

| `field` | 언제 | `from` · `to` |
| --- | --- | --- |
| `created` · `deleted` | 등록 · 회의록 반영 / 삭제 | `null` · `null` |
| `title` · `description` · `decision` | PATCH · 회의록 반영 | 글 |
| `state` | PATCH · 회의록 반영 | `queued` · `open` · `decided` |
| `ownerId` | PATCH | id 또는 `null` |
| `ccIds` (2026-11-05) | PATCH | id 배열(고른 순서) |
| `partId` | PATCH | id 또는 `null` |
| `dueDate` | PATCH | `YYYY-MM-DD` 또는 `null` |

- 한 줄 안의 칸 순서는 위 표 순서. 값이 같으면 안 남긴다
- 결정이 언제 어떻게 바뀌었는지는 **이 이력이 유일한 기록**이다(이력 줄이 없어졌다)
- 이행 전에 남은 옛 줄의 칸(`options` · `ccIds` · `entryText` · `entryNote` · `entryDeleted` · `itemCreated` · `itemTitle` · `itemDeleted`)은 DB 에 그대로 둔다. **화면은 모르는 칸을 그리지 않고 건너뛴다**
- 화면 칸 이름: 제목 · 설명 · 결정내용 · 상태 · 담당자 · 참조(2026-11-05) · 파트 · 기한

## 따라 바뀌는 기능

| 기능 | 바뀌는 것 |
| --- | --- |
| 확인 요청 (`check.md`) | `CheckRequest.threadId` → `agendaId`, `entryId` → **`decisionRev: number`** + **`decision: string`**(보낼 때 결정내용을 찍어 둔다). 보내기는 `state === 'decided'` 일 때만(아니면 지금의 '결정 안 됨' 409 code 를 `AGENDA` 로 바꿔 쓴다), **한 결정 판에 한 번** — 유니크 `(agenda_id, decision_rev, recipient_id)`. 받는 사람은 **연결 작업 담당자(나 빼고)** — 참조가 없어졌다(→ 2026-11-05 참조를 되살려 **연결 작업 담당자 + 참조**, `cc.md`). 받을 사람이 없으면 지금 code 그대로. 부하 칸 `load_open_threads` → `load_open_agendas` |
| 리스크 (`risk.md`) | `threads` → `agendas`, `ThreadRisk` → `AgendaRisk`(`agendaId`), 요약 요청 `threadIds` → `agendaIds`. **미룸이 없어져 `deferredRepeatedly` 신호 · `deferCount` · `lastDeferNote` · 기준의 `deferCount` 가 빠진다** |
| 리포트 (`report.md`) | 지난 7일 '정해진 것' = `decidedAt` 이 기간 안인 안건. '미뤄진 것' 은 빠진다. 그 밖 `thread` 이름은 `agenda` 로. 근거 칩 `[[agenda:ID]]` |
| 테스트 기준 바뀜 (`test.md`) | 닿는 안건의 '결정 변경' = `agenda_history` 에서 `decision` 칸이 있거나 `state` 가 `decided` 로 바뀐 줄. `basis_seq` 는 그 줄들의 `seq` 최댓값. `changedEntryIds` → **`changedAgendaIds: string[]`**(basis 뒤로 결정이 바뀐 안건, 처음 바뀐 순). 화면은 그 안건의 지금 결정내용을 보인다 |
| 회의록 AI 정리 (`minutes.md`) | 초안 `threads` → `agendas`: `{ tempId, title, description, decision, state, ownerId, dueDate, partId }`. 옛 `entries`(기존 안건 이력) → **`updates: { agendaId, decision, state }[]`** — 기존 안건의 결정내용을 **통째로 갈아끼운다**(AI 가 `get_agenda` 로 지금 결정내용을 읽고 합친 글을 낸다). 반영은 PATCH 와 같은 이력을 남긴다. 결과 `entries` · `updatedThreads` → `updatedAgendas`, `threadIdByTempId` → `agendaIdByTempId`, 작업 초안 `threadTempIds` · `threadIds` → `agendaTempIds` · `agendaIds`. `itemTitle` 은 빠진다 |
| 챗봇 · 검색 (`chat.md`) | 도구 `search_threads` · `get_thread` → `search_agendas` · `get_agenda`(제목 · 설명 · 결정내용 · 상태 · 담당자 · 기한 · 파트 · 연결 작업). 검색 대상은 안건의 제목 · 설명 · 결정내용과 작업. 결과 `kind: 'thread'` → `'agenda'`. 근거 표시 `[[thread:ID]]` → `[[agenda:ID]]` — **프론트는 저장된 옛 리포트 · 대화를 위해 `[[thread:ID]]` 도 같은 칩으로 읽는다** |
| 권한 (`auth.md`) | 안건 규칙 그대로(고치기 · 지우기 = 생성자 · 담당자 · 프로젝트 관리자 · 시스템 관리자). 이력 줄 · 항목 권한은 없어진다 — **결정내용 · 상태를 바꾸는 것도 PATCH 라 같은 넷만 된다** |

## 이행 (리비전 `0032_agenda`)

1. `thread.decision`(text, `''`) · `decided_at` · `decision_rev`(int, 0) 를 더한다
2. 결정내용 채우기 — 안건마다 지우지 않은 항목을 `sort_order` 순으로, 항목마다 **지금 유효한 결정**(지우지 않은 `decide` · `change` 중 `seq` 가 가장 큰 줄의 `text`, 그 줄의 `entry_detail` 은 `- ` 줄로, 그 뒤의 `refine` 줄도 `- ` 줄로)을 만든다. 항목이 하나고 이름이 안건 제목과 같으면 결정 글만, 아니면 `항목명: 결정` 줄로 시작한다. 항목 사이는 빈 줄. 정해진 것이 없는 항목은 건너뛴다
3. `decided_at` = 상태가 `decided` 면 위에서 쓴 결정 줄 중 가장 늦은 `created_at`. `decision_rev` = 그 안건의 확인 요청이 가리킨 서로 다른 `entry_id` 수와 (결정내용이 있으면 1) 중 큰 값
4. `check_request` — `decision_rev`(안건마다 `entry` 의 `seq` 순으로 1, 2, … — 마지막 것이 안건의 `decision_rev`) · `decision`(그 줄의 `text`) 을 채우고 `entry_id` 를 지운다. 유니크를 `(agenda_id, decision_rev, recipient_id)` 로
5. 테스트 `basis_seq` — 이행 직후 **기준 바뀜이 있던 테스트는 계속 있고, 없던 테스트는 계속 없게** 맞춘다(서버가 방법을 고르고 '구현에서 메운 것' 에 적는다)
6. `thread_option` · `thread_cc` · `decision_item` · `entry_detail` · `entry` 테이블과 `thread.parent_thread_id`, `risk_setting` 의 미룸 문턱 칸을 지운다
7. 이름 바꾸기 — `thread` → `agenda`, `thread_history` → `agenda_history`, `task_thread_link` → `task_agenda_link`, 모든 `thread_id` 컬럼 → `agenda_id`, 인덱스 · 제약 이름도. `test_ref` 의 `kind` 값 · 컬럼도
8. downgrade 는 이름 · 칸만 되돌린다(지운 이력은 못 되살린다 — 주석으로 적는다)

## 시드 · 목업

서버 시드와 `web/src/fixtures` 는 지금처럼 **값 · 배열 순서까지 같게** 맞춘다. 결정내용은 위 이행 규칙으로 만든 글을 그대로 쓴다.

| 안건 | `state` | `decision` (줄바꿈은 `\n`) | `decidedAt` | `decisionRev` |
| --- | --- | --- | --- | --- |
| `t1` | `decided` | `우분투 최신 버전으로 한다` | `2026-09-09T02:00:00Z` | 1 |
| `t2` | `decided` | `mysql 을 쓴다\n- postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다\n- supabase 는 비용 때문에 뺀다` | `2026-09-10T06:05:00Z` | 1 |
| `t3` | `open` | `''` | `null` | 0 |
| `t4` | `queued` | `''` | `null` | 0 |
| `t5` | `open` | `요청(in) 항목: 계약번호 · 상품코드 · 가입일 셋을 넘긴다` | `null` | 1 |
| `t6` | `decided` | `테스트 기간: 전체 일정은 그대로 두고 테스트 기간만 2주 줄인다\n- 늘어난 개발 기간은 그대로 둔다\n- 통합 테스트를 3주에서 1주로 줄인다\n\n전체 일정: 전체 일정은 미루지 않는다` | `2026-09-15T07:00:00Z` | 1 |
| `t7` · `t8` · `t9` · `t10` | `queued` | `''` | `null` | 0 |

- 변경 이력 — 안건마다 `created` 한 줄(`hh-<id>-1`) 뒤에, 결정내용이 있는 넷(`t1` → `t2` → `t5` → `t6`)에 이행이 채운 줄 `hh-<id>-2`(`backfilled: true`, `[{ field: 'decision', from: '', to: <결정내용> }]`, 바꾼 사람 · 때 = 결정 줄을 남긴 사람 · 시각 — `t1` u3 `2026-09-09T02:00:00Z` · `t2` u3 `2026-09-10T06:05:00Z` · `t5` u4 `2026-09-10T07:00:00Z` · `t6` u1 `2026-09-15T07:00:00Z`). seq 는 등록 줄 1 ~ 10 다음 11 ~ 14
- 확인 요청 `c1` ~ `c3` 은 `t2` 의 판 1 · `decision: 'mysql 을 쓴다'`, `c4` 는 `t1` 의 판 1 · `decision: '우분투 최신 버전으로 한다'`(옛 줄의 `text` — 세부는 없다). id · 보낸 사람 · 받는 사람 · 시각은 그대로(`check.md` '시드 · 목업')
- 테스트 `basis_seq` — tc2 12 · tc3 `null` · tc4 11 · tc6 `null`(tc4 만 기준 바뀜 `['t2']`, `test.md`)

## 구현에서 메운 것 (2026-11-04, 서버)

계약이 비워 둔 자리는 이렇게 정했다. 화면이 불편하면 새 Q 로 다시 연다.

- **등록의 결정 시각 · 판** — 빈 안건(대기 · 결정내용 없음)에서 바뀐 것으로 본다. `decided` 로 등록하면 `decidedAt = createdAt` · 판 1, 결정내용만 적어도 판 1. 회의록 반영으로 만든 안건도 같다(`services/agenda.py` 의 `apply_fields` 하나)
- **공백** — 제목은 앞뒤 공백을 떼고 저장한다. 결정내용은 **보낸 그대로** 저장하고 판을 올릴지만 뗀 값으로 견준다(공백만 바꿔도 이력의 `decision` 칸은 남는다). 회의록 반영의 결정내용은 앞뒤 공백을 떼고 넣는다
- **PATCH 의 422** — `title` · `description` · `decision` · `state` 에 `null`, 세 값 밖의 `state`. 서버가 정하는 `creatorId` · `decidedAt` · `decisionRev` 와 걷은 `options` · `parentAgendaId` 는 실어 와도 버린다(등록도 같다). ~~`ccIds`~~ 는 2026-11-05 부터 받는다(`cc.md`). 담당자 · 파트 검사는 그대로(`AGENDA_OWNER_NOT_FOUND` · `PART_NOT_FOUND` · `PART_ARCHIVED`)
- **걷은 경로** — `/api/agendas/{id}/entries…` · `…/items…` · 옛 `/api/threads…` 는 404(경로가 없다)
- **변경 이력** — 등록(손 · 회의록 반영)은 `created` 한 줄뿐이다. 결정내용 · 상태를 같이 적어 등록해도 칸으로 나누지 않는다
- **이행 2** — '항목이 하나' 는 지우지 않은 항목 수, 이름은 앞뒤 공백을 떼고 견준다. `refine` 의 세부(`entry_detail`)도 그 `refine` 줄 밑에 `- ` 줄로 붙인다. 지운 안건도 같은 규칙으로 채운다(안 보일 뿐)
- **이행 3** — '결정 줄' 은 결정내용에 쓴 `decide` · `change` 줄이다(`refine` 은 안 든다). `decided` 인데 쓴 결정 줄이 없으면(항목을 다 지운 경우) `decidedAt` 은 안건 등록 시각 — `decided` 면 시각이 늘 있게
- **이행 4** — `check_request.decision` 은 그 줄의 `text` 만(세부 없이). 지운 줄을 가리킨 요청도 같은 순번을 받는다
- **이행 5 — 테스트 기준을 지키는 방법**: 지우지 않은 `decide` · `change` 줄이 있던 안건(지운 안건은 빼고)마다 `agenda_history` 에 `backfilled` 줄 하나 — `[{ field: 'decision', from: '', to: <결정내용> }]`, 바꾼 사람 · 때 = 결정내용에 쓴 결정 줄 중 가장 늦은 것(없으면 마지막 결정 줄). **넣는 순서는 그 안건의 옛 마지막 결정 줄 `seq` 순**이라, 테스트마다 '옛 규칙으로 바뀜이 없던 닿는 안건' 의 새 줄 `seq` 최댓값을 `basis_seq` 로 두면 바뀜이 있던 안건만 그 뒤에 선다(그런 안건이 없으면 바뀜 있던 테스트는 0, 없던 테스트는 `null`). 옛 규칙이 항목을 보지 않았으니 지운 항목의 결정 줄도 '바뀜' 으로 센다 — 그런 안건은 결정내용이 `''` 여도 줄이 선다
- **이행 7** — 이력 JSON 의 칸 이름도 바꾼다: `task_history` 의 `thread` → `agenda`, `test_history` 의 `threadRef` → `agendaRef`. 저장한 리포트(`project_report.facts`)의 `decidedThreadIds` · `deferredThreadIds` · `riskyThreadIds` → `…AgendaIds`, `weight.threadCount` → `agendaCount`. 리포트 본문 · 지난 대화의 `[[thread:ID]]` 는 글이라 그대로 둔다(프론트가 같은 칩으로 읽는다). 시퀀스 이름(`thread_seq_seq` …)도 바꾼다
- **이행 8** — downgrade 는 걷은 표를 빈 채로 다시 세우고, 이행이 넣은 '결정내용' 줄을 거두고, 테스트 `basis_seq` 를 비우고(셀 이력 줄이 없다), 미룸 문턱을 2 로 채운다. 확인 요청은 가리킬 이력 줄이 없어 지운다

## 화면 (프론트)

- 라우트 `/threads…` → `/agendas…`. 컴포넌트 · 스토어 · api 파일 이름도 `Agenda…`
- **등록 다이얼로그** — 상세와 같은 모양: 왼쪽 제목 · 설명 · 결정내용, 오른쪽 속성 패널(상태 · 결정 기한 · 담당자 · 파트). 한꺼번에 POST 로 보낸다(2026-11-05 사용자 — 전엔 네 칸만 받고 나머지는 등록 후 상세에서)
- **상세** — 왼쪽: 제목 · 설명 · 결정내용(여러 줄 글) 을 고치는 칸, 오른쪽 속성 패널: 상태(선택 상자) · 담당자 · 기한 · 파트. 결정 영역(항목 · 결정 · 미룸 · 세부 폼) · 하위 안건 · 이력 줄은 걷어낸다. 연결 작업 · 테스트 칩 · 확인 요청(결정일 때) · 변경 이력은 그대로
- **목록** — 상태 배지 · 결정내용 첫 줄 미리보기. '1/2' · 미룬 횟수 · 마지막 기록 칸은 빠진다

# 안건(Agenda) — 간소화 합의 (2026-11-04)

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
  dueDate?: string | null
  partId?: string | null
}

export interface AgendaPatch {   // PATCH — 보낸 필드만
  title?: string                 // 빈 값 · null 422
  description?: string           // null 422
  decision?: string              // null 422
  state?: AgendaState            // null 422
  ownerId?: string | null
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
| `ownerId` · `partId` | PATCH | id 또는 `null` |
| `dueDate` | PATCH | `YYYY-MM-DD` 또는 `null` |

- 한 줄 안의 칸 순서는 위 표 순서. 값이 같으면 안 남긴다
- 결정이 언제 어떻게 바뀌었는지는 **이 이력이 유일한 기록**이다(이력 줄이 없어졌다)
- 이행 전에 남은 옛 줄의 칸(`options` · `ccIds` · `entryText` · `entryNote` · `entryDeleted` · `itemCreated` · `itemTitle` · `itemDeleted`)은 DB 에 그대로 둔다. **화면은 모르는 칸을 그리지 않고 건너뛴다**
- 화면 칸 이름: 제목 · 설명 · 결정내용 · 상태 · 담당자 · 파트 · 기한

## 따라 바뀌는 기능

| 기능 | 바뀌는 것 |
| --- | --- |
| 확인 요청 (`check.md`) | `CheckRequest.threadId` → `agendaId`, `entryId` → **`decisionRev: number`** + **`decision: string`**(보낼 때 결정내용을 찍어 둔다). 보내기는 `state === 'decided'` 일 때만(아니면 지금의 '결정 안 됨' 409 code 를 `AGENDA` 로 바꿔 쓴다), **한 결정 판에 한 번** — 유니크 `(agenda_id, decision_rev, recipient_id)`. 받는 사람은 **연결 작업 담당자(나 빼고)** — 참조가 없어졌다. 받을 사람이 없으면 지금 code 그대로. 부하 칸 `load_open_threads` → `load_open_agendas` |
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

## 화면 (프론트)

- 라우트 `/threads…` → `/agendas…`. 컴포넌트 · 스토어 · api 파일 이름도 `Agenda…`
- **등록 다이얼로그** — 제목 · 설명 · 결정내용 · 상태 넷(담당자 · 기한 · 파트는 등록 후 상세의 속성 패널에서)
- **상세** — 왼쪽: 제목 · 설명 · 결정내용(여러 줄 글) 을 고치는 칸, 오른쪽 속성 패널: 상태(선택 상자) · 담당자 · 기한 · 파트. 결정 영역(항목 · 결정 · 미룸 · 세부 폼) · 하위 안건 · 이력 줄은 걷어낸다. 연결 작업 · 테스트 칩 · 확인 요청(결정일 때) · 변경 이력은 그대로
- **목록** — 상태 배지 · 결정내용 첫 줄 미리보기. '1/2' · 미룬 횟수 · 마지막 기록 칸은 빠진다

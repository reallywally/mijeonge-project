# API 계약

프론트(`web/`)와 서버(`server/`)가 맺은 계약이다. 두 에이전트는 서로 직접 말하지 못한다 —
주고받는 말은 전부 이 문서를 거친다. 세션이 끝나도 남는 자리다.

- 제품 결정의 정답은 `memo.md`, 화면이 쓰는 모양의 정답은 `web/src/types/domain.ts` 다.
  이 문서는 **그 둘 사이에서 오간 합의와 아직 안 풀린 것**만 적는다
- 계약을 바꾸는 일은 **코드보다 여기가 먼저다**
- 무엇을 어떤 순서로 만들지는 `server/PLAN.md` · `web/PLAN.md` 가 갖는다

## 공통 규칙

| | |
| --- | --- |
| 베이스 | `/api` |
| JSON 키 | camelCase — 서버 안은 snake_case 를 쓰고 경계에서 Pydantic alias 로 바꾼다 |
| id | 전부 문자열. DB 가 UUID 라도 내보낼 때 `str` |
| 날짜 | 사람이 고른 날짜(`Meeting.date` · `Task.start` · `Task.due`)는 `YYYY-MM-DD`, `createdAt` 은 **ISO 8601 UTC · 항상 `Z` 접미 한 가지 형식**. **오프셋(`+09:00`)을 섞지 않는다** — 프론트가 문자열 비교로 정렬한다 (Q3 닫힘 — 화면에 찍을 때 `lib/date.ts` 가 KST 로 옮긴다) |
| 스코프 | 경로에 프로젝트를 둔다 — `/api/projects/{projectId}/...`. 프로젝트 목록만 예외 |
| 인증 | 없다. 담당자는 `member` id 로만 가리킨다 |
| 집계 타입 | `ThreadRow` · `ThreadDetail` · `TaskRow` 는 서버가 주지 않는다 — 프론트 스토어가 계산한다 |
| 빈 값 | 빈 문자열은 `''`, 빈 배열은 `[]`. **`null` 은 정해진 일곱 이름에서만 나간다** — 아래 '빈 값은 `null` 이 아니다' (Q17 닫힘) |
| 에러 | HTTP 상태 + 본문 `{ code, message, detail? }` 한 가지 — 아래 '에러' (Q14 닫힘) |

## 에러

성공이 아닌 응답은 **전부** 이 한 가지 모양이다 (Q14 닫힘).

```json
{ "code": "PROJECT_NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다." }
```

| 키 | |
| --- | --- |
| `code` | 화면이 갈라 보는 기계용 문자열. SCREAMING_SNAKE |
| `message` | 손대지 않고 그대로 띄울 수 있는 **한국어 한 줄** |
| `detail` | 선택. 폼 검증에서 필드별로 쓴다 — `{ "필드 이름": "메시지" }`. 없으면 **키째로 빼고 낸다**(`exclude_none`). 프론트 타입이 `detail?` 다 |

- FastAPI 기본 `{"detail": "..."}` 로 새지 않게 `HTTPException` · `RequestValidationError` ·
  못 잡은 예외 셋을 **예외 핸들러로 받아 같은 모양으로 바꾼다**. **422 검증 오류도 같은 모양**이다
- 읽기 API 에 필요한 `code` 는 아래 셋뿐이다. 쓰기 API 의 것은 3단계에서 늘린다

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `PROJECT_NOT_FOUND` | 없는 `projectId` 로 스냅샷을 부를 때 |
| 422 | `VALIDATION_ERROR` | 요청이 스키마와 안 맞을 때. `detail` 에 필드별 메시지 |
| 409 | `PROJECT_PREFIX_TAKEN` | 이미 쓰는 `taskKeyPrefix` 로 프로젝트를 만들 때. 접두사는 프로젝트 사이에 유일하다 (Q20) |
| 500 | `INTERNAL_ERROR` | 그 밖. `message` 는 고정된 한국어 한 줄이고 속사정을 싣지 않는다 |

## 엔드포인트

상태: `초안`(서버가 올림) · `검토`(프론트가 보는 중) · `합의`(양쪽 확인) · `구현`(서버 완료) · `연결`(프론트 연결 완료)

| 메서드 | 경로 | 하는 일 | 응답 | 상태 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 앱이 떠 있는지 | `{ status }` | 구현 |
| GET | `/api/projects` | 프로젝트 목록. 상단 프로젝트 선택이 쓴다. **빈 배열은 정상 상태다** — 404 가 아니다 (Q18) | `Project[]` (Q9 로 `taskKeyPrefix` 가 늘었다) | 구현 |
| POST | `/api/projects` | 프로젝트 등록. 빈 상태에서 앱을 여는 유일한 길이라 **읽기 API 와 같이 세운다** (Q18) | `Project` · 201 | 구현 |
| GET | `/api/members` | 멤버 목록. 담당자 · 참석자 고르는 자리가 전부 쓴다. 전사 공통이라 스냅샷에 안 싣는다 (Q5 · Q6) | `Member[]` | 구현 |
| GET | `/api/projects/{projectId}/snapshot` | 그 프로젝트의 레코드 전부. `stores/data.ts` 를 그대로 채운다 | `ProjectSnapshot` | 구현 |

넷 다 섰다 — 열린 질문이 없어 `합의` 를 거쳐 바로 `구현` 으로 올렸다. 프론트가 `src/api/` 로 붙이면 `연결` 이 된다.
`uv run fastapi dev` 로 띄우고 `/api/projects` → `/api/projects/p1/snapshot` 순으로 받으면 목업과 같은 데이터가 온다
(시드가 `web/src/fixtures/*.ts` 와 같은 값이다).

## 응답 스키마 — `ProjectSnapshot`

`GET /api/projects/{projectId}/snapshot`.
**원본만 준다.** `ThreadRow` · `ThreadDetail` · `MeetingRow` · `MeetingDetail` · `TaskRow` ·
`TaskDetail` · `TaskThreadRow` 같은 계산된 타입은 담지 않는다 — 지금대로 프론트 스토어가 만든다.

타입은 전부 `web/src/types/domain.ts` 의 것을 그대로 쓴다. 서버가 이름을 새로 짓지 않는다.

```ts
import type {
  Entry, Meeting, MeetingTaskLink, Project, Task, TaskThreadLink, Thread,
} from '@/types/domain'

/** GET /api/projects/{projectId}/snapshot */
export interface ProjectSnapshot {
  /** 고른 프로젝트 자신 (Q7). 딥링크로 바로 들어와도 헤더가 서고,
      프로젝트를 빨리 바꿨을 때 늦게 온 옛 응답을 id 로 가릴 수 있다 */
  project: Project
  threads: Thread[]
  entries: Entry[]
  meetings: Meeting[]
  tasks: Task[]
  taskThreadLinks: TaskThreadLink[]
  meetingTaskLinks: MeetingTaskLink[]
}
```

`project` 를 뺀 여섯 배열이 `data.ts` 의 `allThreads` · `allEntries` · `allMeetings` · `allTasks` ·
`taskThreads` · `meetingTasks` 로 들어간다. **JSON 키와 스토어 이름은 여섯 중 다섯이 다르다** —
JSON 키는 픽스처 export 이름을 그대로 쓰고, 옮기는 여섯 줄은 `src/api/` 가 갖는다.

### `Project` 가 한 필드 늘었다 (Q9)

`task.key` 의 접두사를 꺼낼 자리가 없어 `domain.ts` 의 `Project` 에 필드를 하나 더한다.
**`GET /api/projects` 와 스냅샷의 `project` 가 같은 모양이다.**

```ts
export interface Project {
  id: string
  name: string
  /** task.key 의 접두사 — 'HW' 면 그 프로젝트의 작업 키가 HW-1 · HW-2 … 가 된다 */
  taskKeyPrefix: string
}
```

이름은 `taskKeyPrefix` 로 굳었다 — 값이 무엇을 만드는지가 이름에 그대로 있다.
**프로젝트 사이에 유일하고**(DB 유니크), 빈 문자열은 나가지 않는다. 등록할 때 사람이 안 넣으면
서버가 만들어 채우므로 **이 필드는 응답에서 늘 채워져 있다** (Q20). 번호 규칙은 Q19 다.

### 중첩은 접어서 낸다

서버 테이블은 행으로 펴 두지만(`server/PLAN.md` 1-1) 응답은 `domain.ts` 모양으로 다시 접는다.
`order` 열은 배열 순서로만 나타나고 JSON 에 따로 나가지 않는다.

| 테이블 | 접히는 자리 |
| --- | --- |
| `meeting_attendee` | `Meeting.attendeeIds: string[]` |
| `meeting_memo` | `Meeting.memos: MeetingMemo[]` (`id` · `text` · `promotedThreadId`) |
| `entry_detail` | `Entry.detail: string[]` |
| `task_line` | `Task.body: TaskLine[]` (`id` · `kind` · `text` · `done` · `level`) |

### 무엇이 담기나 — 프로젝트로 거르는 기준

| 키 | 기준 |
| --- | --- |
| `threads` | `thread.projectId === projectId` |
| `entries` | `entry.threadId` 가 위 `threads` 안에 있는 것. **`Entry` 에는 `projectId` 가 없다** — 안건을 타고 걸러진다. `meetingId` 가 null 인 줄(회의 밖 처리)도 당연히 담긴다 |
| `meetings` | `meeting.projectId === projectId`. 안건이 하나도 안 붙은 회의(메모만 남긴 주간회의)도 담는다 — 회의 목록이 유일한 입구다 |
| `tasks` | `task.projectId === projectId` |
| `taskThreadLinks` | `taskId` 가 위 `tasks` 안에 있는 것 (Q13 — 프로젝트를 넘는 링크를 어떻게 할지) |
| `meetingTaskLinks` | `taskId` 가 위 `tasks` 안에 있는 것 (Q13) |

페이징 · 필터 · 정렬 파라미터는 없다. 프로젝트 하나치를 통째로 준다 (Q8 닫힘).

**다시 볼 기준** — 한 프로젝트가 **작업 500 · 안건 300 · 회의 100** 중 하나를 넘으면
`server/PLAN.md` 5단계(집계 · 페이징을 서버로)를 연다. 그때까지 프론트는 프로젝트를 바꿀 때마다
스냅샷을 통째로 다시 받고 캐시하지 않는다(ETag · 증분 갱신도 그때 같이 본다).

### 배열 순서 — `entries` 는 순서 자체가 계약이다

**`entries` 배열 순서 = 등록 순서(오래된 것 → 새 것).** 정렬 키가 아니라 순서를 약속한다 (Q4 닫힘).
`stores/thread.ts` 의 `threadDetail` 이 같은 날짜 줄의 동점을 **배열 인덱스**(`seqNo`)로 가르기 때문에,
서버가 내는 순서가 곧 안건 이력의 순서다.

서버는 `entry` 에 **단조 증가 열 `seq`(bigserial)** 를 두고 `ORDER BY seq ASC` **하나**로 낸다 (Q15).
`created_at` 을 정렬 1순위로 쓰지 않는다 — 지난 회의를 나중에 입력하면 `created_at` 과 등록 순서가
갈리고, 한 트랜잭션 안에서는 `created_at` 이 아예 같은 값이 된다.
`seq` 는 **JSON 에 나가지 않는다** — `domain.ts` 의 `Entry` 는 그대로다.

| 키 | 순서 | 화면이 순서에 기대나 |
| --- | --- | --- |
| `entries` | `seq ASC` (= 등록 순서) | **그렇다** — 안건 이력의 동점을 이 순서로 가른다 |
| `threads` | `created_at ASC, id ASC` | 아니다. 화면이 다시 정렬한다 |
| `meetings` | `date ASC, id ASC` | 아니다 — `MeetingRow` 가 날짜로 다시 세운다 |
| `tasks` | `created_at ASC, id ASC` | 아니다 |
| 링크 둘 | 두 id 오름차순 | 아니다 |

기대하지 않는 넷도 **같은 데이터면 늘 같은 순서**로 낸다. 응답이 요청마다 흔들리면 눈으로 비교할 수 없다.

### 빈 값은 `null` 이 아니다

`null` 이 나갈 수 있는 필드는 **아래 일곱 이름뿐**이다. 나머지는 빈 문자열 `''` · 빈 배열 `[]` 로 낸다 (Q17 닫힘).

| 타입 | `null` 을 내는 필드 |
| --- | --- |
| `Thread` | `ownerId` · `parentThreadId` |
| `Entry` | `meetingId`(회의 밖 처리) · `ownerId` |
| `MeetingMemo` | `promotedThreadId` |
| `Task` | `parentId` · `ownerId` · `start` · `due` |

그래서 `Entry.note` 는 `''`, `Entry.detail` · `Meeting.memos` · `Meeting.attendeeIds` · `Task.body` 는
`[]` 다. 보장은 **세 겹**이고, 한 겹이라도 새면 화면이 `.length` 에서 터진다.

| 겹 | 어떻게 |
| --- | --- |
| DB | `entry.note TEXT NOT NULL DEFAULT ''`. 배열이 되는 것은 전부 자식 테이블이라 행이 없으면 자연히 빈 배열이다 |
| ORM | `Mapped[str]` — Optional 을 쓰지 않는다. `null` 을 내는 위 일곱 자리만 `Mapped[str \| None]` |
| 응답 스키마 | Pydantic 필드를 `note: str = ''` · `detail: list[str] = Field(default_factory=list)` 로 둔다. 타입이 `str` · `list[str]` 이라 **`None` 이 오면 응답 직렬화에서 터진다** — 조용히 새지 않는다 |

응답 직전에 `None` 을 `''` 로 바꾸는 변환은 두지 않는다. 그 변환은 모델이 틀린 것을 덮는다.

### 아직 안 담은 것 — 질문으로 남긴다

| 후보 | 왜 안 담나 |
| --- | --- |
| `members: Member[]` | 멤버가 프로젝트에 매여 있지 않다. 프로젝트를 바꿀 때마다 같은 목록을 다시 받게 된다 — `GET /api/members` 를 따로 둔다 (Q5 닫힘. **Q6 이 '프로젝트별' 로 닫히면 뒤집는다**) |
| `currentMemberId` | 인증이 없어 서버가 낼 값도 결국 상수다. 프론트가 들고 있는다 (Q12 닫힘) |
| `Meeting.createdAt` | 화면이 회의를 놓는 기준은 사람이 고른 `date` 뿐이다. 서버 테이블에만 둔다 (Q10 닫힘) |

`project: Project` 는 **담는다** — 일곱 번째 키다 (Q7 닫힘. 위 스키마 블록).

### 프론트 검토 (2026-09-28)

초안을 `web/src/types/domain.ts` · `src/stores/data.ts` · `src/fixtures/*.ts` 와 한 줄씩 맞춰 봤다.
**타입 이름과 모양을 서버가 임의로 바꾼 자리는 없다** — `Entry.detail` · `Task.body` · `Meeting.memos` ·
`Meeting.attendeeIds` 를 접는 방식도 `domain.ts` 와 같다. 고칠 자리는 아래 셋이다.

- **키 이름은 초안대로 두고, 스토어 이름은 안 바꾼다.** 초안은 "이름만 `taskThreads` ↔ `taskThreadLinks`
  로 다르다" 고 적었지만 실제로는 **여섯 중 다섯이 다르다** — 스토어는 `allThreads` · `allEntries` ·
  `allMeetings` · `allTasks` · `taskThreads` · `meetingTasks` 다. 어차피 한 벌 매핑이 필요하니
  JSON 키는 픽스처 export 이름(`threads` · `entries` · `meetings` · `tasks` · `taskThreadLinks` ·
  `meetingTaskLinks`)을 그대로 쓰고, `src/api/` 에서 `data.ts` 에 대입할 때 여섯 줄로 옮긴다.
  스토어 쪽 `allThreads` 는 `thread` 스토어의 `threads`(프로젝트로 거른 것)와 이름이 겹쳐서 못 바꾼다.
- **`project: Project` 를 일곱 번째 키로 더한다** (Q7). 스키마 블록에 추가가 필요하다.
- **`members` 는 안 싣는다** (Q5). `GET /api/members` 를 그대로 둔다 — Q6 이 '프로젝트별' 로
  닫히면 뒤집는다.

빠진 데이터는 위 둘(`project` · `members`)뿐이다. `stores/data.ts` 가 들고 있는 여덟 가지 중
나머지 여섯은 스냅샷이 다 덮고, `currentMemberId` 는 프론트가 계속 상수로 든다(Q12).

## 요청 스키마 — `ProjectInput` (`POST /api/projects`)

프로젝트가 하나도 없으면 첫 화면이 등록이다 (Q18 닫힘). 그래서 **이 쓰기 하나만 2단계(읽기 API)와 같이
선다** — 나머지 쓰기는 3단계 그대로다. 빈 DB 에 마이그레이션만 돌린 상태에서 화면이 끝까지 도는지를
시드가 아니라 이 엔드포인트로 확인한다.

```ts
/** POST /api/projects → 201 Project */
export interface ProjectInput {
  name: string
  /** 선택. 안 넣으면 서버가 겹치지 않는 값을 만들어 응답에 실어 준다 */
  taskKeyPrefix?: string
}
```

- **`taskKeyPrefix` 는 선택이다** (Q20). 넣으면 그 값을 쓰고, 안 넣으면 **서버가 만들어 응답에 실어 준다** —
  등록 화면의 입력칸은 비워 둘 수 있고, 돌아온 `Project.taskKeyPrefix` 를 그대로 보여주면 된다
- **글자 모양** — `^[A-Z][A-Z0-9]{0,7}$`(대문자로 시작하는 영숫자 1~8자). `HW-4` 처럼 회의에서 소리 내어
  가리키는 값이라 공백 · 한글 · 소문자는 받지 않는다. 어긋나면 422 `VALIDATION_ERROR` 이고
  `detail` 은 `{"taskKeyPrefix": "형식이 올바르지 않습니다."}` 다 (서버가 정했다 · 결정 로그)
- **서버가 만드는 값** — 헷갈리는 글자(`I` · `O` · `0` · `1`)를 뺀 대문자 · 숫자에서 **네 글자**를 뽑는다.
  이미 쓰는 값이면 다시 뽑는다. 이름에서 뽑지 않는다 — 한글 이름에서 규칙을 세울 수 없다
- **겹치면 409 `PROJECT_PREFIX_TAKEN`** — 접두사는 프로젝트 사이에 유일하다. 사용자가 넣은 값이 이미
  쓰이고 있을 때만 난다(서버가 만드는 쪽은 겹치지 않을 때까지 다시 뽑는다).
  형식이 틀린 것은 422, 이미 있는 값은 409 로 갈랐다 — 요청이 잘못된 게 아니라 자원이 부딪힌 것이다
- `name` 은 빈 문자열을 받지 않는다 — 422 `VALIDATION_ERROR`
- 등록 직후 그 프로젝트의 다음 작업 번호는 **1** 이다 — 첫 작업이 `HW-1` (Q19)
- `id` 는 서버가 만든다. 요청에 `id` 가 와도 무시한다

### `task.key` 발번 (Q19)

번호는 **프로젝트별**로 세고 **지운 번호를 다시 쓰지 않는다**. `key` 는 `{taskKeyPrefix}-{번호}` 다.

`project` 에 `next_task_no` 열을 두고 작업을 만들 때 한 문장으로 잠가 올린다 —
`UPDATE project SET next_task_no = next_task_no + 1 WHERE id = :id RETURNING next_task_no - 1`.
그 `UPDATE` 가 프로젝트 행의 잠금을 잡아 같은 프로젝트의 동시 등록을 줄 세운다. 안전망으로
`task(project_id, key)` 에 UNIQUE 를 건다 — 발번이 어디서 새도 같은 키가 두 번 저장되지 않는다.

안 고른 둘 — **`MAX(번호)+1`** 은 동시 등록에서 두 트랜잭션이 같은 `MAX` 를 읽어 겹친다(UNIQUE 로 막아도
한쪽이 실패해 재시도가 잦다). **프로젝트마다 진짜 시퀀스**(`CREATE SEQUENCE`)는 프로젝트를 만들 때마다
DDL 이 돌아 마이그레이션 · 백업 · 복제가 무거워지고, 시퀀스는 트랜잭션이 되돌아가도 번호가 안 돌아와
구멍이 더 난다. `next_task_no` 는 롤백되면 번호도 같이 돌아온다.

## 열린 질문

한쪽이 혼자 못 정하는 것을 여기 쌓는다. **추측으로 메우지 않는다.**
답이 나오면 줄을 지우지 말고 답을 채우고 닫는다 — 왜 그렇게 정했는지가 남아야 한다.

| # | 누가 답하나 | 질문 | 답 | 상태 |
| --- | --- | --- | --- | --- |
| Q1 | 사용자 | 안건 상태를 셋(`queued` · `open` · `decided`)으로 갈지, memo 의 넷(대기 · 논의중 · 결정 · 미룸)으로 갈지. 코드는 셋으로 돌고 '미룸'은 `kind='defer'` 인 Entry 다 (`memo.md` 정해야 할 것 6) | **셋이다 — `queued` · `open` · `decided`.** '미룸' 은 상태가 아니라 `kind='defer'` 인 Entry 다 — 같은 안건이 여러 번 미뤄지고(시나리오 2) 그 횟수가 이력에 쌓여야 뜻이 산다. 코드가 이미 이 모양으로 돌고, 화면은 미룬 횟수를 `deferCount` 배지로 보여준다. **따라올 것** — `memo.md` 화면 목록 4번의 "대기 · 논의중 · 결정 · 미룸" 을 셋으로 고치고 '정해야 할 것' 6번을 지운다 | 닫힘 |
| Q2 | 사용자 | 작업 상태를 넷(해야 할 일 · 진행 중 · 막힘 · 완료)으로 확정할지. memo 본문에는 '막힘'이 없다 (`memo.md` 정해야 할 것 1) | **넷이다 — 해야 할 일 · 진행 중 · 막힘 · 완료.** '막힘' 은 걸어 둔 안건이 안 정해져 멈춘 상태로, 이 제품에서 작업이 멈추는 가장 흔한 이유라 칸반의 칸으로도 세운다. 코드가 이미 넷 전제다(`TaskBoard.vue` 의 칸 · `TaskStatusBadge` · `blockedCount` · 픽스처 `k18`). 서버는 `task.status` 에 넷을 둔다. **따라올 것** — `memo.md` '정해야 할 것' 1번을 본문 규칙으로 옮긴다 | 닫힘 |
| Q3 | 프론트 | `createdAt` 을 ISO 8601(`2026-09-08T01:00:00Z`)로 낼지, 지금 픽스처처럼 날짜뿐(`2026-09-08`)으로 낼지. `lib/date.ts` 의 `monthDay` · `slashDay` 가 `split('-')` 로 읽어서 ISO 를 주면 `9월 NaN일` 이 된다. 서버가 날짜뿐으로 맞출지, 프론트가 파서를 고칠지 | **ISO 8601 UTC 로 낸다 — 프론트가 파서를 고친다.** `created_at` 은 DB 에서 타임스탬프고, 한 회의에서 여러 줄이 같은 날 들어오므로 날짜뿐이면 같은 날 안의 순서를 잃는다(Q4 가 그 자리다). 서버가 지킬 것은 하나 — `createdAt` 은 **항상 `Z` 접미 UTC 한 가지 형식**으로 낸다(`+09:00` 오프셋을 섞지 않는다. 프론트가 문자열 비교로 정렬한다). 프론트가 고칠 것 — ① `src/lib/date.ts` 에 `localDay(iso)` 를 더한다(UTC → KST 로 옮겨 `YYYY-MM-DD` 로 자른다). `monthDay` · `slashDay` 는 `split('-')` 앞에 `localDay` 를 태워 날짜뿐 문자열도 그대로 통과하게 한다 ② `src/lib/date.ts` 에 `nowIso()` 를 더하고 `stores/thread.ts` 의 `addThread` · `addOutsideEntry`, `stores/task.ts` 의 `addTask`, `stores/meeting.ts` 의 `saveMeeting`(지금 `createdAt: input.date`)이 그것을 쓰게 한다 — 화면이 만든 줄만 날짜뿐이면 정렬이 섞인다 ③ `stores/thread.ts` 의 `threadDetail` 에서 `at: meeting?.date ?? entry.createdAt` → `at: meeting?.date ?? localDay(entry.createdAt)`. `at` 은 회의 날짜(`YYYY-MM-DD`)와 문자열로 비교되고 `monthDay(at)` 로 찍히므로 날짜뿐이어야 한다. **`Meeting.date` · `Task.start` · `Task.due` 는 지금대로 `YYYY-MM-DD` 다** — 사람이 고른 날짜라 시간대가 없다 | 닫힘 |
| Q4 | 프론트 | `entries` 배열 순서를 `createdAt ASC, id ASC` 로 고정해도 되는지. `stores/thread.ts` 의 `threadDetail` 이 같은 날짜 줄의 동점을 **배열 인덱스(seqNo)** 로 가르고 있어 서버가 낸 순서가 곧 화면의 이력 순서다. 인덱스 대신 `id` 로 가르게 프론트를 고칠지 | **배열 인덱스를 유지한다. `id` 로 가르지 않는다.** id 가 UUID 면 사전순이 등록순과 무관하고, 지금 목업의 `e1`…`e10` 도 문자열 비교면 `e10 < e2` 라 뒤집힌다. 동점이 실제로 생기는 자리는 '한 회의에서 한 안건에 남긴 여러 줄'(예: `decide` 뒤에 `refine`)이다 — `at` 이 회의 날짜라 같고 `saveMeeting` 이 `createdAt` 까지 같은 값으로 넣어서 시간으로도 못 가른다. 화면이 기대는 건 **적은 순서**뿐이다. 그래서 계약에 적을 것은 정렬 키가 아니라 **`entries` 배열 순서 = 등록 순서(오래된 것 → 새 것)** 다. `createdAt ASC, id ASC` 는 그 순서를 깨지 않는 한에서만 맞다 — 같은 `createdAt` 안의 등록 순서를 서버가 복원할 수 있는지는 **Q15** 로 물었다. 덧붙임: 초안의 "목업의 `allEntries` 와 같은, 오래된 것부터" 는 사실이 아니다(목업 배열은 `e1`=09-09 가 `e2`=09-07 보다 앞이다). 다만 같은 안건 · 같은 날짜로 겹치는 Entry 가 목업에 없어 `threadDetail` 결과는 어느 쪽으로 정렬해도 같고 `thread.test.ts` 도 그대로 통과한다. 프론트가 고칠 것 — `threadDetail` 의 `seqNo` 가 **전역 `allEntries` 인덱스**라는 게 지금 암묵적이다. "배열 순서가 계약" 임을 주석으로 못박고 `fixtures/threads.ts` 의 `entries` 를 등록 순서(= `createdAt` 오름차순)로 다시 늘어놓는다 | 닫힘 |
| Q5 | 프론트 | 멤버를 스냅샷에 실을지(`members: Member[]`), `GET /api/members` 를 따로 부를지. 화면 시작에 요청이 둘이 된다 | **스냅샷에 싣지 않는다. `GET /api/members` 를 따로 부른다.** 멤버는 프로젝트를 바꿔도 안 바뀌는데 스냅샷은 프로젝트를 바꿀 때마다 다시 받는다 — 같이 실으면 같은 목록을 매번 다시 받게 된다. `data.allMembers` 는 앱이 뜰 때 한 번 채우면 되고, 부팅에서 `projects` · `members` 를 병렬로 받은 뒤 프로젝트가 정해지면 스냅샷을 받으므로 '요청이 둘' 이 화면을 늦추지 않는다. **단 Q6 이 '프로젝트마다 참여자가 갈린다' 로 닫히면 이 답을 뒤집는다** — 그때는 그 프로젝트의 `members`(또는 `memberIds`)가 스냅샷 안으로 들어와야 하고, 담당자 · 참석자 고르는 자리(`ThreadListView` · `TasksView` · `MeetingListView` · `NewMeetingView` · `ThreadDetailDialog` · `TaskCreateDialog`)가 전부 그것으로 갈린다 | 닫힘 |
| Q6 | 사용자 | member 가 전사 공통인지, 프로젝트마다 참여자가 갈리는지. 지금 픽스처는 넷을 전 프로젝트가 같이 쓴다. 프로젝트별이면 스냅샷 안으로 들어가야 한다 | **전사 공통이다.** 멤버는 프로젝트를 가리지 않는다 — 지금 픽스처 그대로다. 따라서 **Q5 의 답이 그대로 산다** — 멤버는 스냅샷에 싣지 않고 `GET /api/members` 를 따로 부른다. `member` 테이블에 `project_id` 를 두지 않고, 담당자 · 참석자 고르는 자리는 전부 같은 목록을 쓴다. 프로젝트마다 참여자를 갈라야 할 일이 생기면 그때 `project_member` 링크 테이블을 더하고 이 계약을 다시 연다 | 닫힘 |
| Q7 | 프론트 | 스냅샷에 `project: Project` 를 같이 실을지. `GET /api/projects` 로 이미 갖고 있어 중복이지만, 딥링크로 바로 들어온 화면은 목록 없이 이름을 못 쓴다 | **싣는다 — `project: Project` 를 스냅샷의 일곱 번째 키로 둔다.** ① 딥링크(`/tasks/k4`)로 바로 들어와도 스냅샷 하나로 헤더가 선다. 지금 `AppShell` · `TaskDetailDialog` · `ThreadDetailDialog` · `MeetingDetailDialog` · `TaskCreateDialog` · `NewMeetingView` 여섯 자리가 `data.currentProject.name` 을 찍는다 ② 프로젝트를 빨리 바꾸면 스냅샷 응답 둘이 순서 없이 도착할 수 있다 — 응답 안에 `project.id` 가 있으면 늦게 온 옛 응답을 버릴 수 있다. 중복되는 건 필드 둘(`id` · `name`)이라 값싸다. `GET /api/projects` 는 그대로 둔다 — 상단 프로젝트 선택이 목록을 필요로 한다 | 닫힘 |
| Q8 | 프론트 | 페이징 없이 프로젝트 레코드 전부를 한 번에 주는 것으로 시작해도 되는지. 한 프로젝트가 작업 수백 · 회의 수십이 되면 응답이 커진다 (`server/PLAN.md` 5단계로 미루기로 한 자리) | **좋다. 페이징 없이 프로젝트 하나치를 통째로 받는 것으로 시작한다.** 지금 계산이 전부 '프로젝트 레코드 전부' 를 전제로 돈다 — `threadDetail` 은 `allEntries` 를 통째로 훑고, `pathLabel` 은 조상 체인을 타고 올라가고, `statusCounts` · `undatedCount` · `blockedCount` · `queuedCount` · 간트 · 칸반은 필터 · 페이징 **이전의 전체 집합**을 센다. 목록 화면의 페이징은 이미 클라이언트 쪽 슬라이스다(`ThreadListView` · `TasksView`). 서버 페이징을 지금 넣으면 이 계산을 서버로 옮겨야 하고, 스토어 테스트와 같은 계산이 두 벌이 된다. 다시 볼 기준만 계약에 적어 두자 — **한 프로젝트가 작업 500 · 안건 300 · 회의 100 중 하나를 넘으면** `server/PLAN.md` 5단계를 연다. 그 전까지 프론트는 프로젝트를 바꿀 때마다 스냅샷을 통째로 다시 받고 캐시하지 않는다(ETag · 증분 갱신도 그때 같이 본다) | 닫힘 |
| Q9 | 사용자 | `task.key` 의 접두사(`HW-4` 의 `HW`)가 어디서 오나. `domain.ts` 의 `Project` 에 `id` · `name` 밖에 없어 서버가 발번하려면 프로젝트에 접두사 필드가 하나 늘어난다 — **계약이 바뀐다**. 번호를 프로젝트별로 셀지, 지운 작업 번호를 다시 쓸지도 같이 | **`Project` 에 접두사 필드를 더하고 서버가 발번한다.** **계약이 바뀐다** — `domain.ts` 의 `Project` 가 `id` · `name` 에서 하나 는다. 이름은 `taskKeyPrefix` 로 제안한다(이견 있으면 이름만 프론트가 정한다). 지금 `stores/task.ts` 의 `addTask` 가 프론트에서 `HW-${n}` 을 직접 만들어 p2 작업에도 `HW-` 가 붙는데, 쓰기 API 가 서면 그 자리를 걷어내고 응답 레코드의 `key` 를 쓴다. **번호 매기는 규칙은 아직 안 정했다 — Q19 로 뗀다** | 닫힘 |
| Q10 | 프론트 | `Meeting` 에 `createdAt` 이 없다(`Thread` · `Task` · `Entry` 에는 있다). 서버 테이블 계획에는 `meeting.created_at` 이 있다. 응답에 넣고 `domain.ts` 에 필드를 더할지, 서버 안에만 둘지 | **응답에 넣지 않는다. 서버 안에만 둔다 — `domain.ts` 의 `Meeting` 은 그대로다.** 화면이 회의를 놓는 기준은 사용자가 고른 `meeting.date` 뿐이다. 목록 정렬 · `dateLabel` · 안건 이력의 `at` 이 전부 `date` 를 쓴다. `createdAt` 이 같이 오면 '언제 열린 회의' 와 '언제 입력했는지' 둘이 생겨 화면마다 뭘 쓸지 고르게 되고, 지난 회의를 나중에 입력하는 흔한 경우에 두 값이 크게 갈린다. 같은 날 회의 둘의 순서에 화면이 뜻을 두지 않으므로 `date ASC, id ASC` 로 충분하다. '입력 시각' 을 보여줘야 할 화면이 생기면 그때 계약을 다시 연다 | 닫힘 |
| Q11 | 사용자 | 회의 '녹음' 을 둘지. `stores/meeting.ts` 주석은 "회의가 짊어지는 것은 날짜 · 참석자 · 녹음뿐"이라 적혀 있는데 `domain.ts` 의 `Meeting` 에도 서버 테이블에도 녹음 필드가 없다 | **두지 않는다.** `domain.ts` 의 `Meeting` 도 `meeting` 테이블도 지금 모양 그대로다. **따라올 것** — `stores/meeting.ts` 의 "회의가 짊어지는 것은 날짜 · 참석자 · 녹음뿐" 주석에서 '녹음' 을 걷어낸다. 타입에도 테이블에도 없는 것이 주석에만 살아 있으면 다음 사람이 있는 줄 알고 찾는다. 녹음이 필요해지면 파일 업로드 · 스토리지가 같이 따라오는 일이라 그때 계약을 새로 연다 | 닫힘 |
| Q12 | 프론트 | `currentMemberId` 를 서버가 줄지(`GET /api/me` 같은 자리), 인증이 붙기 전까지 프론트가 상수로 들고 있을지. 지금은 픽스처의 `'u3'` 다 | **프론트가 상수로 들고 있는다. `GET /api/me` 를 만들지 않는다.** 서버에 인증이 없어(`server/PLAN.md` 6단계) 서버가 낼 수 있는 값도 결국 상수다 — 상수를 왕복시킬 이유가 없고, 있으면 "서버가 주니까 진짜 로그인" 으로 오해된다. 지금 자리는 `src/fixtures/people.ts` 의 `currentMemberId = 'u3'` 이고, 픽스처가 빠질 때 이 상수만 `src/lib/` 로 옮긴다(`stores/data.ts` 의 `currentMemberId` ref 는 그대로 둔다). 그때까지 **서버는 `ownerId` 를 추론하지 않는다** — 쓰기 API 는 프론트가 명시해 보낸 `ownerId` 만 쓰고, `null` 이면 담당자 없음이다. 인증이 붙으면 그때 `GET /api/me` 를 계약에 새로 연다 | 닫힘 |
| Q13 | 사용자 | 작업 ↔ 안건, 회의 ↔ 작업 링크가 프로젝트 경계를 넘을 수 있나. 넘을 수 있다면 스냅샷에 상대가 없는 링크가 섞여 화면이 빈 줄을 만든다. 서버가 아예 막을지, 양쪽 다 이 프로젝트인 링크만 낼지. **서버 의견:** 막는 쪽이 맞다. 링크를 만들 때 양쪽 `project_id` 가 같은지 보고 다르면 400 으로 돌려주고, 링크 테이블에 `project_id` 를 두어 복합 FK 로 DB 까지 못 박을 수 있다(Q16 과 같은 수법). '스냅샷에서 상대 없는 링크를 빼고 준다' 는 임시 방편이다 — 이미 들어간 링크는 어느 화면에서도 못 고치고, 지운 것도 아니어서 DB 에 영영 남는다. 다만 **한 작업이 다른 프로젝트 안건을 기다리는 일이 실제로 있는지**는 제품 질문이라 사용자가 답해야 한다 | **서버가 막는다. 링크는 양쪽이 같은 프로젝트일 때만 선다.** 프론트 · 서버 의견이 같았다. 다르면 400(`TASK_THREAD_LINK_OTHER_PROJECT` · `MEETING_TASK_LINK_OTHER_PROJECT` 같은 `code`), 그리고 링크 테이블에 `project_id` 를 두어 복합 FK 로 DB 까지 막는다 — Q16 과 같은 수법이다. '스냅샷에서 상대 없는 링크를 빼고 준다' 는 임시 방편이라 안 쓴다. 이미 들어간 링크는 어느 화면에서도 못 고치고 DB 에 영영 남기 때문이다. 덕분에 스냅샷의 링크 두 배열은 거르는 기준이 단순해진다 — `project_id` 하나로 갈린다 | 닫힘 |
| Q14 | 프론트 | 없는 `projectId` 로 스냅샷을 부르면 404 로 낼지, 빈 배열 여섯으로 낼지. 에러 본문을 `{ code, message, detail? }` (한국어 message)로 지금 확정할지 | **404 다. 빈 배열 여섯은 안 된다** — '레코드가 없는 새 프로젝트' 와 '없는 프로젝트' 를 구분 못 해서 화면이 오타 난 주소를 빈 목록으로 정상인 척 그린다. 에러 본문 `{ code, message, detail? }` 도 지금 확정한다 — `code` 는 화면이 갈라 보는 기계용 문자열(`PROJECT_NOT_FOUND` 처럼 SCREAMING_SNAKE), `message` 는 손대지 않고 그대로 띄울 수 있는 한국어 한 줄, `detail` 은 선택(폼 검증에서 필드별로 쓸 자리). FastAPI 기본 `{"detail": "..."}` 로 새지 않게 예외 핸들러로 통일하고 **422 검증 오류도 같은 모양**으로 낸다. 프론트가 할 것 — `src/api/` 를 세울 때 `ApiError { code, message, detail? }` 를 `src/types/` 에 두고, `stores/data.ts` 의 `currentProjectId` 초기값(`allProjects.value[0].id`)이 404 를 만나면 프로젝트 선택으로 되돌린다 | 닫힘 |
| Q15 | 서버 | 같은 `createdAt` 안에서 `entries` 의 **등록 순서**를 복원할 수 있나. `server/PLAN.md` 1-1 의 `entry` 테이블에는 `order` 도 시퀀스도 없는데(`entry_detail` · `meeting_memo` · `task_line` 에는 있다), `saveMeeting` 은 한 회의의 줄 여러 개를 한 트랜잭션에 넣어 `created_at` 이 같아질 수 있고 `id` 가 UUID 면 사전순이 등록순과 무관하다. 그 순서가 곧 안건 이력의 순서다(Q4). ① `entry` 에 단조 증가 열(bigserial `seq`)을 두고 `created_at ASC, seq ASC` 로 낼지 ② `created_at` 에 마이크로초까지 실어 한 트랜잭션 안에서도 값이 갈리게 할지. 어느 쪽이든 **JSON 에 새 필드는 필요 없다** — 배열 순서만 지켜지면 된다 | **복원할 수 있다 — ① `entry` 에 `seq BIGSERIAL` 을 둔다.** ②(마이크로초)는 못 쓴다: Postgres 의 `now()` · `CURRENT_TIMESTAMP` 는 **트랜잭션 시작 시각**이라 `saveMeeting` 한 번에 들어간 줄이 전부 같은 값이 된다. `clock_timestamp()` 나 파이썬에서 줄마다 찍으면 갈리긴 하지만, 순서를 시계에 맡기면 NTP 되감김 · 여러 인스턴스에서 뒤집힐 수 있다 — '등록 순서' 는 시각이 아니라 순서라 그것을 직접 들고 있는 열이 맞다. `seq` 는 DB 가 보장하는 단조 증가라 한 트랜잭션 안에서도 삽입 순서대로 는다. 스냅샷의 `entries` 는 **`ORDER BY seq ASC` 하나**로 낸다 — `created_at` 을 1순위로 두면 지난 회의를 나중에 입력한 줄이 튄다(그 줄도 `threadDetail` 은 회의 날짜로 다시 정렬하고 배열 순서는 동점에만 쓴다). **`seq` 는 JSON 에 안 나간다** — `domain.ts` 의 `Entry` 는 그대로다. 시드는 `fixtures/threads.ts` 의 **배열 순서대로** 넣어 `seq` 가 목업 순서와 같아진다. **따라간 것** — `server/PLAN.md` 1-1 의 `entry` 행에 `seq` 를 더했다 | 닫힘 |
| Q16 | 서버 | `thread.parentThreadId` · `task.parentId` 가 프로젝트 경계를 넘을 수 있나. Q13 은 링크 테이블 둘만 다룬다. 스냅샷이 `projectId` 로 거르므로 부모가 다른 프로젝트에 있으면 `taskDetail.parent` 가 조용히 null 이 되고 `pathLabel` 이 '최상위 작업' 으로 잘못 찍히며, 안건의 `subThreads` 가 통째로 빠진다 — 화면에 에러가 안 뜨고 계층만 틀린다. `server/PLAN.md` 1-2 에 '고리 금지' 는 있지만 '부모는 같은 프로젝트' 는 없다. 서버가 막을 수 있나 | **막는다 — 부모는 반드시 같은 프로젝트다.** 두 겹으로 건다. ① 서비스에서 보고 400 으로 돌려준다 — `TASK_PARENT_OTHER_PROJECT` · `THREAD_PARENT_OTHER_PROJECT`(`message` 는 한국어 한 줄) ② DB 로도 못 박는다 — `task(id, project_id)` 에 UNIQUE 를 두고 `FOREIGN KEY (parent_id, project_id) REFERENCES task(id, project_id)` 복합 FK 를 건다. `thread` 도 같다. 이러면 서비스를 건너뛴 시드 · 마이그레이션 · 훗날의 버그로도 경계를 못 넘는다. 작업 · 안건을 다른 프로젝트로 옮기는 기능은 지금 화면에 없다 — 생기면 **자손까지 통째로** 옮기는 것으로 계약을 다시 연다(부모만 옮기면 복합 FK 가 막는다). 링크 테이블 둘은 이 답의 범위 밖이다 — Q13 이다. **따라간 것** — `server/PLAN.md` 1-2 에 '부모는 같은 프로젝트' 를 고리 금지 옆에 더했다 | 닫힘 |
| Q17 | 서버 | 빈 값을 `null` 이 아니라 `''` · `[]` 로 낸다고 확정할 수 있나. `domain.ts` 에서 null 을 허용하는 건 `ownerId` · `parentThreadId` · `parentId` · `meetingId` · `start` · `due` · `promotedThreadId` 뿐이다. `Entry.note`(`string`) · `Entry.detail`(`string[]`) · `Meeting.memos` · `Meeting.attendeeIds` · `Task.body` 는 빈 문자열 · 빈 배열이어야 한다 — Pydantic 기본값이나 DB 의 nullable 이 `None` 으로 새면 화면이 `.length` 에서 터진다 | **확정한다. 그 일곱 이름 말고는 `null` 이 나가지 않는다.** 보장은 **세 겹**이고, '응답 직전 변환' 은 쓰지 않는다 — 그 변환은 모델이 틀린 것을 덮어서 다음에 또 샌다. ① **DB** — `entry.note TEXT NOT NULL DEFAULT ''`. 배열이 되는 것(`entry_detail` · `meeting_memo` · `meeting_attendee` · `task_line`)은 전부 자식 테이블이라 행이 없으면 자연히 빈 배열이고 `None` 이 될 길이 없다 ② **ORM** — `Mapped[str]` 로 두고 Optional 을 안 쓴다. `Mapped[str \| None]` 은 위 일곱 자리에만 쓴다. mypy 가 어긋난 대입을 잡는다 ③ **응답 스키마** — Pydantic 필드를 `note: str = ''` · `detail: list[str] = Field(default_factory=list)` 로 둔다. 타입이 `str` · `list[str]` 이라 `None` 이 들어오면 **응답 직렬화에서 터진다**(조용히 새는 대신 500 이 뜨고 로그에 남는다). 덧붙임 — `Task.start` · `due` 는 한쪽만 채워도 받지만(기간 미정과 구분이 안 되는 건 화면 규칙이다) 그 둘은 `null` 을 내는 일곱 안에 있다. **따라간 것** — 계약 본문에 '빈 값은 `null` 이 아니다' 절을 더했다 | 닫힘 |
| Q18 | 사용자 | 프로젝트가 하나도 없을 때 무슨 화면인가. `stores/data.ts` 가 `allProjects.value[0].id` 로 시작해서 `GET /api/projects` 가 빈 배열이면 앱이 뜨다가 터진다. 프로젝트 목록 · 등록 화면(`memo.md` 화면 1)은 아직 코드에 없다 — 첫 진입을 프로젝트 등록으로 보낼지, 시드가 항상 하나를 보장하는 것으로 하고 빈 상태는 나중에 볼지 | **프로젝트 등록 화면으로 보낸다.** 빈 배열은 에러가 아니라 정상 상태다 — 서버가 시드로 프로젝트 하나를 억지로 보장하지 않는다. `GET /api/projects` 가 `[]` 면 프론트가 첫 진입을 프로젝트 등록으로 돌린다. **따라올 것** — ① 프로젝트 목록 · 등록 화면(`memo.md` 화면 1)이 아직 코드에 없다. 계약이 닫힌 뒤 frontend 가 세운다 ② `stores/data.ts` 의 `currentProjectId` 초기값(`allProjects.value[0].id`)이 빈 배열에서 터지므로 같이 고친다 ③ `POST /api/projects` 가 `server/PLAN.md` 3단계에 잡혀 있는데, 빈 상태에서 앱을 여는 **유일한 길**이라 2단계로 당길지는 서버가 판단한다. **서버 답 ③:** 당긴다 — `POST /api/projects` 만 2단계로 올리고 나머지 쓰기는 3단계 그대로다. 이게 없으면 2단계의 '끝난 것으로 보는 기준'(빈 DB 에 붙여 화면이 목업처럼 도는지)을 시드 없이는 확인할 수 없고, 시드로 가리면 빈 상태가 처음 도는 곳이 사내 배포가 된다. **서버 답(접두사):** 등록 요청의 `taskKeyPrefix` 는 **필수**다 — 선택으로 두면 접두사 없는 프로젝트에서 작업을 만드는 순간 키를 못 만들고, 나중에 메우면 이미 나간 키를 전부 다시 써야 한다. **등록 화면에 입력칸이 하나 는다.** 계약은 `## 요청 스키마 — ProjectInput` 절에 있다 | 닫힘 |
| Q19 | 사용자 | `task.key` 의 **번호**를 어떻게 매기나 (Q9 에서 뗐다). ① 번호를 프로젝트별로 세나 — 프로젝트 A 의 `HW-1` 과 B 의 `SL-1` 이 따로 도는가 ② 지운 작업의 번호를 다시 쓰나. 지금 목업은 '프로젝트 작업 수 + 1' 이라 3번을 지우면 다음 작업이 3번을 다시 받는다. 보통은 안 되돌린다(시퀀스로 발번하고 구멍을 둔다). **서버 의견:** ① **프로젝트별로 센다** — 접두사가 프로젝트마다 다른데 번호를 전역으로 세면 `HW-1` 다음이 `HW-7` 이 되어 사람이 읽는 값이라는 뜻이 사라진다 ② **지운 번호를 다시 쓰지 않는다** — 회의록 · 대화에 적힌 `HW-3` 이 나중에 다른 작업을 가리키게 되면 기록이 거짓말을 한다. 지금 목업의 '작업 수 + 1' 은 3번을 지우면 다음 작업이 3번을 다시 받는다. 구현은 `project` 에 '다음 번호' 열을 두고 작업을 만들 때 그 행을 잠가 올린다(Postgres 시퀀스는 프로젝트마다 객체를 하나씩 만들어야 해서 안 쓴다). 번호에 구멍이 생기는 건 받아들인다 | **① 번호는 프로젝트별로 센다. ② 지운 번호는 다시 쓰지 않는다.** `HW-1` 과 `SL-1` 이 따로 돌고, 3번 작업을 지워도 다음 작업은 4번을 받는다 — 번호에 구멍이 생기는 건 받아들인다. 서버 의견과 같은 결론이다. **구현** — `project` 에 '다음 번호' 열을 두고 작업을 만들 때 그 행을 잠가 올린다. `MAX(번호)+1` 은 동시 등록에서 겹치므로 쓰지 않는다. **서버 구현(확정):** `project.next_task_no` 를 `UPDATE project SET next_task_no = next_task_no + 1 WHERE id = :id RETURNING next_task_no - 1` 한 문장으로 올린다 — 그 `UPDATE` 가 행 잠금을 잡아 같은 프로젝트의 동시 등록을 줄 세우고, 트랜잭션이 되돌아가면 번호도 같이 돌아온다(프로젝트마다 진짜 시퀀스를 만드는 쪽은 등록마다 DDL 이 돌고 롤백에도 번호가 안 돌아와 구멍이 더 난다). 안전망으로 `task(project_id, key)` 에 UNIQUE. `key` 는 `{taskKeyPrefix}-{번호}` 다. **따라간 것** — `server/PLAN.md` 1-1 의 `project` 에 `next_task_no`, `task` 에 그 UNIQUE 를 더하고 1-2 에 발번 규칙을 적었다 | 닫힘 |
| Q20 | 사용자 | `taskKeyPrefix`(작업 키 접두사)의 **값을 누가 정하나**. ① 프로젝트를 만들 때 사람이 넣나 — 프로젝트 등록 화면은 아직 코드에 없다(`web/PLAN.md` 5단계) ② 이름에서 자동으로 뽑나 — 이름이 한글이라('한화손보 차세대' → `HW`) 자동은 규칙을 세우기 어렵다 ③ 두 프로젝트가 같은 접두사를 써도 되나(`key` 가 전사에서 유일해야 하는지). **서버 의견:** 등록할 때 사람이 넣고(기본값 없이 필수), 프로젝트 사이에 겹치지 않게 유니크를 건다 — 그래야 `HW-4` 한 마디로 회의에서 가리킬 수 있다. **Q18 이 닫히면서 범위가 줄었다** — 서버는 `POST /api/projects` 에서 `taskKeyPrefix` 를 **필수**로 잡았다(①은 '사람이 넣는다'). 남은 것은 ③(프로젝트끼리 겹쳐도 되나 — 안 되면 409 `PROJECT_PREFIX_TAKEN` 이 선다), 글자 모양을 `^[A-Z][A-Z0-9]{0,7}$` 로 제한할지, 등록 화면이 이름에서 기본값을 제안할지다 | **프로젝트를 만들 때 프로젝트 단위로 하나 생긴다 — 사용자가 넣으면 그 값을 쓰고, 안 넣으면 서버가 임의로 만든다.** 등록 화면의 입력칸은 **선택**이다(필수가 아니다). 이름이 한글이라 자동 추출 규칙은 세우지 않는다 — 안 넣었을 때 서버가 만드는 값은 이름에서 뽑는 것이 아니라 겹치지 않는 임의 문자열이면 된다. **접두사는 프로젝트 사이에 유니크하다** — 그래야 `HW-4` 한 마디로 회의에서 가리킬 수 있고, '임의 생성' 도 겹치지 않아야 뜻이 선다. **서버가 정할 것** — ① 임의 생성 규칙(길이 · 글자 종류) ② 사용자가 넣은 값이 이미 쓰이고 있으면 400 으로 돌려준다고 보는데, 그 `code` 와 문구 ③ 형식 제약(대문자 · 길이 상한 · 한글 허용 여부). 이 셋은 계약을 막지 않으니 구현하며 정하고 결정 로그에 남겨라 | 닫힘 |
| Q21 | 서버 | **`ProjectInput.taskKeyPrefix` 가 필수인가 선택인가 — 계약 안에서 두 절이 어긋난다.** `## 요청 스키마 — ProjectInput` 은 "**`taskKeyPrefix` 는 필수다**(Q18 ②) … 빈 문자열을 받지 않는다 — 422" 로 적혀 있는데, 뒤에 닫힌 **Q20(사용자)** 은 "등록 화면의 입력칸은 **선택**이다(필수가 아니다). 안 넣으면 서버가 겹치지 않는 임의 문자열을 만든다" 로 닫았다. 사용자 답이 나중이고 제품 결정이라 **프론트는 선택으로 세웠다** — `web/src/components/app/ProjectCreateDialog.vue` 의 입력칸이 '선택' 이고, 비우면 목업이 `PJ1` 같은 겹치지 않는 값을 붙인다(`web/src/lib/project.ts` 의 `makeTaskKeyPrefix`). 서버가 `ProjectInput` 절을 Q20 에 맞춰 고쳐 달라 — `taskKeyPrefix` 를 선택으로 두고, 빈 값이면 서버가 만들고, 422 는 '적었는데 형식이 틀렸을 때' 만. 겸해서 ① 서버가 만드는 값의 규칙(길이 · 글자 종류) ② 프론트가 그 값을 **미리 보여 줄 수 있나** — 지금 등록 폼은 비워 두면 붙을 값을 미리 찍어 준다. 서버가 다른 값을 만든다면 응답의 `Project.taskKeyPrefix` 로만 알 수 있으니 미리보기를 '저장하면 자동으로 붙습니다' 로 바꾸겠다 | | 열림 |
| Q22 | 서버 | **main 의 서버 구현과 `Project` 계약이 어긋난다.** 두 갈래로 따로 만들어져 계약을 안 거친 쪽이 생겼다. ① **필드가 안 나간다** — `server/app/schemas/project.py` 의 `ProjectOut` 이 `id` · `name` 둘뿐이고 "key_prefix 는 내보내지 않는다 — 화면의 Project 는 id · name 둘뿐이다" 라고 적혀 있다. 그런데 `domain.ts` 의 `Project` 는 `taskKeyPrefix` 를 들고 있고 프로젝트 목록 화면이 그 값을 찍는다 ② **이름이 다르다** — 서버는 `key_prefix`(→ `keyPrefix`), 계약은 `taskKeyPrefix`(Q9 에서 정했다) ③ **필수/선택이 다르다** — `ProjectCreate` 가 `key_prefix` 를 필수로 받는데, **Q20 은 선택으로 닫혔다**(안 넣으면 서버가 임의 생성). 서버 주석이 "화면에 프로젝트 등록이 아직 없어 계약이 없는 자리다" 라고 적고 있는데, 이제 있다(`web/src/views/ProjectsView.vue` · `ProjectCreateDialog.vue`). **계약(Q9 · Q20)이 정본이다 — 서버를 그쪽에 맞춰라** | | 열림 |

## 결정 로그

| 날짜 | 무엇을 | 왜 |
| --- | --- | --- |
| 2026-09-28 | 서버 구현이 두 갈래로 갈려 `Project` 계약이 어긋난 것을 발견했다 (Q22) | 한쪽이 계약 문서를 안 거치고 만들어졌다. 서버 코드 주석이 "화면에 프로젝트 등록이 아직 없어 계약이 없는 자리다" 라고 적고 있는 것이 증거다 — 계약이 없으면 추측으로 메우게 된다 |
| 2026-09-28 | 멤버는 **전사 공통**. 스냅샷에 싣지 않고 `GET /api/members` 로 따로 받는다 (Q6 · Q5 확정) | 프로젝트를 바꿔도 안 바뀌는 값이라 스냅샷에 실으면 매번 다시 받는다. 프로젝트별로 갈라야 하면 그때 `project_member` 를 더한다 |
| 2026-09-28 | 회의에 **녹음을 두지 않는다** (Q11) | 타입에도 테이블에도 없고 주석에만 살아 있던 유령이다. 파일 업로드 · 스토리지가 같이 따라오는 일이라 필요해질 때 제대로 연다. `stores/meeting.ts` 주석에서 걷어낸다 |
| 2026-09-28 | 링크는 **같은 프로젝트 안에서만** 선다. 400 + 링크 테이블 복합 FK (Q13) | 지금 스토어는 상대를 못 찾으면 조용히 버려서, 넘어간 링크가 화면에서 사라지고도 DB 에 영영 남는다. 고칠 화면이 없는 데이터는 안 만드는 게 낫다 |
| 2026-09-28 | `taskKeyPrefix` 는 **등록할 때 선택 입력, 없으면 서버가 임의 생성**. 프로젝트 사이에 유니크 (Q20) | 이름이 한글이라 자동 추출 규칙이 안 선다. 필수로 하면 등록이 막히고, 유니크가 아니면 `HW-4` 가 둘이 되어 회의에서 한 마디로 못 가리킨다 |
| 2026-09-28 | 프로젝트가 0개면 **프로젝트 등록 화면**으로 보낸다. 빈 배열은 정상 상태다 (Q18) | 시드로 프로젝트 하나를 보장하면 '비어 있는 조직' 이라는 진짜 상태를 영영 못 만난다. 첫 화면이 등록이면 빈 상태가 곧 온보딩이다 |
| 2026-09-28 | `task.key` 번호는 **프로젝트별로 세고 지운 번호를 다시 쓰지 않는다** (Q19) | 접두사가 프로젝트마다 다른데 전역으로 세면 `HW-1` 다음이 `HW-7` 이 되어 사람이 읽는 값이라는 뜻이 사라진다. 회의록에 적힌 `HW-3` 이 나중에 다른 작업을 가리키면 기록이 거짓말을 한다 |
| 2026-09-28 | 이 문서를 계약의 자리로 둔다 | 두 에이전트가 직접 말하지 못하고 에이전트 컨텍스트는 세션과 함께 사라진다. 남는 자리가 필요하다 |
| 2026-09-28 | `createdAt` 은 **ISO 8601 UTC(`Z`)** 로 낸다. 날짜뿐으로 맞추지 않고 프론트가 `lib/date.ts` 를 고친다 (Q3) | 한 회의에서 여러 줄이 같은 날 들어온다. 날짜뿐이면 같은 날 안의 순서를 잃는데, 그 순서가 곧 안건 이력의 순서다. 사람이 고른 날짜(`Meeting.date` · `Task.start` · `Task.due`)는 그대로 `YYYY-MM-DD` — 시간대가 없는 값이다 |
| 2026-09-28 | `entries` 는 **배열 순서 = 등록 순서**가 계약이다. 정렬 키가 아니라 순서 자체를 약속한다 (Q4) | 한 회의 · 한 안건에 남긴 줄들은 `at` 도 `createdAt` 도 같아 시간으로 못 가르고, UUID 는 사전순이 등록순과 무관하다. 화면이 기대는 건 적은 순서뿐이다 |
| 2026-09-28 | 스냅샷에 `project` 는 싣고 `members` 는 안 싣는다 (Q5 · Q7) | 프로젝트는 스냅샷과 수명이 같아 딥링크 한 방으로 끝나고 늦게 온 응답도 가릴 수 있다. 멤버는 프로젝트가 바뀌어도 안 바뀌어서 같이 실으면 매번 다시 받는다 |
| 2026-09-28 | 에러는 HTTP 상태 + `{ code, message, detail? }` 로 통일한다. 없는 프로젝트는 **404** (Q14) | 빈 배열 여섯은 '레코드가 없는 프로젝트' 와 구분이 안 돼 오타 난 주소를 정상인 척 그린다 |
| 2026-09-28 | 첫 읽기 API 를 **프로젝트 스냅샷 한 방**(`ProjectSnapshot`)으로 올린다. 원본 여섯 배열만 주고 집계는 프론트가 계속 계산한다 | 지금 스토어가 "레코드를 다 들고 화면에서 계산"하는 구조다(`stores/data.ts`). 같은 모양으로 주면 스토어의 목업 배열만 갈아끼우면 되고, 계산과 그 테스트를 두 벌 갖지 않는다 (`server/PLAN.md` 2단계) |
| 2026-09-28 | 안건 상태는 **셋**(`queued` · `open` · `decided`). '미룸' 은 상태가 아니라 Entry 다 (Q1) | 같은 안건이 여러 번 미뤄진다 — 상태로 두면 덮어써져 횟수가 사라진다. `memo.md` 의 넷은 옛 표기라 그쪽을 고친다 |
| 2026-09-28 | 작업 상태는 **넷** — 해야 할 일 · 진행 중 · **막힘** · 완료 (Q2) | '막힘' 은 걸어 둔 안건이 안 정해져 멈춘 상태다. 이 제품에서 작업이 멈추는 가장 흔한 이유라 칸반의 칸으로 세울 값어치가 있다 |
| 2026-09-28 | `entry` 에 **단조 증가 열 `seq`** 를 두고 `entries` 를 `seq ASC` 하나로 낸다. JSON 에는 안 나간다 (Q15) | 계약이 '등록 순서' 라 순서를 직접 들고 있는 열이 필요하다. 한 트랜잭션에 들어간 줄은 `created_at` 이 같고, 시계에 기대면 NTP 되감김 · 여러 인스턴스에서 뒤집힌다 |
| 2026-09-28 | 부모(`task.parentId` · `thread.parentThreadId`)는 **같은 프로젝트만**. 서비스 검사 + 복합 FK 로 DB 까지 막는다 (Q16) | 넘으면 화면에 에러가 안 뜨고 계층만 조용히 틀린다 — `pathLabel` 이 '최상위 작업' 으로 잘못 찍히고 `subThreads` 가 통째로 빠진다 |
| 2026-09-28 | 빈 값은 `null` 이 아니라 `''` · `[]`. DB · ORM · 응답 스키마 **세 겹**으로 막고 응답 직전 변환은 두지 않는다 (Q17) | 한 겹이라도 새면 화면이 `.length` 에서 터진다. 직전 변환은 모델이 틀린 것을 덮어 다음에 또 샌다 |
| 2026-09-28 | `taskKeyPrefix` 규칙 셋을 서버가 정했다 (Q20 이 넘긴 자리) — ① 형식은 `^[A-Z][A-Z0-9]{0,7}$` ② 안 넣으면 헷갈리는 글자(I·O·0·1)를 뺀 **네 글자**를 뽑고 겹치면 다시 뽑는다 ③ 이미 쓰는 값이면 **409 `PROJECT_PREFIX_TAKEN`** | 회의에서 소리 내어 가리키는 값이라 한글 · 공백 · 소문자는 쓸모가 준다. 이름에서 뽑는 건 한글이라 규칙이 안 선다. 네 글자면 32^4 라 부딪힐 일이 사실상 없다. 형식 오류(422)와 자원 충돌(409)은 화면이 다르게 다뤄야 해서 갈랐다 |
| 2026-09-28 | 프로젝트가 없으면 `GET /api/projects` 가 **빈 배열**을 낸다(에러 아님). 시드로 하나를 억지로 보장하지 않고, **`POST /api/projects` 만 2단계로 끌어올린다**. 등록 요청의 `taskKeyPrefix` 는 필수 (Q18) | 빈 상태에서 앱을 여는 유일한 길이라 이게 없으면 2단계를 시드 없이 확인할 수 없다. 시드로 가리면 빈 상태가 처음 도는 곳이 사내 배포가 된다. 접두사를 선택으로 두면 거기서 작업을 만드는 순간 키를 못 만든다 |
| 2026-09-28 | `task.key` 번호는 **프로젝트별**이고 지운 번호를 다시 쓰지 않는다. `project.next_task_no` 를 `UPDATE ... RETURNING` 으로 잠가 올린다 (Q19) | `MAX(번호)+1` 은 동시 등록에서 두 트랜잭션이 같은 값을 읽어 겹친다. 프로젝트마다 진짜 시퀀스를 만들면 등록마다 DDL 이 돌아 마이그레이션 · 백업이 무거워지고 롤백에도 번호가 안 돌아온다. 행 하나를 잠그는 비용은 사람 손 속도의 작업 등록에서 문제가 되지 않는다 |
| 2026-09-28 | `Project` 에 작업 키 접두사 필드를 더하고 **서버가 `task.key` 를 발번한다** (Q9) | 접두사를 꺼낼 자리가 없어 목업이 전 프로젝트에 `HW-` 를 붙이고 있었다. 번호를 세는 건 동시성 문제라 프론트가 가질 일이 아니다. 번호 규칙은 Q19 |

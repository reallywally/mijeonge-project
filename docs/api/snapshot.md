# 스냅샷 · 프로젝트 등록

`../../API.md` 의 엔드포인트 표가 가리키는 모양의 자세한 절이다.

## 응답 스키마 — `ProjectSnapshot`

`GET /api/projects/{projectId}/snapshot`.
**원본만 준다.** `ThreadRow` · `ThreadDetail` · `TaskRow` ·
`TaskDetail` · `TaskThreadRow` 같은 계산된 타입은 담지 않는다 — 지금대로 프론트 스토어가 만든다.

타입은 전부 `web/src/types/domain.ts` 의 것을 그대로 쓴다. 서버가 이름을 새로 짓지 않는다.

```ts
import type {
  Entry, Project, Task, TaskThreadLink, Thread,
} from '@/types/domain'

/** GET /api/projects/{projectId}/snapshot */
export interface ProjectSnapshot {
  /** 고른 프로젝트 자신 (Q7). 딥링크로 바로 들어와도 헤더가 서고,
      프로젝트를 빨리 바꿨을 때 늦게 온 옛 응답을 id 로 가릴 수 있다 */
  project: Project
  threads: Thread[]
  entries: Entry[]
  tasks: Task[]
  taskThreadLinks: TaskThreadLink[]
}
```

`project` 를 뺀 네 배열이 `data.ts` 의 `allThreads` · `allEntries` · `allTasks` · `taskThreads` 로
들어간다. **JSON 키와 스토어 이름은 넷 다 다르다** —
JSON 키는 픽스처 export 이름을 그대로 쓰고, 옮기는 네 줄은 `src/api/` 가 갖는다.

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
| `entry_detail` | `Entry.detail: string[]` |
| `thread_option` | `Thread.options: string[]` |
| `task_line` | `Task.body: TaskLine[]` (`id` · `kind` · `text` · `done` · `level`) |

### 무엇이 담기나 — 프로젝트로 거르는 기준

| 키 | 기준 |
| --- | --- |
| `threads` | `thread.projectId === projectId` |
| `entries` | `entry.threadId` 가 위 `threads` 안에 있는 것. **`Entry` 에는 `projectId` 가 없다** — 안건을 타고 걸러진다 |
| `tasks` | `task.projectId === projectId` |
| `taskThreadLinks` | `taskId` 가 위 `tasks` 안에 있는 것 (Q13 — 프로젝트를 넘는 링크를 어떻게 할지) |

페이징 · 필터 · 정렬 파라미터는 없다. 프로젝트 하나치를 통째로 준다 (Q8 닫힘).

**다시 볼 기준** — 한 프로젝트가 **작업 500 · 안건 300** 중 하나를 넘으면
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
| `tasks` | `created_at ASC, id ASC` | 아니다 |
| 링크 둘 | 두 id 오름차순 | 아니다 |

기대하지 않는 넷도 **같은 데이터면 늘 같은 순서**로 낸다. 응답이 요청마다 흔들리면 눈으로 비교할 수 없다.

### 빈 값은 `null` 이 아니다

`null` 이 나갈 수 있는 필드는 **아래 여섯 이름뿐**이다. 나머지는 빈 문자열 `''` · 빈 배열 `[]` 로 낸다 (Q17 닫힘).

| 타입 | `null` 을 내는 필드 |
| --- | --- |
| `Thread` | `ownerId` · `parentThreadId` · `dueDate` |
| `Entry` | `ownerId` |
| `Task` | `parentId` · `ownerId` · `start` · `due` |
| `TaskComment` | `authorId` · `editedAt` (스냅샷 밖 — `GET /api/tasks/{taskId}/comments` 로만 나간다) |

그래서 `Entry.note` · `Thread.description` 은 `''`, `Thread.options` · `Entry.detail` · `Task.body` 는
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
| `currentMemberId` | 인증이 없어 서버가 낼 값이 없다. 화면 헤더에서 사람이 고르고 브라우저에 기억한다 (Q12 — 2026-10-12 바뀜) |
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
나머지 여섯은 스냅샷이 다 덮고, `currentMemberId` 는 프론트가 든다 — 헤더에서 고른 값이다(Q12).

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
- **빈 문자열은 '안 넣은 것' 과 같다** (Q24). 키를 빼도 되고 `""` 를 보내도 된다 — 서버가 접고 만들어 준다.
  앞뒤 공백은 떼어 받는다(`" POR "` → `POR`). 값 안에 공백이 있으면 형식 오류다
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

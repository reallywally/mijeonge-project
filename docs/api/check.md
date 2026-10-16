# 확인 요청 — 합의 (2026-10-16)

> 기획은 `docs/check-request-proposal.md`, 결정은 `docs/api/decisions.md` Q38 ~ Q41(닫힘).
> 이 파일은 **1차(요청 · 목록 · 확인 · 배지)** 의 계약이다. 확인율 분석(AX)은 기록이 쌓인 뒤 2차로 따로 세운다 — 아래 '2차'.
> 순서는 `server/PLAN.md` 11단계 · `web/PLAN.md` 12단계.

작업 · 안건에 붙는 **'확인해 주세요' 한 줄**이다. 쪽지가 아니다 — 답 · 대화 · 읽음 · 기한 · 다시 알리기 · 수정 · 삭제가 없다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 붙는 곳 | 작업이나 안건 **하나에 꼭** 붙는다 (`targetType` · `targetId`) | 맥락 없는 요청은 메신저의 일이다 |
| 한 줄 = 한 사람 | 여럿에게 보내면 **받는 사람 수만큼 줄**이 생긴다. 한 번에 보낸 줄은 같은 `text` · `createdAt` 을 갖는다 | 상태가 사람마다 하나라 줄 하나가 곧 '보냄 → 확인' 이다 |
| 상태 | `confirmedAt` 이 `null` 이면 대기, 있으면 확인. **시간이 지나도 바뀌지 않는다** (Q40) | 두 상태뿐이다. 따로 `state` 를 두지 않는다 |
| 걸린 것이 끝나면 | 작업 '완료' · 안건 '결정' 이어도 그대로 대기 (Q41) | 일이 끝났다고 확인한 것은 아니다 |
| 걸린 것을 지우면 | 요청도 같이 지운다(cascade) | 걸 데가 없는 요청은 뜻이 없다 |
| 보이는 범위 | **프로젝트 멤버 모두** 그 프로젝트의 요청을 본다 | 작업 댓글과 같다. 상세에 '이 작업에 걸린 요청' 을 띄우려면 필요하다. 받은 것 · 보낸 것은 화면이 거른다 |
| 읽기 | **프로젝트의 요청 전부를 한 번에** — 거르기 · 정렬은 화면이 한다 | '집계는 프론트가 한다' (공통 규칙). 프로젝트당 수백 줄 규모다 |
| 배지 | 내 대기 수. 모든 프로젝트 합과 프로젝트별 (Q38) | 다른 프로젝트에 온 요청도 보여야 한다 |
| 보낼 때 부하 | 서버가 보내는 순간 받는 사람의 부하를 **같이 저장한다**. 응답에는 싣지 않는다 | 2차 분석의 바탕. 작업 상태 이력(`task_log`)이 없어 나중엔 되살릴 수 없다 |

## 테이블

```
check_request
  id · project_id → project(cascade)
  task_id   null 가능. FK (task_id, project_id)   → task(id, project_id)   cascade
  thread_id null 가능. FK (thread_id, project_id) → thread(id, project_id) cascade
  CHECK  둘 중 정확히 하나만 null 이 아니다
  sender_id → member · recipient_id → member
  text  (1 ~ 29자, 앞뒤 공백 뗀 뒤)
  created_at · confirmed_at null 가능 · seq (Identity, unique)
  -- 보낼 때 받는 사람의 부하 (응답에 안 싣는다)
  load_open_tasks       그 프로젝트에서 받는 사람이 담당인 작업 중 완료 아닌 것
  load_blocked_tasks    그중 '막힘'
  load_due_soon_tasks   그중 기한(due)이 오늘(KST) + 3일 이하 — 이미 지난 것 포함
  load_open_threads     받는 사람이 담당인 안건 중 결정 안 된 것
index (project_id, seq) · (recipient_id, confirmed_at)
```

- 복합 FK 가 볼 `unique(id, project_id)` 는 `task` · `thread` 둘 다 이미 있다
- 3일은 리스크의 기본 '기한 임박' 과 같은 값이다 — 프로젝트 리스크 기준을 따르지 않고 **고정**한다. 기준이 바뀌면 지난 기록과 비교가 깨진다

## 모양

```ts
export type CheckTargetType = 'task' | 'thread'

export interface CheckRequest {
  id: string
  projectId: string
  targetType: CheckTargetType
  targetId: string
  senderId: string
  recipientId: string
  /** 1 ~ 29자 */
  text: string
  /** ISO 8601 UTC, Z */
  createdAt: string
  /** null 이면 대기 */
  confirmedAt: string | null
}

export interface CheckRequestInput {
  targetType: CheckTargetType
  targetId: string
  /** 1명 이상 20명 이하, 겹치면 하나로 */
  recipientIds: string[]
  text: string
}

export interface CheckPendingCount {
  /** 내가 받은 대기 수 — 내가 볼 수 있는 프로젝트 전부의 합 */
  total: number
  /** 대기가 하나라도 있는 프로젝트만 */
  byProject: Record<string, number>
}
```

- `null` 이 나갈 수 있는 이름에 **`CheckRequest.confirmedAt`** 이 더해진다 (`snapshot.md` '빈 값은 `null` 이 아니다' — 스냅샷 밖, 이 API 로만 나간다)
- `targetType` · `targetId` 로 내보낸다. DB 의 두 칸(`task_id` · `thread_id`)을 그대로 내면 `null` 이 하나 더 는다

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/checks` | 그 프로젝트의 요청 전부, `seq` 오름차순(오래된 것 먼저) | `CheckRequest[]` |
| POST | `/api/projects/{projectId}/checks` | 보내기 — `CheckRequestInput`. 받는 사람 수만큼 줄을 **한 트랜잭션**으로 만들고, 줄마다 받는 사람의 부하를 찍는다. 보낸 사람은 로그인한 사람 | `CheckRequest[]` · 201 (`recipientIds` 순서) |
| POST | `/api/checks/{checkId}/confirm` | 확인. **받은 사람만** — 그 밖은 403 `FORBIDDEN`. 이미 확인했으면 그대로 돌려준다(멱등, `confirmedAt` 안 바뀜) | `CheckRequest` |
| GET | `/api/checks/pending-count` | 헤더 배지. 지금 부여된 프로젝트만 센다 | `CheckPendingCount` |

- 프로젝트 경계는 다른 API 와 같다 — 부여받지 않은 프로젝트는 404 `PROJECT_NOT_FOUND`, `/api/checks/{checkId}` 는 `require_scope` 가 요청의 프로젝트로 본다(남의 프로젝트 요청은 404 `CHECK_NOT_FOUND`)
- 보내기 검사 순서: 422(모양 · `text` 길이 · `recipientIds` 개수) → 400 `CHECK_TARGET_NOT_FOUND` → 400 `CHECK_RECIPIENT_SELF` → 400 `MEMBER_NOT_IN_PROJECT`
- **수정 · 삭제 · 확인 취소는 없다**

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `CHECK_NOT_FOUND` | 경로의 요청이 없음 (부여받지 않은 프로젝트의 요청도 같다) |
| 400 | `CHECK_TARGET_NOT_FOUND` | `targetId` 가 이 프로젝트의 그 종류(작업 · 안건)가 아님 |
| 400 | `CHECK_RECIPIENT_SELF` | 받는 사람에 나 자신이 있음 |
| 400 | `MEMBER_NOT_IN_PROJECT` | 받는 사람이 이 프로젝트에 부여되지 않았거나 비활성 (파트와 같은 코드). `detail` 은 `{ "recipientIds.1": "…" }` 처럼 자리를 짚는다 |
| 422 | `VALIDATION_ERROR` | `text` 가 앞뒤 공백을 뗀 뒤 비었거나 30자 이상 · `recipientIds` 가 비었거나 20명 넘음 · `targetType` 이 둘 밖 |
| 403 | `FORBIDDEN` | 받은 사람이 아닌데 확인 |

## 구현에서 메운 것 (서버 11-1 · 화면 12-1, 2026-10-16)

계약이 말하지 않아 정했다. 서버와 목업이 같게 맞췄다.

- **받는 사람 1 ~ 20명은 겹친 것을 합치기 전에 센다.** 겹친 사람은 처음 나온 자리 하나로 합치고 응답도 그 순서다
- **`detail` 자리** — `CHECK_RECIPIENT_SELF` 는 `{ "recipientIds.N": … }`, `CHECK_TARGET_NOT_FOUND` 는 `{ "targetId": … }`, `MEMBER_NOT_IN_PROJECT` 는 걸린 사람을 **전부** `recipientIds.N` 으로 싣는다. N 은 보낸 배열에서 처음 나온 자리
- **확인은 받은 사람만** — 보낸 사람 · 시스템 관리자도 403. 시스템 관리자는 부여 없이도 보낼 수는 있다(다른 쓰기와 같은 경계). 본문의 `senderId` 는 버린다
- **대기 수** 는 시스템 관리자라도 부여된 프로젝트만 센다
- **부하** — 담당은 `owner_id`. 기한 임박은 `due <= 오늘(KST) + 3`, `due` 가 없는 작업은 안 든다. 셈은 `services/check.py` 의 `recipient_loads` 하나이고 시드도 이것을 쓴다
- **목업의 대상 검사** — 화면에서 새로 만든 목업 작업 · 안건은 프로젝트를 몰라 통과시킨다(댓글 목업과 같은 타협). 서버는 늘 검사한다

## 시드 · 목업 (양쪽이 같은 값을 쓴다)

p1 에 넷. **id 를 이대로 쓴다.** 부하 칸은 시드가 넣을 때 그 시각 데이터로 계산한다(목업은 들고 있지 않는다).

| id | 걸린 것 | 보낸 → 받는 | text | createdAt | confirmedAt |
| --- | --- | --- | --- | --- | --- |
| `c1` | 작업 `k22` | u1 → u3 | `스테이징 DB 구성 순서 봐 주세요` | `2026-10-14T01:00:00Z` | `null` |
| `c2` | 안건 `t3` | u3 → u1 | `외부 모델 호출 범위 의견 주세요` | `2026-10-13T02:00:00Z` | `2026-10-14T05:00:00Z` |
| `c3` | 작업 `k18` | u2 → u4 | `in · out 정의 초안 확인 부탁해요` | `2026-10-15T00:30:00Z` | `null` |
| `c4` | 작업 `k18` | u2 → u1 | `in · out 정의 초안 확인 부탁해요` | `2026-10-15T00:30:00Z` | `null` |

`c3` · `c4` 는 한 번에 둘에게 보낸 것이다. u1 로 들어오면 받은 것 대기 1(`c4`) · 확인 1(`c2`), 보낸 것 1(`c1`)이 보인다.

## 화면 (프론트가 정할 것의 테두리)

- **작업 · 안건 상세** — **[확인 요청]** 버튼 → 사람 고르기(그 프로젝트의 활성 멤버, 나 빼고, 여럿) + 한 줄(29자까지, 남은 글자 수) + [보내기]. 아래에 그 작업 · 안건에 걸린 요청 한 줄씩(보낸 → 받는 · 내용 · 대기 / 확인 시각)
- **왼쪽 메뉴 '확인 요청'** (`/checks`, 리스크 다음) — 탭 [받은 것 | 보낸 것]
  - 받은 것: 대기 먼저(오래된 순), 그다음 확인(최근 확인 순). 줄마다 걸린 작업 · 안건 칩(누르면 상세) · 보낸 사람 · 내용 · 보낸 날 · **[확인]**
  - 보낸 것: 최근 순. 받는 사람 · 내용 · 걸린 것 · 대기 / 확인(시각)
- **배지** — 메뉴 '확인 요청' 옆에 지금 프로젝트의 내 대기 수, 프로젝트 고르기에 다른 프로젝트 수. 0 이면 안 그림
- **다시 받기** — 목록은 `/checks` 에 들어올 때 · 상세를 열 때 · 내가 보내거나 확인한 뒤. 배지는 앱이 뜰 때 · 창에 포커스가 돌아올 때 · 60초마다
- [내 파트 \| 전체] 는 따르지 않는다 — 나에게 온 것 · 내가 보낸 것은 파트와 상관없다

## 2차 — 확인율 분석 (아직 계약 아님)

기획의 'AX' 절. 기록이 몇 주 쌓인 뒤 이 파일에 계약을 더한다. 테두리만 적어 둔다.

- `GET /api/projects/{projectId}/checks/stats?from=&to=` — 사람별 받은 수 · 확인 수 · 확인율 · 확인까지 걸린 시간 중앙값 · 대기와 확인의 보낼 때 부하 비교 · 갈래(과부하 · 단순 누락 · 특정 맥락 · 판단 보류). 프로젝트 관리자는 전부, 그 밖은 자기 줄만 (Q39)
- 갈래는 **규칙**이 붙이고, [AI 분석] 은 리스크 AI 요약과 같은 틀(SSE, 누를 때만, 남기지 않음)

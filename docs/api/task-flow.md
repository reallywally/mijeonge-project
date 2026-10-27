# 선행 작업 · 작업 상태 기록 — 합의 (2026-10-20)

> 프로젝트 진행 리포트(`docs/api/report.md`)의 바탕이다. 결정은 `docs/api/decisions.md` Q49 · Q50.
> 순서는 `server/PLAN.md` 13단계 · `web/PLAN.md` 14단계. 리포트(14 · 15단계)보다 먼저 한다.

지금은 "A 를 하려면 B 가 먼저" 와 "이 작업이 언제부터 진행 중인가" 를 모른다. 둘을 데이터로 남긴다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 선행 작업 | 작업마다 **선행 작업**을 지정한다(여럿). 사람이 작업 상세 · 간트에서 지정하고, **AI 가 제안하면 사람이 [적용]** 한다 | 추측은 틀리고 같은 데이터에도 흔들린다. 지정한 것만 리포트의 근거가 된다 (Q49) |
| 막지 않는다 | 선행이 안 끝나도 뒤 작업을 시작 · 완료할 수 있다. 화면이 알려 주기만 한다 | 실제 일은 겹쳐 돈다. 막으면 사람들이 선행 관계를 안 건다 |
| 상태 기록 | 작업 상태가 바뀔 때마다 **한 줄** 남긴다(`task_log`). 지우지 않는다 | "진행 중이 된 지 며칠" · "막힌 지 며칠" 의 근거 (Q50) |
| 지난 작업 | 마이그레이션이 기존 작업마다 **지금 상태로 한 줄**(`backfilled`)을 등록 시각에 남긴다 | 그보다 앞은 모른다. 리포트는 이 줄을 "적어도 이때부터" 로 읽는다 |

## 선행 작업

```
task_dependency
  project_id
  task_id        뒤 작업   FK (task_id, project_id)       → task(id, project_id) cascade
  depends_on_id  선행 작업 FK (depends_on_id, project_id) → task(id, project_id) cascade
  created_by → member · created_at
  pk (task_id, depends_on_id)
```

```ts
export interface TaskDependency {
  /** 뒤 작업 */
  taskId: string
  /** 먼저 끝나야 하는 작업 */
  dependsOnId: string
}

// 스냅샷에 실린다 — taskThreadLinks 와 나란히
export interface ProjectSnapshot { /* … */ taskDependencies: TaskDependency[] }
```

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| PUT | `/api/tasks/{taskId}/dependencies/{dependsOnId}` | 선행 작업 걸기 (멱등) | `TaskDependency` |
| DELETE | `/api/tasks/{taskId}/dependencies/{dependsOnId}` | 떼기 (멱등) | 204 |
| POST | `/api/projects/{projectId}/dependencies/suggest` | AI 가 빠진 선행 관계를 제안한다. 저장하지 않는다 | `DependencySuggestions` |

**검사** (PUT · 제안 둘 다)
- 같은 프로젝트의 작업끼리 — 아니면 404 `TASK_NOT_FOUND`
- 자기 자신은 안 된다 — 400 `TASK_DEPENDENCY_SELF`. (작업 계층을 걷으면서(Q61) 상위 ↔ 하위 검사 `TASK_DEPENDENCY_HIERARCHY` 도 걷었다 — 연관 작업은 선후를 막지 않는다)
- **순환**(B 가 이미 A 를 기다림, 몇 단계를 건너도) — 409 `TASK_DEPENDENCY_CYCLE`
- 한 작업의 선행은 20개까지 — 400 `TASK_DEPENDENCY_LIMIT`
- 작업을 지우면 같이 지운다(cascade)

**스냅샷 순서** — `taskDependencies` 는 `taskId ASC, dependsOnId ASC`.

### AI 제안 — `POST .../dependencies/suggest`

```ts
export interface DependencySuggestions {
  suggestions: DependencySuggestion[]
  /** 완료 아닌 작업이 많아 앞에서 잘랐으면 true */
  truncated: boolean
}

export interface DependencySuggestion {
  taskId: string
  dependsOnId: string
  /** 왜 — 한 문장. "DB 설치가 끝나야 스키마를 반영할 수 있다" */
  reason: string
}
```

- 본문 없음. 그 프로젝트의 **완료 아닌 작업**(최대 200개, 기한 이른 순 → 등록 순)의 key · 제목 · 연관 작업 · 기간 · 본문 앞 몇 줄 · 걸린 안건 제목과 **이미 있는 선행 관계**를 넣고, **도구 없이 한 번** 부른다(리스크 AI 요약과 같은 틀). 응답은 JSON 이라 SSE 가 아니다
- 서버가 제안마다 위 '검사' 를 돌리고 **걸리는 것 · 이미 있는 것 · 겹치는 것은 조용히 버린다**. 최대 20개
- 근거가 약하면 내지 않는다 — 제목 · 본문 · 기간에서 이유를 한 문장으로 댈 수 있는 것만
- 모델 · 분당 제한 · 오류는 챗봇과 같다(`chat_model`, 429 `CHAT_RATE_LIMITED`, 503 `CHAT_UNAVAILABLE`). 답이 모양에 안 맞으면 502 `DEPENDENCY_SUGGEST_FAILED`
- 화면은 제안을 줄마다 [적용](= PUT) · [버리기], 그리고 [모두 적용]. 적용이 409 · 400 이면 그 줄에 까닭을 띄운다

## 작업 상태 기록

```
task_log
  id · project_id · task_id → task cascade
  from_status   null 가능 (만들 때 · backfill)
  to_status
  changed_by → member, null 가능 (backfill)
  changed_at · seq (Identity, unique)
  backfilled    bool — 마이그레이션이 넣은 줄
index (task_id, seq)
```

- **상태가 바뀌는 모든 길**에서 남긴다 — 작업 등록(`null → todo` 등) · `PATCH /api/tasks/{taskId}` · `tasks/batch` · 회의록 `apply`. 상태가 그대로인 PATCH 는 남기지 않는다
- 화면에 따로 내보내지 않는다. 대신 `Task` 에 하나를 더한다

```ts
export interface Task {
  // … 그대로
  /** 지금 상태가 된 시각(task_log 의 마지막 줄). ISO 8601 UTC, Z */
  statusChangedAt: string
}
```

- `null` 이 아니다 — 모든 작업에 기록이 적어도 한 줄 있다(backfill)
- 작업 상세에 "진행 중 · 12일째" 처럼 쓴다. backfill 줄이면 "12일 이상" 으로 쓴다 — 화면은 이것을 알아야 하므로 `statusSinceBackfill: boolean` 도 같이 싣는다

```ts
  /** statusChangedAt 이 마이그레이션이 넣은 줄의 시각이면 true — 실제로는 더 오래됐을 수 있다 */
  statusSinceBackfill: boolean
```

## 연관 작업 — 작업 계층을 대신한다 (2026-10-27, Q61)

작업의 상위 · 하위(`parentId`)를 걷고 **한 방향 '연관 작업'(여럿)** 으로 바꿨다. 테스트의 상위 테스트 ·
안건의 `parentThreadId` 는 그대로다.

```
task_relation
  project_id
  task_id     건 작업    FK (task_id, project_id)    → task(id, project_id) cascade
  related_id  걸린 작업  FK (related_id, project_id) → task(id, project_id) cascade
  created_at
  pk (task_id, related_id) · check task_id <> related_id · index related_id
```

```ts
export interface Task {
  // … parentId 는 없다
  /** 이 작업이 건 연관 작업 id — 건 순서(created_at → related_id). 없으면 [] */
  relatedIds: string[]
}
```

- **한 방향** — A 가 B 를 걸면 A 의 `relatedIds` 에만 B 가 있다. B 쪽에는 안 보인다
- 스냅샷 · 작업 응답(등록 · PATCH · 일괄 · 회의록 apply · 체크) 모두 `relatedIds` 를 싣는다
- **`PATCH /api/tasks/{taskId}`** 의 `relatedIds: string[]` — **통째로 갈아끼운다**(`[]` 는 비우기, `null` 은 422).
  중복 id 는 한 번으로 친다. 최대 20개(중복을 빼고 넘으면 422 `relatedIds`)
  - 자기 자신 → 400 `TASK_RELATED_SELF` "자기 자신은 연관 작업으로 걸 수 없습니다."
  - 없거나 다른 프로젝트의 작업 → 400 `TASK_RELATED_NOT_FOUND` "연관 작업을 찾을 수 없습니다."
  - 그대로 남는 줄은 `created_at` 을 지킨다 — 순서가 안 흔들린다. 새로 건 것은 뒤에 붙고, 한 번에 건 것끼리는 시각이 같아 id 순이다
- **`POST .../tasks`** 는 `relatedIds` 를 받지 않는다(등록 뒤 상세에서 건다). `partId` 키를 안 보내면 **공통(`null`)**
- **작업 초안**(챗봇 `ProposedTask` · 회의록 작업 초안 · `tasks/batch`)은 `relatedId: string | null` 하나 —
  이미 있는 작업과 관련된 초안일 때 그 작업 id. 등록하면 새 작업 → 그 작업 한 줄이 걸린다.
  없거나 다른 프로젝트면 400 `TASK_RELATED_NOT_FOUND`(`detail` 은 `tasks.N.relatedId`). 초안 안끼리의 묶음은 없다 — 평평한 목록
- **변경 이력** — `relatedIds` 가 바뀌면 칸 `relatedIds` 를 전 · 후(id 배열)로 남긴다(`history.md`)
- **계층에 기대던 것** — 진척 · 리스크 · 리포트는 작업마다 자기 것만 센다(하위로 굴려 올리던 집계 · 연쇄를 걷었다).
  선행 작업은 자기 · 순환 · 개수만 본다
- **마이그레이션 `0021_task_relation`** — 지난 상위 관계를 **하위 → 상위** 한 줄씩 옮긴다(하위 작업의 연관 작업이
  예전 상위 작업이 된다). 그 뒤 `task.parent_id` 를 걷는다. downgrade 는 컬럼을 되살리고 연관 줄의 첫 것(건 순서)으로 채운다 —
  고리가 될 수 있는 줄은 버리지 않으므로 되돌린 계층이 고리를 품을 수 있다(되돌림은 개발용이다)
- 지난 변경 이력의 `parentId` 줄은 그대로 둔다 — 화면은 '상위 작업' 칸 이름으로 보인다

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 400 | `TASK_DEPENDENCY_SELF` | 자기 자신을 선행으로 (2026-10-27 까지는 `TASK_DEPENDENCY_HIERARCHY` 가 상위 ↔ 하위와 같이 맡았다 — Q61 로 걷음) |
| 409 | `TASK_DEPENDENCY_CYCLE` | 걸면 순환이 생김 |
| 400 | `TASK_RELATED_SELF` · `TASK_RELATED_NOT_FOUND` | 연관 작업이 자기 자신 · 없거나 다른 프로젝트 (Q61) |
| 400 | `TASK_DEPENDENCY_LIMIT` | 선행이 20개를 넘음 |
| 502 | `DEPENDENCY_SUGGEST_FAILED` | AI 제안 답이 모양에 맞지 않음 |

## 시드 · 목업

선행 관계 (p1):

| 뒤 작업 | 선행 작업 | 뜻 |
| --- | --- | --- |
| `k20` DB 설치와 초기 스키마 반영 | `k19` 서버 발급받고 접속 확인 | 서버가 있어야 설치한다 |
| `k21` 개발자 계정 배포 | `k20` | DB 가 떠야 계정을 만든다 |
| `k22` 스테이징 DB 구성 | `k20` | 개발 DB 구성을 본떠 만든다 |

상태 기록 — 시드는 작업마다 `등록 → (지금 상태)` 줄을 만들되, 리포트 시연용으로 둘을 오래 둔다:

- `k20` — `todo → doing` 을 `2026-10-08T00:00:00Z` (계획은 09-10 ~ 09-12 사흘 — 리포트의 '오래 걸림')
- `k22` — `todo → blocked` 를 `2026-10-13T00:00:00Z`
- 그 밖은 작업의 `start`(없으면 등록 시각)에 지금 상태로 한 줄. `backfilled` 는 시드에서 늘 `false`

개발 DB 는 시드를 돌리지 않는다 — 마이그레이션의 backfill 만 들어간다. 시연용 줄은 따로 넣는 스크립트(`scripts/demo_task_log.py`, 있는 줄은 건너뜀)로.

## 화면 (프론트가 정할 것의 테두리)

- **작업 상세** — 상태 옆에 "진행 중 · 12일째"(backfill 이면 "12일 이상")
  - **선행 작업** 칩 여럿 + 고르기(같은 프로젝트, 자기 빼고). 선행이 안 끝났으면 칩에 상태 점
  - **이 작업을 기다리는 작업** — 읽기만, 칩
- **간트** — 선행 관계를 화살표로 그린다(선행의 끝 → 뒤 작업의 시작). 막대 끝에서 다른 막대로 끌어 걸고, 화살표를 눌러 뗀다(확인 창). 순환은 그 자리에서 까닭을 띄운다
- **작업 화면 위 [AI 선행 관계 찾기]** — 제안 목록 창(줄마다 이유 · [적용] · [버리기], [모두 적용])

## 구현에서 메운 것 (서버)

계약이 말하지 않아 서버가 정한 것이다. 화면이 다르게 바라면 열린 질문으로 올린다.

- **검사 순서** — 404 → 자기 400 → 순환 409 → 개수 400. **이미 걸린 관계를 다시 PUT 하면 검사 없이 200**(멱등)
- **DELETE** — 뒤 작업만 본다(없거나 못 보는 프로젝트면 404). 모르는 선행 id · 없는 관계는 204 — 작업 ↔ 안건 링크 떼기와 같다
- **`task_log.changed_by`** — 요청한 사람. 시드는 그 작업의 담당자(없으면 null)
- **마지막 줄** — `seq` 가장 큰 줄(Q15). 기록이 하나도 없는 작업(있을 수 없지만)은 등록 시각 · `statusSinceBackfill: true` 로 낸다 — 500 을 내지 않는다
- **시드의 시각** — `start` 는 그날 0시 UTC. k20 · k22 는 등록 시각에 `null → todo` 한 줄을 먼저 둔다(`todo → …` 의 앞 줄)
- **AI 제안에 넣는 것** — Claude 는 작업을 **키(HW-4)** 로만 본다(id · 멤버 id 는 안 넣음). 작업마다 key · 제목 · 연관 작업의 key 목록(`related`) · 상태 · start · due · 본문 앞 3줄(줄마다 120자) · 걸린 안건 제목. 기존 선행은 넣은 작업끼리의 것만. 기한 없는 작업은 기한 있는 것 뒤
- **AI 제안 거르기** — 넣지 않은 키(완료 · 다른 프로젝트 · 지어낸 것) · 이유가 빈 것도 버린다. 받아들인 제안을 그래프에 얹어 가며 보므로 **[모두 적용] 이 서로 순환 · 20개에 걸리지 않는다**. Claude 가 낸 순서 그대로
- **AI 제안 오류** — 완료 아닌 작업이 둘 미만이면 Claude 를 안 부르고 빈 목록. 답을 ```` ```json ```` 으로 감싸도 읽는다. 거절(`refusal`) · 잘린 답도 502 `DEPENDENCY_SUGGEST_FAILED`. SDK 의 429 는 429 `CHAT_RATE_LIMITED`, 그 밖은 503 `CHAT_UNAVAILABLE`
- **`scripts/demo_task_log.py`** — 시연 줄은 그 작업의 지금 상태가 시연과 같고 backfill 말고 다른 줄이 없을 때만 넣는다(사람이 이미 바꿨으면 그 기록이 맞다). 작업이 없으면 건너뛴다

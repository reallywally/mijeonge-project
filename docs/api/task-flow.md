# 작업 상태 기록 — 합의 (2026-10-20)

> 프로젝트 진행 리포트(`docs/api/report.md`)의 바탕이다. 결정은 `docs/api/decisions.md` Q50.
> 순서는 `server/PLAN.md` 13단계 · `web/PLAN.md` 14단계. 리포트(14 · 15단계)보다 먼저 한다.
>
> **선행 작업은 2026-10-28 걷었다** (Q63, Q49 를 뒤집음) — 이 문서에 있던 '선행 작업' · 'AI 제안' 절,
> `TaskDependency` · `DependencySuggestions` · 스냅샷 `taskDependencies`, 오류 코드
> `TASK_DEPENDENCY_HIERARCHY` · `TASK_DEPENDENCY_CYCLE` · `TASK_DEPENDENCY_LIMIT` · `DEPENDENCY_SUGGEST_FAILED`
> 가 다 없어졌다. 경로(`/api/tasks/{taskId}/dependencies/…` · `/api/projects/{projectId}/dependencies/suggest`)는 404 다.
> `0023_drop_task_dependency` 가 `task_dependency` 를 걷는다. 파일 이름은 다른 문서가 링크해 그대로 둔다.

지금은 "이 작업이 언제부터 진행 중인가" 를 모른다. 데이터로 남긴다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 상태 기록 | 작업 상태가 바뀔 때마다 **한 줄** 남긴다(`task_log`). 지우지 않는다 | "진행 중이 된 지 며칠" · "막힌 지 며칠" 의 근거 (Q50) |
| 지난 작업 | 마이그레이션이 기존 작업마다 **지금 상태로 한 줄**(`backfilled`)을 등록 시각에 남긴다 | 그보다 앞은 모른다. 리포트는 이 줄을 "적어도 이때부터" 로 읽는다 |

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

## 시드 · 목업

상태 기록 — 시드는 작업마다 `등록 → (지금 상태)` 줄을 만들되, 리포트 시연용으로 둘을 오래 둔다:

- `k20` — `todo → doing` 을 `2026-10-08T00:00:00Z` (계획은 09-10 ~ 09-12 사흘 — 리포트의 '오래 걸림')
- `k22` — `todo → blocked` 를 `2026-10-13T00:00:00Z`
- 그 밖은 작업의 `start`(없으면 등록 시각)에 지금 상태로 한 줄. `backfilled` 는 시드에서 늘 `false`

개발 DB 는 시드를 돌리지 않는다 — 마이그레이션의 backfill 만 들어간다. 시연용 줄은 따로 넣는 스크립트(`scripts/demo_task_log.py`, 있는 줄은 건너뜀)로.

## 화면 (프론트가 정할 것의 테두리)

- **작업 상세** — 상태 옆에 "진행 중 · 12일째"(backfill 이면 "12일 이상")

## 구현에서 메운 것 (서버)

계약이 말하지 않아 서버가 정한 것이다. 화면이 다르게 바라면 열린 질문으로 올린다.

- **`task_log.changed_by`** — 요청한 사람. 시드는 그 작업의 담당자(없으면 null)
- **마지막 줄** — `seq` 가장 큰 줄(Q15). 기록이 하나도 없는 작업(있을 수 없지만)은 등록 시각 · `statusSinceBackfill: true` 로 낸다 — 500 을 내지 않는다
- **시드의 시각** — `start` 는 그날 0시 UTC. k20 · k22 는 등록 시각에 `null → todo` 한 줄을 먼저 둔다(`todo → …` 의 앞 줄)
- **`scripts/demo_task_log.py`** — 시연 줄은 그 작업의 지금 상태가 시연과 같고 backfill 말고 다른 줄이 없을 때만 넣는다(사람이 이미 바꿨으면 그 기록이 맞다). 작업이 없으면 건너뛴다

# 파트 — 합의 (2026-10-14)

프로젝트 안을 파트(AI · 인프라 · 기간계 연동 …)로 나눈다. **목적은 노이즈를 줄이는 것이지 막는 것이 아니다.**
디자이너가 평소에 "서버 OS 결정" 을 볼 일은 없어야 하지만, 자기 작업이 그 결정에 걸리면 바로 보여야 한다.
순서는 `server/PLAN.md` 9단계 · `web/PLAN.md` 9단계다.

## 정해 둔 것 (사용자 결정 2026-10-14)

| | 결정 | 왜 |
| --- | --- | --- |
| 성격 | **보기 범위다. 권한이 아니다.** 권한은 지금처럼 프로젝트 단위(`docs/api/auth.md`) | 작업이 멈추는 가장 흔한 이유가 **다른 파트의** 안건이다. 막으면 막힌 이유를 못 연다. 민감한 안건이 생기면 파트가 아니라 안건 단위 '비공개' 로 따로 푼다 |
| 거르는 자리 | **화면이 거른다.** 서버는 스냅샷에 프로젝트 전부를 지금처럼 싣는다 | 권한이 아니므로 서버가 숨길 이유가 없다. 챗봇도 프로젝트 전체를 찾는다 |
| 엔티티 | `part` 는 **테이블이다** — 글자 라벨도, 최상위 작업도 아니다 | 나중에 테스트 관리 같은 새 기능이 `part_id` 를 달고 매달린다. 라벨은 이름을 바꾸면 깨지고, 작업은 안건 · 테스트를 못 매단다 |
| 지우기 | **지우지 않고 보관**(`active=false`)한다 | 지난 작업 · 안건 · (나중에) 테스트 결과가 파트를 가리킨다 |
| 소속 | 작업 · 안건에 `partId` 를 **직접** 단다. 선택이다 — `null` 은 '프로젝트 공통' | 안건에도 써야 하고, 계층과 떼어야 파트를 옮겨도 계층이 안 흔들린다 |
| 사람 | 한 사람이 **여러 파트**에 속할 수 있다. 파트에 넣으려면 그 프로젝트에 부여돼 있어야 한다 | 리드 · 겸직이 흔하다 |
| 관리 | 파트 만들기 · 이름 · 보관 · 사람 넣고 빼기는 **프로젝트 관리자 · 시스템 관리자** | 이번에 만든 프로젝트 멤버 화면에 칸을 더한다 |

## 보기 규칙 — "내 파트"

화면 위쪽의 **[내 파트 | 전체]** 전환. 기본값은 **일반 사용자 = 내 파트**, **프로젝트 관리자 · 시스템 관리자 = 전체**.
고른 값은 프로젝트마다 브라우저에 기억한다. **내가 속한 파트가 하나도 없으면 전환을 숨기고 전체를 보인다.**

'내 파트' 에서 보이는 것:

**작업** — 아래 중 하나라도 맞으면
1. `partId` 가 `null`(공통)이거나 내가 속한 파트
2. 내가 담당자
3. 위 1 · 2 로 보이는 작업의 **조상** — 계층 경로 · 간트 트리가 끊기지 않게 (조상은 흐리게 그려도 된다)

**안건** — 아래 중 하나라도 맞으면
1. `partId` 가 `null`(공통)이거나 내가 속한 파트
2. 내가 담당자
3. **작업 규칙 1 · 2 로 보이는 작업에 링크로 걸린 안건** — 막힌 이유는 언제나 보인다.
   경로를 잇느라 선 조상(작업 규칙 3)의 링크는 끌어오지 않는다 — 남의 파트 묶음 아래 작업 하나를 맡았다고 그 파트의 결정이 다 딸려 오면 안 된다

- 규칙은 `web/src/lib/` 의 순수 함수 하나에 둔다. 목록 · 칸반 · 간트 · 안건 목록이 같이 쓴다
- 상세 화면을 주소(`/tasks/:id` · `/threads/:id`)로 직접 열면 '내 파트' 여도 **연다** — 거르는 것은 목록이다
- 보관한 파트도 규칙은 같다(그 파트의 옛 작업은 그 파트 사람에게 계속 보인다)

## 테이블

```
part          id · project_id → project(cascade) · name · active · created_at
              unique(project_id, name) · unique(id, project_id)   ← 복합 FK 가 참조할 자리
part_member   part_id → part(cascade) · member_id → member · created_at
              pk(part_id, member_id)
task.part_id    null 가능. FK (part_id, project_id) → part(id, project_id)
thread.part_id  null 가능. FK (part_id, project_id) → part(id, project_id)
```

- 파트는 **같은 프로젝트**의 것만 단다 — 부모 · 링크와 같은 방식(복합 FK · `decisions.md` Q13 · Q16)
- 사람을 프로젝트에서 빼면(`DELETE /api/projects/{projectId}/members/{memberId}`) 그 프로젝트 파트들에서도 같이 빠진다
- **확장 규칙** — 파트에 매달리는 새 엔티티(테스트 케이스 · 테스트 실행 …)는 `part_id` 를 같은 복합 FK 로 달고,
  위 보기 규칙에 같은 모양(공통 · 내 파트 · 담당 · 링크)으로 들어간다

## 모양

```ts
export interface Part {
  id: string
  projectId: string
  name: string
  /** false 면 보관 — 새 작업 · 안건에 고를 수 없고 관리 화면에서 접힌다 */
  active: boolean
}

export interface PartMember {
  partId: string
  memberId: string
}

// 늘어나는 필드
interface Task   { partId: string | null }
interface Thread { partId: string | null }

// ProjectSnapshot 에 키 둘이 는다
interface ProjectSnapshot { parts: Part[]; partMembers: PartMember[] }
```

- `parts` 는 이름 순(보관 포함), `partMembers` 는 `(partId, memberId)` 순
- `partId` 는 **`null` 을 낼 수 있는 이름에 더해진다**(`snapshot.md` '빈 값은 `null` 이 아니다' 의 목록에 `partId` 를 더한다)

## 엔드포인트 — 쓰기는 프로젝트 관리자 · 시스템 관리자 (그 밖은 403 `FORBIDDEN`)

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| POST | `/api/projects/{projectId}/parts` | `{ name }` 파트 만들기. 이름은 앞뒤 공백을 떼고 1 ~ 50자. 같은 프로젝트에 같은 이름(보관 포함)이 있으면 409 `PART_NAME_TAKEN` | `Part` · 201 |
| PATCH | `/api/parts/{partId}` | `{ name?, active? }` — 이름 바꾸기 · 보관 · 되살리기. 없는 파트는 404 `PART_NOT_FOUND` | `Part` |
| PUT | `/api/parts/{partId}/members/{memberId}` | 파트에 넣기 (멱등). 그 프로젝트에 부여되지 않은 사람은 400 `MEMBER_NOT_IN_PROJECT` | `PartMember` |
| DELETE | `/api/parts/{partId}/members/{memberId}` | 파트에서 빼기 (멱등) | 204 |

읽기는 스냅샷 한 방이다 — 따로 `GET` 을 두지 않는다. 파트 경로도 프로젝트 경계 검사(`require_scope`)를 그대로 탄다.

### 이미 있는 API 에서 바뀌는 것

| 자리 | 바뀌는 것 |
| --- | --- |
| `POST .../tasks` · `POST .../tasks/batch` | `partId` 를 받는다. **키를 안 보내면 상위 작업의 `partId` 를 따른다**(최상위면 `null`). `null` 을 보내면 공통. 일괄 등록은 배열 순서대로 이 규칙을 적용한다 — 챗봇 초안은 `partId` 를 안 실으니 부모를 따른다 |
| `PATCH /api/tasks/{taskId}` | `partId` 를 바꾼다(`null` 로 공통). **하위 작업은 따라 바뀌지 않는다** — 필요하면 화면이 하나씩 바꾼다 |
| `POST .../threads` · `PATCH /api/threads/{threadId}` | `partId` 를 받는다. 등록에서 안 보내면 `null` |
| 위 전부 | 이 프로젝트의 파트가 아니면 400 `PART_NOT_FOUND`, **새로** 다는 파트가 보관이면 400 `PART_ARCHIVED`. 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다 |
| `GET .../snapshot` | `parts` · `partMembers` 가 는다. `Task` · `Thread` 에 `partId` |
| `DELETE /api/projects/{projectId}/members/{memberId}` | 그 프로젝트 파트들의 `part_member` 도 지운다 |

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `PART_NOT_FOUND` | 경로의 파트가 없음 (부여받지 않은 프로젝트의 파트도 같다) |
| 400 | `PART_NOT_FOUND` | 본문의 `partId` 가 이 프로젝트의 파트가 아님 |
| 400 | `PART_ARCHIVED` | 보관한 파트를 새로 담 |
| 409 | `PART_NAME_TAKEN` | 같은 프로젝트에 같은 이름 |
| 400 | `MEMBER_NOT_IN_PROJECT` | 프로젝트에 부여되지 않은 사람을 파트에 넣음 |

## 시드 · 목업 (양쪽이 같은 값을 쓴다)

p1(한화손보 차세대)에 파트 셋. **id 를 이대로 쓴다.**

| id | 이름 | 사람 | 작업 | 안건 |
| --- | --- | --- | --- | --- |
| `pt1` | 인프라 | u3 | k4 · k19 · k20 · k21 | t1 · t2 · t4 |
| `pt2` | AI | u1 · u4 | k6 ~ k16 | t3 · t7 · t8 |
| `pt3` | 기간계 연동 | u2 | k18 | t5 |

나머지(k1 ~ k3 · k5 · k17 · t6 · t9 · t10)는 공통(`null`). p2 · p3 에는 파트가 없다(전환이 숨는 경우).
u2 는 공통 작업 k3 와 AI 파트 작업 k15 의 담당자다 — '내가 담당자' 규칙이 보이는 예다.

## 화면 (프론트가 정할 것의 테두리)

- 머리글 또는 목록 위에 **[내 파트 | 전체]** 전환 — 작업 세 탭 · 안건 목록이 같이 따른다
- 작업 · 안건 등록과 속성 칸에 **파트 고르기**(공통 + 활성 파트). 하위 작업 추가는 상위의 파트가 골라진 채 연다
- 목록 행 · 카드에 파트 칩(공통이면 안 그림). 작업 목록 조회 조건에 파트 거르기
- 프로젝트 멤버 화면(`/projects/:projectId/members`)에 **파트 칸** — 파트 만들기 · 이름 바꾸기 · 보관/되살리기, 사람마다 속한 파트 고르기

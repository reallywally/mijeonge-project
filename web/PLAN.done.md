# 프론트엔드 개발 계획 — 끝난 단계

`PLAN.md` 에서 끝난 단계를 통째로 옮겨 둔 기록이다. 지금 할 일과 진행 상황은 `PLAN.md` 에 있다.
단계가 끝나면 그 절을 여기 **아래에** 옮기고 `PLAN.md` 에는 제목과 한 줄만 남긴다. 고치지 않는다 — 그때 왜 그렇게 했는지가 남아야 한다.

## 지금 서 있는 자리 (2026-09-21)

| 화면 | 캔버스 | 코드 |
| --- | --- | --- |
| 프로젝트 목록 · 등록 | 없음 | 없음 |
| 작업 목록 · 간트 · 칸반 · 상세 · 추가 | 있음 | **없음** |
| 안건 목록 · 상세(이력) | 있음 | `/threads` + 팝업 |
| 회의 목록 · 상세 · 새 회의 | 있음 | **걷어냄** (2026-10-11) — 안건 · 이력에 집중한다 |
| 요청(`/requests`) | 옛 시안 | 있음 — **걷어낼 대상** |

그 밖에 어긋난 것

- `AppShell` 대메뉴가 `안건 · 회의 · 요청 · 일정관리`다. 지금은 `작업 · 안건` 둘.
- 프로젝트 전환이 장식이다. 스토어에 프로젝트가 `결제 안정화` 하나로 박혀 있고 데이터가 안 갈린다.
- 목업 데이터가 캔버스(한화손보 차세대 · memo 시나리오)와 딴 세상이다.
- 팝업에 URL이 없어 새로고침 · 뒤로가기가 안 산다.
- 테스트 · 린트 · API 레이어가 없다.

## 0단계 · 판 고르기

**목표** — 앞으로의 모든 작업이 빨라지는 것만 먼저 치운다.

- [x] **리포를 WSL(`~/workspace/mijeonge-project`)로 옮겼다.** `/mnt/c`(drvfs)는 inotify가 없다.
      `vite.config.ts`에 폴링 설정이 있어 HMR 자체는 돌고 있었지만, 옮기니
      `npm install` 14s → 3.4s, vite 기동 2955ms → 218ms, 폴링 CPU 부담도 사라졌다.
      폴링 설정은 걷어냈다. `/mnt/c` 사본은 지우지 않고 남겨 뒀다
- [x] eslint(flat config) + prettier — `npm run lint` · `npm run format`
- [x] vitest — `npm run test`. 첫 테스트는 `src/lib/date.test.ts`
- [x] 제품명 — `index.html` 타이틀, `package.json` 이름, `README.md`. `stores/mijeonge.ts`는
      1단계에서 쪼개면서 이름을 버린다
- [x] Vite 6 유지 (7로 올리는 건 지금 이득이 없다. 1~2단계 끝나고 다시 본다)
- [ ] **prettier 일괄 적용은 안 했다** — 지금 규칙과 어긋나는 14개 파일 대부분이 1~2단계에서
      다시 쓰인다. 파일을 건드릴 때 그때그때 맞춘다. 그래서 `format:check`는 아직 CI 조건이 아니다

**끝난 것으로 보는 기준** — 파일을 고치면 브라우저가 즉시 바뀌고, `lint` · `test` · `typecheck` 셋이 돈다.

**커밋** — `개발 판을 고른다 — lint · vitest · 이름`

## 1단계 · 모델과 껍데기

**목표** — 작업(task)이 들어올 자리를 만든다. 화면부터 만들면 두 번 고치게 된다.

### 1-1 도메인 타입

`src/types/domain.ts` 에 Task 를 더한다.

```ts
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

export interface Task {
  id: string
  projectId: string
  parentId: string | null   // 계층. 목록은 평평하게 보여주고 경로만 회색 글씨로 적는다
  key: string               // HW-4
  title: string
  body: TaskLine[]          // 체크박스 · 불릿 줄
  status: TaskStatus
  ownerId: string | null
  start: string | null      // null 둘 = 기간 미정 → 간트에 막대 없음(unscheduled)
  due: string | null
  priority: 'low' | 'normal' | 'high'
  createdAt: string
}

export interface TaskLine {
  id: string
  kind: 'check' | 'bullet'
  text: string
  done: boolean
  level: number
}
```

### 1-2 맵핑은 링크로

```ts
export interface TaskThreadLink { taskId: string; threadId: string }
```

memo의 "안건 상세에서는 맵핑 불가"는 **화면 권한**이지 모델 제약이 아니다 — 링크는 양방향으로
두고 안건 화면에서만 읽기 전용으로 렌더한다.

### 1-3 스토어 쪼개기

`stores/mijeonge.ts`(641줄) 하나를 도메인별로 나눈다.

| 새 파일 | 담는 것 |
| --- | --- |
| `stores/data.ts` | 레코드가 사는 곳 + 프로젝트 · 멤버. 도메인 스토어끼리 서로를 부르면 고리가 생겨서 레코드를 한곳에 모았다 |
| `stores/task.ts` | 작업, 작업 행 계산, 상태 변경, 링크 |
| `stores/thread.ts` | 안건 · Entry · 안건 이력 계산 |
| `fixtures/*.ts` | 목업 데이터. **캔버스와 같은 한화손보 차세대 + memo 시나리오 4개로 교체** |

### 1-4 껍데기와 라우트

- [x] `AppShell` 대메뉴를 **작업 · 안건**으로. 프로젝트 선택이 실제로 스토어를 갈아끼운다
- [x] 라우트 재편 — 팝업도 URL을 갖는다(`/threads/:id` · `/tasks/:id`)

| 경로 | 화면 |
| --- | --- |
| `/projects` | 프로젝트 목록 · 등록 (4단계에서 채움) |
| `/tasks?view=list\|gantt\|board` | 작업 세 탭 |
| `/tasks/:id` | 작업 상세 (목록 위 팝업) |
| `/tasks/new` | 작업 추가 (목록 위 팝업) |
| `/threads`, `/threads/:id` | 안건 목록 · 상세(= 수정 · 결정 · 이력) |
| `/threads/new` | 안건 추가 (목록 위 팝업) |

- [x] **`/requests` 제거** — 뷰 · 다이얼로그 · 배지 · 타입 · 라우트까지 걷어냈다
- [x] 옛 `stores/mijeonge.ts` 삭제. 화면은 새 스토어(data · thread · task)를 쓴다
- [ ] 기본 경로는 아직 `/threads` 다. 2단계에서 작업 목록이 서면 `/tasks` 로 바꾼다
- [ ] `TasksView.vue` 는 자리만 잡아 둔 화면이다 — 2-a 에서 진짜 목록으로 갈아끼운다

**끝난 것으로 보는 기준** — 작업 화면은 비어 있어도, 대메뉴가 서고 프로젝트를 바꾸면
안건 목록의 내용이 갈린다.

**커밋** — ① 모델과 스토어 분리 ② 셸 · 라우트 재편과 요청 걷어내기

## 2단계 · 작업 화면 넷

가장 큰 덩어리. 캔버스가 이미 부품을 떼어 놨으니(`TaskCreateForm` · `TaskDetailPanel`)
코드도 그 구조 그대로 간다 — 세 탭이 같은 부품을 가져다 쓴다.

### 2-a 작업 목록 (기본 탭)

- [x] 평평한 게시판. 계층을 펼치지 않고 한 줄에 하나씩
- [x] 열: 번호 · 작업 · 상태(줄에서 바로 바꾼다) · 담당자 · 기간 · 연관 안건
- [x] 제목 아래 회색 경로(`개발 › AI Biz › 가상비서`), 최상위면 `최상위 작업`, 자식 있으면 `하위 n건`
- [x] 조회 조건(제목 · 담당자) + 상태 칩(전체 · 해야 할 일 · 진행 중 · 완료 · 막힘 · **기간 미정**)
- [x] 페이징, 행 일괄 선택(담당자 · 상태 바꾸기)
- [x] 왼쪽 '눈여겨볼 것' 둘 — 기간 미정 / 막힘으로 바로 거는 버튼
- [x] 기본 경로를 `/tasks` 로 옮겼다
- [x] 화면이 실제로 뜨는지 마운트 테스트로 덮었다(`TasksView.test.ts`) — 브라우저 없이
      템플릿 오류와 거르기 동작을 잡는다. `@vue/test-utils` + jsdom
- [x] 행을 눌러 상세로, 오른쪽 위 '작업 추가' — 2-b 에서 붙였다 (`/tasks/:id` · `/tasks/new`)

### 2-b 작업 추가 · 작업 상세 (부품 둘)

- [x] `TaskCreateDialog` — 상위 작업 · 제목 · 내용(`[]` 체크박스, `-` 불릿) · 기간(미정 체크) ·
      상태 · 우선순위 · 담당자 · 연관 안건. 글을 줄로 옮기는 건 `lib/task.ts` 의 `parseTaskBody`
- [x] `TaskDetailDialog` — 2단(왼쪽 본문 · 오른쪽 필드)
  - 내용: 체크박스는 눌러서 켜고 끈다
  - 하위 작업: 진척 막대 + 표에서 바로 상태 변경. '하위 작업 추가'는 상위 작업이 채워진 채로
    추가 팝업을 연다(`/tasks/new?parent=:id`)
  - **연관 안건 맵핑** — 등록된 안건에서 고르기 · 연결 해제
  - **활동(댓글)은 뺐다** — 모델에 작업 댓글이 없다. 상태 변경 기록도 남길 자리가 없어
    같이 뺐다. 필요하면 모델에 `TaskComment` · `TaskLog` 를 먼저 세우고 다시 붙인다
- [x] 세 탭 어디서든 같은 팝업이 뜬다 — 칸반까지 붙였다. 간트는 2-d 에서 같은 부품을 건다

### 2-c 칸반보드

- [x] 칸 넷: 해야 할 일 · 진행 중 · **막힘** · 완료 (`components/app/TaskBoard.vue`)
- [x] 카드의 상태 셀렉트로 칸 이동(끌어놓기는 뒤로 미룬다). 카드에 `data-task-id` 를 달아 뒀다
- [x] 묶음 작업은 카드가 되지 않는다. 잎 작업만 올라온다
- [x] 막힌 카드는 연관 안건 배지가 강조된다 — 눌러서 안건으로 간다
- [x] 탭은 주소로 가른다 — `/tasks`(목록) · `/tasks?view=board`(칸반). 팝업(`/tasks/:id` ·
      `/tasks/new`)도 `view` 를 달고 다녀서 닫으면 열었던 탭으로 돌아간다
- [x] 칸마다 맨 아래 '작업 추가' 는 `/tasks/new?status=…` 로 그 칸의 상태가 골라진 채 열린다
- [ ] **조회 조건(검색 · 담당자 칩)은 안 붙였다** — 시안 칸반 위에는 있지만 목록 탭의 것이라
      뺐다. 카드가 늘면 다시 본다
- [ ] 진척 막대는 안 붙였다 — 시안은 진행 중 카드에 %를 그리지만 잎 작업에는 하위 작업이 없어
      모델에 셀 것이 없다

### 2-d 간트차트 (dhtmlx-gantt v10 Community)

- [x] `dhtmlx-gantt@10.0.3` (`license: mit`). `components/app/TaskGantt.vue`
- [x] 래퍼 방식 — `onMounted` 에서 `Gantt.getGanttInstance()` · `gantt.init(el)`, 스토어 →
      `gantt.parse`, `onAfterTaskDrag` 로 받아 `taskStore.setPeriod` 로 되돌리는 **단방향 고리**.
      떠날 때 `clearAll()` · `destructor()`. 탭마다 새 인스턴스라 이벤트가 쌓이지 않는다
- [x] 스토어 → 간트 옮기기는 `lib/gantt.ts` 의 순수 함수다(`toGanttItems`). 끝 날짜는 열린
      구간이라 하루를 더하고 돌아올 때 뺀다
- [x] 왼쪽 그리드는 계층 트리 — 목록 탭이 평평한 게시판인 자리의 짝이다.
      상태 · 담당자 열은 `columns` 의 `template` 으로 직접 그린다
- [x] 기간 미정은 `unscheduled` 작업으로 (막대 없이 그리드에만 선다)
- [x] 줄을 누르면 작업 상세 팝업(`/tasks/:id?view=gantt`). 접기 화살표는 접기만 하고,
      `+` 는 라이브러리가 줄을 만들지 못하게 막고 `/tasks/new?parent=…` 를 연다
- [x] 주 / 개월 눈금, 주말 회색 띠, 오늘 표시
- [x] 색은 `index.css` 토큰으로만 덮었다 — dhtmlx CSS 위에 `.tg-root` 로 가둔 `<style>` 하나
- [x] ~~라이선스 확인~~ — v10 부터 MIT (`package.json` 의 `license: mit`)
- [ ] **오늘 세로선을 marker 플러그인으로 못 그렸다** — v10 Community 번들에 marker 가 없다
      (붙어 오는 건 click_drag · drag_timeline · fullscreen · keyboard_navigation ·
      quick_info · tooltip · export_api 뿐). 오늘 칸의 오른쪽 테두리를 빨갛게 세워 대신했다
- [ ] **기간 미정 안내를 막대 자리에 못 놓았다** — 그 자리에 그릴 수 있는 `addTaskLayer` 가
      Community 에서는 지워져 있다. 그리드 제목 옆 점선 칩으로 옮겼다
- [ ] **진척 막대는 안 붙였다** — 시안은 막대를 채워 %를 그리지만 모델에 셀 것이 없다
      (칸반에서 뺀 것과 같은 이유). 상태별 색으로만 갈랐다
- [ ] **조회 조건(검색 · 담당자 칩 · 필터) · 줄 체크박스는 안 붙였다** — 목록 탭의 것이다
- [ ] `TasksView` 묶음이 680kB 다 (dhtmlx 가 통째로 들어온다). `defineAsyncComponent` 로
      늦게 받으면 기본 탭이 가벼워지지만 화면 테스트가 마운트 시점에 기대지 않게 손봐야 한다

**끝난 것으로 보는 기준** — memo 시나리오 1·2를 세 탭에서 끝까지 따라갈 수 있다.
개발 환경 설정 작업을 만들고, 안건 둘을 걸고, 막힘으로 세우고, 기간 미정을 목록에서 챙긴다.

**커밋** — 2-a / 2-b / 2-c / 2-d 각각 하나씩

## 8단계 · 로그인과 관리 화면

관리자가 등록하는 이메일 + 비밀번호 로그인(가입 화면 없음), 권한은 시스템 관리자 · 프로젝트 관리자 · 일반 사용자 셋.
관리 범위는 **사용자 관리 + 프로젝트별 사용자 부여** 둘뿐이다 — 상세 기능은 나중에 더한다.
계약은 `../docs/api/auth.md`, 서버 쪽은 `../server/PLAN.md` 8단계다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| '나' | `GET /api/auth/me` 의 `id` — 머리글의 나 고르기 · localStorage 기억을 걷어냈다 | 서버가 세션으로 안다. 화면이 고르면 거짓말을 할 수 있다 |
| 권한 판단 | `lib/access.ts` 의 순수 함수 하나 — 메뉴 숨기기 · 라우터 가드 · 목업 서버가 같이 쓴다 | 판단이 갈리면 메뉴는 보이는데 들어가면 튕기는 화면이 생긴다. 막는 것은 서버다 |
| 401 | `api/client.ts` 의 `errorOf` 한 자리에서 알리고, 라우터가 스토어를 비우고 `/login?next=` 로 보낸다 | 요청이 지나는 길이 여럿(request · 챗봇 스트림 · 목업)이다 |
| 로그아웃 | `stores/session.ts` 의 `clearSession` 이 스토어를 다 비운다(챗봇 대화까지) | 다른 사람이 같은 브라우저로 들어올 수 있다 |
| 목업 세션 | `api/mockAuth.ts` — 계정 · 부여 · 세션을 들고 서버처럼 권한 · 오류 코드를 낸다. 세션은 sessionStorage | 새로고침해도 로그인이 남아야 서버 모드와 같게 돈다 |
| 쿠키 | fetch 기본값(`same-origin`)으로 실린다 — Vite 프록시라 같은 출처다. 본문 없는 쓰기는 Content-Type 도 없이 (Q29) | |

### 체크리스트

- [x] `types/domain.ts` — `SystemRole` · `ProjectRole` · `Me` · `MemberAccount` · `ProjectMember` · `Member.active`,
      `TaskCommentInput` 에서 `authorId` 를 뺐다. 요청 모양 `LoginInput` · `PasswordChangeInput` · `MemberAccountInput` · `MemberAccountPatch` · `ProjectPatch`
- [x] `src/api/` — `auth.ts`(login · logout · me · changePassword) · `admin.ts`(목록 · 등록 · 수정 · 비밀번호 걸기) ·
      `projects.ts` 에 프로젝트 멤버(GET · PUT · DELETE) · 이름 수정(PATCH). 목업 갈래는 `mockAuth.ts` 를 같이 쓴다
- [x] 목업 계정 — `fixtures/accounts.ts` (시스템 관리자 하나 · p1 프로젝트 관리자 하나 · 일반 사용자들 · 이메일 없는 사람 · 비활성 한 명)
- [x] 부팅 — `auth/me` 가 맨 앞, 401 이면 `anonymous` → 가드가 `/login`. 그다음 프로젝트 · 멤버, 스냅샷 + 그 프로젝트의 멤버
- [x] 머리글 내 이름 메뉴(이메일 · 이 프로젝트에서의 권한 · 비밀번호 바꾸기 · 로그아웃). `ui/dropdown-menu` 를 레지스트리에서 받았다(애니메이션은 걷어냄)
- [x] 라우트 — `/login` · `/admin/members`(시스템 관리자) · `/projects/:projectId/members`(그 프로젝트 관리자 · 시스템 관리자) · `/projects/new`(시스템 관리자)
- [x] 빈 프로젝트 목록 — 시스템 관리자만 `/projects/new`, 그 밖은 '부여받은 프로젝트가 없습니다 — 관리자에게 요청하세요'. 등록 버튼도 시스템 관리자만
- [x] 담당자 고르는 자리(작업 · 안건 속성 · 결정의 처리한 사람 · 일괄 바꾸기)는 그 프로젝트의 활성 멤버만. 이름 찍는 자리는 '(비활성)' 을 붙인다
- [x] 목업 갈래도 담당자를 서버처럼 거른다 — `TASK_OWNER_NOT_FOUND` · `THREAD_OWNER_NOT_FOUND` · `ENTRY_OWNER_NOT_FOUND` (Q30)
- [x] 댓글 — 고치기는 작성자만, 지우기는 작성자 · 프로젝트 관리자 · 시스템 관리자
- [x] 사용자 관리 화면 — 표 · 등록 · 수정(이름 · 이메일 · 역할 · 활성) · 비밀번호 새로 걸기. 오류는 서버 message 토스트
- [x] 프로젝트 멤버 화면 — 부여된 사람 · 역할 셀렉트 · 빼기(한 번 더 묻기) · 사람 더하기 · 프로젝트 이름 수정. 나를 빼면 그 프로젝트가 목록에서 사라진다
- [x] 테스트 — `lib/access.test.ts` · `api/admin.test.ts`(목업 서버) · `stores/auth.test.ts` · `router/index.test.ts`(가드 · 401) ·
      `views/LoginView.test.ts` · `views/AdminViews.test.ts`
- [ ] 챗봇 초안 카드에는 담당자를 고르는 칸이 없다 — 서버(`propose_tasks`)가 활성 멤버만 후보로 보고, 등록 때 서버가 다시 거른다
- [ ] 로그인 시도 제한(429 `TOO_MANY_ATTEMPTS`)은 목업에 없다 — 화면은 서버 message 를 그대로 띄우므로 따로 다룰 것이 없다
- [ ] 사용자 관리 표에 검색 · 페이징은 아직 없다. 사람이 늘면 안건 목록의 조회 조건 모양을 따른다

## 7단계 · AI 챗봇 팝업 — 끝난 부분

### 7-1 껍데기 (목업)

- [x] `components/app/ChatWidget.vue` — 오른쪽 아래 둥근 버튼(lucide `MessageCircle`) → 약 400×600 패널.
      좁은 화면(`< sm`)에서는 전체 화면. `Esc` 로 닫기, 열면 입력칸에 포커스
- [x] 겹침 — `App.vue` 의 `Toaster` 를 `top-right` 로 옮긴다 (Q28 닫힘 — 열린 패널이 오른쪽 아래를 덮는다)
- [x] 빈 대화일 때 예시 질문 버튼 셋 ("서버 OS 뭐로 정했지?" · "아직 안 정해진 안건 뭐 있어?" · "막힌 작업 알려줘")
- [x] 입력 — `Textarea`, `Enter` 보내기 · `Shift+Enter` 줄바꿈, 받는 중에는 보내기 막고 **멈추기** 버튼(`AbortController`)
- [x] `VITE_USE_MOCK` 일 때는 `src/api/chat.ts` 가 가짜 스트림을 흘린다 — 서버 없이 화면을 만들고 테스트한다
      — ~~서버 모드에서는 7-2 전까지 `CHAT_UNAVAILABLE` "아직 서버에 붙지 않았습니다" 를 그 답 줄에 단다~~ 7-2 에서 지움

7-1 에서 같이 세운 것 (2026-10-11) — 7-2 가 갈아 끼울 자리:
`types/domain.ts` 의 `ChatMessage` · `ChatInput` · `ChatEvent` · `ChatRef`(계약 그대로) · `ChatLine`(화면 전용),
`api/chat.ts` 의 `streamChat` · `settle`(error 이벤트 → `ApiError` · done 없이 끝나면 `SERVER_UNREACHABLE`),
`stores/chat.ts`(`ask` · `stop` · `retry` · `reset`, 프로젝트를 바꾸면 비움), `lib/chat.ts` 의 `toChatMessages`
(done 턴만 · 20개 · 첫 줄 user), 목업 답은 `fixtures/chat.ts`. 7-2 는 `streamChat` 의 서버 갈래만 채운다

### 7-2 서버에 붙이기 (계약 `합의` 뒤)

- [x] `src/api/chat.ts` — `streamChat(projectId, messages, signal)` 이 `ChatEvent` 를 하나씩 내는 async iterator.
      스트림 전 실패는 `client.ts` 와 같이 `ApiError`, 스트림 중 `error` 이벤트도 `ApiError` 로 던진다
- [x] `types/domain.ts` 에 `ChatMessage` · `ChatInput` · `ChatEvent` · `ChatRef` (계약 그대로) — 7-1 에서 세움
- [x] `stores/chat.ts` — `ask(text)`: user 줄을 넣고 → 빈 assistant 줄에 `delta` 를 이어 붙이고 →
      `tool` 이면 "‘OS’ 안건 찾는 중…" 한 줄 → `done` 에서 끝. 실패하면 그 줄에 오류를 달고 다시 묻기 버튼
- [x] **창을 닫거나** 프로젝트를 바꾸면 받는 중인 요청을 끊고 대화를 비운다 (Q26) — 서버 갈래에서도
      `fetch` 의 signal 을 끊고 본문 reader 를 닫는다(테스트로 확인)

7-2 에서 세운 것 (2026-10-11): `api/chat.ts` 의 `parseSse`(바이트 조각 → SSE 덩어리. 조각 경계 · 한글 바이트 ·
`\r\n` · `\r` · `:` 줄 · 여러 줄 data) · `toChatEvent`(`event:` 줄이 type, 모르는 event 는 건너뜀, 모양이 아니면
`SERVER_UNREACHABLE`) · 서버 갈래(`client.ts` 에서 뺀 `errorOf` 로 열리기 전 실패 판정). 오류 문구는
`lib/chat.ts` 의 `chatErrorText` — 챗봇 code 는 서버 `message` 를 그대로, `VALIDATION_ERROR` 는 무엇이 길었는지,
`SERVER_UNREACHABLE` 은 열리기 전(닿지 못함)과 받는 중(끊김)을 갈라 말한다. 테스트는 `api/chat.server.test.ts` ·
`stores/chat.test.ts` 의 '서버 갈래' — `fetch` 를 가짜로 바꿔 돈다

### 7-4 작업 초안 (계약 `합의` 2026-10-12)

`API.md` '## AI 챗봇 — 작업 초안'. 챗봇은 초안만 내고 사람이 [등록] 을 눌러야 저장된다.

- [x] `types/domain.ts` — `TaskProposal` · `ProposedTask` · `ChatProposal`(status · keyByTempId) · `TaskBatchInput` · `TaskBatchResult`, `ChatEvent` 에 `proposal`
- [x] `api/chat.ts` — `proposal` 이벤트(계약의 칸만 옮기고, 모양이 아니면 `SERVER_UNREACHABLE`). 목업은 "만들어" · "바꿔" 에 초안을 낸다
- [x] `api/tasks.ts` 의 `createTasksBatch` — 목업 갈래도 검사 규칙 · 오류 코드를 서버처럼 본다
- [x] `stores/chat.ts` — 초안은 **done 에서** 답 줄에 붙는다(실패 · 멈춘 답은 다음 질문에 안 실리므로). 새 초안이 오면 앞의 대기 중은 `cancelled`.
      `register` → `task.addTaskBatch` → `registered` · `keyByTempId`. 실패면 알림 · 대기 중 유지. 등록하는 동안은 새 질문을 막는다
- [x] `components/app/ChatProposalCard.vue` — 계층 들여쓰기 · 담당자 · 기간 · 우선순위(보통이 아닐 때) · [취소] [등록], 등록 뒤 작업 칩(`/tasks/:id`), 취소 뒤 한 줄로 접힘

## 9단계 · 파트

프로젝트 안을 파트(AI · 인프라 · 기간계 연동 …)로 나눈다. **보기 범위지 권한이 아니다** — 목적은 노이즈 줄이기다.
디자이너가 평소에 "서버 OS 결정" 을 안 봐도 되지만, 자기 작업이 그 결정에 걸리면 바로 보여야 한다.
계약은 `../docs/api/part.md`, 서버 쪽은 `../server/PLAN.md` 9단계다. 목업으로 먼저 돌게 만들고 서버 갈래는 계약대로 붙였다(2026-10-14).

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 거르는 자리 | 서버는 다 싣고 **화면이 거른다** — 규칙은 `lib/part.ts` 의 `visibleInMyParts` 하나. 목록 · 칸반 · 간트 · 안건 목록 · 메뉴의 수가 같이 쓴다 | 판단이 갈리면 목록에는 있는데 간트에는 없는 작업이 생긴다 |
| 원본과 보이는 것 | 스토어의 `rows` 는 그대로 두고 `visibleRows` 를 더했다. 상태 칩 · '눈여겨볼 것' 의 수는 `visibleRows` 로 센다. 상세 · 챗봇 · 상위 작업 고르기 · 안건 걸기 후보는 거르지 않는다 | 상세는 주소로 열면 '내 파트' 여도 연다(계약). 화면에 없는 것을 '몇 건' 이라 적으면 찾을 수 없다 |
| 조상 | '내 파트' 에서 조상으로만 선 작업은 간트 그리드에서 흐리게, 목록에서 제목을 회색으로. 조상에 걸린 안건도 보인다(규칙 3 을 글자 그대로) | 경로 · 간트 트리가 끊기지 않게. 상위 작업을 막은 안건은 내 작업도 막는다 |
| 간트 묶음 | 묶음인지 · 부모가 누구인지를 **건네받은 행 안에서** 본다(`toGanttItems`) | 걸러서 자식이 다 빠진 묶음을 project 로 두면 기간 없는 막대가 선다 |
| 전환 기억 | localStorage `innoflow.partScope.<memberId>.<projectId>` | 프로젝트마다 기억(계약). 같은 브라우저를 다른 사람이 쓸 수 있어 사람도 키에 넣었다 |
| 하위 작업의 파트 | 작업 추가 팝업 · 상세의 하위 작업 추가 둘 다 **늘 `partId` 를 실어 보낸다** — 상위의 파트, 보관이면 공통 | 상속에 기대면 상위가 보관 파트일 때 서버가 400 `PART_ARCHIVED` 를 낸다 (Q32) |
| 레코드 자리 | `data` 스토어가 `parts` · `partMembers` 를 들고, `stores/part.ts` 가 고른 프로젝트의 파트 · 나의 소속 · 전환 · 파트 관리를 맡는다 | '레코드는 data, 계산은 도메인 스토어' 를 그대로 |

### 체크리스트

- [x] `types/domain.ts` — `Part` · `PartMember` · `PartInput` · `PartPatch`, `Task.partId` · `Thread.partId`, `ProjectSnapshot.parts` · `partMembers`,
      `TaskInput.partId?`(안 보내면 상위를 따른다 — 키째로 빠진다) · `TaskPatch` · `ThreadInput` · `ThreadPatch` 의 `partId`
- [x] 픽스처 — `fixtures/parts.ts`(pt1 인프라 · pt2 AI · pt3 기간계 연동, 소속), 작업 · 안건의 `partId` 를 계약 '시드 · 목업' 표 그대로
- [x] `src/api/parts.ts` — 만들기 · 이름/보관(PATCH) · 넣기 · 빼기. 목업 갈래는 `mockAuth` 의 db 에 `parts` · `partMembers` 를 두고
      `PART_NOT_FOUND`(404 · 남의 프로젝트도) · `PART_NAME_TAKEN`(보관 포함) · `MEMBER_NOT_IN_PROJECT` · `FORBIDDEN` · 이름 1 ~ 50자를 본다.
      프로젝트에서 사람을 빼면 목업 db 의 파트 소속도 지운다. 스냅샷 → 스토어(`toRecords`)에 두 키
- [x] 목업 갈래의 작업 · 안건 쓰기가 `PART_NOT_FOUND`(400) · `PART_ARCHIVED` 를 낸다(`data.rejectPart`). 이미 달린 보관 파트는 그대로 둔다.
      작업 등록은 상속(`lib/part.ts` 의 `inheritedPartId`)하고 따라온 파트도 검사한다. 일괄 등록(챗봇 초안)도 상속
- [x] `lib/part.ts` — `visibleInMyParts` · `defaultPartScope` · `partChoices` · `partNameProblem` · `inheritedPartId` + `lib/part.test.ts`(시드로 사람마다 · 규칙 하나씩)
- [x] [내 파트 | 전체] — `PartScopeToggle.vue`, 작업 탭 줄 · 안건 목록 머리 줄. 기본은 일반 사용자 = 내 파트, 관리자 = 전체. 속한 파트가 없으면 숨고 전체
- [x] 파트 고르기 — `PartField.vue` 를 작업 · 안건 속성 칸에(공통 + 활성 파트 + 이미 달린 보관 파트 '(보관)'). 파트가 없는 프로젝트에서는 줄째로 숨는다
- [x] 파트 칩 — `PartChip.vue`, 작업 목록 행 · 칸반 카드 · 안건 목록 행. 공통이면 안 그린다
- [x] 작업 목록 조회 조건에 파트(전체 · 공통 · 파트마다, 보관 포함). [내 파트 | 전체] 로 거른 뒤에 한 번 더 좁힌다
- [x] 프로젝트 멤버 화면 — 파트 칸(만들기 · 이름은 칸에서 고치고 Enter/벗어나면 · Esc 되돌리기 · 보관 · '보관한 파트 N개' 접기 · 되살리기),
      표에 파트 열(사람마다 활성 파트 알약 토글, 이미 속한 보관 파트는 빼기만). 사람을 빼면 스토어의 파트 소속도 같이 걷는다
- [x] 테스트 — `lib/part.test.ts` · `stores/part.test.ts`(목업 서버) · `stores/server.test.ts` '파트 (서버 갈래)' · `views/PartViews.test.ts` · `lib/gantt.test.ts`

남겨 둔 것

- [ ] 서버 9단계가 `구현` 으로 오르면 서버 모드로 한 번 돌려 본다 — 지금은 `fetch` 를 가짜로 바꾼 테스트로만 계약 경로를 봤다
- [ ] Q32(상위가 보관 파트일 때의 상속) — 사용자 답에 따라 목업 갈래의 `addTask` 한 줄을 맞춘다
- [ ] 챗봇 답은 파트를 모른다 — '내 파트' 로 보고 있어도 챗봇은 프로젝트 전체를 찾는다(계약). 칩을 누르면 상세가 열리므로 막히지는 않는다

## 10단계 · 프로젝트 관리 · 파트 관리 나누기

사용자 요청(2026-10-14): 파트 관리를 메뉴로 떼고 파트마다 사람을 넣고 빼기 쉽게, '프로젝트 멤버' 는 **프로젝트 관리**로 이름을 바꿔
프로젝트 정보까지 다룬다. 모든 파트 × 모든 사람을 한 표에 늘어놓던 모양이 '하드코딩 같다' 는 말을 들었다.
**서버 · 계약은 그대로다** — 쓰는 엔드포인트는 9단계와 8단계의 것뿐이다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 주소 | `/projects/:projectId/settings` · `/projects/:projectId/parts?part=<id>`. 옛 `/members` 는 settings 로 redirect. 둘 다 `access: 'projectAdmin'` | 고른 파트가 주소에 있어야 새로고침 · 공유가 산다. 옛 링크는 살린다 |
| 공통 틀 | `components/app/ProjectAdminFrame.vue` — 주소의 프로젝트 = 고른 프로젝트 맞추기, 옆에서 프로젝트를 바꾸면 같은 관리 화면으로, 권한을 잃으면 `/tasks` | 두 화면이 같은 감시를 따로 들면 한쪽만 고쳐진다 |
| 파트 관리 모양 | 왼쪽 파트 목록(이름 · 사람 수 · 작업/안건 수, 보관은 접어서 아래) · 오른쪽 고른 파트 상세. `lg` 아래는 위아래 | 한 번에 한 파트만 다루면 사람이 늘어도 표가 안 커진다 |
| 고른 파트 | 주소가 정본. 없거나 이 프로젝트에 없는 id 면 첫 활성 파트로 `replace`. 스냅샷을 받기 전에는 고치지 않는다 | 서버 모드에서 받기 전에 '없는 파트' 로 보고 주소를 덮으면 공유 링크가 깨진다 |
| 사람 더하기 | 프로젝트에 부여된 **활성** 멤버 중 아직 없는 사람. 이름으로 찾고 체크해서 여럿을 한 번에 — 하나씩 `PUT`, 실패한 사람만 고른 채로 남는다. 보관한 파트에는 안 보인다 | 계약에 일괄 넣기가 없다. 보관한 파트에 사람을 더할 일은 없다(9단계에도 막혀 있었다) |
| 보관 · 빼기 | 묻지 않는다 | 되살리기 · 다시 넣기로 되돌릴 수 있다. 프로젝트에서 빼기만 한 번 더 묻는다(파트 소속까지 걷힌다) |
| 프로젝트 정보 | 이름만 고친다. 작업 키 접두사는 읽기 전용 + 이유 한 줄. 한눈 정보는 작업 · 안건 · 파트(보관 수) · 멤버(관리자 수) — 스냅샷을 받기 전에는 '—' | 이미 붙은 작업 키가 기록에 남는다. `PATCH /api/projects/{id}` 는 `name` 만 받는다 |
| 목록으로 가는 길 | 파트 상세의 '작업 N건 보기' · '안건 N건 보기' 는 `/tasks?part=` · `/threads?part=`. 두 목록이 `?part=` 를 읽어 파트 거르기를 맞춘다(`lib/part.ts` 의 `partFilterOf`). 안건 목록에도 파트 거르기를 더했다 | 작업 목록과 같은 자리 · 같은 순서. 이 프로젝트에 없는 id 면 거르지 않는다 |

### 체크리스트

- [x] 라우트 · 메뉴 — `project-settings` · `project-parts` · 옛 주소 redirect. 메뉴 '관리' 에 프로젝트 관리 · 파트 관리(같은 `canManageProject`)
- [x] `views/ProjectSettingsView.vue` — 프로젝트 정보 + 멤버(부여 · 역할 · 빼기 그대로). 파트 열은 읽기 전용 칩, 누르면 파트 관리의 그 파트
- [x] `views/ProjectPartsView.vue` — 목록 · 만들기(만들면 그 파트를 고른다) · 이름 · 보관/되살리기 · 사람 빼기 · 찾아서 여럿 더하기 · 목록 링크
- [x] `ProjectMembersView.vue` 를 지웠다
- [x] 테스트 — `views/ProjectAdminViews.test.ts`(두 화면 · 주소를 따르는 선택 · 더하기/빼기 · 이름 · 보관 · 만들기 · 빈 프로젝트),
      `router/index.test.ts`(가드 · redirect), `views/PartViews.test.ts`(목록의 `?part=`), `lib/part.test.ts`(`partFilterOf`), `views/AdminViews.test.ts` 는 새 주소로

알게 된 것

- '내 파트' 로 보는 사람이 `?part=` 로 들어오면 내 파트 범위 안에서 한 번 더 거른다 — 파트 관리의 수(전체 기준)와 다를 수 있다. 관리자는 기본이 전체라 대개 같다


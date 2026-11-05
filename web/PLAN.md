# 프론트엔드 개발 계획

캔버스에 그려 둔 화면을 실제 제품으로 옮기는 계획이다. 화면 스펙은 `../memo.md`(화면 목록 ·
시나리오)와 디자인 캔버스가 정답이고, 이 문서는 **무엇을 어떤 순서로 만들지**만 적는다.

- 제품명: **innoFlow** (옛 이름 "미정이"는 가제)
- 끝난 단계의 자세한 기록은 `PLAN.done.md` 다. 단계가 끝나면 절을 그리로 옮기고 여기에는 제목과 한 줄만 남긴다
- 디자인 캔버스: <https://claude.ai/code/artifact/d16bbaab-0156-4403-8e68-3d565c132e0d>
  (페이지: 작업 시안 · 안건 시안. 회의 시안은 회의를 걷어내면서 더는 따르지 않는다)
- 캔버스와 코드의 역할 분담 — **구조·흐름이 바뀌면 캔버스 먼저, 문구·여백·색은 코드에서 바로**.
  둘 다 최신으로 맞추려 들면 어긋난다. 캔버스는 결정의 기록, 코드가 픽셀의 정답이다.

## 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 백엔드 붙이는 시점 | **작업(task) 화면까지 목업으로 만든 뒤** | 스키마에서 제일 무거운 작업·링크·기간이 화면에서 확정된 다음 계약을 잡아야 두 번 안 고친다 |
| 간트차트 | **dhtmlx-gantt v10 Community** | 캔버스 간트 메모가 이 라이브러리 기준으로 적혀 있다. JS 라이브러리라 Vue 래퍼는 직접 쓴다. Community는 GPL 계열이라 **사내 배포 전 라이선스 확인 필요** |
| 스택 | Vue 3 + Vite + TS + Tailwind v4 + shadcn-vue(new-york · neutral) + Pinia | 이미 서 있는 것을 이어간다 |
| 테마 | shadcn 기본값. 본문 폰트만 IBM Plex Sans KR | 캔버스의 종이 톤(#faf8f4 · 세리프 제목)은 코드로 옮기지 않는다 — 한 번 옮겼다 되돌렸다 |

## 지금 서 있는 자리 (2026-09-21)

옛 스냅샷이라 `PLAN.done.md` 로 옮겼다. 지금 자리는 아래 '진행 상황' 표를 본다.

---

## 0단계 · 판 고르기

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 1단계 · 모델과 껍데기

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 2단계 · 작업 화면 넷

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

## 3단계 · API 계약과 `src/api/`

작업 화면이 끝나면 스키마에서 제일 무거운 것(작업 · 링크 · 기간)이 확정된다. 이때 붙인다.

- [x] FastAPI 쪽과 계약 합의 — OpenAPI 대신 `../API.md` 의 표 · 스키마 절로 맞췄다
- [ ] `openapi-typescript` 로 타입 생성 — **안 했다.** 계약이 `types/domain.ts` 를 정본으로 삼고
      서버가 그 모양에 맞춰 내므로 손으로 둔 타입(`TaskPatch` · `ProjectInput` · `EntryInput` ·
      `ProjectSnapshot` · `ApiErrorBody` 를 더했다)으로 간다. 어긋남이 생기면 그때 다시 본다
- [x] `src/api/` — fetch 래퍼(`ApiError` 에 code · message · detail · status, 204 는 undefined,
      못 붙으면 `SERVER_UNREACHABLE`) + `projects` · `tasks` · `threads`. 스냅샷 키 → 스토어 이름은 `toRecords`
- [x] 스토어가 api 를 부른다 — 스토어 함수 하나가 엔드포인트 하나, 화면 쪽 호출은 그대로.
      바로 저장하는 수정은 화면에 먼저 반영 → 응답 레코드로 갈아끼움, 레코드별로 마지막 요청의 응답만,
      실패하면 토스트 + 스냅샷 다시 받기. 만드는 것(`addThread` · `addTask` · `addEntry` · `addProject`)은
      응답을 기다렸다가 넣고 id 를 돌려준다(실패면 null · 버튼은 저장 중 막힘). 본문은 500ms 모아서 보내고,
      새 줄의 임시 id → 서버 id 짝을 들고 있다가 다음에 보낼 때 바꿔 싣는다(편집기의 줄 키가 안 바뀌어 포커스가 안 튄다)
- [x] `VITE_USE_MOCK` 스위치 — `'true'` 면 픽스처, 개발 기본은 서버, vitest 는 목업. 읽는 자리는 `src/api/mode.ts`
- [x] 부팅 — `projects` · `members` 병렬 → 프로젝트 고르기(localStorage 에 기억) → 스냅샷.
      프로젝트를 바꾸면 스냅샷을 다시 받고 늦게 온 옛 응답은 `project.id` 로 버린다. 0개면 `/projects/new`
- [x] 로딩 · 에러 — 첫 로딩은 화면 전체(`AppBootScreen`), 못 붙으면 '서버에 연결할 수 없습니다' + 다시 시도,
      쓰기 실패는 sonner 토스트로 서버의 `message`
- [ ] 빈 상태 — 화면마다 다시 보는 건 6단계에 남긴다
- [ ] 프로젝트 목록의 작업 · 안건 수는 고른 프로젝트만 센다(나머지는 '—'). 스냅샷이 한 프로젝트치라서다 —
      다 세려면 `GET /api/projects` 에 수가 실려야 한다(계약 변경)

## 4단계 · 안건에 집중하기

회의가 맡던 일은 이 시스템의 목적(결정이 미뤄지는 걸 막고 기록을 남기는 것)에서 벗어나 걷어냈다.
남는 것은 작업 · 안건 · 안건 이력(Entry)이다.

- [x] 회의 걷어내기 — 메뉴 · 라우트 · 화면 · 스토어 · 픽스처 · 작업 쪽 회의 링크 · `Entry.meetingId`
- [x] 안건 상세 = 수정 화면. 추가 팝업과 같은 칸(`ThreadFields` · `ThreadPropertyPanel`)을 쓰고
      고치면 바로 `updateThread`(PATCH) 로 들어간다
- [x] 결정 영역(`ThreadDecisionPanel`) — 결정한 내용 · 근거 · 처리한 사람 / 사유를 단 미루기 /
      결정 바꾸기. 상태는 여기서 남긴 줄로만 바뀐다
- [x] 결정 항목(2026-11-03) — 안건 안에서 따로 정할 것마다 결정 · 미룸 · 세부 추가, 항목이 전부 정해져야 결정됨.
      결정 영역은 'n/m 정함' + 항목 줄(✓/○) · 항목 추가 · 이름 바꾸기 · 지우기 · 안건 전체 미루기,
      이력엔 항목 태그, 목록엔 항목이 둘 이상이면 'n/m', 회의록 검토는 항목 이름(`itemTitle`)을 고친다
- [ ] 안건 이력에 **연관 작업**을 읽기 전용으로 추가 (시나리오 3에서 되돌아오는 길)

## 5단계 · 프로젝트 목록 · 등록

- [ ] `/projects` — 최상위 프로젝트를 만들고 고른다
- [ ] 고른 뒤 모든 화면이 그 프로젝트 안에서만 돈다 (1단계에서 스토어는 이미 갈려 있다)
- [ ] 빈 프로젝트 상태(작업 0 · 안건 0)가 말이 되게

## 6단계 · 품질

- [ ] vitest — 스토어 계산: 안건 이력 정렬 · `superseded` · 집계 · 기간 미정 판정 · 작업 경로
- [ ] 키보드 · 포커스 · 대비
- [ ] 빈 상태와 에러 상태를 화면마다 확인

## 7단계 · AI 챗봇 팝업

오른쪽 아래 버튼을 누르면 뜨는 채팅 창. "서버 OS 뭐로 하기로 했지?" 에 서버가 안건 이력을 찾아 답하고,
화면은 **질문을 보내고 스트림을 받아 그리기만** 한다. 계약은 `../docs/api/chat.md`,
서버 쪽은 `../server/PLAN.md` 7단계다. **계약이 `합의` 로 올라가기 전에는 `src/api/chat.ts` 를 붙이지 않는다.**

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | `App.vue` 에 **한 번만** — `RouterView` 옆, `data.status === 'ready'` 일 때만 | 어느 화면에서든 같은 대화가 이어진다. 화면마다 넣으면 이동할 때 대화가 끊긴다 |
| 받기 | `fetch` + `ReadableStream` 으로 SSE 를 직접 읽는다 | `EventSource` 는 GET 만 된다. 오류는 기존 `ApiError` 모양으로 맞춘다 |
| 상태 | `stores/chat.ts` — 메시지 · 받는 중 · 마지막 오류 | 데이터는 스토어에서만 나온다는 규칙 그대로 |
| 대화 수명 | **메모리에만. 챗봇 창을 닫으면 끝난다** — 프로젝트를 바꿔도 비운다 (Q26 닫힘) | 서버가 대화를 안 남긴다. 다시 열면 빈 대화가 기대한 모습이고, 다른 프로젝트 근거가 섞이면 안 된다 |
| 근거 | 답 안의 `[[thread:ID]]` · `[[task:ID]]` 를 칩으로 | 결정 내용을 답할 때 출처로 바로 가야 믿는다 |

### 7-1 껍데기 (목업)

**끝났다.** 자세한 기록은 `PLAN.done.md` 에 있다.

### 7-2 서버에 붙이기 (계약 `합의` 뒤)

**끝났다.** 자세한 기록은 `PLAN.done.md` 에 있다.

### 7-3 근거 칩

- [x] `lib/chat.ts` — 답 본문을 `{ text } | { ref: ChatRef }` 조각으로 쪼개는 순수 함수 + 테스트 (`splitRefs`, 11-3 에서 세움 · 칩 부품은 `ChatRefText.vue`)
- [x] 안건 칩: 제목 + `ThreadStateBadge`, 작업 칩: `key` + 제목. **스냅샷에 없는 id 는 안 그린다** — 리스크 요약의 `ChatRefText` 를 그대로 쓴다. 사용자 말풍선은 친 글 그대로 둔다
- [x] 칩을 누르면 `/threads/:id` · `/tasks/:id` 로 — 기존 상세 팝업이 뜬다. 챗봇 창은 열린 채로 둔다 (`ChatRefText` 는 `open-thread` · `open-task` 만 내고, 갈 곳은 쓰는 쪽이 정한다 — 리스크 화면은 그 자리 팝업)
- [x] 답 본문은 마크다운을 쓰지 않고 줄바꿈만 살린다 (`v-html` 을 쓰지 않는다)
  - 2026-11-03 고침 — 챗봇 답은 마크다운 몇 가지(굵게 · 기울임 · `코드` · 목록 · 제목 · 코드 블록 · 구분선)를 그린다. `lib/markdown.ts` 가 블록 · 인라인 조각으로만 나누고 `ChatRefText`(`markdown` prop)가 Vue 로 직접 그린다 — 여전히 `v-html` 은 없고 표 · 링크 · HTML 은 글자 그대로. 근거 칩은 굵게 · 목록 안에서도 선다. 리포트 · 리스크 요약은 프롬프트가 마크다운을 막아 줄바꿈만 그대로
- [x] 목업 답에 근거 표시를 넣고, 목업 `done.refs` 를 본문에서 모은다(`lib/chat.ts` 의 `collectRefs`, 리스크 요약 목업도 같이 쓴다)
- [x] 테스트 — 칩이 섬 · 미룬 횟수 · 없는 id 안 그림 · 누르면 주소 이동 + 창 유지 · 받는 중 꼬리 · 사용자 글 그대로 (`components/app/ChatWidget.test.ts` · `lib/chat.test.ts` · `api/chat.test.ts`)

### 7-4 작업 초안 (계약 `합의` 2026-10-12)

**끝났다.** 자세한 기록은 `PLAN.done.md` 에 있다.

**끝난 것으로 보는 기준** — 시드 프로젝트에서 "서버 OS 뭐로 하기로 했지?" 를 물으면 결정 내용과 안건 칩이 뜨고,
칩을 누르면 그 안건 상세가 열린다. 없는 것을 물으면 못 찾았다고 한다.

**커밋** — ① 껍데기(목업 스트림) ② 서버 붙이기 ③ 근거 칩

## 8단계 · 로그인과 관리 화면

**끝났다.** 자세한 기록(정해 둔 것 · 체크리스트 · 알게 된 것)은 `PLAN.done.md` 의 같은 제목 절에 있다.

남겨 둔 것

- [ ] 챗봇 초안 카드에는 담당자를 고르는 칸이 없다 — 서버(`propose_tasks`)가 활성 멤버만 후보로 보고, 등록 때 서버가 다시 거른다
- [ ] 로그인 시도 제한(429 `TOO_MANY_ATTEMPTS`)은 목업에 없다 — 화면은 서버 message 를 그대로 띄우므로 따로 다룰 것이 없다
- [ ] 사용자 관리 표에 검색 · 페이징은 아직 없다. 사람이 늘면 안건 목록의 조회 조건 모양을 따른다

## 9단계 · 파트

**끝났다.** 목업으로 돌고 서버 갈래는 계약(`../docs/api/part.md`)대로 붙였다. 자세한 기록은 `PLAN.done.md` 의 같은 제목 절에 있다.

남겨 둔 것

- [ ] 서버 9단계가 `구현` 으로 오르면 서버 모드로 한 번 돌려 본다
- [ ] Q32(상위가 보관 파트일 때의 상속) — 사용자 답에 따라 목업 갈래의 `addTask` 한 줄을 맞춘다

## 10단계 · 프로젝트 관리 · 파트 관리 나누기

**끝났다.** '프로젝트 멤버' 한 화면을 **프로젝트 관리**(`/admin/projects/:projectId/settings`)와 **파트 관리**(`/admin/projects/:projectId/parts?part=`)로 나눴다. 자세한 기록은 `PLAN.done.md` 의 같은 제목 절에 있다.

**2026-11-02 관리자 페이지로 옮김.** 관리 화면 셋(프로젝트 관리 · 파트 관리 · 사용자 관리)을 업무 화면 틀(AppShell)에서 떼어 관리자 페이지 틀(`components/app/AdminShell.vue`)로 옮겼다.

- 주소 — `/admin/projects/:projectId/settings` · `/admin/projects/:projectId/parts?part=` · `/admin/members`. 옛 `/projects/:projectId/settings` · `/parts` · `/members` 는 새 주소로 넘긴다(쿼리 그대로)
- `/admin` — 지금 프로젝트 관리 > 사용자 관리(시스템 관리자) > 관리할 수 있는 다른 프로젝트 > `/tasks` 순으로 첫 화면을 고른다(`lib/access.ts` 의 `adminHome`)
- 사이드바 — 맨 위 '업무 화면으로', 프로젝트 묶음(관리할 수 있는 프로젝트만 고르기 + 프로젝트 관리 · 파트 관리) · 시스템 묶음(사용자 관리). 권한 없는 묶음은 숨긴다
- 업무 화면 사이드바의 '관리' 묶음은 걷고, 관리 권한(시스템 관리자 또는 어느 프로젝트든 관리자)이 있으면 맨 아래에 '관리자 페이지' 링크 하나만 둔다
- 프로젝트 목록(`/projects`) · 등록(`/projects/new`)은 업무 화면 그대로

남겨 둔 것

- [x] ~~계약 문서의 옛 화면 주소~~ — `docs/api/part.md` · `docs/api/auth.md` 를 새 주소(settings · parts)로 고쳤다 (2026-10-14)

## 11단계 · 결정 병목 리스크 — '리스크' 메뉴

"무엇이 안 정해져서 무엇이 멈췄나" 를 왼쪽 메뉴 **'리스크'**(`/risks`)에 띄운다. 계산은 서버가 하고(`GET .../risks`)
화면은 받아 그린다 — '집계는 프론트가 한다' 의 예외다(Q35). 계약은 `../docs/api/risk.md`(합의), 서버 쪽은 `../server/PLAN.md` 10단계다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | 왼쪽 메뉴 작업 · 안건 다음 **'리스크'**, 경로 `/risks` — 위에서 고른 프로젝트 안에서 돈다 | 사용자 결정 (Q34) |
| 기준 | 화면 위에 기준 한 줄 + **[기준 바꾸기]** 대화 상자(프로젝트 관리자 · 시스템 관리자에게만 보인다) | 팀마다 회의 주기가 달라 화면에서 바꾼다 (Q33) |
| 받는 때 | 들어올 때 · 기준을 바꾼 뒤 · [새로 고침] | Q35 |
| 파트 | [내 파트 \| 전체] 를 그대로 따른다 — `threads` · `tasks` 를 `partId` 로 거르고 `owners` 는 안 거른다 | 파트는 보기 범위다 |

### 11-1 목업

**끝났다** (2026-10-15). 목업은 굳힌 보고서(`fixtures/risks.ts`)에 지금 기준과 그 기준의 등급만 맞춰 낸다 — 계산은 서버 몫.
`[내 파트 | 전체]` 는 작업 · 안건 목록과 같은 '내 파트' 규칙(`partStore.showsThread` · `showsTask`)으로 거른다. 계산 경계 둘은 `API.md` Q36 · Q37 로 물었다.

- [x] `domain.ts` 에 `RiskSettings` · `DecisionRiskReport` · `ThreadRisk` · `TaskRisk` · `OwnerLoad` (계약 모양 그대로)
- [x] `src/fixtures/risks.ts` · `src/api/risk.ts`(목업 스위치 갈래) · `stores/risk.ts`
- [x] `RiskView.vue` — 기준 한 줄 · [새로 고침] · `asOf` / 안건 리스크 표(등급 · 신호 배지 · 막는 작업 수 · 기한 넘긴 날 · 담당자) / 안건과 어긋난 작업 / 사람별
- [x] 기준 바꾸기 대화 상자 — 다섯 값, 범위 · `high > medium` 은 화면도 막고 서버 422 의 `detail` 을 칸에 붙인다
- [x] 줄을 누르면 기존 안건 · 작업 상세 팝업
- [x] 신호 이름은 화면 말로 — 기한 지남 · 기한 임박 · 여러 번 미룸 · 오래 멈춤 · 작업을 막는 중 · 작업 기한이 먼저 · 담당자 없음 · 기한 없음 / 풀어도 됨 · 막힌 이유 없음 · 결정이 기한보다 늦음
- [x] 테스트 — 뷰(표 셋 · 파트 거르기 · 관리자만 [기준 바꾸기] · 422 를 칸에) · 스토어 (`views/RiskView.test.ts` · `stores/risk.test.ts`)

### 11-3 AI 요약

리스크 화면 맨 위 'AI 요약' 카드. 계약은 `../docs/api/risk.md` 'AI 요약'(합의 2026-10-15).

- [x] `src/api/risk.ts` 에 `streamRiskSummary(projectId, { threadIds, taskIds }, signal)` — `api/chat.ts` 의 `parseSse` · `toChatEvent` · `settle` 을 그대로 쓴다. 목업 갈래는 고정 문구를 `MOCK_STEP_MS` 로 흘린다
  - 챗봇 서버 갈래의 fetch · 열리기 전 오류 판정을 `postSse(path, input, signal)` 로, 목업의 delta 흘리기를 `mockDeltas` 로 뽑아 둘이 같이 쓴다(챗봇 동작 그대로)
  - 목업 문구는 `fixtures/risks.ts` 의 `mockRiskSummary` — 보낸 id 로 거른 보고서의 숫자 · 신호만 옮겨 '답의 모양' 칸 순서대로 만든다. 모르는 id 는 버리고, 비면 `지금 짚을 리스크가 없습니다.`, 100개를 넘으면 422
- [x] `stores/risk.ts` — 요약 글 · 받는 중 · 오류 · **요약할 때 보낸 id 묶음**. 지금 보이는 줄과 다르면 '바뀜'
  - 프로젝트를 바꾸거나 `clear` · 화면을 떠나면(`resetSummary`) 받는 중이면 끊고 버린다
- [x] 카드 — [AI 요약] · [멈춤] · [다시 요약], 근거 칩은 챗봇 것 그대로(누르면 상세), 바뀌면 흐리게 + "목록이 바뀌었습니다", 0건이면 버튼 끔, 오류는 `chatErrorText`
  - 근거 칩은 7-3 이 아직이라 여기서 세웠다 — `lib/chat.ts` 의 `splitRefs` + `components/app/ChatRefText.vue`(스냅샷에 없는 id 는 안 그림, 받는 중 끝의 덜 온 표시는 뗌). 챗봇 창에도 7-3 에서 붙였다
  - 보이는 줄이 배열마다 100개를 넘으면 버튼을 끄고 "내 파트로 좁혀 주세요" — 계약의 상한(422)에 닿지 않게
- [x] 테스트 — 보낸 id 가 보이는 줄과 같음 · 파트 전환 뒤 '바뀜' · 멈춤 · 0건 · 오류 · 칩 클릭 · 떠나면 버림 (`views/RiskView.test.ts` · `stores/risk.test.ts` · `api/risk.test.ts` · `lib/chat.test.ts`)

### 11-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 시드 세 경우가 뜨는지, 기준을 바꾸면 등급이 바뀌는지 본다
- [ ] 챗봇의 `get_decision_risks` 는 화면 변경이 없다 — `tool` 이벤트의 `label` 만 띄운다

### 2026-11-05 고침 (사용자) — '안건과 어긋난 작업' 칸 걷음

리스크 화면의 '안건과 어긋난 작업' 칸을 기능째 걷었다. 서버도 같이 보고서의 `tasks` · `TaskRisk` 와 AI 요약 요청의 `taskIds` 를 뺀다(`server/` 는 다른 에이전트).
위 11-1 · 11-3 의 `tasks` · `taskIds` · 작업 신호 이름은 그 전 기록이다.

- [x] `types/domain.ts` — `TaskRisk` · `TaskRiskSignal` · `DecisionRiskReport.tasks` · `RiskSummaryInput.taskIds` 지움
- [x] `lib/risk.ts` 의 `TASK_SIGNAL_LABEL` · `api/risk.ts` 목업(빈 보고서 · 요약 거르기 · 422 검사 · 보내는 몸)· `stores/risk.ts`(`tasks` · 보이는 id · 상한 · '바뀜')에서 작업 몫을 뺌. 상한 100 은 안건 id 에만
- [x] `RiskView.vue` — 칸 · 빈 문구 지움, 요약 줄은 "보이는 안건 n건을 정리합니다". 작업 상세 팝업은 요약의 작업 칩용으로 남김
- [x] `fixtures/risks.ts` — `tasks` 지움, `mockRiskSummary` 의 "안건과 어긋난 작업 N건" 총평 · '바로 풀 수 있는 것' 칸을 뺌(안건이 없으면 빈 한 줄). 근거 작업 칩은 안건이 막는 · 기다리게 하는 작업으로만 남는다
- [x] 사람별(`owners`)은 그대로 — `blockedTasks` 는 '맡은 작업 중 막힘 수' 라 어긋난 작업을 세던 값이 아니다. 안건 리스크도 그대로. 리포트의 `isDecidedButBlocked` 는 자기 판정이라 그대로
- [x] 테스트 — 칸이 없음 · 보내는 몸이 `{ agendaIds }` 뿐 · 작업 칩을 누르면 작업 상세 (`views/RiskView.test.ts` · `stores/risk.test.ts` · `api/risk.test.ts`)

**커밋** — ① 목업 화면 ② 서버 붙이기 ③ AI 요약

## 12단계 · 확인 요청 — 작업 · 안건의 [확인 요청] · '확인 요청' 메뉴

계약은 `../docs/api/check.md`(합의 2026-10-16 · Q38 ~ Q41 닫힘), 서버 쪽은 `../server/PLAN.md` 11단계다.
쪽지가 아니다 — 답 · 읽음 · 수정 · 삭제가 없다. 두 상태(대기 · 확인)뿐이다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 데이터 | 프로젝트의 요청 전부를 `stores/check.ts` 가 들고 받은 것 · 보낸 것 · 작업/안건별을 계산한다 | '집계는 프론트가 한다'. 서버가 거르지 않는다 |
| 자리 | 왼쪽 메뉴 리스크 다음 **'확인 요청'**(`/checks`) · 작업 상세 · 안건 상세의 [확인 요청] 버튼과 걸린 요청 줄 | 계약 '화면' |
| 배지 | 메뉴 옆에 지금 프로젝트의 내 대기 수. 앱이 뜰 때 · 포커스 · 60초마다 `pending-count` | Q38 |
| 파트 | [내 파트 \| 전체] 를 따르지 않는다 | 나에게 온 것 · 내가 보낸 것은 파트와 상관없다 |

### 12-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` 에 `CheckTargetType` · `CheckRequest` · `CheckRequestInput` · `CheckPendingCount` (계약 그대로)
- [x] `src/fixtures/checks.ts`(`c1` ~ `c4`) · `src/api/checks.ts`(목업 스위치 갈래 — 목업도 서버와 같은 검사: 29자 · 나 자신 · 프로젝트 멤버 · 받은 사람만 확인) · `stores/check.ts`
  - 목업 저장소는 `mockAuth` 의 `mockDb().checks` — `resetMockAuth` 가 같이 되돌린다. 검사 순서 · 메시지 · `detail` 자리(`recipientIds.N`, 겹치면 처음 자리)는 서버 구현과 같다
  - 화면에서 만든 목업 작업 · 안건은 픽스처에 없어 프로젝트를 모른다 — 그런 id 는 통과, 픽스처에 있는데 다른 프로젝트 · 종류면 `CHECK_TARGET_NOT_FOUND`
  - 정렬은 `lib/check.ts`(`sortReceived` · `sortSent`) — 시각이 같으면 seq 순서(한 번에 보낸 줄이 받는 사람 순서대로)
- [x] 보내기 대화 상자 — 사람 여럿 고르기(활성 멤버, 나 빼고) · 한 줄 입력(남은 글자 수, 29자 넘게 안 받음) · 서버 오류는 `message` 그대로 (`components/app/CheckSendDialog.vue`)
  - 받는 사람은 고른 순서가 아니라 멤버 목록 순서로 보낸다. 보내면 닫고 'N명에게 확인을 요청했습니다.' 토스트
- [x] 작업 상세 · 안건 상세 — [확인 요청] 버튼 + 걸린 요청 줄(보낸 → 받는 · 내용 · 보낸 시각 · 대기 / 확인 시각, 내가 받은 대기면 [확인]) (`components/app/CheckRequestSection.vue`)
  - 작업 상세는 연결 아래 · 댓글 위, 안건 상세는 결정 영역 아래 · 이력 위
- [x] `ChecksView.vue` — 탭 [받은 것 | 보낸 것], 정렬은 계약대로, 걸린 것 칩(`CheckTargetChip.vue`)을 누르면 기존 상세 팝업
  - 두 탭 모두 같은 표 — 내용(+ 걸린 것 칩) · 보낸 사람/받는 사람 · 보낸 날 · 상태. 탭 옆 수는 받은 것 = 대기 수, 보낸 것 = 전체 수. [새로 고침] 을 둔다
- [x] 메뉴 배지 · 프로젝트 고르기의 다른 프로젝트 수
  - 메뉴 '확인 요청' 옆 = 지금 프로젝트의 내 대기 수, 프로젝트 고르기 칸 오른쪽 = 다른 프로젝트 합, 펼친 목록의 각 프로젝트 옆 = 그 프로젝트 수. 0 이면 안 그림
  - 받기는 `App.vue` 가 앱이 서 있는 동안(`status === 'ready'` · 로그인) `startBadge` — 곧바로 · 창 focus · 60초마다. 확인한 뒤에도 다시 받는다. 실패는 알리지 않는다
- [x] 테스트 — 스토어(거르기 · 정렬 · 보내기 · 확인 멱등 · 배지 주기) · 뷰(탭 · [확인] 뒤 대기에서 빠짐 · 칩) · 대화 상자(29자 · 나 빠짐 · 빈 사람 막음 · 서버 message) · 배지 · api(목업 검사 · 서버 경로) (`stores/check.test.ts` · `views/ChecksView.test.ts` · `components/app/CheckSendDialog.test.ts` · `api/checks.test.ts`)

### 2026-10-19 고침 (Q42 ~ Q44)

확인 요청을 '결정 알림' 으로 좁혔다 — 결정된 안건에서 버튼 하나, 내용 · 사람 고르기 없음, 결정 하나에 한 번. 위 12-1 의 작업 쪽 · 내용 · 대화 상자는 걷었다.

- [x] 타입 — `Thread.ccIds` 추가, `CheckRequest` 는 `threadId` · `entryId` 로. `CheckTargetType` · `CheckRequestInput` · `text` 를 걷었다. `ThreadInput` · `ThreadPatch` 에 `ccIds`
- [x] 픽스처 — 안건 참조(t1 · t2 · t6), `c1` ~ `c4` 계약 표 그대로
- [x] 규칙 한 벌 `lib/check.ts` — `latestDecision` · `checkRecipients`(연결 작업 담당자 → 참조, 겹침 · 나 · 비활성 빠짐) · `checkBlock`(결정 전 → 보냄 → 받을 사람 없음) · `groupByEntry`. 목업 api 와 안건 상세가 같이 쓴다
- [x] api — `POST /threads/{threadId}/checks` 본문 없음. 목업은 데이터 스토어의 안건 · 이력 · 작업을 `provideMockWorld` 로 보고(화면에서 결정 · 만든 안건도), 없으면 픽스처. 참조 검사(null · 21명 422, 새로 넣은 사람만 `MEMBER_NOT_IN_PROJECT`, 겹친 자리까지)는 데이터 스토어 `rejectCc`
- [x] 안건 상세 — 속성 칸 담당자 아래 **참조**(`CcField.vue`, 칩 + 더하기 메뉴, 바꾸면 바로 PATCH). [확인 요청] 은 결정 영역 아래 그대로 — 곁에 '받는 사람 N명'(누르면 이름 펼침 · title 툴팁), 못 누르면 까닭 한 줄. 보낸 뒤 '이 결정 확인 N / M' + 사람별, 앞 결정 묶음은 '앞 결정 N건' 으로 접음. 목록을 아직 못 받았으면 누를 수 없다
- [x] 안건 추가 — 같은 속성 칸이라 참조도 고른다
- [x] 작업 상세의 확인 요청 · `CheckSendDialog` 를 걷었다. `CheckTargetChip` → `CheckThreadChip`(안건만)
- [x] `/checks` — 받은 것: 안건 칩 · 결정 한 줄 · 보낸 사람 · 보낸 날 · [확인]. 보낸 것: 결정 묶음 한 줄(안건 칩 · 결정 한 줄 · 보낸 날 · 확인 N / M), 누르면 사람별
- [x] 테스트 — `lib/check.test.ts` · `stores/check.test.ts`(활성 조건 · 참조) · `components/app/CheckRequestSection.test.ts`(상세의 버튼 · 참조) · `views/ChecksView.test.ts` · `api/checks.test.ts`

### 12-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 u1 로 들어와 시드대로(받은 대기 1 · 보낸 묶음 1, 3명 중 1명 확인) 보이는지, 보내기 · 확인이 다른 계정에 반영되는지 본다

**커밋** — ① 목업 화면 ② 서버 붙이기

## 13단계 · 회의록 — '회의록' 메뉴

회의록 글을 붙여넣으면 AI 가 **새 안건 · 기존 안건에 붙일 이력 · 작업** 초안을 내고, 사람이 고르고 고쳐 **[등록]** 해야 저장된다.
계약은 `../docs/api/minutes.md`(합의 2026-10-19 · Q45 · Q46 닫힘, 녹음은 2단계 · Q47 보류), 서버 쪽은 `../server/PLAN.md` 12단계다.
~~회의는 따로 관리하지 않는다 — 회의록 글 · 요약은 남기지 않고 남는 것은 안건 · 이력 · 작업뿐이다.~~ → **2026-10-20 고침(Q48)**: 회의록을 게시판으로 남긴다. 아래 '2026-10-20 고침' 이 지금 모양이다(13-1 은 그 전 기록).

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | 왼쪽 메뉴 확인 요청 다음 **'회의록'**(`/minutes`) — 챗봇 창이 아니다 | 회의록은 길고 검토할 줄이 많다. 2단계 녹음 업로드도 여기에 얹는다 |
| 상태 | `stores/minutes.ts` — 글 · 단계(입력 · 정리 중 · 검토 · 등록함) · 받은 초안 · 고치는 사본(`form`) · 고른 줄 · 등록 결과 | 서버가 초안을 들고 있지 않다. 다시 정리하면 앞 초안 · 고친 값을 버린다 |
| 수명 | 메모리에만. 화면을 떠나면 비우고(쓰던 게 있으면 먼저 묻는다), 프로젝트를 바꾸면 받는 중이면 끊고 초안만 버린다(글은 둔다) | 초안의 안건 · 담당자는 그 프로젝트의 것이다 |
| 등록 결과 | 응답의 안건 · 이력 · 바뀐 안건 · 작업 · 링크를 데이터 스토어에 넣는다 — 목업 · 서버가 같은 길 | 목업 apply 는 데이터를 고치지 않고 결과만 낸다. 두 번 넣지 않게 |

### 13-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` 에 `MinutesDraft` · `ProposedThread` · `ProposedEntry` · `ProposedEntryBody` · `ProposedMinutesTask` · `MinutesEvent` · `MinutesApplyInput` · `MinutesApplyResult` (계약 그대로)
- [x] `src/fixtures/minutes.ts` — [예시 넣기] 글 `MINUTES_EXAMPLE`(10월 16일 주간 회의) · 고정 초안 `mockMinutesDraft`(p1 — 새 안건 n1 · n2(미룸) · t3 에 미룸 · 작업 셋: n1 에 · t2 에 · '최 선임' ownerHint 만) · 진행 줄 둘. quote 는 예시 글에서 글자 그대로(테스트가 대조)
- [x] `src/api/minutes.ts` — `streamMinutesDraft(projectId, text, signal)` · `applyMinutes(projectId, input)`
  - 스트림은 챗봇의 `settle`(제네릭으로 넓힘) · `postSseMessages`(챗봇 `postSse` 에서 뽑음)를 같이 쓰고 `toMinutesEvent` 로 읽는다. 초안 없이 `done` 이면 끊긴 것(`SERVER_UNREACHABLE`)
  - 목업 draft — 프로젝트 · 글 길이(1 ~ 60,000, 앞뒤 공백 뗀 뒤)를 스트림 전에 보고 진행 줄 둘 → 초안 → done
  - 목업 apply — 서버 '구현' 절과 같은 검사(422 가 먼저, 400 은 THREAD_NOT_FOUND → 안건 · 이력 · 작업 담당자 → TASK_PARENT_NOT_FOUND 의 첫 하나, 걸린 자리 전부) · 같은 생성 순서 · 같은 상태 전이. 안건 · 작업은 `provideMockWorld`(데이터 스토어)로 본다. 작업 키는 목업이면 데이터 스토어가 다시 센다(`addTaskBatch` 와 같다)
- [x] `src/lib/minutes.ts` — 검사 규칙 `minutesApplyProblems`(목업 api) · 보낼 모양 `toMinutesApplyInput`(고른 줄만, 끈 새 안건의 `threadTempIds` 를 지움, 상위가 빠진 작업은 최상위로, 담당자를 고르면 `ownerHint` 를 비움) · 오류 detail → tempId · 정리 오류 한 줄
- [x] `MinutesView.vue` + `components/app/MinutesReview.vue` · `OwnerSelect.vue`
  - 입력 — 큰 글칸 · [파일 열기](.txt · .md, 다른 확장자는 한 줄로 거절) · [예시 넣기] · 글자 수 / 60,000 · [정리]. 쓴 글을 파일 · 예시로 바꿀 때는 묻는다
  - 정리 중 — 글칸을 잠그고 진행 한 줄(`tool.label`, 처음엔 '회의록을 읽는 중') · [멈추기]
  - 검토 — 요약 · 회의 날짜 안내 · 세 묶음. 줄마다 체크(기본 켬) · 제목 · 담당자 · 기한 · 종류 · 이력 내용을 고치고 근거는 흐리게. 끈 줄은 흐리게. 글칸은 낮게 남아 고쳐서 [다시 정리] 할 수 있다
  - 새 안건을 끄면 걸린 작업에 '안건 연결이 빠집니다 — 제목', 켠 줄의 빈 제목 · 거꾸로 된 기간은 그 줄에 까닭을 띄우고 [등록] 을 막는다. 서버 detail 은 그 줄에 붙인다
  - 결과 — '새 안건 N · 이력 N · 작업 N건을 등록했습니다' + 안건 칩(이력만 붙인 안건은 '이력 추가') · 작업 칩, 누르면 기존 상세 팝업. [새로 정리] 는 글까지 비운다
- [x] 테스트 — api(픽스처 대조 · 목업 스트림 · 422 자리 · 400 순서 · 생성 순서 · 서버 SSE · 경로) · 스토어(정리 · 멈춤 · 다시 정리 · 프로젝트 전환 · 보낼 모양 · 등록 · 실패 자리) · 화면(입력 → 정리 → 체크 끄기 → 등록 → 칩, 연결 빠짐, 멈추기, ownerHint, 떠날 때 확인) (`api/minutes.test.ts` · `stores/minutes.test.ts` · `views/MinutesView.test.ts`)

### 2026-10-20 고침 — 회의록 게시판 (Q48)

계약 `../docs/api/minutes.md` 맨 위 '2026-10-20 고침'. 붙여넣은 글을 바로 정리하던 화면을 걷고, **저장된 회의록 하나에서 [AI 정리]** 한다.

| | 결정 | 왜 |
| --- | --- | --- |
| 화면 | `/minutes` 목록(`MinutesView`) · `/minutes/new` · `/minutes/:minutesId/edit`(`MinutesEditView`) · `/minutes/:minutesId` 상세(`MinutesDetailView`) — 검토는 상세 안에서 펼친다 | 계약 '화면' |
| 스토어 | `stores/minutes.ts` = 게시판(목록 · 상세 byId · 쓰기 · 고치기 · 지우기 · 나온 것 세기), `stores/minutesDraft.ts` = [AI 정리](옛 `stores/minutes.ts` 의 초안 흐름에서 글 칸을 걷고 `minutesId` 를 받음) | 게시판은 오래 들고, 초안은 상세를 떠나면 버린다 — 수명이 달라 나눔 |
| 권한 | 고치기 `canEditComment` · 지우기 `canDeleteComment`(`lib/access`) 그대로 — 버튼 숨김 · 목업 403 이 같은 함수 | 계약 '작업 댓글과 같은 경계' |
| 나온 것 | `lib/minutes.ts` `minutesOutcome` — 스냅샷을 `minutesId` 로 거른다. 목록의 '나온 것' 수 · 상세 칩 · 지우기 확인의 N 이 같은 셈 | 따로 API 가 없다 |
| 지우면 | 스토어가 데이터 스토어의 그 `minutesId` 를 `null` 로 — 목업 · 서버 같은 길(목업 api 는 회의록만 지운다) | 목업 apply 가 결과만 내고 스토어가 넣는 것과 같은 관례 |
| 출처 칩 | `components/app/MinutesSourceChip.vue` — 안건 상세(안건 자신 · 이력 줄) · 작업 상세(제목 아래). 제목은 게시판 목록에서, 모르면 '회의록'. 처음 그릴 때 목록을 한 번 받는다 | 계약 '안건 상세 이력 · 작업 상세' |

- [x] `domain.ts` — `MinutesItem` · `Minutes` · `MinutesInput`, `MinutesApplyInput.summary?`, `Thread` · `Entry` · `Task` 의 `minutesId`(픽스처 · 화면에서 만드는 줄 전부 `null`)
- [x] `fixtures/minutes.ts` — 시드 `minutesRows`(m1 · p1 · u1 · `2026-10-16T06:30:00Z` · 본문 `MINUTES_EXAMPLE` · 요약 ''). `MINUTES_EXAMPLE` 은 서버 시드가 글자 그대로 복사하니 바꾸지 않는다
- [x] `api/minutes.ts` — `fetchMinutesList` · `createMinutes` · `fetchMinutes` · `patchMinutes` · `deleteMinutes` · `streamMinutesDraft(minutesId, signal)`(본문 없는 POST) · `applyMinutes(minutesId, input)`
  - 목업은 `mockDb().minutes` 에 둔다(`resetMockAuth` 가 되돌린다). 404 `MINUTES_NOT_FOUND`(남의 프로젝트도) · 403 `FORBIDDEN` · 422(`lib/minutes` `minutesInputProblems`)
  - 서버 '구현 (2026-10-20 고침)' 에 맞춤 — title · body 는 앞뒤 공백 뗀 값을 저장, POST 의 meetingDate 가 빠지면 null, PATCH 의 title · body null 은 422 · meetingDate null 은 비우기 · 보낸 칸이 없으면 updatedAt 그대로, apply 의 summary null 은 안 보낸 것 · 60,000자 넘으면 422 `summary` · 실패하면 요약도 안 남음 · 요약 저장은 updatedAt 을 안 바꿈
  - 목업 apply 는 만든 안건 · 이력 · 작업에 `minutesId` 를 달고(기존 안건 자체엔 안 단다) 요약을 저장한다
- [x] 목록 — 회의 날짜 · 제목 · 작성자 · 나온 것 · 고친 날, 제목 찾기(조회 · 초기화), 10줄 페이징, [새 회의록]
- [x] 쓰기 · 고치기 — 제목 · 회의 날짜 · 본문 · [파일 열기] · [예시 넣기] · 글자 수 · [취소] · [저장](고치기는 바뀐 칸만 PATCH). 쓰다 나가면 묻는다. 작성자가 아니면 고치기 주소에서 막는다
- [x] 상세 — 메타 · [고치기](작성자) · [지우기](작성자 · 관리자, 확인 창 "여기서 나온 N건은 남습니다") · 요약 · 본문(줄바꿈 살림) · 이 회의록에서 나온 것(안건 · 이력 · 작업 칩, 없으면 "아직 정리하지 않았어요") · [AI 정리]/[다시 정리] → 검토 → [등록 N건] · [그만두기]. 등록하면 검토를 닫고 '등록했습니다' 한 줄 · 칩이 는다. 검토 중 떠나면 묻는다
- [x] 검토의 요약은 고칠 수 있다 — [등록] 때 회의록 요약으로 저장된다
- [x] 테스트 — api(게시판 정렬 · 쓰기 · 422 · 404 · 고치기/지우기 권한 · 서버 '구현' 맞춤 · apply 출처 · 요약 · 경로) · 스토어(게시판 · 권한 · 지우면 출처 null / 초안 · 등록 · 나온 것 · 요약) · 화면(목록 · 찾기 · 쓰기 · 고치기 · 권한 · AI 정리 → 등록 → 칩 · '회의록에서' 칩 · 지우기) (`api/minutes.test.ts` · `stores/minutes.test.ts` · `stores/minutesDraft.test.ts` · `views/MinutesView.test.ts`)

### 13-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 m1 을 [AI 정리] 해 세 묶음이 나오는지, 등록한 것이 다른 계정의 스냅샷에 출처(`minutesId`)와 같이 보이는지, 지우면 출처가 비는지 본다

**커밋** — ① 목업 화면(서버 갈래 포함) ② 서버로 확인

## 14단계 · 선행 작업 · 작업 상태 기록

"A 를 하려면 B 가 먼저" 와 "이 작업이 언제부터 진행 중인가" 를 데이터로 남긴다 — 프로젝트 진행 리포트(15단계)의 바탕이다.
계약은 `../docs/api/task-flow.md`(합의 2026-10-20 · Q49 · Q50 닫힘), 스냅샷의 `taskDependencies` 는 `../docs/api/snapshot.md`, 서버 쪽은 `../server/PLAN.md` 13단계다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 레코드 | 선행 관계는 데이터 스토어(`taskDependencies`), 걸기 · 떼기 · 고르기 목록은 작업 스토어 | 작업 ↔ 안건 링크와 같은 자리 |
| 쓰기 | 화면에 먼저 넣고 보낸다. 거절되면 그 쌍만 빼고(떼기는 다시 넣고) 까닭 토스트. 목업도 api 를 거치되 걸기는 응답 뒤에 넣는다 | 상하위 · 순환 · 20개 검사가 목업에서도 서버와 같은 코드로 나와야 한다. 목업 api 는 이미 걸린 쌍을 검사 없이 통과시켜(서버와 같다) 먼저 넣으면 검사를 건너뛴다 |
| 검사 | `lib/dependency.ts` 한 벌 — 목업 api 의 거절 · 상세의 고르기 목록 · 간트의 그 자리 까닭이 같은 함수 | 셋이 따로 판단하면 화면이 고르게 해 놓고 서버가 거절한다 |
| 막지 않는다 | 안 끝난 선행이 있어도 상태는 그대로 바뀐다. 칩에 상태 점 · 한 줄로 알려 주기만 | 계약 '막지 않는다' |
| 며칠째 | 한국 시간 날짜끼리 뺀 날 수. 0 이면 '오늘부터', backfill 이면 'N일 이상' | 계약의 예(k20 = 10/8 → 10/20 '12일째')와 맞춘다 |
| 간트 | 선행을 finish-to-start 화살표로. 끌어 건 것은 간트가 직접 넣지 않고 스토어 → 간트로 다시 그린다. 바뀐 쌍만 옮긴다(`addLink` · `deleteLink`) | 고리는 한 방향. 통째로 다시 그리면 보던 자리가 튄다 |
| 제안 | `stores/dependencySuggest.ts` — 창을 열 때마다 새로 받고 닫거나 프로젝트를 바꾸면 버린다. [모두 적용] 은 차례로 | 서버가 남기지 않는다. 앞 줄을 건 결과로 뒤 줄이 순환이 될 수 있다 |

### 14-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` — `TaskDependency` · `DependencySuggestions` · `DependencySuggestion`, `Task.statusChangedAt` · `statusSinceBackfill`, `ProjectSnapshot.taskDependencies`, 화면용 `TaskDetail.dependsOn` · `dependents`
- [x] 픽스처 — 선행 셋(k20 ← k19, k21 ← k20, k22 ← k20), 상태 시각(k20 `2026-10-08T00:00:00Z` · k22 `2026-10-13T00:00:00Z` · 그 밖은 start 의 00:00Z, 없으면 등록 시각), backfill 은 늘 false. AI 제안 둘(k16 ← k15 · k18 ← k3)
- [x] `api/dependencies.ts` — `putTaskDependency` · `deleteTaskDependency` · `suggestDependencies`. 목업은 `provideMockWorld` 로 보고 404 `TASK_NOT_FOUND` → 400 `TASK_DEPENDENCY_HIERARCHY` → 409 `TASK_DEPENDENCY_CYCLE` → 400 `TASK_DEPENDENCY_LIMIT`(문구는 서버 그대로). 계약 끝 '구현에서 메운 것 (서버)' 에 맞춤 — 이미 걸린 쌍은 검사 없이 200, DELETE 는 뒤 작업만 보고 없는 관계도 204, 상위를 바꿔도 다시 보지 않음. 제안은 완료 아닌 작업이 둘 미만이면 빈 목록, 이미 건 것 · 걸리는 것 · 완료가 낀 것을 버리고 받아들인 제안을 얹어 가며 본다
- [x] 상태가 바뀌는 길마다 목업이 `statusChangedAt` 을 지금으로 — 작업 등록 · 상태 바꾸기(그대로면 안 남김) · 일괄 등록 · 회의록 apply
- [x] 작업 상세 — 상태 아래 '진행 중 · 12일째', '선행 작업' 칩(안 끝났으면 상태 점, X 로 떼기) + 고르기(자기 · 조상 · 자손 · 이미 건 것 빼고, 순환이 되면 흐리게 '이미 이 작업을 기다림'), '이 작업을 기다리는 작업' 칩(읽기만). `SearchPicker` 에 `disabledReason`
- [x] 간트 — 화살표 · 끌어 걸기(끝 → 시작만, 아니면 까닭) · 화살표 눌러 떼기(확인 창) · 두 번 누르기의 기본 지우기 창 막음
- [x] 작업 화면 위 [AI 선행 관계 찾기] → `DependencySuggestDialog` — 받는 중 · 줄마다 선행 → 뒤 작업 · 이유 · [적용] · [버리기] · [모두 적용] · 실패한 줄에 까닭 · 못 찾음 · 오류와 [다시 찾기]
- [x] 테스트 — 검사 함수 · 며칠째 · 픽스처(`lib/dependency.test.ts`) · 목업/서버 api(`api/dependencies.test.ts`) · 스토어(걸기 · 되돌림 · 상태 기록 · 제안, `stores/dependency.test.ts`) · 작업 상세(`TaskDetailDialog.test.ts`) · 제안 창(`DependencySuggestDialog.test.ts`) · 간트 변환 · 화살표(`lib/gantt.test.ts` · `TaskGantt.test.ts`)

### 2026-10-28 고침 (사용자)

- [x] **선행 작업 걷기 (Q63)** — 위 표의 레코드 · 쓰기 · 검사 · 막지 않는다 · 간트 · 제안 줄과 14-1 의 선행 몫은 이제 옛 기록이다. `api/dependencies.ts` · `lib/dependency.ts` · `TaskDependencies` · `DependencySuggestDialog` · `stores/dependencySuggest.ts` 와 테스트 지움, 스냅샷 `taskDependencies` · `TaskDetail.dependsOn` · `dependents` 걷음, 간트 화살표 · 끌어 걸기 · [AI 선행 관계 찾기] 걷음, `SearchPicker` 의 `disabledReason` 걷음. 며칠째(`statusDays` · `statusSinceLabel`)는 `lib/task.ts` 로 옮겨 남긴다. 리포트 신호 `waitingOnPredecessor` · `lateBlocker` 와 `waitingOnTaskIds` · `blockingTaskIds` 는 지난 리포트의 facts 에만 있어 타입에 optional 로 두고 손쓸 작업 표는 있을 때만 '기다림 / 막음' 칸을 세운다. 이력의 `dependsOn` 줄 읽기도 둔다

### 14-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 시드의 k20 상세가 '진행 중 · 12일째' 인지 본다 (선행 몫은 Q63 으로 걷음)

**커밋** — ① 목업 화면(서버 갈래 포함) ② 서버로 확인

## 15단계 · 프로젝트 진행 리포트 — '리포트' 메뉴

[리포트 만들기] 를 누르면 지난 7일을 규칙으로 세고(`ProgressFacts`) Claude 가 '먼저 손쓸 것' 을 근거와 함께 쓴다. 저장해 목록에 쌓고 지난 리포트와 견준다.
계약은 `../docs/api/report.md`(합의 2026-10-20 · Q49 ~ Q51 닫힘), 바탕은 14단계(선행 · 상태 기록)와 11단계(리스크 기준 · 근거 칩), 서버 쪽은 `../server/PLAN.md` 14단계다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | 왼쪽 메뉴 리스크 다음 **'리포트'** — `/reports` 목록(`ReportsView`, 만드는 중도 여기) · `/reports/:reportId` 상세(`ReportDetailView`) | 계약 '화면' |
| 계산 | `lib/progress.ts` 한 벌 — 서버 `services/progress.py` 와 같은 규칙. 목업 api 만 쓰고 화면은 저장된 facts 를 그대로 그린다 | 리포트는 만든 때의 기록이다. 다시 계산하면 지난 리포트가 바뀐다 |
| 목업 재료 | 작업 · 안건 · 이력 · 링크는 데이터 스토어(`provideMockWorld`), 기준 · high/medium 안건은 리스크 목업 보고서(`fetchRisks`). `decidedButBlocked` 는 리스크 목업이 굳혀 둔 값이라 `lib/progress` 가 같은 판정(`isDecidedButBlocked`)으로 지금 데이터에서 본다 | 화면에서 상태를 바꾸면 리포트가 따라야 시연이 맞다 |
| 목업 글 | `fixtures/reports.ts` `mockReportBody(facts)` — 칸 순서 · 근거 칩(k20 · k22 · t3)은 고정, 숫자는 facts 에서 옮긴다. 근거가 facts 에 없으면 그 줄을 뺀다 | '숫자 · 날짜는 넣어 준 그대로' 를 날이 바뀌어도 지키려고 |
| 스트림 | 챗봇의 `postSseMessages` · `settle` · `mockDeltas` 를 같이 쓰고 `toReportEvent` 로 읽는다. done 에서 받은 글 · facts 로 `Report` 를 만들어 byId 에 넣어 상세가 다시 받지 않는다 | 리스크 AI 요약 · 회의록과 같은 틀 |
| 수명 | 만드는 중은 목록 화면에서만 산다 — [멈추기] · 떠남(묻는다) · 프로젝트 바꿈이면 끊고 저장 안 됨을 알린다 | 계약 '중간에 끊기면 저장하지 않는다' |
| 권한 | 지우기 `canDeleteComment`(만든 사람 · 프로젝트 관리자 · 시스템 관리자) — 버튼 숨김 · 목업 403 이 같은 함수. 404 `REPORT_NOT_FOUND`(남의 프로젝트도) | 회의록과 같은 경계 |
| 지난 대비 | 숫자 카드의 완료율(%p) · 막힘에 ▲▼. 막힘은 늘면 나쁜 쪽이라 색을 거꾸로 | 계약 '지난 리포트 대비' · `previous` 가 막힘도 싣는다 |

### 15-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` — `ProgressFacts` · `TaskAttentionSignal` · `TaskAttention` · `PersonProgress` · `ReportItem` · `Report` · `ReportEvent` (계약 그대로)
- [x] `lib/progress.ts` — 기간(KST 오늘을 끝으로 7일) · 신호 일곱 · 점수 · 정렬(score → 기한 → 등록) · 30개 · 무게 · 사람별 · previous · 화면 말. 계약이 말하지 않은 경계는 서버가 `report.md` '구현에서 메운 것' 에 적은 것과 맞췄다(완료율 둘째 자리 반올림 · '넘음' 은 `>` · 시작일 지남은 `start < 오늘` · 막는 작업은 끝난 작업에서 멈춤 · 사람별 순서 · backfill 줄은 완료 · 시작에 안 셈)
- [x] `api/reports.ts` — `fetchReports` · `fetchReport` · `deleteReport` · `streamCreateReport`. 목업은 `mockDb().reports`(`resetMockAuth` 가 비운다), id `rp1` …, 작업이 없으면 `REPORT_EMPTY` 한 줄로 저장
- [x] `stores/report.ts` — 목록 · byId · 만들기(draft: facts · 글 · 상태) · 멈춤 · 지우기. 로그아웃에 비운다(`session.ts`)
- [x] 화면 — 목록(기간 · 만든 사람 · 완료율 · 손쓸 작업 · 만든 시각, 10줄 페이징, [리포트 만들기] + '지난 7일 · 10월 14일 ~ 10월 20일') · 만드는 중(숫자 카드 → 글, [멈추기], 저장 안 됨 안내) · 상세(숫자 카드 · 글 + 근거 칩 · 손쓸 작업 표 · 사람별 · [지우기]). 칩은 작업 · 안건 상세 팝업
- [x] 테스트 — 신호마다 · 점수 · 정렬 · 30개 · KST · 시드(`lib/progress.test.ts`) · 목업/서버 api(`api/reports.test.ts`) · 스토어(`stores/report.test.ts`) · 화면(`views/ReportsView.test.ts`)

알고 둔 것

- 목업은 작업마다 마지막 상태 줄(`statusChangedAt`)만 안다 — '기간 안에 완료 · 시작' 은 지금 그 상태이면서 그 시각이 기간 안이고 backfill 이 아닌 것만 센다. 서버는 `task_log` 를 다 읽으므로 시작했다 끝낸 작업도 '시작' 에 든다(기록이 한 줄뿐인 시드에서는 같다)
- 목업의 high · medium 안건은 리스크 목업 보고서(2026-10-15 기준으로 굳힘)에서 오고, 그사이 정해진 안건만 뺀다

### 15-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 [리포트 만들기] 를 눌러 숫자 카드 → 글 → 상세, 두 번째 리포트의 ▲▼, 다른 계정의 [지우기] 403 을 본다

**커밋** — ① 목업 화면(서버 갈래 포함) ② 서버로 확인

## 16단계 · 테스트 — '테스트' 메뉴

기능 · 시나리오 테스트를 **작업과 따로** 관리한다. 메뉴의 핵심은 **지금의 상황 파악** — 지금 무엇을 테스트하고 있나 · 무엇이 오래 걸리나 · 기간이 지난 것.
계약은 `../docs/api/test.md`(합의 2026-10-27 · Q53 ~ Q58 닫힘), 기획은 `../docs/test-proposal.md`, 서버 쪽은 `../server/PLAN.md` 16단계다. **이 단계는 1단계(AI 없이)다** — AI 넷(검토 · 빠진 테스트 찾기 · 바뀐 자리 설명 · 챗봇 도구)은 계약이 생기면 16-3 으로 붙인다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | 왼쪽 메뉴 안건 다음 **'테스트'** — `/tests`(간트, 2026-10-28 부터 기본) · `?view=list`(목록) · `/tests/:id`(상세) · `/tests/new`(추가, `?parent=` · `?task=` · `?thread=`) | 계약 '화면'. 작업 메뉴와 같은 틀 · 같은 팝업 라우팅 |
| 레코드 | `stores/test.ts` 가 고른 프로젝트의 테스트 전부를 받아 든다(스냅샷에 싣지 않는다). 작업 · 안건 상세의 칩도 같은 목록에서 거른다 | 계약 Q55 · '작업 · 안건 상세는 따로 부르지 않는다' |
| 계산 | 며칠째 · 신호는 서버가 센 것을 그대로. 화면은 묶음의 상태(하위 중 가장 나쁜 것 — 실패 > 막힘 > 테스트 중 > 작성 중 · 준비됨 > 통과) · 묶음 신호(하위 합) · '지금' 카드 · 정렬만 센다 — `lib/testcase.ts` 한 벌 | 계약 '서버가 센다'. 목업 api 만 같은 규칙(`testSignals`)으로 서버 대신 센다 |
| '지금' | 숫자 카드 여섯(테스트 중 · 오래 걸림 · 기간 지남 · 막힘 · 실패 · 기준 바뀜, 누르면 거른다) · 지금 테스트 중(오래된 것부터) · 손쓸 테스트(기간 지남 · 오래 막힘 · 오래 걸림 순 → N일째). **돌리는 테스트(묶음 아닌 것)만 센다** | 묶음까지 세면 같은 테스트가 두 번 든다 |
| 간트 | `TaskGantt` 의 그리기를 `GanttChart.vue` 로 떼고 작업(`TaskGantt`) · 테스트(`TestGantt`)가 얇게 감싼다. 테스트는 화살표 없음 · 묶음 막대는 하위의 기간 · 기간 지남 · 오래 걸림은 막대 테두리 | 작업 간트의 동작 · 검사는 그대로 두고 한 벌로 그린다 |
| 쓰기 | 고치기(PATCH)는 화면에 먼저 넣고 보낸다(간트에서 끈 막대가 튀지 않게), 실패하면 목록을 다시 받는다. 상태 · 태그 · 기준 · 추가 · 지우기는 응답을 기다린다 | 서버가 신호 · 기준을 새로 센다 |
| 권한 | 지우기 `canDeleteComment`(만든 사람 · 프로젝트 관리자 · 시스템 관리자) — 버튼 숨김 · 목업 403 이 같은 함수 | 계약 Q53 |

### 16-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` — `TestStatus` · `TestLevel` · `TestSignal` · `TestStep` · `TestRef` · `TestCase` · `TestInput` · `TestPatch` · `TestStatusInput`(계약 그대로) + 화면용 `TestRow`
- [x] 픽스처 `fixtures/tests.ts` — 계약 시드 표 여덟 줄(서버 시드와 같은 id `tc1` ~ `tc8` · 사람 · 파트 · 태그 · basis). 목업 저장소 `mockDb().tests`(`resetMockAuth` 가 되돌린다)
- [x] `api/tests.ts` — 엔드포인트 아홉. 목업은 검사 순서 · 코드 · 기준 바뀜 다시 찍기를 서버 '구현에서 메운 것' 에 맞췄다
- [x] `stores/test.ts` — 목록 · 묶음 상태 / 신호 · [내 파트 \| 전체](`visibleInMyParts`) · '지금' 숫자 · 표 · 전체 숫자 · 태그한 테스트 · 쓰기. 로그아웃에 비운다(`session.ts`)
- [x] 화면 — `TestsView`('지금' · 거르기 · 목록 · 간트), `TestDetailDialog`(상세 · 추가 한 벌, 단계 표 `TestStepsEditor` · 태그 `TestRefs` · 상태 `TestStatusSection` · 기준 바뀜 · 지우기), 작업 · 안건 상세의 `TaggedTests`. `ParentTaskPicker` 에 `noun`
- [x] 테스트 — 규칙 · 정렬 · 검사(`lib/testcase.test.ts`) · 목업 / 서버 api(`api/tests.test.ts`) · 스토어(`stores/test.test.ts`) · 간트 변환(`lib/gantt.test.ts`) · 진짜 dhtmlx 로 그린 테스트 간트(`TestGantt.test.ts`) · 화면(`views/TestsView.test.ts`)

알고 둔 것

- 시드 T4 의 '바뀐 결정' 은 계약 표의 `change` 가 아니라 `decide`(e3)다 — 서버 시드와 같다(시드에 change 를 더하면 확인 요청 시드가 어긋난다)
- 테스트 기간은 한쪽만 있어도 받는다(계약). 간트 막대는 둘 다 있을 때만 선다
- 멈춘 시계(`vi.useFakeTimers({ toFake: ['Date'] })`)에서는 Vue 가 이벤트 시각으로 새로 붙은 칸의 blur 를 걸러 버린다 — 화면 검사에서 단계를 고치는 것만 진짜 시계로 돌린다

### 2026-10-27 고침 (사용자)

- [x] 상세의 결과 버튼은 **[성공] · [실패]** 둘. 작성 중 · 준비됨 · 테스트 중 · 막힘 · 성공 · 실패는 위쪽 **상태 칸(고르기)** 에서 고른다 — 막힘 · 실패를 고르면 메모(실패는 단계 번호도)를 받은 뒤 보낸다. 묶음은 고르기 · 버튼 대신 하위 요약. 화면 말 '통과' → **'성공'**(값은 `pass`). **레벨을 걷었다**(타입 · 상세 · 목록 · 요청 · 픽스처 · 목업 api · 검사)
- [x] **입력 줄이기 (Q60)** — 목적 · 사전조건 · 단계 표 · 실패한 단계를 걷고 **'테스트 내용'**(`content`, textarea 하나 · 벗어나면 저장)을 테스트 데이터 위에 둔다. 실패는 메모만. `TestStepsEditor` 지움. 픽스처는 0020 규칙으로 합친 글(서버 시드와 같은 글). 이력의 걷은 칸 이름 · 표기는 지난 줄 때문에 둔다

### 16-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 '지금' 카드 숫자 · 손쓸 테스트 순서, 간트에서 끈 기간이 다른 계정에 보이는지, [그대로 맞다] · 상태 바꾸기 · 지우기 403 / 409 를 본다

**커밋** — ① 목업 화면(서버 갈래 포함) ② 서버로 확인

## 17단계 · 변경 이력 — 작업 · 테스트 상세

작업 · 테스트를 **누가 언제 무엇을 바꿨나**를 상세에서 보인다. 요청 하나 = 한 줄, 칸마다 전 · 후.
계약은 `../docs/api/history.md`(Q59 닫힘, 2026-10-27), 서버 쪽은 `../server/PLAN.md` 17단계다. 작업 상태 기록(`task_log`)은 그대로 — 이력은 보이기만 하고 셈에 안 쓴다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 자리 | 작업 상세는 댓글 아래, 테스트 상세는 기준 바뀜 아래 **'변경 이력'**. 기본은 접어 두고 펼칠 때 부른다 | 계약 '화면' — 상세를 열 때마다 부르지 않게 |
| 다시 부르기 | 쓰기 응답에 이력이 없다. 작업 · 테스트 스토어가 쓰기를 마치면 `stores/history.ts` 의 `touched` 로 알리고, 펼친 칸이 `revision` 을 보고 다시 부른다 | 쓰기 전에(낙관적 반영 때) 부르면 서버가 아직 줄을 안 남겼다 |
| 화면 말 | `lib/history.ts` 한 벌 — 칸 이름 · 상태 / 우선순위 라벨 · 멤버 · 파트 이름 · 작업 키 · 안건 제목 · 테스트 키 · 날짜 `M/D` · 없는 것 '(삭제됨)'. 컴포넌트는 그리기만(`HistoryTimeline`) | 이름은 지금의 것으로 찾는다(계약 '값') |
| 목업 쓰기 | 목업 이력은 `mockDb()` 에 두고(`resetMockAuth` 가 되돌린다) **`recordMockHistory` 한 곳**으로 남긴다 — 작업은 데이터 스토어(`stores/task.ts`) · 일괄 등록 · 회의록 apply, 테스트는 `api/tests.ts`. 비교는 `diffChanges` · `bodyChanged` | 목업 작업 쓰기는 api 를 안 거치고 스토어가 바로 고친다 |

### 17-1 목업 (서버 갈래도 계약대로 붙임)

- [x] `domain.ts` — `HistoryChange` · `HistoryEntry`(계약 그대로)
- [x] 픽스처 `fixtures/history.ts` — 작업 · 테스트마다 등록 한 줄(작업은 담당자 · 테스트는 만든 사람, 등록 시각) + 시연 둘(k20 상태 todo → doing 10/8, HW-T7 실패 + 실패 단계 + 결과 메모)
- [x] `api/history.ts` — `fetchTaskHistory` · `fetchTestHistory`(목업 404 `TASK_NOT_FOUND` · `TEST_NOT_FOUND`) · `recordMockHistory`. 목업 쓰기가 칸 규칙대로 줄을 남긴다(바뀐 칸만, 남길 칸이 없으면 줄 없음, 테스트 상태는 같은 상태도 남김, 비운 결과 메모는 null)
- [x] `stores/history.ts` — 받기(마지막 요청만) · `touched` / `revision` · 프로젝트를 바꾸거나 로그아웃하면 비운다(`session.ts`)
- [x] 화면 — `HistorySection`(접기 · 부르기 · 받는 중 / 오류 / 빈 상태) + `HistoryTimeline`(최근 것부터, 사람 · 상대 시각 + title 에 KST 일시, 긴 글 줄여 펼치기). 작업 · 테스트 상세에 붙임
- [x] 테스트 — 칸 비교 · 화면 말(`lib/history.test.ts`) · 목업 / 서버 api(`api/history.test.ts`) · 목업 작업 쓰기의 이력 · 알리기(`stores/history.test.ts`) · 상세의 이력 칸(`TaskDetailDialog.test.ts` · `views/TestsView.test.ts`)

알고 둔 것

- 목업 본문 이력은 타이머 없이 센다 — 바로 앞 고침과 500ms 안에 이어진 고침을 한 줄로 본다. 타이머를 두면 화면 검사에서 앞 검사의 타이머가 다음 검사 도중에 터져 검사가 가끔 깨졌다
- 계약이 말하지 않아 화면이 정한 것은 `../docs/api/history.md` '구현에서 메운 것 (화면)'

### 17-2 서버에 붙이기 (서버 `구현` 뒤)

- [ ] 서버 모드로 작업 · 테스트 상세의 이력이 쓰기 뒤에 다시 불려 새 줄이 맨 위에 서는지, backfill 줄이 '등록(이전 기록 없음)' 으로 보이는지 본다

**커밋** — ① 목업 화면(서버 갈래 포함) ② 서버로 확인

## 18단계 · 프로젝트 관리 늘리기 — 설명 · 기간 · 종료 · 삭제

프로젝트에 설명 · 기간(시작일 · 종료일) · 상태(진행 중 / 종료)를 두고, 시스템 관리자는 프로젝트를 지울 수 있게 한다.
계약은 이번 일을 맡긴 쪽이 준 것 그대로다 — `Project` 에 `description` · `startDate` · `endDate` · `status` · `closedAt`,
`POST /api/projects` 가 설명 · 기간을 선택으로 받고, `PATCH /api/projects/{id}` 는 보낸 것만 바꾸고(null 은 지움),
`DELETE /api/projects/{id}` 는 시스템 관리자만 · 204 · 소프트 삭제. 거꾸로 된 기간은 400 `PROJECT_DATE_RANGE`.
**API.md · docs/api 에는 아직 안 올라가 있다** — 서버 쪽이 같이 만드는 중이라 프론트는 손대지 않았다.

### 정해 둔 것

| | 결정 | 왜 |
| --- | --- | --- |
| 저장 | 프로젝트 관리의 기본 정보(이름 · 설명 · 기간)는 **한 번에 저장** — '이름 바꾸기' 버튼을 '저장' 하나로 바꿨다. 바뀐 칸만 PATCH 에 싣고, 비운 칸은 null | 칸마다 버튼을 두면 기간 두 칸이 따로 저장되다 거꾸로 걸린다 |
| 기간 검사 | 화면에서 먼저 막고(`lib/project.ts` 의 `projectDateRangeError`, 같은 날은 된다), 그래도 서버가 `PROJECT_DATE_RANGE` 를 내면(그사이 남이 고침) 그 message 를 기간 칸 아래에 띄운다. 다른 오류도 저장 줄에 그대로 — 토스트를 띄우지 않는다 | 고칠 칸 옆에 말이 있어야 한다 |
| 종료 | 표시만. '프로젝트 종료' 는 확인 다이얼로그를 한 번 거치고, '다시 열기' 는 바로 한다. 종료 시각(`closedAt`)을 상태 줄에 찍는다 | 계약대로 쓰기를 막지 않는다. 되돌리기 쉬운 쪽은 묻지 않는다 |
| 줄 세우기 | 프로젝트 목록 · 업무 화면 프로젝트 고르기 · 관리자 페이지 프로젝트 고르기 모두 **진행 중 먼저, 같은 상태끼리는 받은 순서**(`orderProjects`). 종료한 것은 흐린 글자 + '종료' 배지(목록) · '· 종료'(고르기) | 서버 목록도 active 먼저다. 화면에서 종료하면 받은 순서가 어긋나서 그리는 쪽에서도 세운다 |
| 고르기 트리거 | 프로젝트 고르기 트리거는 `SelectValue` 의 슬롯으로 지금 프로젝트를 직접 그린다 | reka-ui 는 고른 항목의 글을 베껴 두어서, 종료 · 다시 열기를 해도 트리거가 안 바뀌었다 |
| 삭제 | 위험 구역은 **시스템 관리자에게만** 보인다. 다이얼로그에서 프로젝트 이름을 그대로(앞뒤 공백만 무시) 쳐야 '지우기' 가 켜진다. 지우면 스토어에서 걷고 남은 프로젝트(진행 중 먼저)로 옮긴다 | 되돌릴 수 없는 일이라 두 번 확인한다 |
| 지운 뒤 갈 곳 | 틀(`ProjectAdminFrame`)이 정한다 — 주소의 프로젝트가 목록에서 사라지면(지움 · 나를 뺌) 남은 게 있으면 `/admin`, 없으면 `emptyProjectsHome` | 화면과 틀이 따로 옮기면 두 번 이동한다 |
| 목업 | 프로젝트 레코드를 **목업 서버(`mockDb().projects`)로 옮겼다** — 목록(볼 수 있고 안 지운 것 · active 먼저) · 등록 · 수정 · 삭제가 서버처럼 권한 · 검증(설명 2000자 · 날짜 모양 · 합친 값의 기간) · 소프트 삭제를 본다. 지운 프로젝트의 경로는 404(`requireProject`), 지운 프로젝트의 역할은 내 정보에서 빠지고, 접두사는 지운 것도 쓰는 것으로 본다 | 전에는 스토어가 목업 프로젝트를 직접 고쳐 권한 말고는 따지지 않았다 |
| 스토어 | `updateProject` 는 실패하면 ApiError 를 던진다(화면이 칸 옆에 띄움). `renameProject` · `setProjectStatus` · `deleteProject` · `addProject` 는 알리고 false/null | 기존 관례(알리고 false)는 그대로, 칸 옆에 띄울 것만 던진다 |
| 픽스처 | p1 은 설명 · 기간 둘 다, p2 는 시작일만, p3(경영지원 파트)는 **종료** — 이미 맨 뒤라 기존 검사의 순서가 안 바뀐다 | |

### 체크리스트

- [x] `types/domain.ts` — `Project` 다섯 필드 · `ProjectStatus` · `ProjectPatch`(전부 선택) · `ProjectInput`(설명 · 기간 선택)
- [x] `src/api/projects.ts` — `fetchProjects` · `createProject` · `patchProject` 목업 갈래, `deleteProject` 새로 (서버 갈래는 계약대로)
- [x] `stores/data.ts` — `addProject(name, prefix, { description, startDate, endDate })`(빈 칸은 안 싣는다) · `updateProject` · `setProjectStatus` · `deleteProject`, 목업 부팅도 `fetchProjects` 로
- [x] 프로젝트 관리 — 기본 정보(이름 · 설명 · 기간 · 비우기 · 글자 수) · 상태 · 위험 구역
- [x] 프로젝트 등록 팝업 — 설명 · 기간(선택)
- [x] 프로젝트 목록 — 기간 열 · 설명 한 줄 · 종료 배지 · 진행 중 먼저
- [x] 프로젝트 고르기(업무 화면 · 관리자 페이지) — 진행 중 먼저 · '· 종료'
- [x] 검사 — `api/projects.test.ts`(목업 서버) · `lib/project.test.ts` · `views/ProjectAdminViews.test.ts`(저장 · 화면/서버 기간 오류 · 종료/다시 열기 · 삭제 다이얼로그 · 시스템 관리자만 · 남은 게 없을 때) · `views/ProjectsView.test.ts`(목록 · 등록 팝업) · `components/app/AdminShell.test.ts`(고르기 트리거) · `stores/server.test.ts`(서버 갈래 본문 · DELETE)
- [ ] 계약이 API.md · docs/api 에 올라가면 표의 상태와 맞춰 본다. 서버 모드로 한 번 돌려 본다

### 2026-11-02 고침 — 상태 셋(준비 · 진행 · 종료) · 상태는 정보 칸 안으로 · 한눈 정보 걷음

계약이 `status: 'planned' | 'active' | 'closed'`(화면 이름 준비 · 진행 · 종료, 기본 active)로 늘었다(`docs/api/auth.md` '프로젝트 관리').
`closed` 가 되면 `closedAt` 을 찍고 다른 값이 되면 null, 같은 값을 다시 보내면 그대로. 서버 목록은 active → planned → closed.

| | 결정 | 왜 |
| --- | --- | --- |
| 상태 고르기 | '프로젝트 정보' 안의 한 줄(기간 아래 · 작업 키 접두사 위) — **세 칸 토글**(준비 · 진행 · 종료, `aria-pressed`). 같은 '저장' 으로 바뀐 칸만 PATCH(상태만 바꾸면 `{ status }` 하나) | 작업 상세의 우선순위 토글과 같은 모양. 셋뿐이라 펼칠 것 없이 다 보이는 게 낫다 |
| 종료 시각 | 저장된 상태가 종료이고 칸도 종료일 때만 토글 옆에 작게 '…에 종료'(`data-closed-at`) | 고르기만 하고 저장 전에는 아직 닫지 않았다 |
| 걷은 것 | 따로 있던 '상태' 영역 · '프로젝트 종료' · '다시 열기' 버튼 · 종료 확인 다이얼로그 · 스토어 `setProjectStatus` · 한눈 정보 카드(작업 · 안건 · 파트 · 멤버 수)와 그 계산 | 종료도 표시만이라 되돌리기 쉽다 — 같은 저장 한 번으로 충분하다. 멤버 수는 아래 멤버 목록에 이미 있다 |
| 표시 | 진행은 표시 없음. 준비 · 종료는 목록 배지(`data-status-badge`) · 고르기 '· 준비' / '· 종료'(`data-status-mark`). 흐린 글자는 종료만 | 이름은 `lib/project.ts` 의 `PROJECT_STATUS_OPTIONS` · `projectStatusLabel` 한 곳 |
| 줄 세우기 | `orderProjects` — 진행 → 준비 → 종료, 같은 상태끼리는 받은 순서 | 서버 목록과 같다 |
| 목업 | `patch` 가 세 값 밖의 status 를 422 `VALIDATION_ERROR`(아무것도 안 바꿈), closedAt 규칙은 위와 같다 | 계약대로 |
| 픽스처 | p2(삼성생명 PAS)를 **준비**, 시작일 2026-12-01 로 — p1 진행 · p2 준비 · p3 종료라 기존 검사의 순서가 그대로다 | 셋 다 화면에서 보인다 |

- [x] `types/domain.ts` `ProjectStatus` 셋 · `lib/project.ts`(`PROJECT_STATUS_OPTIONS` · `projectStatusLabel` · `isProjectStatus` · `orderProjects`)
- [x] `api/projects.ts` 목업 — 세 값 검사 · 정렬 · closedAt
- [x] `ProjectSettingsView` — 상태 토글 · 종료 시각 · 상태 영역 / 다이얼로그 / 한눈 정보 걷음 · 머리 안내 문구
- [x] `ProjectsView` 배지 · `AppShell` · `AdminShell` 고르기 표시
- [x] 검사 — 상태 고르기 → `{ status }` 만 저장 · 종료 시각 · 이미 종료한 프로젝트 · 한눈 정보 없음 · 정렬 셋(lib · 목업 · 목록) · 422 · closedAt 지키기 · 고르기 '· 준비'

알고 둔 것

- `API.md` 공통 규칙의 '`null` 은 정해진 여섯 이름에서만 나간다' 에 `description` · `startDate` · `endDate` · `closedAt` 이 더해진다 — 계약 문서를 고칠 때 같이 적어야 한다
- 프로젝트 목록 표의 작업 · 안건 수는 여전히 고른 프로젝트만 센다(3단계 남겨 둔 것)

## 19단계 · 사용자 번호 — 사용자 관리

관리자끼리 "5번 사용자 비활성화해 주세요" 처럼 번호로 말하고 싶어 한다.
계약은 이번 일을 맡긴 쪽이 준 것 그대로다 — `MemberAccount`(GET/POST/PATCH `/api/admin/members`)에 `no: number`
(1부터 · 전역 · 유일 · 다시 쓰지 않음 · 바꿀 수 없음). 공개용 `Member` · `Me` 에는 없다. 입력 타입(`MemberAccountInput` · `Patch`)에도 없다.
**API.md · docs/api 에는 아직 안 올라가 있다** — 서버 쪽이 같이 만드는 중이라 프론트는 손대지 않았다.

| | 결정 | 왜 |
| --- | --- | --- |
| 목록 열 | 맨 앞 'ID'(uuid 앞 8자 `IdCell`) 열을 **'번호'** 로 — 숫자만, 오른쪽 정렬 · 고정폭(`tabular-nums`) | 사람이 부르는 값은 번호다 |
| uuid 복사 | 수정 팝업 머리에 'ID' + `IdCell` 로 남겼다 | 서버 로그 · 문의에 uuid 가 필요할 때 |
| 이름 | 수정 팝업 제목 '사용자 수정 — 5번 · 홍길동', 비밀번호 팝업 설명 '5번 · 홍길동의 …' (`lib/member.ts` 의 `accountLabel`) | 번호로 듣고 고른 사람이 맞는지 팝업에서 확인한다 |
| 줄 세우기 | **번호 오름차순**(`byMemberNo`) — 화면이 세운다. 전에는 서버가 준 이름 순 그대로였다. 서버 목록 순서(이름 순)는 그대로 둔다 | 번호로 찾으니 번호 순이 낫고, 새로 등록한 사람이 맨 아래에 선다 |
| 검색 | 목록에 검색 · 거르기 칸이 없어 더하지 않았다 | 번호 순이라 눈으로 찾는다. 사람이 늘면 그때 |
| 목업 | 픽스처 계정에 `no` 1..6(지금 순서 u0..u5), `mockDb().memberNoSeq` 가 **마지막으로 준 번호** — 등록하면 +1 해서 준다(최댓값 + 1 이 아니다) | 계약대로 다시 쓰지 않는다 |

- [x] `types/domain.ts` `MemberAccount.no` · `fixtures/accounts.ts` · `api/mockAuth.ts`(`toAccount` · `memberNoSeq`) · `api/admin.ts`(등록)
- [x] `AdminMembersView` 번호 열 · 번호 순 · `MemberAccountDialog` 제목 · uuid 복사 · `MemberPasswordDialog` 설명
- [x] 검사 — `api/admin.test.ts`(픽스처 번호 · 새 번호 7 · 8 · 끈 사람 번호를 다시 안 씀 · 고쳐도 그대로) · `views/AdminViews.test.ts`(번호 열 · 번호 순 · uuid 열 없음 · 팝업 제목 · 등록한 사람이 7번으로 맨 아래)
- [ ] 계약이 API.md · docs/api 에 올라가면 맞춰 본다. 서버 모드로 한 번 돌려 본다

## 20단계 · 작업 고치기 권한 · 지우기 — 작업 상세 · 목록 · 칸반 · 간트

"작업 상세에 삭제 버튼을 넣고, 수정은 생성자 · 관리자 · 담당자만." 계약은 서버가 API.md · `docs/api/auth.md` '작업' ·
`docs/api/snapshot.md` 에 올렸다(2026-11-02) — `Task.creatorId: string | null`, 고치기(PATCH 작업 · 줄 · 안건 링크 PUT/DELETE) =
생성자 · 담당자 · 프로젝트 관리자 · 시스템 관리자(그 밖 403 `FORBIDDEN`), 지우기 `DELETE /api/tasks/{id}` 204 =
생성자 · 프로젝트 관리자 · 시스템 관리자(담당자는 못 지움), 하위가 있으면 409 `TASK_HAS_CHILDREN`(2026-11-05 바뀜 — 409 를 없애고 루트와 모든 후손을 줄기째 지운다. 못 지우는 후손이 하나라도 있으면 403 이고 아무것도 안 지운다. 상세는 확인에 지워질 하위 수 · 키 · 제목을 보인다). 댓글 · 확인 요청 · 하위 작업 등록은 권한을 안 본다.

| | 결정 | 왜 |
| --- | --- | --- |
| 판단 | `lib/access.ts` 의 `canEditTask(me, task, projectId)` · `canDeleteTask(…)` 하나 — 화면 · 목업이 같이 쓴다. 스토어는 `taskStore.canEdit(task)` · `canDelete(task)` 로 감싼다 | `canEditComment` 와 같은 길. 판단이 갈리지 않게 |
| 상세 읽기 전용 | 머리줄의 '고치면 바로 저장됩니다' 자리에 자물쇠 + '작성자 · 담당자 · 관리자만 고칠 수 있습니다'(`READONLY_HINT`). 제목 `readonly` · 속성 칸 `disabled`(흐리지 않고 글처럼) · 완료 버튼 숨김 · 본문 `readonly`(체크박스도) · 안건 찾기 칸 · 연결 해제 숨김 · 하위 작업 줄의 상태는 그 하위의 권한으로 | 보는 자리가 곧 고치는 자리라 칸이 그대로 서되 손이 안 먹게 |
| 열어 둔 것 | 댓글 · 확인 요청 · 하위 작업 추가 · 테스트 추가 | 계약이 권한을 안 본다(하위 등록은 상위를 고치는 것이 아니다) |
| 작성자 칸 | 오른쪽 아래 '연관 안건 · **작성자** · 만든 날짜'. null 이면 '—' | 테스트 상세의 '만든 사람' 과 같은 자리 |
| 지우기 | 오른쪽 칸 맨 아래 '작업 지우기'(권한 있을 때만). 하위가 있으면 꺼지고 아래에 이유. 확인 다이얼로그 "HW-4 작업을 지울까요? / 본문 · 댓글 · 안건 연결도 함께 지워지고 되돌릴 수 없습니다." 지우면 스토어에서 작업 · 안건 링크를 빼고 팝업을 닫는다 → 주소는 `/tasks`(보던 탭 쿼리 유지) | 테스트 상세의 '테스트 지우기' 와 같은 자리 · 모양 |
| 409 | 확인 다이얼로그 안에 서버 message 를 띄우고 닫지 않는다. 스냅샷을 다시 받아 생긴 하위를 보이게 한다(그러면 버튼이 꺼진다). 그 밖의 오류는 토스트 | 그사이 다른 사람이 하위를 달았을 때 |
| 목록 | 못 고치는 줄은 상태 셀렉트 · 선택 칸을 잠근다(title 에 안내). '이 쪽 전체 선택' 은 고칠 수 있는 줄만, 일괄 바꾸기도 보낼 때 한 번 더 거른다 | 몰아 바꾸다 몇 줄만 403 으로 튕기면 무엇이 바뀌었는지 알기 어렵다 |
| 칸반 | 못 고치는 카드는 상태 셀렉트를 잠근다 | |
| 간트 | 못 고치는 작업은 `GanttItem.readonly`(dhtmlx 가 그대로 읽는다) + `onBeforeTaskDrag` 가 false | 끌기 = 기간 PATCH |
| 목업 | 고치기는 스토어가 서버처럼 403 토스트로 막는다(`rejectEdit`, `rejectOwner` 와 같은 자리). 지우기는 `api/tasks.ts` 의 목업 갈래가 404 → 403 → 409 순으로 보고 댓글 · 테스트 태그 · 이력을 걷는다. 작업 · 안건 링크는 데이터 스토어가 응답 뒤에 뺀다. 등록(단건 · 일괄 · 회의록 반영)은 `creatorId` 를 로그인한 사람으로 찍는다 | 서버와 같은 순서 · 같은 코드 |
| 픽스처 | `creatorId` — HW-1 · 3 · 5 김서연, HW-4 박지훈(담당 이도현), HW-18 · 20 · 21 이도현(18 은 담당 정하늘, 21 은 담당 김서연), PAS-1 박지훈. 나머지 null(옛 작업) | 담당자와 다른 경우 · 모르는 경우를 섞는다 |

- [x] `types/domain.ts` `Task.creatorId` · `lib/access.ts` · `api/tasks.ts`(`deleteTask` + 목업) · `api/comments.ts`(`forgetMockCommentsOf`) · `api/minutes.ts` · `fixtures/tasks.ts`
- [x] `stores/task.ts` — `canEdit` · `canDelete` · `rejectEdit` · `deleteTask`(지우면 받아 둔 테스트 목록을 다시 받는다)
- [x] `TaskDetailDialog` · `TaskPropertyPanel` · `TaskBodyEditor` · `TaskLinks` · `ParentTaskPicker` · `PartField`(`readonly` / `disabled`) · `TasksView` 목록 · `TaskBoard` · `TaskGantt` · `GanttChart`
- [x] 검사 — `lib/access.test.ts`(경계) · `api/tasks.test.ts`(401 · 403 · 404 · 409 · 딸린 것 정리 · 서버 경로) · `stores/task.test.ts`(creatorId 찍힘 · 목업 403 · 지우기 · 409) · `components/app/TaskDetailDialog.test.ts`(읽기 전용 · 작성자 칸 · 버튼 노출 · 확인 · 취소 · 409) · `views/TasksView.test.ts`(목록 잠금 · 전체 선택 · 칸반 · 간트 readonly · 목업 403). 화면 검사는 프로젝트 관리자(u1)로 들어오게 바꿨다
- [ ] 서버 모드로 한 번 돌려 본다(남이 등록한 작업을 일반 사용자로 열어 잠기는지 · 지우기 204 · 409)

## 21단계 · 안건 · 이력 줄 권한 · 지우기 · 변경 이력 — 안건 상세

"관리자, 담당자, 생성자는 수정, 삭제할 수 있게." 계약은 서버 쪽 초안(2026-11-02, 20단계와 같은 모양) —
`Thread.creatorId` · `Entry.creatorId`(null 가능), 안건 고치기 · 지우기 = 생성자 · **담당자** · 프로젝트 관리자 · 시스템 관리자,
이력 줄 고치기 · 지우기 = 그 줄 생성자 + 위 사람들(그 밖 403 `FORBIDDEN`). `DELETE /api/threads/{id}` 204(하위 안건이 있으면 409 `THREAD_HAS_CHILDREN`),
`DELETE /api/threads/{id}/entries/{entryId}` 200 `{ thread }`(남은 줄로 상태를 다시 잼), `GET /api/threads/{id}/history`. 결정 · 미루기 남기기는 권한을 안 본다.

| | 결정 | 왜 |
| --- | --- | --- |
| 판단 | `lib/access.ts` 의 `canEditThread` · `canDeleteThread`(= 고치기) · `canEditEntry`. 스토어는 `threadStore.canEdit` · `canDelete` · `canEditEntry` 로 감싼다 | 20단계와 같은 길 |
| 상세 읽기 전용 | 머리줄 자물쇠 + `READONLY_HINT`(작업과 같은 말). 제목 · 배경 · 후보 `readonly`, 기한 · 담당자 · 파트 `disabled`, 참조는 칩만(더하기 · 빼기 숨김). 결정 영역은 열어 두되 미룰 때의 '다시 볼 날'(안건 기한을 고친다)은 숨김 | 줄 남기기는 누구나, 기한 고치기는 고치기 권한 |
| 작성자 · 지우기 | 오른쪽 아래 '미룬 횟수 · **작성자** · 만든 날짜', 맨 아래 '안건 지우기'(하위 안건이 있으면 꺼지고 이유). 확인 다이얼로그는 작업과 같은 모양, 409 는 다이얼로그 안에 이유 + 스냅샷 다시 받기. 지우면 스토어에서 안건 · 그 줄 · 작업 연결을 빼고 팝업을 닫는다(→ `/threads`). 받아 둔 확인 요청 · 테스트 목록은 다시 받는다 | 작업 상세와 같은 자리 · 모양 |
| 이력 줄 | [고치기] 옆 [지우기](같은 확인 다이얼로그, "이 결정 줄을 지울까요?"), 둘 다 `canEditEntry` 일 때만. 지우면 응답 안건으로 갈아끼우고 줄을 뺀다 | 상태는 서버가 다시 잰다 |
| 변경 이력 | 이력 칸 아래에 `HistorySection kind="thread"`. `lib/history` 에 `thread` 칸 표 · 칸 이름(제목 · 배경 · 후보 · 담당자 · 파트 · 기한 · 참조) · '결정 줄 고침 / 메모 / 지움'(subject = kind, 이름은 `ENTRY_KIND_LABEL` — `EntryKindBadge` 도 이것을 쓴다). 후보는 본문처럼 전 · 후 블록 | 작업 · 테스트와 같은 부품 |
| 목업 | 고치기는 스토어가 403 토스트로 막는다(`rejectEdit`). 지우기는 `api/threads.ts` 목업 갈래가 404 → 403 → 409 순, 줄 지우기는 `lib/thread.ts` `threadStateOf` 로 상태를 다시 잰다. 등록 · 줄 남기기 · 회의록 반영은 `creatorId` 를 로그인한 사람으로 찍고, 등록 · 고치기 · 지우기는 `recordMockHistory('thread', …)` 로 이력을 남긴다 | 서버와 같은 순서 · 같은 코드 |
| 픽스처 | 안건 · 이력 줄 `creatorId` = 그 `ownerId`(없으면 null), 안건마다 `hh-<id>-1` 등록 줄(바꾼 사람 = 작성자) | 서버 시드와 같게 |

- [x] `types/domain.ts`(`EntryDeleteResult`) · `lib/access.ts` · `lib/thread.ts` · `lib/history.ts` · `api/threads.ts`(`deleteThread` · `deleteEntry` + 목업) · `api/history.ts`(`fetchThreadHistory`) · `api/minutes.ts` · `fixtures/threads.ts` · `fixtures/history.ts`
- [x] `stores/thread.ts` — 권한 · `rejectEdit` · 목업 이력 · `deleteThread` · `deleteEntry`, `stores/history.ts` 의 `thread` 갈래
- [x] `ThreadDetailDialog` · `ThreadFields` · `ThreadPropertyPanel` · `ThreadDecisionPanel` · `CcField`(`readonly` / `disabled`)
- [x] 검사 — `lib/access.test.ts` · `lib/thread.test.ts` · `lib/history.test.ts` · `api/history.test.ts` · `HistoryTimeline.test.ts` · `stores/thread.test.ts`(creatorId · 목업 403 · 지우기 · 409 · 상태 재계산 · 이력) · `stores/server.test.ts`(DELETE · 409 · 응답 안건 · GET 이력) · `views/ThreadListView.test.ts`(읽기 전용 · 버튼 · 확인 · 취소 · 409 · 줄 지우기 · 변경 이력). 화면 · 스토어 검사는 프로젝트 관리자(u1)로 들어온다
- [ ] 계약이 API.md · docs/api 에 올라가면 맞춰 본다. 서버 모드로 한 번 돌려 본다

## 22단계 · 간트 줄 끌어 옮기기 — 상위 · 형제 순서

"간트에서 끌어 놓아 상위를 바꾸고 순서를 바꾼다." 계약은 서버와 맞춘 초안(2026-11-03) — `Task.order`(같은 상위 안 0부터, 시드 · 픽스처는
배열 순서), `POST /api/tasks/{id}/move` `{ parentId, beforeId }` → 200 `Task[]`(order · parentId 가 바뀐 것만, 같은 자리면 `[]`).
상위 검사는 PATCH 와 같은 코드 + 400 `TASK_BEFORE_NOT_SIBLING`, 권한은 옮기는 작업의 고치기(403), 상위가 바뀔 때만 `parentId` 이력.
막대 끌기(기간)는 그대로다.

| | 결정 | 왜 |
| --- | --- | --- |
| 차트 | `GanttChart` 의 `reorderable` · `canDrop` prop — 작업 간트만 켠다. `order_branch = 'marker'` · `order_branch_free`. `onBeforeRowDragMove` · `onBeforeRowDragEnd` 가 잠긴 줄 · 자기 아래 · 4단 줄(+ 숨김) 밑 · `canDrop` 이 막는 자리를 거절, `onRowDragEnd` 가 `getParent` · `getNextSibling` 으로 `reorder(id, parentId, beforeId)` | 놓기 전에 막아 튕기는 일이 없게 |
| 되돌리기 | 차트는 parse 에 items 사본을 준다(dhtmlx 가 받은 객체를 고친다). 놓은 뒤 한 박자 안에 items 가 안 바뀌면(스토어가 거절 · 같은 자리) items 로 다시 그린다. 서버 실패는 스냅샷을 다시 받아 돌아온다 | 차트 안의 자리가 스토어와 어긋나지 않게 |
| 뒤 형제 | `TaskGantt` 가 바로 뒤 줄이 진짜 형제가 아니면(상위가 걸러져 최상위로 선 줄) `beforeId = null` 로 보낸다 | 서버는 400 을 낸다 |
| 스토어 | `moveTask` — `rejectEdit` → `lib/task` `moveProblem`(목업 · 서버 모드 모두, 서버와 같은 code 로 토스트) → `placeTask` 로 화면에 먼저 놓고 → `data.save('move:<프로젝트>')` 응답으로 갈아끼움. `canMove(id, parentId)` 는 간트가 놓기 전에 묻는다 | 고리가 생긴 트리를 잠깐이라도 그리지 않게 |
| 순서 | `toGanttItems` · 작업 상세의 하위 목록은 `order` 로 선다. 목록 · 칸반은 등록순 그대로. 새 작업(등록 · 일괄 · 회의록 반영 목업)과 상위 바꾸기(PATCH 목업)는 그 상위의 맨 끝(`nextTaskOrder`) | 계약 1절 |
| 목업 | `api/tasks.ts` `moveTask` 목업 갈래는 404 → 403 → 상위 검사 → 형제 순으로 보고 바뀐 사본을 낸다(갈아끼우기는 스토어 몫 — 목업 스토어는 같은 계산을 직접 한다). 이력은 스토어가 `logPatch` 로 | 서버와 같은 순서 · 같은 코드 |

- [x] `types/domain.ts`(`TaskMove`) · `lib/task.ts`(`siblingsInOrder` · `nextTaskOrder` · `moveProblem` · `placeTask`) · `lib/gantt.ts` · `api/tasks.ts` · `api/minutes.ts` · `fixtures/tasks.ts`
- [x] `stores/task.ts`(`moveTask` · `canMove` · 하위 목록 정렬 · 등록 · 상위 바꾸기의 order) · `GanttChart` · `TaskGantt`(hint 에 '줄을 끌면 상위 · 순서가 바뀝니다.')
- [x] 검사 — `lib/gantt.test.ts`(order 정렬) · `stores/task.test.ts`(같은 상위 · 다른 상위 · 최상위 · 같은 자리 · 권한 · 4단 · 고리 · 이력 · 새 작업 맨 끝) · `stores/server.test.ts`(요청 모양 · 응답 갈아끼우기 · 실패 되돌리기 · 보내기 전 막기) · `api/tasks.test.ts`(목업 코드 · 서버 경로) · `TaskGantt.test.ts`(이벤트를 직접 불러 emit · 막기 · 잠금 · 되돌리기 · 테스트 간트는 꺼짐)
- [ ] 브라우저에서 끌어 본다(marker 표시 · 자동 스크롤). 서버 모드로 한 번 돌려 본다

## 23단계 · 안건 간소화 — 제목 · 설명 · 결정내용 · 상태

계약은 `docs/api/agenda.md`(2026-11-04 합의). `thread` → `agenda` 이름 바꾸기에 이어 안건을 네 칸으로 줄인다 —
후보 · 참조 · 상위 안건 · 결정 항목 · 이력 줄(Entry)을 걷고, 상태는 사람이 고른다. `decidedAt` · `decisionRev` 는 서버가 찍는다.

| | 결정 | 왜 |
| --- | --- | --- |
| 결정 판 | `lib/agenda` `nextDecisionMarks` — 결정내용(앞뒤 공백 뗀 값)이 바뀌거나 decided 가 되면 판 +1(둘 다여도 1), decided 에서 벗어나면 `decidedAt` null. 목업 등록 · PATCH · 회의록 반영이 쓰고, 서버 모드도 PATCH 전에 먼저 세운 뒤 응답으로 갈아끼운다 | 확인 요청 버튼이 바로 서게 |
| 상세 | 왼쪽 `AgendaFields`(제목 · 설명 · 결정내용, 벗어나면 PATCH), 오른쪽 `AgendaPropertyPanel` 맨 위 `AgendaStateSelect`. 확인 요청 칸은 결정일 때만, 변경 이력은 그대로 | 계약 '화면' |
| 등록 | 제목 · 설명 · 결정내용 · 상태 넷 — 속성 패널 없이 한 칸 | 담당자 · 기한 · 파트는 상세에서 |
| 목록 | 상태 배지 · 제목 아래 결정내용 첫 줄. '1/2' · 미룬 횟수 · 마지막 기록 · 이력 수 · '3번 이상 미뤄짐' 거르기는 걷음 | 계약 '화면' |
| 변경 이력 | 안건은 칸 표(created · deleted · title · description · decision · state · ownerId · partId · dueDate)에 없는 칸을 그리지 않고, 그것뿐인 줄은 뺀다 | 옛 줄의 options · ccIds · entry… · item… |
| 확인 요청 | `decisionRev` · `decision` 을 찍는다. 묶음은 `agendaId#decisionRev`, 받는 사람은 연결 작업 담당자만 | 참조가 없어졌다 |
| 테스트 기준 | 목업은 안건 변경 이력을 서버 시드와 같은 seq(등록 줄 1 ~ 10 → 이행 '결정내용' 줄 t1 11 · t2 12 · t5 13 · t6 14 → 목업이 남긴 줄)로 세고, 결정내용 칸 · decided 로 바뀐 줄로 기준 바뀜을 낸다. 픽스처 `basisSeq` 는 tc2 12 · tc3 null · tc4 11(바뀜이 있던 tc4 만 계속 있음) | 계약 '따라 바뀌는 기능' · 이행 5 |
| 회의록 | 초안 `agendas` 에 decision · state · partId, 기존 안건은 `updates`(통째로 갈아끼우기). 고름 · 오류 열쇠는 `update:<안건 id>` | 계약에 tempId 가 없다 |
| 근거 칩 | `[[thread:ID]]` 도 같은 안건 칩으로 읽는다 | 저장된 옛 리포트 · 대화 |

- [x] `types/domain.ts` · `fixtures`(결정내용은 이행 규칙 2 ~ 4 로 만든 글, 확인 요청 판 · 글, 이력에 이행 줄) · `api/agendas` · `api/checks` · `api/minutes` · `api/tests` · `api/reports` · `api/risk` · `mockAuth`
- [x] `stores/agenda`(rows · 등록 · 고치기 · 지우기만) · `check` · `minutes` · `minutesDraft` · `task`(작업 상세의 안건 줄) · `lib/history` · `lib/check` · `lib/minutes` · `lib/progress` · `lib/risk`
- [x] `AgendaDecisionPanel` · `DecisionEntryForm` · `EntryKindBadge` · `CcField` 걷음, `AgendaStateSelect` 새로
- [x] 검사 — `lib/agenda.test.ts`(판 · 정한 때 · 첫 줄) · `stores/agenda.test.ts` · `AgendaListView.test.ts` · 확인 요청 · 회의록 · 테스트 기준 · 변경 이력 · 근거 칩
- [ ] 서버 모드로 한 번 돌려 본다(Q67 답 뒤)

## 24단계 · 참조(cc) — 안건 · 테스트

계약은 `docs/api/cc.md`(2026-11-05, 사용자 결정). 담당자는 그대로 1명, 참조 `ccIds: string[]` 를 더한다 — 알아야 하는 사람,
권한 · 리스크와 무관. 서버는 같은 날 다른 에이전트가 붙인다(`0033_cc`).

| | 결정 | 왜 |
| --- | --- | --- |
| 칸 | `CcField`(23단계에 걷었던 것을 되살림) — 고른 사람 칩 · × 로 빼기 · '+ 참조' 셀렉트로 더하기. 후보는 `data.assignable` 에서 이미 고른 사람을 뺀 것, readonly 면 칩만(없으면 '없음'). 비활성 · 부여 해제가 된 사람은 흐린 칩으로 남아 고칠 때도 그대로 보내고, × 로 뺄 수 있다 | 이미 걸린 참조는 서버가 받는다(Q68, 담당자의 Q30 과 같다) |
| 자리 | `AgendaPropertyPanel`(상세 · 등록 다이얼로그 같이) · `TestDetailDialog`(상세 · 추가) 의 담당자 바로 아래 | 계약 '상세 · 등록' |
| 저장 | 상세는 바꾸면 바로 PATCH `{ ccIds }`(통째로, 같은 사람 · 같은 순서면 안 보냄), 등록은 POST 에 실음. 스토어 · 목업이 `uniqueIds` 로 겹친 id 를 앞의 하나만 | 계약 '모양' |
| 목업 검사 | 새로 더하는 id 만 본다 — 이미 걸린 id 는 통과(Q68). 안건은 `data.rejectCc`(400 `AGENDA_CC_NOT_FOUND`, `detail { ccIds: <id> }`), 테스트는 `api/tests` `checkCc`(400 `TEST_CC_NOT_FOUND`) | 서버와 같은 코드 · 같은 규칙 |
| 목록 | 안건 · 테스트 목록 조회 조건의 담당자 옆 '나를 참조' 체크(초기화하면 꺼짐), 안건 줄 제목 곁 '참조 N'(있을 때만, 툴팁에 이름) | 계약 '따라 바뀌는 기능' |
| 확인 요청 | `lib/check` `checkRecipients` — 연결 작업 담당자(작업 순) 다음에 참조(ccIds 순), 겹치면 처음 자리 · 누른 사람 빼기 · 활성만. '받을 사람 없음' 문구 · 칸 안내도 참조를 말한다 | 계약 표 |
| 변경 이력 | `lib/history` 칸 `ccIds` = '참조'(이름들, 비면 '없음'), 안건 · 테스트 모두 담당자 바로 뒤. `diffChanges` 가 배열을 같은 것 · 같은 순서로 견주고 사본으로 남긴다. 옛 안건 이력의 ccIds 줄도 그린다 | 계약 '변경 이력' |
| 픽스처 | t1 = [u1] · t2 = [u2, u4] · tc2 = [u3], 나머지 [] — 이력 줄은 따로 없음 | 서버 시드와 같게 |

- [x] `types/domain.ts`(`Agenda` · `TestCase` · 입력 · 패치) · `fixtures` · `lib/member`(`uniqueIds`) · `lib/history` · `lib/check` · `api/tests` · `api/checks` · `api/minutes` · `stores/data`(`rejectCc`) · `stores/agenda`
- [x] `CcField` · `AgendaPropertyPanel` · `AgendaCreateDialog` · `AgendaDetailDialog` · `TestDetailDialog` · `CheckRequestSection` · `AgendaListView` · `TestsView`
- [x] 검사 — `AgendaListView.test.ts`(줄의 참조 수 · 나를 참조 · 칩 더하기 / 빼기 → 저장 · 이력 · 읽기 전용 · 등록에 실림) · `TestsView.test.ts`(나를 참조 · 칩 → PATCH · 이력 · 추가에 실림) · `api/tests.test.ts`(겹침 · 400) · `stores/auth.test.ts`(안건 400 · 겹침) · `stores/server.test.ts`(POST · PATCH 몸통) · `lib/check.test.ts` · `api/checks.test.ts`(받는 사람에 참조) · `lib/history.test.ts`
- [ ] 서버 모드로 한 번 돌려 본다(서버 `구현` 뒤)

### 2026-11-05 고침 (사용자) — 담당자 · 참조를 찾아 고르기

사람이 많으면 Select 목록에서 찾기 어렵다. 서버 · 계약은 그대로.

| | 결정 | 왜 |
| --- | --- | --- |
| 칸 | `MemberPicker` — `ui/popover`(shadcn-vue 레지스트리, reka-ui Popover) + 찾는 칸 + 목록. 트리거는 `#trigger` 슬롯, 나머지 속성(aria · data-*)은 트리거 버튼에. 열면 '이름으로 찾기' 에 포커스, ↑ ↓ · Enter 로 고르고 Esc 로 닫는다. 맞는 사람이 없으면 '찾는 사람이 없습니다' | Combobox 는 입력칸이 트리거 자리에 있어 지금 트리거 모양을 못 지킨다 |
| 찾기 | `lib/member` `matchMember` — 이름에 부분 일치(대소문자 무시, 한글 그대로). `email` 이 있으면 같이 보지만 지금 `Member` 에는 없다 | 이메일은 관리 화면의 `MemberAccount` 에만 있다 |
| 담당자 | `OwnerSelect` 가 `MemberPicker` 를 쓴다(맨 위 '미정' → null, 열 때 지금 고른 줄에 선다). `TaskPropertyPanel` · `AgendaPropertyPanel` 은 ghost 트리거로, 테스트 상세 · 회의록 검토는 지금 모양 그대로 | 같은 트리거가 세 곳에 복사돼 있었다 |
| 참조 | `CcField` 의 '+ 참조' 가 `MemberPicker`(`exclude` = 고른 사람, `keepOpen`) — 고르면 칩이 더해지고 목록은 열린 채 찾는 말만 빈다. 흐린 칩 · Q68 규칙은 그대로 | 여럿을 잇달아 고른다 |
| 다이얼로그 | 목록은 Portal 로 body 에 — 잘리지 않고, reka 의 겹 레이어라 Esc 는 목록만 닫는다 | |
| 그대로 둔 것 | 목록의 담당자 거르기 · 작업 목록의 '담당자 바꾸기'(일괄, 빈 값 트리거의 동작 메뉴) | 거르기는 바꾸지 않기로, 일괄은 고르는 칸이 아니라 동작 |

- [x] `ui/popover` · `MemberPicker` · `OwnerSelect` · `CcField` · `TaskPropertyPanel` · `AgendaPropertyPanel` · `lib/member`(`matchMember`)
- [x] 검사 — `MemberPicker.test.ts`(포커스 · 걸러짐 · ↓ Enter · 없음 · 미정 · 참조 열린 채 계속) · `AgendaListView.test.ts`(다이얼로그 안에서 포커스 · 찾아 Enter · Esc 는 목록만) · `TestsView.test.ts`(참조 흘려 넣기를 `MemberPicker` 로)

---

## 진행 상황

| 단계 | 상태 |
| --- | --- |
| 0 판 고르기 | **끝남** (2026-09-21) |
| 1 모델과 껍데기 | **끝남** (2026-09-21) |
| 2 작업 화면 넷 | **끝남** — 2-a 목록 · 2-b 추가 · 상세 · 2-c 칸반 · 2-d 간트 (2026-09-22) |
| 3 API 계약 | **연결함** — `src/api/` · 부팅 · 쓰기 동기화 · 목업 스위치 (2026-10-11) |
| 4 안건에 집중 | 회의 걷어냄 · 상세 = 수정 · 결정 입력 (2026-10-11) |
| 5 프로젝트 | 시작 전 |
| 6 품질 | 시작 전 |
| 7 AI 챗봇 | 계약 **합의** (2026-10-11) · **7-1 껍데기(목업) 끝남** · **7-2 서버 붙이기 끝남** (2026-10-11) · **7-4 작업 초안 끝남** (2026-10-12) · **7-3 근거 칩 끝남** (2026-10-16) — `docs/api/chat.md` · Q25 · Q26 · Q28 닫힘 · Q27 열림 |
| 8 로그인 · 관리 | **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-10-13) — 로그인 · 내 메뉴 · 사용자 관리 · 프로젝트 멤버 · 권한 가드. Q29 · Q30 닫음 |
| 9 파트 | **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-10-14) — [내 파트 \| 전체] · 파트 고르기 · 칩 · 거르기 · 멤버 화면 파트 칸. Q32 에 프론트 답을 채움(사용자 답 기다림) |
| 10 관리 화면 나누기 | **끝남** (2026-10-14) — 프로젝트 관리(정보 · 멤버) · 파트 관리(목록 + 상세, `?part=`) · 작업/안건 목록 `?part=` 거르기. 서버 · 계약 그대로 |
| 11 결정 병목 리스크 | 계약 **합의** (2026-10-15) — '리스크' 메뉴 · 기준 바꾸기. **11-1 목업 끝남** (2026-10-15) · 11-2 는 서버 `구현` 뒤 · **11-3 AI 요약 끝남** (2026-10-15, 목업 · 서버 갈래 계약대로). Q36 · Q37 열림 |
| 12 확인 요청 | 계약 **합의** (2026-10-16) — `docs/api/check.md` · Q38 ~ Q41 닫힘. **12-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-16) · **2026-10-19 고침 끝남**(Q42 ~ Q44, 결정 알림 · 참조) — 12-2 는 서버 `구현` 뒤 |
| 13 회의록 | 계약 **합의** (2026-10-19) — `docs/api/minutes.md` · Q45 · Q46 닫힘 · Q47(녹음) 보류. **13-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-19) · **2026-10-20 고침 끝남**(Q48, 게시판 · 저장된 회의록에서 AI 정리 · 출처 `minutesId`). 13-2 는 서버로 한 번 돌려 보기 |
| 14 선행 작업 · 상태 기록 | 계약 **합의** (2026-10-20) — `docs/api/task-flow.md` · Q49 · Q50 닫힘. **14-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-20) · **2026-10-28 선행 작업 걷음**(Q63, 상태 기록만 남음) — 14-2 는 서버로 한 번 돌려 보기 |
| 15 진행 리포트 | 계약 **합의** (2026-10-20) — `docs/api/report.md` · Q49 ~ Q51 닫힘. **15-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-20) — 15-2 는 서버로 한 번 돌려 보기 |
| 16 테스트 | 계약 **합의** (2026-10-27) — `docs/api/test.md` · Q53 ~ Q58 닫힘. **16-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-27, AI 없이) · **2026-10-27 고침 끝남**(성공 · 실패 버튼 + 상태 고르기, 레벨 걷음) — 16-2 는 서버로 한 번 돌려 보기 · AI 넷은 계약 뒤 |
| 17 변경 이력 | 계약 `docs/api/history.md` · Q59 닫힘 (2026-10-27). **17-1 목업 끝남 · 서버 갈래 계약대로 붙임** (2026-10-27) — 17-2 는 서버 `구현` 뒤 한 번 돌려 보기 |
| 18 프로젝트 관리 늘리기 | **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-11-02) — 설명 · 기간 · 상태(준비 · 진행 · 종료, 정보 칸에서 고름) · 삭제(시스템 관리자) · 목록 · 고르기의 상태 표시. 한눈 정보는 걷음 |
| 19 사용자 번호 | **목업으로 끝남 · 서버 갈래는 타입만 맞춤** (2026-11-02) — 사용자 관리 맨 앞 열을 번호로 · 번호 순 · 팝업 제목에 '5번 · 이름' |
| 20 작업 권한 · 지우기 | **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-11-02) — 고치기는 작성자 · 담당자 · 관리자만(상세 읽기 전용 · 목록 · 칸반 · 간트 잠금) · 작성자 칸 · 작업 지우기(확인 · 409) |
| 21 안건 권한 · 지우기 · 변경 이력 | **목업으로 끝남 · 서버 갈래 계약 초안대로 붙임** (2026-11-02) — 안건 · 이력 줄 고치기 · 지우기는 작성자 · 담당자 · 관리자(줄은 남긴 사람도) · 작성자 칸 · 안건 지우기(확인 · 409) · 줄 지우기(상태 재계산) · 변경 이력 칸 |
| 22 간트 줄 끌기 | **목업으로 끝남 · 서버 갈래 계약 초안대로 붙임** (2026-11-03) — 상위 · 형제 순서(`Task.order` · `POST /api/tasks/{id}/move`) |
| 23 안건 간소화 | 계약 **합의** (2026-11-04, `docs/api/agenda.md`) — **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-11-04). Q67 열림 |
| 24 참조(cc) | 계약 `docs/api/cc.md` (2026-11-05, 사용자 결정) — **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-11-05). Q68 닫힘(이미 걸린 참조는 통과) |
| 25 테스트 조치 내역 | 계약 `docs/api/test-comment.md` (2026-11-05, 사용자 결정) — **목업으로 끝남 · 서버 갈래 계약대로 붙임** (2026-11-05). 테스트 상세의 상태 칸(지금 상태 카드 · [성공] · [실패] · 실패 · 막힘 메모)을 걷고 그 자리에 조치 내역(작업 댓글과 같은 타래 — `CommentThread` 로 둘이 같이 씀) · '조치 N' · 지난 결과 메모(읽기 전용). 상태 고르기는 실패 · 막힘도 메모 없이 바로 보냄. 묶음의 하위 요약은 그대로(`TestGroupSummary`) |
| 26 챗봇 테스트 언급 | 계약 `docs/api/chat.md` '테스트 언급 `@HW-T3`' (2026-11-05) — **목업으로 끝남 · 서버 갈래는 글자로만 오가 그대로** (2026-11-05). `@` 목록에 작업 · 테스트를 한 줄로(`lib/mention` `mentionItems` — 작업 먼저, 테스트 줄에 '테스트' 표시 · 테스트 상태 이름), 창을 열면 `testStore.ensure`, 근거 `[[test:ID]]` 칩 → `/tests/:id`(없는 id 는 안 그림), 목업 답 하나 · 검사(`mention.test.ts` · `chat.test.ts` · `ChatWidget.test.ts`) |
| 27 나에게 할당 | 화면만 (2026-11-05, 사용자 요청) — 작업 · 안건 · 테스트 속성 패널(상세 · 등록)의 담당자 칸 오른쪽에 **[나에게 할당]**(`OwnerSelect` `selfAssign`). 내가 그 프로젝트의 활성 멤버이고 아직 내가 담당이 아니며 칸이 막히지 않았을 때만 선다. 누르면 담당자를 고른 것과 같다(같은 저장 길). 회의록 검토의 담당자 칸에는 두지 않았다 |

## 아직 안 정한 것

- 작업 상태 넷(해야 할 일 · 진행 중 · **막힘** · 완료)이 memo 에 없다. 막힘 칸은 캔버스에서
  덧붙인 것이라 memo 에 적어 확정할지 정해야 한다
- 작업에 댓글을 둘지. 지금은 뺐다 — 캔버스에는 있지만 모델에 없고, "정할 게 생기면 댓글 말고
  안건으로"가 이 제품의 방침이라 굳이 필요한지부터 정해야 한다. 두기로 하면 `TaskComment` 부터
- 작업 상세에서 제목 · 기간 · 담당자를 바로 고칠 수 있게 할지 (지금은 상태만 바꿀 수 있다).
  캔버스에도 편집 UI 가 없어 그대로 뒀다
- **상위 작업을 나중에 바꿀 수 있게 하면** 고르는 목록에서 자기 자신과 자손을 빼야 한다.
  지금은 만들 때만 정하므로 고리가 생기지 않는다
- 작업 상세에서 연관 안건을 누르면 팝업이 닫히고 그 화면으로 아예 넘어간다.
  팝업 위에 팝업을 겹치지 않으려고 그렇게 뒀는데, 돌아올 길이 뒤로가기뿐이다
- ~~dhtmlx-gantt Community 라이선스~~ — v10 부터 MIT 다 (`.claude/agents/frontend.md` 에 적혀 있다)
- 간트에서 막대를 끌어 기간을 바꾸는 것 말고, 묶음 작업의 기간을 사람이 직접 잡게 할지.
  지금은 dhtmlx 의 project 타입이라 자식들의 기간을 따라가고 끌 수 없다 — 스토어에 들고 있는
  묶음 작업의 `start` · `due` 는 화면에서 무시된다

# 저장한 AI 리스크 분석 — 게시판 (2026-11-06)

[AI 리스크 분석] 결과를 **사람이 [저장] 을 눌러 제목을 붙여** 남기고, 리스크 화면의 **'저장한 분석' 게시판**에서
다시 본다. 분석 자체(요청 · SSE · 근거 · 답의 모양)는 `risk.md` 'AI 요약' · 'AI 리스크 분석 — 근거 넓히기' 그대로다.
이 파일이 저장 · 게시판 계약의 정답이다.

> **2026-11-06 세 종류로 (`risk-dashboard.md`)** — `facts` 에 `tasks` · `tests` 스냅샷, `compare` 의 줄은 `{ kind, id }`(`kept` 는 `+ levelFrom · levelTo`), `RiskAnalysisListItem` 에 `taskCount` · `testCount`, `highCount` 는 세 종류 합.
> 이미 저장한 분석(아래 옛 모양 — 문자열 · `agendaId` · 기준 넷)은 서버가 고치지 않고 그대로 낸다. 아래 모양은 그 전의 기록이다.

**리포트 메뉴를 걷는다** — 리포트(`report.md`)는 '지난 7일 숫자 + Claude 가 먼저 손쓸 것' 을 저장하는 기능이었는데,
고도화한 AI 리스크 분석과 하는 일이 겹친다. 리포트만의 장점(저장 · 지난 것 대비)을 여기로 옮긴다.

## 정해 둔 것 (사용자, 2026-11-06)

| | 결정 |
| --- | --- |
| 저장 | **저절로 저장하지 않는다.** 분석이 끝나면 [저장] 버튼 → 제목을 받아 저장. 안 누르면 남지 않는다(`risk.md` 의 '서버에 남기지 않는다' 는 '누르기 전까지는' 으로 바뀐다) |
| 게시판 | 리스크 화면의 **'저장한 분석' 탭** — 번호 · 제목 · 작성자 · 저장일 · 짚은 안건 수. 최신이 위. 누르면 상세 |
| 무엇을 남기나 | 제목 · Claude 의 글 · 근거 칩(`refs`) · **그때의 리스크 줄 스냅샷**(안건 · 등급 · 점수 · 신호 · 담당자) · 지난 저장 분석 대비 · 만든 사람 · 시각 |
| 지난 분석 대비 | 분석할 때 서버가 **바로 앞 저장 분석**의 스냅샷과 비교해 새로 생김 · 풀림 · 계속 남음을 세고, Claude 에도 넣어 글에서 짚게 한다 |
| 고치기 | **제목만**, 작성자만. 글 · 스냅샷은 고치지 않는다(기록) |
| 지우기 | 작성자 · 그 프로젝트 관리자 · 시스템 관리자 |
| 리포트 | 메뉴 · 화면 · API · 목업 · 시드를 걷고, **`project_report` 테이블을 지운다**(이행 0037 — 사용자 결정, 저장된 1건도 버린다) |
| 진척 숫자 | 리포트의 '이번 주 완료율 · 완료 수' 는 분석 근거에 넣지 않는다(지금은) |

## 저장 방식 — 임시 분석(draft)

화면이 받은 글을 다시 보내 저장하면 글 · 스냅샷을 서버가 믿을 수 없다. 그래서 **분석이 끝날 때 서버가 임시로 남기고**,
[저장] 은 그 임시 분석에 제목을 붙여 게시판에 올린다.

- `POST /api/projects/{projectId}/risks/summary` 가 **Claude 답을 끝까지 받으면**(길이 상한으로 끊긴 것 포함) `risk_analysis` 에
  `saved_at = null` 인 줄을 넣고, `done` 이벤트에 **`analysisId`** 를 더한다
  - 거른 뒤 비어 Claude 를 부르지 않은 경우(`지금 짚을 리스크가 없습니다.`) · `error` · 화면이 멈춘 경우는 남기지 않는다 → `done` 에 `analysisId` 가 없다(화면은 [저장] 을 안 보인다)
- 임시 분석은 **그 분석을 돌린 사람만** 저장할 수 있다. **24시간**이 지나면 저장할 수 없고(404), 서버는 새 분석을 넣을 때 24시간 넘은 임시 줄을 지운다
- 게시판 · 상세 · 다른 API 는 **저장한 것(`saved_at` 있는 것)만** 본다 — 임시 분석은 어디에도 보이지 않는다

## 테이블 `risk_analysis` (리비전 `0037_risk_analysis`, 같은 이행에서 `project_report` 를 지운다)

| 칸 | 타입 | |
| --- | --- | --- |
| `id` | str PK | |
| `project_id` | FK → project (ON DELETE CASCADE) | |
| `seq` | int, null 가능 | 게시판 번호 — **저장할 때** 프로젝트 안에서 1 부터 매긴다(임시는 null). 지워도 번호를 다시 쓰지 않는다 |
| `title` | str(100), null 가능 | 저장할 때 받음 |
| `body` | text | Claude 의 글 그대로 |
| `refs` | json | `done.refs` 그대로 (`ChatRef[]`) |
| `facts` | json | 아래 `RiskAnalysisFacts` |
| `created_by` | FK → member, null 가능 (ON DELETE SET NULL) | 분석을 돌린 사람 = 작성자 |
| `created_at` | timestamptz | 분석한 시각 |
| `saved_at` | timestamptz, null 가능 | 저장한 시각. null 이면 임시 |
| `title_edited_at` | timestamptz, null 가능 | |

## 모양

```ts
/** done 이벤트 (risks/summary 만) — analysisId 가 는다 */
interface RiskSummaryDone {
  refs: ChatRef[]
  /** 저장할 수 있는 임시 분석 id — Claude 를 부르지 않았으면 없다 */
  analysisId?: string
}

interface RiskAnalysisFacts {
  /** 분석 때의 리스크 보고서 asOf · 기준 */
  asOf: string
  settings: RiskSettings
  /** 분석에 넣은 안건 리스크 줄(화면이 보낸 agendaIds 로 거른 것) — 점수 순 */
  agendas: {
    agendaId: string
    key: string | null        // 안건 키가 있으면
    title: string
    level: 'high' | 'medium' | 'low'
    score: number
    signals: string[]          // AgendaRisk 의 신호 이름 그대로
    ownerName: string | null
  }[]
  /** 바로 앞 저장 분석 대비 — 앞 것이 없으면 null */
  compare: {
    previousId: string
    previousTitle: string
    previousSavedAt: string
    /** 이번에 새로 들어온 안건 */
    added: string[]
    /** 앞에 있었는데 이번에 없는 안건 (풀렸거나 범위 밖) */
    removed: string[]
    /** 둘 다 있는 안건 — 등급이 바뀌었으면 from · to */
    kept: { agendaId: string; levelFrom: string; levelTo: string }[]
  } | null
}

/** 게시판 한 줄 */
interface RiskAnalysisListItem {
  id: string
  projectId: string            // Q70 (2026-11-06) — 상세 경로에 프로젝트가 없어서
  seq: number
  title: string
  createdBy: string | null
  createdAt: string
  savedAt: string
  agendaCount: number          // facts.agendas 길이
  highCount: number            // 그중 high
}

/** 상세 */
interface RiskAnalysis extends RiskAnalysisListItem {
  body: string
  refs: ChatRef[]
  facts: RiskAnalysisFacts
  titleEditedAt: string | null
}
```

- `compare` 의 기준은 **분석을 돌린 때** 그 프로젝트의 가장 최근 저장 분석이다. 저장 순서가 바뀌어도 다시 세지 않는다(기록)
- Claude 에 넣는 근거에 `compare` 를 더한다 — 앞 분석의 제목 · 날짜와 added · removed · kept(등급 변화) 를 안건 **제목 · 키**로. 프롬프트: "지난 분석 대비 달라진 점을 한 줄로(있을 때만)", 숫자 · 이름은 넣어 준 그대로

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/risk-analyses` | 게시판 — 저장한 것만, `seq` 내림차순. `?limit=`(기본 50, 최대 200) `&offset=` | `{ items: RiskAnalysisListItem[], total: number }` |
| POST | `/api/projects/{projectId}/risk-analyses` | 저장 — `{ analysisId, title }`. 내가 돌린 임시 분석이어야 한다 | 201 `RiskAnalysis` |
| GET | `/api/risk-analyses/{analysisId}` | 상세 (저장한 것만) | `RiskAnalysis` |
| PATCH | `/api/risk-analyses/{analysisId}` | 제목 고치기 — `{ title }`, 작성자만(그 밖 403 `FORBIDDEN`) | `RiskAnalysis` |
| DELETE | `/api/risk-analyses/{analysisId}` | 지우기 — 작성자 · 프로젝트 관리자 · 시스템 관리자(그 밖 403) | 204 |

- 권한: 보기 · 저장은 그 프로젝트 멤버(아니면 404 `PROJECT_NOT_FOUND`). `analysisId` 경로는 `require_scope` 경계 검사에 든다
- 제목: 앞뒤 공백을 떼고 1 ~ 100자, 아니면 422 `VALIDATION_ERROR`(`detail.title`)
- 저장: 없거나 · 다른 프로젝트 · 남이 돌린 · 24시간 지난 임시 분석이면 404 `RISK_ANALYSIS_NOT_FOUND`. **이미 저장한 것**이면 409 `RISK_ANALYSIS_ALREADY_SAVED`
- 상세 · 고치기 · 지우기: 임시 · 없는 것 · 못 보는 프로젝트 것은 404 `RISK_ANALYSIS_NOT_FOUND`

## 오류 코드 (늘어나는 것)

| 상태 | `code` | 언제 |
| --- | --- | --- |
| 404 | `RISK_ANALYSIS_NOT_FOUND` | 위 |
| 409 | `RISK_ANALYSIS_ALREADY_SAVED` | 같은 임시 분석을 두 번 저장 |

리포트의 오류 코드(`REPORT_*`)는 걷는다.

## 걷는 것 — 리포트

- 서버: `/api/projects/{projectId}/reports…` · `/api/reports/{reportId}` 전부(404), `models/report.py` · `schemas/report.py` · `api/report.py` · `services/report.py`, 접근 경계의 report, 챗봇에 리포트 도구가 있으면 그것도, 시드의 리포트
  - `services/progress.py` 는 리포트만 쓰면 걷고, 다른 데서 쓰면(리스크 · 테스트 등) 쓰는 부분만 남긴다
- 화면: 왼쪽 메뉴 '리포트', `/reports` · `/reports/:reportId`(→ `/risks?tab=saved` 로 보낸다), `ReportsView` · `ReportDetailView` · `ReportFactsCards` · `stores/report` · `api/reports` · `fixtures/reports` · 목업 · 타입. `lib/progress.ts` 는 리포트만 쓰면 걷는다
- 문서: `report.md` 머리에 '2026-11-06 걷음 — `risk-analysis.md`' 를 적고 본문은 기록으로 둔다

## 시드 · 목업

시드에는 넣지 않는다(개발 DB 에 시드를 다시 돌리지 않는다). 목업은 저장한 분석 2건을 둔다(하나는 `compare: null`, 하나는 앞 것 대비).
목업의 요약 스트림도 `done` 에 `analysisId` 를 싣는다.

## 화면

- **리스크 화면 위에 탭** `[지금 리스크 | 저장한 분석 N]` — 쿼리 `?tab=saved` 로 기억(뒤로 가기 됨)
- **지금 리스크 탭** — 지금 화면 그대로. AI 리스크 분석이 끝나고 `analysisId` 가 있으면 [다시 분석] 옆에 **[저장]**
  - [저장] → 작은 창: 제목 칸(기본값 `리스크 분석 YYYY-MM-DD`, 100자) · [저장] [취소]. 저장하면 버튼이 '저장됨 ✓ · [보기]' 로 바뀐다(같은 분석을 또 저장하지 않게)
  - 목록이 바뀌어 분석이 흐려진 상태에서도 저장할 수 있다(그때 분석한 것을 남기는 것이라)
  - 404(24시간 지남) 이면 "오래된 분석이라 저장할 수 없습니다. 다시 분석해 주세요."
- **저장한 분석 탭(게시판)** — 표: 번호 · 제목 · 작성자(동그라미 + 이름) · 저장일 · 안건(높음 n / 전체 m). 비면 "저장한 분석이 없습니다 — 지금 리스크 탭에서 분석하고 [저장] 하세요". 50개씩 [더 보기]
- **상세 `/risks/analyses/:analysisId`** — 머리: 제목 · 작성자 · 저장일 · '분석 기준 asOf'. [목록] · 작성자면 [제목 고치기] · 지울 수 있으면 [지우기](확인)
  - 본문: Claude 글(근거 칩 — 누르면 상세 팝업, 지금 분석 카드와 같은 부품). 지운 안건 · 작업 칩은 지금처럼 '찾을 수 없음' 처리
  - '그때의 리스크' 표: 안건 · 등급 · 점수 · 신호(화면 말) · 담당자 — 스냅샷이라 지금 값이 아니다(표 위에 'asOf 기준')
  - '지난 분석 대비' (compare 가 있을 때): 앞 분석 제목(링크) · 새로 생김 n · 풀림 n · 등급 바뀜 n 과 그 안건들

## 구현에서 메운 것 (서버, 2026-11-06)

계약이 말하지 않은 자리를 이렇게 메웠다. 모양 · 경로 · 코드는 위 그대로다.

| | 메운 것 |
| --- | --- |
| 게시판 번호 | `project.last_analysis_no` 카운터(리비전 `0037` 이 더함, 기본 0)를 `update … returning` 한 문장으로 올려 쓴다 — 작업 번호와 같은 수법. 최댓값+1 이면 맨 뒤를 지운 뒤 번호를 다시 쓴다. `(project_id, seq)` unique(임시의 null 은 여럿) |
| `projectId` | **더했다(`API.md` Q70, 프론트 요청)** — `RiskAnalysisListItem`(그래서 `RiskAnalysis` 도)에 `projectId: string`. 상세 경로에 프로젝트가 없어 화면이 어느 프로젝트 것인지 알게 |
| `key` | 안건에는 아직 키가 없어 **늘 `null`** 이다. 안건 키가 생기면 그때 채운다 |
| `ownerName` | 분석 때 담당자 이름. 담당자가 없으면 `null` |
| `signals` | `AgendaRisk.signals` 그대로(계약대로 `string[]`) |
| `kept` | 둘 다 있는 안건은 등급이 같아도 싣는다(`levelFrom` = `levelTo`). 순서는 이번 분석 순(점수 순), `removed` 는 앞 분석 순 |
| `compare` 의 앞 분석 | 분석을 돌린 때 그 프로젝트에서 **번호가 가장 큰** 저장 분석. 그 뒤 앞 분석을 지워도 `compare` 는 그대로다(`previousId` 가 404 일 수 있다 — 화면은 링크를 '찾을 수 없음' 으로) |
| Claude 에 넣는 `compare` | `previousTitle` · `previousSavedOn`(한국 날짜) · `previousAgendaCount` · `added` · `removed` · `kept`(`levelFrom` · `levelTo`). 안건은 **id 없이 `title`(키가 있으면 `key`)** — 빠진 안건은 지웠을 수도 있어 칩이 되지 않게. 앞 분석이 없으면 `compare: null`. 답의 모양에 '지난 분석 대비 — 달라진 점 한 줄'(있을 때만) |
| 남기는 글 | 화면에 보인 그대로 — 길이 상한으로 잘리면 `TRUNCATED` 한 줄까지. `refs` 는 `done.refs` 와 같다 |
| 임시를 남기다 실패 | 글은 이미 다 보였으니 `error` 를 내지 않고 `analysisId` 없는 `done` 으로 끝낸다(로그만). 화면은 [저장] 을 안 보인다 |
| 24시간 정리 | 새 임시를 넣을 때 **모든 프로젝트의** 24시간 넘은 임시 줄을 지운다. 저장에서 24시간 판단은 `created_at` 기준 |
| 저장의 순서 | 없음 · 다른 프로젝트 · 남이 돌린 것 → 404, 그다음 이미 저장 → 409, 그다음 24시간 지남 → 404. 남의 저장한 분석 id 를 보내도 404(있다는 것을 안 알린다). 행을 `FOR UPDATE` 로 잠가 같은 분석이 두 번 오르지 않게 |
| 제목 고치기 | 시스템 관리자 · 프로젝트 관리자도 남의 제목은 못 고친다(403). 같은 제목이면 `titleEditedAt` 을 찍지 않는다 |
| 경로 경계 | `require_scope` 의 `analysis_id` 갈래는 **저장한 것만** 찾는다 — 임시 id 로 상세 · 고치기 · 지우기를 부르면 돌린 사람도 404. 지운 프로젝트 것도 404 |
| 작성자 | `createdBy` 는 분석을 돌린 사람(= 저장한 사람). 계정 줄을 지우면 `null`(`ON DELETE SET NULL`) |
| 리포트 걷기 | `services/progress.py` 는 `kst_day` 만 남겼다(테스트 며칠째 · 리스크 분석이 쓴다). 리비전 `0037` 의 downgrade 는 빈 `project_report` 를 0016 모양으로 되살리고 `risk_analysis` · `last_analysis_no` 를 지운다 — 지운 리포트는 못 되살린다 |

## 구현에서 메운 것 (화면, 2026-11-06)

계약이 말하지 않은 것을 화면 · 목업에서 이렇게 정했다. 서버와 갈리면 서버 쪽을 따라 고친다.

- **스트림 읽기** — `done` 의 `analysisId` 는 문자열일 때만 싣는다(`api/chat.ts` `toChatEvent`, 챗봇 · 리스크가 같이 쓴다). 화면 타입은 `ChatEvent` 의 `done` 에 `analysisId?` 를 더했다 — 리스크만 실어 온다
- **[저장] 이 서는 때** — `status === 'done'` 이고 `analysisId` 가 있고 아직 저장하지 않았을 때. 멈춤 · 오류 · 빈 답에는 없다. '목록이 바뀌었습니다' 로 흐려져도 선다. [다시 분석] 하면 새 분석이라 다시 [저장] 이 선다
- **제목 창** — 기본값 `리스크 분석 YYYY-MM-DD`(한국 시간 오늘), `maxlength` 100 · 'n/100'. 앞뒤 공백은 화면도 떼고 보낸다. 빈 칸이면 [저장] 이 꺼진다. 실패하면 창을 닫지 않고 창 안에 한 줄 — 404 는 '오래된 분석이라 저장할 수 없습니다. 다시 분석해 주세요.', 422 는 `detail.title`, 그 밖은 서버 문구
- **409 `RISK_ANALYSIS_ALREADY_SAVED`** — 같은 id 가 이미 게시판에 있다는 뜻이라 오류로 띄우지 않고 '저장됨 · [보기]' 로 바꾸고 게시판을 다시 받는다
- **'저장됨 · [보기]'** — [보기] 는 `/risks/analyses/{id}`. 저장한 분석의 id 는 `analysisId` 그대로다(응답 `RiskAnalysis.id`)
- **탭** — 상단 줄 '리스크' 옆 `[지금 리스크 | 저장한 분석 N]`(확인 요청 화면의 탭과 같은 모양). `?tab=saved` 는 `router.push` 라 뒤로 가기가 탭을 되돌린다. 탭을 바꿔도 AI 분석은 남는다(같은 화면). 게시판 탭에서는 [새로 고침] · [기준 바꾸기] · [내 파트 | 전체] · 'N/N 기준' 을 숨긴다 — 게시판은 파트로 거르지 않는다. N 은 게시판 `total` — 화면에 들어올 때 · 프로젝트를 바꿀 때 첫 50개와 같이 받는다
- **게시판** — 번호 · 제목 · 작성자(`MemberAvatar` 20px + 이름, 계정이 지워져 `createdBy` 가 null 이면 '알 수 없음') · 저장일(`savedAt`, '11월 6일 10:14') · 안건 '높음 n / 전체 m'(n > 0 이면 붉게). 줄을 누르면 상세. [더 보기] 는 `offset` = 받은 줄 수로 50개씩, 그사이 지워져 겹치는 줄은 한 번만
- **상세** — 머리에 `#번호` · 제목 · 작성자 · '… 저장' · '분석 기준 10월 15일'(가리키면 그때의 기준 한 줄). 위 줄의 '‹ 목록' 이 [목록](`/risks?tab=saved`). 버튼은 작성자면 [제목 고치기], 작성자 · 프로젝트 관리자 · 시스템 관리자면 [지우기](확인 창) — 버튼 숨김과 목업 403 이 같은 함수(`canEditComment` · `canDeleteComment`). 지우면 게시판으로
- **'그때의 리스크' 표** — 안건(키가 있으면 앞에 · 제목 · 신호 배지) · 등급 · 점수 · 담당자(`ownerName`, 없으면 '미정'). 신호 화면 말은 리스크 화면과 같은 `AGENDA_SIGNAL_LABEL`, 모르는 이름은 글자 그대로. 지금도 있는 안건 줄만 눌러 상세 팝업이 뜬다
- **'지난 분석 대비'** — 앞 분석 제목(링크) · 그 저장 시각 · '새로 생김 n' · '풀림 n' · '등급 바뀜 n'(`kept` 중 `levelFrom ≠ levelTo` 만) 과 그 안건 배지. 안건 이름은 이번 스냅샷 → 지금 안건 순으로 찾고, 없으면 '찾을 수 없는 안건'(앞 분석에만 있던 지운 안건). 앞 분석을 지웠으면 링크를 따라간 상세가 '분석을 찾을 수 없습니다' 를 띄운다
- **상세의 프로젝트** — 응답의 `projectId`(Q70)로 가른다. 지금 고른 프로젝트와 다르면 그 프로젝트로 옮긴다(`setProject` — 근거 칩 · [지우기] 판단이 그 프로젝트 기준이 된다). 보는 중에 위에서 다른 프로젝트로 바꾸면 게시판으로 간다
- **목업** — `fixtures/riskAnalyses.ts` 의 저장 분석 둘(p1: `ra1` 김서연 · compare null, `ra2` 이도현 · `ra1` 대비). 요약 스트림이 끝까지 흐르면 `mockCreateRiskDraft` 가 임시 줄을 넣고 `done.analysisId` 를 싣는다(거른 뒤 비면 안 넣는다, 24시간 넘은 임시 줄은 이때 지운다). 저장 검사 순서는 프로젝트(404 `PROJECT_NOT_FOUND`) → 제목(422) → 분석(없음 · 다른 프로젝트 · 남이 돌림 404 → 이미 저장 409 → 24시간 지남 404 — 서버 '저장의 순서' 와 같다). 같은 제목으로 고치면 `titleEditedAt` 을 찍지 않는다(서버와 같다). `limit` 은 1 ~ 200 으로 잘라 쓴다(서버가 422 로 막으면 그쪽을 따른다)
- **걷은 것** — 왼쪽 메뉴 '리포트', `ReportsView` · `ReportDetailView` · `ReportFactsCards` · `ReportAttentionTable` · `stores/report` · `api/reports` · `fixtures/reports` · 목업 저장소의 `reports` · 리포트 타입(`ProgressFacts` · `TaskAttention*` · `PersonProgress` · `Report*`). `lib/progress.ts` 는 리포트만 써서 테스트째 걷었다. `/reports` · `/reports/:reportId` 는 `/risks?tab=saved` 로 보낸다

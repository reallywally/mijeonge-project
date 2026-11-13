# 문서 — 합의 (2026-11-12)

여러 안건에서 정한 것을 **주제 하나로 묶어 정리하는 문서**다. 안건1 에서 "서버 OS 는 우분투",
안건2 에서 "서버 스펙은 CPU 2 · RAM 4GB" 로 정했으면 '서버' 문서 하나에 둘을 모아 적는다.
안건은 '정해야 할 것 하나' 라 흩어지고, 문서는 '지금 정해진 모습' 을 한 장으로 보인다.
이 파일이 문서 계약의 정답이다. 순서는 `server/PLAN.md` · `web/PLAN.md` 의 '문서' 단계.

## 정해 둔 것 (2026-11-12)

| | 결정 | 왜 |
| --- | --- | --- |
| 종류 | 둘 — **`text` 글 문서**(워드처럼) · **`sheet` 표 문서**(엑셀처럼). 만들 때 고르고 바꾸지 않는다 | |
| 글 편집기 (2026-11-13 고침, 사용자) | **워드처럼 쓰는 편집기 — Tiptap 3(MIT)**. 본문은 편집기가 낸 **HTML** 로 저장한다. **mammoth(BSD-2)** 로 .docx 를 가져오고 **docx(MIT)** 로 .docx 를 내려받는다. 처음의 마크다운 textarea · 미리보기는 걷었다. 예전 마크다운 글은 열 때 화면이 HTML 로 옮겨 싣고, 고치면 HTML 로 저장된다(이행 없음) | 사용자가 표처럼 글도 워드처럼 쓰고 Word 파일을 주고받기를 바랐다. CKEditor · TinyMCE 는 Word 변환이 유료 · GPL, OnlyOffice 는 문서 서버가 따로 필요하다 |
| 표 편집기 (2026-11-12 고침, 사용자) | **웹 스프레드시트 — Jspreadsheet CE v5(MIT)** 로 편집하고 **SheetJS(CE, Apache-2.0)** 로 .xlsx 를 가져오고 내보낸다. 수식 · 셀 병합 · 글꼴 · 배경 · 정렬 · 열 너비 · 시트 탭 여럿 · 엑셀 복사 붙여넣기 · 되돌리기. 처음의 '머리 줄 + 칸 입력칸' 표는 걷었다. **열 머리는 엑셀처럼 늘 A · B · C** — 열 이름을 따로 두지 않고, 이름이 필요하면 첫 줄 칸에 적는다(2026-11-12 고침, 사용자) | 사용자가 처음부터 바란 것은 엑셀처럼 웹에서 편집하는 표였다. Handsontable 은 상용 라이선스, Univer 는 '간단하게' 에 비해 너무 크다 |
| 안건과는 | **연결** — 문서 하나에 안건 0 ~ 50개(`document_agenda`). 연결 순서를 지킨다 | 무엇을 모아 적었는지가 남아야 결정이 바뀔 때 알아챈다 |
| 결정이 바뀌면 | 연결할 때 · [확인] 할 때 그 안건의 **결정 판(`decisionRev`)을 적어 둔다(`seenRev`)**. 지금 판이 더 크면 **'결정 바뀜'** — 목록 · 문서 화면에 표시, [확인] 으로 지운다 | 테스트의 '기준 바뀜' 과 같은 생각이다. 문서가 옛 결정을 적은 채 남는 것을 막는다. 본문은 사람이 고친다 |
| 본문에 넣기 | 화면이 연결한 안건의 **결정내용을 본문에 끼워 넣는다**(글: 제목 + 결정 블록, 표: 한 줄). 서버는 본문을 해석하지 않는다 | 넣은 뒤엔 사람이 다듬는 글이다. 본문과 안건을 묶어 두면 고치기가 어려워진다 |
| 같이 고치기 | **판 번호(`rev`)로 겹침을 막는다** — 제목 · 본문 · 표를 고칠 때 `rev` 를 보내고, 다르면 409 `DOCUMENT_STALE`. 연결 · 확인 · 파트는 판을 안 올린다 | 자동 저장이라 둘이 같은 문서를 열면 소리 없이 덮어쓴다. 실시간 공동 편집은 크다 |
| 파트 | `partId` — null 은 프로젝트 공통. 목록은 **전체로 시작**(안건과 같다), 볼 파트 고르기는 기억한다 | 주제 문서는 파트를 넘는 일이 많다 |
| 권한 | 아래 '권한' | 작업 · 테스트의 파트 권한(`part.md`)을 그대로 쓴다 |
| 변경 이력 | **1단계엔 없다** — 마지막으로 고친 사람 · 시각(`updatedBy` · `updatedAt`)만 | 본문 전 · 후 비교는 따로 큰 일이다 |
| 지우기 | **진짜 지운다**(연결 줄도 cascade). 안건 · 작업처럼 논리 삭제를 두지 않는다 | 다른 것이 문서를 가리키지 않는다 |
| 챗봇 · 검색 | **1단계엔 없다** — '나중' | |
| 폴더 (2026-11-13, 사용자) | **문서를 폴더 트리로 둔다** — 왼쪽에 폴더 · 문서 트리, 오른쪽에 고른 문서의 보기 · 편집. 게시판 꼴 목록은 걷는다. 아래 '폴더' | 문서가 늘면 주제별로 묶어 관리하는 쪽이 낫다(사용자) |

## 테이블 (리비전 `0041_document`)

```
document
  id · project_id → project cascade
  unique (id, project_id)
  title        text not null                  -- 앞뒤 공백 뗀 1 ~ 200자
  kind         'text' | 'sheet'                -- check, 바꾸지 않는다
  content      text not null default ''        -- text 의 본문(HTML). sheet 는 ''
  sheet        json not null                   -- SheetBook { sheets: SheetTab[] }. text 는 {"sheets":[]}  (0042 에서 옛 {columns, rows} 를 옮김)
  part_id      FK (part_id, project_id) → part(id, project_id)   null 가능
  rev          int not null default 1          -- 제목 · 본문 · 표가 바뀔 때마다 서버가 1 올린다
  created_by → member null 가능 · created_at
  updated_by → member null 가능 · updated_at   -- 만들 때는 created 와 같다. 제목 · 본문 · 표 · 파트 · 연결 · 확인 무엇이든 바뀌면 찍는다
  seq          bigint Identity unique
index (project_id, updated_at)

document_agenda
  document_id · project_id  FK (document_id, project_id) → document(id, project_id) cascade
  agenda_id                 FK (agenda_id, project_id) → agenda(id, project_id) cascade
  sort_order   int not null                    -- 연결 순서
  seen_rev     int not null                    -- 연결 · 확인할 때의 agenda.decision_rev
  pk (document_id, agenda_id)
index (agenda_id)

document_folder                                 -- 리비전 0044_document_folder (2026-11-13)
  id · project_id → project cascade
  unique (id, project_id)
  parent_id    FK (parent_id, project_id) → document_folder(id, project_id)   null = 맨 위. ON DELETE 없음(빈 폴더만 지운다)
  name         text not null                   -- 앞뒤 공백 뗀 1 ~ 100자. 같은 부모 아래에서 겹치지 않는다(서비스가 본다)
  created_by → member null 가능 · created_at · updated_at
  seq          bigint Identity unique
index (project_id)

document 에 더함 (0044)
  folder_id    FK (folder_id, project_id) → document_folder(id, project_id)   null = 맨 위. ON DELETE 없음
index (folder_id)
```

- 이행 `0044_document_folder` — 테이블 하나 · `document.folder_id` 하나. 있던 문서는 모두 맨 위(`null`). 값을 옮기지 않는다

- **지운 안건**(`agenda.is_deleted`)의 연결 줄은 지우지 않고 **읽을 때 거른다** — `agendas` · `changedAgendaIds` 에 안 나간다. 연결을 다시 맞추면(PUT) 그때 빠진다
- **표의 모양** (서버 검사, 어기면 422) — 시트 1 ~ 10개(sheet 문서), 시트 이름 1 ~ 31자 · 겹침 없음, 시트마다 **열 1 ~ 16,384개(A ~ XFD) · 줄 0 ~ 1,048,576개 · 칸 32,767자 — 엑셀과 같다**(2026-11-12 고침, 사용자), 줄마다 칸 수 ≤ 열 수, `merges` · `styles` 의 키는 `A1` ~ `XFD1048576` 안의 칸 주소, 스타일 글 200자, 너비 20 ~ 1,000. 직렬화한 `sheet` 전체 5MB(UTF-8)까지 — 실제로 막히는 것은 대개 이 크기다. **저장하는 것은 쓴 범위뿐이다** — 화면이 끝의 빈 줄 · 빈 열을 떼고 보낸다(`columns` 는 값 · 병합 · 꾸밈 · 기본과 다른 너비가 있는 마지막 열까지) 서버는 수식을 계산하지 않는다 — 칸 값은 사람이 넣은 원문(`=SUM(A1:A3)`) 그대로 둔다
- **이행 `0043_document_sheet_header`** — 열 이름(`columns[].title`)을 걷는다. 열 이름이 하나라도 비어 있지 않은 시트는 **맨 위에 그 이름들로 한 줄을 끼운다**(병합 · 꾸밈 주소는 한 줄씩 아래로), 그리고 `columns` 는 `{ width }` 만 남긴다. 내릴 때는 `title: ''` 를 붙인다(첫 줄을 되돌리지 않는다)
- **이행 `0042_document_sheet_book`** — 옛 `{ columns, rows }` 를 `{ sheets: [{ name: 'Sheet1', columns: [{ title, width: 160 }], data: rows, merges: {}, styles: {} }] }` 로, text 문서는 `{ sheets: [] }` 로. 내릴 때는 첫 시트의 열 이름 · 값만 옛 꼴로
- **글의 크기** — `content` UTF-8 로 5MB 까지(그림이 data URI 로 들어 있어 글자 수가 아니라 크기로 본다, 2026-11-13 고침 — 처음엔 200,000자). 넘으면 422 `{content: '본문이 5MB 를 넘습니다.'}`. 서버는 HTML 을 해석 · 정리하지 않는다 — 그리는 쪽(편집기)이 제 스키마로만 읽어 script · on* 같은 것은 버린다

## 모양

```ts
export type DocKind = 'text' | 'sheet'

/** 표 문서 하나 — 시트 탭 여럿. Jspreadsheet CE 의 worksheets 설정에서 저장할 것만 뽑은 꼴 */
export interface SheetBook {
  sheets: SheetTab[]
}

export interface SheetTab {
  /** 탭 이름 1 ~ 31자, 문서 안에서 겹치지 않음 */
  name: string
  /** 열 — 너비 px. 머리는 늘 A · B · C (열 이름은 두지 않는다 — 필요하면 첫 줄 칸에) */
  columns: { width: number }[]
  /** 칸 값 — 줄마다 칸 수 ≤ columns.length. 수식은 '=' 로 시작하는 원문 그대로 */
  data: string[][]
  /** 병합 — { 'A1': [열 수, 줄 수] } */
  merges: Record<string, [number, number]>
  /** 칸 꾸밈 — { 'A1': 'font-weight: bold; background-color: #fff2cc' } (CSS 글) */
  styles: Record<string, string>
}

export interface DocAgendaLink {
  agendaId: string
  /** 연결 · 확인할 때의 그 안건 decisionRev */
  seenRev: number
}

/** 목록 한 줄 — 본문 · 표를 빼고 낸다 */
export interface ProjectDocSummary {
  id: string
  projectId: string
  title: string
  kind: DocKind
  partId: string | null
  /** 든 폴더. null 은 맨 위 (2026-11-13) */
  folderId: string | null
  /** 연결 순서. 지운 안건은 빠진다 */
  agendas: DocAgendaLink[]
  /** 지금 decisionRev > seenRev 인 연결 안건 — 연결 순서. 없으면 [] */
  changedAgendaIds: string[]
  /** 제목 · 본문 · 표의 판. 고칠 때 이 값을 보낸다 */
  rev: number
  createdBy: string | null
  createdAt: string
  updatedBy: string | null
  updatedAt: string
}

/** 문서 하나 — 목록 줄 + 본문 · 표 */
export interface ProjectDoc extends ProjectDocSummary {
  /** text 의 본문(HTML — 글 편집기가 낸 그대로. 예전 글은 마크다운일 수 있다). sheet 는 '' */
  content: string
  /** sheet 의 표. text 는 { sheets: [] } */
  sheet: SheetBook
}
```

```ts
/** 폴더 하나 (2026-11-13) */
export interface DocFolder {
  id: string
  projectId: string
  /** null 은 맨 위 */
  parentId: string | null
  name: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
```

```ts
/** POST /api/projects/{projectId}/document-folders */
export interface DocFolderInput {
  name: string
  parentId?: string | null
}

/** PATCH /api/document-folders/{folderId} — 보낸 키만. 이름 바꾸기 · 옮기기 */
export interface DocFolderPatch {
  name?: string
  parentId?: string | null
}
```

- 이름이 `Document` 가 아닌 것은 브라우저 전역 `Document` 와 겹치지 않게 해서다. 화면 말은 '문서'
- `null` 이 나가는 자리는 `partId` · `folderId` · `createdBy` · `updatedBy`, 폴더의 `parentId` · `createdBy` 뿐이다(Q17)
- 시각은 ISO 8601 UTC `Z`

### 요청

```ts
/** POST /api/projects/{projectId}/documents */
export interface DocInput {
  title: string
  kind: DocKind
  partId?: string | null
  /** 넣을 폴더. 안 보내면 맨 위 (2026-11-13) */
  folderId?: string | null
  /** 안건 상세의 [문서에 담기] · 목록의 [새 문서] 가 미리 채운다. 안 보내면 [] */
  agendaIds?: string[]
  /** 안 보내면 '' (text 일 때만 받는다 — sheet 에 보내면 422) */
  content?: string
  /** 안 보내면 sheet 는 시트 하나 { name: 'Sheet1', columns: [{ width: 200 }, { width: 400 }], data: [['항목', '내용']], merges: {}, styles: { A1: 'font-weight: bold', B1: 'font-weight: bold' } }, text 는 { sheets: [] } (text 에 보내면 422) */
  sheet?: SheetBook
}

/** PATCH /api/documents/{documentId} — 보낸 키만 바꾼다 */
export interface DocPatch {
  /** title · content · sheet 중 하나라도 보내면 꼭 보낸다. 지금 판과 다르면 409 DOCUMENT_STALE */
  rev?: number
  title?: string
  content?: string // text 만
  sheet?: SheetBook // sheet 만
  partId?: string | null
  /** 폴더 옮기기 — rev 를 안 올린다(파트처럼) */
  folderId?: string | null
}

/** PUT /api/documents/{documentId}/agendas — 연결을 통째로. 배열 순서 = 연결 순서 */
export interface DocAgendasInput {
  agendaIds: string[]
}

/** POST /api/documents/{documentId}/confirm — 결정 바뀜 지우기. agendaIds 를 안 보내면 연결 안건 전부 */
export interface DocConfirmInput {
  agendaIds?: string[]
}
```

## 엔드포인트

| 메서드 | 경로 | 하는 일 | 응답 |
| --- | --- | --- | --- |
| GET | `/api/projects/{projectId}/documents` | 목록 — **`updatedAt` 늦은 순**(같으면 `seq` 큰 순). `?agendaId=` 를 주면 그 안건이 연결된 문서만 | `ProjectDocSummary[]` |
| POST | `/api/projects/{projectId}/documents` | 만들기. 연결 안건의 `seenRev` 는 지금 판 | `ProjectDoc` · 201 |
| GET | `/api/documents/{documentId}` | 하나 읽기 | `ProjectDoc` |
| PATCH | `/api/documents/{documentId}` | 고치기. 본문 · 표 · 제목이 바뀌면 `rev` + 1 | `ProjectDoc` |
| DELETE | `/api/documents/{documentId}` | 지우기 | 204 |
| PUT | `/api/documents/{documentId}/agendas` | 연결 통째로 바꾸기 — **남는 안건은 `seenRev` 를 그대로**, 새로 들어온 안건은 지금 판. `rev` 와 무관 | `ProjectDoc` |
| POST | `/api/documents/{documentId}/confirm` | 고른(또는 전부) 연결 안건의 `seenRev` 를 지금 판으로. 연결 안 된 id 는 400 `DOCUMENT_AGENDA_NOT_LINKED` | `ProjectDoc` |
| GET | `/api/projects/{projectId}/document-folders` | 폴더 전부(평평한 배열 — 트리는 화면이 `parentId` 로 세운다). 순서는 이름순(같으면 `seq`) | `DocFolder[]` |
| POST | `/api/projects/{projectId}/document-folders` | 폴더 만들기 | `DocFolder` · 201 |
| PATCH | `/api/document-folders/{folderId}` | 이름 바꾸기 · 옮기기(`parentId`) | `DocFolder` |
| DELETE | `/api/document-folders/{folderId}` | **빈 폴더만** 지운다(하위 폴더 · 문서가 있으면 409) | 204 |

### 검사 · 오류

| 상태 | code | 언제 |
| --- | --- | --- |
| 404 | `DOCUMENT_NOT_FOUND` | 없는 문서, 또는 그 프로젝트 멤버가 아님(다른 자원과 같은 규칙) |
| 409 | `DOCUMENT_STALE` | 보낸 `rev` 가 지금 판과 다름. `detail: { rev: <지금 판>, updatedBy, updatedAt }` |
| 400 | `DOCUMENT_AGENDA_NOT_FOUND` | 다른 프로젝트 · 없는 · 지운 안건을 연결하려 함. `detail: { agendaIds: <처음 걸린 id> }` |
| 400 | `DOCUMENT_AGENDA_NOT_LINKED` | confirm 에 연결 안 된(또는 지운) 안건. `detail: { agendaIds: <처음 걸린 id> }` |
| 400 | `PART_NOT_FOUND` · `PART_ARCHIVED` | 다른 프로젝트 · 없는 파트, 보관한 파트를 새로 담 — 작업 · 테스트와 같은 코드 · `detail: { partId }` (`part.md`). 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다 |
| 403 | `FORBIDDEN` (기존 권한 오류 코드) | 아래 '권한' 에 걸림 |
| 404 | `DOCUMENT_FOLDER_NOT_FOUND` | 경로의 폴더가 없음, 또는 그 프로젝트 멤버가 아님 |
| 400 | `DOCUMENT_FOLDER_NOT_FOUND` | 몸의 `folderId` · `parentId` 가 다른 프로젝트 · 없는 폴더. `detail: { folderId }` 또는 `{ parentId }` |
| 400 | `DOCUMENT_FOLDER_CYCLE` | 폴더를 자기 자신 · 자기 하위 폴더 아래로 옮김. `detail: { parentId }` |
| 400 | `DOCUMENT_FOLDER_TOO_DEEP` | 폴더 깊이가 5단을 넘음(맨 위 폴더가 1단, 옮기면 딸린 하위 폴더까지 센다). `detail: { parentId }` |
| 409 | `DOCUMENT_FOLDER_NAME_TAKEN` | 같은 부모 아래 같은 이름(앞뒤 공백 뗀 값, 대소문자 그대로)이 있음. `detail: { name }` |
| 409 | `DOCUMENT_FOLDER_NOT_EMPTY` | 하위 폴더나 문서가 있는 폴더를 지우려 함 |
| 422 | 검증 | 폴더 이름 빈 값 · 100자 넘음 · `null`, 제목 빈 값 · 200자 넘음, `kind` 와 안 맞는 `content` · `sheet`, 표 모양 · 크기, 안건 50개 넘음 · 겹침, 제목 · 본문 · 표를 보내면서 `rev` 없음 |

- **검사 순서** — 422 → 403(→ 옮겨 갈 파트의 400 · 403) → 409. 앞에서 걸리면 뒤는 안 본다
- **`rev` 는 제목 · 본문 · 표를 보낼 때만 본다** — `partId` 만 바꾸는 PATCH 는 `rev` 를 실어 와도 보지 않는다. 보낸 값이 지금과 같으면 판도 `updatedAt` 도 그대로다(자동 저장이 같은 글을 다시 보내도 판이 안 오른다)
- `title` · `content` · `sheet` 에 `null` 은 422, `kind` 는 PATCH 로 못 바꾼다(보내도 버린다)
- PUT agendas · confirm 이 아무것도 안 바꾸면(같은 순서 · 이미 확인됨) `updatedAt` 도 그대로다

## 권한

`part.md` '파트 권한' 의 작업 · 테스트 규칙을 그대로 쓴다. 관리자 = 프로젝트 관리자 · 시스템 관리자.

| | 공통 문서(`partId` null) | 파트 문서 |
| --- | --- | --- |
| 보기 | 프로젝트 멤버 | 프로젝트 멤버(서버는 숨기지 않는다 — 보기 범위는 목록 기본값) |
| 만들기 | 프로젝트 멤버 | 관리자 · 그 파트 등록 권한 |
| 고치기 · 연결 · 확인 | 프로젝트 멤버 | 관리자 · 만든 사람 · 그 파트 수정 권한. 다른 파트로 옮기면 옮겨 갈 파트의 수정 권한도 |
| 지우기 | 관리자 · 만든 사람 | 관리자 · 만든 사람 · 그 파트 삭제 권한 |

- **폴더** (2026-11-13) — 폴더엔 파트가 없다. 만들기 · 이름 바꾸기 · 옮기기는 **프로젝트 멤버 누구나**, 지우기(빈 폴더만)는 **관리자 · 만든 사람**. 문서를 폴더에 넣기 · 옮기기(`folderId`)는 그 문서를 **고칠 수 있는 사람**(위 '고치기'), 만들 때 고른 폴더는 따로 막지 않는다
- 종료된 프로젝트의 쓰기 막힘 등 프로젝트 공통 규칙이 있으면 다른 쓰기와 똑같이 따른다

## 화면

- 대메뉴 **'문서'** — 안건 다음 자리. 경로 `/documents`, 하나는 `/documents/:documentId`
- **트리 + 상세** (2026-11-13 고침, 사용자 — 처음엔 게시판 꼴 표 목록) — `/documents` 와 `/documents/:documentId` 가 같은 틀이다. **왼쪽 폴더 트리**(너비 고정, 따로 스크롤), **오른쪽 고른 문서**(아래 '문서 화면' 그대로). 문서를 안 골랐으면 오른쪽은 안내 + 최근 고친 문서 몇 개
  - **트리 머리** — 제목 검색 · 볼 파트 고르기 · 종류 거르기(글 · 표) · [새 폴더] · [새 문서]. 거르기 · 검색 중이면 맞는 문서와 그 위 폴더만 펼쳐 보인다(빈 폴더는 숨김). `?agendaId=` 로 오면 그 안건이 연결된 문서만
  - **트리 줄** — 폴더: 펼침 화살표 · 폴더 아이콘 · 이름 · 든 문서 수(하위까지). 문서: 종류 아이콘 · 제목 · 결정 바뀜이면 주황 점 + n. 순서는 폴더 먼저 이름순, 그다음 문서 제목순(한국어 정렬). 고른 문서는 강조하고, 문서를 열면 그 위 폴더를 펼친다. 펼침은 사람 · 프로젝트마다 기억한다(브라우저)
  - **폴더 메뉴(…)** — 여기에 새 문서 · 하위 폴더 만들기 · 이름 바꾸기(줄에서 바로) · 지우기(빈 폴더만, 아니면 막힌 채 이유). 새 폴더 · 이름은 같은 부모 아래 겹치면 그 자리에서 알린다
  - **끌어 옮기기** — 문서 · 폴더를 폴더 줄에 놓으면 그 안으로, 트리 맨 위 '최상위' 자리에 놓으면 맨 위로. 못 옮기는 것(권한 · 자기 하위 · 깊이)은 놓을 자리로 안 받는다. 문서 메뉴(…)에도 '폴더' 고르기
  - **새 문서** 팝업에 폴더 칸 — 폴더 메뉴에서 열면 그 폴더, 문서를 보는 중이면 그 문서의 폴더가 기본
- **새 문서** — 팝업: 제목 · 종류(글 / 표) · 파트 · 연결할 안건(여럿, 결정된 안건이 위). 만들면 그 문서로 간다
- **문서 화면** — 트리 오른쪽: 넓게 편집, 맨 오른쪽 좁게 '연결한 안건' 칸
  - 제목은 바로 고치는 입력칸. 머리에 '저장됨 · 저장 중 · 고친 사람 · 시각'
  - **글** — Tiptap 편집기 하나(편집 · 미리보기 토글 없음, 보이는 그대로 적는다). 도구 줄: 되돌리기 · 다시 · 글 단(본문 · 제목 1 ~ 3) · 굵게 · 기울임 · 밑줄 · 취소선 · 코드 · 글자색 · 형광펜 · 정렬(왼 · 가운데 · 오른 · 양쪽) · 목록 · 번호 목록 · 체크리스트 · 인용 · 구분선 · 링크 · 그림(2MB 까지, 붙여 넣기 · 끌어 놓기도) · 표 · 서식 지우기. 커서가 표 안이면 줄 · 열 넣기 · 지우기 · 병합 · 병합 풀기 · 머리 줄 · 표 지우기 줄이 더 뜬다. 열 너비는 끌어서. 글자 수, 3MB 를 넘으면 크기도 보인다. [.docx 가져오기](본문이 있으면 바꿀지 묻는다 — 제목 · 굵게 · 기울임 · 밑줄 · 취소선 · 목록 · 표 · 그림 · 링크를 옮기고 글꼴 · 크기 · 색 · 정렬 · 머리글 · 쪽 설정은 빠진다) · [.docx 내려받기](색 · 형광펜 · 정렬 · 병합 · 체크리스트까지, 바깥 주소 그림은 '[그림]' 자리 글). 읽기 전용이면 도구 줄 · 가져오기가 숨고 내려받기만
  - **표** — 엑셀처럼 열면 **A ~ Z 열 · 100줄 이상의 빈 칸**이 깔리고, 오른쪽 · 아래 끝 가까이 스크롤하면 열 26개 · 줄 100개씩 늘어난다(엑셀 상한까지). Jspreadsheet CE 가 칸마다 DOM 을 그려 한꺼번에 다 깔 수는 없어서다. Jspreadsheet CE 스프레드시트: 시트 탭(더하기 · 이름 바꾸기 · 지우기), 도구 줄(되돌리기 · 다시 · 굵게 · 기울임 · 글자색 · 배경색 · 정렬 · 병합 · 병합 풀기), 우클릭 메뉴(줄 · 열 넣기 · 지우기), 열 너비 끌기, 수식, 엑셀 복사 붙여넣기. [.xlsx 가져오기](지금 시트들을 바꿈 — 확인 팝업) · [.xlsx 내려받기] 는 SheetJS. 가져올 때 값 · 수식 · 병합 · 열 너비를 옮기고 꾸밈은 굵게 정도만(SheetJS CE 가 읽는 만큼)
  - 자동 저장 — 고치고 0.8초 뒤 `PATCH`(`rev` 실음), 응답의 `rev` 를 다음에 쓴다. 409 면 '다른 사람이 먼저 고쳤습니다 — [다시 불러오기]' 줄을 띄우고 저장을 멈춘다(내 글은 화면에 남아 복사할 수 있다)
  - **연결한 안건 칸** — 줄마다 상태 배지 · 제목(누르면 안건 상세) · 결정내용 몇 줄 · **[본문에 넣기]**. 결정 바뀜이면 주황 테두리 + '결정 바뀜 — 판 n → m' + [확인]. 머리에 [안건 연결](고르기 팝업) · 바뀐 것이 있으면 [모두 확인]
  - [본문에 넣기] — 글: 마지막 커서가 있던 블록 뒤(한 번도 안 눌렀으면 끝)에 제목 3단 `{안건 제목}` + 결정내용 문단(줄마다 문단, 이어진 '- ' 줄은 목록 하나) 블록. 이어 넣으면 차례로 쌓인다. 표: 지금 보고 있는 시트 끝에 한 줄 `[안건 제목, 결정내용, …빈 칸]` (늘 A · B 두 칸에 나눈다 — 쓴 열이 하나뿐이면 B 열을 더한다). 결정내용이 비었으면 '(아직 안 정함)'
  - 문서 메뉴(…) — 파트 바꾸기 · 폴더 옮기기 · 지우기(확인 팝업, 지우면 트리에서 빠지고 오른쪽은 안내로). 권한이 없으면 읽기 전용(입력칸 막힘, 버튼 숨김)
- **안건 상세** — '실린 문서' 줄: 이 안건이 연결된 문서 칩(누르면 문서로), [문서에 담기](문서 고르기 → 연결 추가, 또는 이 안건을 담은 새 문서)

## 나중

- AI 정리 초안 — 고른 안건들의 결정을 Claude 가 한 문서로 정리해 초안을 내고, 사람이 고쳐 저장
- 결정이 바뀌면 문서의 어느 문장을 고칠지 AI 가 제안(영향도 분석에 문서를 더하기)
- 챗봇 도구 `search_documents` · 문서 근거 칩
- 변경 이력 · 판 되돌리기, 글 문서 내려받기(.docx)

/**
 * 안건 — 제목 · 설명 · 결정내용 · 상태 (docs/api/agenda.md).
 * 상태는 사람이 직접 고른다. 결정이 언제 어떻게 바뀌었는지는 변경 이력이 남긴다.
 */

export type AgendaState =
  | 'queued' // 대기
  | 'open' // 논의중
  | 'decided' // 결정

export interface Member {
  id: string
  name: string
  /** 비활성 멤버는 담당자로 못 고르고, 이름 옆에 '(비활성)' 이 붙는다. 기록이 가리키므로 지우지 않는다 */
  active: boolean
  /** 프로필 사진 주소 — 없으면 null. 서버가 `/api/members/{id}/avatar?v=<바뀐 시각>` 으로 만든다 (docs/api/me.md) */
  avatarUrl: string | null
}

/* 로그인 · 권한 — docs/api/auth.md 의 모양 그대로. 권한 셋은 시스템 역할 × 프로젝트 역할의 조합이다 */

export type SystemRole = 'admin' | 'user'
export type ProjectRole = 'admin' | 'user'

/** GET /api/auth/me · POST /api/auth/login */
export interface Me {
  id: string
  name: string
  email: string
  systemRole: SystemRole
  /** 내가 부여받은 프로젝트와 역할. 시스템 관리자도 부여받은 것만 실린다 */
  projectRoles: Record<string, ProjectRole>
  avatarUrl: string | null
}

/** PUT /api/auth/me/avatar — 화면이 256×256 으로 줄여 base64 로 싣는다 */
export interface AvatarInput {
  /** data:image/png|jpeg|webp;base64,… */
  dataUrl: string
}

/** 관리 화면용 — GET /api/admin/members */
export interface MemberAccount {
  id: string
  /** 사용자 번호 — 1부터, 전역, 다시 쓰지 않고 바꿀 수 없다. 관리자끼리 '5번 사용자' 로 부른다 */
  no: number
  name: string
  email: string | null
  systemRole: SystemRole
  active: boolean
  /** 경력 · 기술 스펙 · 기타 사항 — 관리자가 적는 자유 글(각 2000자까지). 비어 있으면 null */
  career: string | null
  skills: string | null
  notes: string | null
  /** 비밀번호가 걸려 있는지 — 없으면 로그인할 수 없다 */
  hasPassword: boolean
  createdAt: string
  lastLoginAt: string | null
}

/** POST /api/auth/login */
export interface LoginInput {
  email: string
  password: string
}

/** POST /api/auth/password — 내 비밀번호 바꾸기 */
export interface PasswordChangeInput {
  currentPassword: string
  newPassword: string
}

/** POST /api/admin/members */
export interface MemberAccountInput {
  name: string
  email: string
  password: string
  systemRole: SystemRole
  career?: string | null
  skills?: string | null
  notes?: string | null
}

/** PATCH /api/admin/members/{memberId} — 보낸 필드만 바뀐다 */
export interface MemberAccountPatch {
  name?: string
  email?: string
  systemRole?: SystemRole
  active?: boolean
  /** null 이나 빈 글이면 비운다 */
  career?: string | null
  skills?: string | null
  notes?: string | null
}

/** GET /api/projects/{projectId}/members */
export interface ProjectMember {
  memberId: string
  role: ProjectRole
}

/* 파트 — docs/api/part.md. 보기 범위지 권한이 아니다: 서버는 다 싣고 화면이 '내 파트' 로 거른다 */

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

/** POST /api/projects/{projectId}/parts — 이름은 서버가 앞뒤 공백을 떼고 1 ~ 50자 */
export interface PartInput {
  name: string
}

/** PATCH /api/parts/{partId} — 이름 바꾸기 · 보관 · 되살리기. 보낸 필드만 바뀐다 */
export interface PartPatch {
  name?: string
  active?: boolean
}

export interface Project {
  id: string
  name: string
  /** 작업 키의 접두사 — 'HW' 면 그 프로젝트의 작업이 HW-1 · HW-2 … 가 된다. 프로젝트끼리 겹치지 않는다 */
  taskKeyPrefix: string
  /** 여러 줄 설명 · 2000자 이하. 없으면 null */
  description: string | null
  /** YYYY-MM-DD. 둘 다 있으면 endDate >= startDate (아니면 400 PROJECT_DATE_RANGE) */
  startDate: string | null
  endDate: string | null
  /** 표시만 — 어느 상태든 쓰기를 막지 않는다. 서버 목록은 active → planned → closed */
  status: ProjectStatus
  /** closed 가 된 때(ISO UTC). 다른 상태면 null */
  closedAt: string | null
}

/** 화면 이름 준비 · 진행 · 종료. 새 프로젝트는 active */
export type ProjectStatus = 'planned' | 'active' | 'closed'

export interface Agenda {
  id: string
  projectId: string
  title: string
  /** 배경 — 왜 정해야 하나. 빈 값은 '' */
  description: string
  /** 결정내용 — 여러 줄 글. 빈 값은 '' */
  decision: string
  state: AgendaState
  ownerId: string | null
  /** 참조 — 알아야 하는 사람(권한 · 리스크와 무관). 고른 순서, 빈 값은 [] */
  ccIds: string[]
  /** 등록한 사람 — 서버가 요청한 사람으로 찍는다. 기록이 없는 옛 안건은 null */
  creatorId: string | null
  /** 결정 기한 YYYY-MM-DD (Task.start · due 와 같은 형식) */
  dueDate: string | null
  /** 속한 파트. null 은 프로젝트 공통 */
  partId: string | null
  createdAt: string
  /** state 가 decided 로 바뀐 시각(ISO UTC Z). decided 가 아니면 null */
  decidedAt: string | null
  /** 결정 판 번호 — 결정내용이 바뀌거나 decided 가 될 때 서버가 1 올린다. 확인 요청이 가리키는 자리 */
  decisionRev: number
  /** 출처 — 회의록 [AI 정리] 로 등록했으면 그 회의록. 손으로 만들었거나 회의록을 지웠으면 null */
  minutesId: string | null
}

/** 목록 한 행에 필요한, 계산해서 얻는 값들 */
export interface AgendaRow {
  agenda: Agenda
  ownerName: string | null
  /** 결정내용의 첫 줄 — 비었으면 '' */
  decisionLine: string
  /** 9월 12일 또는 '—' (기한 없음) */
  dueLabel: string
  /** 결정 기한이 지났는데 아직 못 정함 */
  overdue: boolean
}

/** POST /api/projects/{id}/agendas — 제목 말고는 다 비워도 된다 */
export interface AgendaInput {
  title: string
  description?: string
  decision?: string
  /** 안 보내면 queued */
  state?: AgendaState
  ownerId?: string | null
  /** 안 보내면 [] */
  ccIds?: string[]
  dueDate?: string | null
  /** 안 보내면 공통(null) */
  partId?: string | null
}

/** PATCH /api/agendas/{id} — 보낸 필드만 바뀐다. ownerId · dueDate · partId 는 null 로 비운다 */
export interface AgendaPatch {
  title?: string
  description?: string
  decision?: string
  state?: AgendaState
  ownerId?: string | null
  /** 통째로 갈아끼운다 */
  ccIds?: string[]
  dueDate?: string | null
  /** null 로 공통. 보관 파트는 새로 달 수 없다(이미 달린 것을 두는 것은 된다) */
  partId?: string | null
}

/**
 * 작업(task) — memo 의 네 번째 엔티티.
 *
 * 계층으로 쌓이지만 목록은 펼치지 않고 한 줄에 하나씩 놓는다(경로는 제목 아래 회색 글씨).
 * 계층째로 보는 건 간트차트가 맡는다. start · due 가 둘 다 null 이면 기간 미정이라
 * 간트에 막대가 없다(unscheduled).
 */

export type TaskStatus =
  | 'todo' // 해야 할 일
  | 'doing' // 진행 중
  | 'blocked' // 막힘 — 걸어 둔 안건이 안 정해져서 멈춘 상태
  | 'done'

export type TaskPriority = 'low' | 'normal' | 'high'

/** 작업 본문 한 줄. memo: "checkbox 와 bullet list 로 필요한 내용을 작성한다" */
export interface TaskLine {
  id: string
  kind: 'check' | 'bullet'
  text: string
  done: boolean
  /** 들여쓰기 깊이 */
  level: number
}

export interface Task {
  id: string
  projectId: string
  /** 화면에 보이는 번호 — HW-4 */
  key: string
  title: string
  parentId: string | null
  body: TaskLine[]
  status: TaskStatus
  ownerId: string | null
  /** YYYY-MM-DD. start 와 due 가 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  priority: TaskPriority
  /** 속한 파트. null 은 프로젝트 공통. 계층과 따로 간다 — 상위를 바꿔도 안 따라 바뀐다 */
  partId: string | null
  /** 등록한 사람 — 서버가 로그인한 사람으로 찍는다. 이 칸이 생기기 전의 작업은 null */
  creatorId: string | null
  /** 같은 상위 안에서의 순서(0부터) — 간트 · 하위 목록 같은 트리가 이것으로 형제를 세운다. 목록은 등록순 그대로 */
  order: number
  createdAt: string
  /** 댓글 수. 본문은 스냅샷에 없어 상세를 열 때 따로 받는다 */
  commentCount: number
  /** 출처 회의록. 없으면 null */
  minutesId: string | null
  /** 지금 상태가 된 시각(task_log 의 마지막 줄). ISO 8601 UTC, Z */
  statusChangedAt: string
  /** statusChangedAt 이 마이그레이션이 넣은 줄의 시각이면 true — 실제로는 더 오래됐을 수 있다 */
  statusSinceBackfill: boolean
}

/** 작업 댓글 — GET /api/tasks/{taskId}/comments 는 오래된 것부터 낸다 */
export interface TaskComment {
  id: string
  taskId: string
  /** 남긴 사람. 멤버가 지워졌거나 고르지 않고 남긴 것이면 null */
  authorId: string | null
  body: string
  createdAt: string
  /** 고친 적이 없으면 null */
  editedAt: string | null
}

/** 칸 하나의 바뀜 (docs/api/history.md) */
export interface HistoryChange {
  /** '칸' 표의 이름 — created · status · ownerId · lineDone · taskRef … */
  field: string
  /** 바뀌기 전 값. 없던 값(담당자 없음 · 기간 미정 · 새로 건 태그)은 null. 지난 연관 작업(relatedIds) 줄은 id 배열 */
  from: string | number | boolean | string[] | null
  /** 바뀐 뒤 값. 비운 값 · 뗀 태그는 null */
  to: string | number | boolean | string[] | null
  /** 무엇에 대한 바뀜인지 한 줄 — 체크한 본문 줄의 글. 없으면 '' */
  subject: string
}

/** 이력 한 줄 = 요청 하나. GET /api/tasks/{taskId}/history · /api/tests/{testId}/history 가 seq 오름차순으로 낸다 */
export interface HistoryEntry {
  id: string
  /** ISO 8601 UTC, Z */
  changedAt: string
  /** 바꾼 사람. backfill 이면 null */
  changedBy: string | null
  /** 마이그레이션이 넣은 '등록' 줄이면 true — 등록한 사람을 모른다 */
  backfilled: boolean
  /** 비지 않는다 */
  changes: HistoryChange[]
}

/** POST /api/tasks/{taskId}/comments — 서버가 body 를 trim 하고 빈 값은 거절한다. 작성자는 로그인한 사람이다 */
export interface TaskCommentInput {
  body: string
}

/** PATCH /api/comments/{commentId} */
export interface TaskCommentPatch {
  body: string
}

/**
 * 맵핑은 링크로 둔다.
 *
 * memo 의 "안건 상세에서는 맵핑 불가"는 화면의 규칙이지 모델의 제약이 아니다 —
 * 링크는 양쪽에서 읽고, 안건 화면에서만 읽기 전용으로 보여준다.
 */
export interface TaskAgendaLink {
  taskId: string
  agendaId: string
}

/** 작업 목록 한 행 — 계층을 펼치지 않는 대신 경로를 글로 적는다 */
/** 상위 작업 고르기의 한 줄. 고르면 4단을 넘는 것은 disabledReason 이 있다 — 보이되 못 고른다 (Q64) */
export interface ParentChoice {
  id: string
  key: string
  label: string
  disabledReason?: string
}

export interface TaskRow {
  task: Task
  ownerName: string | null
  /** 개발 › AI Biz › 가상비서 · 하위 2건 / 또는 '최상위 작업' */
  pathLabel: string
  /** 9/8 ~ 9/15 또는 '' (기간 미정) */
  periodLabel: string
  /** 기간이 안 잡혔는가 — 간트에 막대가 없는 작업 */
  undated: boolean
  agendaCount: number
  childCount: number
}

/** 작업 하나 보기 */
export interface TaskDetail {
  task: Task
  ownerName: string | null
  pathLabel: string
  periodLabel: string
  parent: Task | null
  children: TaskRow[]
  /** 이 작업을 하다가 정해야 했던 것들 */
  agendas: TaskAgendaRow[]
  doneChildCount: number
}

/** 작업 상세에 붙는 안건 한 줄 — 지금 어디까지 정해졌는지까지 같이 본다 */
export interface TaskAgendaRow {
  agenda: Agenda
  /** 결정됐으면 결정내용 첫 줄, 아니면 왜 아직인지 */
  line: string
  /** '9월 10일에 정해짐' 또는 '9월 8일에 등록' */
  where: string
}

/** 작업을 새로 만들 때 화면이 넘기는 것 */
export interface TaskInput {
  title: string
  parentId: string | null
  body: TaskLine[]
  status: TaskStatus
  ownerId: string | null
  start: string | null
  due: string | null
  priority: TaskPriority
  agendaIds: string[]
  /** **안 보내면 상위 작업의 파트를 따른다**(최상위면 공통). null 을 보내면 공통이다 */
  partId?: string | null
}

/**
 * 작업을 고칠 때 화면이 넘기는 것 — PATCH /api/tasks/{id}. 보낸 필드만 바뀌고 null 은 비우기다.
 * body 는 통째로 바뀐다. 이 작업의 기존 줄 id 를 실으면 그 id 가 유지되고, 처음 보는 id 는 서버가 새로 붙인다.
 */
export interface TaskPatch {
  title?: string
  parentId?: string | null
  status?: TaskStatus
  ownerId?: string | null
  start?: string | null
  due?: string | null
  priority?: TaskPriority
  body?: TaskLine[]
  /** null 로 공통. 하위 작업은 따라 바뀌지 않는다 */
  partId?: string | null
}

/** 간트에서 줄을 끌어 옮길 때 — POST /api/tasks/{id}/move. 응답은 order · parentId 가 바뀐 Task[] */
export interface TaskMove {
  /** 옮겨 갈 상위 — null 은 최상위 */
  parentId: string | null
  /** 새 상위 안에서 이 작업 바로 앞에 놓을 형제 — null 은 맨 끝 */
  beforeId: string | null
}

/** PATCH /api/projects/{projectId} — 프로젝트 관리자 · 시스템 관리자. 보낸 것만 바뀌고 null 은 지운다 */
export interface ProjectPatch {
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  status?: ProjectStatus
}

/** 프로젝트를 등록할 때 넘기는 것. 접두사를 비우면 서버가 만들어 준다 (API.md Q20 · Q24) */
export interface ProjectInput {
  name: string
  taskKeyPrefix?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
}

/** GET /api/projects/{id}/snapshot — 그 프로젝트의 원본 전부. 키 이름은 픽스처 export 이름이다 */
export interface ProjectSnapshot {
  project: Project
  agendas: Agenda[]
  tasks: Task[]
  taskAgendaLinks: TaskAgendaLink[]
  /** 이름 순 · 보관 포함 */
  parts: Part[]
  /** (partId, memberId) 순 */
  partMembers: PartMember[]
}

/** 성공이 아닌 응답의 본문 — 전부 이 한 가지 모양이다 (API.md Q14) */
export interface ApiErrorBody {
  code: string
  /** 그대로 띄울 수 있는 한국어 한 줄 */
  message: string
  /** 폼 검증에서 필드별 메시지 */
  detail?: Record<string, string>
}

/* AI 챗봇 — API.md '## AI 챗봇' 의 모양 그대로 */

/** POST /api/projects/{projectId}/chat */
export interface ChatInput {
  /** 오래된 것 → 새 것. 마지막은 늘 user 다. 서버는 대화를 저장하지 않고, 화면은 창을 닫으면 비운다 (Q26) */
  messages: ChatMessage[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** 화면에 보인 글 그대로. 근거 표시(`[[agenda:ID]]`)도 지우지 않고 돌려보낸다 */
  text: string
  /** assistant 에만. 그 답이 낸 초안과 화면에서의 결과 — 서버가 대화를 안 남겨 화면이 돌려보낸다 */
  proposal?: ChatProposal
}

/** 챗봇이 낸 작업 초안 — 사람이 [등록] 을 눌러야 저장된다 (API.md '## AI 챗봇 — 작업 초안') */
export interface TaskProposal {
  /** 배열 순서 = 등록 순서 = 화면 순서. 상위가 늘 하위보다 앞이다 */
  tasks: ProposedTask[]
}

export interface ProposedTask {
  /** 이 초안 안에서만 쓰는 임시 이름 — 't1', 't2' … */
  tempId: string
  /** 같은 초안 안의 상위 작업 */
  parentTempId: string | null
  /** 이미 있는 작업 밑에 붙일 때 그 작업의 id. parentTempId 와 같이 쓰지 않는다 */
  parentId: string | null
  title: string
  ownerId: string | null
  /** YYYY-MM-DD. 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  priority: TaskPriority
}

/** 초안 카드의 결과. 대기 중인 카드는 늘 하나다 — 새 초안이 오면 앞의 것은 cancelled */
export type ProposalStatus = 'pending' | 'registered' | 'cancelled'

/** ChatMessage.proposal 의 모양 — 계약의 `TaskProposal & { status, keyByTempId? }` */
export interface ChatProposal extends TaskProposal {
  status: ProposalStatus
  /** registered 일 때만 — tempId → 저장된 작업 key(MG-7) */
  keyByTempId?: Record<string, string>
}

/** POST /api/projects/{projectId}/tasks/batch — 초안 그대로 보낸다. 상태는 todo, 본문은 빈 배열로 선다 */
export interface TaskBatchInput {
  tasks: ProposedTask[]
}

/** 201 응답 — 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다 */
export interface TaskBatchResult {
  /** 요청 순서 그대로 */
  tasks: Task[]
  taskIdByTempId: Record<string, string>
}

export type ChatEvent =
  /** 답 글자 조각. 이어 붙이면 답 전체다 */
  | { type: 'delta'; text: string }
  /** 지금 무엇을 찾는 중인지 — 화면은 label 만 띄우고 name 으로 가르지 않는다 */
  | {
      type: 'tool'
      name:
        | 'search_agendas'
        | 'get_agenda'
        | 'search_tasks'
        | 'get_task'
        | 'get_test'
        | 'list_tasks'
        | 'find_similar_tasks'
        | 'list_members'
        | 'get_decision_risks'
        | 'propose_tasks'
      label: string
    }
  /** 작업 초안. 한 답에 많아야 하나, done 보다 먼저 온다 */
  | { type: 'proposal'; proposal: TaskProposal }
  /** 끝. 답에 실제로 나온 근거만 모은다. analysisId 는 리스크 AI 분석만 — 저장할 수 있는 임시 분석 (docs/api/risk-analysis.md) */
  | { type: 'done'; refs: ChatRef[]; analysisId?: string }
  /** 스트림이 열린 뒤의 실패. 이것이 오면 done 은 안 온다 */
  | { type: 'error'; code: string; message: string }

export interface ChatRef {
  kind: 'agenda' | 'task' | 'test'
  id: string
}

/** 챗봇 창의 한 줄. 화면만 쓰는 모양이라 서버로는 role · text · proposal 만 나간다 */
export interface ChatLine {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** assistant 줄만 — 받는 중 · 다 받음 · 실패 · 멈춤 */
  status: 'streaming' | 'done' | 'error' | 'stopped'
  /** 받는 중에 띄울 '무엇을 찾는 중' 한 줄 */
  tool: string
  /** 실패한 줄에 다는 한국어 한 줄 */
  error: string
  /** assistant 줄만 — 이 답이 낸 작업 초안. done 으로 끝난 답에만 붙는다 */
  proposal?: ChatProposal
}

/* 결정 병목 리스크 — 계산은 서버가 하고 화면은 받아 그린다 (docs/api/risk.md · Q35) */

/** 리스크를 가르는 문턱값 일곱 — 프로젝트마다 둔다. PUT 은 일곱 값을 통째로 보낸다 (risk-dashboard.md '기준') */
export interface RiskSettings {
  /** 결정 기한이 이 날 수 안이면 '기한 임박'. 1 ~ 30, 기본 3 */
  dueSoonDays: number
  /** 마지막 이력 뒤 이 날 수를 넘기면 '오래 멈춤'. 1 ~ 90, 기본 7 */
  staleDays: number
  /** 점수가 이 값 이상이면 high. 2 ~ 30, 기본 6. mediumScore 보다 커야 한다 */
  highScore: number
  /** 점수가 이 값 이상이면 medium. 1 ~ 29, 기본 3 */
  mediumScore: number
  /** 흔들림을 세는 최근 날 수. 1 ~ 90, 기본 14 */
  churnDays: number
  /** 이 기간 안 내용 변경이 이 수 이상이면 '내용 자주 바뀜'. 2 ~ 50, 기본 5 */
  churnCount: number
  /** 기한을 이 수 이상 뒤로 미루면 '기한 거듭 미룸'. 1 ~ 10, 기본 2 */
  slipCount: number
}

export interface DecisionRiskReport {
  /** 계산 기준일 — 한국 시간 오늘. YYYY-MM-DD */
  asOf: string
  /** 이 계산에 쓴 기준 */
  settings: RiskSettings
  /** 안 정해진 안건 중 신호가 하나라도 있는 것. score 내림차순 */
  agendas: AgendaRisk[]
  /** 지우지 않은 · 완료 아닌 작업 중 신호가 있는 것. score 순 (2026-11-06) */
  tasks: TaskRisk[]
  /** 묶음이 아닌 테스트 중 신호가 있는 것. score 순 (2026-11-06) */
  tests: TestRisk[]
  /** 사람별로 몰린 정도. 담당자 없음은 memberId null 한 줄 */
  owners: OwnerLoad[]
}

/** AI 리스크 분석에 보내는 것 — 대시보드에 지금 보이는 줄의 id. 종류마다 0 ~ 100개 (risk-dashboard.md) */
export interface RiskSummaryInput {
  /** 보이는 안건 리스크 줄 — AgendaRisk.agendaId */
  agendaIds: string[]
  /** 보이는 작업 리스크 줄 — TaskRisk.taskId */
  taskIds: string[]
  /** 보이는 테스트 리스크 줄 — TestRisk.testId */
  testIds: string[]
}

/** 리스크 줄의 종류 — 대시보드 목록 · 저장한 분석의 비교가 같이 쓴다 */
export type RiskKind = 'agenda' | 'task' | 'test'

export type AgendaRiskSignal =
  'overdue' | 'dueSoon' | 'stale' | 'blocking' | 'decisionAfterTaskDue' | 'noOwner' | 'noDueDate'

export type RiskLevel = 'high' | 'medium' | 'low'

export interface AgendaRisk {
  agendaId: string
  title: string
  state: 'queued' | 'open'
  ownerId: string | null
  partId: string | null
  dueDate: string | null
  /** 기한을 넘긴 날 수. 기한이 없거나 안 넘었으면 0 */
  overdueDays: number
  /** 마지막 이력(없으면 등록) 뒤 지난 날 수 */
  idleDays: number
  blockedTaskIds: string[]
  /** 아직 안 막혔지만 이 결정을 기다리는 연결 작업(해야 할 일 · 진행 중) */
  waitingTaskIds: string[]
  /** 막힌 연결 작업과 그 하위 중 완료가 아닌 것의 수 (중복 없이) */
  impactTaskCount: number
  /** 연결된 작업(완료 제외) 중 가장 이른 기한 */
  nearestTaskDue: string | null
  signals: AgendaRiskSignal[]
  score: number
  level: RiskLevel
}

export interface OwnerLoad {
  /** null 은 '담당자 없음' */
  memberId: string | null
  openAgendas: number
  overdueAgendas: number
  blockedTasks: number
  /** 이 사람이 정하면 풀리는 일의 양 (impactTaskCount 의 합, 중복 없이) */
  blockingImpact: number
  /** 맡은 작업 · 테스트 중 리스크 high · medium 수 (2026-11-06) */
  riskyTasks: number
  riskyTests: number
}

/* 작업 · 테스트 리스크 — 작업 자체의 지연 · 흔들림 (docs/api/risk-dashboard.md). 2026-11-05 에 걷은 '안건과 어긋난 작업' 과 다르다 */

export type TaskRiskSignal =
  | 'overdue'
  | 'longBlocked'
  | 'longRunning'
  | 'dueSlipped'
  | 'notStarted'
  | 'contentChurn'
  | 'ownerChurn'

export interface TaskRisk {
  taskId: string
  /** HW-12 */
  key: string
  title: string
  status: 'todo' | 'doing' | 'blocked'
  ownerId: string | null
  partId: string | null
  start: string | null
  due: string | null
  /** 안 넘겼으면 0 */
  overdueDays: number
  /** 지금 상태가 된 날부터 오늘까지 */
  statusDays: number
  /** due − start + 1 (둘 다 있을 때) */
  plannedDays: number | null
  /** 뒤로 미룬 횟수와 흐름(첫 옛 값 → … → 지금) — 미룬 적 없으면 0 · [] */
  slipCount: number
  dueFlow: string[]
  /** 최근 churnDays 안의 내용(title · body) 변경 줄 수 · 담당자 변경 줄 수 */
  contentChanges: number
  ownerChanges: number
  /** 걸린 안건 중 안 정해진 것 — 설명용(점수에는 안 든다) */
  openAgendaIds: string[]
  /** 계약 표 순서 */
  signals: TaskRiskSignal[]
  score: number
  level: RiskLevel
}

export type TestRiskSignal =
  | 'overdue'
  | 'failedIdle'
  | 'longBlocked'
  | 'basisChanged'
  | 'longRunning'
  | 'flaky'
  | 'dueSlipped'
  | 'notStarted'

export interface TestRisk {
  testId: string
  /** HW-T3 */
  key: string
  title: string
  status: TestStatus
  ownerId: string | null
  partId: string | null
  due: string | null
  overdueDays: number
  statusDays: number
  slipCount: number
  /** 최근 churnDays 안의 pass ↔ fail 뒤집힘 수 */
  flips: number
  /** 이 테스트가 태그한 작업 · 안건 — 설명용 */
  refs: TestRef[]
  signals: TestRiskSignal[]
  score: number
  level: RiskLevel
}

/* 저장한 AI 리스크 분석 — [저장] 을 눌러 제목을 붙인 분석. 글 · 스냅샷은 기록이라 고치지 않는다 (docs/api/risk-analysis.md) */

/** 분석 때의 안건 리스크 한 줄 — 그때 값이다. 지금 값이 아니다 */
export interface RiskAnalysisAgenda {
  agendaId: string
  /** 안건 키가 있으면 */
  key: string | null
  title: string
  level: RiskLevel
  score: number
  /** AgendaRisk 의 신호 이름 그대로 — 모르는 이름이 와도 버리지 않는다 */
  signals: string[]
  ownerName: string | null
}

/** 분석 때의 작업 리스크 한 줄 (2026-11-06) */
export interface RiskAnalysisTask {
  taskId: string
  key: string
  title: string
  level: RiskLevel
  score: number
  /** TaskRisk 의 신호 이름 그대로 */
  signals: string[]
  ownerName: string | null
}

/** 분석 때의 테스트 리스크 한 줄 (2026-11-06) */
export interface RiskAnalysisTest {
  testId: string
  key: string
  title: string
  level: RiskLevel
  score: number
  /** TestRisk 의 신호 이름 그대로 */
  signals: string[]
  ownerName: string | null
}

/** 비교의 한 줄 — 종류를 단다 (2026-11-06). 옛 분석의 문자열(= 안건 id)은 api 가 이 모양으로 읽어 온다 */
export interface RiskCompareRef {
  kind: RiskKind
  id: string
}

/** 바로 앞 저장 분석 대비 — 분석을 돌린 때 기준이라 저장 순서가 바뀌어도 다시 세지 않는다 */
export interface RiskAnalysisCompare {
  previousId: string
  previousTitle: string
  previousSavedAt: string
  /** 이번에 새로 들어온 줄 */
  added: RiskCompareRef[]
  /** 앞에 있었는데 이번에 없는 줄 (풀렸거나 범위 밖) */
  removed: RiskCompareRef[]
  /** 둘 다 있는 줄 — 등급이 바뀌었으면 levelFrom ≠ levelTo */
  kept: (RiskCompareRef & { levelFrom: string; levelTo: string })[]
}

export interface RiskAnalysisFacts {
  /** 분석 때의 리스크 보고서 asOf · 기준 */
  asOf: string
  settings: RiskSettings
  /** 분석에 넣은 안건 리스크 줄 — 점수 순 */
  agendas: RiskAnalysisAgenda[]
  /** 분석에 넣은 작업 · 테스트 리스크 줄 — 옛 분석은 [] (2026-11-06) */
  tasks: RiskAnalysisTask[]
  tests: RiskAnalysisTest[]
  /** 앞 저장 분석이 없으면 null */
  compare: RiskAnalysisCompare | null
}

/** 게시판 한 줄 */
export interface RiskAnalysisListItem {
  id: string
  /** 분석한 프로젝트 — 상세 주소로 바로 들어와도 그 프로젝트로 옮긴다 (Q70) */
  projectId: string
  /** 게시판 번호 — 프로젝트 안에서 1 부터, 지워도 다시 쓰지 않는다 */
  seq: number
  title: string
  /** 분석을 돌린 사람 = 작성자. 계정을 지웠으면 null */
  createdBy: string | null
  createdAt: string
  savedAt: string
  /** facts.agendas 길이 */
  agendaCount: number
  /** facts.tasks · facts.tests 길이 — 옛 줄은 0 (2026-11-06) */
  taskCount: number
  testCount: number
  /** 세 종류 중 high 의 합 */
  highCount: number
}

export interface RiskAnalysis extends RiskAnalysisListItem {
  body: string
  refs: ChatRef[]
  facts: RiskAnalysisFacts
  titleEditedAt: string | null
}

/** GET .../risk-analyses — seq 내림차순 */
export interface RiskAnalysisPage {
  items: RiskAnalysisListItem[]
  total: number
}

/** POST .../risk-analyses — 내가 돌린 임시 분석에 제목을 붙여 올린다 */
export interface RiskAnalysisSaveInput {
  analysisId: string
  title: string
}

/* 확인 요청 — 결정된 안건의 '이 결정 확인해 주세요' 버튼 하나. 쪽지가 아니다 (docs/api/check.md) */

/** 받는 사람 한 명당 한 줄. 한 번에 보낸 줄은 같은 decisionRev · createdAt 을 갖는다 */
export interface CheckRequest {
  id: string
  projectId: string
  agendaId: string
  /** 이 요청이 알린 결정 판 — 보낼 때의 Agenda.decisionRev */
  decisionRev: number
  /** 보낼 때 찍어 둔 결정내용 */
  decision: string
  senderId: string
  recipientId: string
  /** ISO 8601 UTC, Z */
  createdAt: string
  /** null 이면 대기 */
  confirmedAt: string | null
}

/** GET /api/checks/pending-count */
export interface CheckPendingCount {
  /** 내가 받은 대기 수 — 내가 볼 수 있는 프로젝트 전부의 합 */
  total: number
  /** 대기가 하나라도 있는 프로젝트만 */
  byProject: Record<string, number>
}

/* 회의록 — 게시판에 남기고, 회의록 하나에서 [AI 정리] → 초안 → 사람이 고르고 [등록] (docs/api/minutes.md) */

/** 목록 한 줄 — 본문 · 요약 없이 */
export interface MinutesItem {
  id: string
  projectId: string
  title: string
  /** YYYY-MM-DD */
  meetingDate: string | null
  authorId: string
  /** ISO 8601 UTC, Z */
  createdAt: string
  updatedAt: string
}

export interface Minutes extends MinutesItem {
  body: string
  /** [등록] 때 초안의 요약으로 바뀐다. 없으면 '' */
  summary: string
}

/** 쓰기 · 고치기. 고치기(PATCH)는 보낸 칸만 바꾼다 */
export interface MinutesInput {
  title: string
  meetingDate: string | null
  body: string
}

/** POST /minutes/{id}/draft 의 draft 이벤트. 서버가 들고 있지 않아 다시 정리하면 버린다 */
export interface MinutesDraft {
  /** 회의록에서 읽은 회의 날짜 YYYY-MM-DD. 못 읽으면 null — 날짜 기준이 오늘이었다는 표시 */
  meetingDate: string | null
  /** 회의 요약 서너 줄. 검토 화면 맨 위에 보이고, [등록] 때 회의록 요약으로 저장된다 */
  summary: string
  agendas: ProposedAgenda[]
  updates: ProposedUpdate[]
  tasks: ProposedMinutesTask[]
}

/** 새 안건 */
export interface ProposedAgenda {
  /** 이 초안 안에서만 쓰는 이름 — 'n1', 'n2' … */
  tempId: string
  title: string
  /** 배경. 없으면 '' */
  description: string
  /** 결정내용 — 이 회의에서 정해진 것. 없으면 '' */
  decision: string
  state: AgendaState
  ownerId: string | null
  /** 회의록에서 담당을 부른 말("김 책임"). ownerId 를 못 정했을 때만, 없으면 '' */
  ownerHint: string
  /** 결정 기한 YYYY-MM-DD */
  dueDate: string | null
  /** null 이면 프로젝트 공통 */
  partId: string | null
  /** 근거 원문 — 회의록에서 그대로 옮긴 한두 문장 */
  quote: string
}

/**
 * 이미 있는 안건의 결정내용 · 상태를 통째로 갈아끼운다 — AI 가 지금 결정내용을 읽고 합친 글을 낸다.
 * 한 안건에 하나다. quote 는 계약에 없어 서버가 안 보내면 비운다 (API.md 열린 질문)
 */
export interface ProposedUpdate {
  agendaId: string
  decision: string
  state: AgendaState
  quote?: string
}

/** 작업 — 챗봇의 ProposedTask 에 안건 연결 · 근거가 붙었다. tempId 는 't1', 't2' … */
export interface ProposedMinutesTask extends ProposedTask {
  ownerHint: string
  /** 걸 안건 — 이 초안의 새 안건(tempId) · 이미 있는 안건(id). 둘 다 비면 안건 없이 */
  agendaTempIds: string[]
  agendaIds: string[]
  quote: string
}

export type MinutesEvent =
  /** 지금 하는 일 한 줄 — '기존 안건 찾는 중' · '멤버 확인 중' · '초안 만드는 중' */
  | { type: 'tool'; name: string; label: string }
  /** 초안. 꼭 한 번, done 보다 먼저 */
  | { type: 'draft'; draft: MinutesDraft }
  | { type: 'done' }
  /** 스트림이 열린 뒤의 실패. 이것이 오면 draft · done 은 안 온다 */
  | { type: 'error'; code: string; message: string }

/** POST /minutes/{id}/apply — 화면에서 고르고 고친 것만. quote · ownerHint 는 실어 와도 서버가 버린다 */
export interface MinutesApplyInput {
  /** 회의록에 저장할 요약 — 초안의 summary 를 그대로(고쳐도 된다). 안 보내면 지금 요약 그대로 */
  summary?: string
  agendas: ProposedAgenda[]
  updates: ProposedUpdate[]
  tasks: ProposedMinutesTask[]
}

/** 201 응답 — 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다. 만든 것에는 minutesId 가 붙어 있다 */
export interface MinutesApplyResult {
  /** 요청 순서 그대로 */
  agendas: Agenda[]
  /** updates 로 결정내용 · 상태를 갈아끼운 기존 안건 — 요청 순서 */
  updatedAgendas: Agenda[]
  tasks: Task[]
  links: TaskAgendaLink[]
  agendaIdByTempId: Record<string, string>
  taskIdByTempId: Record<string, string>
}

/* ── 테스트 (docs/api/test.md) — 작업과 따로 둔다. 스냅샷에 싣지 않고 프로젝트 단위로 받는다 ── */

export type TestStatus = 'draft' | 'ready' | 'testing' | 'pass' | 'fail' | 'blocked'
export type TestSignal =
  | 'longRunning' // 오래 걸림
  | 'overdue' // 기간 지남
  | 'notStarted' // 시작 안 함
  | 'longBlocked' // 오래 막힘
  | 'failedIdle' // 실패 그대로
  | 'basisChanged' // 기준 바뀜

/** 참조 태그 */
export interface TestRef {
  kind: 'task' | 'agenda'
  id: string
}

export interface TestCase {
  id: string
  projectId: string
  /** HW-T12 */
  key: string
  title: string
  parentId: string | null
  /** 테스트 내용 — 무엇을 어떻게 해 보고 무엇이 나와야 하나. 여러 줄 글 */
  content: string
  testData: string
  refs: TestRef[]
  status: TestStatus
  /** 지금 상태가 된 시각. ISO 8601 UTC, Z */
  statusChangedAt: string
  /** 지금 상태로 바꾼 사람. 멤버가 지워졌으면 null */
  statusChangedBy: string | null
  /** 오늘(KST) − statusChangedAt 의 날짜(KST). 오늘 바뀌었으면 0 */
  statusDays: number
  /** fail · blocked 의 메모. 그 밖엔 ''. 화면은 이제 받지 않고 지난 글만 '지난 결과 메모' 로 보인다 */
  resultNote: string
  /** YYYY-MM-DD. 테스트 기간. 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  ownerId: string | null
  /** 참조 — 알아야 하는 사람(권한과 무관). 고른 순서, 빈 값은 [] */
  ccIds: string[]
  partId: string | null
  /** 규칙이 붙인 신호. 하위가 있는 테스트(묶음)는 늘 [] */
  signals: TestSignal[]
  /** 기준 바뀜의 근거 — basis 뒤로 결정이 바뀐 닿는 안건, 처음 바뀐 순. 없으면 [] */
  changedAgendaIds: string[]
  createdBy: string | null
  createdAt: string
  /** 조치 내역 수 — 상세의 '조치 N' 에 쓴다 */
  commentCount: number
}

/** 테스트 조치 내역 (docs/api/test-comment.md) — GET /api/tests/{testId}/comments 는 오래된 것부터 낸다.
    본문 · 작성자 규칙은 작업 댓글과 같다. 입력 · 고치기는 TaskCommentInput · TaskCommentPatch 와 같은 { body } */
export interface TestComment {
  id: string
  testId: string
  /** 남긴 사람. 멤버가 지워졌으면 null */
  authorId: string | null
  body: string
  createdAt: string
  /** 고친 적이 없으면 null */
  editedAt: string | null
}

/** POST /api/projects/{projectId}/tests — status 는 받지 않는다(늘 draft 로 들어간다) */
export interface TestInput {
  title: string
  parentId?: string | null
  content?: string
  testData?: string
  /** 작업 · 안건 상세의 [테스트 추가] 가 미리 채운다 */
  refs?: TestRef[]
  start?: string | null
  due?: string | null
  ownerId?: string | null
  /** 안 보내면 [] */
  ccIds?: string[]
  /** 안 보내면 상위 테스트의 파트를 따른다(작업과 같다) */
  partId?: string | null
}

/** PATCH /api/tests/{testId} — 보낸 키만 바꾼다. status · refs 는 여기서 안 바꾼다 */
export interface TestPatch {
  title?: string
  parentId?: string | null
  content?: string
  testData?: string
  start?: string | null
  due?: string | null
  ownerId?: string | null
  /** 통째로 갈아끼운다 */
  ccIds?: string[]
  partId?: string | null
}

/** POST /api/tests/{testId}/status */
export interface TestStatusInput {
  status: TestStatus
  /** fail · blocked 에서만 resultNote 에 남는다(선택, 2026-11-05). 그 밖엔 보내도 버린다 */
  note?: string
}

/** 테스트 목록 · 간트 한 줄 — 화면이 계산해서 얻는 값. 묶음의 상태 · 신호는 하위에서 모은다 */
export interface TestRow {
  test: TestCase
  /** 하위가 있는 테스트 */
  isGroup: boolean
  /** 묶음이면 하위 중 가장 나쁜 것, 아니면 자기 상태 */
  status: TestStatus
  /** 묶음이면 하위 신호를 모은 것(계약 표 순서), 아니면 자기 신호 */
  signals: TestSignal[]
  ownerName: string | null
  /** 로그인 시나리오 · 하위 3건 / 또는 '최상위 테스트' */
  pathLabel: string
  /** 10/8 ~ 10/10 또는 '' */
  periodLabel: string
  childCount: number
}

/* ── AI 영향도 분석 (docs/api/impact.md) — 안건의 결정이 바뀌면 걸린 작업 · 테스트 · 다른 결정을 Claude 가 읽고 고칠 안을 낸다 ── */

/** 작업 · 테스트의 판정 — 고칠 안 · 사람이 볼 것 · 그대로 */
export type ImpactVerdict = 'update' | 'check' | 'ok'
/** 다른 결정된 안건의 판정 — 부딪힘 · 확인 필요 */
export type ConflictVerdict = 'conflict' | 'check'

/** 고칠 안 · 분석 때의 본문 한 줄 — PATCH body 와 같은 모양, 줄 id 는 없다 */
export interface ImpactBodyLine {
  kind: 'check' | 'bullet'
  text: string
  done: boolean
  level: number
}

/** 작업 한 줄의 판정 */
export interface ImpactTask {
  taskId: string
  verdict: ImpactVerdict
  reason: string
  /** update 일 때만 — 바꿀 칸만. 안 바꾸는 칸은 없다 */
  title?: string
  /** update 일 때만 — 본문 전체를 이 줄들로 갈아끼운다 */
  body?: ImpactBodyLine[]
  /** 분석 때의 값 — 반영할 때 지금 값과 견준다. 화면은 '전' 으로 보인다 */
  before: { title: string; body: ImpactBodyLine[] }
  /** 반영한 시각 — 안 했으면 null */
  appliedAt: string | null
  /** 연결 작업이면 true, 분석 중 검색으로 찾은 것(숨은 영향)이면 false */
  linked: boolean
  /** 반영 때 이 안건에 연결했으면 true — 연결 안 된 줄에서만. 반영 전 · 안 했으면 false */
  linkedOnApply: boolean
}

/** 테스트 한 줄의 판정 */
export interface ImpactTest {
  testId: string
  verdict: ImpactVerdict
  reason: string
  title?: string
  content?: string
  testData?: string
  before: { title: string; content: string; testData: string }
  appliedAt: string | null
  /** 닿는 테스트면 true, 검색으로 찾은 것이면 false */
  linked: boolean
  /** 반영 때 이 안건을 태그했으면 true */
  linkedOnApply: boolean
}

/** 다른 결정된 안건과의 부딪힘 */
export interface ImpactConflict {
  agendaId: string
  verdict: ConflictVerdict
  reason: string
  /** 분석 때 그 안건의 결정내용 */
  decision: string
}

export interface AgendaImpact {
  id: string
  projectId: string
  agendaId: string
  /** 분석한 결정 판 — 지금 Agenda.decisionRev 와 다르면 '이전 판 분석' */
  decisionRev: number
  /** 처음 결정이면 null — 화면은 '새 결정' */
  decisionBefore: string | null
  decisionAfter: string
  summary: string
  /** 작업 seq 순 — 넣어 준 것은 판정이 빠져도 ok 로 모두 싣는다 */
  tasks: ImpactTask[]
  tests: ImpactTest[]
  conflicts: ImpactConflict[]
  createdBy: string | null
  createdAt: string
}

/** GET /api/agendas/{agendaId}/impact — 안건 상세가 칸을 그릴 때 */
export interface AgendaImpactState {
  /** 가장 최근 분석 — 없으면 null */
  latest: AgendaImpact | null
  /** 지금 세는 것(AI 없이) — 알림 줄의 숫자 */
  taskCount: number
  testCount: number
  decidedAgendaCount: number
}

/** POST /api/agendas/{agendaId}/impact 의 SSE — chat · risks/summary 와 같은 틀(`event:` 줄이 type) */
export type ImpactEvent =
  | { type: 'tool'; name: string; label: string }
  /** 결과 — 꼭 한 번, done 보다 먼저. 이미 남긴 것이라 id 가 있다 */
  | { type: 'impact'; impact: AgendaImpact }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }

/** POST /api/agenda-impacts/{impactId}/apply — 고르고 고친 것만 */
export interface ImpactApplyInput {
  /** link — 연결 안 된 줄만, 이 안건에 연결(작업 ↔ 안건 링크) */
  tasks: { taskId: string; title?: string; body?: ImpactBodyLine[]; link?: boolean }[]
  /** link — 연결 안 된 줄만, 이 안건을 태그 */
  tests: { testId: string; title?: string; content?: string; testData?: string; link?: boolean }[]
}

export interface ImpactApplyResult {
  /** 바뀐 작업 · 테스트 — 요청 순서 */
  tasks: Task[]
  tests: TestCase[]
  /** 새로 건 작업 ↔ 안건 링크 — 스냅샷을 다시 받지 않고 더한다 */
  links: TaskAgendaLink[]
  /** appliedAt 이 찍힌 뒤의 분석 */
  impact: AgendaImpact
}

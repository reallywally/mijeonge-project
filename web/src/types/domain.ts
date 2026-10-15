/**
 * 안건 × 이력 모델
 *
 * 안건에 남긴 한 줄이 Entry 하나다. 결정이 미뤄지는 것을 막고 무엇이 왜 정해졌는지 남기는 것이
 * 이 앱의 목적이라, 상태는 손으로 바꾸지 않고 Entry 를 남겨서만 바뀐다.
 */

export type ThreadState =
  | 'queued' // 등록만 됨 · 아직 아무 기록이 없음
  | 'open' // 기록이 있지만 아직 못 정함
  | 'decided'

export type EntryKind =
  | 'raise' // 제기
  | 'defer' // 미룸
  | 'decide' // 결정
  | 'refine' // 세부 추가
  | 'change' // 변경 (이전 결정을 대체)
  | 'split' // 하위 안건으로 분리

export interface Member {
  id: string
  name: string
  /** 비활성 멤버는 담당자로 못 고르고, 이름 옆에 '(비활성)' 이 붙는다. 기록이 가리키므로 지우지 않는다 */
  active: boolean
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
}

/** 관리 화면용 — GET /api/admin/members */
export interface MemberAccount {
  id: string
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
}

export interface Thread {
  id: string
  projectId: string
  title: string
  /** 배경 — 왜 지금 정해야 하나. 없으면 '' */
  description: string
  /** 후보 선택지. 순서가 있다. 정답이 열려 있는 안건이면 [] */
  options: string[]
  /** 결정 기한 YYYY-MM-DD (Task.start · due 와 같은 형식) */
  dueDate: string | null
  state: ThreadState
  ownerId: string | null
  /** 다른 안건에서 떼어낸 것이면 그 안건 */
  parentThreadId: string | null
  /** 속한 파트. null 은 프로젝트 공통 */
  partId: string | null
  createdAt: string
}

export interface Entry {
  id: string
  threadId: string
  kind: EntryKind
  /** 한 줄 요약 */
  text: string
  /** 조건별 상세 — 이 결정 안에 함께 적힌 줄들 */
  detail: string[]
  /** 배경 메모 — 왜 그렇게 됐는지 */
  note: string
  ownerId: string | null
  createdAt: string
}

/** 목록 한 행에 필요한, 계산해서 얻는 값들 */
export interface ThreadRow {
  thread: Thread
  ownerName: string | null
  deferCount: number
  entryCount: number
  /** 마지막 Entry 를 남긴 날(KST) — 9월 14일 또는 '—' (기록 없음) */
  lastEntryLabel: string
  /** 9월 12일 또는 '—' (기한 없음) */
  dueLabel: string
  /** 결정 기한이 지났는데 아직 못 정함 */
  overdue: boolean
}

/** 안건을 먼저 등록할 때 화면이 넘기는 것. 제목 말고는 다 비워도 된다 */
export interface ThreadInput {
  title: string
  description?: string
  options?: string[]
  dueDate?: string | null
  ownerId?: string | null
  /** 안 보내면 공통(null) */
  partId?: string | null
}

/**
 * 안건을 고칠 때 화면이 넘기는 것 — PATCH /api/threads/{id}. 보낸 필드만 바뀐다.
 * ownerId · dueDate 는 null 로 비우고, options 는 통째로 바뀐다. state 는 여기서 못 바꾼다(이력으로만).
 */
export interface ThreadPatch {
  title?: string
  ownerId?: string | null
  description?: string
  options?: string[]
  dueDate?: string | null
  /** null 로 공통. 보관 파트는 새로 달 수 없다(이미 달린 것을 두는 것은 된다) */
  partId?: string | null
}

/** 안건 이력 한 줄 — Entry 에 화면에서 필요한 것만 붙였다 */
export interface ThreadEvent {
  entry: Entry
  /** 이 줄이 놓이는 날짜 — createdAt 의 KST 날짜 */
  at: string
  ownerName: string | null
  /** 뒤에 온 결정에 밀려난 줄 — 취소선으로 남는다 */
  superseded: boolean
}

/** 이 안건에서 떼어낸 하위 안건 */
export interface SubThreadRow {
  thread: Thread
  splitAtLabel: string
}

/** 안건 상세 한 화면 — 지금 결정된 내용 + 이력 */
export interface ThreadDetail {
  thread: Thread
  ownerName: string | null
  events: ThreadEvent[]
  deferCount: number
  /** 결정 기한이 지났는데 아직 못 정함 */
  overdue: boolean
  /** 결정 · 변경 줄이 하나라도 있는가 */
  settled: boolean
  /** 마지막 결정 · 변경의 한 줄 요약 */
  current: string
  /** 그 결정의 조건별 상세 + 그 뒤에 붙은 세부 추가 */
  detail: string[]
  /** 언제 정해졌는지 */
  settledLabel: string
  /** 그 결정에 적힌 근거 */
  settledNote: string
  settledOwnerName: string | null
  subThreads: SubThreadRow[]
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
  createdAt: string
  /** 댓글 수. 본문은 스냅샷에 없어 상세를 열 때 따로 받는다 */
  commentCount: number
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
export interface TaskThreadLink {
  taskId: string
  threadId: string
}

/** 작업 목록 한 행 — 계층을 펼치지 않는 대신 경로를 글로 적는다 */
export interface TaskRow {
  task: Task
  ownerName: string | null
  /** 개발 › AI Biz › 가상비서 · 하위 2건 / 또는 '최상위 작업' */
  pathLabel: string
  /** 9/8 ~ 9/15 또는 '' (기간 미정) */
  periodLabel: string
  /** 기간이 안 잡혔는가 — 간트에 막대가 없는 작업 */
  undated: boolean
  threadCount: number
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
  threads: TaskThreadRow[]
  doneChildCount: number
}

/** 작업 상세에 붙는 안건 한 줄 — 지금 어디까지 정해졌는지까지 같이 본다 */
export interface TaskThreadRow {
  thread: Thread
  /** 몇 번 미뤄졌는지 — 안건 목록과 같은 배지를 쓴다 */
  deferCount: number
  /** 결정됐으면 그 한 줄, 아니면 왜 아직인지 */
  line: string
  /** 언제 정해졌는지 — '9월 10일에 정해짐' 또는 '마지막 기록 · 9월 14일' */
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
  threadIds: string[]
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

/** PATCH /api/projects/{projectId} — 프로젝트 관리자 · 시스템 관리자 */
export interface ProjectPatch {
  name: string
}

/** 프로젝트를 등록할 때 넘기는 것. 접두사를 비우면 서버가 만들어 준다 (API.md Q20 · Q24) */
export interface ProjectInput {
  name: string
  taskKeyPrefix?: string
}

/** 안건 이력 한 줄을 남길 때 넘기는 것 — POST /api/threads/{id}/entries */
export interface EntryInput {
  kind: EntryKind
  text: string
  detail?: string[]
  note?: string
  ownerId?: string | null
}

/** GET /api/projects/{id}/snapshot — 그 프로젝트의 원본 전부. 키 이름은 픽스처 export 이름이다 */
export interface ProjectSnapshot {
  project: Project
  threads: Thread[]
  entries: Entry[]
  tasks: Task[]
  taskThreadLinks: TaskThreadLink[]
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
  /** 화면에 보인 글 그대로. 근거 표시(`[[thread:ID]]`)도 지우지 않고 돌려보낸다 */
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
        | 'search_threads'
        | 'get_thread'
        | 'search_tasks'
        | 'get_task'
        | 'list_tasks'
        | 'find_similar_tasks'
        | 'list_members'
        | 'get_decision_risks'
        | 'propose_tasks'
      label: string
    }
  /** 작업 초안. 한 답에 많아야 하나, done 보다 먼저 온다 */
  | { type: 'proposal'; proposal: TaskProposal }
  /** 끝. 답에 실제로 나온 근거만 모은다 */
  | { type: 'done'; refs: ChatRef[] }
  /** 스트림이 열린 뒤의 실패. 이것이 오면 done 은 안 온다 */
  | { type: 'error'; code: string; message: string }

export interface ChatRef {
  kind: 'thread' | 'task'
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

/** 리스크를 가르는 문턱값 다섯 — 프로젝트마다 둔다. PUT 은 다섯 값을 통째로 보낸다 */
export interface RiskSettings {
  /** 결정 기한이 이 날 수 안이면 '기한 임박'. 1 ~ 30, 기본 3 */
  dueSoonDays: number
  /** defer 줄이 이 횟수 이상이면 '여러 번 미룸'. 1 ~ 10, 기본 2 */
  deferCount: number
  /** 마지막 이력 뒤 이 날 수를 넘기면 '오래 멈춤'. 1 ~ 90, 기본 7 */
  staleDays: number
  /** 점수가 이 값 이상이면 high. 2 ~ 30, 기본 6. mediumScore 보다 커야 한다 */
  highScore: number
  /** 점수가 이 값 이상이면 medium. 1 ~ 29, 기본 3 */
  mediumScore: number
}

export interface DecisionRiskReport {
  /** 계산 기준일 — 한국 시간 오늘. YYYY-MM-DD */
  asOf: string
  /** 이 계산에 쓴 기준 */
  settings: RiskSettings
  /** 안 정해진 안건 중 신호가 하나라도 있는 것. score 내림차순 */
  threads: ThreadRisk[]
  /** 안건과 어긋난 작업 */
  tasks: TaskRisk[]
  /** 사람별로 몰린 정도. 담당자 없음은 memberId null 한 줄 */
  owners: OwnerLoad[]
}

/** AI 요약에 보내는 것 — 화면에 지금 보이는 줄의 id. 각 0 ~ 100개 (docs/api/risk.md 'AI 요약') */
export interface RiskSummaryInput {
  /** 화면에 보이는 안건 리스크 줄 — ThreadRisk.threadId */
  threadIds: string[]
  /** 화면에 보이는 어긋난 작업 줄 — TaskRisk.taskId */
  taskIds: string[]
}

export type ThreadRiskSignal =
  | 'overdue'
  | 'dueSoon'
  | 'deferredRepeatedly'
  | 'stale'
  | 'blocking'
  | 'decisionAfterTaskDue'
  | 'noOwner'
  | 'noDueDate'

export type RiskLevel = 'high' | 'medium' | 'low'

export interface ThreadRisk {
  threadId: string
  title: string
  state: 'queued' | 'open'
  ownerId: string | null
  partId: string | null
  dueDate: string | null
  /** 기한을 넘긴 날 수. 기한이 없거나 안 넘었으면 0 */
  overdueDays: number
  deferCount: number
  /** 마지막 defer 줄의 note. 없으면 '' */
  lastDeferNote: string
  /** 마지막 이력(없으면 등록) 뒤 지난 날 수 */
  idleDays: number
  blockedTaskIds: string[]
  /** 아직 안 막혔지만 이 결정을 기다리는 연결 작업(해야 할 일 · 진행 중) */
  waitingTaskIds: string[]
  /** 막힌 연결 작업과 그 하위 중 완료가 아닌 것의 수 (중복 없이) */
  impactTaskCount: number
  /** 연결된 작업(완료 제외) 중 가장 이른 기한 */
  nearestTaskDue: string | null
  signals: ThreadRiskSignal[]
  score: number
  level: RiskLevel
}

export type TaskRiskSignal = 'decidedButBlocked' | 'blockedWithoutThread' | 'dueBeforeDecision'

export interface TaskRisk {
  taskId: string
  key: string
  title: string
  status: 'todo' | 'doing' | 'blocked'
  ownerId: string | null
  partId: string | null
  due: string | null
  /** 이 신호의 근거가 된 안건들. blockedWithoutThread 면 [] */
  threadIds: string[]
  signal: TaskRiskSignal
}

export interface OwnerLoad {
  /** null 은 '담당자 없음' */
  memberId: string | null
  openThreads: number
  overdueThreads: number
  blockedTasks: number
  /** 이 사람이 정하면 풀리는 일의 양 (impactTaskCount 의 합, 중복 없이) */
  blockingImpact: number
}

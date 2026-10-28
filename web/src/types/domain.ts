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
  /** 참조 — 결정을 같이 알아야 할 사람. 순서가 있다. 없으면 [] (docs/api/check.md) */
  ccIds: string[]
  createdAt: string
  /** 출처 — 회의록 [AI 정리] 로 등록했으면 그 회의록. 손으로 만들었거나 회의록을 지웠으면 null */
  minutesId: string | null
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
  /** 출처 회의록. 없으면 null */
  minutesId: string | null
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
  /** 참조 0 ~ 20명. 안 보내면 [] */
  ccIds?: string[]
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
  /** 참조를 통째로 바꾼다 */
  ccIds?: string[]
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
export interface TaskThreadLink {
  taskId: string
  threadId: string
}

/** 선행 작업 — 뒤 작업(taskId)은 선행(dependsOnId)이 끝나야 시작한다. 막지는 않고 알려 주기만 한다 (docs/api/task-flow.md) */
export interface TaskDependency {
  /** 뒤 작업 */
  taskId: string
  /** 먼저 끝나야 하는 작업 */
  dependsOnId: string
}

/** POST /api/projects/{projectId}/dependencies/suggest — 저장하지 않는다. 사람이 줄마다 [적용] 한다 */
export interface DependencySuggestions {
  suggestions: DependencySuggestion[]
  /** 완료 아닌 작업이 많아 앞에서 잘랐으면 true */
  truncated: boolean
}

export interface DependencySuggestion {
  taskId: string
  dependsOnId: string
  /** 왜 — 한 문장 */
  reason: string
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
  /** 이 작업의 선행 작업 */
  dependsOn: Task[]
  /** 이 작업을 선행으로 둔 작업 — 읽기만 한다 */
  dependents: Task[]
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
  /** taskId · dependsOnId 순 (docs/api/task-flow.md) */
  taskDependencies: TaskDependency[]
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

/* 확인 요청 — 결정된 안건의 '이 결정 확인해 주세요' 버튼 하나. 쪽지가 아니다 (docs/api/check.md) */

/** 받는 사람 한 명당 한 줄. 한 번에 보낸 줄은 같은 entryId · createdAt 을 갖는다 */
export interface CheckRequest {
  id: string
  projectId: string
  threadId: string
  /** 이 요청이 알린 결정 — 그 안건의 decide · change 이력 */
  entryId: string
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
  threads: ProposedThread[]
  entries: ProposedEntry[]
  tasks: ProposedMinutesTask[]
}

/** 새 안건 */
export interface ProposedThread {
  /** 이 초안 안에서만 쓰는 이름 — 'n1', 'n2' … */
  tempId: string
  title: string
  /** 배경. 없으면 '' */
  description: string
  /** 후보 선택지. 없으면 [] */
  options: string[]
  ownerId: string | null
  /** 회의록에서 담당을 부른 말("김 책임"). ownerId 를 못 정했을 때만, 없으면 '' */
  ownerHint: string
  /** 결정 기한 YYYY-MM-DD */
  dueDate: string | null
  /** 이 회의에서 정해졌거나 미뤄졌으면 그 이력. 등록만 된 안건이면 null */
  entry: ProposedEntryBody | null
  /** 근거 원문 — 회의록에서 그대로 옮긴 한두 문장 */
  quote: string
}

/** 이미 있는 안건에 붙일 이력 */
export interface ProposedEntry extends ProposedEntryBody {
  /** 'e1', 'e2' … */
  tempId: string
  /** 그 프로젝트의 안건 */
  threadId: string
  quote: string
}

export interface ProposedEntryBody {
  kind: 'decide' | 'defer' | 'refine'
  /** 한 줄 — 결정이면 무엇으로, 미룸이면 무엇을 */
  text: string
  /** 조건별 상세. 없으면 [] */
  detail: string[]
  /** 왜 — 미룸이면 사유. 없으면 '' */
  note: string
  ownerId: string | null
  ownerHint: string
}

/** 작업 — 챗봇의 ProposedTask 에 안건 연결 · 근거가 붙었다. tempId 는 't1', 't2' … */
export interface ProposedMinutesTask extends ProposedTask {
  ownerHint: string
  /** 걸 안건 — 이 초안의 새 안건(tempId) · 이미 있는 안건(id). 둘 다 비면 안건 없이 */
  threadTempIds: string[]
  threadIds: string[]
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
  threads: ProposedThread[]
  entries: ProposedEntry[]
  tasks: ProposedMinutesTask[]
}

/** 201 응답 — 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다. 만든 것에는 minutesId 가 붙어 있다 */
export interface MinutesApplyResult {
  /** 요청 순서 그대로 */
  threads: Thread[]
  /** 새 안건의 이력 + 기존 안건의 이력. 새 안건 것 먼저, 각각 요청 순서 */
  entries: Entry[]
  /** 이력 때문에 상태가 바뀐 기존 안건 */
  updatedThreads: Thread[]
  tasks: Task[]
  links: TaskThreadLink[]
  threadIdByTempId: Record<string, string>
  taskIdByTempId: Record<string, string>
}

/* 프로젝트 진행 리포트 — 지난 7일을 규칙으로 계산하고(facts) Claude 가 손쓸 것을 쓴다. 저장한다 (docs/api/report.md) */

export interface ProgressFacts {
  /** 기간 — 둘 다 YYYY-MM-DD, KST. periodEnd 가 만든 날 */
  periodStart: string
  periodEnd: string
  settings: RiskSettings

  progress: {
    /** 지금 상태별 작업 수 */
    todo: number
    doing: number
    blocked: number
    done: number
    /** done / 전체, 소수 셋째 자리에서 반올림. 작업이 없으면 0 */
    doneRate: number
    /** 기간 안에 완료가 된 작업 (task_log) */
    completedTaskIds: string[]
    /** 기간 안에 진행 중이 된 작업 */
    startedTaskIds: string[]
    /** 기간 안에 등록된 작업 */
    createdTaskIds: string[]
  }

  /** 바로 앞 리포트 — 없으면 null */
  previous: { reportId: string; periodEnd: string; doneRate: number; blocked: number } | null

  decisions: {
    /** 기간 안에 decide · change 이력이 남은 안건 */
    decidedThreadIds: string[]
    /** 기간 안에 defer 이력이 남은 안건 */
    deferredThreadIds: string[]
    /** 지금 리스크 high · medium 안건 — DecisionRiskReport.threads 에서, 점수 순 10개까지 */
    riskyThreadIds: string[]
  }

  /** 손쓸 작업. 한 작업에 신호가 여럿이면 다 싣는다 */
  attention: TaskAttention[]

  /** 사람별 — 담당 작업이 하나라도 있는 사람만, 담당자 없음은 memberId null */
  people: PersonProgress[]
}

export type TaskAttentionSignal =
  /** 이 작업이 기다리는 선행 작업이 안 끝났고, 이 작업의 시작일이 dueSoonDays 안이거나 지났다 */
  | 'waitingOnPredecessor'
  /** 이 작업을 기다리는 작업이 있는데 이 작업이 늦다 — 기한 지남 · 시작일 지났는데 해야 할 일 · 오래 걸림 중 하나 */
  | 'lateBlocker'
  /** 진행 중인 날 수가 계획(start ~ due)의 1.5배를 넘음. 계획이 없으면 staleDays 를 넘음 */
  | 'longRunning'
  /** 막힘인 날 수가 staleDays 를 넘음 */
  | 'longBlocked'
  /** 기한이 지났는데 완료가 아님 */
  | 'overdue'
  /** 시작일이 지났는데 해야 할 일 · 또는 기한이 dueSoonDays 안인데 해야 할 일 */
  | 'notStarted'
  /** 막힘인데 걸린 안건이 전부 결정됨 (risk.md 의 decidedButBlocked) */
  | 'decidedButBlocked'

export interface TaskAttention {
  taskId: string
  signals: TaskAttentionSignal[]
  /** 지금 상태가 된 뒤 지난 날 수 (task_log). backfill 이면 '적어도' */
  statusDays: number
  statusSinceBackfill: boolean
  /** start ~ due 의 날 수. 둘 중 하나라도 없으면 null */
  plannedDays: number | null
  /** 이 작업이 기다리는 안 끝난 선행 작업 */
  waitingOnTaskIds: string[]
  /** 이 작업을 기다리는 안 끝난 작업 — 이 작업이 늦으면 같이 밀린다 (몇 단계 건너도, 중복 없이) */
  blockingTaskIds: string[]
  /** 무게 — Claude 가 '어려운가' 를 판단하는 재료 */
  weight: {
    /** 완료 아닌 하위 작업 수 (자손 전부) */
    openChildren: number
    /** 본문 체크리스트 중 안 끝난 줄 · 전체 줄 */
    openLines: number
    totalLines: number
    /** 걸린 안건 수 */
    threadCount: number
    priority: 'low' | 'normal' | 'high'
  }
  score: number
}

export interface PersonProgress {
  memberId: string | null
  doing: number
  blocked: number
  overdue: number
  /** 기간 안에 끝낸 작업 수 */
  completed: number
  /** 이 사람 작업 중 attention 에 든 것 */
  attentionTaskIds: string[]
}

/** 리포트 목록 한 줄 */
export interface ReportItem {
  id: string
  projectId: string
  periodStart: string
  periodEnd: string
  createdBy: string
  createdAt: string
  /** 목록에 찍을 숫자 — facts 에서 */
  doneRate: number
  attentionCount: number
}

export interface Report extends ReportItem {
  facts: ProgressFacts
  body: string
}

/** 만드는 스트림 */
export type ReportEvent =
  /** 계산이 끝났다 — 화면이 숫자 카드를 먼저 그린다 */
  | { type: 'facts'; facts: ProgressFacts }
  /** 글 조각 */
  | { type: 'delta'; text: string }
  /** 저장까지 끝. refs 는 본문의 근거 중 넣어 준 id 만 */
  | { type: 'done'; report: ReportItem; refs: ChatRef[] }
  | { type: 'error'; code: string; message: string }

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
  kind: 'task' | 'thread'
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
  /** fail · blocked 의 메모. 그 밖엔 '' */
  resultNote: string
  /** YYYY-MM-DD. 테스트 기간. 둘 다 null 이면 기간 미정 */
  start: string | null
  due: string | null
  ownerId: string | null
  partId: string | null
  /** 규칙이 붙인 신호. 하위가 있는 테스트(묶음)는 늘 [] */
  signals: TestSignal[]
  /** 기준 바뀜의 근거 — basis 뒤로 닿는 안건에 생긴 decide · change Entry 의 id, 오래된 것부터. 없으면 [] */
  changedEntryIds: string[]
  createdBy: string | null
  createdAt: string
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
  partId?: string | null
}

/** POST /api/tests/{testId}/status */
export interface TestStatusInput {
  status: TestStatus
  /** fail · blocked 면 필수(앞뒤 공백을 뗀 뒤 비면 안 된다). 그 밖엔 보내도 버린다 */
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

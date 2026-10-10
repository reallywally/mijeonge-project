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
  createdAt: string
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
}

/** 성공이 아닌 응답의 본문 — 전부 이 한 가지 모양이다 (API.md Q14) */
export interface ApiErrorBody {
  code: string
  /** 그대로 띄울 수 있는 한국어 한 줄 */
  message: string
  /** 폼 검증에서 필드별 메시지 */
  detail?: Record<string, string>
}

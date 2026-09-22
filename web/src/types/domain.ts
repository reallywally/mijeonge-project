/**
 * 회의 × 안건 모델
 *
 * 회의에서 남긴 한 줄은 Entry 하나다. Entry 는 threadId 와 meetingId 를 모두 갖고,
 * 안건 이력과 회의 기록이 같은 Entry 를 각자 걸러 보여준다. 옮겨 적은 사본이 아니다.
 * meetingId 가 null 이면 회의 없이 담당자 확인으로 처리한 줄("회의 밖")이다.
 */

export type ThreadState =
  | 'queued' // 등록만 됨 · 아직 어느 회의에서도 다루지 않음
  | 'open' // 다뤘지만 아직 못 정함
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
}

export interface Thread {
  id: string
  projectId: string
  title: string
  state: ThreadState
  ownerId: string | null
  /** 다른 안건에서 떼어낸 것이면 그 안건 */
  parentThreadId: string | null
  createdAt: string
}

export interface Meeting {
  id: string
  projectId: string
  title: string
  /** YYYY-MM-DD */
  date: string
  attendeeIds: string[]
  /** 안건에 붙지 않는 줄. 회의록 본문은 따로 없다. */
  memos: MeetingMemo[]
}

export interface MeetingMemo {
  id: string
  text: string
  /** 이 메모를 안건으로 올렸다면 그 안건 */
  promotedThreadId: string | null
}

export interface Entry {
  id: string
  threadId: string
  /** null = 회의 밖 처리 */
  meetingId: string | null
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
  lastMeetingLabel: string
}

/** 안건 이력 한 줄 — Entry 에 화면에서 필요한 것만 붙였다 */
export interface ThreadEvent {
  entry: Entry
  /** null = 회의 밖 처리 */
  meeting: Meeting | null
  /** 이 줄이 놓이는 날짜. 회의에 붙은 줄이면 그 회의의 날짜다 */
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

/** 안건 상세 한 화면 — 지금 합의된 내용 + 회의별 이력 */
export interface ThreadDetail {
  thread: Thread
  ownerName: string | null
  events: ThreadEvent[]
  deferCount: number
  /** 결정 · 변경 줄이 하나라도 있는가 */
  settled: boolean
  /** 마지막 결정 · 변경의 한 줄 요약 */
  current: string
  /** 그 결정의 조건별 상세 + 그 뒤에 붙은 세부 추가 */
  detail: string[]
  /** 언제 · 어디서 정해졌는지 */
  settledLabel: string
  settledOwnerName: string | null
  subThreads: SubThreadRow[]
}

/** 회의 목록 한 행 — 그 회의에 붙은 Entry 를 세어 얻는다 */
export interface MeetingRow {
  meeting: Meeting
  attendeeNames: string[]
  /** 그 회의에서 다룬 안건 수 */
  threadCount: number
  /** 결정 · 변경 줄 수 */
  decidedCount: number
  /** 미룸 줄 수 */
  deferredCount: number
  /** 안건에 안 붙는 메모 줄 수 */
  memoCount: number
  /** 이 회의에 걸린 작업 수 */
  taskCount: number
  dateLabel: string
}

/** 회의 하나에서 안건 하나에 남긴 줄들 */
export interface MeetingThreadLines {
  thread: Thread
  /** 안건 전체에서 미뤄진 횟수 — 상태 배지가 쓴다 */
  deferCount: number
  lines: { entry: Entry; ownerName: string | null }[]
}

/** 회의 하나 보기 — 회의록 본문은 없다. 그날 안건에 남긴 줄이 그대로 기록이다. */
export interface MeetingDetail {
  meeting: Meeting
  attendeeNames: string[]
  threads: MeetingThreadLines[]
  entryCount: number
  decidedCount: number
  deferredCount: number
  dateLabel: string
}

/**
 * 새 회의 화면이 저장할 때 넘기는 것.
 *
 * 회의 중에 처음 등록한 안건은 아직 id 가 없어 화면에서만 쓰는 tempId 로 가리킨다.
 * 저장할 때 실제 id 를 받고, entries 와 memos 의 tempId 도 그것으로 바뀐다.
 */
export interface NewThreadInput {
  tempId: string
  title: string
  ownerId: string | null
  parentThreadId: string | null
}

export interface MeetingEntryInput {
  /** 실제 안건 id 또는 NewThreadInput.tempId */
  threadId: string
  kind: EntryKind
  text: string
  detail: string[]
  note: string
  ownerId: string | null
}

export interface MeetingInput {
  title: string
  /** YYYY-MM-DD */
  date: string
  attendeeIds: string[]
  newThreads: NewThreadInput[]
  entries: MeetingEntryInput[]
  memos: { text: string; promotedTempId: string | null }[]
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

export interface MeetingTaskLink {
  meetingId: string
  taskId: string
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
  /** 이 작업이 걸린 회의 */
  meetings: Meeting[]
  doneChildCount: number
}

/** 작업 상세에 붙는 안건 한 줄 — 지금 어디까지 정해졌는지까지 같이 본다 */
export interface TaskThreadRow {
  thread: Thread
  /** 몇 번 미뤄졌는지 — 안건 목록과 같은 배지를 쓴다 */
  deferCount: number
  /** 결정됐으면 그 한 줄, 아니면 왜 아직인지 */
  line: string
  /** 어디서 정해졌는지 — '개발 환경 확정 회의 · 9월 10일' 또는 '회의 밖 · …' */
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

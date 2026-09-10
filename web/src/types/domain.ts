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
 * 요청 — 안건과 나란히 서는 두 번째 레코드.
 *
 * 안건이 "정해야 할 것"이라면 요청은 "누가 해주면 끝나는 것"이다. 데이터 정리, 확인 부탁 같은
 * 자잘한 일이라 회의를 거치지 않는다. 그래서 상태도 안건의 queued/open/decided 와 겹치지 않는
 * 세 가지뿐이고, 오가는 이야기는 Entry 처럼 종류를 붙이지 않고 그냥 댓글로 쌓는다.
 */

export type RequestState =
  | 'todo' // 요청됨
  | 'doing' // 하는 중
  | 'done'

/**
 * 요청 내용이 어디까지 좁혀졌는가.
 * 요청이 멈추는 가장 흔한 자리가 "무엇을 해달라는 건지 아직 모름"이라 목록에서도 보여준다.
 */
export type SpecState =
  | 'none' // 아직 정리하지 않음
  | 'draft' // 뽑아 두었지만 사람이 확정하지 않음
  | 'confirmed'
  | 'stale' // 확정·정리 뒤에 댓글이 더 달렸다

export interface Request {
  id: string
  projectId: string
  /** 처음에는 "결제 실패 데이터 정리" 수준의 한 줄이다. */
  title: string
  /** 등록할 때 적어 둔 상세 내용. 게시판의 본문 자리다. 없으면 빈 문자열. */
  body: string
  state: RequestState
  requesterId: string
  assigneeId: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
  /** 어느 안건의 어느 줄에서 나왔는지. 회의에서 정한 것이 일로 이어지는 고리다. */
  sourceEntryId: string | null
  spec: RequestSpec | null
  createdAt: string
}

/** 오간 댓글에서 뽑아낸 요청 내용. 칸을 나누지 않고 불릿 한 목록으로 둔다. */
export interface RequestSpec {
  points: string[]
  /** 기계가 뽑은 것은 언제나 초안이고, 사람이 확정해야 담당자가 이걸 기준으로 일한다. */
  confirmed: boolean
  confirmedById: string | null
  confirmedAt: string | null
  /** 이 정리를 뽑을 때 읽은 댓글 수. 그 뒤로 더 달렸는지는 이 값으로 안다. */
  fromCommentCount: number
}

/** 요청에 붙는 말. 안건의 Entry 와 달리 종류도 대댓글도 없다. */
export interface RequestComment {
  id: string
  requestId: string
  authorId: string
  text: string
  /** ISO datetime */
  createdAt: string
}

/** 목록 한 행에 필요한, 계산해서 얻는 값들 */
export interface RequestRow {
  request: Request
  requesterName: string
  assigneeName: string | null
  commentCount: number
  specState: SpecState
  dueLabel: string
}

/** 요청 하나 보기 — 정리된 내용 + 주고받은 이야기 */
export interface RequestDetail {
  request: Request
  requesterName: string
  assigneeName: string | null
  comments: { comment: RequestComment; authorName: string; atLabel: string }[]
  specState: SpecState
  /** 정리한 뒤로 더 달린 댓글 수 */
  staleCount: number
  dueLabel: string
  /** 이 요청을 낳은 안건과 그 줄 */
  sourceThread: Thread | null
  sourceLabel: string
}

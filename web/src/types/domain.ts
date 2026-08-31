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

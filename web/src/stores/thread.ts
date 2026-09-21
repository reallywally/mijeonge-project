import { defineStore } from 'pinia'
import { computed } from 'vue'
import { monthDay, today } from '@/lib/date'
import { useDataStore } from '@/stores/data'
import type {
  Entry,
  EntryKind,
  SubThreadRow,
  Thread,
  ThreadDetail,
  ThreadEvent,
  ThreadRow,
} from '@/types/domain'

/**
 * 안건과 그 이력.
 *
 * Entry 하나가 (회의 × 안건) 한 줄이다. 안건 이력과 회의 기록이 같은 Entry 를 각자 걸러 보여줄 뿐
 * 옮겨 적은 사본이 아니다. meetingId 가 null 이면 회의 없이 담당자 확인으로 처리한 줄이다.
 */
export const useThreadStore = defineStore('thread', () => {
  const data = useDataStore()

  /** 고른 프로젝트의 안건만 */
  const threads = computed<Thread[]>(() =>
    data.allThreads.filter((t) => t.projectId === data.currentProjectId),
  )

  const entriesOfThread = (threadId: string): Entry[] =>
    data.allEntries
      .filter((e) => e.threadId === threadId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const meetingById = (id: string | null) =>
    id ? (data.allMeetings.find((m) => m.id === id) ?? null) : null

  const rows = computed<ThreadRow[]>(() =>
    threads.value.map((thread) => {
      const own = entriesOfThread(thread.id)
      const lastWithMeeting = own.find((e) => e.meetingId !== null)
      return {
        thread,
        ownerName: data.memberName(thread.ownerId),
        deferCount: own.filter((e) => e.kind === 'defer').length,
        entryCount: own.length,
        lastMeetingLabel: lastWithMeeting ? monthDay(lastWithMeeting.createdAt) : '—',
      }
    }),
  )

  /** 아직 어느 회의에서도 다루지 않은 안건 — 다음 회의에서 고를 후보다 */
  const queuedCount = computed(() => rows.value.filter((r) => r.thread.state === 'queued').length)
  /** 다뤘지만 아직 못 정한 안건 */
  const openCount = computed(() => rows.value.filter((r) => r.thread.state === 'open').length)

  function settledLabel(decision: ThreadEvent, lastRefine: ThreadEvent | null) {
    const where = decision.meeting
      ? `${monthDay(decision.at)} 회의에서 정해`
      : `${monthDay(decision.at)} · 회의를 다시 잡지 않고 담당자 확인으로 정해`
    return lastRefine ? `${where}지고 ${monthDay(lastRefine.at)}에 세부가 붙음` : `${where}짐`
  }

  /**
   * 안건 하나를 한 화면에 필요한 모양으로 조립한다.
   *
   * 이력은 새 줄이 위로 온다. 정렬 기준은 createdAt 이 아니라 "그 줄이 놓이는 날짜"다 —
   * 회의에 붙은 줄은 그 회의의 날짜에 놓인다. 같은 날짜의 줄끼리는 등록한 순서를 뒤집는다.
   */
  function threadDetail(threadId: string): ThreadDetail | null {
    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return null

    const ordered = data.allEntries
      .map((entry, seqNo) => ({ entry, seqNo }))
      .filter((x) => x.entry.threadId === threadId)
      .map((x) => {
        const meeting = meetingById(x.entry.meetingId)
        return { ...x, meeting, at: meeting?.date ?? x.entry.createdAt }
      })
      .sort((a, b) => b.at.localeCompare(a.at) || b.seqNo - a.seqNo)

    /* 결정 · 변경은 뒤에 온 것이 앞의 것을 대체한다. 위에서부터 첫 줄만 살아 있다. */
    let decisionSeen = false
    const events: ThreadEvent[] = ordered.map((x) => {
      const decides = x.entry.kind === 'decide' || x.entry.kind === 'change'
      const superseded = decides && decisionSeen
      if (decides) decisionSeen = true
      return {
        entry: x.entry,
        meeting: x.meeting,
        at: x.at,
        ownerName: data.memberName(x.entry.ownerId),
        superseded,
      }
    })

    const decisionAt = events.findIndex(
      (e) => !e.superseded && (e.entry.kind === 'decide' || e.entry.kind === 'change'),
    )
    const decision = decisionAt >= 0 ? events[decisionAt] : null
    /* 결정보다 나중에 붙은 세부 추가는 그 결정의 상세로 올라간다 (오래된 것부터) */
    const refines = decision
      ? events.slice(0, decisionAt).filter((e) => e.entry.kind === 'refine')
      : []

    const subThreads: SubThreadRow[] = data.allThreads
      .filter((t) => t.parentThreadId === threadId)
      .map((t) => ({ thread: t, splitAtLabel: `${monthDay(t.createdAt)}에 분리` }))

    return {
      thread,
      ownerName: data.memberName(thread.ownerId),
      events,
      deferCount: events.filter((e) => e.entry.kind === 'defer').length,
      settled: decision !== null,
      current: decision?.entry.text ?? '',
      detail: decision
        ? [...decision.entry.detail, ...refines.map((e) => e.entry.text).reverse()]
        : [],
      settledLabel: decision ? settledLabel(decision, refines[0] ?? null) : '',
      settledOwnerName: decision ? (decision.ownerName ?? data.memberName(thread.ownerId)) : null,
      subThreads,
    }
  }

  /** 회의와 무관하게 먼저 등록해 두는 안건. 등록만 된 상태가 '대기'다. */
  function addThread(title: string, ownerId: string | null) {
    const id = data.nextId('nt')
    data.allThreads.unshift({
      id,
      projectId: data.currentProjectId,
      title,
      state: 'queued',
      ownerId,
      parentThreadId: null,
      createdAt: today(),
    })
    return id
  }

  /**
   * 회의 없이 담당자 확인만으로 처리한 줄. meetingId 가 없어 어느 회의에도 붙지 않는다.
   * 결정으로 남기면 안건 상태와 담당자까지 그 자리에서 바뀐다.
   */
  function addOutsideEntry(
    threadId: string,
    kind: Extract<EntryKind, 'decide' | 'refine' | 'defer'>,
    text: string,
    note: string,
    ownerId: string | null,
  ) {
    data.allEntries.push({
      id: data.nextId('ne'),
      threadId,
      meetingId: null,
      kind,
      text,
      detail: [],
      note,
      ownerId,
      createdAt: today(),
    })

    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return
    if (kind === 'decide') {
      thread.state = 'decided'
      if (ownerId) thread.ownerId = ownerId
    } else if (thread.state === 'queued') {
      thread.state = 'open'
    }
  }

  return {
    threads,
    rows,
    queuedCount,
    openCount,
    entriesOfThread,
    threadDetail,
    addThread,
    addOutsideEntry,
  }
})

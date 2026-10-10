import { defineStore } from 'pinia'
import { computed } from 'vue'
import * as api from '@/api'
import { kstToday, localDay, monthDay, nowIso } from '@/lib/date'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import type {
  Entry,
  EntryKind,
  SubThreadRow,
  Thread,
  ThreadDetail,
  ThreadEvent,
  ThreadInput,
  ThreadPatch,
  ThreadRow,
} from '@/types/domain'

/** 결정 기한이 지났는데 아직 못 정한 안건. 기한 당일은 아직 지난 게 아니다. */
export function isOverdue(thread: Thread, today: string) {
  return thread.dueDate !== null && thread.dueDate < today && thread.state !== 'decided'
}

/**
 * 안건과 그 이력.
 *
 * 상태는 손으로 바꾸지 않는다 — Entry 를 남기면 그에 따라 바뀐다. 결정이 미뤄지는 것을 막고
 * 무엇이 왜 정해졌는지 남기는 것이 목적이라, 상태만 바뀌고 기록이 없는 일이 없게 한다.
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

  const rows = computed<ThreadRow[]>(() => {
    /* 오늘은 계산할 때 한 번만 읽는다 — 화면을 연 채 자정을 넘기는 경우까지는 쫓지 않는다 */
    const today = kstToday()
    return threads.value.map((thread) => {
      const own = entriesOfThread(thread.id)
      return {
        thread,
        ownerName: data.memberName(thread.ownerId),
        deferCount: own.filter((e) => e.kind === 'defer').length,
        entryCount: own.length,
        lastEntryLabel: own[0] ? monthDay(own[0].createdAt) : '—',
        dueLabel: thread.dueDate ? monthDay(thread.dueDate) : '—',
        overdue: isOverdue(thread, today),
      }
    })
  })

  /** 아직 아무 기록이 없는 안건 */
  const queuedCount = computed(() => rows.value.filter((r) => r.thread.state === 'queued').length)
  /** 기록은 있지만 아직 못 정한 안건 */
  const openCount = computed(() => rows.value.filter((r) => r.thread.state === 'open').length)
  /** 결정 기한을 넘긴 안건 */
  const overdueCount = computed(() => rows.value.filter((r) => r.overdue).length)

  function settledLabel(decision: ThreadEvent, lastRefine: ThreadEvent | null) {
    const when = `${monthDay(decision.at)}에 정해`
    return lastRefine ? `${when}지고 ${monthDay(lastRefine.at)}에 세부가 붙음` : `${when}짐`
  }

  /**
   * 안건 하나를 한 화면에 필요한 모양으로 조립한다.
   *
   * 이력은 새 줄이 위로 온다. 같은 날짜의 줄끼리는 등록한 순서를 뒤집는다 —
   * 그 '등록한 순서' 는 allEntries 의 배열 순서다. **배열 순서가 계약이다** (API.md Q4).
   */
  function threadDetail(threadId: string): ThreadDetail | null {
    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return null

    const ordered = data.allEntries
      .map((entry, seqNo) => ({ entry, seqNo, at: localDay(entry.createdAt) }))
      .filter((x) => x.entry.threadId === threadId)
      .sort((a, b) => b.at.localeCompare(a.at) || b.seqNo - a.seqNo)

    /* 결정 · 변경은 뒤에 온 것이 앞의 것을 대체한다. 위에서부터 첫 줄만 살아 있다. */
    let decisionSeen = false
    const events: ThreadEvent[] = ordered.map((x) => {
      const decides = x.entry.kind === 'decide' || x.entry.kind === 'change'
      const superseded = decides && decisionSeen
      if (decides) decisionSeen = true
      return {
        entry: x.entry,
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
      overdue: isOverdue(thread, kstToday()),
      settled: decision !== null,
      current: decision?.entry.text ?? '',
      detail: decision
        ? [...decision.entry.detail, ...refines.map((e) => e.entry.text).reverse()]
        : [],
      settledLabel: decision ? settledLabel(decision, refines[0] ?? null) : '',
      settledNote: decision?.entry.note ?? '',
      settledOwnerName: decision ? (decision.ownerName ?? data.memberName(thread.ownerId)) : null,
      subThreads,
    }
  }

  const cleanOptions = (options: string[]) => options.map((o) => o.trim()).filter(Boolean)

  /** 서버가 돌려준 안건으로 갈아끼운다 */
  function replaceThread(next: Thread) {
    const at = data.allThreads.findIndex((t) => t.id === next.id)
    if (at >= 0) data.allThreads[at] = next
  }

  /**
   * 안건을 먼저 등록해 둔다. 등록만 된 상태가 '대기'다 — POST /api/projects/{id}/threads.
   * 제목 말고는 다 비워도 들어간다 — 칸이 귀찮으면 안건 대신 메신저로 정하게 된다.
   * 서버 모드에서는 id 를 서버가 내므로 응답을 기다렸다가 넣는다. 실패하면 알리고 null 이다.
   */
  async function addThread(input: ThreadInput): Promise<string | null> {
    const clean = {
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      options: cleanOptions(input.options ?? []),
      dueDate: input.dueDate || null,
      ownerId: input.ownerId ?? null,
    }
    if (!data.mock) {
      try {
        const thread = await api.createThread(data.currentProjectId, clean)
        data.allThreads.unshift(thread)
        return thread.id
      } catch (e) {
        toastError(e)
        return null
      }
    }
    const id = data.nextId('nt')
    data.allThreads.unshift({
      id,
      projectId: data.currentProjectId,
      ...clean,
      state: 'queued',
      parentThreadId: null,
      createdAt: nowIso(),
    })
    return id
  }

  /**
   * 안건을 고친다 — PATCH /api/threads/{id}. 보낸 필드만 바뀐다.
   * 제목을 비우려 하면 아무것도 바꾸지 않는다(서버도 요청째 거절한다). 상태는 여기서 못 바꾼다.
   * 화면에 먼저 반영하고 서버에 보낸 뒤 돌아온 안건으로 갈아끼운다.
   */
  function updateThread(threadId: string, patch: ThreadPatch) {
    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return false
    if (patch.title !== undefined && !patch.title.trim()) return false
    const clean: ThreadPatch = {}
    if (patch.title !== undefined) clean.title = thread.title = patch.title.trim()
    if (patch.description !== undefined)
      clean.description = thread.description = patch.description.trim()
    if (patch.options !== undefined) clean.options = thread.options = cleanOptions(patch.options)
    if (patch.dueDate !== undefined) clean.dueDate = thread.dueDate = patch.dueDate || null
    if (patch.ownerId !== undefined) clean.ownerId = thread.ownerId = patch.ownerId
    if (!data.mock) {
      void data.save(`thread:${threadId}`, () => api.patchThread(threadId, clean), replaceThread)
    }
    return true
  }

  /**
   * 이력 한 줄을 남긴다 — POST /api/threads/{id}/entries.
   * 결정으로 남기면 안건이 결정됨이 되고 처리한 사람이 있으면 담당자도 그 사람이 된다.
   * 그 밖의 줄은 대기 중이던 안건을 논의중으로 옮긴다.
   * 서버 모드에서는 응답의 줄을 넣고 안건을 갈아끼운다. 남겼으면 true 다.
   */
  async function addEntry(
    threadId: string,
    kind: Extract<EntryKind, 'decide' | 'refine' | 'defer'>,
    text: string,
    note: string,
    ownerId: string | null,
  ): Promise<boolean> {
    if (!data.mock) {
      try {
        const res = await api.addEntry(threadId, { kind, text, detail: [], note, ownerId })
        data.allEntries.push(res.entry)
        replaceThread(res.thread)
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    }

    data.allEntries.push({
      id: data.nextId('ne'),
      threadId,
      kind,
      text,
      detail: [],
      note,
      ownerId,
      createdAt: nowIso(),
    })

    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return true
    if (kind === 'decide') {
      thread.state = 'decided'
      if (ownerId) thread.ownerId = ownerId
    } else if (thread.state === 'queued') {
      thread.state = 'open'
    }
    return true
  }

  return {
    threads,
    rows,
    queuedCount,
    openCount,
    overdueCount,
    entriesOfThread,
    threadDetail,
    addThread,
    updateThread,
    addEntry,
  }
})

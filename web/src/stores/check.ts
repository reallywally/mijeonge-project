import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import {
  type CheckBatch,
  type CheckBlock,
  checkBlock,
  checkRecipients,
  groupByEntry,
  isPending,
  latestDecision,
  sortReceived,
  sortSentBatches,
} from '@/lib/check'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { CheckPendingCount, CheckRequest, Entry } from '@/types/domain'

/** 안건 상세의 확인 요청 칸이 그리는 것 */
export interface ThreadCheckState {
  /** 지금의 최근 결정 — 없으면 결정 전 */
  decision: Entry | null
  /** 누르면 받을 사람 — 서버와 같은 셈으로 미리 센다 */
  recipientIds: string[]
  /** 못 누르는 까닭. 누를 수 있으면 null */
  block: CheckBlock | null
  /** 지금 결정으로 보낸 묶음 */
  current: CheckBatch | null
  /** 앞 결정들로 보낸 묶음 — 최근 순 */
  older: CheckBatch[]
}

/** 배지를 다시 받는 간격 (docs/api/check.md '화면') */
export const CHECK_BADGE_INTERVAL_MS = 60_000

/**
 * 확인 요청 — 고른 프로젝트의 요청 전부를 들고 받은 것 · 보낸 것 · 안건별을 계산한다('집계는 프론트가 한다').
 * 목록은 '확인 요청' 화면에 들어올 때 · 상세를 열 때 · 내가 보내거나 확인한 뒤 받는다.
 * 배지(pending-count)는 앱이 뜰 때 · 창 포커스 · 60초마다 — startBadge 가 맡는다.
 * [내 파트 | 전체] 는 따르지 않는다 — 나에게 온 것 · 내가 보낸 것은 파트와 상관없다
 */
export const useCheckStore = defineStore('check', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  const rows = ref<CheckRequest[]>([])
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let ticket = 0

  const current = computed(() =>
    rowsProjectId.value !== null && rowsProjectId.value === data.currentProjectId ? rows.value : [],
  )
  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)

  const me = computed(() => auth.me?.id ?? null)

  const received = computed(() =>
    sortReceived(current.value.filter((c) => c.recipientId === me.value)),
  )
  /** 보낸 것 — 한 번에 보낸 묶음(결정 하나)이 한 줄 */
  const sent = computed(() =>
    sortSentBatches(groupByEntry(current.value.filter((c) => c.senderId === me.value))),
  )
  const receivedPending = computed(() => received.value.filter(isPending))

  /** 받는 사람 셈의 '활성 멤버' — 고른 프로젝트에 부여된 활성 멤버 */
  const eligible = (memberId: string) => data.assignable.some((m) => m.id === memberId)

  /**
   * 안건 상세의 확인 요청 — 최근 결정 · 받을 사람 · 못 누르는 까닭 · 보낸 묶음.
   * 목록을 아직 못 받았으면 보냈는지 모르므로 누를 수 없게 둔다(sent 로 본다)
   */
  function forThread(threadId: string): ThreadCheckState | null {
    const thread = data.allThreads.find((t) => t.id === threadId)
    if (!thread) return null
    const decision = latestDecision(data.allEntries, threadId)
    const batches = groupByEntry(current.value.filter((c) => c.threadId === threadId))
    const now = decision ? (batches.find((b) => b.entryId === decision.id) ?? null) : null
    const recipientIds = checkRecipients({
      thread,
      tasks: data.allTasks,
      taskThreads: data.taskThreads,
      senderId: me.value,
      eligible,
    })
    return {
      decision,
      recipientIds,
      block: checkBlock(thread, decision, now !== null || !loaded.value, recipientIds.length),
      current: now,
      older: sortSentBatches(batches.filter((b) => b !== now)),
    }
  }

  /** 내가 받은 대기만 [확인] 할 수 있다 */
  const canConfirm = (c: CheckRequest) => isPending(c) && c.recipientId === me.value

  /** 고른 프로젝트의 요청을 받는다. 늦게 온 옛 응답은 버린다 */
  async function load() {
    const projectId = data.currentProjectId
    const mine = ++ticket
    if (!projectId || !auth.me) {
      rows.value = []
      rowsProjectId.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const got = await api.fetchChecks(projectId)
      if (mine !== ticket) return
      rows.value = got
      rowsProjectId.value = projectId
    } catch (e) {
      if (mine !== ticket) return
      error.value = messageOf(e)
    } finally {
      if (mine === ticket) loading.value = false
    }
  }

  /**
   * 그 안건의 최근 결정으로 보낸다 — 본문이 없고 받는 사람은 서버가 정한다.
   * 보낸 줄 수를 돌려준다. 실패하면 알리고(이미 보냈으면 목록을 다시 받아 버튼이 닫힌다) null.
   * 받는 사람의 배지는 그쪽 화면이 다시 받을 때 는다
   */
  async function send(threadId: string): Promise<number | null> {
    const projectId = data.currentProjectId
    try {
      const made = await api.sendCheck(threadId)
      if (rowsProjectId.value === projectId) rows.value = [...rows.value, ...made]
      void load()
      return made.length
    } catch (e) {
      toastError(e)
      void load()
      return null
    }
  }

  /** 확인한다 — 받은 사람만. 이미 확인한 것이면 서버가 그대로 돌려준다(멱등) */
  async function confirm(checkId: string): Promise<boolean> {
    try {
      const next = await api.confirmCheck(checkId)
      const at = rows.value.findIndex((c) => c.id === checkId)
      if (at >= 0) rows.value[at] = next
      void load()
      void loadPendingCount()
      return true
    } catch (e) {
      toastError(e)
      void load()
      return false
    }
  }

  /* 배지 — 지금 프로젝트의 내 대기 수 · 다른 프로젝트들의 수 (Q38) */
  const pending = ref<CheckPendingCount | null>(null)
  let badgeTicket = 0

  const pendingOf = (projectId: string) => pending.value?.byProject[projectId] ?? 0
  const pendingHere = computed(() => pendingOf(data.currentProjectId))
  const pendingElsewhere = computed(() => (pending.value?.total ?? 0) - pendingHere.value)

  /** 배지 수를 받는다. 실패해도 알리지 않는다 — 60초 뒤 다시 받는다 */
  async function loadPendingCount() {
    const mine = ++badgeTicket
    if (!auth.me) {
      pending.value = null
      return
    }
    try {
      const got = await api.fetchCheckPendingCount()
      if (mine === badgeTicket) pending.value = got
    } catch {
      /* 배지 하나 때문에 화면을 막지 않는다 */
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  const onFocus = () => void loadPendingCount()

  /** 앱이 뜰 때 한 번 받고, 창 포커스 · 60초마다 다시 받는다. 두 번 불러도 하나만 돈다 */
  function startBadge() {
    void loadPendingCount()
    if (timer !== null) return
    timer = setInterval(onFocus, CHECK_BADGE_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
  }

  function stopBadge() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
    window.removeEventListener('focus', onFocus)
  }

  function clear() {
    ticket += 1
    badgeTicket += 1
    stopBadge()
    rows.value = []
    rowsProjectId.value = null
    loading.value = false
    error.value = null
    pending.value = null
  }

  return {
    rows: current,
    loaded,
    loading,
    error,
    received,
    receivedPending,
    sent,
    forThread,
    canConfirm,
    load,
    send,
    confirm,
    pending,
    pendingOf,
    pendingHere,
    pendingElsewhere,
    loadPendingCount,
    startBadge,
    stopBadge,
    clear,
  }
})

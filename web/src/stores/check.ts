import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { isPending, sortReceived, sortSent } from '@/lib/check'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type {
  CheckPendingCount,
  CheckRequest,
  CheckRequestInput,
  CheckTargetType,
} from '@/types/domain'

/** 배지를 다시 받는 간격 (docs/api/check.md '화면') */
export const CHECK_BADGE_INTERVAL_MS = 60_000

/**
 * 확인 요청 — 고른 프로젝트의 요청 전부를 들고 받은 것 · 보낸 것 · 작업/안건별을 계산한다('집계는 프론트가 한다').
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
  const sent = computed(() => sortSent(current.value.filter((c) => c.senderId === me.value)))
  const receivedPending = computed(() => received.value.filter(isPending))

  /** 그 작업 · 안건에 걸린 요청 — 오래된 것 먼저 */
  const forTarget = (type: CheckTargetType, targetId: string) =>
    current.value.filter((c) => c.targetType === type && c.targetId === targetId)

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
   * 보낸다. 실패하면 서버 message 를 돌려준다 — 대화 상자가 그대로 띄운다.
   * 받는 사람의 배지는 그쪽 화면이 다시 받을 때 는다
   */
  async function send(
    input: CheckRequestInput,
  ): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
    const projectId = data.currentProjectId
    try {
      const made = await api.sendCheck(projectId, {
        targetType: input.targetType,
        targetId: input.targetId,
        recipientIds: [...input.recipientIds],
        text: input.text.trim(),
      })
      if (rowsProjectId.value === projectId) rows.value = [...rows.value, ...made]
      void load()
      return { ok: true, count: made.length }
    } catch (e) {
      return { ok: false, message: messageOf(e) }
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
    forTarget,
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

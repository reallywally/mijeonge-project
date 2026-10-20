import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { MINUTES_EXAMPLE } from '@/fixtures'
import { canDeleteComment, canEditComment } from '@/lib/access'
import { compareMinutes, minutesOutcome, type MinutesOutcome } from '@/lib/minutes'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { Minutes, MinutesInput, MinutesItem } from '@/types/domain'

const itemOf = (m: Minutes): MinutesItem => ({
  id: m.id,
  projectId: m.projectId,
  title: m.title,
  meetingDate: m.meetingDate,
  authorId: m.authorId,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
})

/**
 * 회의록 게시판 (docs/api/minutes.md). 목록은 고른 프로젝트의 것 전부를 받아 화면이 거른다.
 * 본문 · 요약은 목록에 없어 상세를 열 때 받는다(byId).
 * '나온 것' 은 따로 API 가 없다 — 데이터 스토어의 안건 · 이력 · 작업을 minutesId 로 거른다
 */
export const useMinutesStore = defineStore('minutes', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  const rows = ref<MinutesItem[]>([])
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 상세에서 받은 회의록 — 본문 · 요약까지 */
  const byId = ref<Record<string, Minutes>>({})
  let ticket = 0

  /** [예시 넣기] 의 글 — 시연용. 서버 모드에서도 그대로 쓴다 */
  const example = MINUTES_EXAMPLE

  const list = computed(() =>
    rowsProjectId.value !== null && rowsProjectId.value === data.currentProjectId ? rows.value : [],
  )
  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)

  /** 칩에 쓸 제목 — 목록에서, 없으면 받아 둔 상세에서. 모르면 null */
  const titleOf = (minutesId: string) =>
    rows.value.find((m) => m.id === minutesId)?.title ?? byId.value[minutesId]?.title ?? null

  /** 고치기는 작성자만 — 댓글과 같은 경계 */
  const canEdit = (m: MinutesItem) => canEditComment(auth.me, m)

  /** 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자 — 댓글과 같은 경계 */
  const canRemove = (m: MinutesItem) => canDeleteComment(auth.me, m, m.projectId)

  /** 이 회의록에서 나온 안건 · 이력 · 작업 — 지금 들고 있는 스냅샷에서 */
  const outcomeOf = (minutesId: string): MinutesOutcome =>
    minutesOutcome(minutesId, {
      threads: data.allThreads,
      entries: data.allEntries,
      tasks: data.allTasks,
    })

  /** 고른 프로젝트의 목록을 받는다. 늦게 온 옛 응답은 버린다 */
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
      const got = await api.fetchMinutesList(projectId)
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

  /** 칩이 제목을 찾을 수 있게 — 아직 안 받았으면 한 번 받는다 */
  function ensureLoaded() {
    if (!loaded.value && !loading.value) void load()
  }

  function upsertItem(m: Minutes) {
    if (rowsProjectId.value !== m.projectId) return
    const item = itemOf(m)
    const at = rows.value.findIndex((r) => r.id === m.id)
    if (at >= 0) rows.value[at] = item
    else rows.value.push(item)
    rows.value.sort(compareMinutes)
  }

  /** 상세를 받는다. 못 받으면 ApiError 를 그대로 던진다 — 화면이 404 와 그 밖을 가른다 */
  async function fetchOne(minutesId: string): Promise<Minutes> {
    const m = await api.fetchMinutes(minutesId)
    byId.value[m.id] = m
    upsertItem(m)
    return m
  }

  /** 쓴다 — 작성자는 로그인한 사람. 새 회의록 id, 실패하면 알리고 null */
  async function create(input: MinutesInput): Promise<string | null> {
    try {
      const m = await api.createMinutes(data.currentProjectId, input)
      byId.value[m.id] = m
      upsertItem(m)
      return m.id
    } catch (e) {
      toastError(e)
      return null
    }
  }

  /** 고친다 — 작성자만. 실패하면 알리고 false */
  async function update(minutesId: string, patch: Partial<MinutesInput>): Promise<boolean> {
    try {
      const m = await api.patchMinutes(minutesId, patch)
      byId.value[m.id] = m
      upsertItem(m)
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  /**
   * 지운다. 거기서 나온 안건 · 이력 · 작업은 남고 출처만 비운다 — 서버도 그렇게 하고(SET NULL),
   * 들고 있는 스냅샷도 같은 길로 맞춘다(목업 · 서버 같다)
   */
  async function remove(minutesId: string): Promise<boolean> {
    try {
      await api.deleteMinutes(minutesId)
    } catch (e) {
      toastError(e)
      return false
    }
    rows.value = rows.value.filter((m) => m.id !== minutesId)
    delete byId.value[minutesId]
    for (const records of [data.allThreads, data.allEntries, data.allTasks])
      for (const row of records) if (row.minutesId === minutesId) row.minutesId = null
    return true
  }

  /** [등록] 뒤 — 서버가 회의록 요약을 바꿨다. 고친 시각까지 맞추려고 다시 받되, 실패해도 알리지 않는다 */
  function afterApply(minutesId: string, summary: string | undefined) {
    const m = byId.value[minutesId]
    if (m && summary !== undefined) m.summary = summary.trim()
    fetchOne(minutesId).catch(() => {})
  }

  function clear() {
    ticket += 1
    rows.value = []
    rowsProjectId.value = null
    loading.value = false
    error.value = null
    byId.value = {}
  }

  return {
    example,
    list,
    loaded,
    loading,
    error,
    byId,
    titleOf,
    canEdit,
    canRemove,
    outcomeOf,
    load,
    ensureLoaded,
    fetchOne,
    create,
    update,
    remove,
    afterApply,
    clear,
  }
})

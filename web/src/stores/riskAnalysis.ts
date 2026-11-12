import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError, fieldDetail, messageOf } from '@/api'
import { canDeleteComment, canEditComment } from '@/lib/access'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { RiskAnalysis, RiskAnalysisListItem } from '@/types/domain'

/** 저장 · 제목 고치기의 결과 — 화면이 창 안에 띄울 한 줄(problem)까지 정해 준다 */
export type RiskAnalysisWrite =
  { ok: true; analysis: RiskAnalysis } | { ok: false; problem: string; alreadySaved?: boolean }

/** 404 는 '오래된 분석' — 저장은 24시간 안 · 내가 돌린 것만 된다 (docs/api/risk-analysis.md '화면') */
export const STALE_ANALYSIS_TEXT = '오래된 분석이라 저장할 수 없습니다. 다시 분석해 주세요.'

const itemOf = (a: RiskAnalysis): RiskAnalysisListItem => ({
  id: a.id,
  projectId: a.projectId,
  seq: a.seq,
  title: a.title,
  createdBy: a.createdBy,
  createdAt: a.createdAt,
  savedAt: a.savedAt,
  agendaCount: a.agendaCount,
  taskCount: a.taskCount,
  testCount: a.testCount,
  highCount: a.highCount,
})

/**
 * 저장한 AI 리스크 분석 — 리스크 화면의 '저장한 분석' 탭과 상세 (docs/api/risk-analysis.md).
 * 게시판은 고른 프로젝트 것을 50개씩 받고 [더 보기] 로 잇는다. 상세는 열 때 받는다(byId)
 */
export const useRiskAnalysisStore = defineStore('riskAnalysis', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  const rows = ref<RiskAnalysisListItem[]>([])
  const total = ref(0)
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const byId = ref<Record<string, RiskAnalysis>>({})
  let ticket = 0

  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)
  const list = computed(() => (loaded.value ? rows.value : []))
  const count = computed(() => (loaded.value ? total.value : 0))
  const hasMore = computed(() => loaded.value && rows.value.length < total.value)

  /** 제목 고치기는 작성자만 */
  const canRename = (a: Pick<RiskAnalysisListItem, 'createdBy'>) =>
    a.createdBy !== null && canEditComment(auth.me, { authorId: a.createdBy })
  /** 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자 — 회의록 · 댓글과 같은 경계 */
  const canRemove = (a: Pick<RiskAnalysisListItem, 'createdBy'>, projectId: string) =>
    canDeleteComment(auth.me, { authorId: a.createdBy ?? '' }, projectId)

  /** 첫 50개를 받는다. 늦게 온 옛 응답은 버린다 */
  async function load() {
    const projectId = data.currentProjectId
    const mine = ++ticket
    if (!projectId || !auth.me) {
      rows.value = []
      total.value = 0
      rowsProjectId.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const page = await api.fetchRiskAnalyses(projectId)
      if (mine !== ticket) return
      rows.value = page.items
      total.value = page.total
      rowsProjectId.value = projectId
    } catch (e) {
      if (mine !== ticket) return
      error.value = messageOf(e)
    } finally {
      if (mine === ticket) loading.value = false
    }
  }

  /** 다음 50개를 잇는다. 그사이 지워져 겹치는 줄은 한 번만 */
  async function loadMore() {
    const projectId = rowsProjectId.value
    if (!projectId || !hasMore.value || loadingMore.value) return
    const mine = ticket
    loadingMore.value = true
    try {
      const page = await api.fetchRiskAnalyses(projectId, rows.value.length)
      if (mine !== ticket) return
      const seen = new Set(rows.value.map((r) => r.id))
      rows.value = [...rows.value, ...page.items.filter((r) => !seen.has(r.id))]
      total.value = page.total
    } catch (e) {
      if (mine === ticket) toastError(e)
    } finally {
      loadingMore.value = false
    }
  }

  /** 상세를 받는다. 못 받으면 ApiError 를 그대로 던진다 — 화면이 404 와 그 밖을 가른다 */
  async function fetchOne(analysisId: string): Promise<RiskAnalysis> {
    const a = await api.fetchRiskAnalysis(analysisId)
    byId.value[a.id] = a
    return a
  }

  /** 임시 분석에 제목을 붙여 올린다. 404 는 오래된 분석, 409 는 이미 저장한 것 */
  async function save(analysisId: string, title: string): Promise<RiskAnalysisWrite> {
    const projectId = data.currentProjectId
    try {
      const a = await api.saveRiskAnalysis(projectId, { analysisId, title })
      byId.value[a.id] = a
      if (rowsProjectId.value === projectId) {
        rows.value = [itemOf(a), ...rows.value.filter((r) => r.id !== a.id)]
        total.value += 1
      }
      return { ok: true, analysis: a }
    } catch (e) {
      return { ok: false, ...writeProblem(e, STALE_ANALYSIS_TEXT) }
    }
  }

  /** 제목만 고친다 — 글 · 스냅샷은 기록이라 그대로 */
  async function rename(analysisId: string, title: string): Promise<RiskAnalysisWrite> {
    try {
      const a = await api.renameRiskAnalysis(analysisId, title)
      byId.value[a.id] = a
      rows.value = rows.value.map((r) => (r.id === a.id ? itemOf(a) : r))
      return { ok: true, analysis: a }
    } catch (e) {
      return { ok: false, ...writeProblem(e, '분석을 찾을 수 없습니다. 지워졌을 수 있습니다.') }
    }
  }

  async function remove(analysisId: string): Promise<boolean> {
    try {
      await api.deleteRiskAnalysis(analysisId)
    } catch (e) {
      toastError(e)
      return false
    }
    if (rows.value.some((r) => r.id === analysisId)) {
      rows.value = rows.value.filter((r) => r.id !== analysisId)
      total.value = Math.max(0, total.value - 1)
    }
    delete byId.value[analysisId]
    return true
  }

  function clear() {
    ticket += 1
    rows.value = []
    total.value = 0
    rowsProjectId.value = null
    loading.value = false
    loadingMore.value = false
    error.value = null
    byId.value = {}
  }

  return {
    list,
    count,
    loaded,
    loading,
    loadingMore,
    hasMore,
    error,
    byId,
    canRename,
    canRemove,
    load,
    loadMore,
    fetchOne,
    save,
    rename,
    remove,
    clear,
  }
})

function writeProblem(
  e: unknown,
  notFoundText: string,
): { problem: string; alreadySaved?: boolean } {
  if (e instanceof ApiError) {
    if (e.code === 'RISK_ANALYSIS_ALREADY_SAVED')
      return { problem: '이미 저장한 분석입니다.', alreadySaved: true }
    if (e.code === 'RISK_ANALYSIS_NOT_FOUND') return { problem: notFoundText }
    const title = fieldDetail(e.detail).title
    if (e.status === 422 && title) return { problem: title }
  }
  return { problem: messageOf(e) }
}

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { UNREACHABLE } from '@/api/client'
import { canDeleteComment } from '@/lib/access'
import { chatErrorText } from '@/lib/chat'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { ProgressFacts, Report, ReportItem } from '@/types/domain'

/** 만드는 중인 리포트 한 벌 — 저장은 서버가 done 에서 한다. 멈추거나 실패하면 남지 않는다 */
export interface ReportDraft {
  projectId: string
  facts: ProgressFacts | null
  text: string
  status: 'streaming' | 'done' | 'stopped' | 'error'
  /** status 가 error 일 때 띄울 한 줄 */
  error: string
}

/** 실패 한 줄 — 끊김은 '저장되지 않았다' 를 같이 말한다. 그 밖은 챗봇과 같은 문구(같은 Claude 호출 · 같은 코드) */
function reportErrorText(e: ApiError) {
  if (e.code === UNREACHABLE)
    return e.status === 200
      ? '리포트를 받다가 연결이 끊겼습니다. 저장되지 않았습니다.'
      : '서버에 연결할 수 없습니다. 잠시 뒤에 다시 만들어 주세요.'
  return chatErrorText(e)
}

const itemOf = (r: Report): ReportItem => ({
  id: r.id,
  projectId: r.projectId,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  doneRate: r.doneRate,
  attentionCount: r.attentionCount,
})

/**
 * 프로젝트 진행 리포트 (docs/api/report.md). 목록은 고른 프로젝트의 것을 받고, 상세는 열 때 받는다(byId).
 * 만들기는 스트림을 받아 그리다가 done 이 오면 저장된 리포트를 byId 에 넣는다 — 상세로 가면 다시 받지 않고 그린다
 */
export const useReportStore = defineStore('report', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  const rows = ref<ReportItem[]>([])
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const byId = ref<Record<string, Report>>({})
  let ticket = 0

  const list = computed(() =>
    rowsProjectId.value !== null && rowsProjectId.value === data.currentProjectId ? rows.value : [],
  )
  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)

  /** 지우기는 만든 사람 · 그 프로젝트 관리자 · 시스템 관리자 — 회의록 · 댓글과 같은 경계 */
  const canRemove = (r: ReportItem) =>
    canDeleteComment(auth.me, { authorId: r.createdBy }, r.projectId)

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
      const got = await api.fetchReports(projectId)
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

  /** 상세를 받는다. 못 받으면 ApiError 를 그대로 던진다 — 화면이 404 와 그 밖을 가른다 */
  async function fetchOne(reportId: string): Promise<Report> {
    const r = await api.fetchReport(reportId)
    byId.value[r.id] = r
    return r
  }

  async function remove(reportId: string): Promise<boolean> {
    try {
      await api.deleteReport(reportId)
    } catch (e) {
      toastError(e)
      return false
    }
    rows.value = rows.value.filter((r) => r.id !== reportId)
    delete byId.value[reportId]
    return true
  }

  /* ── 만들기 ── */
  const draft = ref<ReportDraft | null>(null)
  /* 지금 받는 요청. 멈추거나 버린 뒤 늦게 온 옛 조각이 새 것을 건드리지 않게 이것과 견준다 */
  let controller: AbortController | null = null
  const generating = computed(() => draft.value?.status === 'streaming')

  /** 리포트를 만든다. 저장되면 그 id, 멈춤 · 실패면 null */
  async function generate(): Promise<string | null> {
    const projectId = data.currentProjectId
    if (!projectId || generating.value) return null
    controller?.abort()
    const mine = new AbortController()
    controller = mine
    draft.value = { projectId, facts: null, text: '', status: 'streaming', error: '' }
    const target = draft.value

    try {
      for await (const event of api.streamCreateReport(projectId, mine.signal)) {
        if (controller !== mine) return null
        if (event.type === 'facts') target.facts = event.facts
        else if (event.type === 'delta') target.text += event.text
        else if (event.type === 'done') {
          target.status = 'done'
          if (!target.facts) return null
          const report: Report = { ...event.report, facts: target.facts, body: target.text }
          byId.value[report.id] = report
          if (rowsProjectId.value === projectId) rows.value = [itemOf(report), ...rows.value]
          return report.id
        }
      }
      return null
    } catch (e) {
      /* 멈춤 · 버림은 stop · reset 이 이미 정리했다 */
      if (controller !== mine) return null
      const err =
        e instanceof ApiError ? e : new ApiError(0, { code: 'UNKNOWN', message: messageOf(e) })
      target.status = 'error'
      target.error = reportErrorText(err)
      return null
    } finally {
      if (controller === mine) controller = null
    }
  }

  /** 받는 중이면 끊는다 — 저장되지 않는다. 받은 글은 화면에 남긴다 */
  function stop() {
    if (!controller) return
    controller.abort()
    controller = null
    if (draft.value?.status === 'streaming') draft.value.status = 'stopped'
  }

  /** 만들던 것을 버린다 — 받는 중이면 끊는다 */
  function resetDraft() {
    controller?.abort()
    controller = null
    draft.value = null
  }

  watch(() => data.currentProjectId, resetDraft)

  function clear() {
    ticket += 1
    rows.value = []
    rowsProjectId.value = null
    loading.value = false
    error.value = null
    byId.value = {}
    resetDraft()
  }

  return {
    list,
    loaded,
    loading,
    error,
    byId,
    canRemove,
    load,
    fetchOne,
    remove,
    draft,
    generating,
    generate,
    stop,
    resetDraft,
    clear,
  }
})

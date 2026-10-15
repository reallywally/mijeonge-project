import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { chatErrorText } from '@/lib/chat'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { DecisionRiskReport, RiskSettings, RiskSummaryInput } from '@/types/domain'

/** AI 요약 한 벌. 요약할 때 보낸 id 묶음을 같이 들고 있어야 목록이 바뀌었는지 안다 */
export interface RiskSummary extends RiskSummaryInput {
  /** 요약할 때 본 보고서의 기준일 */
  asOf: string
  text: string
  status: 'streaming' | 'done' | 'stopped' | 'error'
  /** status 가 error 일 때 띄울 한 줄 */
  error: string
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * 결정 병목 리스크 — 서버가 계산한 보고서를 받아 둔다 (docs/api/risk.md · Q35).
 * 받는 때는 화면에 들어올 때 · 기준을 바꾼 뒤 · [새로 고침] 뿐이다. 다른 쓰기 뒤에 따라 받지 않는다.
 */
export const useRiskStore = defineStore('risk', () => {
  const data = useDataStore()
  const partStore = usePartStore()

  const report = ref<DecisionRiskReport | null>(null)
  /** report 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 보고서를 그리지 않는다 */
  const reportProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let ticket = 0

  const current = computed(() =>
    report.value && reportProjectId.value === data.currentProjectId ? report.value : null,
  )

  /* [내 파트 | 전체] 를 작업 · 안건 화면과 같은 규칙으로 따른다. 사람별(owners)은 거르지 않는다 */
  const threads = computed(() =>
    (current.value?.threads ?? []).filter((t) => partStore.showsThread(t.threadId)),
  )
  const tasks = computed(() =>
    (current.value?.tasks ?? []).filter((t) => partStore.showsTask(t.taskId)),
  )
  const owners = computed(() => current.value?.owners ?? [])

  /** 고른 프로젝트의 보고서를 받는다. 늦게 온 옛 응답은 버린다 */
  async function load() {
    const projectId = data.currentProjectId
    const mine = ++ticket
    if (!projectId) {
      report.value = null
      reportProjectId.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const got = await api.fetchRisks(projectId)
      if (mine !== ticket) return
      report.value = got
      reportProjectId.value = projectId
    } catch (e) {
      if (mine !== ticket) return
      error.value = messageOf(e)
    } finally {
      if (mine === ticket) loading.value = false
    }
  }

  /**
   * 기준을 바꾸고 보고서를 다시 받는다. 422 면 칸별 까닭(detail)을 돌려준다 —
   * 대화 상자가 칸에 붙인다. 그 밖의 실패는 알리고 빈 detail 이다
   */
  async function saveSettings(
    settings: RiskSettings,
  ): Promise<{ ok: true } | { ok: false; detail: Record<string, string> }> {
    try {
      await api.putRiskSettings(data.currentProjectId, settings)
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.detail)
        return { ok: false, detail: e.detail }
      toastError(e)
      return { ok: false, detail: {} }
    }
    await load()
    return { ok: true }
  }

  /* AI 요약 — 사람이 누를 때만 부르고, 메모리에만 둔다. 화면을 떠나거나 프로젝트를 바꾸면 버린다 (risk.md 'AI 요약') */
  const summary = ref<RiskSummary | null>(null)
  /* 지금 받는 요청. 멈추거나 버린 뒤 늦게 온 옛 조각이 새 요약을 건드리지 않게 이것과 견준다 */
  let summaryController: AbortController | null = null

  /** 지금 화면에 보이는 줄 — '내 파트' 로 거른 결과 그대로. 이것을 보낸다 */
  const visibleIds = computed<RiskSummaryInput>(() => ({
    threadIds: threads.value.map((t) => t.threadId),
    taskIds: tasks.value.map((t) => t.taskId),
  }))
  const visibleCount = computed(
    () => visibleIds.value.threadIds.length + visibleIds.value.taskIds.length,
  )
  const summarizing = computed(() => summary.value?.status === 'streaming')
  /** 보이는 줄이 0건이거나 계약의 상한을 넘으면 부르지 않는다 */
  const tooManyToSummarize = computed(
    () =>
      visibleIds.value.threadIds.length > api.MAX_RISK_SUMMARY_IDS ||
      visibleIds.value.taskIds.length > api.MAX_RISK_SUMMARY_IDS,
  )
  const canSummarize = computed(
    () =>
      current.value !== null &&
      !summarizing.value &&
      visibleCount.value > 0 &&
      !tooManyToSummarize.value,
  )
  /** 요약할 때 보낸 줄과 지금 보이는 줄이 다르다 — 요약을 흐리게 하고 다시 요약을 권한다. 저절로 다시 부르지 않는다 */
  const summaryChanged = computed(() => {
    const s = summary.value
    if (!s) return false
    return (
      !sameIds(s.threadIds, visibleIds.value.threadIds) ||
      !sameIds(s.taskIds, visibleIds.value.taskIds)
    )
  })

  /** 지금 보이는 줄을 요약한다. 받은 데까지 그대로 그린다 */
  async function summarize(): Promise<boolean> {
    if (!canSummarize.value || !current.value) return false
    summaryController?.abort()
    const mine = new AbortController()
    summaryController = mine
    const input: RiskSummaryInput = {
      threadIds: [...visibleIds.value.threadIds],
      taskIds: [...visibleIds.value.taskIds],
    }
    summary.value = { ...input, asOf: current.value.asOf, text: '', status: 'streaming', error: '' }
    const target = summary.value

    try {
      for await (const event of api.streamRiskSummary(data.currentProjectId, input, mine.signal)) {
        if (summaryController !== mine) return false
        /* tool · proposal 은 계약상 오지 않는다. 와도 그리지 않는다 */
        if (event.type === 'delta') target.text += event.text
        else if (event.type === 'done') target.status = 'done'
      }
      return true
    } catch (e) {
      /* 멈춤 · 버림은 stopSummary · resetSummary 가 이미 정리했다 */
      if (summaryController !== mine) return false
      const err =
        e instanceof ApiError ? e : new ApiError(0, { code: 'UNKNOWN', message: messageOf(e) })
      target.status = 'error'
      target.error = chatErrorText(err)
      return false
    } finally {
      if (summaryController === mine) summaryController = null
    }
  }

  /** 받는 중인 요약을 멈춘다. 받은 데까지는 남긴다 */
  function stopSummary() {
    if (!summaryController) return
    summaryController.abort()
    summaryController = null
    if (summary.value?.status === 'streaming') summary.value.status = 'stopped'
  }

  /** 요약을 버린다 — 받는 중이면 끊는다 */
  function resetSummary() {
    summaryController?.abort()
    summaryController = null
    summary.value = null
  }

  watch(() => data.currentProjectId, resetSummary)

  function clear() {
    ticket += 1
    report.value = null
    reportProjectId.value = null
    loading.value = false
    error.value = null
    resetSummary()
  }

  return {
    report: current,
    loading,
    error,
    threads,
    tasks,
    owners,
    load,
    saveSettings,
    clear,
    summary,
    visibleIds,
    visibleCount,
    summarizing,
    canSummarize,
    tooManyToSummarize,
    summaryChanged,
    summarize,
    stopSummary,
    resetSummary,
  }
})

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { chatErrorText } from '@/lib/chat'
import {
  agendaRow,
  EMPTY_RISK_FILTER,
  filterRiskRows,
  mixRiskRows,
  riskCards,
  signalBars,
  taskRow,
  testRow,
  type RiskFilter,
  type RiskRow,
  type RiskSignal,
} from '@/lib/risk'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type {
  DecisionRiskReport,
  RiskKind,
  RiskLevel,
  RiskSettings,
  RiskSummaryInput,
} from '@/types/domain'

/** AI 요약 한 벌. 요약할 때 보낸 id 묶음을 같이 들고 있어야 목록이 바뀌었는지 안다 */
export interface RiskSummary extends RiskSummaryInput {
  /** 요약할 때 본 보고서의 기준일 */
  asOf: string
  text: string
  status: 'streaming' | 'done' | 'stopped' | 'error'
  /** status 가 error 일 때 띄울 한 줄 */
  error: string
  /** 저장할 수 있는 임시 분석 — done 에 실려 온다. Claude 를 안 불렀으면 없다 (docs/api/risk-analysis.md) */
  analysisId: string | null
  /** [저장] 해서 게시판에 오른 분석 — 같은 분석을 또 저장하지 않게 */
  savedId: string | null
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

const sameInput = (a: RiskSummaryInput, b: RiskSummaryInput) =>
  sameIds(a.agendaIds, b.agendaIds) &&
  sameIds(a.taskIds, b.taskIds) &&
  sameIds(a.testIds, b.testIds)

/**
 * 리스크 — 서버가 계산한 보고서(안건 · 작업 · 테스트)를 받아 둔다 (docs/api/risk.md · risk-dashboard.md · Q35).
 * 대시보드의 카드 · 막대 · 목록 거르기도 여기서 센다 — 보이는 줄이 곧 AI 리스크 분석에 보내는 줄이라서.
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

  /* [내 파트 | 전체] 는 세 종류에 같이 건다. 안건은 안건 화면과 같은 규칙, 작업 · 테스트는 파트 · 담당자만으로(조상으로 끌려 서는 것은 빼고).
     owners(사람별)는 화면에 안 그리지만 거르지 않고 둔다 */
  const agendas = computed(() =>
    (current.value?.agendas ?? []).filter((t) => partStore.showsAgenda(t.agendaId)),
  )
  const tasks = computed(() => (current.value?.tasks ?? []).filter((t) => partStore.showsOwned(t)))
  const tests = computed(() => (current.value?.tests ?? []).filter((t) => partStore.showsOwned(t)))
  const owners = computed(() => current.value?.owners ?? [])

  /** 세 종류를 섞은 줄 — 점수 순. 카드 · 막대는 이것으로 센다(목록 거르기와 따로) */
  const rows = computed<RiskRow[]>(() => {
    const asOf = current.value?.asOf ?? ''
    return mixRiskRows([
      agendas.value.map((a) => agendaRow(a, asOf)),
      tasks.value.map((t) => taskRow(t, asOf)),
      tests.value.map(testRow),
    ])
  })
  const cards = computed(() => riskCards(rows.value))
  const bars = computed(() => signalBars(rows.value))

  /* 목록 거르기 — 종류 · 등급(여럿) · 신호(여럿, 하나라도 걸리면). 프로젝트를 바꾸면 푼다 */
  const filter = ref<RiskFilter>({ ...EMPTY_RISK_FILTER })
  const filteredRows = computed(() => filterRiskRows(rows.value, filter.value))
  const filtered = computed(
    () =>
      filter.value.kind !== null ||
      filter.value.levels.length > 0 ||
      filter.value.signals.length > 0,
  )

  /** 같은 종류를 다시 고르면 전체로 */
  function setKind(kind: RiskKind | null) {
    filter.value = { ...filter.value, kind: filter.value.kind === kind ? null : kind }
  }
  function toggleLevel(level: RiskLevel) {
    const levels = filter.value.levels.includes(level)
      ? filter.value.levels.filter((l) => l !== level)
      : [...filter.value.levels, level]
    filter.value = { ...filter.value, levels }
  }
  /** 신호 묶음을 건다 — 이미 그 묶음 그대로 걸려 있으면 푼다(카드 · 막대를 다시 누르면 풀림) */
  function setSignals(signals: RiskSignal[]) {
    const now = filter.value.signals
    const same = now.length === signals.length && signals.every((s) => now.includes(s))
    filter.value = { ...filter.value, signals: same ? [] : [...signals] }
  }
  function removeSignal(signal: RiskSignal) {
    filter.value = { ...filter.value, signals: filter.value.signals.filter((s) => s !== signal) }
  }
  function clearFilter() {
    filter.value = { ...EMPTY_RISK_FILTER }
  }

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

  /** 지금 대시보드 목록에 보이는 줄 — '내 파트' · 목록 거르기를 지난 것(더 보기로 접힌 줄도 든다). 이것을 보낸다 */
  const visibleIds = computed<RiskSummaryInput>(() => {
    const of = (kind: RiskKind) =>
      filteredRows.value.filter((r) => r.kind === kind).map((r) => r.id)
    return { agendaIds: of('agenda'), taskIds: of('task'), testIds: of('test') }
  })
  const visibleCount = computed(
    () =>
      visibleIds.value.agendaIds.length +
      visibleIds.value.taskIds.length +
      visibleIds.value.testIds.length,
  )
  const summarizing = computed(() => summary.value?.status === 'streaming')
  /** 보이는 줄이 0건이거나 한 종류라도 계약의 상한을 넘으면 부르지 않는다 */
  const tooManyToSummarize = computed(() =>
    [visibleIds.value.agendaIds, visibleIds.value.taskIds, visibleIds.value.testIds].some(
      (ids) => ids.length > api.MAX_RISK_SUMMARY_IDS,
    ),
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
    return s ? !sameInput(s, visibleIds.value) : false
  })

  /** 지금 보이는 줄을 요약한다. 받은 데까지 그대로 그린다 */
  async function summarize(): Promise<boolean> {
    if (!canSummarize.value || !current.value) return false
    summaryController?.abort()
    const mine = new AbortController()
    summaryController = mine
    const input: RiskSummaryInput = {
      agendaIds: [...visibleIds.value.agendaIds],
      taskIds: [...visibleIds.value.taskIds],
      testIds: [...visibleIds.value.testIds],
    }
    summary.value = {
      ...input,
      asOf: current.value.asOf,
      text: '',
      status: 'streaming',
      error: '',
      analysisId: null,
      savedId: null,
    }
    const target = summary.value

    try {
      for await (const event of api.streamRiskSummary(data.currentProjectId, input, mine.signal)) {
        if (summaryController !== mine) return false
        /* tool · proposal 은 계약상 오지 않는다. 와도 그리지 않는다 */
        if (event.type === 'delta') target.text += event.text
        else if (event.type === 'done') {
          target.status = 'done'
          target.analysisId = event.analysisId ?? null
        }
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

  /** [저장] 이 끝났다 — 버튼을 '저장됨' 으로 바꾼다. 그사이 다시 분석했으면 새 분석은 건드리지 않는다 */
  function markSummarySaved(analysisId: string, savedId: string) {
    if (summary.value?.analysisId === analysisId) summary.value.savedId = savedId
  }

  /** 요약을 버린다 — 받는 중이면 끊는다 */
  function resetSummary() {
    summaryController?.abort()
    summaryController = null
    summary.value = null
  }

  watch(
    () => data.currentProjectId,
    () => {
      resetSummary()
      clearFilter()
    },
  )

  function clear() {
    ticket += 1
    report.value = null
    reportProjectId.value = null
    loading.value = false
    error.value = null
    resetSummary()
    clearFilter()
  }

  return {
    report: current,
    loading,
    error,
    agendas,
    tasks,
    tests,
    owners,
    rows,
    cards,
    bars,
    filter,
    filteredRows,
    filtered,
    setKind,
    toggleLevel,
    setSignals,
    removeSignal,
    clearFilter,
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
    markSummarySaved,
  }
})

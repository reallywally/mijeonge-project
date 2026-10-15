import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { DecisionRiskReport, RiskSettings } from '@/types/domain'

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

  function clear() {
    ticket += 1
    report.value = null
    reportProjectId.value = null
    loading.value = false
    error.value = null
  }

  return { report: current, loading, error, threads, tasks, owners, load, saveSettings, clear }
})

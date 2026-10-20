import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import * as api from '@/api'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import type { DependencySuggestion } from '@/types/domain'

export type SuggestionState = 'pending' | 'applying' | 'applied' | 'failed'

export interface SuggestionRow {
  suggestion: DependencySuggestion
  state: SuggestionState
  /** 적용이 거절된 까닭 — failed 일 때만 */
  error: string
}

/**
 * [AI 선행 관계 찾기] — 서버는 제안을 남기지 않는다. 받은 줄을 여기 들고 사람이 줄마다 [적용] · [버리기] 한다.
 * 창을 닫거나 프로젝트를 바꾸면 버린다 — 다른 프로젝트의 제안이 섞이면 안 된다
 */
export const useDependencySuggestStore = defineStore('dependencySuggest', () => {
  const data = useDataStore()
  const taskStore = useTaskStore()

  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const rows = ref<SuggestionRow[]>([])
  const truncated = ref(false)
  const error = ref('')
  /* 받는 중에 닫았다 다시 열면 앞의 응답은 늦게 와도 버린다 */
  let ticket = 0

  /** 아직 [적용] 할 수 있는 줄 */
  const openRows = computed(() => rows.value.filter((r) => r.state !== 'applied'))

  async function load() {
    ticket += 1
    const mine = ticket
    const projectId = data.currentProjectId
    status.value = 'loading'
    rows.value = []
    truncated.value = false
    error.value = ''
    try {
      const res = await api.suggestDependencies(projectId)
      if (mine !== ticket) return
      /* 스냅샷에 없는 작업을 가리키는 줄은 그릴 수 없다 — 버린다 */
      const known = new Set(taskStore.tasks.map((t) => t.id))
      rows.value = res.suggestions
        .filter((s) => known.has(s.taskId) && known.has(s.dependsOnId))
        .map((suggestion) => ({ suggestion, state: 'pending', error: '' }))
      truncated.value = res.truncated
      status.value = 'ready'
    } catch (e) {
      if (mine !== ticket) return
      error.value = api.messageOf(e)
      status.value = 'error'
    }
  }

  async function apply(row: SuggestionRow) {
    if (row.state === 'applying' || row.state === 'applied') return
    row.state = 'applying'
    row.error = ''
    const { taskId, dependsOnId } = row.suggestion
    const failure = await taskStore.addDependency(taskId, dependsOnId, { quiet: true })
    row.state = failure ? 'failed' : 'applied'
    row.error = failure ?? ''
  }

  /** 하나씩 차례로 — 앞의 줄을 건 결과로 뒤의 줄이 순환이 될 수 있어 서버에 순서대로 맡긴다 */
  async function applyAll() {
    for (const row of [...rows.value]) {
      if (row.state === 'pending' || row.state === 'failed') await apply(row)
    }
  }

  function discard(row: SuggestionRow) {
    rows.value = rows.value.filter((r) => r !== row)
  }

  function reset() {
    ticket += 1
    status.value = 'idle'
    rows.value = []
    truncated.value = false
    error.value = ''
  }

  watch(() => data.currentProjectId, reset)

  return { status, rows, openRows, truncated, error, load, apply, applyAll, discard, reset }
})

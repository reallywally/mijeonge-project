import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import type { HistoryKind } from '@/lib/history'
import { useDataStore } from '@/stores/data'
import type { HistoryEntry } from '@/types/domain'

export type HistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const keyOf = (kind: HistoryKind, id: string) => `${kind}:${id}`

/**
 * 작업 · 테스트의 변경 이력 (docs/api/history.md). 스냅샷 · 테스트 목록에 없어 상세의 [변경 이력] 을 펼칠 때 받는다.
 * 쓰기 응답에는 이력이 안 실린다 — 작업 · 테스트 스토어가 쓰기를 마칠 때 touched 로 알리면
 * 펼쳐 둔 이력 칸이 revision 을 보고 다시 부른다
 */
export const useHistoryStore = defineStore('history', () => {
  const data = useDataStore()
  const entries = ref<Record<string, HistoryEntry[]>>({})
  const status = ref<Record<string, HistoryLoadStatus>>({})
  const loadError = ref<Record<string, string>>({})
  /** 쓰기가 끝날 때마다 는다 */
  const revision = ref<Record<string, number>>({})

  const entriesOf = (kind: HistoryKind, id: string) => entries.value[keyOf(kind, id)] ?? []
  const statusOf = (kind: HistoryKind, id: string): HistoryLoadStatus =>
    status.value[keyOf(kind, id)] ?? 'idle'
  const errorOf = (kind: HistoryKind, id: string) => loadError.value[keyOf(kind, id)] ?? ''
  const revisionOf = (kind: HistoryKind, id: string) => revision.value[keyOf(kind, id)] ?? 0

  /* 빨리 거푸 부르면 늦게 온 옛 목록이 새 목록을 덮지 않게 마지막 요청만 받는다 */
  const latest = new Map<string, number>()
  let ticket = 0

  async function load(kind: HistoryKind, id: string) {
    const key = keyOf(kind, id)
    ticket += 1
    const mine = ticket
    latest.set(key, mine)
    status.value[key] = 'loading'
    try {
      const rows = await (kind === 'task' ? api.fetchTaskHistory(id) : api.fetchTestHistory(id))
      if (latest.get(key) !== mine) return
      entries.value[key] = rows
      status.value[key] = 'ready'
      delete loadError.value[key]
    } catch (e) {
      if (latest.get(key) !== mine) return
      status.value[key] = 'error'
      loadError.value[key] = messageOf(e)
    }
  }

  /** 그 작업 · 테스트에 쓰기가 끝났다 — 실패한 쓰기여도 알린다(다시 받아 보는 것이 싸다) */
  function touched(kind: HistoryKind, id: string) {
    const key = keyOf(kind, id)
    revision.value[key] = (revision.value[key] ?? 0) + 1
  }

  function clear() {
    entries.value = {}
    status.value = {}
    loadError.value = {}
    latest.clear()
  }

  /* 다른 프로젝트의 이력을 들고 있을 까닭이 없다 */
  watch(() => data.currentProjectId, clear)

  return { entriesOf, statusOf, errorOf, revisionOf, load, touched, clear }
})

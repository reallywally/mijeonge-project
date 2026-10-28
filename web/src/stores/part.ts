import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { gradeOf } from '@/lib/access'
import { toastError } from '@/lib/notify'
import { defaultPartScope, partChoices, sortParts, visibleInMyParts } from '@/lib/part'
import type { PartScope, PartScopeResult } from '@/lib/part'
import { recall, remember } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { Part } from '@/types/domain'

/**
 * 파트 — 보기 범위지 권한이 아니다 (docs/api/part.md). 레코드는 data 스토어가 들고,
 * 여기는 고른 프로젝트의 파트 · 나의 소속 · [내 파트 | 전체] 전환 · 파트 관리를 맡는다.
 * 무엇이 보이는지는 lib/part 의 visibleInMyParts 한 곳이 정한다.
 */
export const usePartStore = defineStore('part', () => {
  const data = useDataStore()
  const auth = useAuthStore()

  /** 고른 프로젝트의 파트 — 이름 순, 보관 포함 */
  const parts = computed<Part[]>(() =>
    sortParts(data.parts.filter((p) => p.projectId === data.currentProjectId)),
  )
  const activeParts = computed(() => parts.value.filter((p) => p.active))

  const byId = computed<Record<string, Part>>(() =>
    Object.fromEntries(parts.value.map((p) => [p.id, p])),
  )

  const partName = (partId: string | null) => (partId ? (byId.value[partId]?.name ?? null) : null)

  /** 그 사람이 속한 이 프로젝트의 파트 */
  function partIdsOf(memberId: string | null): Set<string> {
    if (!memberId) return new Set()
    return new Set(
      data.partMembers
        .filter((pm) => pm.memberId === memberId && byId.value[pm.partId] !== undefined)
        .map((pm) => pm.partId),
    )
  }

  const membersOf = (partId: string) =>
    data.partMembers.filter((pm) => pm.partId === partId).map((pm) => pm.memberId)

  /** 내가 속한 파트 — 보관한 파트도 센다(그 파트의 옛 작업은 계속 보인다) */
  const myPartIds = computed(() => partIdsOf(data.currentMemberId))

  /** 전환을 보일지 — 내가 속한 파트가 하나도 없으면 숨기고 전체를 보인다 */
  const canNarrow = computed(() => myPartIds.value.size > 0)

  /* 고른 값은 프로젝트마다 브라우저에 기억한다. 같은 브라우저를 다른 사람이 쓸 수 있어 사람도 키에 넣는다 */
  const storageKey = computed(
    () => `innoflow.partScope.${data.currentMemberId ?? ''}.${data.currentProjectId}`,
  )
  const chosen = ref<Record<string, PartScope>>({})

  function rememberedScope(key: string): PartScope | null {
    const value = chosen.value[key] ?? recall(key)
    return value === 'mine' || value === 'all' ? value : null
  }

  /** 지금 보이는 범위. 처음은 일반 사용자 = 내 파트, 프로젝트 관리자 · 시스템 관리자 = 전체 */
  const scope = computed<PartScope>(() => {
    if (!canNarrow.value) return 'all'
    return (
      rememberedScope(storageKey.value) ?? defaultPartScope(gradeOf(auth.me, data.currentProjectId))
    )
  })

  function setScope(next: PartScope) {
    chosen.value = { ...chosen.value, [storageKey.value]: next }
    remember(storageKey.value, next)
  }

  /** '내 파트' 일 때 보이는 것. 전체면 null — 거르지 않는다 */
  const visible = computed<PartScopeResult | null>(() => {
    if (scope.value === 'all') return null
    const projectId = data.currentProjectId
    return visibleInMyParts({
      tasks: data.allTasks.filter((t) => t.projectId === projectId),
      threads: data.allThreads.filter((t) => t.projectId === projectId),
      links: data.taskThreads,
      memberId: data.currentMemberId,
      myPartIds: myPartIds.value,
    })
  })

  const showsTask = (taskId: string) => visible.value?.taskIds.has(taskId) ?? true
  const showsThread = (threadId: string) => visible.value?.threadIds.has(threadId) ?? true
  /** 보이는 작업의 조상이라 선 것 — 흐리게 그린다 */
  const isContextTask = (taskId: string) => visible.value?.contextTaskIds.has(taskId) ?? false

  /** 작업 · 안건에 고를 수 있는 파트 — 활성 파트 + 지금 달린 파트(보관이어도) */
  const choicesFor = (current: string | null) => partChoices(parts.value, current)

  /**
   * 하위 작업을 만들 때 골라 둘 파트 — 상위 작업의 것. 보관한 파트는 새로 달 수 없어(400 PART_ARCHIVED)
   * 공통으로 둔다. 화면은 이 값을 늘 실어 보내 서버의 상속에 기대지 않는다 (API.md Q32)
   */
  function partForChildOf(parentId: string | null): string | null {
    const partId = data.allTasks.find((t) => t.id === parentId)?.partId ?? null
    return partId && byId.value[partId]?.active ? partId : null
  }

  /* 파트 관리 — 프로젝트 관리자 · 시스템 관리자. 응답을 기다렸다가 넣는다. 실패하면 알리고 false */

  function putPart(part: Part) {
    const at = data.parts.findIndex((p) => p.id === part.id)
    if (at >= 0) data.parts[at] = part
    else data.parts.push(part)
  }

  async function run(fn: () => Promise<void>) {
    try {
      await fn()
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  const createPart = (name: string) =>
    run(async () => {
      const projectId = data.currentProjectId
      const part = await api.createPart(projectId, { name: name.trim() })
      if (data.holdsRecordsOf(projectId)) putPart(part)
    })

  const renamePart = (partId: string, name: string) =>
    run(async () => putPart(await api.patchPart(partId, { name: name.trim() })))

  /** 보관(false) · 되살리기(true). 지우는 길은 없다 */
  const setPartActive = (partId: string, active: boolean) =>
    run(async () => putPart(await api.patchPart(partId, { active })))

  const joinPart = (partId: string, memberId: string) =>
    run(async () => {
      const made = await api.putPartMember(partId, memberId)
      const has = data.partMembers.some(
        (pm) => pm.partId === made.partId && pm.memberId === made.memberId,
      )
      if (!has) data.partMembers.push(made)
    })

  const leavePart = (partId: string, memberId: string) =>
    run(async () => {
      await api.deletePartMember(partId, memberId)
      data.partMembers = data.partMembers.filter(
        (pm) => !(pm.partId === partId && pm.memberId === memberId),
      )
    })

  function clear() {
    chosen.value = {}
  }

  return {
    clear,
    parts,
    activeParts,
    partName,
    partIdsOf,
    membersOf,
    myPartIds,
    canNarrow,
    scope,
    setScope,
    visible,
    showsTask,
    showsThread,
    isContextTask,
    choicesFor,
    partForChildOf,
    createPart,
    renamePart,
    setPartActive,
    joinPart,
    leavePart,
  }
})

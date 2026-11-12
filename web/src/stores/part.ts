import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { toastError } from '@/lib/notify'
import { canCreateInPart, canMoveToPart } from '@/lib/access'
import { ownsOrSharesPart, partChoices, sortParts, visibleInMyParts } from '@/lib/part'
import type { PartPickArea, PartScope, PartScopeResult } from '@/lib/part'
import { recall, remember } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { Part, PartMember, PartRights } from '@/types/domain'

/**
 * 파트 — 보기는 열려 있고, 소속마다 붙은 권한이 작업 · 테스트 쓰기를 가른다 (docs/api/part.md).
 * 레코드는 data 스토어가 들고, 여기는 고른 프로젝트의 파트 · 나의 소속 · 볼 파트 고르기(비우면 전체) · 파트 관리를 맡는다.
 * 무엇이 보이는지는 lib/part 의 visibleInMyParts, 무엇을 쓸 수 있는지는 lib/access 가 정한다.
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

  /** 그 사람이 속한 이 프로젝트의 파트 — 권한과 상관없이 소속만 */
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

  /** 그 사람의 그 파트 소속 — 권한 칸을 그린다. 소속이 아니면 null */
  const membershipOf = (partId: string, memberId: string) =>
    data.partMembers.find((pm) => pm.partId === partId && pm.memberId === memberId) ?? null

  /** 내 파트 — 보기 권한이 있는 소속. 보관한 파트도 센다(그 파트의 옛 작업은 계속 보인다) */
  const myPartIds = computed(() => {
    const me = data.currentMemberId
    return new Set(
      data.partMembers
        .filter((pm) => pm.memberId === me && pm.canView && byId.value[pm.partId] !== undefined)
        .map((pm) => pm.partId),
    )
  })

  /** 파트 고르기를 보일지 — 내 파트가 하나도 없으면 숨기고 전체를 보인다 */
  const canNarrow = computed(() => myPartIds.value.size > 0)

  /* 볼 파트 — 담당자 고르기처럼 내 파트 중 여럿을 고르고, 비우면 전체다. 메뉴 묶음(area)마다 따로 기억한다 —
     업무(작업 세 탭 · 테스트 · 리스크)는 내 파트 전부로, 안건 · 문서는 전체로 시작한다 (2026-11-12).
     고른 값은 프로젝트마다 브라우저에 기억한다. 같은 브라우저를 다른 사람이 쓸 수 있어 사람도 키에 넣는다 */
  const pickKeyOf = (area: PartPickArea) =>
    `innoflow.partPick.${area === 'work' ? '' : `${area}.`}${data.currentMemberId ?? ''}.${data.currentProjectId}`
  /* 2026-11-11 전의 [내 파트 | 전체] 값 — 업무 쪽만, 새 값이 없을 때 읽어 옮긴다 */
  const legacyKey = computed(
    () => `innoflow.partScope.${data.currentMemberId ?? ''}.${data.currentProjectId}`,
  )
  const picks = ref<Record<string, string[]>>({})

  function rememberedPick(key: string): string[] | null {
    if (picks.value[key]) return picks.value[key]
    const raw = recall(key)
    if (raw === null) return null
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null
    } catch {
      return null
    }
  }

  function legacyPick(): string[] | null {
    const value = recall(legacyKey.value)
    if (value === 'all') return []
    if (value === 'mine') return [...myPartIds.value]
    return null
  }

  /**
   * 고른 파트 — 고른 순서, 늘 내 파트 안. 비면 전체다.
   * 처음은 업무 = 내 파트 전부, 안건 · 문서 = 전체. 고른 파트에서 다 빠졌으면(소속이 바뀜) 내 파트 전부로 돌아간다
   */
  function pickOf(area: PartPickArea): string[] {
    const mine = myPartIds.value
    if (mine.size === 0) return []
    const raw =
      rememberedPick(pickKeyOf(area)) ?? (area === 'work' ? (legacyPick() ?? [...mine]) : [])
    const kept = raw.filter((id) => mine.has(id))
    return raw.length > 0 && kept.length === 0 ? [...mine] : kept
  }
  const picked = {
    work: computed(() => pickOf('work')),
    agenda: computed(() => pickOf('agenda')),
    document: computed(() => pickOf('document')),
  }
  const pickedIdsOf = (area: PartPickArea) => picked[area].value
  const pickedSets = {
    work: computed(() => new Set(picked.work.value)),
    agenda: computed(() => new Set(picked.agenda.value)),
    document: computed(() => new Set(picked.document.value)),
  }
  const pickedSetOf = (area: PartPickArea) => pickedSets[area].value

  /** 지금 보이는 범위 — 고른 파트가 있으면 'mine' */
  const scopeOf = (area: PartPickArea): PartScope =>
    picked[area].value.length > 0 ? 'mine' : 'all'

  /* 업무 쪽 — 작업 · 테스트 · 리스크가 이것을 본다 */
  const pickedIds = computed(() => picked.work.value)
  const pickedPartIds = computed(() => pickedSets.work.value)
  const scope = computed(() => scopeOf('work'))

  /** 볼 파트를 고른다. 비우면 전체 */
  function setPicked(partIds: Iterable<string>, area: PartPickArea = 'work') {
    const key = pickKeyOf(area)
    const next = [...new Set(partIds)].filter((id) => myPartIds.value.has(id))
    picks.value = { ...picks.value, [key]: next }
    remember(key, JSON.stringify(next))
  }

  /** 하나 넣고 빼기 — 넣을 때는 맨 뒤로(버튼의 '인프라 외 1' 은 먼저 고른 파트가 앞에 선다) */
  function togglePicked(partId: string, area: PartPickArea = 'work') {
    const ids = pickedIdsOf(area)
    setPicked(ids.includes(partId) ? ids.filter((id) => id !== partId) : [...ids, partId], area)
  }

  /** 내 파트 전부(mine) 또는 전체(all) */
  function setScope(next: PartScope, area: PartPickArea = 'work') {
    setPicked(next === 'mine' ? myPartIds.value : [], area)
  }

  function visibleFor(area: PartPickArea): PartScopeResult | null {
    if (scopeOf(area) === 'all') return null
    const projectId = data.currentProjectId
    return visibleInMyParts({
      tasks: data.allTasks.filter((t) => t.projectId === projectId),
      agendas: data.allAgendas.filter((t) => t.projectId === projectId),
      links: data.taskAgendas,
      memberId: data.currentMemberId,
      myPartIds: pickedSetOf(area),
    })
  }
  const visibleBy = {
    work: computed(() => visibleFor('work')),
    agenda: computed(() => visibleFor('agenda')),
  }

  /** 고른 파트일 때 보이는 것. 전체면 null — 거르지 않는다. 문서는 담당 · 계층이 없어 partIn 으로 본다 */
  const visibleIn = (area: Exclude<PartPickArea, 'document'>) => visibleBy[area].value
  /** 파트만으로 가린다 — 공통이거나 고른 파트. 전체면 다 보인다(문서 목록) */
  const showsPartIn = (partId: string | null, area: PartPickArea) =>
    scopeOf(area) === 'all' || partId === null || pickedSetOf(area).has(partId)
  const visible = computed(() => visibleBy.work.value)

  const showsTask = (taskId: string) => visible.value?.taskIds.has(taskId) ?? true
  const showsAgenda = (agendaId: string, area: Exclude<PartPickArea, 'document'>) =>
    visibleIn(area)?.agendaIds.has(agendaId) ?? true
  /** 파트 · 담당자만으로 가린다 — 조상으로 끌려 서는 것은 세지 않는다. 리스크 줄처럼 계층 없이 놓는 것이 쓴다 */
  const showsOwned = (r: { partId: string | null; ownerId: string | null }) =>
    scope.value === 'all' || ownsOrSharesPart(r, data.currentMemberId, pickedPartIds.value)
  /** 보이는 작업의 조상이라 선 것 — 흐리게 그린다 */
  const isContextTask = (taskId: string) => visible.value?.contextTaskIds.has(taskId) ?? false

  /** 그 파트에 작업 · 테스트를 새로 둘 수 있나 — 공통은 누구나, 관리자는 어디든 */
  const canCreateIn = (partId: string | null) =>
    canCreateInPart(auth.me, partId, data.currentProjectId, data.partMembers)
  /** 작업 · 테스트를 그 파트로 옮길 수 있나 — 공통으로는 누구나 */
  const canMoveTo = (partId: string | null) =>
    canMoveToPart(auth.me, partId, data.currentProjectId, data.partMembers)

  /**
   * 고를 수 있는 파트 — 활성 파트 + 지금 달린 파트(보관이어도). 안건은 다 고른다(right 없음).
   * 작업 · 테스트는 새로 만들 때 등록 권한(canCreate), 고칠 때 수정 권한(canUpdate)이 있는 파트만 — 관리자는 다
   */
  function choicesFor(current: string | null, right?: 'canCreate' | 'canUpdate') {
    const all = partChoices(parts.value, current)
    if (!right) return all
    const may = right === 'canCreate' ? canCreateIn : canMoveTo
    return all.filter((p) => p.id === current || may(p.id))
  }

  /**
   * 하위 작업 · 테스트를 만들 때 골라 둘 파트 — 상위의 것. 보관한 파트는 새로 달 수 없고(400 PART_ARCHIVED)
   * 등록 권한이 없는 파트에는 못 만들어(403) 공통으로 둔다. 화면은 이 값을 늘 실어 보내 서버의 상속에 기대지 않는다 (API.md Q32)
   */
  function partForChild(parentPartId: string | null): string | null {
    return parentPartId && byId.value[parentPartId]?.active && canCreateIn(parentPartId)
      ? parentPartId
      : null
  }
  const partForChildOf = (parentId: string | null) =>
    partForChild(data.allTasks.find((t) => t.id === parentId)?.partId ?? null)

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

  function putMembership(row: PartMember) {
    const at = data.partMembers.findIndex(
      (pm) => pm.partId === row.partId && pm.memberId === row.memberId,
    )
    if (at >= 0) data.partMembers[at] = row
    else data.partMembers.push(row)
  }

  /** 넣기 — 권한은 서버의 기본값(보기 · 등록 · 수정)으로 선다. 이미 있으면 그대로다 */
  const joinPart = (partId: string, memberId: string) =>
    run(async () => putMembership(await api.putPartMember(partId, memberId)))

  /** 권한 바꾸기 — 넷 다 실어 보낸다. 서버가 맞춘 소속으로 갈아끼운다 */
  const setPartRights = (partId: string, memberId: string, rights: PartRights) =>
    run(async () => putMembership(await api.putPartMember(partId, memberId, { ...rights })))

  const leavePart = (partId: string, memberId: string) =>
    run(async () => {
      await api.deletePartMember(partId, memberId)
      data.partMembers = data.partMembers.filter(
        (pm) => !(pm.partId === partId && pm.memberId === memberId),
      )
    })

  function clear() {
    picks.value = {}
  }

  return {
    clear,
    parts,
    activeParts,
    partName,
    partIdsOf,
    membersOf,
    membershipOf,
    myPartIds,
    canNarrow,
    scope,
    scopeOf,
    setScope,
    pickedIds,
    pickedIdsOf,
    pickedPartIds,
    pickedSetOf,
    setPicked,
    togglePicked,
    visible,
    visibleIn,
    showsTask,
    showsAgenda,
    showsOwned,
    showsPartIn,
    isContextTask,
    canCreateIn,
    canMoveTo,
    choicesFor,
    partForChild,
    partForChildOf,
    createPart,
    renamePart,
    setPartActive,
    joinPart,
    setPartRights,
    leavePart,
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { messageOf } from '@/api'
import { canDeleteComment } from '@/lib/access'
import { toastError } from '@/lib/notify'
import { visibleInMyParts } from '@/lib/part'
import { mergeSignals, sortAttention, testPeriodLabel, worstStatus } from '@/lib/testcase'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { usePartStore } from '@/stores/part'
import type {
  TestCase,
  TestInput,
  TestPatch,
  TestRef,
  TestRow,
  TestSignal,
  TestStatus,
  TestStatusInput,
} from '@/types/domain'

/** 태그 칩 한 개 — 작업은 번호, 안건은 제목. 그사이 지워졌거나 못 보는 것은 missing */
export interface TestRefChip {
  ref: TestRef
  /** 칩에 크게 적는 말 — 작업 번호(HW-21) 또는 안건 제목 */
  label: string
  /** 가리키면 보일 말 — 작업 제목 */
  title: string
  missing: boolean
}

/** '지금' 의 숫자 카드 — 누르면 그 테스트만 거른다 */
export type TestNowKey = 'testing' | 'longRunning' | 'overdue' | 'blocked' | 'fail' | 'basisChanged'

export const TEST_NOW_CARDS: { key: TestNowKey; label: string }[] = [
  { key: 'testing', label: '테스트 중' },
  { key: 'longRunning', label: '오래 걸림' },
  { key: 'overdue', label: '기간 지남' },
  { key: 'blocked', label: '막힘' },
  { key: 'fail', label: '실패' },
  { key: 'basisChanged', label: '기준 바뀜' },
]

/** 그 카드에 드는 줄인가 — 상태 카드는 상태로, 신호 카드는 신호로 본다 */
export function matchesNowCard(row: Pick<TestRow, 'status' | 'signals'>, key: TestNowKey) {
  if (key === 'testing' || key === 'blocked' || key === 'fail') return row.status === key
  return row.signals.includes(key as TestSignal)
}

/**
 * 테스트 (docs/api/test.md) — 작업과 따로 둔다. 고른 프로젝트의 테스트 전부를 한 번에 받고
 * '지금' · 목록 · 간트 · 작업 / 안건 상세의 칩이 같이 쓴다.
 * 며칠째 · 신호는 서버가 센 것을 그대로 쓰고, 묶음의 상태 · 신호와 '지금' 의 숫자 · 정렬만 여기서 센다.
 * [내 파트 | 전체] 는 작업과 같은 규칙(lib/part)으로 거른다
 */
export const useTestStore = defineStore('test', () => {
  const data = useDataStore()
  const auth = useAuthStore()
  const partStore = usePartStore()
  const history = useHistoryStore()

  const rows = ref<TestCase[]>([])
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let ticket = 0

  const tests = computed<TestCase[]>(() =>
    rowsProjectId.value !== null && rowsProjectId.value === data.currentProjectId ? rows.value : [],
  )
  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)

  const byId = computed<Record<string, TestCase>>(() =>
    Object.fromEntries(tests.value.map((t) => [t.id, t])),
  )

  const childrenOf = computed<Record<string, TestCase[]>>(() => {
    const out: Record<string, TestCase[]> = {}
    for (const t of tests.value) if (t.parentId) (out[t.parentId] ??= []).push(t)
    return out
  })

  const isGroup = (testId: string) => (childrenOf.value[testId]?.length ?? 0) > 0

  /** 묶음의 상태 · 신호 — 하위가 묶음이면 그 묶음이 모은 것을 쓴다. 고리가 있어도 멈추게 본 것을 센다 */
  const rolled = computed(() => {
    const status: Record<string, TestStatus> = {}
    const signals: Record<string, TestSignal[]> = {}
    const visit = (t: TestCase, seen: Set<string>) => {
      if (status[t.id]) return
      const kids = (childrenOf.value[t.id] ?? []).filter((k) => !seen.has(k.id))
      if (kids.length === 0) {
        status[t.id] = t.status
        signals[t.id] = t.signals
        return
      }
      const next = new Set(seen).add(t.id)
      for (const k of kids) visit(k, next)
      status[t.id] = worstStatus(kids.map((k) => status[k.id])) ?? t.status
      signals[t.id] = mergeSignals(kids.map((k) => signals[k.id]))
    }
    for (const t of tests.value) visit(t, new Set([t.id]))
    return { status, signals }
  })

  function ancestorTitles(t: TestCase) {
    const names: string[] = []
    const seen = new Set([t.id])
    let parent = t.parentId ? byId.value[t.parentId] : undefined
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      names.unshift(parent.title)
      parent = parent.parentId ? byId.value[parent.parentId] : undefined
    }
    return names
  }

  /** 로그인 시나리오 · 하위 3건 — 최상위면 '최상위 테스트' */
  function pathLabel(t: TestCase) {
    const names = ancestorTitles(t)
    const base = names.length === 0 ? '최상위 테스트' : names.join(' › ')
    const kids = childrenOf.value[t.id]?.length ?? 0
    return kids > 0 ? `${base} · 하위 ${kids}건` : base
  }

  const fullPath = (t: TestCase) => [...ancestorTitles(t), t.title].join(' › ')

  function toRow(t: TestCase): TestRow {
    return {
      test: t,
      isGroup: isGroup(t.id),
      status: rolled.value.status[t.id] ?? t.status,
      signals: rolled.value.signals[t.id] ?? t.signals,
      ownerName: data.memberName(t.ownerId),
      pathLabel: pathLabel(t),
      periodLabel: testPeriodLabel(t),
      childCount: childrenOf.value[t.id]?.length ?? 0,
    }
  }

  const allRows = computed<TestRow[]>(() => tests.value.map(toRow))

  /* [내 파트 | 전체] — 작업과 같은 규칙. 보이는 테스트의 조상은 서 있어 간트 트리가 끊기지 않는다 */
  const scoped = computed(() => {
    if (partStore.scope === 'all') return null
    return visibleInMyParts({
      tasks: tests.value,
      threads: [],
      links: [],
      memberId: data.currentMemberId,
      myPartIds: partStore.myPartIds,
    })
  })

  const shows = (testId: string) => scoped.value?.taskIds.has(testId) ?? true
  /** '내 파트' 에서 길을 잇느라 선 조상 — 흐리게 그린다 */
  const isContext = (testId: string) => scoped.value?.contextTaskIds.has(testId) ?? false

  /** [내 파트 | 전체] 로 거른 줄 — 목록 · 간트 · '지금' 이 쓴다. 상세는 거르지 않는다 */
  const visibleRows = computed<TestRow[]>(() =>
    scoped.value ? allRows.value.filter((r) => shows(r.test.id)) : allRows.value,
  )

  /* '지금' 은 돌리는 테스트(묶음이 아닌 것)만 센다 — 묶음까지 세면 같은 테스트가 두 번 든다.
     길을 잇느라 선 조상은 내 일이 아니라 뺀다 */
  const leafRows = computed(() =>
    visibleRows.value.filter((r) => !r.isGroup && !isContext(r.test.id)),
  )

  const nowCounts = computed<Record<TestNowKey, number>>(() => {
    const out = {} as Record<TestNowKey, number>
    for (const c of TEST_NOW_CARDS)
      out[c.key] = leafRows.value.filter((r) => matchesNowCard(r, c.key)).length
    return out
  })

  /** 지금 테스트 중 — 오래된 것부터 */
  const testingNow = computed(() =>
    leafRows.value
      .filter((r) => r.status === 'testing')
      .map((row, i) => ({ row, i }))
      .sort((a, b) => b.row.test.statusDays - a.row.test.statusDays || a.i - b.i)
      .map((x) => x.row),
  )

  /** 손쓸 테스트 — 신호가 붙은 것. 기간 지남 · 오래 막힘 · 오래 걸림 순, 같으면 N일째가 긴 것부터 */
  const attention = computed(() =>
    sortAttention(
      leafRows.value
        .filter((r) => r.signals.length > 0)
        .map((row) => ({ row, signals: row.signals, statusDays: row.test.statusDays })),
    ).map((x) => x.row),
  )

  /** 아래에 작게 적는 전체 숫자 — 테스트 수 · 상태별 · 태그 없는 테스트 */
  const totals = computed(() => {
    const byStatus = {} as Record<TestStatus, number>
    for (const s of ['draft', 'ready', 'testing', 'pass', 'fail', 'blocked'] as TestStatus[])
      byStatus[s] = leafRows.value.filter((r) => r.status === s).length
    return {
      all: leafRows.value.length,
      byStatus,
      untagged: leafRows.value.filter((r) => r.test.refs.length === 0).length,
    }
  })

  /** 그 작업 · 안건을 태그한 테스트 — 따로 부르지 않고 목록에서 거른다 (계약) */
  const testsTagging = (kind: TestRef['kind'], refId: string): TestRow[] =>
    allRows.value.filter((r) => r.test.refs.some((x) => x.kind === kind && x.id === refId))

  function refChip(ref: TestRef): TestRefChip {
    if (ref.kind === 'task') {
      const task = data.allTasks.find((t) => t.id === ref.id)
      return task
        ? { ref, label: task.key, title: task.title, missing: false }
        : { ref, label: '지워진 작업', title: '', missing: true }
    }
    const thread = data.allThreads.find((t) => t.id === ref.id)
    return thread
      ? { ref, label: thread.title, title: thread.title, missing: false }
      : { ref, label: '지워진 안건', title: '', missing: true }
  }

  /** 자기와 자기 아래 — 상위로 고르면 고리가 된다 */
  function selfAndDescendants(testId: string): Set<string> {
    const ids = new Set([testId])
    let grew = true
    while (grew) {
      grew = false
      for (const t of tests.value)
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id)
          grew = true
        }
    }
    return ids
  }

  /** 상위 테스트로 고를 수 있는 것. 새로 만들 때(null)는 전부 */
  function parentChoicesFor(testId: string | null) {
    const blocked = testId ? selfAndDescendants(testId) : new Set<string>()
    return tests.value
      .filter((t) => !blocked.has(t.id))
      .map((t) => ({ id: t.id, key: t.key, label: fullPath(t) }))
  }

  /** 지우기는 만든 사람 · 그 프로젝트 관리자 · 시스템 관리자 — 회의록 · 리포트와 같은 경계 */
  const canRemove = (t: TestCase) =>
    canDeleteComment(auth.me, { authorId: t.createdBy ?? '' }, t.projectId)

  /** 고른 프로젝트의 테스트를 받는다. 늦게 온 옛 응답은 버린다 */
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
      const got = await api.fetchTests(projectId)
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

  /** 아직 이 프로젝트의 것을 안 받았으면 받는다 — 작업 · 안건 상세의 칩이 쓴다 */
  function ensure() {
    if (!loaded.value && !loading.value) void load()
  }

  /** 받은 한 줄로 바꿔 끼운다. 그사이 프로젝트를 바꿨으면 지금 목록에 섞지 않는다 */
  function put(t: TestCase) {
    if (rowsProjectId.value !== t.projectId) return
    const at = rows.value.findIndex((x) => x.id === t.id)
    if (at >= 0) rows.value[at] = t
    else rows.value.push(t)
  }

  /** 만든다 — id · 번호를 서버가 내므로 응답을 기다렸다가 넣는다. 실패하면 알리고 null */
  async function create(input: TestInput): Promise<string | null> {
    const projectId = data.currentProjectId
    try {
      const made = await api.createTest(projectId, input)
      put(made)
      return made.id
    } catch (e) {
      toastError(e)
      return null
    }
  }

  /* 같은 테스트에 고치기가 겹치면 마지막에 보낸 것의 응답만 반영한다 — 늦게 온 옛 응답이 새 값을 덮지 않게 */
  const latest = new Map<string, number>()
  let saveTicket = 0

  /**
   * 고친다 — 화면에 먼저 넣고 보낸다(간트에서 끈 막대가 튀지 않게). 실패하면 알리고 목록을 다시 받아 되돌린다.
   * 반영했으면 true
   */
  async function patch(testId: string, next: TestPatch): Promise<boolean> {
    const t = byId.value[testId]
    if (!t) return false
    Object.assign(t, next)
    saveTicket += 1
    const mine = saveTicket
    latest.set(testId, mine)
    try {
      const res = await api.patchTest(testId, next)
      if (latest.get(testId) === mine) put(res)
      return true
    } catch (e) {
      toastError(e)
      void load()
      return false
    } finally {
      history.touched('test', testId)
    }
  }

  /** 간트에서 끌어 놓은 기간 — 한쪽만 아는 기간은 기간 미정과 구분이 안 되니 둘 다 있을 때만 기간으로 친다 */
  function setPeriod(testId: string, start: string | null, due: string | null) {
    const both = start !== null && due !== null
    return patch(testId, { start: both ? start : null, due: both ? due : null })
  }

  /** 응답을 기다리는 쓰기 — 상태 · 태그 · 기준. 실패하면 알리고 false. 끝나면 이력 칸에 알린다 */
  async function run(testId: string, fn: () => Promise<TestCase | void>): Promise<boolean> {
    try {
      const res = await fn()
      if (res) put(res)
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      history.touched('test', testId)
    }
  }

  const setStatus = (testId: string, input: TestStatusInput) =>
    run(testId, () => api.setTestStatus(testId, input))

  const addRef = (testId: string, ref: TestRef) => run(testId, () => api.putTestRef(testId, ref))

  /** 떼기는 204 라 다시 받는다 — 기준(basis)이 새로 찍혀 신호가 바뀔 수 있다 */
  const removeRef = (testId: string, ref: TestRef) =>
    run(testId, async () => {
      await api.deleteTestRef(testId, ref)
      return api.fetchTest(testId)
    })

  const confirmBasis = (testId: string) => run(testId, () => api.confirmTestBasis(testId))

  async function remove(testId: string): Promise<boolean> {
    try {
      await api.deleteTest(testId)
    } catch (e) {
      toastError(e)
      return false
    }
    rows.value = rows.value.filter((t) => t.id !== testId)
    /* 지운 테스트의 부모가 묶음에서 풀리면 서버가 신호를 새로 센다 */
    void load()
    return true
  }

  function clear() {
    ticket += 1
    rows.value = []
    rowsProjectId.value = null
    loading.value = false
    error.value = null
    latest.clear()
  }

  return {
    tests,
    loaded,
    loading,
    error,
    byId,
    childrenOf,
    isGroup,
    allRows,
    visibleRows,
    isContext,
    nowCounts,
    testingNow,
    attention,
    totals,
    pathLabel,
    toRow,
    testsTagging,
    refChip,
    parentChoicesFor,
    canRemove,
    load,
    ensure,
    create,
    patch,
    setPeriod,
    setStatus,
    addRef,
    removeRef,
    confirmBasis,
    remove,
    clear,
  }
})

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import {
  applyErrorsByKey,
  bareLines,
  impactKey,
  inReview,
  linkOnly,
  taskProposalProblems,
  taskUnchanged,
  testUnchanged,
  UNCHANGED_TEXT,
  type ImpactKind,
} from '@/lib/impact'
import { toastError } from '@/lib/notify'
import { testFieldProblems } from '@/lib/testcase'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { useTaskStore } from '@/stores/task'
import { useTestStore } from '@/stores/test'
import type {
  AgendaImpact,
  AgendaImpactState,
  ImpactApplyInput,
  ImpactBodyLine,
  ImpactTask,
  ImpactTest,
} from '@/types/domain'

/** 줄 하나의 처지 — 반영함 · 찾을 수 없음 · 분석 뒤 바뀜 · 권한 없음 · 고를 수 있음 */
export type ImpactRowStatus = 'applied' | 'missing' | 'changed' | 'locked' | 'open'

/** 분석 하나의 검토 — 회의록 검토처럼 고름 · 지우기 · 고친 안을 화면 메모리에 둔다 */
export interface ImpactReview {
  /** 줄 열쇠(impactKey) → 고름. 기본은 update 줄을 다 켬 */
  picked: Record<string, boolean>
  /** 연결 안 된 줄(검색으로 찾은 것) → '이 안건에 연결'. 기본 켬. 연결만 하는 check 줄은 이것이 곧 고름이다 */
  link: Record<string, boolean>
  /** 지운 줄 — 지운 순서대로(되돌리기는 마지막 것부터) */
  removed: string[]
  /** 고친 안 — update 줄에 Claude 가 낸 칸만 든다 */
  tasks: Record<string, { title?: string; body?: ImpactBodyLine[] }>
  tests: Record<string, { title?: string; content?: string; testData?: string }>
  /** [고치기] 를 펼친 줄 */
  editing: Record<string, boolean>
  /** 409 IMPACT_TARGET_CHANGED 가 짚은 줄 */
  changed: string[]
  /** 403 이 짚은 줄 */
  denied: string[]
  /** 422 가 짚은 줄 → 한 줄 */
  errors: Record<string, string>
  /** 409 IMPACT_STALE 를 받았다 — 결과를 흐리고 다시 분석을 권한다 */
  stale: boolean
}

const EMPTY_COUNTS = { taskCount: 0, testCount: 0, decidedAgendaCount: 0 }
const LINK_ON_LINKED = '이미 이 안건에 연결된 줄입니다 — 연결은 연결 안 된 줄에서만 합니다.'

/**
 * AI 영향도 분석 (docs/api/impact.md) — 안건마다 칸 상태(가장 최근 분석 + 세는 것), 분석 스트림, 검토 · 반영.
 * 분석은 서버가 남기므로 다시 열면 GET 으로 되살아나고, 검토의 고름 · 고친 안만 여기 메모리에 둔다.
 * 프로젝트를 바꾸면 받는 중인 것을 끊고 비운다
 */
export const useImpactStore = defineStore('impact', () => {
  const data = useDataStore()
  const taskStore = useTaskStore()
  const testStore = useTestStore()
  const history = useHistoryStore()

  /** 안건 id → 칸 상태 */
  const states = ref<Record<string, AgendaImpactState>>({})
  const loading = ref<Record<string, boolean>>({})
  const loadErrors = ref<Record<string, string>>({})
  /** 지금 분석 중인 안건과 진행 한 줄 — 한 번에 하나 */
  const running = ref<{ agendaId: string; tool: string } | null>(null)
  /** 분석이 실패한 까닭 — 안건 id → 한 줄 */
  const runErrors = ref<Record<string, string>>({})
  /** 분석 id → 검토 */
  const reviews = ref<Record<string, ImpactReview>>({})
  /** 반영 중인 분석 */
  const applying = ref<string | null>(null)

  let controller: AbortController | null = null
  const tickets = new Map<string, number>()
  let ticket = 0

  function ensureReview(impact: AgendaImpact): ImpactReview {
    const have = reviews.value[impact.id]
    if (have) return have
    const review: ImpactReview = {
      picked: {},
      link: {},
      removed: [],
      tasks: {},
      tests: {},
      editing: {},
      changed: [],
      denied: [],
      errors: {},
      stale: false,
    }
    for (const t of impact.tasks) {
      if (!inReview(t)) continue
      if (!t.linked) review.link[impactKey('task', t.taskId)] = t.appliedAt === null
      if (t.verdict !== 'update') continue
      review.picked[impactKey('task', t.taskId)] = t.appliedAt === null
      review.tasks[t.taskId] = {
        ...(t.title !== undefined ? { title: t.title } : {}),
        ...(t.body !== undefined ? { body: structuredClone(t.body) } : {}),
      }
    }
    for (const t of impact.tests) {
      if (!inReview(t)) continue
      if (!t.linked) review.link[impactKey('test', t.testId)] = t.appliedAt === null
      if (t.verdict !== 'update') continue
      review.picked[impactKey('test', t.testId)] = t.appliedAt === null
      review.tests[t.testId] = {
        ...(t.title !== undefined ? { title: t.title } : {}),
        ...(t.content !== undefined ? { content: t.content } : {}),
        ...(t.testData !== undefined ? { testData: t.testData } : {}),
      }
    }
    reviews.value[impact.id] = review
    return reviews.value[impact.id]
  }

  function setLatest(agendaId: string, impact: AgendaImpact) {
    states.value[agendaId] = { ...EMPTY_COUNTS, ...states.value[agendaId], latest: impact }
    ensureReview(impact)
  }

  /** 칸을 그릴 것을 받는다 — 칸을 열 때 · 결정 판이 오를 때. 늦게 온 옛 응답은 버린다 */
  async function load(agendaId: string) {
    ticket += 1
    const mine = ticket
    tickets.set(agendaId, mine)
    loading.value[agendaId] = true
    try {
      const got = await api.fetchAgendaImpact(agendaId)
      if (tickets.get(agendaId) !== mine) return
      states.value[agendaId] = got
      delete loadErrors.value[agendaId]
      if (got.latest) ensureReview(got.latest)
    } catch (e) {
      if (tickets.get(agendaId) !== mine) return
      loadErrors.value[agendaId] = messageOf(e)
    } finally {
      if (tickets.get(agendaId) === mine) loading.value[agendaId] = false
    }
  }

  const isRunning = (agendaId: string) => running.value?.agendaId === agendaId

  /** 분석 — 진행 줄을 띄우다 결과 하나를 받으면 그 안건의 가장 최근 분석으로. 받았으면 true */
  async function run(agendaId: string): Promise<boolean> {
    if (isRunning(agendaId)) return false
    controller?.abort()
    const mine = new AbortController()
    controller = mine
    running.value = { agendaId, tool: '' }
    delete runErrors.value[agendaId]
    let received: AgendaImpact | null = null
    try {
      for await (const event of api.streamAgendaImpact(agendaId, mine.signal)) {
        if (controller !== mine) return false
        /* 같은 진행 줄이 잇달아 와도 한 줄 그대로 둔다(찾기 · 읽기는 여러 번 온다) */
        if (event.type === 'tool') {
          if (running.value.tool !== event.label) running.value.tool = event.label
        } else if (event.type === 'impact') received = event.impact
        else if (event.type === 'done' && received) setLatest(agendaId, received)
      }
      return received !== null
    } catch (e) {
      /* 멈춤 · 비움은 stop · reset 이 이미 정리했다 */
      if (controller !== mine || api.isAbort(e)) return false
      runErrors.value[agendaId] = messageOf(e)
      return false
    } finally {
      if (controller === mine) {
        controller = null
        running.value = null
      }
    }
  }

  /** 분석을 멈춘다 — 서버도 끝까지 받지 못하면 남기지 않는다. 안건을 주면 그 안건의 것일 때만 */
  function stop(agendaId?: string) {
    if (!controller || (agendaId !== undefined && !isRunning(agendaId))) return
    controller.abort()
    controller = null
    running.value = null
  }

  /* ── 검토 ─────────────────────────────────────────── */

  const reviewOf = (impact: AgendaImpact) => ensureReview(impact)

  /** 지금 결정 판과 다르거나 반영이 IMPACT_STALE 로 걸렸다 — 결과 전체를 흐리고 반영을 끈다 */
  function isStale(impact: AgendaImpact) {
    const agenda = data.allAgendas.find((t) => t.id === impact.agendaId)
    return (
      (agenda !== undefined && agenda.decisionRev !== impact.decisionRev) ||
      !!reviews.value[impact.id]?.stale
    )
  }

  function rowStatus(impact: AgendaImpact, kind: ImpactKind, id: string): ImpactRowStatus {
    const review = reviewOf(impact)
    const key = impactKey(kind, id)
    if (kind === 'task') {
      const row = impact.tasks.find((t) => t.taskId === id)
      if (row?.appliedAt) return 'applied'
      const task = data.allTasks.find((t) => t.id === id)
      if (!task) return 'missing'
      if (review.changed.includes(key)) return 'changed'
      /* 작업 상세가 칸을 잠그는 것과 같은 판단 */
      if (!taskStore.canEdit(task) || review.denied.includes(key)) return 'locked'
      return 'open'
    }
    const row = impact.tests.find((t) => t.testId === id)
    if (row?.appliedAt) return 'applied'
    if (testStore.loaded && !testStore.byId[id]) return 'missing'
    if (review.changed.includes(key)) return 'changed'
    /* 테스트는 그 프로젝트 멤버 누구나 고친다 — 서버가 막았을 때만 잠근다 */
    if (review.denied.includes(key)) return 'locked'
    return 'open'
  }

  const isRemoved = (impact: AgendaImpact, key: string) => reviewOf(impact).removed.includes(key)

  const rowOf = (
    impact: AgendaImpact,
    kind: ImpactKind,
    id: string,
  ): ImpactTask | ImpactTest | null =>
    (kind === 'task'
      ? impact.tasks.find((t) => t.taskId === id)
      : impact.tests.find((t) => t.testId === id)) ?? null

  /**
   * 반영에 들어가나 — 검토 묶음의 줄이고 · 켰고 · 고를 수 있고 · 지우지 않았다.
   * 연결만 하는 check 줄은 '이 안건에 연결' 을 켠 것이 고름이다
   */
  function isPicked(impact: AgendaImpact, kind: ImpactKind, id: string) {
    const row = rowOf(impact, kind, id)
    if (!row || !inReview(row)) return false
    const key = impactKey(kind, id)
    const review = reviewOf(impact)
    const on = linkOnly(row) ? !!review.link[key] : !!review.picked[key]
    return on && !review.removed.includes(key) && rowStatus(impact, kind, id) === 'open'
  }

  /** 반영 때 이 안건에 연결하나 — 연결 안 된 줄을 골랐고 연결을 켰다 */
  function isLinking(impact: AgendaImpact, kind: ImpactKind, id: string) {
    const row = rowOf(impact, kind, id)
    return (
      !!row &&
      !row.linked &&
      !!reviewOf(impact).link[impactKey(kind, id)] &&
      isPicked(impact, kind, id)
    )
  }

  function setPicked(impact: AgendaImpact, key: string, on: boolean) {
    reviewOf(impact).picked[key] = on
  }

  function setLink(impact: AgendaImpact, key: string, on: boolean) {
    reviewOf(impact).link[key] = on
  }

  /** 줄을 끈다 — 409 · 403 이 짚은 줄. 연결만 하는 줄은 연결도 끈다 */
  function unpick(review: ImpactReview, key: string) {
    review.picked[key] = false
    if (key in review.link) review.link[key] = false
  }

  /** 줄을 검토에서 지운다 — 숨기고 반영에서 빠진다(회의록 검토와 같은 규칙) */
  function removeRow(impact: AgendaImpact, key: string) {
    const review = reviewOf(impact)
    if (review.removed.includes(key)) return
    review.picked[key] = false
    review.editing[key] = false
    review.removed.push(key)
  }

  /** 마지막으로 지운 줄을 되살린다 — 다시 켠 채로 */
  function undoRemove(impact: AgendaImpact) {
    const review = reviewOf(impact)
    const key = review.removed.pop()
    if (!key) return
    review.picked[key] = true
    if (key in review.link) review.link[key] = true
  }

  function toggleEdit(impact: AgendaImpact, key: string) {
    const review = reviewOf(impact)
    review.editing[key] = !review.editing[key]
  }

  const pickedTasks = (impact: AgendaImpact) =>
    impact.tasks.filter((t) => isPicked(impact, 'task', t.taskId))
  const pickedTests = (impact: AgendaImpact) =>
    impact.tests.filter((t) => isPicked(impact, 'test', t.testId))

  const pickedCount = (impact: AgendaImpact) =>
    pickedTasks(impact).length + pickedTests(impact).length

  /**
   * 켠 줄 중 고쳐야 보낼 수 있는 것 — 줄 열쇠 → 한 줄. 서버도 같은 것을 422 로 거절한다.
   * 연결만 하는 줄은 고칠 칸 없이 된다. 이미 걸린 줄에는 연결을 보내지 않는다
   */
  function problems(impact: AgendaImpact): Record<string, string> {
    const review = reviewOf(impact)
    const out: Record<string, string> = {}
    for (const t of [...pickedTasks(impact), ...pickedTests(impact)]) {
      const key = 'taskId' in t ? impactKey('task', t.taskId) : impactKey('test', t.testId)
      if (t.linked && review.link[key]) out[key] = LINK_ON_LINKED
    }
    for (const t of pickedTasks(impact)) {
      if (linkOnly(t) || out[impactKey('task', t.taskId)]) continue
      const form = review.tasks[t.taskId] ?? {}
      const first = Object.values(taskProposalProblems(form))[0]
      if (first) out[impactKey('task', t.taskId)] = first
      else if (taskUnchanged(form, t.before)) out[impactKey('task', t.taskId)] = UNCHANGED_TEXT
    }
    for (const t of pickedTests(impact)) {
      if (linkOnly(t) || out[impactKey('test', t.testId)]) continue
      const form = review.tests[t.testId] ?? {}
      const first = Object.values(testFieldProblems(form))[0]
      if (first) out[impactKey('test', t.testId)] = first
      else if (testUnchanged(form, t.before)) out[impactKey('test', t.testId)] = UNCHANGED_TEXT
    }
    return out
  }

  /** 보낼 모양 — 고른 줄만, 고친 안의 칸 그대로(분석 순서). 연결만 하는 줄은 link 하나, 고칠 칸은 없다 */
  function applyInput(impact: AgendaImpact): ImpactApplyInput {
    const review = reviewOf(impact)
    const link = (kind: ImpactKind, id: string) =>
      isLinking(impact, kind, id) ? { link: true } : {}
    return {
      tasks: pickedTasks(impact).map((t) => {
        if (linkOnly(t)) return { taskId: t.taskId, link: true }
        const form = review.tasks[t.taskId] ?? {}
        return {
          taskId: t.taskId,
          ...(form.title !== undefined ? { title: form.title } : {}),
          ...(form.body !== undefined ? { body: bareLines(form.body) } : {}),
          ...link('task', t.taskId),
        }
      }),
      tests: pickedTests(impact).map((t) =>
        linkOnly(t)
          ? { testId: t.testId, link: true }
          : { testId: t.testId, ...review.tests[t.testId], ...link('test', t.testId) },
      ),
    }
  }

  const canApply = (impact: AgendaImpact) =>
    applying.value === null &&
    !isStale(impact) &&
    pickedCount(impact) > 0 &&
    Object.keys(problems(impact)).length === 0

  /**
   * 고른 줄을 반영 — 바뀐 작업 · 테스트를 스토어에 넣고, appliedAt 이 찍힌 분석으로 갈아끼운다.
   * 409 IMPACT_STALE 는 결과를 흐리고, IMPACT_TARGET_CHANGED 는 걸린 줄을 끄고 표시한다(나머지는 다시 반영할 수 있다)
   */
  async function apply(impact: AgendaImpact): Promise<boolean> {
    if (!canApply(impact)) return false
    const input = applyInput(impact)
    const review = reviewOf(impact)
    const projectId = impact.projectId
    applying.value = impact.id
    review.errors = {}
    try {
      const res = await api.applyAgendaImpact(impact.id, input)
      /* 그사이 프로젝트를 바꿨으면 지금 레코드에 섞지 않는다 — 돌아가면 스냅샷에 있다 */
      if (data.holdsRecordsOf(projectId)) {
        for (const next of res.tasks) {
          const at = data.allTasks.findIndex((t) => t.id === next.id)
          if (at >= 0) data.allTasks[at] = next
        }
        /* 새로 건 링크 — 다음 분석부터 연결 작업으로 본다. 이미 있으면 그대로 */
        for (const l of res.links)
          if (!data.taskAgendas.some((x) => x.taskId === l.taskId && x.agendaId === l.agendaId))
            data.taskAgendas.push({ taskId: l.taskId, agendaId: l.agendaId })
      }
      for (const t of res.tests) testStore.put(t)
      for (const t of res.tasks) history.touched('task', t.id)
      for (const t of res.tests) history.touched('test', t.id)
      const state = states.value[impact.agendaId]
      if (state?.latest?.id === res.impact.id) state.latest = res.impact
      for (const key of Object.keys(review.editing)) review.editing[key] = false
      return true
    } catch (e) {
      if (!(e instanceof ApiError)) {
        toastError(e)
        return false
      }
      const keys = applyErrorsByKey(e.detail, input)
      if (e.code === 'IMPACT_STALE') review.stale = true
      else if (e.code === 'IMPACT_TARGET_CHANGED') {
        for (const key of Object.keys(keys)) {
          if (!review.changed.includes(key)) review.changed.push(key)
          unpick(review, key)
        }
      } else if (e.code === 'FORBIDDEN' && Object.keys(keys).length > 0) {
        for (const key of Object.keys(keys)) {
          if (!review.denied.includes(key)) review.denied.push(key)
          unpick(review, key)
        }
      } else {
        review.errors = keys
        toastError(e)
      }
      return false
    } finally {
      applying.value = null
    }
  }

  /** 처음으로 — 프로젝트를 바꿀 때 · 로그아웃 */
  function reset() {
    controller?.abort()
    controller = null
    running.value = null
    states.value = {}
    loading.value = {}
    loadErrors.value = {}
    runErrors.value = {}
    reviews.value = {}
    applying.value = null
    tickets.clear()
  }

  /* 분석의 작업 · 테스트 · 안건은 그 프로젝트의 것이다 */
  watch(() => data.currentProjectId, reset)

  return {
    states,
    loading,
    loadErrors,
    running,
    runErrors,
    reviews,
    applying,
    load,
    isRunning,
    run,
    stop,
    reviewOf,
    isStale,
    rowStatus,
    isRemoved,
    isPicked,
    isLinking,
    setPicked,
    setLink,
    removeRow,
    undoRemove,
    toggleEdit,
    pickedCount,
    problems,
    applyInput,
    canApply,
    apply,
    reset,
  }
})

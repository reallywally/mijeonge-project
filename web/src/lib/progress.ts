import { kstToday, localDay, monthDay } from '@/lib/date'
import type {
  Entry,
  PersonProgress,
  ProgressFacts,
  RiskSettings,
  Task,
  TaskAttention,
  TaskAttentionSignal,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

/* 프로젝트 진행 리포트의 규칙 계산 — 서버 services/progress.py 와 같은 규칙(docs/api/report.md '규칙이 세는 것').
   목업 api 가 이것으로 facts 를 만든다. 화면은 저장된 facts 를 그대로 그리고 다시 계산하지 않는다 */

/** 리포트 기간의 날 수 — 만든 날을 끝으로 */
export const REPORT_PERIOD_DAYS = 7
/** attention 에 싣는 작업 수 */
export const ATTENTION_LIMIT = 30

/** 새 리포트가 내는 신호 — 선행 작업 둘은 2026-10-28 걷어(Q63) 지난 리포트에만 있다 */
type LiveSignal = Exclude<TaskAttentionSignal, 'waitingOnPredecessor' | 'lateBlocker'>

export const ATTENTION_SCORE: Record<LiveSignal, number> = {
  decidedButBlocked: 3,
  overdue: 2,
  longRunning: 2,
  longBlocked: 2,
  notStarted: 1,
}

/** 신호의 화면 말 — 계약 '화면'. 선행 둘은 지난 리포트를 그대로 보여 주려고 남겨 둔다 */
export const ATTENTION_SIGNAL_LABEL: Record<TaskAttentionSignal, string> = {
  waitingOnPredecessor: '선행 대기',
  lateBlocker: '뒤 작업을 막는 중',
  longRunning: '오래 걸림',
  longBlocked: '오래 막힘',
  overdue: '기한 지남',
  notStarted: '시작 안 함',
  decidedButBlocked: '풀어도 됨',
}

/** signals 의 순서 — 타입 선언 순서 그대로. 같은 데이터면 같은 배열이 나오게 */
const SIGNAL_ORDER: LiveSignal[] = [
  'longRunning',
  'longBlocked',
  'overdue',
  'notStarted',
  'decidedButBlocked',
]

const DAY_MS = 86_400_000
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** b - a 의 날 수. 둘 다 YYYY-MM-DD 거나 ISO(Z) — ISO 는 한국 시간 날짜로 바꿔 뺀다 */
export const daysBetween = (a: string, b: string) =>
  Math.round((dayMs(localDay(b)) - dayMs(localDay(a))) / DAY_MS)

export const addDays = (day: string, n: number) =>
  new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10)

/** 만드는 날(KST)을 끝으로 7일 */
export function reportPeriod(today: string = kstToday()) {
  return { periodStart: addDays(today, -(REPORT_PERIOD_DAYS - 1)), periodEnd: today }
}

/** '지난 7일 · 10월 14일 ~ 10월 20일' */
export function reportPeriodLabel(today: string = kstToday()) {
  const { periodStart, periodEnd } = reportPeriod(today)
  return `지난 ${REPORT_PERIOD_DAYS}일 · ${monthDay(periodStart)} ~ ${monthDay(periodEnd)}`
}

/** 목록의 기간 칸 — '10월 14일 ~ 10월 20일' */
export const periodLabel = (r: { periodStart: string; periodEnd: string }) =>
  `${monthDay(r.periodStart)} ~ ${monthDay(r.periodEnd)}`

/** 0.14 → '14%'. 반올림은 계산이 이미 했다 */
export const rateLabel = (rate: number) => `${Math.round(rate * 100)}%`

/** done / 전체 — 소수 셋째 자리에서 반올림(둘째 자리까지, 반은 올림). 100 을 먼저 곱해 1/8 같은 반이 0.1249… 로 새지 않게 */
export const roundRate = (done: number, total: number) =>
  total === 0 ? 0 : Math.round((done * 100) / total) / 100

/** 상태 며칠째 — '12일째' · backfill 이면 '12일 이상' · 0 이면 '오늘부터' (작업 상세와 같은 말) */
export function statusSpan(a: Pick<TaskAttention, 'statusDays' | 'statusSinceBackfill'>) {
  if (a.statusDays === 0) return '오늘부터'
  return a.statusSinceBackfill ? `${a.statusDays}일 이상` : `${a.statusDays}일째`
}

export interface ProgressInput {
  /** 그 프로젝트의 작업 — 배열 순서가 등록 순서다 */
  tasks: Task[]
  /** 그 프로젝트의 안건 — 배열 순서가 등록 순서다 */
  threads: Thread[]
  entries: Entry[]
  links: TaskThreadLink[]
  settings: RiskSettings
  /** 만드는 날 — KST YYYY-MM-DD */
  today: string
  previous: ProgressFacts['previous']
  /** 리스크 계산(DecisionRiskReport.threads)의 high · medium — 점수 순. 10개로 자르는 것은 여기서 한다 */
  riskyThreadIds: string[]
}

/** 막힘인데 걸린 안건이 있고 전부 결정됨 — risk.md 의 decidedButBlocked 와 같은 판정 */
export function isDecidedButBlocked(task: Task, linked: Thread[]) {
  return (
    task.status === 'blocked' && linked.length > 0 && linked.every((t) => t.state === 'decided')
  )
}

/** 지난 7일의 진행 — 같은 데이터 · 같은 날이면 늘 같은 facts */
export function progressFacts(input: ProgressInput): ProgressFacts {
  const { tasks, threads, entries, links, settings, today } = input
  const { periodStart, periodEnd } = reportPeriod(today)
  const inPeriod = (iso: string) => {
    const day = localDay(iso)
    return day >= periodStart && day <= periodEnd
  }

  const byId = new Map(tasks.map((t) => [t.id, t]))
  const seq = new Map(tasks.map((t, i) => [t.id, i]))
  const bySeq = (a: string, b: string) => (seq.get(a) ?? 0) - (seq.get(b) ?? 0)
  const threadById = new Map(threads.map((t) => [t.id, t]))

  const linkedThreads = new Map<string, Thread[]>()
  for (const l of links) {
    const th = threadById.get(l.threadId)
    if (!th || !byId.has(l.taskId)) continue
    linkedThreads.set(l.taskId, [...(linkedThreads.get(l.taskId) ?? []), th])
  }
  const children = new Map<string, string[]>()
  for (const t of tasks)
    if (t.parentId) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t.id])

  const openDescendants = (taskId: string) => {
    let n = 0
    const seen = new Set<string>()
    const stack = [...(children.get(taskId) ?? [])]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      if (byId.get(cur)?.status !== 'done') n += 1
      stack.push(...(children.get(cur) ?? []))
    }
    return n
  }

  /* ── 진척 ── */
  const count = { todo: 0, doing: 0, blocked: 0, done: 0 }
  for (const t of tasks) count[t.status] += 1
  /* 화면이 아는 기록은 마지막 줄(statusChangedAt)뿐이다 — 기간 안에 그 상태가 된 작업을 센다.
     backfill 줄은 바뀐 때가 아니라 '적어도 이때부터' 라 세지 않는다(서버와 같다) */
  const changedInPeriod = (t: Task) => !t.statusSinceBackfill && inPeriod(t.statusChangedAt)
  const completedTaskIds = tasks
    .filter((t) => t.status === 'done' && changedInPeriod(t))
    .map((t) => t.id)
  const startedTaskIds = tasks
    .filter((t) => t.status === 'doing' && changedInPeriod(t))
    .map((t) => t.id)
  const createdTaskIds = tasks.filter((t) => inPeriod(t.createdAt)).map((t) => t.id)

  /* ── 결정 ── */
  const threadsWith = (kinds: Entry['kind'][]) => {
    const hit = new Set(
      entries.filter((e) => kinds.includes(e.kind) && inPeriod(e.createdAt)).map((e) => e.threadId),
    )
    return threads.filter((t) => hit.has(t.id)).map((t) => t.id)
  }

  /* ── 손쓸 작업 ── */
  const all: TaskAttention[] = []
  for (const t of tasks) {
    if (t.status === 'done') continue
    const statusDays = Math.max(0, daysBetween(t.statusChangedAt, today))
    const plannedDays = t.start && t.due ? daysBetween(t.start, t.due) + 1 : null

    const overdue = t.due !== null && t.due < today
    const startPassed = t.start !== null && t.start < today
    const longRunning =
      t.status === 'doing' &&
      (plannedDays !== null ? statusDays > plannedDays * 1.5 : statusDays > settings.staleDays)
    const hit: Record<LiveSignal, boolean> = {
      longRunning,
      longBlocked: t.status === 'blocked' && statusDays > settings.staleDays,
      overdue,
      notStarted:
        t.status === 'todo' &&
        (startPassed || (t.due !== null && daysBetween(today, t.due) <= settings.dueSoonDays)),
      decidedButBlocked: isDecidedButBlocked(t, linkedThreads.get(t.id) ?? []),
    }
    const signals = SIGNAL_ORDER.filter((s) => hit[s])
    if (signals.length === 0) continue

    const checks = t.body.filter((l) => l.kind === 'check')
    all.push({
      taskId: t.id,
      signals,
      statusDays,
      statusSinceBackfill: t.statusSinceBackfill,
      plannedDays,
      weight: {
        openChildren: openDescendants(t.id),
        openLines: checks.filter((l) => !l.done).length,
        totalLines: checks.length,
        threadCount: linkedThreads.get(t.id)?.length ?? 0,
        priority: t.priority,
      },
      score: signals.reduce((sum, s) => sum + ATTENTION_SCORE[s], 0),
    })
  }
  /* score 내림차순 → 기한 이른 순(없으면 뒤) → 등록 순 */
  const attention = all
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const da = byId.get(a.taskId)!.due
      const db = byId.get(b.taskId)!.due
      if (da !== db) {
        if (da === null) return 1
        if (db === null) return -1
        return da < db ? -1 : 1
      }
      return bySeq(a.taskId, b.taskId)
    })
    .slice(0, ATTENTION_LIMIT)

  /* ── 사람별 ── */
  const completed = new Set(completedTaskIds)
  const people = new Map<string | null, PersonProgress>()
  for (const t of tasks) {
    const row = people.get(t.ownerId) ?? {
      memberId: t.ownerId,
      doing: 0,
      blocked: 0,
      overdue: 0,
      completed: 0,
      attentionTaskIds: [],
    }
    if (t.status === 'doing') row.doing += 1
    if (t.status === 'blocked') row.blocked += 1
    if (t.status !== 'done' && t.due !== null && t.due < today) row.overdue += 1
    if (completed.has(t.id)) row.completed += 1
    people.set(t.ownerId, row)
  }
  for (const a of attention)
    people.get(byId.get(a.taskId)!.ownerId)!.attentionTaskIds.push(a.taskId)

  return {
    periodStart,
    periodEnd,
    settings: { ...settings },
    progress: {
      ...count,
      doneRate: roundRate(count.done, tasks.length),
      completedTaskIds,
      startedTaskIds,
      createdTaskIds,
    },
    previous: input.previous ? { ...input.previous } : null,
    decisions: {
      decidedThreadIds: threadsWith(['decide', 'change']),
      deferredThreadIds: threadsWith(['defer']),
      riskyThreadIds: input.riskyThreadIds.slice(0, 10),
    },
    attention,
    /* 손쓸 작업이 많은 사람 먼저 → memberId 순, 담당자 없음은 맨 뒤 */
    people: [...people.values()].sort((a, b) => {
      if (a.attentionTaskIds.length !== b.attentionTaskIds.length)
        return b.attentionTaskIds.length - a.attentionTaskIds.length
      if (a.memberId === b.memberId) return 0
      if (a.memberId === null) return 1
      if (b.memberId === null) return -1
      return a.memberId < b.memberId ? -1 : 1
    }),
  }
}

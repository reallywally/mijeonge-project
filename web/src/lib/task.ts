import { kstToday, localDay } from '@/lib/date'
import type { Task, TaskLine, TaskPriority, TaskStatus } from '@/types/domain'

/* 상태 넷은 목록 · 칸반 · 추가 · 상세가 모두 같은 순서로 쓴다 */
export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '해야 할 일' },
  { value: 'doing', label: '진행 중' },
  { value: 'blocked', label: '막힘' },
  { value: 'done', label: '완료' },
]

export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'normal', label: '보통' },
  { value: 'high', label: '높음' },
]

export const taskStatusLabel = (status: TaskStatus) =>
  TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? ''

export const taskPriorityLabel = (priority: TaskPriority) =>
  TASK_PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? ''

/**
 * 작업 추가의 내용 칸에 적은 글을 본문 줄로 옮긴다.
 *
 * `[]` · `[x]` 로 시작하면 체크박스, `-` · `*` 로 시작하면 불릿이고,
 * 그 밖의 줄도 불릿으로 둔다. 앞의 두 칸(또는 탭 하나)이 한 단계다.
 */
export function parseTaskBody(text: string): TaskLine[] {
  const lines: TaskLine[] = []
  for (const raw of text.split('\n')) {
    const rest = raw.replace(/^[\t ]+/, '')
    if (rest === '') continue

    const indent = raw.slice(0, raw.length - rest.length).replace(/\t/g, '  ').length
    const check = /^\[([ xX]?)\][\t ]*/.exec(rest)
    const bullet = check ? null : /^[-*][\t ]+/.exec(rest)
    const marker = check?.[0] ?? bullet?.[0] ?? ''
    const body = rest.slice(marker.length).trim()
    if (body === '') continue

    lines.push({
      id: `l${lines.length + 1}`,
      kind: check ? 'check' : 'bullet',
      text: body,
      done: check ? check[1].toLowerCase() === 'x' : false,
      level: Math.min(Math.floor(indent / 2), 3),
    })
  }
  return lines
}

/**
 * 기간은 둘 다 있거나 둘 다 없어야 한다(간트의 규칙). 어긋나 있으면 왜인지, 맞으면 빈 문자열.
 * 작업 상세는 맞을 때만 넣고, 작업 추가는 맞을 때만 만든다.
 */
export function periodProblem(start: string, due: string): string {
  if (start && due && start > due) return '기한이 시작 날짜보다 앞섭니다'
  if (start && !due) return '기한도 정하면 기간이 잡힙니다'
  if (!start && due) return '시작 날짜도 정하면 기간이 잡힙니다'
  return ''
}

/** 지금 상태가 된 지 며칠 — 한국 시간 날짜끼리 뺀다. 시계가 어긋나 앞날이면 0 */
export function statusDays(statusChangedAt: string, now: Date = new Date()) {
  const from = Date.parse(`${localDay(statusChangedAt)}T00:00:00Z`)
  const to = Date.parse(`${kstToday(now)}T00:00:00Z`)
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/** '진행 중 · 12일째' — backfill 줄이면 실제로는 더 오래됐을 수 있어 '12일 이상' */
export function statusSinceLabel(
  task: Pick<Task, 'statusChangedAt' | 'statusSinceBackfill'> & { status: TaskStatus },
  now: Date = new Date(),
) {
  const days = statusDays(task.statusChangedAt, now)
  const span = days === 0 ? '오늘부터' : task.statusSinceBackfill ? `${days}일 이상` : `${days}일째`
  return `${taskStatusLabel(task.status)} · ${span}`
}

/* ── 계층 깊이 · 완료 숨기기 (Q64) ───────────────────── */

/** 작업은 4단까지 — 최상위가 1단이다. 서버도 같은 수로 막는다(400 TASK_DEPTH_EXCEEDED) */
export const MAX_TASK_DEPTH = 4
export const TASK_DEPTH_MESSAGE = `작업은 ${MAX_TASK_DEPTH}단까지만 쌓을 수 있습니다.`

type TaskNode = Pick<Task, 'id' | 'parentId'>

/** 작업마다 몇 단인지 — 최상위가 1. 상위가 목록에 없으면 거기서 끊는다. 고리가 있어도 멈춘다 */
export function taskDepths(tasks: TaskNode[]): Record<string, number> {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parentId]))
  const depths: Record<string, number> = {}
  const depthOf = (id: string): number => {
    if (depths[id] !== undefined) return depths[id]
    const seen = new Set<string>()
    const chain: string[] = []
    let at: string | null | undefined = id
    while (at && parentOf.has(at) && depths[at] === undefined && !seen.has(at)) {
      seen.add(at)
      chain.push(at)
      at = parentOf.get(at)
    }
    let d = at && depths[at] !== undefined ? depths[at] : 0
    for (const node of chain.reverse()) depths[node] = ++d
    return depths[id]
  }
  for (const t of tasks) depthOf(t.id)
  return depths
}

/** 작업마다 자기를 포함한 하위의 높이 — 하위가 없으면 1 */
export function subtreeHeights(tasks: TaskNode[]): Record<string, number> {
  const depths = taskDepths(tasks)
  const heights: Record<string, number> = {}
  /* 깊은 것부터 올라가며 부모의 높이를 키운다 */
  const order = [...tasks].sort((a, b) => depths[b.id] - depths[a.id])
  for (const t of order) {
    heights[t.id] ??= 1
    if (t.parentId && depths[t.parentId] !== undefined && depths[t.parentId] < depths[t.id])
      heights[t.parentId] = Math.max(heights[t.parentId] ?? 1, heights[t.id] + 1)
  }
  return heights
}

/**
 * 완료 숨기기에서 숨는 작업 — 완료인데 아직 안 끝난 하위가 하나도 없는 것.
 * 안 끝난 작업의 조상은 완료여도 남겨 트리가 끊기지 않게 한다
 */
export function hiddenDoneIds(tasks: Pick<Task, 'id' | 'parentId' | 'status'>[]): Set<string> {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parentId]))
  const kept = new Set<string>()
  for (const t of tasks) {
    if (t.status === 'done') continue
    let at = t.parentId
    while (at && parentOf.has(at) && !kept.has(at)) {
      kept.add(at)
      at = parentOf.get(at) ?? null
    }
  }
  return new Set(tasks.filter((t) => t.status === 'done' && !kept.has(t.id)).map((t) => t.id))
}

/**
 * 한 번에 등록(챗봇 일괄 · 회의록 반영)에서 4단을 넘는 자리 — 목업이 서버의 detail 을 흉내 낸다.
 * 이미 있는 상위의 단은 depths 로 받는다(모르는 작업이면 최상위로 본다)
 */
export function batchDepthProblems(
  drafts: { tempId: string; parentTempId: string | null; parentId: string | null }[],
  depths: Record<string, number>,
): Record<string, string> {
  const detail: Record<string, string> = {}
  const byTemp: Record<string, number> = {}
  drafts.forEach((t, i) => {
    const depth =
      t.parentTempId !== null
        ? (byTemp[t.parentTempId] ?? 0) + 1
        : t.parentId !== null
          ? (depths[t.parentId] ?? 1) + 1
          : 1
    byTemp[t.tempId] = depth
    if (depth > MAX_TASK_DEPTH)
      detail[`tasks.${i}.${t.parentTempId !== null ? 'parentTempId' : 'parentId'}`] =
        TASK_DEPTH_MESSAGE
  })
  return detail
}

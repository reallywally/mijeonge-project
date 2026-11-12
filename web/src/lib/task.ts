import { kstToday, localDay } from '@/lib/date'
import type { Task, TaskLine, TaskPriority, TaskStatus } from '@/types/domain'

/** 고칠 권한이 없는 안건에 붙는 안내 */
export const READONLY_HINT = '작성자 · 담당자 · 관리자만 고칠 수 있습니다'

/** 고칠 권한이 없는 작업에 붙는 안내 — 상세 · 목록 · 칸반이 같은 말을 쓴다. 파트 작업은 파트 권한을 따른다 */
export const TASK_READONLY_HINT =
  '고칠 권한이 없습니다 — 담당자 · 관리자 · 파트 수정 권한(공통은 작성자도)'

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
 * 줄기째 지울 때 같이 지워지는 후손 — 손자 이하까지, 트리 순서(형제는 order · 등록순)로.
 * 루트는 빼고 낸다. 고리가 있어도 멈춘다. 목업 서버와 스토어가 같이 쓴다
 */
export function descendantsOf<T extends Pick<Task, 'id' | 'parentId' | 'order'>>(
  tasks: T[],
  rootId: string,
): T[] {
  const at = new Map(tasks.map((t, i) => [t.id, i]))
  const kids = new Map<string, T[]>()
  for (const t of tasks)
    if (t.parentId) (kids.get(t.parentId) ?? kids.set(t.parentId, []).get(t.parentId)!).push(t)
  const out: T[] = []
  const seen = new Set([rootId])
  const walk = (id: string) => {
    const under = (kids.get(id) ?? []).sort(
      (a, b) => a.order - b.order || at.get(a.id)! - at.get(b.id)!,
    )
    for (const t of under) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
      walk(t.id)
    }
  }
  walk(rootId)
  return out
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

/* ── 줄 끌어 옮기기 — 상위 · 형제 순서 ───────────────────── */

type OrderNode = Pick<Task, 'id' | 'projectId' | 'parentId' | 'order'>

/** 형제를 order 로 세운다 — 같으면 받은 배열 순서(등록순)다. 서버도 (order, seq) 로 세운다 */
export function siblingsInOrder<T extends OrderNode>(
  tasks: T[],
  projectId: string,
  parentId: string | null,
): T[] {
  const at = new Map(tasks.map((t, i) => [t.id, i]))
  return tasks
    .filter((t) => t.projectId === projectId && t.parentId === parentId)
    .sort((a, b) => a.order - b.order || at.get(a.id)! - at.get(b.id)!)
}

/** 새 작업은 그 상위의 맨 끝 — 형제 가운데 가장 큰 order + 1, 형제가 없으면 0 */
export function nextTaskOrder(tasks: OrderNode[], projectId: string, parentId: string | null) {
  return tasks
    .filter((t) => t.projectId === projectId && t.parentId === parentId)
    .reduce((max, t) => Math.max(max, t.order + 1), 0)
}

/**
 * 옮기기를 서버처럼 따진다 — 걸리면 서버의 400 과 같은 code · message, 괜찮으면 null.
 * 4단 제한은 상위가 바뀔 때만 본다(서버가 그렇다). 목업 서버와 스토어가 같이 쓴다
 */
export function moveProblem(
  tasks: OrderNode[],
  taskId: string,
  parentId: string | null,
  beforeId: string | null,
): { code: string; message: string } | null {
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  if (parentId !== null) {
    if (parentId === taskId)
      return { code: 'TASK_PARENT_SELF', message: '작업을 자기 자신의 상위로 둘 수 없습니다.' }
    const parent = tasks.find((t) => t.id === parentId)
    if (!parent) return { code: 'TASK_PARENT_NOT_FOUND', message: '상위 작업을 찾을 수 없습니다.' }
    if (parent.projectId !== task.projectId)
      return { code: 'TASK_PARENT_OTHER_PROJECT', message: '상위 작업이 다른 프로젝트에 있습니다.' }
    const parentOf = new Map(tasks.map((t) => [t.id, t.parentId]))
    const seen = new Set<string>()
    for (let up = parent.parentId; up !== null && !seen.has(up); up = parentOf.get(up) ?? null) {
      if (up === taskId)
        return { code: 'TASK_PARENT_DESCENDANT', message: '하위 작업을 상위로 둘 수 없습니다.' }
      seen.add(up)
    }
    if (parentId !== task.parentId) {
      const depth = taskDepths(tasks)[parentId] ?? 1
      const height = subtreeHeights(tasks)[taskId] ?? 1
      if (depth + height > MAX_TASK_DEPTH)
        return { code: 'TASK_DEPTH_EXCEEDED', message: TASK_DEPTH_MESSAGE }
    }
  }
  if (
    beforeId !== null &&
    (beforeId === taskId ||
      !tasks.some(
        (t) => t.id === beforeId && t.projectId === task.projectId && t.parentId === parentId,
      ))
  )
    return {
      code: 'TASK_BEFORE_NOT_SIBLING',
      message: '앞에 둘 작업이 옮겨 갈 상위의 하위 작업이 아닙니다.',
    }
  return null
}

/**
 * 옮긴 뒤 order · parentId 가 바뀌는 작업들 — 고친 사본을 등록순으로 낸다(서버 응답과 같은 모양).
 * 새 형제들 사이 beforeId 자리(null 은 맨 끝)에 끼우고 0..n 으로 다시 매긴다. 상위가 바뀌면 옛 형제도.
 * 같은 상위 · 같은 자리면 빈자리가 있어도 [] 다. 따지기(moveProblem)는 먼저 끝냈다고 본다
 */
export function placeTask<T extends OrderNode>(
  tasks: T[],
  taskId: string,
  parentId: string | null,
  beforeId: string | null,
): T[] {
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return []
  const moves = parentId !== task.parentId
  const siblings = siblingsInOrder(tasks, task.projectId, parentId).filter((t) => t.id !== taskId)
  const at = beforeId === null ? -1 : siblings.findIndex((t) => t.id === beforeId)
  const placed =
    at < 0 ? [...siblings, task] : [...siblings.slice(0, at), task, ...siblings.slice(at)]
  if (!moves) {
    const now = siblingsInOrder(tasks, task.projectId, parentId)
    if (now.every((t, i) => t.id === placed[i].id)) return []
  }

  const next = new Map<string, T>()
  if (moves) next.set(taskId, { ...task, parentId })
  const renumber = (rows: T[]) =>
    rows.forEach((row, order) => {
      const cur = next.get(row.id) ?? row
      if (cur.order !== order || row.id === taskId) next.set(row.id, { ...cur, order })
    })
  if (moves)
    renumber(siblingsInOrder(tasks, task.projectId, task.parentId).filter((t) => t.id !== taskId))
  renumber(placed)
  /* 옮긴 작업은 상위가 그대로여도 자리가 바뀌었으니 낸다 — order 가 그대로인 형제는 안 낸다 */
  return tasks.filter((t) => next.has(t.id)).map((t) => next.get(t.id)!)
}

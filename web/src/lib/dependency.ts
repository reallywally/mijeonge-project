import { kstToday, localDay } from '@/lib/date'
import { taskStatusLabel } from '@/lib/task'
import type { Task, TaskDependency, TaskStatus } from '@/types/domain'

/* 선행 작업의 검사 — 서버 계약(docs/api/task-flow.md '검사')을 그대로 옮겼다.
   목업 api 가 이것으로 거절하고, 화면은 같은 함수로 고르기 목록을 거르고 간트에서 그 자리에서 까닭을 띄운다 */

/** 한 작업의 선행은 이만큼까지 */
export const DEPENDENCY_LIMIT = 20

export type DependencyProblem = 'self' | 'cycle' | 'limit'

/** 서버와 같은 상태 · 코드 · 한 줄 */
export const DEPENDENCY_ERRORS: Record<
  DependencyProblem,
  { status: number; code: string; message: string }
> = {
  self: {
    status: 400,
    code: 'TASK_DEPENDENCY_SELF',
    message: '자기 자신은 선행 작업으로 둘 수 없습니다.',
  },
  cycle: {
    status: 409,
    code: 'TASK_DEPENDENCY_CYCLE',
    message: '선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.',
  },
  limit: {
    status: 400,
    code: 'TASK_DEPENDENCY_LIMIT',
    message: `선행 작업은 ${DEPENDENCY_LIMIT}개까지 둘 수 있습니다.`,
  },
}

/** 고르기 목록에서 흐리게 둔 줄 옆에 적는 짧은 까닭 — 자기는 목록에서 아예 빠진다 */
export const DEPENDENCY_REASONS: Record<Exclude<DependencyProblem, 'self'>, string> = {
  cycle: '이미 이 작업을 기다림',
  limit: `${DEPENDENCY_LIMIT}개까지`,
}

type Node = Pick<Task, 'id'>

/** from 이 선행을 따라 몇 단계를 건너 to 에 닿는가 */
function waitsFor(deps: TaskDependency[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === to) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const d of deps) if (d.taskId === cur) stack.push(d.dependsOnId)
  }
  return false
}

/**
 * taskId 의 선행으로 dependsOnId 를 걸 수 있나. 되면 null.
 * PUT 은 멱등이라 같은 쌍은 없는 셈 치고 본다 — 이미 있는 쌍을 다시 걸어도 걸리지 않고,
 * 화면이 먼저 넣어 둔(낙관적 반영) 쌍이 자기 검사를 막지도 않는다
 */
export function dependencyProblem(
  deps: TaskDependency[],
  taskId: string,
  dependsOnId: string,
): DependencyProblem | null {
  if (taskId === dependsOnId) return 'self'
  const others = deps.filter((d) => !(d.taskId === taskId && d.dependsOnId === dependsOnId))
  if (waitsFor(others, dependsOnId, taskId)) return 'cycle'
  if (others.filter((d) => d.taskId === taskId).length >= DEPENDENCY_LIMIT) return 'limit'
  return null
}

export interface DependencyChoice<T extends Node = Task> {
  task: T
  /** 걸 수 없는 까닭 — 있으면 흐리게 두고 못 고른다 */
  problem: Exclude<DependencyProblem, 'self'> | null
}

/** 선행으로 고를 수 있는 작업 — 자기 · 이미 건 것은 빼고, 걸면 순환이 되는 것은 까닭과 함께 둔다 */
export function dependencyChoices<T extends Node>(
  tasks: T[],
  deps: TaskDependency[],
  taskId: string,
): DependencyChoice<T>[] {
  const already = new Set(deps.filter((d) => d.taskId === taskId).map((d) => d.dependsOnId))
  return tasks
    .filter((t) => t.id !== taskId && !already.has(t.id))
    .map((t) => {
      const problem = dependencyProblem(deps, taskId, t.id)
      return { task: t, problem: problem === 'self' ? null : problem }
    })
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

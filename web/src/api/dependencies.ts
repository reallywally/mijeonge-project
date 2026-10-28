import { id, mockError, request } from '@/api/client'
import { later, mockWorld, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { mockDependencySuggestions } from '@/fixtures'
import { canSeeProject } from '@/lib/access'
import { DEPENDENCY_ERRORS, dependencyProblem } from '@/lib/dependency'
import type { DependencySuggestions, Task, TaskDependency } from '@/types/domain'

/* 선행 작업 (docs/api/task-flow.md). 목업 갈래는 데이터 스토어의 작업 · 선행(provideMockWorld)을 보고
   서버와 같은 검사 · 같은 오류 코드를 낸다. 고치는 것은 데이터 스토어다 — 여기는 판정만 한다 */

/** 내가 볼 수 있는 프로젝트의 작업. 남의 프로젝트 것도 없는 것처럼 404 (docs/api/auth.md) */
function visibleTask(taskId: string): Task {
  const me = requireMe()
  const task = mockWorld().tasks.find((t) => t.id === taskId)
  if (!task || !canSeeProject(me, task.projectId))
    throw mockError(404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.')
  return task
}

const mock = {
  put(taskId: string, dependsOnId: string): TaskDependency {
    const task = visibleTask(taskId)
    const world = mockWorld()
    const first = world.tasks.find((t) => t.id === dependsOnId)
    if (!first || first.projectId !== task.projectId)
      throw mockError(404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.')
    /* 이미 걸린 관계는 검사 없이 그대로 (멱등) — 상위를 바꿔 지금은 상하위가 된 관계라도. 서버와 같다 */
    if (world.taskDependencies.some((d) => d.taskId === taskId && d.dependsOnId === dependsOnId))
      return { taskId, dependsOnId }
    const own = world.tasks.filter((t) => t.projectId === task.projectId)
    const problem = dependencyProblem(own, world.taskDependencies, taskId, dependsOnId)
    if (problem) {
      const { status, code, message } = DEPENDENCY_ERRORS[problem]
      throw mockError(status, code, message)
    }
    return { taskId, dependsOnId }
  },
  /** 뒤 작업만 본다 — 모르는 선행 id · 없는 관계도 204 */
  remove(taskId: string) {
    visibleTask(taskId)
  },
  suggest(projectId: string): DependencySuggestions {
    requireProject(requireMe(), projectId)
    const world = mockWorld()
    const own = world.tasks.filter((t) => t.projectId === projectId)
    const open = new Set(own.filter((t) => t.status !== 'done').map((t) => t.id))
    /* 완료 아닌 작업이 둘 미만이면 AI 를 부르지 않고 빈 목록 */
    if (open.size < 2) return { suggestions: [], truncated: false }
    /* 서버처럼 걸리는 것 · 이미 있는 것 · 완료가 낀 것은 조용히 버리고, 받아들인 제안을 얹어 가며 본다 —
       [모두 적용] 이 제안끼리 순환 · 20개에 걸리지 않게 */
    const graph = [...world.taskDependencies]
    const suggestions = (mockDependencySuggestions[projectId] ?? []).filter((s) => {
      const ok =
        open.has(s.taskId) &&
        open.has(s.dependsOnId) &&
        !graph.some((d) => d.taskId === s.taskId && d.dependsOnId === s.dependsOnId) &&
        dependencyProblem(own, graph, s.taskId, s.dependsOnId) === null
      if (ok) graph.push({ taskId: s.taskId, dependsOnId: s.dependsOnId })
      return ok
    })
    return { suggestions: structuredClone(suggestions), truncated: false }
  },
}

/** 선행 작업 걸기 (멱등). 상하위 400 · 순환 409 · 20개 넘음 400 · 다른 프로젝트 404 */
export const putTaskDependency = (taskId: string, dependsOnId: string) =>
  isMockMode()
    ? later(() => mock.put(taskId, dependsOnId))
    : request<TaskDependency>('PUT', `/tasks/${id(taskId)}/dependencies/${id(dependsOnId)}`)

/** 떼기 (멱등) */
export const deleteTaskDependency = (taskId: string, dependsOnId: string) =>
  isMockMode()
    ? later(() => mock.remove(taskId))
    : request<void>('DELETE', `/tasks/${id(taskId)}/dependencies/${id(dependsOnId)}`)

/** AI 가 빠진 선행 관계를 제안한다 — 저장하지 않는다. 429 · 503 은 챗봇과 같고, 답이 모양에 안 맞으면 502 */
export const suggestDependencies = (projectId: string) =>
  isMockMode()
    ? later(() => mock.suggest(projectId))
    : request<DependencySuggestions>('POST', `/projects/${id(projectId)}/dependencies/suggest`)

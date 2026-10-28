import { ApiError, id, request } from '@/api/client'
import { recordMockHistory } from '@/api/history'
import { isMockMode } from '@/api/mode'
import { mockDb } from '@/api/mockAuth'
import { projects, tasks } from '@/fixtures'
import { nowIso } from '@/lib/date'
import { change } from '@/lib/history'
import { inheritedPartId } from '@/lib/part'
import type {
  Task,
  TaskBatchInput,
  TaskBatchResult,
  TaskInput,
  TaskPatch,
  TaskThreadLink,
} from '@/types/domain'

export const createTask = (projectId: string, input: TaskInput) =>
  request<Task>('POST', `/projects/${id(projectId)}/tasks`, input)

export const patchTask = (taskId: string, patch: TaskPatch) =>
  request<Task>('PATCH', `/tasks/${id(taskId)}`, patch)

export const patchTaskLine = (taskId: string, lineId: string, done: boolean) =>
  request<Task>('PATCH', `/tasks/${id(taskId)}/lines/${id(lineId)}`, { done })

export const linkTaskThread = (taskId: string, threadId: string) =>
  request<TaskThreadLink>('PUT', `/tasks/${id(taskId)}/threads/${id(threadId)}`)

export const unlinkTaskThread = (taskId: string, threadId: string) =>
  request<void>('DELETE', `/tasks/${id(taskId)}/threads/${id(threadId)}`)

/* 목업 갈래 — 서버의 검사 규칙(API.md '한 번에 등록')을 그대로 본다. 키 번호는 픽스처에서 이어 센다.
   화면에서 만든 목업 프로젝트는 여기서 알 수 없어 404 를 내지 않는다 — 목업 데이터 스토어가 키를 다시 붙인다 */
const MAX_BATCH = 20
let mockSeq = 0
let mockNextNo: Record<string, number> = {}

export function resetMockTasks() {
  mockSeq = 0
  mockNextNo = {}
}

function takeMockKey(projectId: string) {
  const prefix = projects.find((p) => p.id === projectId)?.taskKeyPrefix ?? 'TASK'
  const no =
    mockNextNo[projectId] ??
    tasks
      .filter((t) => t.projectId === projectId)
      .reduce((max, t) => Math.max(max, Number(t.key.split('-').pop()) || 0), 0) + 1
  mockNextNo[projectId] = no + 1
  return `${prefix}-${no}`
}

/** 검사 규칙 위반을 서버처럼 한 번에 모은다 — detail 키는 `tasks.1.parentTempId` 처럼 몇 번째의 어느 칸인지 */
function batchErrors(input: TaskBatchInput): Record<string, string> {
  const detail: Record<string, string> = {}
  if (input.tasks.length < 1 || input.tasks.length > MAX_BATCH)
    detail.tasks = `작업은 1 ~ ${MAX_BATCH}개까지 한 번에 등록합니다.`
  const seen = new Set<string>()
  input.tasks.forEach((t, i) => {
    if (seen.has(t.tempId)) detail[`tasks.${i}.tempId`] = '임시 이름이 겹칩니다.'
    if (t.parentTempId !== null && !seen.has(t.parentTempId))
      detail[`tasks.${i}.parentTempId`] = '상위 작업은 앞에 있는 항목이어야 합니다.'
    if (t.parentTempId !== null && t.parentId !== null)
      detail[`tasks.${i}.parentId`] = '상위는 parentTempId 와 parentId 중 하나만 둡니다.'
    if (!t.title.trim()) detail[`tasks.${i}.title`] = '제목을 적어 주세요.'
    if (t.start && t.due && t.start > t.due)
      detail[`tasks.${i}.due`] = '끝나는 날이 시작하는 날보다 앞입니다.'
    seen.add(t.tempId)
  })
  return detail
}

function mockBatch(projectId: string, input: TaskBatchInput): TaskBatchResult {
  const detail = batchErrors(input)
  if (Object.keys(detail).length > 0)
    throw new ApiError(422, {
      code: 'VALIDATION_ERROR',
      message: '입력값이 올바르지 않습니다.',
      detail,
    })
  /* 새로 지정하는 담당자는 그 프로젝트의 활성 멤버여야 한다 (docs/api/auth.md) */
  const db = mockDb()
  const assignable = (ownerId: string) =>
    db.members.some((m) => m.id === ownerId && m.active) &&
    db.grants.some((g) => g.projectId === projectId && g.memberId === ownerId)
  if (input.tasks.some((t) => t.ownerId !== null && !assignable(t.ownerId)))
    throw new ApiError(400, {
      code: 'TASK_OWNER_NOT_FOUND',
      message: '담당자를 찾을 수 없습니다.',
    })

  /* 이미 있는 상위 — 픽스처에서 찾는다. 다른 프로젝트의 작업이면 서버처럼 거절한다.
     화면에서 새로 만든 목업 작업은 여기서 알 수 없어 그대로 받는다 */
  const existing = (parentId: string) => tasks.find((k) => k.id === parentId)
  const foreign = input.tasks.findIndex(
    (t) =>
      t.parentId !== null &&
      existing(t.parentId)?.projectId !== undefined &&
      existing(t.parentId)?.projectId !== projectId,
  )
  if (foreign >= 0)
    throw new ApiError(400, {
      code: 'TASK_PARENT_NOT_FOUND',
      message: '상위 작업을 찾을 수 없습니다.',
      detail: { [`tasks.${foreign}.parentId`]: '상위 작업을 찾을 수 없습니다.' },
    })

  const taskIdByTempId: Record<string, string> = {}
  const madeByTempId: Record<string, Task> = {}
  const createdAt = nowIso()
  const made = input.tasks.map((t): Task => {
    mockSeq += 1
    const taskId = `bt${mockSeq}`
    taskIdByTempId[t.tempId] = taskId
    const parent =
      t.parentTempId !== null
        ? madeByTempId[t.parentTempId]
        : t.parentId !== null
          ? (existing(t.parentId) ?? null)
          : null
    const task: Task = {
      id: taskId,
      projectId,
      key: takeMockKey(projectId),
      title: t.title.trim(),
      parentId: t.parentTempId === null ? t.parentId : taskIdByTempId[t.parentTempId],
      body: [],
      status: 'todo',
      ownerId: t.ownerId,
      start: t.start,
      due: t.due,
      priority: t.priority,
      /* 초안은 partId 를 싣지 않는다 — 부모를 따른다 (docs/api/part.md) */
      partId: inheritedPartId(undefined, parent),
      createdAt,
      commentCount: 0,
      minutesId: null,
      /* 만들 때도 상태 기록이 한 줄 남는다 (docs/api/task-flow.md) */
      statusChangedAt: createdAt,
      statusSinceBackfill: false,
    }
    madeByTempId[t.tempId] = task
    return task
  })
  for (const t of made) recordMockHistory('task', t.id, [change('created', null, null)])
  return { tasks: made, taskIdByTempId }
}

/** 챗봇 초안을 한 번에 등록한다 — 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다 */
export const createTasksBatch = (projectId: string, input: TaskBatchInput) =>
  isMockMode()
    ? Promise.resolve().then(() => mockBatch(projectId, input))
    : request<TaskBatchResult>('POST', `/projects/${id(projectId)}/tasks/batch`, input)

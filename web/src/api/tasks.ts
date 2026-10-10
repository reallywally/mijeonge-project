import { id, request } from '@/api/client'
import type { Task, TaskInput, TaskPatch, TaskThreadLink } from '@/types/domain'

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

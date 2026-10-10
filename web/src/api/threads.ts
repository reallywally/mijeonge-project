import { id, request } from '@/api/client'
import type { Entry, EntryInput, Thread, ThreadInput, ThreadPatch } from '@/types/domain'

export const createThread = (projectId: string, input: ThreadInput) =>
  request<Thread>('POST', `/projects/${id(projectId)}/threads`, input)

export const patchThread = (threadId: string, patch: ThreadPatch) =>
  request<Thread>('PATCH', `/threads/${id(threadId)}`, patch)

/** 줄 하나가 안건 상태까지 바꾼다 — 바뀐 안건을 같이 받는다 */
export const addEntry = (threadId: string, input: EntryInput) =>
  request<{ entry: Entry; thread: Thread }>('POST', `/threads/${id(threadId)}/entries`, input)

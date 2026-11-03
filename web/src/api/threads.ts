import { id, mockError, request } from '@/api/client'
import { recordMockHistory } from '@/api/history'
import { forbidden, later, mockDb, mockWorld, requireMe } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canDeleteThread, canEditEntry, canSeeProject } from '@/lib/access'
import { change } from '@/lib/history'
import { threadStateOf } from '@/lib/thread'
import type {
  Entry,
  EntryDeleteResult,
  EntryInput,
  EntryPatch,
  Thread,
  ThreadInput,
  ThreadPatch,
} from '@/types/domain'

export const createThread = (projectId: string, input: ThreadInput) =>
  request<Thread>('POST', `/projects/${id(projectId)}/threads`, input)

export const patchThread = (threadId: string, patch: ThreadPatch) =>
  request<Thread>('PATCH', `/threads/${id(threadId)}`, patch)

/** 줄 하나가 안건 상태까지 바꾼다 — 바뀐 안건을 같이 받는다 */
export const addEntry = (threadId: string, input: EntryInput) =>
  request<{ entry: Entry; thread: Thread }>('POST', `/threads/${id(threadId)}/entries`, input)

/** 이력 한 줄의 글(text · note) 고치기 — 안건 상태는 그대로라 줄만 받는다 */
export const patchEntry = (threadId: string, entryId: string, patch: EntryPatch) =>
  request<Entry>('PATCH', `/threads/${id(threadId)}/entries/${id(entryId)}`, patch)

/* 목업 갈래 — 안건 · 이력 줄 · 작업 연결은 데이터 스토어가 들고 있어 응답 뒤에 스토어가 뺀다.
   여기서는 서버처럼 404 → 403 → 409 순으로 보고, 목업 서버가 따로 든 확인 요청 · 테스트 태그를 걷고 이력을 남긴다 */
function visibleThread(threadId: string) {
  const me = requireMe()
  const thread = mockWorld().threads.find((t) => t.id === threadId)
  if (!thread || !canSeeProject(me, thread.projectId))
    throw mockError(404, 'THREAD_NOT_FOUND', '안건을 찾을 수 없습니다.')
  return { me, thread }
}

function mockDeleteThread(threadId: string) {
  const { me, thread } = visibleThread(threadId)
  if (!canDeleteThread(me, thread, thread.projectId)) throw forbidden()
  if (mockWorld().threads.some((t) => t.parentThreadId === threadId))
    throw mockError(
      409,
      'THREAD_HAS_CHILDREN',
      '떼어낸 하위 안건이 있어 지울 수 없습니다. 하위 안건을 먼저 지우세요.',
    )
  const db = mockDb()
  db.checks = db.checks.filter((c) => c.threadId !== threadId)
  for (const t of db.tests)
    t.refs = t.refs.filter((r) => !(r.kind === 'thread' && r.id === threadId))
  recordMockHistory('thread', threadId, [change('deleted', null, null)])
}

function mockDeleteEntry(threadId: string, entryId: string): EntryDeleteResult {
  const { me, thread } = visibleThread(threadId)
  const own = mockWorld().entries.filter((e) => e.threadId === threadId)
  const entry = own.find((e) => e.id === entryId)
  if (!entry) throw mockError(404, 'ENTRY_NOT_FOUND', '이력을 찾을 수 없습니다.')
  if (!canEditEntry(me, entry, thread, thread.projectId)) throw forbidden()
  recordMockHistory('thread', threadId, [change('entryDeleted', entry.text, null, entry.kind)])
  /* 데이터 스토어의 반응형 객체라 structuredClone 을 못 쓴다 — 칸을 떠서 돌려준다 */
  return {
    thread: {
      ...thread,
      options: [...thread.options],
      ccIds: [...thread.ccIds],
      state: threadStateOf(own.filter((e) => e.id !== entryId)),
    },
  }
}

/**
 * 안건 지우기(논리 삭제) — 생성자 · 담당자 · 관리자. 이력 줄 · 작업 연결 · 확인 요청 · 테스트 태그도 어디서도 안 보이게 된다.
 * 떼어낸 하위 안건이 있으면 409 THREAD_HAS_CHILDREN
 */
export const deleteThread = (threadId: string) =>
  isMockMode()
    ? later(() => mockDeleteThread(threadId))
    : request<void>('DELETE', `/threads/${id(threadId)}`)

/** 이력 한 줄 지우기(논리 삭제) — 남은 줄로 안건 상태를 다시 잰 안건을 받는다 */
export const deleteEntry = (threadId: string, entryId: string) =>
  isMockMode()
    ? later(() => mockDeleteEntry(threadId, entryId))
    : request<EntryDeleteResult>('DELETE', `/threads/${id(threadId)}/entries/${id(entryId)}`)

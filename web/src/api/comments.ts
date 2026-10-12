import { ApiError, id, request } from '@/api/client'
import { isMockMode } from '@/api/mode'
import { taskComments } from '@/fixtures/comments'
import { nowIso } from '@/lib/date'
import type { TaskComment, TaskCommentInput, TaskCommentPatch } from '@/types/domain'

/* 목업 갈래 — 서버처럼 쓰기가 남아야 상세를 다시 열어도 같은 댓글이 보인다.
   픽스처 배열을 고치면 테스트끼리 물드니 복사본을 들고, 테스트는 resetMockComments 로 되돌린다 */
let mockRows: TaskComment[] = structuredClone(taskComments)
let mockSeq = 0

export function resetMockComments() {
  mockRows = structuredClone(taskComments)
  mockSeq = 0
}

const emptyBody = () =>
  new ApiError(422, {
    code: 'VALIDATION_ERROR',
    message: '댓글 내용을 적어 주세요.',
    detail: { body: '댓글 내용을 적어 주세요.' },
  })

const notFound = () =>
  new ApiError(404, { code: 'COMMENT_NOT_FOUND', message: '댓글을 찾을 수 없습니다.' })

function mockFind(commentId: string) {
  const row = mockRows.find((c) => c.id === commentId)
  if (!row) throw notFound()
  return row
}

/* 서버 응답처럼 늘 새 객체를 낸다 — 스토어가 받은 것을 고쳐도 목업 저장소가 따라 바뀌지 않게 */
const mock = {
  list: (taskId: string) => structuredClone(mockRows.filter((c) => c.taskId === taskId)),
  create(taskId: string, input: TaskCommentInput) {
    const body = input.body.trim()
    if (!body) throw emptyBody()
    mockSeq += 1
    const row: TaskComment = {
      id: `mc${mockSeq}`,
      taskId,
      authorId: input.authorId,
      body,
      createdAt: nowIso(),
      editedAt: null,
    }
    mockRows.push(row)
    return structuredClone(row)
  },
  patch(commentId: string, patch: TaskCommentPatch) {
    const body = patch.body.trim()
    if (!body) throw emptyBody()
    const row = mockFind(commentId)
    row.body = body
    row.editedAt = nowIso()
    return structuredClone(row)
  },
  remove(commentId: string) {
    mockFind(commentId)
    mockRows = mockRows.filter((c) => c.id !== commentId)
  },
}

/** 목업도 서버처럼 한 박자 늦게 답한다 — 받는 중 표시를 거치는 길이 같아지게 */
const later = <T>(fn: () => T) => Promise.resolve().then(fn)

/** 오래된 것부터 */
export const fetchTaskComments = (taskId: string) =>
  isMockMode()
    ? later(() => mock.list(taskId))
    : request<TaskComment[]>('GET', `/tasks/${id(taskId)}/comments`)

export const createTaskComment = (taskId: string, input: TaskCommentInput) =>
  isMockMode()
    ? later(() => mock.create(taskId, input))
    : request<TaskComment>('POST', `/tasks/${id(taskId)}/comments`, input)

export const patchTaskComment = (commentId: string, patch: TaskCommentPatch) =>
  isMockMode()
    ? later(() => mock.patch(commentId, patch))
    : request<TaskComment>('PATCH', `/comments/${id(commentId)}`, patch)

export const deleteTaskComment = (commentId: string) =>
  isMockMode()
    ? later(() => mock.remove(commentId))
    : request<void>('DELETE', `/comments/${id(commentId)}`)

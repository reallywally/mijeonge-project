import { ApiError, id, mockError, request } from '@/api/client'
import { forbidden, mockDb, requireMe } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { tasks } from '@/fixtures'
import { taskComments } from '@/fixtures/comments'
import { canDeleteComment, canEditComment, canSeeProject } from '@/lib/access'
import { nowIso } from '@/lib/date'
import type {
  Me,
  TaskComment,
  TaskCommentInput,
  TaskCommentPatch,
  TestComment,
} from '@/types/domain'

/* 목업 갈래 — 서버처럼 쓰기가 남아야 상세를 다시 열어도 같은 댓글이 보인다.
   픽스처 배열을 고치면 테스트끼리 물드니 복사본을 들고, 테스트는 resetMockComments 로 되돌린다 */
let mockRows: TaskComment[] = structuredClone(taskComments)
let mockSeq = 0

export function resetMockComments() {
  mockRows = structuredClone(taskComments)
  mockSeq = 0
}

/** 작업을 지우면 그 댓글도 같이 사라진다 (서버는 cascade) */
export function forgetMockCommentsOf(taskId: string) {
  mockRows = mockRows.filter((c) => c.taskId !== taskId)
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
    /* 작성자는 로그인한 사람이다 — 요청에 실린 것을 믿지 않는다 */
    const me = requireMe()
    const body = input.body.trim()
    if (!body) throw emptyBody()
    mockSeq += 1
    const row: TaskComment = {
      id: `mc${mockSeq}`,
      taskId,
      authorId: me.id,
      body,
      createdAt: nowIso(),
      editedAt: null,
    }
    mockRows.push(row)
    return structuredClone(row)
  },
  patch(commentId: string, patch: TaskCommentPatch) {
    const me = requireMe()
    const body = patch.body.trim()
    if (!body) throw emptyBody()
    const row = mockFind(commentId)
    if (!canEditComment(me, row)) throw forbidden()
    row.body = body
    row.editedAt = nowIso()
    return structuredClone(row)
  },
  remove(commentId: string) {
    const me = requireMe()
    const row = mockFind(commentId)
    /* 화면에서 만든 목업 작업은 픽스처에 없어 프로젝트를 모른다 — 그때는 작성자 · 시스템 관리자만 */
    const projectId = tasks.find((t) => t.id === row.taskId)?.projectId ?? ''
    if (!canDeleteComment(me, row, projectId)) throw forbidden()
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

/* ── 테스트 조치 내역 (docs/api/test-comment.md) — 작업 댓글과 같은 규칙. 목업은 테스트와 같이 mockDb 에 둔다 ── */

const testNotFound = () => mockError(404, 'TEST_NOT_FOUND', '테스트를 찾을 수 없습니다.')
const testCommentNotFound = () =>
  mockError(404, 'TEST_COMMENT_NOT_FOUND', '조치 내역을 찾을 수 없습니다.')

const emptyTestBody = () =>
  mockError(422, 'VALIDATION_ERROR', '조치 내역을 적어 주세요.', {
    body: '조치 내역을 적어 주세요.',
  })

/** 못 보는 프로젝트 · 지운 테스트는 없는 것처럼 404 */
function requireTestOf(me: Me, testId: string) {
  const test = mockDb().tests.find((t) => t.id === testId)
  if (!test || !canSeeProject(me, test.projectId)) throw testNotFound()
  return test
}

function requireTestComment(me: Me, commentId: string) {
  const row = mockDb().testComments.find((c) => c.id === commentId)
  const test = row && mockDb().tests.find((t) => t.id === row.testId)
  if (!row || !test || !canSeeProject(me, test.projectId)) throw testCommentNotFound()
  return { row, test }
}

const testMock = {
  list(testId: string) {
    requireTestOf(requireMe(), testId)
    return structuredClone(mockDb().testComments.filter((c) => c.testId === testId))
  },
  create(testId: string, input: TaskCommentInput) {
    const me = requireMe()
    const test = requireTestOf(me, testId)
    const body = input.body.trim()
    if (!body) throw emptyTestBody()
    const db = mockDb()
    db.testCommentSeq += 1
    const row: TestComment = {
      id: `mtc${db.testCommentSeq}`,
      testId,
      authorId: me.id,
      body,
      createdAt: nowIso(),
      editedAt: null,
    }
    db.testComments.push(row)
    test.commentCount += 1
    return structuredClone(row)
  },
  patch(commentId: string, patch: TaskCommentPatch) {
    const me = requireMe()
    const body = patch.body.trim()
    if (!body) throw emptyTestBody()
    const { row } = requireTestComment(me, commentId)
    if (!canEditComment(me, row)) throw forbidden()
    row.body = body
    row.editedAt = nowIso()
    return structuredClone(row)
  },
  remove(commentId: string) {
    const me = requireMe()
    const { row, test } = requireTestComment(me, commentId)
    if (!canDeleteComment(me, row, test.projectId)) throw forbidden()
    const db = mockDb()
    db.testComments = db.testComments.filter((c) => c.id !== commentId)
    test.commentCount = Math.max(0, test.commentCount - 1)
  },
}

/** 오래된 것부터 */
export const fetchTestComments = (testId: string) =>
  isMockMode()
    ? later(() => testMock.list(testId))
    : request<TestComment[]>('GET', `/tests/${id(testId)}/comments`)

export const createTestComment = (testId: string, input: TaskCommentInput) =>
  isMockMode()
    ? later(() => testMock.create(testId, input))
    : request<TestComment>('POST', `/tests/${id(testId)}/comments`, input)

export const patchTestComment = (commentId: string, patch: TaskCommentPatch) =>
  isMockMode()
    ? later(() => testMock.patch(commentId, patch))
    : request<TestComment>('PATCH', `/test-comments/${id(commentId)}`, patch)

export const deleteTestComment = (commentId: string) =>
  isMockMode()
    ? later(() => testMock.remove(commentId))
    : request<void>('DELETE', `/test-comments/${id(commentId)}`)

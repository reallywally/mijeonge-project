import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import {
  createTaskComment,
  deleteTaskComment,
  fetchTaskComments,
  patchTaskComment,
  resetMockComments,
} from '@/api/comments'
import { login } from '@/api/auth'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { taskComments } from '@/fixtures/comments'
import type { TaskComment } from '@/types/domain'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('목업 갈래', () => {
  /* 서버처럼 로그인한 사람이 작성자다. 김서연(u1)은 cm1 의 작성자다 */
  beforeEach(async () => {
    resetMockComments()
    resetMockAuth()
    await login({ email: 'u1@innoflow.local', password: MOCK_PASSWORD })
  })

  it('그 작업의 댓글만 오래된 것부터 낸다', async () => {
    const rows = await fetchTaskComments('k4')
    expect(rows.map((c) => c.id)).toEqual(['cm1', 'cm2'])
    expect(await fetchTaskComments('k1')).toEqual([])
  })

  it('남기면 로그인한 사람이 작성자로, trim 해서 맨 뒤에 붙고, 다시 받아도 남아 있다', async () => {
    const made = await createTaskComment('k4', { body: '  확인했습니다  ' })
    expect(made).toMatchObject({ taskId: 'k4', authorId: 'u1', body: '확인했습니다' })
    expect(made.editedAt).toBeNull()
    expect(made.createdAt).toMatch(/Z$/)
    expect((await fetchTaskComments('k4')).at(-1)).toEqual(made)
  })

  it('빈 글은 422 로 거절한다 — 서버와 같은 모양', async () => {
    const error = await createTaskComment('k4', { body: '  \n ' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
  })

  it('고치면 editedAt 이 차고, 지우면 사라진다. 없는 댓글은 404 다', async () => {
    const edited = await patchTaskComment('cm1', { body: '고친 글' })
    expect(edited).toMatchObject({ id: 'cm1', body: '고친 글' })
    expect(edited.editedAt).not.toBeNull()

    await deleteTaskComment('cm1')
    expect((await fetchTaskComments('k4')).map((c) => c.id)).toEqual(['cm2'])
    expect(await deleteTaskComment('cm1').catch((e) => e)).toMatchObject({ status: 404 })
  })

  it('남의 댓글은 고치지 못하고, 일반 사용자는 지우지도 못한다 — 403', async () => {
    resetMockAuth()
    await login({ email: 'u2@innoflow.local', password: MOCK_PASSWORD })
    expect(await patchTaskComment('cm1', { body: '남의 글' }).catch((e) => e)).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
    expect(await deleteTaskComment('cm1').catch((e) => e)).toMatchObject({ status: 403 })
  })

  it('로그인 전이면 401 이다', async () => {
    resetMockAuth()
    expect(await createTaskComment('k4', { body: '글' }).catch((e) => e)).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
  })

  it('픽스처 배열은 건드리지 않는다', async () => {
    await patchTaskComment('cm1', { body: '고친 글' })
    expect(taskComments[0].body).not.toBe('고친 글')
  })
})

describe('서버 갈래', () => {
  const comment: TaskComment = {
    id: 'c 1',
    taskId: 'k4',
    authorId: 'u1',
    body: '글',
    createdAt: '2026-10-12T01:00:00Z',
    editedAt: null,
  }

  function serve(res: () => Response) {
    const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => res())
    vi.stubGlobal('fetch', fake)
    return fake
  }
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  it('계약의 경로 · 메서드 · 본문 그대로 보낸다', async () => {
    let fake = serve(() => json(200, [comment]))
    expect(await fetchTaskComments('k 4')).toEqual([comment])
    expect(fake).toHaveBeenCalledWith('/api/tasks/k%204/comments', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    })

    fake = serve(() => json(201, comment))
    await createTaskComment('k4', { body: '글' })
    expect(fake.mock.calls[0][0]).toBe('/api/tasks/k4/comments')
    /* 작성자는 서버가 세션으로 정한다 — authorId 를 싣지 않는다 */
    expect(fake.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ body: '글' }),
    })

    fake = serve(() => json(200, { ...comment, editedAt: '2026-10-12T02:00:00Z' }))
    await patchTaskComment('c 1', { body: '새 글' })
    expect(fake.mock.calls[0][0]).toBe('/api/comments/c%201')
    expect(fake.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ body: '새 글' }),
    })

    fake = serve(() => new Response(null, { status: 204 }))
    expect(await deleteTaskComment('c1')).toBeUndefined()
    expect(fake.mock.calls[0][0]).toBe('/api/comments/c1')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('실패는 본문의 code 그대로 ApiError 다', async () => {
    serve(() => json(422, { code: 'VALIDATION_ERROR', message: '내용을 적어 주세요.' }))
    const error = await createTaskComment('k4', { body: ' ' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
  })
})

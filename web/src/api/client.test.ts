import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isUnreachable, request } from '@/api/client'
import { fetchSnapshot, toRecords } from '@/api/projects'
import type { ProjectSnapshot } from '@/types/domain'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function answer(res: Response | (() => never)) {
  const fake = vi.fn(async () => (typeof res === 'function' ? res() : res))
  vi.stubGlobal('fetch', fake)
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetch 래퍼', () => {
  it('/api 아래로 JSON 을 실어 보낸다', async () => {
    const fake = answer(json(200, { id: 'k1' }))
    await request('PATCH', '/tasks/k1', { status: 'done' })

    expect(fake).toHaveBeenCalledWith('/api/tasks/k1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"status":"done"}',
    })
  })

  it('204 는 본문 없이 undefined 다', async () => {
    answer(new Response(null, { status: 204 }))
    await expect(request('DELETE', '/tasks/k1/threads/t1')).resolves.toBeUndefined()
  })

  it('에러는 상태와 { code, message, detail } 을 그대로 들고 온다', async () => {
    answer(
      json(422, {
        code: 'VALIDATION_ERROR',
        message: '입력값이 올바르지 않습니다.',
        detail: { taskKeyPrefix: '형식이 올바르지 않습니다.' },
      }),
    )
    const error = await request('POST', '/projects', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: '입력값이 올바르지 않습니다.',
      detail: { taskKeyPrefix: '형식이 올바르지 않습니다.' },
    })
  })

  it('detail 이 없으면 비어 있다', async () => {
    answer(json(404, { code: 'PROJECT_NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' }))
    const error = (await request('GET', '/projects/x/snapshot').catch(
      (e: unknown) => e,
    )) as ApiError

    expect(error.status).toBe(404)
    expect(error.detail).toBeUndefined()
    expect(isUnreachable(error)).toBe(false)
  })

  it('서버에 닿지 못하면 연결할 수 없다는 오류다', async () => {
    answer(() => {
      throw new TypeError('Failed to fetch')
    })
    const error = await request('GET', '/projects').catch((e: unknown) => e)

    expect(isUnreachable(error)).toBe(true)
    expect((error as ApiError).message).toBe('서버에 연결할 수 없습니다.')
  })

  it('계약 모양이 아닌 5xx 는 프록시가 서버에 못 붙은 것으로 본다', async () => {
    answer(new Response('', { status: 502 }))
    expect(isUnreachable(await request('GET', '/projects').catch((e: unknown) => e))).toBe(true)
  })

  it('계약 모양의 500 은 서버가 낸 오류라 그 message 를 쓴다', async () => {
    answer(json(500, { code: 'INTERNAL_ERROR', message: '서버에서 오류가 났습니다.' }))
    const error = (await request('GET', '/projects').catch((e: unknown) => e)) as ApiError

    expect(isUnreachable(error)).toBe(false)
    expect(error.code).toBe('INTERNAL_ERROR')
  })
})

describe('스냅샷', () => {
  const snapshot: ProjectSnapshot = {
    project: { id: 'p1', name: '한화손보 차세대', taskKeyPrefix: 'HW' },
    threads: [],
    entries: [],
    tasks: [],
    taskThreadLinks: [{ taskId: 'k1', threadId: 't1' }],
  }

  it('JSON 키를 data 스토어 이름으로 옮긴다', () => {
    const records = toRecords(snapshot)
    expect(Object.keys(records).sort()).toEqual(
      ['allEntries', 'allTasks', 'allThreads', 'project', 'taskThreads'].sort(),
    )
    expect(records.taskThreads).toBe(snapshot.taskThreadLinks)
  })

  it('프로젝트 id 를 경로에 싣는다', async () => {
    const fake = answer(json(200, snapshot))
    const records = await fetchSnapshot('p1')

    expect(fake).toHaveBeenCalledWith('/api/projects/p1/snapshot', expect.anything())
    expect(records.project.id).toBe('p1')
  })
})

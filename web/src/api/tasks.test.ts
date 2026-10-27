import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { createTasksBatch, resetMockTasks } from '@/api/tasks'
import { tasks } from '@/fixtures'
import type { ProposedTask, Task, TaskBatchResult } from '@/types/domain'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const draft = (tempId: string, over: Partial<ProposedTask> = {}): ProposedTask => ({
  tempId,
  relatedId: null,
  title: `작업 ${tempId}`,
  ownerId: null,
  start: null,
  due: null,
  priority: 'normal',
  ...over,
})

const lastHwNo = Math.max(
  ...tasks.filter((t) => t.projectId === 'p1').map((t) => Number(t.key.split('-')[1])),
)

describe('한 번에 등록 — 목업 갈래', () => {
  beforeEach(resetMockTasks)

  it('relatedId 가 있으면 새 작업이 그 작업을 연관으로 건다 — 초안끼리는 묶지 않는다', async () => {
    const res = await createTasksBatch('p1', {
      tasks: [draft('t1', { relatedId: 'k20' }), draft('t2')],
    })
    expect(res.tasks[0].relatedIds).toEqual(['k20'])
    expect(res.tasks[1].relatedIds).toEqual([])
  })

  it('다른 프로젝트의 작업은 연관으로 못 건다 — 400 TASK_RELATED_NOT_FOUND', async () => {
    const error = await createTasksBatch('p1', {
      tasks: [draft('t1'), draft('t2', { relatedId: 'x1' })],
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 400,
      code: 'TASK_RELATED_NOT_FOUND',
      detail: { 'tasks.1.relatedId': '연관 작업을 찾을 수 없습니다.' },
    })
  })

  it('요청 순서대로 todo · 빈 본문 · 공통 파트로 만든다', async () => {
    const res = await createTasksBatch('p1', {
      tasks: [
        draft('t1', { title: '  간담회 준비 ' }),
        draft('t2', { ownerId: 'u1', start: '2026-10-13', due: '2026-10-16' }),
        draft('t3', { priority: 'high', relatedId: 'k4' }),
      ],
    })

    expect(res.tasks.map((t) => t.key)).toEqual([
      `HW-${lastHwNo + 1}`,
      `HW-${lastHwNo + 2}`,
      `HW-${lastHwNo + 3}`,
    ])
    const [first, a, b] = res.tasks
    expect(res.taskIdByTempId).toEqual({ t1: first.id, t2: a.id, t3: b.id })
    expect(first).toMatchObject({ projectId: 'p1', title: '간담회 준비', relatedIds: [] })
    expect(a).toMatchObject({
      relatedIds: [],
      partId: null,
      ownerId: 'u1',
      start: '2026-10-13',
      due: '2026-10-16',
      status: 'todo',
      body: [],
      commentCount: 0,
    })
    /* HW-4 는 기반 파트지만 따르지 않는다 (Q61) */
    expect(b).toMatchObject({ relatedIds: ['k4'], priority: 'high', partId: null })
    expect(a.createdAt).toMatch(/Z$/)
  })

  it('번호는 이어서 센다 — 같은 키가 두 번 나가지 않는다', async () => {
    const one = await createTasksBatch('p1', { tasks: [draft('t1')] })
    const two = await createTasksBatch('p1', { tasks: [draft('t1')] })
    expect(two.tasks[0].key).not.toBe(one.tasks[0].key)
    expect(two.tasks[0].id).not.toBe(one.tasks[0].id)
  })

  it('검사 규칙을 어기면 422 — detail 에 몇 번째의 어느 칸인지', async () => {
    const error = await createTasksBatch('p1', {
      tasks: [
        draft('t1'),
        draft('t2', { title: '   ' }),
        draft('t2', { start: '2026-10-20', due: '2026-10-13' }),
      ],
    }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(Object.keys(error.detail).sort()).toEqual([
      'tasks.1.title',
      'tasks.2.due',
      'tasks.2.tempId',
    ])

    const empty = await createTasksBatch('p1', { tasks: [] }).catch((e) => e)
    expect(empty.detail).toHaveProperty('tasks')
    const many = await createTasksBatch('p1', {
      tasks: Array.from({ length: 21 }, (_, i) => draft(`t${i}`)),
    }).catch((e) => e)
    expect(many.detail).toHaveProperty('tasks')
  })

  it('없는 담당자는 400 TASK_OWNER_NOT_FOUND 이고, 틀리면 아무것도 안 남는다(번호도 안 쓴다)', async () => {
    const error = await createTasksBatch('p1', {
      tasks: [draft('t1'), draft('t2', { ownerId: 'nobody' })],
    }).catch((e) => e)
    expect(error).toMatchObject({ status: 400, code: 'TASK_OWNER_NOT_FOUND' })

    const res = await createTasksBatch('p1', { tasks: [draft('t1')] })
    expect(res.tasks[0].key).toBe(`HW-${lastHwNo + 1}`)
  })
})

describe('한 번에 등록 — 서버 갈래', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  function serve(res: () => Response) {
    const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => res())
    vi.stubGlobal('fetch', fake)
    return fake
  }

  it('초안 그대로 POST 하고 201 응답을 그대로 낸다', async () => {
    const task: Task = {
      id: 'x1',
      projectId: 'p 1',
      key: 'MG-7',
      title: '작업 t1',
      relatedIds: [],
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      partId: null,
      createdAt: '2026-10-12T01:00:00Z',
      commentCount: 0,
      minutesId: null,
      statusChangedAt: '2026-10-12T01:00:00Z',
      statusSinceBackfill: false,
    }
    const result: TaskBatchResult = { tasks: [task], taskIdByTempId: { t1: 'x1' } }
    const fake = serve(() => json(201, result))
    const input = { tasks: [draft('t1')] }

    expect(await createTasksBatch('p 1', input)).toEqual(result)
    expect(fake.mock.calls[0][0]).toBe('/api/projects/p%201/tasks/batch')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) })
  })

  it('실패는 본문의 code · detail 그대로 ApiError 다', async () => {
    serve(() =>
      json(422, {
        code: 'VALIDATION_ERROR',
        message: '입력값이 올바르지 않습니다.',
        detail: { 'tasks.1.title': '제목을 적어 주세요.' },
      }),
    )
    const error = await createTasksBatch('p1', { tasks: [draft('t1')] }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(error.detail).toEqual({ 'tasks.1.title': '제목을 적어 주세요.' })

    serve(() => json(400, { code: 'TASK_OWNER_NOT_FOUND', message: '담당자를 찾을 수 없습니다.' }))
    expect(await createTasksBatch('p1', { tasks: [draft('t1')] }).catch((e) => e)).toMatchObject({
      status: 400,
      code: 'TASK_OWNER_NOT_FOUND',
    })
  })
})

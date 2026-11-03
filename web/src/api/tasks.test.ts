import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { fetchTaskComments, resetMockComments } from '@/api/comments'
import { mockDb, resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { createTasksBatch, deleteTask, moveTask, resetMockTasks } from '@/api/tasks'
import { tasks } from '@/fixtures'
import type { ProposedTask, Task, TaskBatchResult } from '@/types/domain'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const draft = (tempId: string, over: Partial<ProposedTask> = {}): ProposedTask => ({
  tempId,
  parentTempId: null,
  parentId: null,
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

  it('parentId 로 이미 있는 작업 밑에 붙고, 그 밑은 parentTempId 로 잇는다', async () => {
    const res = await createTasksBatch('p1', {
      tasks: [draft('t1', { parentId: 'k1' }), draft('t2', { parentTempId: 't1' })],
    })
    expect(res.tasks[0].parentId).toBe('k1')
    expect(res.tasks[1].parentId).toBe(res.tasks[0].id)
  })

  it('다른 프로젝트의 작업 밑에는 못 붙는다 — 400 TASK_PARENT_NOT_FOUND', async () => {
    const error = await createTasksBatch('p1', {
      tasks: [draft('t1'), draft('t2', { parentId: 'x1' })],
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 400,
      code: 'TASK_PARENT_NOT_FOUND',
      detail: { 'tasks.1.parentId': '상위 작업을 찾을 수 없습니다.' },
    })
  })

  it('4단을 넘으면 400 TASK_DEPTH_EXCEEDED — 걸린 자리를 짚는다 (Q64)', async () => {
    /* 가상비서(k7)가 3단 — 그 밑이 4단, 또 밑이 5단이다 */
    const error = await createTasksBatch('p1', {
      tasks: [draft('t1', { parentId: 'k7' }), draft('t2', { parentTempId: 't1' })],
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'TASK_DEPTH_EXCEEDED',
      message: '작업은 4단까지만 쌓을 수 있습니다.',
      detail: { 'tasks.1.parentTempId': '작업은 4단까지만 쌓을 수 있습니다.' },
    })

    const under4 = await createTasksBatch('p1', {
      tasks: [draft('t1', { parentId: 'k8' })],
    }).catch((e: unknown) => e)
    expect(under4).toMatchObject({ detail: { 'tasks.0.parentId': expect.any(String) } })
  })

  it('상위를 둘 다 두면 422', async () => {
    const error = await createTasksBatch('p1', {
      tasks: [draft('t1'), draft('t2', { parentTempId: 't1', parentId: 'k1' })],
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 422 })
    expect((error as { detail: Record<string, string> }).detail).toHaveProperty('tasks.1.parentId')
  })

  it('요청 순서대로 todo · 빈 본문으로 만들고, 상위는 임시 이름을 id 로 바꿔 잇는다', async () => {
    const res = await createTasksBatch('p1', {
      tasks: [
        draft('t1', { title: '  간담회 준비 ' }),
        draft('t2', { parentTempId: 't1', ownerId: 'u1', start: '2026-10-13', due: '2026-10-16' }),
        draft('t3', { parentTempId: 't1', priority: 'high' }),
      ],
    })

    expect(res.tasks.map((t) => t.key)).toEqual([
      `HW-${lastHwNo + 1}`,
      `HW-${lastHwNo + 2}`,
      `HW-${lastHwNo + 3}`,
    ])
    const [parent, a, b] = res.tasks
    expect(res.taskIdByTempId).toEqual({ t1: parent.id, t2: a.id, t3: b.id })
    expect(parent).toMatchObject({ projectId: 'p1', title: '간담회 준비', parentId: null })
    expect(a).toMatchObject({
      parentId: parent.id,
      ownerId: 'u1',
      start: '2026-10-13',
      due: '2026-10-16',
      status: 'todo',
      body: [],
      commentCount: 0,
    })
    expect(b).toMatchObject({ parentId: parent.id, priority: 'high' })
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
        draft('t1', { parentTempId: 't2' }),
        draft('t2', { title: '   ' }),
        draft('t2', { start: '2026-10-20', due: '2026-10-13' }),
      ],
    }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(Object.keys(error.detail).sort()).toEqual([
      'tasks.0.parentTempId',
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

describe('지우기 — 목업 갈래', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockComments()
  })

  const as = (memberId: string) => writeMockSession(memberId)

  it('로그인이 없으면 401', async () => {
    await expect(deleteTask('k21')).rejects.toMatchObject({ status: 401 })
  })

  it('담당자는 못 지운다 — 403 FORBIDDEN. 등록한 사람은 지운다', async () => {
    /* HW-3: 담당 박지훈(u2) · 등록 김서연(u1). HW-18: 담당 정하늘(u4) · 등록 이도현(u3) */
    as('u2')
    await expect(deleteTask('k3')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    await expect(deleteTask('k18')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    as('u3')
    await expect(deleteTask('k18')).resolves.toBeUndefined()
  })

  it('하위 작업이 있으면 409 TASK_HAS_CHILDREN — 관리자여도', async () => {
    as('u1')
    const error = await deleteTask('k4').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'TASK_HAS_CHILDREN' })
  })

  it('못 보는 프로젝트 · 없는 작업은 404 TASK_NOT_FOUND', async () => {
    /* 박지훈(u2)은 p3 에 부여받지 않았다 — p3 에 작업은 없으니 없는 id 로 본다 */
    as('u2')
    await expect(deleteTask('nope')).rejects.toMatchObject({ status: 404, code: 'TASK_NOT_FOUND' })
  })

  it('지우면 댓글 · 테스트 태그 · 이력이 같이 사라진다', async () => {
    as('u1')
    const tagged = () =>
      mockDb().tests.filter((t) => t.refs.some((r) => r.kind === 'task' && r.id === 'k21'))
    expect(tagged().length).toBeGreaterThan(0)
    await deleteTask('k21')
    expect(tagged()).toHaveLength(0)
    expect(mockDb().taskHistory.k21).toBeUndefined()
    expect(await fetchTaskComments('k21')).toEqual([])

    await deleteTask('k18')
    expect(await fetchTaskComments('k18')).toEqual([])
  })
})

describe('줄 옮기기 — 목업 갈래', () => {
  beforeEach(resetMockAuth)

  const as = (memberId: string) => writeMockSession(memberId)
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ApiError) => `${e.status} ${e.code}`,
    )

  it('바뀐 작업의 사본만 등록순으로 낸다 — 픽스처는 고치지 않는다', async () => {
    as('u1')
    const res = await moveTask('k22', { parentId: 'k4', beforeId: 'k20' })
    expect(res.map((t) => [t.id, t.order])).toEqual([
      ['k20', 2],
      ['k21', 3],
      ['k22', 1],
    ])
    expect(tasks.find((t) => t.id === 'k22')!.order).toBe(3)

    const across = await moveTask('k20', { parentId: null, beforeId: null })
    expect(across.find((t) => t.id === 'k20')).toMatchObject({ parentId: null, order: 3 })
    expect(across.map((t) => t.id)).toEqual(['k20', 'k21', 'k22'])
  })

  it('같은 자리면 []', async () => {
    as('u1')
    expect(await moveTask('k20', { parentId: 'k4', beforeId: 'k21' })).toEqual([])
    expect(await moveTask('k22', { parentId: 'k4', beforeId: null })).toEqual([])
  })

  it('상위 검사는 PATCH 와 같은 코드 · 형제가 아니면 TASK_BEFORE_NOT_SIBLING', async () => {
    as('u1')
    expect(await codeOf(moveTask('k4', { parentId: 'k4', beforeId: null }))).toBe(
      '400 TASK_PARENT_SELF',
    )
    expect(await codeOf(moveTask('k4', { parentId: 'nope', beforeId: null }))).toBe(
      '400 TASK_PARENT_NOT_FOUND',
    )
    expect(await codeOf(moveTask('k4', { parentId: 'x1', beforeId: null }))).toBe(
      '400 TASK_PARENT_OTHER_PROJECT',
    )
    expect(await codeOf(moveTask('k5', { parentId: 'k7', beforeId: null }))).toBe(
      '400 TASK_PARENT_DESCENDANT',
    )
    /* 가상비서(k7)는 하위까지 2단 — 3단 작업(AI 심사 k12) 밑으로 가면 5단이다 */
    expect(await codeOf(moveTask('k7', { parentId: 'k12', beforeId: null }))).toBe(
      '400 TASK_DEPTH_EXCEEDED',
    )
    expect(await codeOf(moveTask('k20', { parentId: 'k4', beforeId: 'k2' }))).toBe(
      '400 TASK_BEFORE_NOT_SIBLING',
    )
    expect(await codeOf(moveTask('k20', { parentId: 'k4', beforeId: 'k20' }))).toBe(
      '400 TASK_BEFORE_NOT_SIBLING',
    )
  })

  it('고칠 수 없으면 403 · 없는 작업은 404 · 로그인이 없으면 401', async () => {
    expect(await codeOf(moveTask('k18', { parentId: null, beforeId: null }))).toMatch(/^401/)
    /* HW-18: 담당 정하늘(u4) · 등록 이도현(u3) — 박지훈(u2)은 못 옮기고 등록한 사람은 옮긴다 */
    as('u2')
    expect(await codeOf(moveTask('k18', { parentId: null, beforeId: null }))).toBe('403 FORBIDDEN')
    expect(await codeOf(moveTask('nope', { parentId: null, beforeId: null }))).toBe(
      '404 TASK_NOT_FOUND',
    )
    as('u3')
    expect(await codeOf(moveTask('k18', { parentId: null, beforeId: null }))).toBeNull()
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
      parentId: null,
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      partId: null,
      creatorId: null,
      order: 0,
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

  it('지우기는 DELETE /api/tasks/{id} — 204', async () => {
    const fake = serve(() => new Response(null, { status: 204 }))
    await expect(deleteTask('k 1')).resolves.toBeUndefined()
    expect(fake.mock.calls[0][0]).toBe('/api/tasks/k%201')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('옮기기는 POST /api/tasks/{id}/move — 바뀐 Task[] 를 그대로 낸다', async () => {
    const moved = { ...tasks.find((t) => t.id === 'k20')!, parentId: 'k1', order: 1 }
    const fake = serve(() => json(200, [moved]))
    const move = { parentId: 'k1', beforeId: 'k3' }
    expect(await moveTask('k 20', move)).toEqual([moved])
    expect(fake.mock.calls[0][0]).toBe('/api/tasks/k%2020/move')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(move) })
  })

  it('409 TASK_HAS_CHILDREN 은 그대로 ApiError 다', async () => {
    serve(() =>
      json(409, { code: 'TASK_HAS_CHILDREN', message: '하위 작업이 있어 지울 수 없습니다.' }),
    )
    await expect(deleteTask('k4')).rejects.toMatchObject({
      status: 409,
      code: 'TASK_HAS_CHILDREN',
    })
  })

  it('실패는 본문의 code · detail 그대로 ApiError 다', async () => {
    serve(() =>
      json(422, {
        code: 'VALIDATION_ERROR',
        message: '입력값이 올바르지 않습니다.',
        detail: { 'tasks.1.parentTempId': '앞에 있는 항목이어야 합니다.' },
      }),
    )
    const error = await createTasksBatch('p1', { tasks: [draft('t1')] }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(error.detail).toEqual({ 'tasks.1.parentTempId': '앞에 있는 항목이어야 합니다.' })

    serve(() => json(400, { code: 'TASK_OWNER_NOT_FOUND', message: '담당자를 찾을 수 없습니다.' }))
    expect(await createTasksBatch('p1', { tasks: [draft('t1')] }).catch((e) => e)).toMatchObject({
      status: 400,
      code: 'TASK_OWNER_NOT_FOUND',
    })
  })
})

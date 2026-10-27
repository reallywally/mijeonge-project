import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { deleteTaskDependency, putTaskDependency, suggestDependencies } from '@/api/dependencies'
import { type MockWorld, provideMockWorld, resetMockAuth } from '@/api/mockAuth'
import {
  entries,
  MOCK_PASSWORD,
  taskDependencies,
  taskThreadLinks,
  tasks,
  threads,
} from '@/fixtures'
import type { TaskDependency } from '@/types/domain'

/* 선행 작업 — 목업 갈래가 서버와 같은 검사 · 같은 코드를 내는지, 서버 갈래가 계약의 경로로 가는지 본다
   (docs/api/task-flow.md) */
const signIn = (email: string) => login({ email, password: MOCK_PASSWORD })

async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('실패해야 한다')
}

const world = (deps: TaskDependency[], over: Partial<MockWorld> = {}): MockWorld => ({
  threads,
  entries,
  tasks: tasks.map((t) => ({ ...t })),
  taskThreads: taskThreadLinks,
  taskDependencies: deps,
  ...over,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  provideMockWorld(null)
})

describe('목업 갈래', () => {
  beforeEach(async () => {
    resetMockAuth()
    await signIn('u1@innoflow.local')
  })

  it('걸면 그 쌍을 돌려준다. 이미 있는 쌍도 그대로 (멱등)', async () => {
    expect(await putTaskDependency('k21', 'k19')).toEqual({ taskId: 'k21', dependsOnId: 'k19' })
    expect(await putTaskDependency('k20', 'k19')).toEqual({ taskId: 'k20', dependsOnId: 'k19' })
  })

  it('자기 자신은 400 TASK_DEPENDENCY_SELF — 연관으로 건 작업끼리는 걸린다 (Q61)', async () => {
    const e = await failure(putTaskDependency('k20', 'k20'))
    expect([e.status, e.code]).toEqual([400, 'TASK_DEPENDENCY_SELF'])
    expect(await putTaskDependency('k20', 'k4')).toEqual({ taskId: 'k20', dependsOnId: 'k4' })
  })

  it('몇 단계를 건너 순환이 되면 409 TASK_DEPENDENCY_CYCLE', async () => {
    const e = await failure(putTaskDependency('k19', 'k21'))
    expect([e.status, e.code]).toEqual([409, 'TASK_DEPENDENCY_CYCLE'])
  })

  it('20개를 넘으면 400 TASK_DEPENDENCY_LIMIT', async () => {
    const extra = Array.from({ length: 20 }, (_, i) => ({
      ...tasks[0],
      id: `z${i}`,
      relatedIds: [],
    }))
    provideMockWorld(() =>
      world(
        extra.map((t) => ({ taskId: 'k18', dependsOnId: t.id })),
        { tasks: [...tasks, ...extra] },
      ),
    )
    const e = await failure(putTaskDependency('k18', 'k3'))
    expect([e.status, e.code]).toEqual([400, 'TASK_DEPENDENCY_LIMIT'])
  })

  it('이미 걸린 관계는 검사 없이 200 — 지금은 순환이 되는 관계라도', async () => {
    provideMockWorld(() => world([...taskDependencies, { taskId: 'k19', dependsOnId: 'k21' }]))
    expect(await putTaskDependency('k19', 'k21')).toEqual({ taskId: 'k19', dependsOnId: 'k21' })
  })

  it('다른 프로젝트의 작업끼리는 404 TASK_NOT_FOUND', async () => {
    const e = await failure(putTaskDependency('k20', 'x1'))
    expect([e.status, e.code]).toEqual([404, 'TASK_NOT_FOUND'])
    expect((await failure(putTaskDependency('nope', 'k19'))).code).toBe('TASK_NOT_FOUND')
  })

  it('떼기는 멱등 — 없는 쌍도 그대로 끝난다. 없는 작업은 404', async () => {
    await expect(deleteTaskDependency('k20', 'k19')).resolves.toBeUndefined()
    await expect(deleteTaskDependency('k20', 'k1')).resolves.toBeUndefined()
    expect((await failure(deleteTaskDependency('nope', 'k1'))).code).toBe('TASK_NOT_FOUND')
  })

  it('AI 제안은 시드에 없는 관계 둘 — 줄마다 이유 한 문장', async () => {
    const res = await suggestDependencies('p1')
    expect(res.truncated).toBe(false)
    expect(res.suggestions.map((s) => [s.taskId, s.dependsOnId])).toEqual([
      ['k16', 'k15'],
      ['k18', 'k3'],
    ])
    expect(res.suggestions.every((s) => s.reason.length > 0)).toBe(true)
    expect((await suggestDependencies('p2')).suggestions).toEqual([])
  })

  it('이미 건 것 · 걸 수 없게 된 것은 조용히 버린다', async () => {
    provideMockWorld(() =>
      world([
        ...taskDependencies,
        { taskId: 'k16', dependsOnId: 'k15' },
        { taskId: 'k3', dependsOnId: 'k18' },
      ]),
    )
    expect((await suggestDependencies('p1')).suggestions).toEqual([])
  })

  it('완료 아닌 작업이 둘 미만이면 빈 제안', async () => {
    provideMockWorld(() =>
      world(taskDependencies, {
        tasks: tasks.map((t) => ({ ...t, status: t.id === 'k16' ? 'todo' : 'done' })),
      }),
    )
    expect(await suggestDependencies('p1')).toEqual({ suggestions: [], truncated: false })
  })
})

describe('서버 갈래', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  it('계약의 경로와 메서드로 간다', async () => {
    const fake = vi.fn<(url: string, init?: RequestInit) => Response>((url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(
            JSON.stringify(
              url.endsWith('/suggest')
                ? { suggestions: [], truncated: true }
                : { taskId: 'a b', dependsOnId: 'c' },
            ),
            { status: 200 },
          ),
    )
    vi.stubGlobal('fetch', fake)

    await putTaskDependency('a b', 'c')
    expect(fake.mock.calls[0][0]).toBe('/api/tasks/a%20b/dependencies/c')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: undefined })

    await deleteTaskDependency('a b', 'c')
    expect(fake.mock.calls[1]).toEqual([
      '/api/tasks/a%20b/dependencies/c',
      expect.objectContaining({ method: 'DELETE' }),
    ])

    expect(await suggestDependencies('p1')).toEqual({ suggestions: [], truncated: true })
    expect(fake.mock.calls[2]).toEqual([
      '/api/projects/p1/dependencies/suggest',
      expect.objectContaining({ method: 'POST', body: undefined }),
    ])
  })

  it('서버의 오류 코드를 그대로 낸다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'TASK_DEPENDENCY_CYCLE', message: '순환이 생깁니다.' }),
            { status: 409 },
          ),
      ),
    )
    const e = await failure(putTaskDependency('k19', 'k21'))
    expect([e.status, e.code, e.message]).toEqual([
      409,
      'TASK_DEPENDENCY_CYCLE',
      '순환이 생깁니다.',
    ])
  })
})

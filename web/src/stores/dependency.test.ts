import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from './auth'
import { useDataStore } from './data'
import { useDependencySuggestStore } from './dependencySuggest'
import { useTaskStore } from './task'

/* 선행 작업 · 상태 기록 — 레코드는 데이터 스토어, 걸기 · 떼기는 작업 스토어(낙관적 반영 · 실패하면 되돌림) */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const pairs = () => useDataStore().taskDependencies.map((d) => `${d.dependsOnId}>${d.taskId}`)

beforeEach(async () => {
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('선행 작업', () => {
  it('작업 상세에 선행 · 기다리는 작업이 선다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k20')!
    expect(detail.dependsOn.map((t) => t.id)).toEqual(['k19'])
    expect(detail.dependents.map((t) => t.id)).toEqual(['k21', 'k22'])
  })

  it('걸면 바로 들어가고 남는다', async () => {
    const task = useTaskStore()
    expect(await task.addDependency('k16', 'k15')).toBeNull()
    expect(pairs()).toContain('k15>k16')
    expect(task.dependentsOf('k15').map((t) => t.id)).toEqual(['k16'])
  })

  it('순환이면 서버(목업)가 409 로 거절하고, 넣었던 것을 빼고 알린다', async () => {
    const task = useTaskStore()
    const failure = await task.addDependency('k19', 'k21')
    expect(failure).toBe('선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.')
    expect(pairs()).not.toContain('k21>k19')
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('quiet 면 까닭만 돌려주고 토스트는 안 띄운다', async () => {
    const failure = await useTaskStore().addDependency('k19', 'k21', { quiet: true })
    expect(failure).toBe('선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('떼면 바로 빠진다', async () => {
    const task = useTaskStore()
    expect(await task.removeDependency('k21', 'k20')).toBe(true)
    expect(pairs()).not.toContain('k20>k21')
  })

  it('고르기 목록 — 자기 · 이미 건 것은 없고, 순환이 되는 것은 까닭이 붙는다', () => {
    const choices = useTaskStore().dependencyChoicesFor('k19')
    expect(choices.some((c) => c.task.id === 'k19')).toBe(false)
    /* 연관 작업(HW-4)도 선행으로 고를 수 있다 (Q61) */
    expect(choices.find((c) => c.task.id === 'k4')!.problem).toBeNull()
    expect(choices.find((c) => c.task.id === 'k21')!.problem).toBe('cycle')
  })

  it('서버 모드 — 응답 전에 먼저 넣고, 거절되면 뺀다', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
    setActivePinia(createPinia())
    const data = useDataStore()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'TASK_DEPENDENCY_CYCLE', message: '순환' }), {
            status: 409,
          }),
      ),
    )
    const pending = useTaskStore().addDependency('k19', 'k21')
    expect(data.taskDependencies).toContainEqual({ taskId: 'k19', dependsOnId: 'k21' })
    expect(await pending).toBe('순환')
    expect(data.taskDependencies).not.toContainEqual({ taskId: 'k19', dependsOnId: 'k21' })
  })

  it('서버 모드 — 떼기가 실패하면 다시 넣는다', async () => {
    const data = useDataStore()
    const task = useTaskStore()
    vi.stubEnv('VITE_USE_MOCK', 'false')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'TASK_NOT_FOUND', message: '없습니다.' }), {
            status: 404,
          }),
      ),
    )
    expect(await task.removeDependency('k21', 'k20')).toBe(false)
    expect(data.taskDependencies).toContainEqual({ taskId: 'k21', dependsOnId: 'k20' })
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})

describe('상태 기록', () => {
  it('상태가 바뀌면 statusChangedAt 이 지금으로, backfill 은 false 로', () => {
    const data = useDataStore()
    const k20 = data.allTasks.find((t) => t.id === 'k20')!
    k20.statusSinceBackfill = true
    useTaskStore().setStatus('k20', 'done')
    expect(Date.now() - Date.parse(k20.statusChangedAt)).toBeLessThan(5_000)
    expect(k20.statusSinceBackfill).toBe(false)
  })

  it('그대로인 상태는 기록하지 않는다', () => {
    const k22 = useDataStore().allTasks.find((t) => t.id === 'k22')!
    useTaskStore().setStatus('k22', 'blocked')
    expect(k22.statusChangedAt).toBe('2026-10-13T00:00:00Z')
  })

  it('목업으로 만든 작업도 만든 시각부터다', async () => {
    const task = useTaskStore()
    const id = await task.addTask({
      title: '새 작업',
      body: [],
      status: 'doing',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    const made = useDataStore().allTasks.find((t) => t.id === id)!
    expect(made.statusChangedAt).toBe(made.createdAt)
    expect(made.statusSinceBackfill).toBe(false)

    const batch = await task.addTaskBatch([
      {
        tempId: 't1',
        relatedId: null,
        title: '초안',
        ownerId: null,
        start: null,
        due: null,
        priority: 'normal',
      },
    ])
    expect(batch!.tasks[0].statusChangedAt).toBe(batch!.tasks[0].createdAt)
  })
})

describe('AI 선행 관계 찾기', () => {
  it('제안을 받아 줄마다 적용 · 버리기', async () => {
    const suggest = useDependencySuggestStore()
    await suggest.load()
    expect(suggest.status).toBe('ready')
    expect(suggest.rows.map((r) => r.suggestion.taskId)).toEqual(['k16', 'k18'])

    await suggest.apply(suggest.rows[0])
    expect(suggest.rows[0].state).toBe('applied')
    expect(pairs()).toContain('k15>k16')

    suggest.discard(suggest.rows[1])
    expect(suggest.rows).toHaveLength(1)
    expect(pairs()).not.toContain('k3>k18')
  })

  it('[모두 적용] — 거절된 줄에는 까닭이 남는다', async () => {
    const suggest = useDependencySuggestStore()
    await suggest.load()
    /* 받은 뒤 누가 반대 방향을 걸어 두면 그 줄은 순환이 된다 */
    useDataStore().taskDependencies.push({ taskId: 'k3', dependsOnId: 'k18' })
    await suggest.applyAll()
    expect(suggest.rows.map((r) => r.state)).toEqual(['applied', 'failed'])
    expect(suggest.rows[1].error).toBe('선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('프로젝트를 바꾸면 버린다', async () => {
    const suggest = useDependencySuggestStore()
    await suggest.load()
    useDataStore().setProject('p2')
    await Promise.resolve()
    expect(suggest.status).toBe('idle')
    expect(suggest.rows).toEqual([])
  })
})

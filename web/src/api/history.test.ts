import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { fetchTaskHistory, fetchTestHistory, recordMockHistory } from '@/api/history'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { createTasksBatch, resetMockTasks } from '@/api/tasks'
import {
  confirmTestBasis,
  createTest,
  deleteTestRef,
  patchTest,
  putTestRef,
  setTestStatus,
} from '@/api/tests'
import { MOCK_PASSWORD, tasks, testCases } from '@/fixtures'
import { change } from '@/lib/history'

/* 변경 이력 api (docs/api/history.md) — 목업은 시드 '등록' 줄 + 시연 둘을 들고, 목업 쓰기가 칸 규칙대로 줄을 남긴다 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('실패해야 했다')
}

async function as(email: string) {
  resetMockAuth()
  await login({ email, password: MOCK_PASSWORD })
}

const fields = (e: { changes: { field: string }[] }) => e.changes.map((c) => c.field)

describe('목업 갈래 — 시드', () => {
  beforeEach(() => as('u2@innoflow.local'))

  it('작업마다 등록 한 줄 — 바꾼 사람은 담당자, 등록 시각', async () => {
    const k4 = tasks.find((t) => t.id === 'k4')!
    expect(await fetchTaskHistory('k4')).toEqual([
      {
        id: expect.any(String),
        changedAt: k4.createdAt,
        changedBy: 'u3',
        backfilled: false,
        changes: [{ field: 'created', from: null, to: null, subject: '' }],
      },
    ])
    /* 담당자가 없는 작업은 바꾼 사람도 없다 */
    expect((await fetchTaskHistory('k1'))[0].changedBy).toBeNull()
  })

  it('k20 — 등록 뒤에 10/8 의 상태 todo → doing', async () => {
    const got = await fetchTaskHistory('k20')
    expect(got.map(fields)).toEqual([['created'], ['status']])
    expect(got[1]).toMatchObject({
      changedAt: '2026-10-08T00:00:00Z',
      changedBy: 'u3',
      changes: [{ field: 'status', from: 'todo', to: 'doing', subject: '' }],
    })
  })

  it('테스트마다 등록 한 줄(만든 사람) — HW-T7 은 실패 + 결과 메모를 한 줄로', async () => {
    const t7 = testCases.find((t) => t.id === 'tc7')!
    const got = await fetchTestHistory('tc7')
    expect(got[0]).toMatchObject({ changedAt: t7.createdAt, changedBy: 'u1', backfilled: false })
    expect(got[1]).toMatchObject({
      changedAt: t7.statusChangedAt,
      changedBy: 'u1',
      changes: [
        { field: 'status', from: 'testing', to: 'fail' },
        { field: 'resultNote', from: null, to: '관리 화면 주소를 직접 치면 열린다.' },
      ],
    })
    expect((await fetchTestHistory('tc1')).map(fields)).toEqual([['created']])
  })

  it('없거나 못 보는 프로젝트의 것은 404 TASK_NOT_FOUND · TEST_NOT_FOUND', async () => {
    expect((await failure(fetchTaskHistory('nope'))).code).toBe('TASK_NOT_FOUND')
    expect((await failure(fetchTestHistory('nope'))).code).toBe('TEST_NOT_FOUND')
    /* 부여를 거두면 그 프로젝트의 것은 없는 것처럼 */
    mockDb().grants = mockDb().grants.filter((g) => !(g.memberId === 'u2' && g.projectId === 'p1'))
    expect((await failure(fetchTaskHistory('k4'))).code).toBe('TASK_NOT_FOUND')
    expect((await failure(fetchTestHistory('tc1'))).code).toBe('TEST_NOT_FOUND')
  })

  it('받은 것을 고쳐도 목업 저장소는 그대로다', async () => {
    const got = await fetchTaskHistory('k4')
    got[0].changes.push(change('body', null, null))
    expect((await fetchTaskHistory('k4'))[0].changes).toHaveLength(1)
  })
})

describe('목업 갈래 — 한 곳에서 남기기', () => {
  beforeEach(() => as('u2@innoflow.local'))

  it('남길 칸이 없으면 줄을 안 만들고, 칸은 표 순서로 놓고 바꾼 사람은 로그인한 사람', async () => {
    recordMockHistory('task', 'k4', [])
    expect(await fetchTaskHistory('k4')).toHaveLength(1)
    recordMockHistory('task', 'k4', [
      change('due', null, '2026-09-30'),
      change('ownerId', 'u3', 'u2'),
    ])
    const last = (await fetchTaskHistory('k4')).at(-1)!
    expect(last.changedBy).toBe('u2')
    expect(fields(last)).toEqual(['ownerId', 'due'])
  })

  it('한 번에 등록한 작업마다 등록 한 줄', async () => {
    resetMockTasks()
    const res = await createTasksBatch('p1', {
      tasks: [
        {
          tempId: 'a',
          parentTempId: null,
          parentId: null,
          title: '새 작업',
          ownerId: null,
          start: null,
          due: null,
          priority: 'normal',
        },
      ],
    })
    expect(mockDb().taskHistory[res.tasks[0].id].map(fields)).toEqual([['created']])
  })
})

describe('목업 갈래 — 테스트 쓰기의 칸 규칙', () => {
  beforeEach(() => as('u1@innoflow.local'))

  const last = async (testId: string) => (await fetchTestHistory(testId)).at(-1)!

  it('추가하면 등록 한 줄', async () => {
    const made = await createTest('p1', { title: '새 테스트' })
    expect((await fetchTestHistory(made.id)).map(fields)).toEqual([['created']])
  })

  it('PATCH 는 바뀐 칸만 — 같은 값만 보내면 줄이 없고, 테스트 내용은 글 값으로', async () => {
    await patchTest('tc2', { title: '올바른 계정으로 로그인' })
    expect(await fetchTestHistory('tc2')).toHaveLength(1)

    const before = testCases.find((t) => t.id === 'tc2')!.content
    await patchTest('tc2', {
      due: '2026-10-12',
      title: '  올바른 계정으로 로그인  ',
      content: '새 내용',
    })
    expect((await last('tc2')).changes).toEqual([
      change('content', before, '새 내용'),
      change('due', '2026-10-10', '2026-10-12'),
    ])
  })

  it('상태는 같은 상태로 다시 보내도 남고, 결과 메모는 바뀔 때만 뒤따른다', async () => {
    await setTestStatus('tc3', { status: 'testing' })
    expect((await last('tc3')).changes).toEqual([change('status', 'testing', 'testing')])

    await setTestStatus('tc3', { status: 'fail', note: '안 잠긴다' })
    expect((await last('tc3')).changes).toEqual([
      change('status', 'testing', 'fail'),
      change('resultNote', null, '안 잠긴다'),
    ])

    /* 성공으로 돌리면 메모가 비워진다 — 빈 메모는 '' 가 아니라 null */
    await setTestStatus('tc3', { status: 'pass' })
    expect((await last('tc3')).changes).toEqual([
      change('status', 'fail', 'pass'),
      change('resultNote', '안 잠긴다', null),
    ])
  })

  it('태그는 새로 걸 때 · 있던 것을 뗄 때만, 기준 확인은 basis', async () => {
    await putTestRef('tc1', { kind: 'task', id: 'k4' })
    expect((await last('tc1')).changes).toEqual([change('taskRef', null, 'k4')])
    await putTestRef('tc1', { kind: 'task', id: 'k4' })
    await deleteTestRef('tc1', { kind: 'thread', id: 't1' })
    expect(await fetchTestHistory('tc1')).toHaveLength(2)

    await deleteTestRef('tc1', { kind: 'task', id: 'k4' })
    expect((await last('tc1')).changes).toEqual([change('taskRef', 'k4', null)])

    await confirmTestBasis('tc4')
    expect((await last('tc4')).changes).toEqual([change('basis', null, null)])
  })
})

describe('서버 갈래', () => {
  it('GET /tasks/{id}/history · /tests/{id}/history', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
    const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fake)
    expect(await fetchTaskHistory('k 4')).toEqual([])
    await fetchTestHistory('tc1')
    expect(fake.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/tasks/k%204/history', 'GET'],
      ['/api/tests/tc1/history', 'GET'],
    ])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login, logout } from '@/api/auth'
import { confirmCheck, fetchCheckPendingCount, fetchChecks, sendCheck } from '@/api/checks'
import { ApiError } from '@/api/client'
import { type MockWorld, provideMockWorld, resetMockAuth } from '@/api/mockAuth'
import { entries, MOCK_PASSWORD, taskThreadLinks, tasks, threads } from '@/fixtures'
import type { Entry, Task, Thread } from '@/types/domain'

/* 확인 요청 — 목업 갈래가 서버와 같은 검사 · 같은 코드를 내는지, 서버 갈래가 계약의 경로로 가는지 본다
   (docs/api/check.md) */
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

/* 화면에서 만든 목업 안건처럼 픽스처에 없는 세상 — 데이터 스토어가 알려 주는 자리를 테스트가 대신 채운다 */
function world(patch: Partial<Thread> = {}, extra: Partial<MockWorld> = {}): MockWorld {
  const thread: Thread = {
    id: 'nt1',
    projectId: 'p1',
    title: '새 안건',
    description: '',
    options: [],
    dueDate: null,
    state: 'decided',
    ownerId: null,
    parentThreadId: null,
    partId: null,
    ccIds: [],
    createdAt: '2026-10-19T00:00:00Z',
    minutesId: null,
    ...patch,
  }
  const entry: Entry = {
    id: 'ne1',
    threadId: thread.id,
    kind: 'decide',
    text: '정했다',
    detail: [],
    note: '',
    ownerId: null,
    createdAt: '2026-10-19T00:00:00Z',
    minutesId: null,
  }
  return {
    threads: [...threads, thread],
    entries: [...entries, entry],
    tasks: [...tasks],
    taskThreads: [...taskThreadLinks],
    ...extra,
  }
}

const task = (id: string, ownerId: string | null): Task => ({
  ...tasks[0],
  id,
  key: id,
  ownerId,
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

  it('시드 넷을 seq 순서로 낸다 — 다른 프로젝트는 비고, 부여받지 않은 곳은 404', async () => {
    expect((await fetchChecks('p1')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(await fetchChecks('p2')).toEqual([])

    await logout()
    await signIn('u2@innoflow.local')
    expect((await failure(fetchChecks('p3'))).code).toBe('PROJECT_NOT_FOUND')
  })

  it('t6 을 보내면 참조 u2 에게 한 줄 — 최근 결정(e6)에 묶이고, 다시 누르면 409', async () => {
    const made = await sendCheck('t6')
    expect(made).toEqual([
      {
        id: expect.any(String),
        projectId: 'p1',
        threadId: 't6',
        entryId: 'e6',
        senderId: 'u1',
        recipientId: 'u2',
        createdAt: expect.any(String),
        confirmedAt: null,
      },
    ])
    expect((await fetchChecks('p1')).at(-1)!.id).toBe(made[0].id)

    const again = await failure(sendCheck('t6'))
    expect([again.status, again.code]).toEqual([409, 'CHECK_ALREADY_SENT'])
    /* 시드의 t2 도 이미 보냈다 */
    expect((await failure(sendCheck('t2'))).code).toBe('CHECK_ALREADY_SENT')
  })

  it('결정을 바꾸면(change 이력) 다시 보낼 수 있다', async () => {
    const change: Entry = { ...world().entries.at(-1)!, id: 'ne2', threadId: 't2', kind: 'change' }
    provideMockWorld(() => ({
      threads,
      entries: [...entries, change],
      tasks,
      taskThreads: taskThreadLinks,
    }))
    const made = await sendCheck('t2')
    expect(made.map((c) => [c.entryId, c.recipientId])).toEqual([
      ['ne2', 'u3'],
      ['ne2', 'u2'],
      ['ne2', 'u4'],
    ])
  })

  it('검사 순서 — 안건 → 결정됨 → 이미 보냄 → 받을 사람', async () => {
    expect((await failure(sendCheck('없음'))).code).toBe('THREAD_NOT_FOUND')
    const open = await failure(sendCheck('t3'))
    expect([open.status, open.code]).toEqual([400, 'CHECK_THREAD_NOT_DECIDED'])

    /* 결정 상태여도 결정 이력이 없으면 결정 전이다 */
    const w = world({ ccIds: ['u2'] })
    w.entries = [...entries]
    provideMockWorld(() => w)
    expect((await failure(sendCheck('nt1'))).code).toBe('CHECK_THREAD_NOT_DECIDED')

    /* 참조가 나 하나뿐 */
    provideMockWorld(() => world({ ccIds: ['u1'] }))
    const none = await failure(sendCheck('nt1'))
    expect([none.status, none.code]).toEqual([400, 'CHECK_NO_RECIPIENTS'])
  })

  it('받는 사람 — 연결 작업 담당자(작업 순) → 참조, 겹침 · 나 · 비활성 · 비부여는 빠진다', async () => {
    provideMockWorld(() =>
      world(
        { ccIds: ['u2', 'u4', 'u1', 'u0', 'u3'] },
        {
          /* u5 는 비활성, u0 은 p1 에 부여되지 않았다 */
          tasks: [task('x1', 'u3'), task('x2', 'u5'), task('x3', null), task('x4', 'u2')],
          taskThreads: ['x1', 'x2', 'x3', 'x4'].map((taskId) => ({ taskId, threadId: 'nt1' })),
        },
      ),
    )
    const made = await sendCheck('nt1')
    expect(made.map((c) => c.recipientId)).toEqual(['u3', 'u2', 'u4'])
    expect(made.every((c) => c.entryId === 'ne1' && c.createdAt === made[0].createdAt)).toBe(true)
  })

  it('확인은 받은 사람만 — 남은 403, 두 번 해도 처음 시각 그대로', async () => {
    expect((await failure(confirmCheck('c1'))).code).toBe('FORBIDDEN')
    expect((await failure(confirmCheck('c2'))).code).toBe('FORBIDDEN')
    expect((await failure(confirmCheck('없음'))).code).toBe('CHECK_NOT_FOUND')

    const first = await confirmCheck('c4')
    expect(first.confirmedAt).not.toBeNull()
    expect(await confirmCheck('c4')).toEqual(first)
  })

  it('남의 프로젝트 안건 · 요청은 없는 것처럼 404', async () => {
    provideMockWorld(() => world({ projectId: 'p3', ccIds: ['u4'] }))
    const [made] = await sendCheck('nt1')
    expect(made.projectId).toBe('p3')
    await logout()
    await signIn('u2@innoflow.local')
    expect((await failure(confirmCheck(made.id))).code).toBe('CHECK_NOT_FOUND')
    expect((await failure(sendCheck('nt1'))).code).toBe('THREAD_NOT_FOUND')
  })

  it('대기 수 — 모든 프로젝트 합과 프로젝트별, 확인하면 준다', async () => {
    expect(await fetchCheckPendingCount()).toEqual({ total: 1, byProject: { p1: 1 } })
    await confirmCheck('c4')
    expect(await fetchCheckPendingCount()).toEqual({ total: 0, byProject: {} })
  })
})

describe('서버 갈래', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('계약의 경로와 메서드로 간다', async () => {
    const fake = vi.fn<(url: string, init?: RequestInit) => Response>((url) =>
      json(url.endsWith('pending-count') ? { total: 0, byProject: {} } : []),
    )
    vi.stubGlobal('fetch', fake)

    await fetchChecks('p 1')
    await sendCheck('t/2')
    await confirmCheck('c/1')
    await fetchCheckPendingCount()

    expect(fake.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/projects/p%201/checks', 'GET'],
      ['/api/threads/t%2F2/checks', 'POST'],
      ['/api/checks/c%2F1/confirm', 'POST'],
      ['/api/checks/pending-count', 'GET'],
    ])
    /* 보내기 · 확인은 본문이 없다 — Content-Type 도 싣지 않는다 */
    expect(fake.mock.calls[1][1]?.body).toBeUndefined()
    expect(fake.mock.calls[1][1]?.headers).toBeUndefined()
    expect(fake.mock.calls[2][1]?.body).toBeUndefined()
  })

  it('서버 오류는 ApiError 로 모인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json(
          {
            code: 'CHECK_ALREADY_SENT',
            message: '이 결정은 이미 확인을 요청했습니다.',
          },
          409,
        ),
      ),
    )
    const e = await failure(sendCheck('t6'))
    expect([e.status, e.code, e.message]).toEqual([
      409,
      'CHECK_ALREADY_SENT',
      '이 결정은 이미 확인을 요청했습니다.',
    ])
  })
})

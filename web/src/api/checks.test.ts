import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login, logout } from '@/api/auth'
import { confirmCheck, fetchCheckPendingCount, fetchChecks, sendCheck } from '@/api/checks'
import { ApiError } from '@/api/client'
import { type MockWorld, provideMockWorld, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD, taskAgendaLinks, tasks, agendas } from '@/fixtures'
import type { Task, Agenda } from '@/types/domain'

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

const task = (id: string, ownerId: string | null): Task => ({
  ...tasks[0],
  id,
  key: id,
  ownerId,
})

/* 화면에서 만든 목업 안건처럼 픽스처에 없는 세상 — 데이터 스토어가 알려 주는 자리를 테스트가 대신 채운다.
   새 안건 nt1 은 결정 판 1 로 정해졌고, 담당 u3 · u2 작업 둘에 걸려 있다 */
function world(patch: Partial<Agenda> = {}, extra: Partial<MockWorld> = {}): MockWorld {
  const agenda: Agenda = {
    id: 'nt1',
    projectId: 'p1',
    title: '새 안건',
    description: '',
    decision: '정했다',
    state: 'decided',
    ownerId: null,
    creatorId: null,
    dueDate: null,
    partId: null,
    createdAt: '2026-10-19T00:00:00Z',
    decidedAt: '2026-10-19T00:00:00Z',
    decisionRev: 1,
    minutesId: null,
    ...patch,
  }
  return {
    agendas: [...agendas, agenda],
    tasks: [...tasks, task('nk1', 'u3'), task('nk2', 'u2')],
    taskAgendas: [
      ...taskAgendaLinks,
      { taskId: 'nk1', agendaId: 'nt1' },
      { taskId: 'nk2', agendaId: 'nt1' },
    ],
    ...extra,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  provideMockWorld(null)
})

describe('목업 갈래', () => {
  beforeEach(async () => {
    resetMockAuth()
    await signIn('u1@inno-ax.com')
  })

  it('시드 넷을 seq 순서로 낸다 — 다른 프로젝트는 비고, 부여받지 않은 곳은 404', async () => {
    expect((await fetchChecks('p1')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(await fetchChecks('p2')).toEqual([])

    await logout()
    await signIn('u2@inno-ax.com')
    expect((await failure(fetchChecks('p3'))).code).toBe('PROJECT_NOT_FOUND')
  })

  it('보내면 연결 작업 담당자마다 한 줄 — 지금 결정 판 · 결정내용을 찍고, 다시 누르면 409', async () => {
    provideMockWorld(() => world())
    const made = await sendCheck('nt1')
    expect(made).toEqual(
      ['u3', 'u2'].map((recipientId) => ({
        id: expect.any(String),
        projectId: 'p1',
        agendaId: 'nt1',
        decisionRev: 1,
        decision: '정했다',
        senderId: 'u1',
        recipientId,
        createdAt: made[0].createdAt,
        confirmedAt: null,
      })),
    )
    expect((await fetchChecks('p1')).at(-1)!.id).toBe(made[1].id)

    const again = await failure(sendCheck('nt1'))
    expect([again.status, again.code]).toEqual([409, 'CHECK_ALREADY_SENT'])
    /* 시드의 t2 도 이 판으로 이미 보냈다 */
    expect((await failure(sendCheck('t2'))).code).toBe('CHECK_ALREADY_SENT')
  })

  it('결정 판이 오르면 다시 보낼 수 있다', async () => {
    provideMockWorld(() => ({
      agendas: agendas.map((t) =>
        t.id === 't2' ? { ...t, decision: 'mysql 8.4 를 쓴다', decisionRev: 2 } : t,
      ),
      tasks,
      taskAgendas: taskAgendaLinks,
    }))
    const made = await sendCheck('t2')
    expect(made.map((c) => [c.decisionRev, c.decision, c.recipientId])).toEqual([
      [2, 'mysql 8.4 를 쓴다', 'u3'],
    ])
  })

  it('검사 순서 — 안건 → 결정됨 → 이미 보냄 → 받을 사람', async () => {
    expect((await failure(sendCheck('없음'))).code).toBe('AGENDA_NOT_FOUND')
    const open = await failure(sendCheck('t3'))
    expect([open.status, open.code]).toEqual([400, 'CHECK_AGENDA_NOT_DECIDED'])

    /* 연결 작업이 없으면 받을 사람이 없다 — 참조는 없어졌다 */
    const none = await failure(sendCheck('t6'))
    expect([none.status, none.code]).toEqual([400, 'CHECK_NO_RECIPIENTS'])
  })

  it('받는 사람 — 연결 작업 담당자(작업 순)만, 겹침 · 나 · 비활성 · 비부여는 빠진다', async () => {
    const ids = ['nk1', 'nk2', 'nk3', 'nk4', 'nk5', 'nk6', 'nk7']
    const owners = ['u3', 'u5', null, 'u2', 'u1', 'u0', 'u3']
    /* u5 는 비활성, u0 은 p1 에 부여되지 않았다 */
    provideMockWorld(() =>
      world(
        {},
        {
          tasks: ids.map((id, i) => task(id, owners[i])),
          taskAgendas: ids.map((taskId) => ({ taskId, agendaId: 'nt1' })),
        },
      ),
    )
    const made = await sendCheck('nt1')
    expect(made.map((c) => c.recipientId)).toEqual(['u3', 'u2'])
    expect(made.every((c) => c.decisionRev === 1 && c.createdAt === made[0].createdAt)).toBe(true)
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
    provideMockWorld(() => world({ projectId: 'p3' }, { tasks: [task('nk1', 'u4')] }))
    const [made] = await sendCheck('nt1')
    expect(made.projectId).toBe('p3')
    await logout()
    await signIn('u2@inno-ax.com')
    expect((await failure(confirmCheck(made.id))).code).toBe('CHECK_NOT_FOUND')
    expect((await failure(sendCheck('nt1'))).code).toBe('AGENDA_NOT_FOUND')
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
      ['/api/agendas/t%2F2/checks', 'POST'],
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

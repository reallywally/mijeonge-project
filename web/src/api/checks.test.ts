import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login, logout } from '@/api/auth'
import { confirmCheck, fetchCheckPendingCount, fetchChecks, sendCheck } from '@/api/checks'
import { ApiError } from '@/api/client'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import type { CheckRequestInput } from '@/types/domain'

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

const input = (patch: Partial<CheckRequestInput> = {}): CheckRequestInput => ({
  targetType: 'task',
  targetId: 'k22',
  recipientIds: ['u3'],
  text: '봐 주세요',
  ...patch,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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

  it('받는 사람 수만큼, recipientIds 순서로 · 겹친 사람은 하나로 · 같은 text 와 createdAt', async () => {
    const made = await sendCheck(
      'p1',
      input({ recipientIds: ['u4', 'u2', 'u4'], text: '  봐 주세요 ' }),
    )
    expect(made.map((c) => c.recipientId)).toEqual(['u4', 'u2'])
    expect(made.every((c) => c.senderId === 'u1' && c.text === '봐 주세요')).toBe(true)
    expect(made[0].createdAt).toBe(made[1].createdAt)
    expect(made.every((c) => c.confirmedAt === null && c.projectId === 'p1')).toBe(true)
    expect((await fetchChecks('p1')).slice(-2).map((c) => c.id)).toEqual(made.map((c) => c.id))
  })

  it('29자까지 — 30자 · 빈 글 · 사람 0명 · 21명은 422', async () => {
    expect(await sendCheck('p1', input({ text: '가'.repeat(29) }))).toHaveLength(1)

    const long = await failure(sendCheck('p1', input({ text: '가'.repeat(30) })))
    expect([long.status, long.code]).toEqual([422, 'VALIDATION_ERROR'])
    expect(long.detail).toHaveProperty('text')
    expect((await failure(sendCheck('p1', input({ text: '   ' })))).detail).toHaveProperty('text')
    expect((await failure(sendCheck('p1', input({ recipientIds: [] })))).status).toBe(422)
    const many = Array.from({ length: 21 }, () => 'u3')
    expect((await failure(sendCheck('p1', input({ recipientIds: many })))).status).toBe(422)
  })

  it('검사 순서 — 대상 → 나 자신 → 프로젝트 멤버', async () => {
    /* 안건 id 를 작업으로 · 다른 프로젝트의 작업 */
    const wrongKind = await failure(
      sendCheck('p1', input({ targetId: 't3', recipientIds: ['u1'] })),
    )
    expect([wrongKind.status, wrongKind.code]).toEqual([400, 'CHECK_TARGET_NOT_FOUND'])

    const self = await failure(sendCheck('p1', input({ recipientIds: ['u3', 'u1', 'u5'] })))
    expect(self.code).toBe('CHECK_RECIPIENT_SELF')
    expect(self.detail).toEqual({ 'recipientIds.1': expect.any(String) })

    /* u5 는 비활성, u0 은 p1 에 부여되지 않았다 */
    const outside = await failure(sendCheck('p1', input({ recipientIds: ['u3', 'u5', 'u0'] })))
    expect([outside.status, outside.code]).toEqual([400, 'MEMBER_NOT_IN_PROJECT'])
    expect(Object.keys(outside.detail ?? {})).toEqual(['recipientIds.1', 'recipientIds.2'])
  })

  it('확인은 받은 사람만 — 남은 403, 두 번 해도 처음 시각 그대로', async () => {
    expect((await failure(confirmCheck('c1'))).code).toBe('FORBIDDEN')
    expect((await failure(confirmCheck('없음'))).code).toBe('CHECK_NOT_FOUND')

    const first = await confirmCheck('c4')
    expect(first.confirmedAt).not.toBeNull()
    expect(await confirmCheck('c4')).toEqual(first)
    expect((await confirmCheck('c2')).confirmedAt).toBe('2026-10-14T05:00:00Z')
  })

  it('남의 프로젝트 요청은 없는 것처럼 404', async () => {
    const [made] = await sendCheck('p3', {
      targetType: 'task',
      targetId: 'nk-화면에서-만든-작업',
      recipientIds: ['u4'],
      text: '봐 주세요',
    })
    await logout()
    await signIn('u2@innoflow.local')
    expect((await failure(confirmCheck(made.id))).code).toBe('CHECK_NOT_FOUND')
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
    await sendCheck('p1', input())
    await confirmCheck('c/1')
    await fetchCheckPendingCount()

    expect(fake.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/projects/p%201/checks', 'GET'],
      ['/api/projects/p1/checks', 'POST'],
      ['/api/checks/c%2F1/confirm', 'POST'],
      ['/api/checks/pending-count', 'GET'],
    ])
    expect(JSON.parse(String(fake.mock.calls[1][1]?.body))).toEqual(input())
    /* 확인은 본문이 없다 — Content-Type 도 싣지 않는다 */
    expect(fake.mock.calls[2][1]?.body).toBeUndefined()
  })

  it('서버 오류는 ApiError 로 모인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json(
          {
            code: 'CHECK_RECIPIENT_SELF',
            message: '자기 자신에게는 확인 요청을 보낼 수 없습니다.',
          },
          400,
        ),
      ),
    )
    const e = await failure(sendCheck('p1', input()))
    expect([e.status, e.code, e.message]).toEqual([
      400,
      'CHECK_RECIPIENT_SELF',
      '자기 자신에게는 확인 요청을 보낼 수 없습니다.',
    ])
  })
})

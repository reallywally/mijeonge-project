import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { resetMockAuth } from '@/api/mockAuth'
import {
  confirmTestBasis,
  createTest,
  deleteTest,
  deleteTestRef,
  fetchTest,
  fetchTests,
  patchTest,
  putTestRef,
  setTestStatus,
} from '@/api/tests'
import { MOCK_PASSWORD } from '@/fixtures'

/* 테스트 api (docs/api/test.md) — 목업은 서버와 같은 규칙으로 며칠째 · 신호 · 기준 바뀜을 세고 같은 오류를 낸다 */
afterEach(() => {
  vi.useRealTimers()
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

describe('목업 갈래 — 시드', () => {
  beforeEach(async () => {
    await as('u2@inno-ax.com')
    /* 계약의 검사 날 — 리스크 · 리포트와 같다 */
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
  })

  it('계약 표의 여덟 줄이 seq 순으로 나오고 표의 신호가 붙는다', async () => {
    const got = await fetchTests('p1')
    expect(got.map((t) => [t.key, t.signals])).toEqual([
      ['HW-T1', []],
      ['HW-T2', []],
      ['HW-T3', ['longRunning', 'overdue']],
      ['HW-T4', ['notStarted', 'basisChanged']],
      ['HW-T5', []],
      ['HW-T6', ['longBlocked']],
      ['HW-T7', ['failedIdle']],
      ['HW-T8', []],
    ])
    const t8 = got.find((t) => t.key === 'HW-T8')!
    expect(t8.statusDays).toBe(1)
    expect(got.find((t) => t.key === 'HW-T4')!.changedEntryIds).toEqual(['e3'])
    /* 태그한 작업으로 안건에 닿지만 바뀐 것이 없다 */
    expect(got.find((t) => t.key === 'HW-T2')!.changedEntryIds).toEqual([])
    expect(got.find((t) => t.key === 'HW-T7')!).toMatchObject({
      resultNote: '관리 화면 주소를 직접 치면 열린다.',
    })
  })

  it('못 보는 프로젝트 · 없는 테스트는 404', async () => {
    expect((await failure(fetchTests('p3'))).code).toBe('PROJECT_NOT_FOUND')
    expect((await failure(fetchTest('nope'))).code).toBe('TEST_NOT_FOUND')
  })
})

describe('목업 갈래 — 쓰기', () => {
  beforeEach(async () => {
    await as('u2@inno-ax.com')
  })

  it('만들면 다음 번호 · 작성 중 · 만든 사람이 찍히고, 파트는 상위를 따른다', async () => {
    const made = await createTest('p1', {
      title: '  관리자 계정 잠금 해제  ',
      parentId: 'tc5',
      content: '단계\n1. 관리자가 [잠금 풀기] → 다시 로그인된다',
      refs: [
        { kind: 'thread', id: 't2' },
        { kind: 'task', id: 'k21' },
        { kind: 'task', id: 'k21' },
      ],
    })
    expect(made).toMatchObject({
      key: 'HW-T9',
      title: '관리자 계정 잠금 해제',
      status: 'draft',
      statusChangedBy: 'u2',
      createdBy: 'u2',
      partId: 'pt1',
      statusDays: 0,
      changedEntryIds: [],
      content: '단계\n1. 관리자가 [잠금 풀기] → 다시 로그인된다',
      /* 겹친 태그는 하나로, 작업 먼저 */
      refs: [
        { kind: 'task', id: 'k21' },
        { kind: 'thread', id: 't2' },
      ],
    })
    /* 지운 번호는 다시 쓰지 않는다 */
    await deleteTest(made.id)
    expect((await createTest('p1', { title: '다음' })).key).toBe('HW-T10')
  })

  it('검사 — 모양 422 · 상위 · 담당자 · 태그', async () => {
    const bad = await failure(
      createTest('p1', {
        title: ' ',
        content: 'a'.repeat(10001),
        start: '2026-10-09',
        due: '2026-10-08',
      }),
    )
    expect([bad.status, bad.code]).toEqual([422, 'VALIDATION_ERROR'])
    expect(Object.keys(bad.detail ?? {})).toEqual(['title', 'content', 'due'])

    expect((await failure(createTest('p1', { title: 'a', parentId: 'x' }))).code).toBe(
      'TEST_PARENT_NOT_FOUND',
    )
    expect((await failure(createTest('p1', { title: 'a', ownerId: 'u5' }))).code).toBe(
      'TEST_OWNER_NOT_FOUND',
    )
    expect(
      (await failure(createTest('p1', { title: 'a', refs: [{ kind: 'task', id: 'x1' }] }))).code,
    ).toBe('TASK_NOT_FOUND')
    const many = Array.from({ length: 21 }, (_, i) => ({ kind: 'task' as const, id: `k${i + 1}` }))
    expect((await failure(createTest('p1', { title: 'a', refs: many }))).code).toBe(
      'TEST_REF_LIMIT',
    )
  })

  it('상위 — 자기 · 자손은 고리라 막는다', async () => {
    expect((await failure(patchTest('tc1', { parentId: 'tc1' }))).code).toBe('TEST_PARENT_SELF')
    expect((await failure(patchTest('tc1', { parentId: 'tc3' }))).code).toBe(
      'TEST_PARENT_DESCENDANT',
    )
    expect((await patchTest('tc3', { parentId: 'tc5' })).parentId).toBe('tc5')
  })

  it('상태 — 실패는 메모, 묶음은 직접 못 돌린다, 다른 상태로 가면 메모를 비운다', async () => {
    const e = await failure(setTestStatus('tc3', { status: 'fail', note: ' ' }))
    expect([e.status, Object.keys(e.detail ?? {})]).toEqual([422, ['note']])
    expect((await failure(setTestStatus('tc1', { status: 'testing' }))).code).toBe(
      'TEST_GROUP_STATUS',
    )

    const failed = await setTestStatus('tc3', {
      status: 'fail',
      note: ' 잠기지 않음 ',
    })
    expect(failed).toMatchObject({
      status: 'fail',
      resultNote: '잠기지 않음',
      statusDays: 0,
    })
    const again = await setTestStatus('tc3', { status: 'testing', note: '버린다' })
    expect(again).toMatchObject({ status: 'testing', resultNote: '' })
  })

  it('태그 걸기 · 떼기는 멱등이고, 기준을 새로 찍는다 · [그대로 맞다] 로 기준 바뀜이 풀린다', async () => {
    expect((await fetchTest('tc4')).changedEntryIds).toEqual(['e3'])
    expect((await confirmTestBasis('tc4')).changedEntryIds).toEqual([])

    const tagged = await putTestRef('tc7', { kind: 'thread', id: 't1' })
    expect(tagged.refs).toEqual([{ kind: 'thread', id: 't1' }])
    expect((await putTestRef('tc7', { kind: 'thread', id: 't1' })).refs).toHaveLength(1)
    await deleteTestRef('tc7', { kind: 'thread', id: 't1' })
    await deleteTestRef('tc7', { kind: 'thread', id: 't1' })
    expect((await fetchTest('tc7')).refs).toEqual([])
  })

  it('지우기 — 만든 사람 · 관리자만, 하위가 있으면 409', async () => {
    await as('u3@inno-ax.com')
    expect((await failure(deleteTest('tc2'))).status).toBe(403)

    await as('u2@inno-ax.com')
    expect((await failure(deleteTest('tc1'))).code).toBe('TEST_HAS_CHILDREN')
    await deleteTest('tc2')
    expect((await fetchTests('p1')).map((t) => t.id)).not.toContain('tc2')

    /* 프로젝트 관리자는 남이 만든 것도 지운다 */
    await as('u1@inno-ax.com')
    await deleteTest('tc4')
  })
})

describe('서버 갈래', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  const json = (body: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('계약의 경로와 메서드로 간다', async () => {
    const fake = vi.fn<(url: string, init?: RequestInit) => Response>((url, init) =>
      init?.method === 'DELETE' ? json(null, 204) : json(url.endsWith('/tests') ? [] : {}),
    )
    vi.stubGlobal('fetch', fake)

    await fetchTests('p 1')
    await createTest('p1', { title: 'a' })
    await fetchTest('t/1')
    await patchTest('t1', { title: 'b' })
    await deleteTest('t1')
    await setTestStatus('t1', { status: 'pass' })
    await putTestRef('t1', { kind: 'task', id: 'k/4' })
    await deleteTestRef('t1', { kind: 'thread', id: 't2' })
    await confirmTestBasis('t1')

    expect(fake.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/projects/p%201/tests', 'GET'],
      ['/api/projects/p1/tests', 'POST'],
      ['/api/tests/t%2F1', 'GET'],
      ['/api/tests/t1', 'PATCH'],
      ['/api/tests/t1', 'DELETE'],
      ['/api/tests/t1/status', 'POST'],
      ['/api/tests/t1/refs/task/k%2F4', 'PUT'],
      ['/api/tests/t1/refs/thread/t2', 'DELETE'],
      ['/api/tests/t1/basis', 'POST'],
    ])
    /* 태그 걸기 · 기준은 본문이 없다 */
    expect(fake.mock.calls[6][1]?.body).toBeUndefined()
    expect(fake.mock.calls[8][1]?.body).toBeUndefined()
  })

  it('서버 오류는 ApiError 로 모인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json(
          { code: 'TEST_HAS_CHILDREN', message: '하위 테스트가 있는 테스트는 지울 수 없습니다.' },
          409,
        ),
      ),
    )
    const e = await failure(deleteTest('t1'))
    expect([e.status, e.code]).toEqual([409, 'TEST_HAS_CHILDREN'])
  })
})

// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { CHECK_BADGE_INTERVAL_MS, useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import { useAgendaStore } from '@/stores/agenda'
import type { CheckRequest } from '@/types/domain'

/* 확인 요청 — 프로젝트의 요청 전부를 받아 받은 것 · 보낸 것 · 안건별로 거르고 줄 세운다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string) {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
}

async function switchTo(email: string) {
  await useAuthStore().logout()
  await signedIn(email)
}

const ids = (rows: CheckRequest[]) => rows.map((c) => c.id)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('거르기 · 정렬', () => {
  it('u1 — 받은 것은 c4 하나(대기), 보낸 것은 t2 묶음 하나(3명 중 1명 확인)', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()

    expect(ids(checks.received)).toEqual(['c4'])
    expect(ids(checks.receivedPending)).toEqual(['c4'])
    expect(
      checks.sent.map((b) => [b.agendaId, b.decisionRev, b.decision, ids(b.rows), b.confirmed]),
    ).toEqual([['t2', 1, 'mysql 을 쓴다', ['c1', 'c2', 'c3'], 1]])
    expect(checks.canConfirm(checks.received[0])).toBe(true)
    /* 남이 받은 대기는 [확인] 할 수 없다 */
    expect(checks.canConfirm(checks.sent[0].rows[0])).toBe(false)
  })

  it('u2 — 받은 것은 확인한 c2, 보낸 것은 없다 / u3 — 받은 c1 · 보낸 t1 묶음', async () => {
    await signedIn('u2@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(ids(checks.received)).toEqual(['c2'])
    expect(checks.receivedPending).toEqual([])
    expect(checks.sent).toEqual([])

    await switchTo('u3@inno-ax.com')
    const theirs = useCheckStore()
    await theirs.load()
    expect(ids(theirs.received)).toEqual(['c1'])
    expect(theirs.sent.map((b) => [b.key, ids(b.rows)])).toEqual([['t1#1', ['c4']]])
  })

  it('다른 프로젝트로 옮기면 옛 목록을 그리지 않는다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    useDataStore().setProject('p2')
    expect(checks.received).toEqual([])
    expect(checks.loaded).toBe(false)
  })
})

/* t6 은 결정됐지만 연결 작업이 없다 — 박지훈(u2) 담당 작업 k3 을 걸어 받을 사람을 만든다 */
const linkT6 = () => useDataStore().taskAgendas.push({ taskId: 'k3', agendaId: 't6' })

describe('안건 상세의 [확인 요청]', () => {
  it('t6 — 결정됨 · 안 보냄 · 받을 사람(연결 작업 담당 u2) 있음이라 누를 수 있다', async () => {
    await signedIn('u1@inno-ax.com')
    linkT6()
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forAgenda('t6')).toMatchObject({
      decision: expect.stringContaining('테스트 기간만 2주 줄인다'),
      recipientIds: ['u2'],
      block: null,
      current: null,
      older: [],
    })
  })

  it('목록을 받기 전에는 보냈는지 몰라 누를 수 없다', async () => {
    await signedIn('u1@inno-ax.com')
    linkT6()
    expect(useCheckStore().forAgenda('t6')?.block).toBe('sent')
  })

  it('결정 전 · 이미 보냄 · 받을 사람 없음', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forAgenda('t3')).toMatchObject({ decision: null, block: 'not-decided' })

    const t2 = checks.forAgenda('t2')!
    expect(t2.block).toBe('sent')
    expect([t2.current?.confirmed, t2.current?.rows.length]).toEqual([1, 3])

    /* 연결 작업도 참조도 없으면 받을 사람이 없다 */
    expect(checks.forAgenda('t6')).toMatchObject({ recipientIds: [], block: 'no-recipients' })
  })

  it('누른 사람은 받는 사람에서 빠진다 — u2 에게 t6 은 받을 사람이 없다', async () => {
    await signedIn('u2@inno-ax.com')
    linkT6()
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forAgenda('t6')?.block).toBe('no-recipients')
  })

  it('결정내용을 바꾸면(판이 오르면) 다시 누를 수 있고, 앞 판 묶음은 접힌 쪽으로 간다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(useAgendaStore().updateAgenda('t2', { decision: 'PostgreSQL 로 바꾼다' })).toBe(true)

    const next = checks.forAgenda('t2')!
    expect(next.decision).toBe('PostgreSQL 로 바꾼다')
    expect(next.block).toBeNull()
    expect(next.current).toBeNull()
    expect(next.older.map((b) => b.decisionRev)).toEqual([1])
    expect(next.recipientIds).toEqual(['u3', 'u2', 'u4'])

    expect(await checks.send('t2')).toBe(3)
    const sent = checks.forAgenda('t2')!
    expect(sent.block).toBe('sent')
    expect(sent.current).toMatchObject({ decisionRev: 2, decision: 'PostgreSQL 로 바꾼다' })
    expect(sent.current?.rows.map((c) => c.recipientId)).toEqual(['u3', 'u2', 'u4'])
  })

  it('결정에서 벗어나면 결정 전이다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    useAgendaStore().updateAgenda('t2', { state: 'open' })
    expect(checks.forAgenda('t2')).toMatchObject({ decision: null, block: 'not-decided' })
  })
})

describe('보내기', () => {
  it('보낸 묶음이 보낸 것 맨 위에 선다 — 받은 사람 쪽에는 대기로 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    linkT6()
    const checks = useCheckStore()
    await checks.load()

    expect(await checks.send('t6')).toBe(1)
    expect(checks.sent.map((b) => [b.agendaId, b.rows.map((c) => c.recipientId)])).toEqual([
      ['t6', ['u2']],
      ['t2', ['u3', 'u2', 'u4']],
    ])
    expect(checks.forAgenda('t6')?.block).toBe('sent')

    await switchTo('u2@inno-ax.com')
    const theirs = useCheckStore()
    await theirs.load()
    expect(theirs.receivedPending.map((c) => [c.agendaId, c.decisionRev])).toEqual([['t6', 1]])
  })

  it('서버가 거절하면 알리고 null — 목록은 그대로다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(await checks.send('t2')).toBeNull()
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'CHECK_ALREADY_SENT' })
    expect(checks.rows).toHaveLength(4)
  })
})

describe('확인', () => {
  it('확인하면 대기에서 빠지고 배지가 준다 — 두 번 해도 처음 시각 그대로(멱등)', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    await checks.loadPendingCount()
    expect(checks.pendingHere).toBe(1)

    expect(await checks.confirm('c4')).toBe(true)
    await vi.waitFor(() => expect(checks.pendingHere).toBe(0))
    expect(checks.receivedPending).toEqual([])
    const at = checks.received.find((c) => c.id === 'c4')!.confirmedAt
    expect(at).not.toBeNull()
    expect(ids(checks.received)).toEqual(['c4'])

    expect(await checks.confirm('c4')).toBe(true)
    expect(checks.received.find((c) => c.id === 'c4')!.confirmedAt).toBe(at)
  })

  it('받은 사람이 아니면 알리고 false', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(await checks.confirm('c1')).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'FORBIDDEN' })
    expect(checks.rows.find((c) => c.id === 'c1')!.confirmedAt).toBeNull()
  })
})

describe('배지', () => {
  it('지금 프로젝트의 수와 다른 프로젝트의 수를 가른다', async () => {
    await signedIn('u1@inno-ax.com')
    const data = useDataStore()
    /* u3 에게 p1 에 하나(시드 c1 에 더해), p2 에 하나 — u3 담당 작업을 걸고 보낸다 */
    data.taskAgendas.push({ taskId: 'k4', agendaId: 't6' })
    expect(await useCheckStore().send('t6')).toBe(1)
    data.setProject('p2')
    /* u1 은 p2 에서 일반 사용자라 t10 을 못 고친다 — 결정 · 연결은 데이터로 붙인다 */
    Object.assign(
      data.allAgendas.find((t) => t.id === 't10')!,
      {
        state: 'decided',
        decision: '여기도 정했다',
        decisionRev: 1,
      },
    )
    data.taskAgendas.push({ taskId: 'k4', agendaId: 't10' })
    expect(await useCheckStore().send('t10')).toBe(1)
    await switchTo('u3@inno-ax.com')

    const checks = useCheckStore()
    useDataStore().setProject('p1')
    await checks.loadPendingCount()
    expect(checks.pending).toEqual({ total: 3, byProject: { p1: 2, p2: 1 } })
    expect(checks.pendingHere).toBe(2)
    expect(checks.pendingElsewhere).toBe(1)
    expect(checks.pendingOf('p2')).toBe(1)

    useDataStore().setProject('p2')
    expect(checks.pendingHere).toBe(1)
    expect(checks.pendingElsewhere).toBe(2)
  })

  it('startBadge — 곧바로 · 60초마다 · 창 포커스에 받는다. 두 번 불러도 타이머는 하나, stopBadge 로 멈춘다', async () => {
    await signedIn('u1@inno-ax.com')
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'fetchCheckPendingCount')
    const checks = useCheckStore()

    checks.startBadge()
    checks.startBadge()
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(checks.pendingHere).toBe(1)

    await vi.advanceTimersByTimeAsync(CHECK_BADGE_INTERVAL_MS)
    expect(spy).toHaveBeenCalledTimes(3)

    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(4)

    checks.stopBadge()
    await vi.advanceTimersByTimeAsync(CHECK_BADGE_INTERVAL_MS * 2)
    window.dispatchEvent(new Event('focus'))
    expect(spy).toHaveBeenCalledTimes(4)
  })

  it('로그아웃하면 비우고 멈춘다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    await checks.loadPendingCount()
    vi.useFakeTimers()
    checks.startBadge()
    await useAuthStore().logout()
    expect(checks.pending).toBeNull()
    expect(checks.rows).toEqual([])
    const spy = vi.spyOn(api, 'fetchCheckPendingCount')
    await vi.advanceTimersByTimeAsync(CHECK_BADGE_INTERVAL_MS)
    expect(spy).not.toHaveBeenCalled()
  })
})

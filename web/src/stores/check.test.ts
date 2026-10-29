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
import { useThreadStore } from '@/stores/thread'
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
    expect(checks.sent.map((b) => [b.threadId, b.entryId, ids(b.rows), b.confirmed])).toEqual([
      ['t2', 'e3', ['c1', 'c2', 'c3'], 1],
    ])
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
    expect(theirs.sent.map((b) => [b.entryId, ids(b.rows)])).toEqual([['e1', ['c4']]])
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

describe('안건 상세의 [확인 요청]', () => {
  it('t6 — 결정됨 · 안 보냄 · 받을 사람(참조 u2) 있음이라 누를 수 있다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forThread('t6')).toMatchObject({
      decision: { id: 'e6' },
      recipientIds: ['u2'],
      block: null,
      current: null,
      older: [],
    })
  })

  it('목록을 받기 전에는 보냈는지 몰라 누를 수 없다', async () => {
    await signedIn('u1@inno-ax.com')
    expect(useCheckStore().forThread('t6')?.block).toBe('sent')
  })

  it('결정 전 · 이미 보냄 · 받을 사람 없음', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forThread('t3')?.block).toBe('not-decided')

    const t2 = checks.forThread('t2')!
    expect(t2.block).toBe('sent')
    expect([t2.current?.confirmed, t2.current?.rows.length]).toEqual([1, 3])

    /* 참조를 비우면 t6 은 받을 사람이 없다 */
    expect(useThreadStore().updateThread('t6', { ccIds: [] })).toBe(true)
    expect(checks.forThread('t6')).toMatchObject({ recipientIds: [], block: 'no-recipients' })
  })

  it('누른 사람은 받는 사람에서 빠진다 — u2 에게 t6 은 받을 사람이 없다', async () => {
    await signedIn('u2@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forThread('t6')?.block).toBe('no-recipients')
  })

  it('결정을 바꾸면 다시 누를 수 있고, 앞 결정 묶음은 접힌 쪽으로 간다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()
    expect(await useThreadStore().addEntry('t2', 'decide', 'PostgreSQL 로 바꾼다', '', null)).toBe(
      true,
    )

    const next = checks.forThread('t2')!
    expect(next.block).toBeNull()
    expect(next.current).toBeNull()
    expect(next.older.map((b) => b.entryId)).toEqual(['e3'])
    expect(next.recipientIds).toEqual(['u3', 'u2', 'u4'])

    expect(await checks.send('t2')).toBe(3)
    const sent = checks.forThread('t2')!
    expect(sent.block).toBe('sent')
    expect(sent.current?.entryId).toBe(next.decision!.id)
    expect(sent.current?.rows.map((c) => c.recipientId)).toEqual(['u3', 'u2', 'u4'])
  })
})

describe('보내기', () => {
  it('보낸 묶음이 보낸 것 맨 위에 선다 — 받은 사람 쪽에는 대기로 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    const checks = useCheckStore()
    await checks.load()

    expect(await checks.send('t6')).toBe(1)
    expect(checks.sent.map((b) => [b.threadId, b.rows.map((c) => c.recipientId)])).toEqual([
      ['t6', ['u2']],
      ['t2', ['u3', 'u2', 'u4']],
    ])
    expect(checks.forThread('t6')?.block).toBe('sent')

    await switchTo('u2@inno-ax.com')
    const theirs = useCheckStore()
    await theirs.load()
    expect(theirs.receivedPending.map((c) => [c.threadId, c.entryId])).toEqual([['t6', 'e6']])
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

describe('참조', () => {
  it('통째로 바꾸고, 겹치면 하나로', async () => {
    await signedIn('u1@inno-ax.com')
    const thread = () => useDataStore().allThreads.find((t) => t.id === 't6')!
    expect(useThreadStore().updateThread('t6', { ccIds: ['u3', 'u4', 'u3'] })).toBe(true)
    expect(thread().ccIds).toEqual(['u3', 'u4'])
  })

  it('목업도 서버처럼 거른다 — 비부여 · 비활성은 MEMBER_NOT_IN_PROJECT, 21명은 422', async () => {
    await signedIn('u1@inno-ax.com')
    const threads = useThreadStore()
    /* u0 은 p1 에 부여되지 않았고 u5 는 비활성이다 */
    expect(threads.updateThread('t6', { ccIds: ['u3', 'u0', 'u5'] })).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({
      code: 'MEMBER_NOT_IN_PROJECT',
      detail: { 'ccIds.1': expect.any(String), 'ccIds.2': expect.any(String) },
    })
    expect(threads.updateThread('t6', { ccIds: Array.from({ length: 21 }, () => 'u3') })).toBe(
      false,
    )
    expect(vi.mocked(toastError).mock.calls[1][0]).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(useDataStore().allThreads.find((t) => t.id === 't6')!.ccIds).toEqual(['u2'])
  })

  it('검사는 새로 넣은 사람만 — 그사이 빠진 참조를 그대로 둔 수정은 통과, 걸린 자리는 겹친 곳까지', async () => {
    await signedIn('u1@inno-ax.com')
    const data = useDataStore()
    const threads = useThreadStore()
    const u2 = data.allMembers.find((m) => m.id === 'u2')!
    data.upsertMember({ ...u2, active: false })

    expect(threads.updateThread('t6', { ccIds: ['u2', 'u3'] })).toBe(true)
    expect(data.allThreads.find((t) => t.id === 't6')!.ccIds).toEqual(['u2', 'u3'])
    /* 보낼 때는 조용히 빠진다 */
    const checks = useCheckStore()
    await checks.load()
    expect(checks.forThread('t6')?.recipientIds).toEqual(['u3'])

    expect(threads.updateThread('t6', { ccIds: ['u3', 'u0', 'u4', 'u0'] })).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({
      code: 'MEMBER_NOT_IN_PROJECT',
      detail: { 'ccIds.1': expect.any(String), 'ccIds.3': expect.any(String) },
    })
  })

  it('새 안건은 참조를 받아 두고, 안 주면 [] — 결정하면 그 참조에게 보낼 수 있다', async () => {
    await signedIn('u1@inno-ax.com')
    const threads = useThreadStore()
    const plain = await threads.addThread({ title: '참조 없는 안건' })
    const made = await threads.addThread({ title: '참조 있는 안건', ccIds: ['u4', 'u4'] })
    const data = useDataStore()
    expect(data.allThreads.find((t) => t.id === plain)!.ccIds).toEqual([])
    expect(data.allThreads.find((t) => t.id === made)!.ccIds).toEqual(['u4'])

    const checks = useCheckStore()
    await checks.load()
    expect(checks.forThread(made!)?.block).toBe('not-decided')
    await threads.addEntry(made!, 'decide', '정했다', '', null)
    expect(checks.forThread(made!)?.block).toBeNull()
    expect(await checks.send(made!)).toBe(1)
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
    /* u3 에게 p1 에 하나(시드 c1 에 더해), p2 에 하나 — 참조로 붙이고 보낸다 */
    const threads = useThreadStore()
    threads.updateThread('t6', { ccIds: ['u3'] })
    expect(await useCheckStore().send('t6')).toBe(1)
    data.setProject('p2')
    threads.updateThread('t10', { ccIds: ['u3'] })
    await threads.addEntry('t10', 'decide', '여기도 정했다', '', null)
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

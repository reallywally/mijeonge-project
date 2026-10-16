// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { sortReceived, sortSent } from '@/lib/check'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { CHECK_BADGE_INTERVAL_MS, useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import type { CheckRequest } from '@/types/domain'

/* 확인 요청 — 프로젝트의 요청 전부를 받아 받은 것 · 보낸 것 · 작업/안건별로 거르고 줄 세운다 */
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
  it('u1 — 받은 것은 대기(c4) 먼저 · 확인(c2), 보낸 것은 c1', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()

    expect(ids(checks.received)).toEqual(['c4', 'c2'])
    expect(ids(checks.receivedPending)).toEqual(['c4'])
    expect(ids(checks.sent)).toEqual(['c1'])
    expect(ids(checks.forTarget('task', 'k18'))).toEqual(['c3', 'c4'])
    expect(ids(checks.forTarget('thread', 't3'))).toEqual(['c2'])
    expect(checks.canConfirm(checks.received[0])).toBe(true)
    expect(checks.canConfirm(checks.received[1])).toBe(false)
  })

  it('u2 — 한 번에 보낸 두 줄은 받는 사람 순서로, 받은 것은 없다', async () => {
    await signedIn('u2@innoflow.local')
    const checks = useCheckStore()
    await checks.load()
    expect(ids(checks.sent)).toEqual(['c3', 'c4'])
    expect(checks.received).toEqual([])
    /* 남이 받은 대기는 [확인] 할 수 없다 */
    expect(checks.canConfirm(checks.sent[0])).toBe(false)
  })

  it('받은 것 — 대기는 오래된 순, 확인은 최근 확인 순 / 보낸 것 — 최근 순', () => {
    const row = (id: string, createdAt: string, confirmedAt: string | null): CheckRequest => ({
      id,
      projectId: 'p1',
      targetType: 'task',
      targetId: 'k1',
      senderId: 'u2',
      recipientId: 'u1',
      text: '봐 주세요',
      createdAt,
      confirmedAt,
    })
    const rows = [
      row('a', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      row('b', '2026-10-05T00:00:00Z', null),
      row('c', '2026-10-03T00:00:00Z', '2026-10-09T00:00:00Z'),
      row('d', '2026-10-02T00:00:00Z', null),
    ]
    expect(ids(sortReceived(rows))).toEqual(['d', 'b', 'c', 'a'])
    expect(ids(sortSent(rows))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('다른 프로젝트로 옮기면 옛 목록을 그리지 않는다', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()
    useDataStore().setProject('p2')
    expect(checks.received).toEqual([])
    expect(checks.loaded).toBe(false)
  })
})

describe('보내기', () => {
  it('보낸 줄이 붙고 보낸 것 맨 위에 선다 — 받은 사람 쪽에는 대기로 보인다', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()

    const result = await checks.send({
      targetType: 'thread',
      targetId: 't5',
      recipientIds: ['u2', 'u4'],
      text: ' 회의 전에 봐 주세요 ',
    })
    expect(result).toEqual({ ok: true, count: 2 })
    expect(checks.sent.map((c) => [c.recipientId, c.text])).toEqual([
      ['u2', '회의 전에 봐 주세요'],
      ['u4', '회의 전에 봐 주세요'],
      ['u3', '스테이징 DB 구성 순서 봐 주세요'],
    ])
    expect(checks.forTarget('thread', 't5')).toHaveLength(2)

    await switchTo('u2@innoflow.local')
    const theirs = useCheckStore()
    await theirs.load()
    expect(theirs.receivedPending.map((c) => c.text)).toEqual(['회의 전에 봐 주세요'])
    expect(ids(theirs.sent)).toEqual(['c3', 'c4'])
  })

  it('서버가 거절하면 그 message 를 돌려주고 목록은 그대로다', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()
    const result = await checks.send({
      targetType: 'task',
      targetId: 'k22',
      recipientIds: ['u0'],
      text: '봐 주세요',
    })
    expect(result).toEqual({ ok: false, message: '이 프로젝트에 부여되지 않은 사람입니다.' })
    expect(checks.rows).toHaveLength(4)
  })
})

describe('확인', () => {
  it('확인하면 대기에서 빠지고 배지가 준다 — 두 번 해도 처음 시각 그대로(멱등)', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()
    await checks.loadPendingCount()
    expect(checks.pendingHere).toBe(1)

    expect(await checks.confirm('c4')).toBe(true)
    await vi.waitFor(() => expect(checks.pendingHere).toBe(0))
    expect(checks.receivedPending).toEqual([])
    const at = checks.received.find((c) => c.id === 'c4')!.confirmedAt
    expect(at).not.toBeNull()
    /* 최근 확인 순이라 방금 확인한 것이 c2 보다 앞이다 */
    expect(ids(checks.received)).toEqual(['c4', 'c2'])

    expect(await checks.confirm('c4')).toBe(true)
    expect(checks.received.find((c) => c.id === 'c4')!.confirmedAt).toBe(at)
  })

  it('받은 사람이 아니면 알리고 false', async () => {
    await signedIn('u1@innoflow.local')
    const checks = useCheckStore()
    await checks.load()
    expect(await checks.confirm('c1')).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'FORBIDDEN' })
    expect(checks.rows.find((c) => c.id === 'c1')!.confirmedAt).toBeNull()
  })
})

describe('배지', () => {
  it('지금 프로젝트의 수와 다른 프로젝트의 수를 가른다', async () => {
    await signedIn('u1@innoflow.local')
    const data = useDataStore()
    /* u3 에게 p1 에 하나(시드 c1 에 더해), p2 에 하나 */
    await useCheckStore().send({
      targetType: 'task',
      targetId: 'k22',
      recipientIds: ['u3'],
      text: '봐 주세요',
    })
    data.setProject('p2')
    await useCheckStore().send({
      targetType: 'task',
      targetId: 'nk-목업',
      recipientIds: ['u3'],
      text: '여기도요',
    })
    await switchTo('u3@innoflow.local')

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
    await signedIn('u1@innoflow.local')
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
    await signedIn('u1@innoflow.local')
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

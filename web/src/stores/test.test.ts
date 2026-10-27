import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTestStore } from '@/stores/test'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 테스트 스토어 — 묶음의 상태 · 신호, '지금' 의 숫자 · 표 정렬, 작업 · 안건별 거르기, [내 파트 | 전체] */
/* 프로젝트 관리자(u1)는 처음부터 '전체' 를 본다 — 일반 사용자는 '내 파트' 로 시작한다 */
async function boot(email = 'u1@innoflow.local') {
  resetMockAuth()
  setActivePinia(createPinia())
  await useAuthStore().login(email, MOCK_PASSWORD)
  const store = useTestStore()
  await store.load()
  return store
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const keys = (rows: { test: { key: string } }[]) => rows.map((r) => r.test.key)

describe('묶음', () => {
  it('하위 중 가장 나쁜 상태와 하위 신호를 모은다 — 자기 신호는 늘 [] 이다', async () => {
    const store = await boot()
    const row = (key: string) => store.allRows.find((r) => r.test.key === key)!
    expect(row('HW-T1')).toMatchObject({
      isGroup: true,
      status: 'testing',
      signals: ['longRunning', 'overdue', 'notStarted', 'basisChanged'],
      pathLabel: '최상위 테스트 · 하위 3건',
    })
    expect(row('HW-T5')).toMatchObject({
      isGroup: true,
      status: 'fail',
      signals: ['longBlocked', 'failedIdle'],
    })
    expect(row('HW-T6')).toMatchObject({ isGroup: false, status: 'blocked' })
    expect(row('HW-T6').pathLabel).toBe('계정 배포 시나리오')
  })

  it('묶음 아래 묶음도 하위에서 모은다', async () => {
    const store = await boot()
    await store.patch('tc5', { parentId: 'tc1' })
    expect(store.allRows.find((r) => r.test.key === 'HW-T1')!.status).toBe('fail')
  })
})

describe("'지금'", () => {
  it('숫자 카드는 돌리는 테스트(묶음 아닌 것)만 센다', async () => {
    const store = await boot()
    expect(store.nowCounts).toEqual({
      testing: 2,
      longRunning: 1,
      overdue: 1,
      blocked: 1,
      fail: 1,
      basisChanged: 1,
    })
    expect(store.totals).toMatchObject({ all: 6, untagged: 2 })
    expect(store.totals.byStatus).toMatchObject({ testing: 2, pass: 1, ready: 1 })
  })

  it('지금 테스트 중은 오래된 것부터, 손쓸 테스트는 기간 지남 · 오래 막힘 · 오래 걸림 순 → N일째', async () => {
    const store = await boot()
    expect(keys(store.testingNow)).toEqual(['HW-T3', 'HW-T8'])
    /* T3 기간 지남(12일) → T6 오래 막힘(13일) → 그 밖은 N일째 순: T4(14일) · T7(10일) */
    expect(keys(store.attention)).toEqual(['HW-T3', 'HW-T6', 'HW-T4', 'HW-T7'])
  })

  it('상태를 바꾸면 서버가 새로 센 신호로 바뀐다', async () => {
    const store = await boot()
    expect(await store.setStatus('tc3', { status: 'pass' })).toBe(true)
    expect(keys(store.testingNow)).toEqual(['HW-T8'])
    expect(store.nowCounts.overdue).toBe(0)
    expect(store.byId.tc3.statusChangedBy).toBe('u1')
  })
})

describe('작업 · 안건 상세의 칩', () => {
  it('그 작업 · 안건을 태그한 테스트만 목록에서 거른다', async () => {
    const store = await boot()
    expect(keys(store.testsTagging('task', 'k21'))).toEqual(['HW-T6'])
    expect(keys(store.testsTagging('thread', 't2'))).toEqual(['HW-T4'])
    expect(store.testsTagging('task', 'k1')).toEqual([])
    expect(store.refChip({ kind: 'task', id: 'k21' })).toMatchObject({
      label: 'HW-21',
      title: '개발자 계정 배포',
    })
    expect(store.refChip({ kind: 'thread', id: 'gone' }).missing).toBe(true)
  })
})

describe('쓰기', () => {
  it('간트에서 끈 기간은 화면에 먼저 들어가고, 응답으로 바뀐다', async () => {
    const store = await boot()
    const done = store.setPeriod('tc8', '2026-10-14', '2026-10-16')
    expect(store.byId.tc8.due).toBe('2026-10-16')
    expect(await done).toBe(true)
    expect(store.allRows.find((r) => r.test.id === 'tc8')!.periodLabel).toBe('10/14 ~ 10/16')
  })

  it('만든 것을 목록에 넣고, 상위 · 고리를 고르는 목록에서 자기와 자손을 뺀다', async () => {
    const store = await boot()
    const id = await store.create({
      title: '새 테스트',
      parentId: 'tc5',
      refs: [{ kind: 'task', id: 'k4' }],
    })
    expect(store.byId[id!]).toMatchObject({ key: 'HW-T9', status: 'draft' })
    expect(store.parentChoicesFor('tc5').map((c) => c.id)).toEqual(['tc1', 'tc2', 'tc3', 'tc4'])
    expect(store.parentChoicesFor(null)).toHaveLength(9)
  })

  it('지우기 권한 — 만든 사람 · 프로젝트 관리자', async () => {
    let store = await boot('u3@innoflow.local')
    expect(store.canRemove(store.byId.tc5)).toBe(true)
    expect(store.canRemove(store.byId.tc2)).toBe(false)
    store = await boot('u1@innoflow.local')
    expect(store.canRemove(store.byId.tc2)).toBe(true)
  })
})

describe('[내 파트 | 전체]', () => {
  it("'내 파트' 는 공통 · 내 파트 · 내가 담당한 테스트와 그 조상을 보인다", async () => {
    /* 이도현(u3)은 인프라(pt1) — T5 묶음이 pt1, 그 밖은 공통이라 다 보인다 */
    const store = await boot('u3@innoflow.local')
    usePartStore().setScope('mine')
    expect(store.visibleRows).toHaveLength(8)

    /* 박지훈(u2)은 기간계 연동(pt3) — pt1 인 T6 · T7 · T8 은 안 보이고 T5 도 빠진다 */
    const other = await boot('u2@innoflow.local')
    usePartStore().setScope('mine')
    expect(keys(other.visibleRows)).toEqual(['HW-T1', 'HW-T2', 'HW-T3', 'HW-T4'])
    expect(other.nowCounts.blocked).toBe(0)
    usePartStore().setScope('all')
    expect(other.visibleRows).toHaveLength(8)
  })

  it('프로젝트를 바꾸면 옛 목록을 그리지 않는다', async () => {
    const store = await boot('u1@innoflow.local')
    useDataStore().setProject('p2')
    expect(store.tests).toEqual([])
    expect(store.loaded).toBe(false)
  })
})

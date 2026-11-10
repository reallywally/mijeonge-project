// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { ApiError } from '@/api'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAgendaStore } from '@/stores/agenda'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useImpactStore } from '@/stores/impact'
import { useTaskStore } from '@/stores/task'
import { useTestStore } from '@/stores/test'

/* AI 영향도 분석 스토어 — 칸 상태 받기 · 분석 · 멈추기 · 고르기 · 지우기 · 고치기 · 반영(스토어에 넣기) · 409 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email = 'u1@inno-ax.com') {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
  await useTestStore().load()
}

/** 그 안건을 끝까지 분석하고 가장 최근 분석을 낸다 */
async function analyzed(agendaId = 't2') {
  const impact = useImpactStore()
  const run = impact.run(agendaId)
  await vi.runAllTimersAsync()
  expect(await run).toBe(true)
  return impact.states[agendaId].latest!
}

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await signedIn()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('칸 상태 · 분석', () => {
  it('받기 — 분석 전에는 latest 없이 세는 것만', async () => {
    const impact = useImpactStore()
    await impact.load('t2')
    expect(impact.states.t2).toEqual({
      latest: null,
      taskCount: 2,
      testCount: 2,
      decidedAgendaCount: 2,
    })
  })

  it('분석 — 진행 줄을 띄우다 결과를 받으면 가장 최근 분석, update 줄은 다 켠다', async () => {
    const impact = useImpactStore()
    const run = impact.run('t2')
    expect(impact.isRunning('t2')).toBe(true)
    await vi.advanceTimersByTimeAsync(130)
    expect(impact.running?.tool).toBe('연결 작업 읽는 중')
    await vi.runAllTimersAsync()
    await run
    expect(impact.running).toBeNull()
    const latest = impact.states.t2.latest!
    expect(impact.pickedCount(latest)).toBe(2)
    expect(impact.rowStatus(latest, 'task', 'k4')).toBe('open')
    expect(impact.canApply(latest)).toBe(true)
  })

  it('멈추면 아무것도 남지 않는다', async () => {
    const impact = useImpactStore()
    const run = impact.run('t2')
    await vi.advanceTimersByTimeAsync(130)
    impact.stop('t2')
    await vi.runAllTimersAsync()
    expect(await run).toBe(false)
    expect(impact.running).toBeNull()
    expect(impact.states.t2?.latest ?? null).toBeNull()
    expect(mockDb().impacts).toEqual([])
  })

  it('결정내용이 빈 안건은 까닭 한 줄', async () => {
    const impact = useImpactStore()
    const run = impact.run('t3')
    await vi.runAllTimersAsync()
    expect(await run).toBe(false)
    expect(impact.runErrors.t3).toContain('결정내용이 없는')
  })
})

describe('검토', () => {
  it('지우기 — 반영에서 빠지고, 되돌리기는 마지막 것부터 켠 채로', async () => {
    const impact = useImpactStore()
    const latest = await analyzed()
    impact.removeRow(latest, 'task:k4')
    impact.removeRow(latest, 'test:tc2')
    expect(impact.pickedCount(latest)).toBe(0)
    expect(impact.canApply(latest)).toBe(false)
    expect(impact.isRemoved(latest, 'task:k4')).toBe(true)
    impact.undoRemove(latest)
    expect(impact.isRemoved(latest, 'test:tc2')).toBe(false)
    expect(impact.applyInput(latest).tests.map((t) => t.testId)).toEqual(['tc2'])
    expect(impact.applyInput(latest).tasks).toEqual([])
  })

  it('고치기 — 고친 안이 보낼 모양에 그대로, 빈 제목은 막는다', async () => {
    const impact = useImpactStore()
    const latest = await analyzed()
    const review = impact.reviewOf(latest)
    review.tests.tc2.content = '손으로 고친 내용'
    review.tasks.k4.body = [{ kind: 'bullet', text: '한 줄로', done: false, level: 0 }]
    expect(impact.applyInput(latest)).toEqual({
      tasks: [{ taskId: 'k4', body: [{ kind: 'bullet', text: '한 줄로', done: false, level: 0 }] }],
      tests: [{ testId: 'tc2', content: '손으로 고친 내용' }],
    })
    review.tests.tc2.title = '  '
    expect(impact.problems(latest)).toEqual({ 'test:tc2': expect.stringContaining('제목') })
    expect(impact.canApply(latest)).toBe(false)
  })

  it('작업 고칠 권한이 없으면 잠그고 고름에서 뺀다 — 테스트는 잠그지 않는다', async () => {
    const impact = useImpactStore()
    /* k4 를 다른 사람의 것으로 — 박지훈(u2)이 등록했고 이도현(u3)이 담당 */
    const k4 = useDataStore().allTasks.find((t) => t.id === 'k4')!
    resetMockAuth()
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    k4.creatorId = 'u1'
    const latest = await analyzed()
    expect(impact.rowStatus(latest, 'task', 'k4')).toBe('locked')
    expect(impact.isPicked(latest, 'task', 'k4')).toBe(false)
    expect(impact.rowStatus(latest, 'test', 'tc2')).toBe('open')
    expect(impact.pickedCount(latest)).toBe(1)
  })
})

describe('반영', () => {
  it('고른 줄을 반영하면 작업 · 테스트를 스토어에 넣고, 그 줄은 반영함', async () => {
    const impact = useImpactStore()
    const latest = await analyzed()
    const proposed = latest.tasks[0].body!
    impact.reviewOf(latest).tests.tc2.content = '손으로 고친 내용'
    const done = impact.apply(latest)
    await vi.runAllTimersAsync()
    expect(await done).toBe(true)

    const k4 = useDataStore().allTasks.find((t) => t.id === 'k4')!
    expect(k4.body.map((l) => l.text)).toEqual(proposed.map((l) => l.text))
    expect(useTestStore().byId.tc2.content).toBe('손으로 고친 내용')
    const after = impact.states.t2.latest!
    expect(impact.rowStatus(after, 'task', 'k4')).toBe('applied')
    expect(impact.rowStatus(after, 'test', 'tc2')).toBe('applied')
    expect(impact.pickedCount(after)).toBe(0)
    expect(
      mockDb()
        .taskHistory.k4.at(-1)!
        .changes.map((c) => c.field),
    ).toEqual(['body'])
  })

  it('분석 뒤 작업이 바뀌면 409 IMPACT_TARGET_CHANGED — 그 줄을 끄고 표시, 나머지는 다시 반영할 수 있다', async () => {
    const impact = useImpactStore()
    const latest = await analyzed()
    useTaskStore().setTitle('k4', '그사이 고친 제목')
    expect(await impact.apply(latest)).toBe(false)
    expect(impact.rowStatus(latest, 'task', 'k4')).toBe('changed')
    expect(impact.isPicked(latest, 'task', 'k4')).toBe(false)
    expect(impact.pickedCount(latest)).toBe(1)
    expect(toastError).not.toHaveBeenCalled()

    expect(await impact.apply(latest)).toBe(true)
    expect(impact.rowStatus(impact.states.t2.latest!, 'test', 'tc2')).toBe('applied')
  })

  it('결정이 또 바뀌면 이전 판 분석 — 흐리고 반영을 끈다. 서버가 409 IMPACT_STALE 를 내도 같다', async () => {
    const impact = useImpactStore()
    const latest = await analyzed()
    vi.spyOn(api, 'applyAgendaImpact').mockRejectedValueOnce(
      new ApiError(409, { code: 'IMPACT_STALE', message: '결정이 바뀌어 다시 분석해야 합니다.' }),
    )
    expect(await impact.apply(latest)).toBe(false)
    expect(impact.isStale(latest)).toBe(true)
    expect(impact.canApply(latest)).toBe(false)

    const other = await analyzed('t1')
    expect(impact.isStale(other)).toBe(false)
    useAgendaStore().updateAgenda('t1', { decision: '우분투 LTS 로 한다' })
    expect(impact.isStale(other)).toBe(true)
    expect(impact.canApply(other)).toBe(false)
  })

  it('프로젝트를 바꾸면 비운다', async () => {
    const impact = useImpactStore()
    await analyzed()
    useDataStore().setProject('p2')
    await vi.runAllTimersAsync()
    expect(impact.states).toEqual({})
    expect(impact.reviews).toEqual({})
  })
})

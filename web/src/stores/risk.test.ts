// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import * as api from '@/api'
import { ApiError, fetchRiskSettings, putRiskSettings } from '@/api'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { DEFAULT_RISK_SETTINGS } from '@/lib/risk'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useRiskStore } from '@/stores/risk'

/* 리스크 — 목업 갈래로 받아 [내 파트 | 전체] 로 거르고, 기준을 바꾸면 다시 받는지 본다.
   계산은 서버 몫이라 여기서는 받은 것을 어떻게 다루는지만 본다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

const ids = <T>(rows: T[], key: keyof T) => rows.map((r) => r[key])

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

describe('보고서 받기', () => {
  it('들어올 때 받은 보고서를 그대로 둔다 — 기본 기준 · 점수 순', async () => {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()

    expect(risk.report?.asOf).toBe('2026-10-15')
    expect(risk.report?.settings).toEqual(DEFAULT_RISK_SETTINGS)
    expect(ids(risk.agendas, 'agendaId')).toEqual(['t5', 't3', 't8', 't9', 't4', 't7'])
    expect(ids(risk.agendas, 'level')).toEqual([
      'medium',
      'medium',
      'medium',
      'medium',
      'low',
      'low',
    ])
    /* 서버 시드 표(risk-dashboard.md '시드 p1') 순서 그대로 */
    expect(ids(risk.tasks, 'taskId')).toEqual([
      'k3',
      'k20',
      'k4',
      'k21',
      'k9',
      'k1',
      'k7',
      'k10',
      'k11',
      'k15',
      'k12',
      'k13',
      'k5',
      'k6',
      'k14',
      'k17',
      'k16',
      'k18',
      'k22',
    ])
    expect(ids(risk.tests, 'testId')).toEqual(['tc3', 'tc4', 'tc6', 'tc7', 'tc2'])
    /* 작업 · 테스트 줄을 합친 셈 — 정렬은 blockingImpact → overdueAgendas → riskyTasks + riskyTests */
    expect(ids(risk.owners, 'memberId')).toEqual(['u4', 'u1', null, 'u2', 'u3'])
    expect(risk.owners.map((o) => [o.riskyTasks, o.riskyTests])).toEqual([
      [3, 1],
      [2, 1],
      [9, 0],
      [2, 1],
      [2, 1],
    ])
  })

  it('작업 · 테스트 신호가 고루 나온다(목업 보고서 = 서버 시드) — 작업의 시작 안 함만 시드에 없다', async () => {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()
    expect(new Set(risk.tasks.flatMap((t) => t.signals))).toEqual(
      new Set([
        'overdue',
        'longBlocked',
        'longRunning',
        'dueSlipped',
        'contentChurn',
        'ownerChurn',
      ]),
    )
    expect(new Set(risk.tests.flatMap((t) => t.signals))).toEqual(
      new Set([
        'overdue',
        'failedIdle',
        'longBlocked',
        'basisChanged',
        'longRunning',
        'flaky',
        'dueSlipped',
        'notStarted',
      ]),
    )
  })

  it('내 파트면 세 종류를 같이 거르고 owners 는 그대로다', async () => {
    await signedIn('u3@inno-ax.com')
    const risk = useRiskStore()
    const part = usePartStore()
    await risk.load()

    expect(part.scope).toBe('mine')
    expect(ids(risk.agendas, 'agendaId')).toEqual(['t9', 't4'])
    /* 공통 · 내 파트(pt1) · 내가 담당 — 조상으로 끌려 서는 것은 없다 */
    expect(ids(risk.tasks, 'taskId')).toEqual(['k3', 'k20', 'k4', 'k21', 'k1', 'k5', 'k17', 'k22'])
    expect(ids(risk.tests, 'testId')).toEqual(['tc3', 'tc4', 'tc6', 'tc7', 'tc2'])
    expect(risk.owners).toHaveLength(5)

    part.setScope('all')
    expect(risk.agendas).toHaveLength(6)
    expect(risk.tasks).toHaveLength(19)
  })

  it('다른 프로젝트로 옮기면 옛 보고서를 그리지 않는다', async () => {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    const data = useDataStore()
    await risk.load()
    expect(risk.report).not.toBeNull()

    data.setProject('p3')
    expect(risk.report).toBeNull()
    await risk.load()
    expect(risk.report?.agendas).toEqual([])
  })
})

describe('기준 바꾸기', () => {
  it('바꾼 적이 없으면 기본값이다 — 일곱 값', async () => {
    await signedIn('u3@inno-ax.com')
    await expect(fetchRiskSettings('p1')).resolves.toEqual({
      dueSoonDays: 3,
      staleDays: 7,
      highScore: 6,
      mediumScore: 3,
      churnDays: 14,
      churnCount: 5,
      slipCount: 2,
    })
  })

  it('흔들림 셋도 범위를 본다 — 빠지면 422', async () => {
    await signedIn('u1@inno-ax.com')
    const bad = { ...DEFAULT_RISK_SETTINGS, churnDays: 0, churnCount: 1, slipCount: 11 }
    const error = await putRiskSettings('p1', bad).catch((e: unknown) => e)
    expect(Object.keys((error as ApiError).detail ?? {}).sort()).toEqual([
      'churnCount',
      'churnDays',
      'slipCount',
    ])
    const { slipCount: _drop, ...six } = DEFAULT_RISK_SETTINGS
    void _drop
    const missing = await putRiskSettings('p1', six as never).catch((e: unknown) => e)
    expect(missing).toMatchObject({ status: 422, detail: { slipCount: expect.any(String) } })

    const next = { ...DEFAULT_RISK_SETTINGS, churnDays: 30, churnCount: 3, slipCount: 1 }
    await expect(putRiskSettings('p1', next)).resolves.toEqual(next)
  })

  it('프로젝트 관리자가 바꾸면 보고서를 다시 받고 새 기준으로 등급이 선다', async () => {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()

    const next = { ...DEFAULT_RISK_SETTINGS, highScore: 4, mediumScore: 2 }
    await expect(risk.saveSettings(next)).resolves.toEqual({ ok: true })

    expect(risk.report?.settings).toEqual(next)
    expect(ids(risk.agendas, 'level')).toEqual(['high', 'high', 'high', 'high', 'medium', 'low'])
    /* 작업 · 테스트도 같은 문턱으로 다시 단다 */
    expect(ids(risk.tests, 'level')).toEqual(['high', 'medium', 'medium', 'medium', 'medium'])
    expect(risk.tasks.find((t) => t.taskId === 'k22')?.level).toBe('low')
    await expect(fetchRiskSettings('p1')).resolves.toEqual(next)
  })

  it('시스템 관리자도 바꾼다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    await expect(
      useRiskStore().saveSettings({ ...DEFAULT_RISK_SETTINGS, staleDays: 14 }),
    ).resolves.toEqual({ ok: true })
  })

  it('일반 사용자는 403 — 알리고 칸에 붙일 것은 없다', async () => {
    await signedIn('u3@inno-ax.com')
    const result = await useRiskStore().saveSettings({ ...DEFAULT_RISK_SETTINGS, staleDays: 14 })

    expect(result).toEqual({ ok: false, detail: {} })
    expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({ status: 403 })
  })

  it('범위 밖 · high <= medium 은 목업도 422 를 내고, 스토어가 detail 을 돌려준다', async () => {
    await signedIn('u1@inno-ax.com')
    const bad = { ...DEFAULT_RISK_SETTINGS, staleDays: 91, highScore: 3, mediumScore: 3 }

    const error = await putRiskSettings('p1', bad).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(Object.keys((error as ApiError).detail ?? {}).sort()).toEqual(['highScore', 'staleDays'])

    const result = await useRiskStore().saveSettings(bad)
    expect(result.ok).toBe(false)
    expect(Object.keys(result.ok ? {} : result.detail).sort()).toEqual(['highScore', 'staleDays'])
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('대시보드', () => {
  async function all() {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()
    return risk
  }

  it('세 종류를 점수 순으로 섞는다 — 같은 점수는 기한을 더 넘긴 것, 그다음 작업 · 안건 · 테스트', async () => {
    const risk = await all()
    expect(risk.rows).toHaveLength(6 + 19 + 5)
    expect(risk.rows.slice(0, 8).map((r) => `${r.kind}:${r.id}`)).toEqual([
      'test:tc3',
      'task:k3',
      'task:k20',
      'task:k4',
      'task:k21',
      'task:k9',
      'task:k1',
      'task:k7',
    ])
    /* 4점 · 넘김 15일 — 작업 k12 · k13 이 안건 t3 보다 앞 */
    expect(risk.rows.slice(8, 15).map((r) => `${r.kind}:${r.id}`)).toEqual([
      'agenda:t5',
      'task:k10',
      'task:k11',
      'task:k15',
      'task:k12',
      'task:k13',
      'agenda:t3',
    ])
  })

  it('숫자 카드 · 신호 막대를 센다', async () => {
    const risk = await all()
    expect(risk.cards.kinds).toEqual({
      agenda: { high: 0, medium: 4, low: 2 },
      task: { high: 7, medium: 11, low: 1 },
      test: { high: 1, medium: 3, low: 1 },
    })
    expect(risk.cards.delay).toEqual({ overdue: 19, longBlocked: 2, longRunning: 7 })
    const overdue = risk.bars.main[0]!
    expect(overdue).toMatchObject({ signal: 'overdue', label: '기한 넘김', total: 19 })
    expect(overdue.byKind).toEqual({ agenda: 1, task: 17, test: 1 })
    expect(risk.bars.churn.map((b) => [b.signal, b.total])).toEqual([
      ['dueSlipped', 2],
      /* 같은 수는 이름 순 — 결과 뒤집힘 · 내용 자주 바뀜 · 담당자 자주 바뀜 */
      ['flaky', 1],
      ['contentChurn', 1],
      ['ownerChurn', 1],
    ])
    expect(risk.bars.main.some((b) => b.signal === 'dueSlipped')).toBe(false)
  })

  it('거르기 — 종류 · 등급(여럿) · 신호(하나라도), 보이는 id 가 곧 분석에 보낼 것', async () => {
    const risk = await all()
    risk.setKind('test')
    expect(risk.filteredRows.map((r) => r.id)).toEqual(['tc3', 'tc4', 'tc6', 'tc7', 'tc2'])
    expect(risk.visibleIds).toEqual({
      agendaIds: [],
      taskIds: [],
      testIds: ['tc3', 'tc4', 'tc6', 'tc7', 'tc2'],
    })

    risk.toggleLevel('high')
    risk.toggleLevel('low')
    expect(risk.filteredRows.map((r) => r.id)).toEqual(['tc3', 'tc2'])
    risk.toggleLevel('high')
    expect(risk.filteredRows.map((r) => r.id)).toEqual(['tc2'])

    /* 같은 종류를 다시 고르면 전체로 */
    risk.setKind('test')
    risk.clearFilter()
    risk.setSignals(['dueSlipped', 'flaky'])
    expect(risk.filteredRows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      'test:tc3',
      'task:k21',
      'test:tc2',
    ])
    /* 같은 묶음을 다시 걸면 풀린다 */
    risk.setSignals(['flaky', 'dueSlipped'])
    expect(risk.filtered).toBe(false)
    expect(risk.filteredRows).toHaveLength(30)
  })

  it('거르기는 프로젝트를 바꾸면 풀린다', async () => {
    const risk = await all()
    risk.setKind('agenda')
    useDataStore().setProject('p2')
    await nextTick()
    expect(risk.filter.kind).toBeNull()
  })
})

describe('AI 요약', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /* 로그인 · 보고서는 진짜 시간으로 받고, 요약 스트림부터 가짜 타이머로 넘긴다 */
  async function ready(email: string) {
    await signedIn(email)
    const risk = useRiskStore()
    await risk.load()
    vi.useFakeTimers()
    return risk
  }

  it('보이는 줄(내 파트로 거른 것) 그대로 보내고, 다 받으면 done 이다', async () => {
    const risk = await ready('u3@inno-ax.com')
    const spy = vi.spyOn(api, 'streamRiskSummary')

    const done = risk.summarize()
    expect(spy.mock.calls[0][0]).toBe('p1')
    expect(spy.mock.calls[0][1]).toEqual({
      agendaIds: ['t9', 't4'],
      taskIds: ['k3', 'k20', 'k4', 'k21', 'k1', 'k5', 'k17', 'k22'],
      testIds: ['tc3', 'tc4', 'tc6', 'tc7', 'tc2'],
    })
    expect(risk.summarizing).toBe(true)
    expect(risk.canSummarize).toBe(false)

    await vi.runAllTimersAsync()
    await expect(done).resolves.toBe(true)
    expect(risk.summary).toMatchObject({
      status: 'done',
      asOf: '2026-10-15',
      agendaIds: ['t9', 't4'],
    })
    expect(risk.summary?.text).toContain('먼저 손쓸 것')
    expect(risk.summary?.text).toContain('[[task:k20]]')
    /* 보이지 않는 줄은 근거로도 안 나온다 */
    expect(risk.summary?.text).not.toContain('[[agenda:t5]]')
    expect(risk.summaryChanged).toBe(false)
  })

  it('[내 파트 | 전체] 를 바꾸면 바뀜이 서고, 저절로 다시 부르지 않는다. 되돌리면 풀린다', async () => {
    const risk = await ready('u3@inno-ax.com')
    const spy = vi.spyOn(api, 'streamRiskSummary')
    void risk.summarize()
    await vi.runAllTimersAsync()

    usePartStore().setScope('all')
    expect(risk.summaryChanged).toBe(true)
    expect(risk.summary?.status).toBe('done')
    expect(spy).toHaveBeenCalledTimes(1)

    usePartStore().setScope('mine')
    expect(risk.summaryChanged).toBe(false)
  })

  it('멈추면 받은 데까지 남기고 타이머도 남지 않는다', async () => {
    const risk = await ready('u1@inno-ax.com')
    const done = risk.summarize()
    await vi.advanceTimersByTimeAsync(api.MOCK_STEP_MS * 5)
    const partial = risk.summary?.text ?? ''
    expect(partial.length).toBeGreaterThan(0)

    risk.stopSummary()
    expect(risk.summarizing).toBe(false)
    expect(risk.summary?.status).toBe('stopped')
    await vi.runAllTimersAsync()
    await expect(done).resolves.toBe(false)
    expect(risk.summary?.text).toBe(partial)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('보이는 줄이 0건이면 부르지 않는다', async () => {
    await signedIn('u1@inno-ax.com')
    const risk = useRiskStore()
    useDataStore().setProject('p3')
    await risk.load()
    const spy = vi.spyOn(api, 'streamRiskSummary')

    expect(risk.visibleCount).toBe(0)
    expect(risk.canSummarize).toBe(false)
    await expect(risk.summarize()).resolves.toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(risk.summary).toBeNull()
  })

  it('오류는 챗봇과 같은 문구로 단다', async () => {
    const risk = await ready('u1@inno-ax.com')
    vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* () {
      yield { type: 'delta', text: '한 줄 총평' }
      throw new ApiError(200, { code: 'CHAT_UNAVAILABLE', message: '' })
    })

    await expect(risk.summarize()).resolves.toBe(false)
    expect(risk.summary).toMatchObject({
      status: 'error',
      text: '한 줄 총평',
      error: 'AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 물어 주세요.',
    })
    expect(risk.canSummarize).toBe(true)
  })

  it('프로젝트를 바꾸거나 버리면 받는 중인 요청을 끊고 비운다', async () => {
    const risk = await ready('u1@inno-ax.com')
    const old = risk.summarize()
    await vi.advanceTimersByTimeAsync(api.MOCK_STEP_MS * 3)

    useDataStore().setProject('p3')
    await vi.advanceTimersByTimeAsync(0)
    expect(risk.summary).toBeNull()
    await vi.runAllTimersAsync()
    await expect(old).resolves.toBe(false)
    expect(risk.summary).toBeNull()
  })
})

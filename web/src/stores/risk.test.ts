// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    await signedIn('u1@innoflow.local')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()

    expect(risk.report?.asOf).toBe('2026-10-15')
    expect(risk.report?.settings).toEqual(DEFAULT_RISK_SETTINGS)
    expect(ids(risk.threads, 'threadId')).toEqual(['t5', 't3', 't8', 't9', 't4', 't7'])
    expect(ids(risk.threads, 'level')).toEqual(['high', 'medium', 'medium', 'medium', 'low', 'low'])
    expect(ids(risk.tasks, 'taskId')).toEqual(['k22', 'k3', 'k13'])
    expect(ids(risk.owners, 'memberId')).toEqual(['u4', 'u1', 'u2', 'u3', null])
  })

  it('내 파트면 threads · tasks 만 거르고 owners 는 그대로다', async () => {
    await signedIn('u3@innoflow.local')
    const risk = useRiskStore()
    const part = usePartStore()
    await risk.load()

    expect(part.scope).toBe('mine')
    expect(ids(risk.threads, 'threadId')).toEqual(['t9', 't4'])
    expect(ids(risk.tasks, 'taskId')).toEqual(['k22', 'k3'])
    expect(risk.owners).toHaveLength(5)

    part.setScope('all')
    expect(risk.threads).toHaveLength(6)
    expect(risk.tasks).toHaveLength(3)
  })

  it('다른 프로젝트로 옮기면 옛 보고서를 그리지 않는다', async () => {
    await signedIn('u1@innoflow.local')
    const risk = useRiskStore()
    const data = useDataStore()
    await risk.load()
    expect(risk.report).not.toBeNull()

    data.setProject('p3')
    expect(risk.report).toBeNull()
    await risk.load()
    expect(risk.report?.threads).toEqual([])
  })
})

describe('기준 바꾸기', () => {
  it('바꾼 적이 없으면 기본값이다', async () => {
    await signedIn('u3@innoflow.local')
    await expect(fetchRiskSettings('p1')).resolves.toEqual(DEFAULT_RISK_SETTINGS)
  })

  it('프로젝트 관리자가 바꾸면 보고서를 다시 받고 새 기준으로 등급이 선다', async () => {
    await signedIn('u1@innoflow.local')
    const risk = useRiskStore()
    usePartStore().setScope('all')
    await risk.load()

    const next = { ...DEFAULT_RISK_SETTINGS, highScore: 4, mediumScore: 2 }
    await expect(risk.saveSettings(next)).resolves.toEqual({ ok: true })

    expect(risk.report?.settings).toEqual(next)
    expect(ids(risk.threads, 'level')).toEqual(['high', 'high', 'high', 'high', 'medium', 'low'])
    await expect(fetchRiskSettings('p1')).resolves.toEqual(next)
  })

  it('시스템 관리자도 바꾼다', async () => {
    await signedIn('admin@innoflow.local', MOCK_ADMIN_PASSWORD)
    await expect(
      useRiskStore().saveSettings({ ...DEFAULT_RISK_SETTINGS, staleDays: 14 }),
    ).resolves.toEqual({ ok: true })
  })

  it('일반 사용자는 403 — 알리고 칸에 붙일 것은 없다', async () => {
    await signedIn('u3@innoflow.local')
    const result = await useRiskStore().saveSettings({ ...DEFAULT_RISK_SETTINGS, staleDays: 14 })

    expect(result).toEqual({ ok: false, detail: {} })
    expect(vi.mocked(toastError).mock.calls.at(-1)?.[0]).toMatchObject({ status: 403 })
  })

  it('범위 밖 · high <= medium 은 목업도 422 를 내고, 스토어가 detail 을 돌려준다', async () => {
    await signedIn('u1@innoflow.local')
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
    const risk = await ready('u3@innoflow.local')
    const spy = vi.spyOn(api, 'streamRiskSummary')

    const done = risk.summarize()
    expect(spy.mock.calls[0][0]).toBe('p1')
    expect(spy.mock.calls[0][1]).toEqual({ threadIds: ['t9', 't4'], taskIds: ['k22', 'k3'] })
    expect(risk.summarizing).toBe(true)
    expect(risk.canSummarize).toBe(false)

    await vi.runAllTimersAsync()
    await expect(done).resolves.toBe(true)
    expect(risk.summary).toMatchObject({
      status: 'done',
      asOf: '2026-10-15',
      threadIds: ['t9', 't4'],
      taskIds: ['k22', 'k3'],
    })
    expect(risk.summary?.text).toContain('먼저 정할 것')
    expect(risk.summary?.text).toContain('[[thread:t9]]')
    /* 보이지 않는 줄은 근거로도 안 나온다 */
    expect(risk.summary?.text).not.toContain('[[thread:t5]]')
    expect(risk.summaryChanged).toBe(false)
  })

  it('[내 파트 | 전체] 를 바꾸면 바뀜이 서고, 저절로 다시 부르지 않는다. 되돌리면 풀린다', async () => {
    const risk = await ready('u3@innoflow.local')
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
    const risk = await ready('u1@innoflow.local')
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
    await signedIn('u1@innoflow.local')
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
    const risk = await ready('u1@innoflow.local')
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
    const risk = await ready('u1@innoflow.local')
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

// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

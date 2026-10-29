// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { ApiError, fetchReports } from '@/api'
import { resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useReportStore } from '@/stores/report'
import type { ReportEvent } from '@/types/domain'

/* 리포트 스토어 — 만들기(facts 먼저 · 글 · done 에서 byId) · 멈춤 · 프로젝트 전환 · 지우기 권한 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string) {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
}

/** 만들기를 끝까지 돌린다 — 목업 스트림이 조각 사이에 쉬므로 시계를 민다 */
async function generated() {
  const report = useReportStore()
  const run = report.generate()
  await vi.runAllTimersAsync()
  return run
}

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await signedIn('u2@inno-ax.com')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('만들기', () => {
  it('facts 를 먼저 들고, 다 받으면 저장된 리포트를 byId 와 목록에 넣는다', async () => {
    const report = useReportStore()
    await report.load()
    const run = report.generate()
    await vi.advanceTimersByTimeAsync(0)
    expect(report.generating).toBe(true)
    expect(report.draft?.facts?.attention[0].taskId).toBe('k20')

    await vi.runAllTimersAsync()
    const id = await run
    expect(id).toBe('rp1')
    expect(report.draft?.status).toBe('done')
    expect(report.byId.rp1.body).toBe(report.draft?.text)
    expect(report.byId.rp1.facts).toEqual(report.draft?.facts)
    expect(report.list.map((r) => r.id)).toEqual(['rp1'])
  })

  it('목업은 지금 데이터 스토어로 계산한다 — k20 을 끝내면 맨 위가 바뀐다', async () => {
    const data = useDataStore()
    data.allTasks.find((t) => t.id === 'k20')!.status = 'done'
    await generated()
    const facts = useReportStore().draft!.facts!
    expect(facts.attention.some((a) => a.taskId === 'k20')).toBe(false)
    expect(facts.progress.done).toBe(4)
  })

  it('멈추면 받은 글은 남기고 저장되지 않는다', async () => {
    const report = useReportStore()
    const run = report.generate()
    await vi.advanceTimersByTimeAsync(200)
    expect(report.draft?.text.length).toBeGreaterThan(0)
    report.stop()
    await vi.runAllTimersAsync()
    expect(await run).toBeNull()
    expect(report.draft?.status).toBe('stopped')
    expect(await fetchReports('p1')).toEqual([])
  })

  it('프로젝트를 바꾸면 받는 중인 것을 끊고 버린다', async () => {
    const report = useReportStore()
    const run = report.generate()
    await vi.advanceTimersByTimeAsync(100)
    useDataStore().setProject('p2')
    await vi.runAllTimersAsync()
    expect(await run).toBeNull()
    expect(report.draft).toBeNull()
    expect(await fetchReports('p1')).toEqual([])
  })

  it('스트림 중 오류는 그 문구로, 끊김은 저장되지 않았다고', async () => {
    const report = useReportStore()
    async function* failing(code: string): AsyncGenerator<ReportEvent> {
      yield { type: 'delta', text: '반쯤' }
      throw new ApiError(200, { code, message: code === 'CHAT_UNAVAILABLE' ? 'AI 가 쉬는 중' : '' })
    }
    const spy = vi.spyOn(api, 'streamCreateReport')
    spy.mockReturnValueOnce(failing('CHAT_UNAVAILABLE'))
    expect(await report.generate()).toBeNull()
    expect(report.draft).toMatchObject({ status: 'error', error: 'AI 가 쉬는 중', text: '반쯤' })

    spy.mockReturnValueOnce(failing('SERVER_UNREACHABLE'))
    await report.generate()
    expect(report.draft?.error).toBe('리포트를 받다가 연결이 끊겼습니다. 저장되지 않았습니다.')
  })
})

describe('지우기', () => {
  it('만든 사람 · 관리자만 지울 수 있고, 지우면 목록에서 빠진다', async () => {
    await generated()
    const report = useReportStore()
    await report.load()
    const item = report.list[0]
    expect(report.canRemove(item)).toBe(true)

    writeMockSession('u3')
    await useAuthStore().loadMe()
    expect(report.canRemove(item)).toBe(false)
    expect(await report.remove(item.id)).toBe(false)
    expect(toastError).toHaveBeenCalledOnce()

    writeMockSession('u1')
    await useAuthStore().loadMe()
    expect(report.canRemove(item)).toBe(true)
    expect(await report.remove(item.id)).toBe(true)
    expect(report.list).toEqual([])
    expect(report.byId[item.id]).toBeUndefined()
  })
})

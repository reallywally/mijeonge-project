// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mockDb, resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useReportStore } from '@/stores/report'
import ReportDetailView from './ReportDetailView.vue'
import ReportsView from './ReportsView.vue'

/* 리포트 화면 — 목록 · [리포트 만들기] → 숫자 카드 · 흘러나오는 글 → 상세 · 멈추기 · 지난 대비 · 손쓸 작업 표 · 지우기 권한 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports', component: ReportsView },
      { path: '/reports/:reportId', component: ReportDetailView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  const w = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return { w, router }
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
/** 칸 안의 조각마다 — 배지 · 칩 사이에는 공백이 없어 하나씩 읽는다 */
const parts = (sel: string) => $$(`${sel} > *`).map((el) => el.textContent?.trim() ?? '')

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

/** 목록에서 [리포트 만들기] → 다 받아 상세까지 */
async function generated() {
  const page = await mountAt('/reports')
  await click($('[data-report-generate]'))
  await vi.runAllTimersAsync()
  await flushPromises()
  return page
}

async function switchTo(memberId: string) {
  writeMockSession(memberId)
  await useAuthStore().loadMe()
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
  await useDataStore().retry()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('목록 · 만들기', () => {
  it('비어 있을 때 버튼 아래 기간을 알린다', async () => {
    await mountAt('/reports')
    expect(text('[data-report-period-hint]')).toBe('지난 7일 · 10월 14일 ~ 10월 20일')
    expect(document.body.textContent).toContain('아직 만든 리포트가 없습니다.')
  })

  it('누르면 숫자 카드부터, 글이 흘러나오고, 다 받으면 상세로 간다', async () => {
    const { router } = await mountAt('/reports')
    await click($('[data-report-generate]'))
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    expect(text('[data-report-card="doneRate"] [data-card-value]')).toBe('14%')
    expect(text('[data-report-card="attention"] [data-card-value]')).toBe('19')
    expect($('[data-report-stop]')).toBeTruthy()
    expect(text('[data-report-draft]')).toContain('저장되지 않습니다')

    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(text('[data-report-draft-text]')).toContain('한 줄 총평')

    await vi.runAllTimersAsync()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/reports/rp1')
    expect(text('[data-report-heading]')).toBe('10월 14일 ~ 10월 20일 진행 리포트')

    await click($('[data-report-back]'))
    const row = $('[data-report-item="rp1"]')!
    expect(row.textContent).toContain('10월 14일 ~ 10월 20일')
    expect(row.textContent).toContain('박지훈')
    expect(text('[data-report-item="rp1"] [data-report-rate]')).toBe('14%')
    expect(text('[data-report-item="rp1"] [data-report-attention]')).toBe('19')
    expect(row.textContent).toContain('10월 20일 12:00')
  })

  it('[멈추기] 하면 저장되지 않았다고 알리고 목록에 남지 않는다', async () => {
    await mountAt('/reports')
    await click($('[data-report-generate]'))
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    await click($('[data-report-stop]'))
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(text('[data-report-draft-line]')).toBe('멈췄습니다 — 이 리포트는 저장되지 않았습니다.')
    expect($('[data-report-item]')).toBeNull()

    await click($('[data-report-draft-close]'))
    expect($('[data-report-draft]')).toBeNull()
  })
})

describe('상세', () => {
  it('근거 칩 · 손쓸 작업 표(신호 화면 말 · 며칠째 · 계획 · 담당) · 사람별', async () => {
    await generated()
    expect($('[data-report-body] [data-ref-task="k20"]')).toBeTruthy()
    expect($('[data-report-body] [data-ref-task="k22"]')).toBeTruthy()
    expect($('[data-report-body] [data-ref-thread="t3"]')).toBeTruthy()

    const k20 = '[data-attention="k20"]'
    expect($$('[data-attention]')[0].getAttribute('data-attention')).toBe('k20')
    expect(parts(`${k20} [data-attention-signals]`)).toEqual(['오래 걸림', '기한 지남'])
    expect(text(`${k20} [data-attention-days]`)).toBe('12일째')
    expect(text(k20)).toContain('3일')
    expect(text(k20)).toContain('이도현')
    expect(parts('[data-attention="k22"] [data-attention-signals]')).toEqual(['풀어도 됨'])
    /* 선행 작업은 걷었다(Q63) — 새 리포트에는 기다림 / 막음 칸이 없다 */
    expect(document.body.textContent).not.toContain('기다림 / 막음')
    expect($('[data-attention-blocking]')).toBeNull()

    expect(parts('[data-report-person="u3"]')).toEqual(['이도현', '2', '1', '2', '0', '3'])
    expect($$('[data-report-person]')[0].getAttribute('data-report-person')).toBe('none')

    /* 지난 리포트가 없으면 대비를 찍지 않는다 */
    expect($('[data-card-delta]')).toBeNull()

    await click($('[data-attention-task="k20"]'))
    expect(document.body.textContent).toContain('DB 설치와 초기 스키마 반영')
    expect($('[role="dialog"]')).toBeTruthy()
  })

  it('지난 리포트의 선행 신호 · 기다림 / 막음은 저장된 그대로 보여 준다 (Q63 전)', async () => {
    const { w } = await generated()
    w.unmount()
    const [k20, k22] = ['k20', 'k22'].map((id) =>
      mockDb().reports[0].facts.attention.find((a) => a.taskId === id)!,
    )
    k20.signals = ['lateBlocker', ...k20.signals]
    k20.waitingOnTaskIds = []
    k20.blockingTaskIds = ['k21', 'k22']
    k22.signals = ['waitingOnPredecessor', ...k22.signals]
    k22.waitingOnTaskIds = ['k20']
    k22.blockingTaskIds = []
    /* 들고 있던 것을 버려 서버(목업)에서 다시 받게 */
    delete useReportStore().byId.rp1

    await mountAt('/reports/rp1')
    expect(document.body.textContent).toContain('기다림 / 막음')
    expect(parts('[data-attention="k20"] [data-attention-signals]')).toEqual([
      '뒤 작업을 막는 중',
      '오래 걸림',
      '기한 지남',
    ])
    expect(parts('[data-attention="k20"] [data-attention-blocking]')).toEqual([
      '막음',
      'HW-21',
      'HW-22',
    ])
    expect(parts('[data-attention="k22"] [data-attention-waiting]')).toEqual(['기다림', 'HW-20'])
    expect(parts('[data-attention="k22"] [data-attention-signals]')).toEqual([
      '선행 대기',
      '풀어도 됨',
    ])
  })

  it('backfill 이면 N일 이상', async () => {
    useDataStore().allTasks.find((t) => t.id === 'k20')!.statusSinceBackfill = true
    await generated()
    expect(text('[data-attention="k20"] [data-attention-days]')).toBe('12일 이상')
  })

  it('두 번째 리포트는 지난 리포트 대비 ▲▼ 를 찍는다', async () => {
    const page = await generated()
    page.w.unmount()
    const data = useDataStore()
    data.allTasks.find((t) => t.id === 'k21')!.status = 'done'
    data.allTasks.find((t) => t.id === 'k18')!.status = 'doing'
    const { router } = await generated()
    expect(router.currentRoute.value.path).toBe('/reports/rp2')
    expect(parts('[data-report-card="doneRate"]')).toEqual(['완료율', '18%', '▲ 4%p'])
    expect(parts('[data-report-card="blocked"]')).toEqual(['막힘', '1', '▼ 1'])
  })

  it('없는 리포트는 찾을 수 없다고', async () => {
    await mountAt('/reports/없음')
    expect(text('[data-report-load-error]')).toContain('리포트를 찾을 수 없습니다')
  })
})

describe('지우기', () => {
  it('만든 사람에게만 [지우기] — 지우면 목록으로', async () => {
    const page = await generated()
    page.w.unmount()

    await switchTo('u3')
    const other = await mountAt('/reports/rp1')
    expect($('[data-report-heading]')).toBeTruthy()
    expect($('[data-report-remove]')).toBeNull()
    other.w.unmount()

    await switchTo('u2')
    const { router } = await mountAt('/reports/rp1')
    await click($('[data-report-remove]'))
    await click($('[data-report-remove-confirm]'))
    expect(router.currentRoute.value.path).toBe('/reports')
    expect($('[data-report-item]')).toBeNull()
  })

  it('프로젝트 관리자도 지울 수 있다', async () => {
    const page = await generated()
    page.w.unmount()
    await switchTo('u1')
    await mountAt('/reports/rp1')
    expect($('[data-report-remove]')).toBeTruthy()
  })
})

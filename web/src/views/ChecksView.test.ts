// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useCheckStore } from '@/stores/check'
import { useDataStore } from '@/stores/data'
import ChecksView from './ChecksView.vue'

/* 확인 요청 화면 — 탭 · [확인] 뒤 대기에서 빠짐 · 칩을 누르면 상세 · 메뉴 배지 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountChecks() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/checks', component: ChecksView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push('/checks')
  await router.isReady()
  const w = mount(ChecksView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return w
}

async function signedIn(email: string) {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
}

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const tab = (key: 'received' | 'sent') => $(`[data-tab="${key}"]`)
const received = () => $$('[data-check-received]').map((r) => r.dataset.checkReceived)
const sent = () => $$('[data-check-sent]').map((r) => r.dataset.checkSent)
const dialog = () => $('[role="dialog"]')

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('탭', () => {
  it('받은 것이 먼저 — 대기(c4) 다음 확인(c2). 보낸 것은 c1', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()

    expect(tab('received')!.getAttribute('aria-selected')).toBe('true')
    expect(received()).toEqual(['c4', 'c2'])
    const first = $('[data-check-received="c4"]')!.textContent ?? ''
    expect(first).toContain('in · out 정의 초안 확인 부탁해요')
    expect(first).toContain('박지훈')
    expect(first).toContain('HW-18')
    expect($('[data-check-received="c2"] [data-check-state="confirmed"]')!.textContent).toContain(
      '10월 14일 14:00',
    )

    await click(tab('sent'))
    expect(received()).toEqual([])
    expect(sent()).toEqual(['c1'])
    const row = $('[data-check-sent="c1"]')!.textContent ?? ''
    expect(row).toContain('이도현')
    expect(row).toContain('대기')
    expect(row).toContain('스테이징 DB 구성')
  })

  it('[확인] 을 누르면 대기에서 빠지고 확인 시각이 선다 — 메뉴 배지도 사라진다', async () => {
    await signedIn('u1@innoflow.local')
    await useCheckStore().loadPendingCount()
    await mountChecks()
    expect($('[data-check-badge]')!.textContent?.trim()).toBe('1')

    await click($('[data-check-received="c4"] [data-check-confirm]'))
    await flushPromises()

    expect($$('[data-check-confirm]')).toHaveLength(0)
    expect($('[data-check-received="c4"] [data-check-state="confirmed"]')).toBeTruthy()
    expect(useCheckStore().receivedPending).toEqual([])
    expect($('[data-check-badge]')).toBeNull()
  })

  it('받은 것이 없으면 빈 줄 안내', async () => {
    await signedIn('u2@innoflow.local')
    await mountChecks()
    expect(received()).toEqual([])
    expect(document.body.textContent).toContain('받은 확인 요청이 없습니다.')
    await click(tab('sent'))
    expect(sent()).toEqual(['c3', 'c4'])
  })
})

describe('걸린 것 칩', () => {
  it('작업 칩은 작업 상세, 안건 칩은 안건 상세', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()

    await click($('[data-check-received="c4"] [data-check-target="k18"]'))
    expect(dialog()?.textContent).toContain('보험료 산출 기간계 API 개발')
    /* 상세에도 그 작업에 걸린 요청이 선다 */
    expect($$('[role="dialog"] [data-check-row]').map((r) => r.dataset.checkRow)).toEqual([
      'c3',
      'c4',
    ])
  })

  it('안건 칩', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()
    await click($('[data-check-received="c2"] [data-check-target="t3"]'))
    expect(dialog()?.textContent).toContain('사내망에서 외부 모델 호출 허용 범위')
  })
})

describe('배지', () => {
  it('지금 프로젝트의 수는 메뉴 옆, 다른 프로젝트의 수는 프로젝트 고르기에 — 0 이면 안 그린다', async () => {
    await signedIn('u3@innoflow.local')
    const checks = useCheckStore()
    await mountChecks()
    expect($('[data-check-badge]')).toBeNull()

    checks.pending = { total: 3, byProject: { p1: 1, p2: 2 } }
    await flushPromises()
    expect($('[data-check-badge]')!.textContent?.trim()).toBe('1')
    expect($('[data-check-badge-elsewhere]')!.textContent?.trim()).toBe('2')

    checks.pending = { total: 1, byProject: { p1: 1 } }
    await flushPromises()
    expect($('[data-check-badge-elsewhere]')).toBeNull()
  })
})

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

/* 확인 요청 화면 — 탭 · 보낸 묶음 펼치기 · [확인] 뒤 대기에서 빠짐 · 칩을 누르면 안건 상세 · 메뉴 배지 */
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
  it('받은 것 — 안건 칩 · 결정 한 줄 · 보낸 사람. 보낸 것 — 묶음 한 줄에 확인 N / M', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()

    expect(tab('received')!.getAttribute('aria-selected')).toBe('true')
    expect(received()).toEqual(['c4'])
    const first = $('[data-check-received="c4"]')!.textContent ?? ''
    expect(first).toContain('서버 OS 결정')
    expect(first).toContain('우분투 최신 버전으로 한다')
    expect(first).toContain('이도현')

    await click(tab('sent'))
    expect(received()).toEqual([])
    expect(sent()).toEqual(['e3'])
    const row = $('[data-check-sent="e3"]')!.textContent ?? ''
    expect(row).toContain('DB 결정')
    expect(row).toContain('mysql 을 쓴다')
    expect($('[data-check-sent="e3"] [data-check-progress]')!.textContent?.trim()).toBe(
      '확인 1 / 3',
    )

    /* 펼치면 사람별 대기 / 확인 */
    expect($('[data-check-people="e3"]')).toBeNull()
    await click($('[data-check-sent="e3"] [data-check-expand]'))
    expect($$('[data-check-people="e3"] [data-check-row]').map((r) => r.dataset.checkRow)).toEqual([
      'c1',
      'c2',
      'c3',
    ])
    expect($('[data-check-row="c2"] [data-check-state="confirmed"]')!.textContent).toContain(
      '10월 14일 14:00',
    )
    expect($('[data-check-row="c1"] [data-check-state="pending"]')).toBeTruthy()
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

  it('보낸 것이 없으면 빈 줄 안내', async () => {
    await signedIn('u2@innoflow.local')
    await mountChecks()
    expect(received()).toEqual(['c2'])
    await click(tab('sent'))
    expect(sent()).toEqual([])
    expect(document.body.textContent).toContain('보낸 확인 요청이 없습니다.')
  })
})

describe('안건 칩 · 안건 상세', () => {
  it('칩을 누르면 안건 상세 — 이 결정의 확인 현황과 참조가 선다', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()
    await click(tab('sent'))

    await click($('[data-check-sent="e3"] [data-check-thread="t2"]'))
    expect(dialog()?.textContent).toContain('DB 결정')
    expect($('[role="dialog"] [data-check-progress]')!.textContent).toContain('이 결정 확인 1 / 3')
    expect($$('[role="dialog"] [data-check-row]').map((r) => r.dataset.checkRow)).toEqual([
      'c1',
      'c2',
      'c3',
    ])
    expect($('[role="dialog"] [data-check-send]')).toBeNull()
    expect($$('[role="dialog"] [data-cc]').map((c) => c.dataset.cc)).toEqual(['u2', 'u4'])
  })

  it('받은 것의 [확인] 은 안건 상세에서도 된다', async () => {
    await signedIn('u1@innoflow.local')
    await mountChecks()
    await click($('[data-check-received="c4"] [data-check-thread="t1"]'))
    expect(dialog()?.textContent).toContain('서버 OS 결정')
    await click($('[role="dialog"] [data-check-row="c4"] [data-check-confirm]'))
    expect($('[role="dialog"] [data-check-row="c4"] [data-check-state="confirmed"]')).toBeTruthy()
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

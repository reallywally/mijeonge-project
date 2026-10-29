// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'
import ThreadDetailDialog from './ThreadDetailDialog.vue'

/* 안건 상세의 확인 요청 — [확인 요청] 이 열리는 세 조건 · 받는 사람 N명 · 누르면 바로 보냄 · 보낸 뒤 현황 · 참조 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string) {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
}

async function mountDetail(threadId: string) {
  const w = mount(ThreadDetailDialog, {
    props: { threadId, open: true },
    attachTo: document.body,
  })
  await flushPromises()
  return w
}

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const sendButton = () => $('[data-check-send]') as HTMLButtonElement | null
const block = () => $('[data-check-block]')?.dataset.checkBlock ?? null

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('[확인 요청]', () => {
  it('t6 — 결정됨 · 안 보냄 · 받을 사람 있음이라 열린다. 곁에 받는 사람 1명, 펼치면 이름', async () => {
    await signedIn('u1@inno-ax.com')
    await mountDetail('t6')

    expect(sendButton()!.disabled).toBe(false)
    expect(block()).toBeNull()
    expect($('[data-check-recipients]')!.textContent).toContain('받는 사람 1명')
    expect($('[data-check-recipients]')!.title).toBe('박지훈')
    expect($('[data-check-recipient-names]')).toBeNull()
    await click($('[data-check-recipients]'))
    expect($('[data-check-recipient-names]')!.textContent).toContain('박지훈')
  })

  it('누르면 입력 창 없이 바로 보내고, 버튼 자리에 이 결정의 확인 현황이 선다', async () => {
    await signedIn('u1@inno-ax.com')
    await mountDetail('t6')

    await click(sendButton())
    await flushPromises()
    expect($$('[role="dialog"]')).toHaveLength(1)
    expect(sendButton()).toBeNull()
    expect($('[data-check-progress]')!.textContent).toContain('이 결정 확인 0 / 1')
    expect($$('[data-check-current] [data-check-row]')).toHaveLength(1)
    expect($('[data-check-current]')!.textContent).toContain('박지훈')
    expect(mockDb().checks.at(-1)).toMatchObject({
      threadId: 't6',
      entryId: 'e6',
      recipientId: 'u2',
    })
  })

  it('결정 전이면 닫히고 까닭을 한 줄로', async () => {
    await signedIn('u1@inno-ax.com')
    await mountDetail('t3')
    expect(sendButton()!.disabled).toBe(true)
    expect(block()).toBe('not-decided')
    expect($('[data-check-block]')!.textContent).toContain('결정된 안건만 보낼 수 있어요')
  })

  it('받을 사람이 없으면 닫힌다 — 참조를 빼면 바로 PATCH 되고 버튼이 닫힌다', async () => {
    await signedIn('u1@inno-ax.com')
    await mountDetail('t6')
    expect($$('[data-cc]').map((c) => c.dataset.cc)).toEqual(['u2'])

    await click($('[data-cc="u2"] [data-cc-remove]'))
    expect(useDataStore().allThreads.find((t) => t.id === 't6')!.ccIds).toEqual([])
    expect(sendButton()!.disabled).toBe(true)
    expect(block()).toBe('no-recipients')
    expect($('[data-check-block]')!.textContent).toContain('받을 사람이 없어요')
    expect($('[data-check-recipients]')).toBeNull()
  })

  it('결정을 바꾸면 다시 열리고, 앞 결정 묶음은 접혀서 아래에 있다', async () => {
    await signedIn('u1@inno-ax.com')
    await useThreadStore().addEntry('t2', 'decide', 'PostgreSQL 로 바꾼다', '', null)
    await mountDetail('t2')

    expect(sendButton()!.disabled).toBe(false)
    expect($('[data-check-recipients]')!.textContent).toContain('받는 사람 3명')
    expect($('[data-check-older="e3"]')).toBeNull()
    await click($('[data-check-older-toggle]'))
    expect($('[data-check-older="e3"]')!.textContent).toContain('확인 1 / 3')
  })
})

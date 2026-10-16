// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import CheckRequestSection from './CheckRequestSection.vue'

/* 상세의 확인 요청 — [확인 요청] 대화 상자(29자 · 나 빠짐 · 빈 사람 막음 · 서버 message) · 걸린 줄 · [확인] */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string) {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
}

async function mountSection(targetType: 'task' | 'thread', targetId: string) {
  const w = mount(CheckRequestSection, {
    props: { targetType, targetId, targetLabel: '걸린 것' },
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

async function type(value: string) {
  const input = $('[data-check-text]') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const people = () => $$('[data-recipient]').map((b) => b.dataset.recipient)
const submit = () => $('[data-check-submit]') as HTMLButtonElement
const rows = () => $$('[data-check-row]').map((r) => r.dataset.checkRow)

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('걸린 요청 줄', () => {
  it('그 작업에 걸린 것만 — 보낸 → 받는 · 내용 · 대기, 내가 받은 대기에만 [확인]', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k18')

    expect(rows()).toEqual(['c3', 'c4'])
    const c3 = $('[data-check-row="c3"]')!
    expect(c3.textContent).toContain('박지훈')
    expect(c3.textContent).toContain('정하늘')
    expect(c3.querySelector('[data-check-state="pending"]')).toBeTruthy()
    expect(c3.querySelector('[data-check-confirm]')).toBeNull()

    await click($('[data-check-row="c4"] [data-check-confirm]'))
    expect($('[data-check-row="c4"] [data-check-state="confirmed"]')).toBeTruthy()
  })

  it('안건 — 확인 시각이 선다', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('thread', 't3')
    expect(rows()).toEqual(['c2'])
    expect($('[data-check-row="c2"]')!.textContent).toContain('10월 14일 14:00 확인')
  })
})

describe('보내기 대화 상자', () => {
  it('고를 사람은 이 프로젝트의 활성 멤버, 나 빼고', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k22')
    await click($('[data-check-open]'))
    /* u5 는 비활성, u0 은 p1 에 부여되지 않았다 */
    expect(people()).toEqual(['u2', 'u3', 'u4'])
  })

  it('사람을 안 골랐거나 글이 비면 보내지 않는다', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k22')
    await click($('[data-check-open]'))

    expect(submit().disabled).toBe(true)
    await type('봐 주세요')
    expect(submit().disabled).toBe(true)
    await click($('[data-recipient="u2"]'))
    expect(submit().disabled).toBe(false)
    await type('   ')
    expect(submit().disabled).toBe(true)
  })

  it('29자까지 — 칸이 더 받지 않고, 남은 글자 수를 센다', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k22')
    await click($('[data-check-open]'))
    await click($('[data-recipient="u2"]'))

    expect($('[data-check-text]')!.getAttribute('maxlength')).toBe('29')
    expect($('[data-check-left]')!.textContent).toContain('29자 남음')
    await type('가'.repeat(29))
    expect($('[data-check-left]')!.textContent).toContain('0자 남음')
    expect(submit().disabled).toBe(false)
    /* maxlength 를 넘겨 들어온 값(붙여 넣기 등)도 보내지 않는다 */
    await type('가'.repeat(30))
    expect(submit().disabled).toBe(true)
  })

  it('보내면 닫히고 받는 사람 수만큼 줄이 는다', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k22')
    expect(rows()).toEqual(['c1'])
    await click($('[data-check-open]'))
    await click($('[data-recipient="u4"]'))
    await click($('[data-recipient="u2"]'))
    await type('구성 순서 봐 주세요')
    await click(submit())

    expect($('[data-check-send]')).toBeNull()
    expect(rows()).toHaveLength(3)
    /* 받는 사람은 멤버 목록 순서로 */
    const last = $$('[data-check-row]').slice(1)
    expect(last.map((r) => r.textContent?.includes('박지훈'))).toEqual([true, false])
  })

  it('서버가 거절하면 그 message 를 그대로 띄우고 열어 둔다', async () => {
    await signedIn('u1@innoflow.local')
    await mountSection('task', 'k22')
    await click($('[data-check-open]'))
    await click($('[data-recipient="u3"]'))
    await type('봐 주세요')
    /* 그사이 다른 곳에서 u3 을 프로젝트에서 뺐다 */
    const db = mockDb()
    db.grants = db.grants.filter((g) => !(g.projectId === 'p1' && g.memberId === 'u3'))
    await click(submit())

    expect($('[data-check-error]')!.textContent?.trim()).toBe(
      '이 프로젝트에 부여되지 않은 사람입니다.',
    )
    expect($('[data-check-send]')).toBeTruthy()
    expect(rows()).toEqual(['c1'])
  })
})

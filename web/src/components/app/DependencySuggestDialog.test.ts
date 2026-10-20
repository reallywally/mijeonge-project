// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import DependencySuggestDialog from './DependencySuggestDialog.vue'

/* [AI 선행 관계 찾기] 창 — 진행 중 표시 · 줄마다 이유 · [적용] · [버리기] · [모두 적용] · 실패한 줄의 까닭 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const rows = () => $$('[data-suggestion]')
const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )
const pairs = () => useDataStore().taskDependencies.map((d) => `${d.dependsOnId}>${d.taskId}`)

async function click(el: HTMLElement | undefined) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  el!.click()
  await flushPromises()
}

const mountDialog = () =>
  mount(DependencySuggestDialog, { props: { open: true }, attachTo: document.body })

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AI 선행 관계 찾기', () => {
  it('받는 동안 진행 중을 띄우고, 오면 줄마다 선행 → 뒤 작업과 이유', async () => {
    mountDialog()
    await Promise.resolve()
    expect($$('[data-suggest-loading]')).toHaveLength(1)

    await flushPromises()
    expect($$('[data-suggest-loading]')).toHaveLength(0)
    const text = rows().map((r) => r.textContent?.replace(/\s+/g, ''))
    expect(text[0]).toContain('HW-15기존상품분석')
    expect(text[0]).toContain('HW-16모델링')
    expect(text[0]).toContain('기존상품을분석해야')
    expect(text[1]).toContain('HW-3프로그램설계')
  })

  it('[적용] 은 선행을 걸고, [버리기] 는 그 줄만 걷는다', async () => {
    mountDialog()
    await flushPromises()
    await click(buttonIn(rows()[0], '적용'))
    expect(pairs()).toContain('k15>k16')
    expect(rows()[0].textContent).toContain('적용함')

    await click(buttonIn(rows()[1], '버리기'))
    expect(rows()).toHaveLength(1)
    expect(pairs()).not.toContain('k3>k18')
  })

  it('[모두 적용] — 거절된 줄에는 그 자리에 까닭', async () => {
    mountDialog()
    await flushPromises()
    useDataStore().taskDependencies.push({ taskId: 'k3', dependsOnId: 'k18' })
    await click(buttonIn(document.body, '모두 적용'))

    expect(rows()[0].textContent).toContain('적용함')
    expect(rows()[1].querySelector('[data-suggest-error]')!.textContent).toContain(
      '선행 작업이 이미 이 작업을 기다리고 있어 순환이 생깁니다.',
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('찾지 못했으면 그렇게 적고, 실패하면 까닭과 [다시 찾기]', async () => {
    vi.spyOn(api, 'suggestDependencies').mockResolvedValueOnce({
      suggestions: [],
      truncated: false,
    })
    const w = mountDialog()
    await flushPromises()
    expect(document.body.textContent).toContain('더 걸 만한 선행 관계를 찾지 못했습니다.')

    vi.spyOn(api, 'suggestDependencies').mockRejectedValueOnce(
      new api.ApiError(429, { code: 'CHAT_RATE_LIMITED', message: '잠시 뒤에 다시 해 주세요.' }),
    )
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await flushPromises()
    expect(document.body.textContent).toContain('잠시 뒤에 다시 해 주세요.')
    expect(buttonIn(document.body, '다시 찾기')).toBeTruthy()
  })
})

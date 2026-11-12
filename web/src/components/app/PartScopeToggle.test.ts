// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type { PartPickArea } from '@/lib/part'
import PartScopeToggle from './PartScopeToggle.vue'

/* 볼 파트 고르기 — 담당자 고르기처럼 여럿을 고르고 비우면 전체. 목록은 Portal 로 body 에 나간다.
   안건 쪽은 전체로, 업무 쪽(작업 · 테스트 · 리스크)은 내 파트 전부로 시작한다 */
const ALL_RIGHTS = { canView: true, canCreate: true, canUpdate: true, canDelete: true }
const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const choice = (partId: string) => $(`[data-part-choice="${partId}"]`)!

enableAutoUnmount(afterEach)

beforeEach(async () => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  localStorage.clear()
  resetMockAuth()
  /* u3 은 인프라(pt1) 하나에 속한다 — AI(pt2)에도 넣어 둘로 본다 */
  await useAuthStore().login('u3@inno-ax.com', MOCK_PASSWORD)
  await useDataStore().retry()
  useDataStore().partMembers.push({ partId: 'pt2', memberId: 'u3', ...ALL_RIGHTS })
})

async function mounted(area: PartPickArea = 'agenda') {
  const w = mount(PartScopeToggle, { props: { area }, attachTo: document.body })
  await flushPromises()
  return w
}

const label = (w: Awaited<ReturnType<typeof mounted>>) => w.get('[data-part-pick-label]').text()

describe('볼 파트 고르기', () => {
  it('안건 쪽은 전체 파트로 열린다. 목록에는 내 파트만 서고 고른 것이 없다', async () => {
    const w = await mounted()
    expect(label(w)).toBe('전체 파트')
    expect(w.find('[data-part-pick-clear]').exists()).toBe(false)
    await w.get('[data-part-pick]').trigger('click')
    await flushPromises()
    expect(
      [...document.body.querySelectorAll('[data-part-choice]')].map((el) => el.textContent?.trim()),
    ).toEqual(['AI', '인프라'])
    expect(choice('pt1').getAttribute('aria-selected')).toBe('false')
    expect(choice('pt2').getAttribute('aria-selected')).toBe('false')
  })

  it('하나만 고르면 그 파트만, 다 빼거나 풀기를 누르면 전체 파트다', async () => {
    const w = await mounted()
    const part = usePartStore()
    await w.get('[data-part-pick]').trigger('click')
    await flushPromises()

    choice('pt1').click()
    await flushPromises()
    choice('pt2').click()
    await flushPromises()
    expect(label(w)).toBe('인프라 외 1')

    choice('pt2').click()
    await flushPromises()
    expect(part.pickedIdsOf('agenda')).toEqual(['pt1'])
    expect(label(w)).toBe('인프라')

    choice('pt1').click()
    await flushPromises()
    expect(part.scopeOf('agenda')).toBe('all')
    expect(label(w)).toBe('전체 파트')
    expect(w.find('[data-part-pick-clear]').exists()).toBe(false)

    choice('pt1').click()
    await flushPromises()
    expect(label(w)).toBe('인프라')
    await w.get('[data-part-pick-clear]').trigger('click')
    expect(label(w)).toBe('전체 파트')
  })

  it('업무 쪽은 내 파트 전부로 열리고, 안건 쪽에서 고른 것과 섞이지 않는다', async () => {
    const w = await mounted('work')
    expect(label(w)).toBe('인프라 외 1')
    expect(w.find('[data-part-pick-clear]').exists()).toBe(true)
    await w.get('[data-part-pick-clear]').trigger('click')
    expect(label(w)).toBe('전체 파트')
    expect(usePartStore().scopeOf('agenda')).toBe('all')
    expect(usePartStore().scope).toBe('all')
  })

  it('보기 권한이 없는 소속은 내 파트가 아니다 — 목록에 서지 않는다', async () => {
    useDataStore().partMembers.find((pm) => pm.partId === 'pt2' && pm.memberId === 'u3')!.canView =
      false
    const w = await mounted('work')
    expect(label(w)).toBe('인프라')
    await w.get('[data-part-pick]').trigger('click')
    await flushPromises()
    expect(
      [...document.body.querySelectorAll('[data-part-choice]')].map((el) => el.textContent?.trim()),
    ).toEqual(['인프라'])
  })

  it('내가 속한 파트가 없으면 숨는다', async () => {
    const data = useDataStore()
    data.partMembers = data.partMembers.filter((pm) => pm.memberId !== 'u3')
    const w = await mounted()
    expect(w.find('[data-part-pick]').exists()).toBe(false)
  })
})

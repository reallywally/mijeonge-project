// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import CcField from './CcField.vue'
import OwnerSelect from './OwnerSelect.vue'

/* 사람 찾아 고르기 — 담당자(OwnerSelect) · 참조(CcField). 목록은 Portal 로 body 에 나간다 */
const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const choices = () => $$('[data-member-choice]').map((el) => el.dataset.memberChoice)
const search = () => $('[data-member-picker] input') as HTMLInputElement

async function open(label: string) {
  $(`button[aria-label="${label}"]`)!.click()
  await flushPromises()
}
async function type(value: string) {
  search().value = value
  search().dispatchEvent(new Event('input'))
  await flushPromises()
}
async function key(k: string) {
  search().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
})

const assignable = () => useDataStore().assignable

describe('담당자 고르기', () => {
  const mountOwner = (initial: string | null = null, extra: Record<string, unknown> = {}) => {
    const owner = ref<string | null>(initial)
    mount(
      defineComponent(
        () => () =>
          h(OwnerSelect, {
            modelValue: owner.value,
            'onUpdate:modelValue': (v: string | null) => (owner.value = v),
            label: '담당자',
            ...extra,
          }),
      ),
      { attachTo: document.body },
    )
    return owner
  }

  it('열면 찾는 칸에 포커스가 가고, 미정 + 활성 멤버가 선다', async () => {
    mountOwner()
    await open('담당자')
    expect(document.activeElement).toBe(search())
    expect(search().placeholder).toBe('이름으로 찾기')
    expect(choices()).toEqual(['none', ...assignable().map((m) => m.id)])
  })

  it('이름 일부로 걸러지고 ↓ · Enter 로 골라 닫힌다', async () => {
    const owner = mountOwner()
    const target = assignable()[1]!
    await open('담당자')
    await type(target.name.slice(1))
    expect(choices()).toEqual(
      assignable()
        .filter((m) => m.name.includes(target.name.slice(1)))
        .map((m) => m.id),
    )
    const at = choices().indexOf(target.id)
    for (let i = 0; i < at; i++) await key('ArrowDown')
    await key('Enter')
    expect(owner.value).toBe(target.id)
    expect($('[data-member-picker]')).toBeNull()
    expect($('button[aria-label="담당자"]')!.textContent).toContain(target.name)
  })

  it("맞는 사람이 없으면 '찾는 사람이 없습니다', 미정을 고르면 null", async () => {
    const owner = mountOwner(assignable()[0]!.id)
    await open('담당자')
    await type('없는사람zz')
    expect(choices()).toEqual([])
    expect($('[data-member-empty]')!.textContent).toContain('찾는 사람이 없습니다')

    await type('')
    /* 열 때 지금 고른 사람 줄에 서 있다 — 미정은 그 위 */
    await key('ArrowUp')
    await key('Enter')
    expect(owner.value).toBeNull()
  })

  it('selfAssign 이면 [나에게 할당] 이 서고, 누르면 내가 담당이 되며 버튼은 사라진다', async () => {
    const owner = mountOwner(null, { selfAssign: true })
    await flushPromises()
    $('[data-assign-me]')!.click()
    await flushPromises()
    expect(owner.value).toBe('u1')
    expect($('[data-assign-me]')).toBeNull()
  })

  it('selfAssign 이 없거나 막힌 칸이면 [나에게 할당] 이 서지 않는다', async () => {
    mountOwner()
    mountOwner(null, { selfAssign: true, disabled: true })
    await flushPromises()
    expect($('[data-assign-me]')).toBeNull()
  })
})

describe('참조 고르기', () => {
  it('고른 사람은 빠지고, Enter 로 고르면 칩이 더해지며 목록은 열린 채 찾는 말만 빈다', async () => {
    const [a, b] = assignable()
    const cc = ref<string[]>([a!.id])
    mount(
      defineComponent(
        () => () =>
          h(CcField, {
            modelValue: cc.value,
            'onUpdate:modelValue': (v: string[]) => (cc.value = v),
          }),
      ),
      { attachTo: document.body },
    )
    await open('참조 더하기')
    expect(choices()).not.toContain(a!.id)
    expect(choices()).not.toContain('none')

    await type(b!.name)
    expect(choices()).toEqual([b!.id])
    await key('Enter')
    expect(cc.value).toEqual([a!.id, b!.id])
    expect($$('[data-cc]').map((c) => c.dataset.cc)).toEqual([a!.id, b!.id])
    expect($('[data-member-picker]')).not.toBeNull()
    expect(search().value).toBe('')
    expect(choices()).not.toContain(b!.id)
  })
})

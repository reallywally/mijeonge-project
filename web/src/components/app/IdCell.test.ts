// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { toast } from 'vue-sonner'
import IdCell from './IdCell.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const LONG = '0b7f3c2e-9a41-4d2b-8c55-1f2e3d4c5b6a'
const writeText = vi.fn<(s: string) => Promise<void>>()

// 표의 줄처럼 누르면 상세가 열리는 부모 안에 둔다
const Row = defineComponent({
  props: { id: { type: String, required: true } },
  emits: ['open'],
  setup(props, { emit }) {
    return () =>
      h('div', { 'data-row': '', onClick: () => emit('open') }, [h(IdCell, { id: props.id })])
  },
})

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('IdCell', () => {
  it('앞 8자만 보이고 전체 id 는 title 에 둔다', () => {
    const w = mount(IdCell, { props: { id: LONG } })
    const b = w.get('button[data-id-cell]')
    expect(b.text()).toBe('0b7f3c2e')
    expect(b.attributes('title')).toBe(LONG)
  })

  it('8자보다 짧은 id 는 그대로 보인다', () => {
    const w = mount(IdCell, { props: { id: 't2' } })
    expect(w.get('button').text()).toBe('t2')
  })

  it('누르면 전체 id 를 복사하고 줄 클릭은 일어나지 않는다', async () => {
    const w = mount(Row, { props: { id: LONG } })
    await w.get('button[data-id-cell]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(LONG)
    expect(toast.success).toHaveBeenCalledWith('ID 를 복사했습니다')
    expect(w.emitted('open')).toBeUndefined()
  })

  it('클립보드가 없거나 실패하면 오류 토스트만 띄운다', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const w = mount(IdCell, { props: { id: LONG } })
    await w.get('button').trigger('click')
    await flushPromises()
    expect(toast.error).toHaveBeenCalledTimes(1)

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    writeText.mockRejectedValueOnce(new Error('denied'))
    await w.get('button').trigger('click')
    await flushPromises()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

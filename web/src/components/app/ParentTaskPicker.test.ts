// @vitest-environment jsdom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ParentTaskPicker from './ParentTaskPicker.vue'

/* 상위 작업 고르기 — 번호 · 경로 낱말로 찾고, 고르면 바로 올리고, '없음' 과 X 로 최상위로 돌린다 */
enableAutoUnmount(afterEach)

const choices = [
  { id: 'k4', key: 'HW-4', label: '개발 환경 설정' },
  { id: 'k20', key: 'HW-20', label: '개발 환경 설정 › DB 설치와 초기 스키마 반영' },
  { id: 'k13', key: 'HW-13', label: '모델링' },
]

function mountPicker(parentId: string | null) {
  return mount(ParentTaskPicker, {
    props: { choices, modelValue: parentId },
    attachTo: document.body,
  })
}

const options = (w: ReturnType<typeof mount>) => w.findAll('[role="option"]').map((o) => o.text())

describe('ParentTaskPicker', () => {
  it('평소엔 지금 상위의 번호와 경로를 보인다', () => {
    const w = mountPicker('k20')
    expect(w.text()).toContain('HW-20')
    expect(w.text()).toContain('DB 설치와 초기 스키마 반영')
  })

  it('누르면 찾기 칸이 열리고 맨 위에 없음, 아래로 작업이 모두 나온다', async () => {
    const w = mountPicker(null)
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    expect(options(w)[0]).toContain('없음')
    expect(options(w)).toHaveLength(4)
  })

  it('번호나 경로 낱말로 거른다 — 낱말은 모두 들어가야 한다', async () => {
    const w = mountPicker(null)
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    await w.get('input').setValue('hw-1')
    expect(options(w)).toEqual([expect.stringContaining('모델링')])
    await w.get('input').setValue('환경 DB')
    expect(options(w)).toEqual([expect.stringContaining('HW-20')])
    await w.get('input').setValue('없는말')
    expect(w.text()).toContain("'없는말' 이 들어간 작업이 없습니다")
  })

  it('↓ Enter 로 고르면 값을 올리고 닫는다', async () => {
    const w = mountPicker(null)
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    await w.get('input').setValue('모델링')
    await w.get('input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')).toEqual([['k13']])
    expect(w.find('input').exists()).toBe(false)
  })

  it("'없음' 을 고르거나 X 를 누르면 최상위가 된다", async () => {
    const w = mountPicker('k4')
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    await w.findAll('[role="option"]')[0]!.trigger('mousedown')
    expect(w.emitted('update:modelValue')).toEqual([[null]])

    const w2 = mountPicker('k4')
    await w2.get('button[aria-label="상위 작업 빼기"]').trigger('click')
    expect(w2.emitted('update:modelValue')).toEqual([[null]])
  })

  it('Esc 는 고르지 않고 닫는다', async () => {
    const w = mountPicker('k4')
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    await w.get('input').trigger('keydown', { key: 'Escape' })
    expect(w.find('input').exists()).toBe(false)
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('고르면 4단을 넘는 작업은 흐리게 이유를 적고 고르지 못한다 — ↑ ↓ 도 건너뛴다 (Q64)', async () => {
    const w = mount(ParentTaskPicker, {
      props: {
        choices: [
          { id: 'k7', key: 'HW-7', label: '개발 › AI Biz › 가상비서' },
          {
            id: 'k8',
            key: 'HW-8',
            label: '개발 › AI Biz › 가상비서 › tool01',
            disabledReason: '5단이 됩니다 · 4단까지',
          },
          { id: 'k9', key: 'HW-9', label: '개발 › AI Biz › 가상비서 › tool02' },
        ],
        modelValue: null,
      },
      attachTo: document.body,
    })
    await w.get('button[aria-label="상위 작업"]').trigger('click')
    const blocked = w.findAll('[role="option"]')[2]!
    expect(blocked.attributes('aria-disabled')).toBe('true')
    expect(blocked.text()).toContain('5단이 됩니다 · 4단까지')

    await blocked.trigger('mousedown')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(w.find('input').exists()).toBe(true)

    /* 없음 → HW-7 → (HW-8 건너뜀) → HW-9 */
    const input = w.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')).toEqual([['k9']])
  })
})

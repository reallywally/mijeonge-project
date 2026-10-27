// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TestGantt from './TestGantt.vue'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useTestStore } from '@/stores/test'

/* 테스트 간트 — 작업 간트와 같은 껍데기(GanttChart)를 진짜 dhtmlx 로 그려 본다.
   jsdom 은 크기가 0 이라 TaskGantt.test 처럼 크기를 있는 척해 준다 */
for (const prop of ['offsetHeight', 'clientHeight']) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 })
}
for (const prop of ['offsetWidth', 'clientWidth']) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1200 })
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
  await useTestStore().load()
})

afterEach(() => {
  vi.useRealTimers()
})

async function mountGantt() {
  const w = mount(TestGantt, { attachTo: document.body })
  await flushPromises()
  return w
}

describe('테스트 간트', () => {
  it('묶음 트리로 서고, 묶음 줄은 하위에서 모은 상태 배지를 단다', async () => {
    const w = await mountGantt()
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(8)
    expect(w.get('.gantt_grid_data [data-task-id="tc6"]').attributes('aria-level')).toBe('2')
    expect(w.findAll('.gantt_task_line.gantt_project')).toHaveLength(2)

    const group = w.get('.gantt_grid_data [data-task-id="tc5"] .tg-badge')
    expect(group.text()).toBe('실패')
    expect(group.classes()).toContain('tg-badge-fail')
    expect(w.get('.gantt_grid_head_cell').text()).toBe('테스트')
  })

  it('기간 미정은 막대가 없고, 기간 지남 · 오래 걸림 막대는 테두리를 세운다', async () => {
    const w = await mountGantt()
    expect(w.get('.gantt_grid_data [data-task-id="tc8"]').text()).toContain('기간 미정')
    expect(w.find('.gantt_task_line[data-task-id="tc8"]').exists()).toBe(false)
    expect(w.get('.gantt_task_line[data-task-id="tc3"]').classes()).toEqual(
      expect.arrayContaining(['tg-bar-testing', 'tg-bar-late']),
    )
    expect(w.get('.gantt_task_line[data-task-id="tc2"]').classes()).toContain('tg-bar-pass')
    expect(w.get('.gantt_task_line[data-task-id="tc2"]').classes()).not.toContain('tg-bar-late')
  })

  it("줄을 누르면 상세, '+' 는 그 줄 아래 추가를 알린다 — 선행 화살표는 없다", async () => {
    const w = await mountGantt()
    await w.get('.gantt_grid_data [data-task-id="tc7"]').trigger('click')
    expect(w.emitted('open-test')).toEqual([['tc7']])

    await w.get('.gantt_grid_data [data-task-id="tc5"] .gantt_add').trigger('click')
    await flushPromises()
    expect(w.emitted('add-test')).toEqual([['tc5']])
    expect(w.findAll('.gantt_task_link')).toHaveLength(0)
    expect(w.find('.gantt_link_control').exists()).toBe(false)
  })
})

// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaskGantt from './TaskGantt.vue'
import { useTaskStore } from '@/stores/task'

/* dhtmlx 는 컨테이너의 실제 높이를 재서 보이는 줄만 그린다. jsdom 은 모든 크기가 0 이라
   한 줄도 안 그려지므로, 이 파일에서만 크기를 있는 척해 준다. 이렇게 해야 우리가 붙인
   열 template · 주말 띠 · 기간 미정 처리가 진짜로 그려지는지 볼 수 있다. */
for (const prop of ['offsetHeight', 'clientHeight']) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 })
}
for (const prop of ['offsetWidth', 'clientWidth']) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1200 })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
})

async function mountGantt() {
  const w = mount(TaskGantt, { attachTo: document.body })
  await flushPromises()
  return w
}

describe('간트차트', () => {
  it('목록과 달리 계층 트리로 선다', async () => {
    const w = await mountGantt()
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(21)

    const tool01 = w.get('.gantt_grid_data [data-task-id="k8"]')
    /* 개발 › AI Biz › 가상비서 아래 네 번째 단 */
    expect(tool01.attributes('aria-level')).toBe('4')
    expect(tool01.text()).toContain('HW-8')
  })

  it('자식이 있는 작업은 자식들의 기간을 덮는 묶음 막대가 된다', async () => {
    const w = await mountGantt()
    expect(w.findAll('.gantt_task_line.gantt_project')).toHaveLength(7)
  })

  it('기간 미정 작업은 그리드에는 서고 막대는 없다', async () => {
    const w = await mountGantt()
    /* 21건 중 기간 미정 한 건만 막대가 없다 */
    expect(w.findAll('.gantt_task_line')).toHaveLength(20)

    const row = w.get('.gantt_grid_data [data-task-id="k18"]')
    expect(row.classes()).toContain('tg-row-unscheduled')
    expect(row.text()).toContain('기간 미정')
    expect(w.find('.gantt_task_line[data-task-id="k18"]').exists()).toBe(false)
  })

  it('상태 · 담당자 열은 우리가 그린다', async () => {
    const w = await mountGantt()
    const row = w.get('.gantt_grid_data [data-task-id="k18"]')
    expect(row.get('.tg-badge').text()).toBe('막힘')
    expect(row.get('.tg-badge').classes()).toContain('tg-badge-blocked')
    expect(row.get('.tg-avatar').text()).toBe('정')

    /* 담당자가 없는 줄은 빈 동그라미다 */
    expect(w.get('.gantt_grid_data [data-task-id="k5"] .tg-avatar').classes()).toContain(
      'tg-avatar-none',
    )
  })

  it('주말에 회색 띠가 깔리고 오늘 칸에 표가 난다', async () => {
    /* 오늘은 진짜 시계를 본다 — 목업의 9월이 지나가도 테스트가 안 흔들리게 날을 고정한다 */
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 22))
    const w = await mountGantt()

    /* 주말 띠는 날짜 줄에만 — 위의 주 눈금까지 물들면 그 주가 통째로 주말로 보인다 */
    expect(w.findAll('.gantt_task_scale .tg-weekend').length).toBeGreaterThan(0)
    expect(w.findAll('.gantt_task_cell.tg-weekend').length).toBeGreaterThan(0)
    /* 오늘은 날짜 눈금 한 칸과 줄마다 한 칸 — 세로로 이어져 선이 된다 */
    expect(w.findAll('.gantt_scale_cell.tg-today')).toHaveLength(1)
    expect(w.findAll('.gantt_task_cell.tg-today')).toHaveLength(21)
    vi.useRealTimers()
  })

  it('주에서 개월로 눈금을 바꾼다', async () => {
    const w = await mountGantt()
    expect(w.get('.gantt_task_scale').text()).toContain('월 ')

    await w
      .findAll('button')
      .find((b) => b.text() === '개월')!
      .trigger('click')
    await flushPromises()
    expect(w.get('.gantt_task_scale').text()).toContain('2026년')
  })

  it('줄을 누르면 작업 상세를 열라고 알린다', async () => {
    const w = await mountGantt()
    await w.get('.gantt_grid_data [data-task-id="k18"]').trigger('click')
    expect(w.emitted('open-task')).toEqual([['k18']])
  })

  it('접기 화살표는 팝업을 열지 않고 접기만 한다', async () => {
    const w = await mountGantt()
    const caret = w.get('.gantt_grid_data [data-task-id="k7"] .gantt_tree_icon')
    await caret.trigger('click')
    await flushPromises()

    expect(w.emitted('open-task')).toBeUndefined()
    /* 가상비서 아래 네 줄이 접힌다 */
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(17)
  })

  it("'+' 는 그 줄 아래로 작업을 만들라고 알린다 — 라이브러리가 직접 만들지 않는다", async () => {
    const w = await mountGantt()
    const taskStore = useTaskStore()
    await w.get('.gantt_grid_data [data-task-id="k4"] .gantt_add').trigger('click')
    await flushPromises()

    expect(w.emitted('add-task')).toEqual([['k4']])
    expect(taskStore.rows).toHaveLength(21)
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(21)
  })

  it('기본 편집창은 뜨지 않는다', async () => {
    const w = await mountGantt()
    await w.get('.gantt_grid_data [data-task-id="k4"]').trigger('dblclick')
    await flushPromises()
    expect(document.querySelector('.gantt_cal_light')).toBeNull()
  })
})

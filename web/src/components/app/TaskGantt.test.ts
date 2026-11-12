// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Gantt } from 'dhtmlx-gantt'
import type { GanttStatic } from 'dhtmlx-gantt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GanttChart from './GanttChart.vue'
import TaskGantt from './TaskGantt.vue'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
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
afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  /* 처음 열면 오늘이 가운데다 — 목업의 9 · 10월이 보이게 오늘을 9/22 로 고정한다.
     진짜 시계를 따르면 날이 갈수록 보이는 막대가 바뀌어 검사가 흔들린다 */
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 22))
  /* 완료 숨기기는 처음이 켜짐이다 — 22줄 트리를 보는 검사들이라 끄고 시작한다 */
  localStorage.clear()
  localStorage.setItem('innoflow.tasks.hideDone', 'off')
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
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(22)

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
    /* 기간 미정(k18)은 막대가 없다. 보이는 폭 밖의 막대는 dhtmlx 가 그리지 않아 개수는 폭 따라
       달라진다 — 오늘(9/22) 언저리의 막대가 서는지와 k18 이 빠지는지만 본다 */
    const bars = w.findAll('.gantt_task_line').map((b) => b.attributes('data-task-id'))
    expect(bars).toEqual(expect.arrayContaining(['k3', 'k7', 'k9']))
    expect(bars).not.toContain('k18')

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
    /* 담당자는 첫 글자가 아니라 이름 전체 — 가리키면 같은 이름 */
    const owner = row.get('.tg-owner')
    expect(owner.text()).toBe(
      useDataStore().memberName(useDataStore().allTasks.find((t) => t.id === 'k18')!.ownerId),
    )
    expect(owner.text().length).toBeGreaterThan(1)
    expect(owner.attributes('title')).toBe(owner.text())

    /* 담당자가 없는 줄은 '–' 다 */
    expect(w.get('.gantt_grid_data [data-task-id="k5"] .tg-owner').classes()).toContain(
      'tg-owner-none',
    )
  })

  it('담당자 동그라미 — 사진이 없으면 첫 글자, 있으면 그 위에 사진을 덮는다', async () => {
    const data = useDataStore()
    const ownerId = data.allTasks.find((t) => t.id === 'k18')!.ownerId!
    const name = data.memberName(ownerId)!

    const w = await mountGantt()
    const bare = w.get('.gantt_grid_data [data-task-id="k18"] .tg-avatar')
    expect(bare.text()).toBe(name.charAt(0))
    expect(bare.find('img').exists()).toBe(false)
    w.unmount()

    const photo = 'data:image/png;base64,iVBORw0KGgo='
    data.setMemberAvatar(ownerId, photo)
    const w2 = await mountGantt()
    const avatar = w2.get('.gantt_grid_data [data-task-id="k18"] .tg-avatar')
    /* 사진이 안 열려도 밑의 글자가 보이게 글자는 그대로 둔다 — 글자 속 스크립트(onerror) 없이 */
    expect(avatar.text()).toBe(name.charAt(0))
    const img = avatar.get('img.tg-avatar-img')
    expect(img.attributes('src')).toBe(photo)
    expect(img.attributes('alt')).toBe('')
    expect(img.attributes('onerror')).toBeUndefined()
    expect(w2.get('.gantt_grid_data [data-task-id="k18"] .tg-owner').text()).toBe(name)
  })

  it('거른 꼴이 아닌 사진 주소는 싣지 않는다', async () => {
    const data = useDataStore()
    const ownerId = data.allTasks.find((t) => t.id === 'k18')!.ownerId!
    data.setMemberAvatar(ownerId, '" onerror="alert(1)')
    const w = await mountGantt()
    const avatar = w.get('.gantt_grid_data [data-task-id="k18"] .tg-avatar')
    expect(avatar.find('img').exists()).toBe(false)
    expect(document.body.innerHTML).not.toContain('alert(1)')
  })

  it('주말에 회색 띠가 깔리고 오늘 칸에 표가 난다', async () => {
    const w = await mountGantt()

    /* 주말 띠는 날짜 줄에만 — 위의 주 눈금까지 물들면 그 주가 통째로 주말로 보인다 */
    expect(w.findAll('.gantt_task_scale .tg-weekend').length).toBeGreaterThan(0)
    expect(w.findAll('.gantt_task_cell.tg-weekend').length).toBeGreaterThan(0)
    /* 오늘은 날짜 눈금 한 칸과 줄마다 한 칸 — 세로로 이어져 선이 된다 */
    expect(w.findAll('.gantt_scale_cell.tg-today')).toHaveLength(1)
    expect(w.findAll('.gantt_task_cell.tg-today')).toHaveLength(22)
  })

  it('처음 열면 오늘이 타임라인 가운데에 온다', async () => {
    const spy = vi.spyOn(Gantt, 'getGanttInstance')
    await mountGantt()
    const chart = spy.mock.results[0].value as GanttStatic
    const today = new Date(2026, 8, 22)
    const day = chart.posFromDate(new Date(2026, 8, 23)) - chart.posFromDate(today)
    /* 보이는 타임라인 = 1200 - 그리드 556. 오늘 칸의 가운데가 그 가운데에 선다 */
    const visible = 1200 - chart.config.grid_width
    expect(chart.getScrollState().x).toBe(chart.posFromDate(today) + day / 2 - visible / 2)
    spy.mockRestore()
  })

  it('다시 그려도(다시 받기 · 눈금 범위가 바뀌어도) 보던 날짜를 지킨다 — 오늘이 옆으로 밀리지 않는다', async () => {
    const spy = vi.spyOn(Gantt, 'getGanttInstance')
    await mountGantt()
    const chart = spy.mock.results[0].value as GanttStatic
    const leftDay = () => chart.dateFromPos(chart.getScrollState().x).toDateString()
    const before = leftDay()

    /* 맨 앞 작업을 두 달 당겨 눈금 시작이 앞으로 늘어난 줄을 새로 받는다 — 픽셀로 지키면 오늘이 오른쪽으로 밀린다 */
    const data = useDataStore()
    const first = [...data.allTasks]
      .filter((t) => t.start)
      .sort((a, b) => a.start!.localeCompare(b.start!))[0]!
    data.allTasks = data.allTasks.map((t) =>
      t.id === first.id ? { ...t, start: '2026-06-01' } : { ...t },
    )
    await flushPromises()
    expect(leftDay()).toBe(before)
    spy.mockRestore()
  })

  it('작업이 다 지난 뒤에도 눈금이 오늘까지 늘어나 오늘 칸이 선다', async () => {
    vi.setSystemTime(new Date(2026, 11, 15))
    const w = await mountGantt()
    expect(w.findAll('.gantt_scale_cell.tg-today')).toHaveLength(1)
  })

  it("4단 줄은 '+' 를 숨긴다 — 그 밑은 5단이다 (Q64)", async () => {
    const w = await mountGantt()
    expect(w.get('.gantt_grid_data [data-task-id="k9"]').classes()).toContain('tg-row-noadd')
    expect(w.get('.gantt_grid_data [data-task-id="k7"]').classes()).not.toContain('tg-row-noadd')
  })

  it('완료 숨기기를 켜면 하위가 다 끝난 완료 줄이 빠진다 (Q64)', async () => {
    useTaskStore().setHideDone(true)
    const w = await mountGantt()
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(19)
    expect(w.find('.gantt_grid_data [data-task-id="k8"]').exists()).toBe(false)
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
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(18)
  })

  it("'+' 는 그 줄 아래로 작업을 만들라고 알린다 — 라이브러리가 직접 만들지 않는다", async () => {
    const w = await mountGantt()
    const taskStore = useTaskStore()
    await w.get('.gantt_grid_data [data-task-id="k4"] .gantt_add').trigger('click')
    await flushPromises()

    expect(w.emitted('add-task')).toEqual([['k4']])
    expect(taskStore.rows).toHaveLength(22)
    expect(w.findAll('.gantt_grid_data .gantt_row')).toHaveLength(22)
  })

  it('기본 편집창은 뜨지 않는다', async () => {
    const w = await mountGantt()
    await w.get('.gantt_grid_data [data-task-id="k4"]').trigger('dblclick')
    await flushPromises()
    expect(document.querySelector('.gantt_cal_light')).toBeNull()
  })
})

describe('간트차트 — 화살표', () => {
  it('선행 작업은 걷었다(Q63) — 화살표도, 끌어 걸 손잡이도 없다', async () => {
    const w = await mountGantt()
    expect(w.findAll('.gantt_task_link')).toHaveLength(0)
    expect(w.find('.gantt_link_control').exists()).toBe(false)
  })
})

describe('간트차트 — 줄 끌어 옮기기', () => {
  /* jsdom 에서는 끌기를 흉내 낼 수 없어 dhtmlx 가 놓을 때 부르는 이벤트를 직접 부른다.
     onBeforeRowDragEnd 가 false 면 dhtmlx 는 옮기지 않고, 아니면 옮긴 뒤 onRowDragEnd 를 부른다 */
  async function mountAs(memberId: string | null) {
    resetMockAuth()
    if (memberId) await useAuthStore().login(`${memberId}@inno-ax.com`, MOCK_PASSWORD)
    /* 업무 화면은 내 파트로 시작한다 — 줄 전부를 놓고 본다 */
    usePartStore().setScope('all')
    const spy = vi.spyOn(Gantt, 'getGanttInstance')
    const w = await mountGantt()
    const chart = spy.mock.results.at(-1)!.value as GanttStatic
    spy.mockRestore()
    return { w, chart, chart_: w.getComponent(GanttChart) }
  }

  /** dhtmlx 가 하는 대로 — 물어보고, 되면 옮기고, 놓았다고 알린다 */
  function drop(chart: GanttStatic, id: string, parent: string, index: number) {
    if (chart.callEvent('onBeforeRowDragEnd', [id, parent, index]) === false) return false
    chart.moveTask(id, index, parent)
    chart.callEvent('onRowDragEnd', [id, parent, index])
    return true
  }

  const orderUnder = (parentId: string | null) =>
    useTaskStore()
      .tasks.filter((t) => t.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id)

  it('작업 간트는 줄 끌기를 켠다 — 다른 상위로도 놓인다', async () => {
    const { chart } = await mountAs('u1')
    expect(chart.config.order_branch).toBe('marker')
    expect(chart.config.order_branch_free).toBe(true)
  })

  it('놓으면 새 상위와 바로 뒤 형제를 알리고, 스토어가 내려 준 순서로 다시 그린다', async () => {
    const { chart, chart_ } = await mountAs('u1')
    /* 개발 환경 설정(k4) 밑 HW-22 를 맨 앞(HW-19 앞)으로 */
    expect(drop(chart, 'k22', 'k4', 0)).toBe(true)
    expect(chart_.emitted('reorder')).toEqual([['k22', 'k4', 'k19']])
    expect(orderUnder('k4')).toEqual(['k22', 'k19', 'k20', 'k21'])
    await flushPromises()
    expect(chart.getChildren('k4')).toEqual(['k22', 'k19', 'k20', 'k21'])

    /* 최상위의 맨 끝으로 — 상위는 null, 뒤 형제도 null */
    drop(chart, 'k20', '0', 3)
    expect(chart_.emitted('reorder')!.at(-1)).toEqual(['k20', null, null])
    expect(orderUnder(null)).toEqual(['k1', 'k4', 'k5', 'k20'])
    await flushPromises()
    expect(chart.getChildren(chart.config.root_id)).toEqual(['k1', 'k4', 'k5', 'k20'])
    expect(chart.getTaskCount()).toBe(22)
  })

  it('자기 아래 · 4단 줄 밑 · 4단을 넘기는 자리는 놓기 전에 막는다', async () => {
    const { chart, chart_ } = await mountAs('u1')
    /* 개발(k5) 을 자기 하위인 가상비서(k7) 밑으로 */
    expect(drop(chart, 'k5', 'k7', 0)).toBe(false)
    /* 4단 작업 tool02(k9) 밑 — 5단이 된다 */
    expect(drop(chart, 'k21', 'k9', 0)).toBe(false)
    /* 하위까지 2단인 가상비서(k7) 를 3단 AI 심사(k12) 밑으로 — 5단이 된다 */
    expect(drop(chart, 'k7', 'k12', 0)).toBe(false)
    expect(chart_.emitted('reorder')).toBeUndefined()
    expect(chart.callEvent('onBeforeRowDragMove', ['k7', 'k12', 0])).toBe(false)
    expect(chart.callEvent('onBeforeRowDragMove', ['k8', 'k12', 0])).toBe(true)
  })

  it('잠긴 줄(고칠 권한 없음)은 끌기를 시작하지 못한다', async () => {
    /* 이도현(u3)은 HW-18(기간계 연동 작업, 등록은 이도현)을 그 파트의 수정 권한이 없어 못 고친다. HW-20 은 담당이라 고친다 */
    const { chart } = await mountAs('u3')
    expect(chart.callEvent('onRowDragStart', ['k18', document.body, new Event('mousedown')])).toBe(
      false,
    )
    expect(chart.callEvent('onBeforeRowDragEnd', ['k18', '0', 0])).toBe(false)
    expect(chart.callEvent('onRowDragStart', ['k20', document.body, new Event('mousedown')])).toBe(
      true,
    )
  })

  it('스토어가 받지 않으면(같은 자리 · 거절) 원래 자리로 돌아온다', async () => {
    const { chart } = await mountAs('u1')
    vi.spyOn(useTaskStore(), 'moveTask').mockImplementation(() => {})
    drop(chart, 'k22', 'k1', 0)
    expect(chart.getParent('k22')).toBe('k1')
    await new Promise((r) => setTimeout(r, 0))
    expect(chart.getParent('k22')).toBe('k4')
    expect(chart.getChildren('k4')).toEqual(['k19', 'k20', 'k21', 'k22'])
  })
})

describe('테스트 간트', () => {
  it('줄 끌기는 꺼져 있다', async () => {
    const spy = vi.spyOn(Gantt, 'getGanttInstance')
    mount(GanttChart, {
      props: { items: [], period: '', titleLabel: '테스트', hint: '' },
      attachTo: document.body,
    })
    await flushPromises()
    const chart = spy.mock.results.at(-1)!.value as GanttStatic
    spy.mockRestore()
    expect(chart.config.order_branch).toBe(false)
    expect(chart.config.order_branch_free).toBe(false)
  })
})

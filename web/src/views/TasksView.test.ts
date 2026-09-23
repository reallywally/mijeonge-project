// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { Select } from '@/components/ui/select'
import { useTaskStore } from '@/stores/task'
import TasksView from './TasksView.vue'

/* dhtmlx-gantt 는 jsdom 에서 컨테이너 높이가 0 이라 줄을 한 줄도 그리지 않는다.
   라이브러리 대신 스텁을 세우고, 우리가 무엇을 건네고 어떤 손놀림을 받아 쓰는지만 본다.
   스토어를 간트 모양으로 옮기는 일은 lib/gantt.test.ts 가 따로 본다. */
const chart = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  templates: {} as Record<string, unknown>,
  events: {} as Record<string, (...args: unknown[]) => unknown>,
  parsed: [] as { id: string; key: string; parent: string; unscheduled?: boolean }[],
  dragged: {} as Record<string, { start_date: Date; end_date: Date }>,
  destroyed: 0,
  attachEvent(name: string, fn: (...args: unknown[]) => unknown) {
    chart.events[name] = fn
    return name
  },
  init() {},
  parse(payload: { data: typeof chart.parsed }) {
    chart.parsed = payload.data
  },
  clearAll() {
    chart.parsed = []
  },
  destructor() {
    chart.destroyed += 1
  },
  render() {},
  showDate() {},
  getTask(id: string) {
    return chart.dragged[id]
  },
}))

vi.mock('dhtmlx-gantt', () => ({
  Gantt: { getGanttInstance: () => chart },
  escapeHTML: (value: string) => value,
}))

/* 화면이 실제로 떠야 잡히는 것들 — 템플릿 오류, shadcn 컴포넌트 쓰는 법, 거르기가
   화면까지 닿는지. 타입 검사만으로는 안 걸린다.
   팝업은 teleport 로 document.body 에 나가므로 목록은 wrapper 에서, 팝업은 body 에서 본다. */
async function mountView(path = '/tasks') {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/tasks', name: 'tasks', component: TasksView },
      { path: '/tasks/new', name: 'task-new', component: TasksView },
      { path: '/tasks/:id', name: 'task', component: TasksView },
      { path: '/:rest(.*)', component: TasksView },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(TasksView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

/* 팝업 쪽 손놀림 — teleport 된 DOM 을 그대로 누른다 */
const popupText = () => document.body.textContent ?? ''
const popupButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const popupButtonWith = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

async function click(el: Element | undefined) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function fill(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  chart.events = {}
  chart.parsed = []
  chart.dragged = {}
  chart.destroyed = 0
})

describe('작업 목록 화면', () => {
  it('뜬다', async () => {
    const w = await mountView()
    expect(w.text()).toContain('작업')
    expect(w.text()).toContain('목록')
  })

  it('한 쪽에 여덟 줄씩 놓고 총 건수를 적는다', async () => {
    const w = await mountView()
    expect(w.findAll('tbody tr')).toHaveLength(8)
    expect(w.text()).toContain('총 21건 중 1–8건')
  })

  it('제목 아래에 어디에 속한 작업인지 경로가 붙는다', async () => {
    const w = await mountView()
    expect(w.text()).toContain('최상위 작업 · 하위 2건')
    expect(w.text()).toContain('설계')
  })

  it('상태 칩이 그 상태의 수를 들고 있다', async () => {
    const w = await mountView()
    const chips = w.findAll('button').map((b) => b.text())
    expect(chips.some((t) => t.startsWith('막힘') && t.endsWith('1'))).toBe(true)
    expect(chips.some((t) => t.startsWith('기간 미정') && t.endsWith('1'))).toBe(true)
  })

  it("'그 작업만 보기'를 누르면 막힌 작업만 남는다", async () => {
    const w = await mountView()
    const link = w
      .findAll('button')
      .find(
        (b) => b.text() === '그 작업만 보기' && b.classes().some((c) => c.includes('destructive')),
      )
    await link!.trigger('click')

    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('보험료 산출 기간계 API 개발')
    expect(rows[0].text()).toContain('기간 미정')
  })

  it('기간이 잡힌 작업은 기간이 슬래시로 적힌다', async () => {
    const w = await mountView()
    expect(w.text()).toContain('9/8 ~ 9/15')
  })
})

describe('작업 상세 팝업', () => {
  it('행을 누르면 그 작업의 제목과 경로를 들고 뜬다', async () => {
    const w = await mountView()
    await w.findAll('tbody tr')[3].trigger('click')
    await flushPromises()

    expect(popupText()).toContain('개발 환경 설정')
    expect(popupText()).toContain('HW-4')
    expect(popupText()).toContain('최상위 작업 · 하위 3건')
    expect(popupText()).toContain('체크박스는 눌러서 켜고 끕니다')
    /* 걸린 안건이 지금까지 정해진 내용까지 달고 온다 */
    expect(popupText()).toContain('서버 OS 결정')
    expect(popupText()).toContain('mysql 을 쓴다')
  })

  it('주소로 바로 들어와도 열린 채로 시작한다', async () => {
    await mountView('/tasks/k18')
    expect(popupText()).toContain('보험료 산출 기간계 API 개발')
    expect(popupText()).toContain('기간 미정')
    expect(popupText()).toContain('등록된 회의에서 고르기')
  })

  it('안건을 걸면 걸린 목록에 들어가고, 해제하면 빠진다', async () => {
    await mountView('/tasks/k4')
    const taskStore = useTaskStore()
    expect(taskStore.threadsOfTask('k4').map((t) => t.id)).toEqual(['t1', 't2'])

    await click(popupButton('개발 서버 백업 주기'))
    expect(taskStore.threadsOfTask('k4').map((t) => t.id)).toEqual(['t1', 't2', 't4'])
    /* 고르는 자리에서는 빠지고 걸린 목록으로 내려간다 */
    expect(popupButton('개발 서버 백업 주기')).toBeUndefined()

    const unlink = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === '연결 해제',
    )
    await click(unlink[2])
    expect(taskStore.threadsOfTask('k4').map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('회의도 같은 모양으로 걸고 뗀다', async () => {
    await mountView('/tasks/k4')
    const taskStore = useTaskStore()
    expect(taskStore.meetingsOfTask('k4').map((m) => m.id)).toEqual(['m3'])

    await click(popupButtonWith('일정 조율 회의'))
    expect(taskStore.meetingsOfTask('k4').map((m) => m.id)).toEqual(['m3', 'm6'])
  })

  it('본문의 체크박스를 눌러서 켠다', async () => {
    await mountView('/tasks/k4')
    const taskStore = useTaskStore()
    const line = () => taskStore.taskDetail('k4')!.task.body.find((l) => l.id === 'l3')!
    expect(line().done).toBe(false)

    await click(popupButton('mysql 설치와 계정 발급'))
    expect(line().done).toBe(true)
  })

  it("'하위 작업 추가'는 상위 작업이 채워진 채로 추가 폼을 연다", async () => {
    await mountView('/tasks/k4')
    await click(popupButton('하위 작업 추가'))
    expect(popupText()).toContain('작업 추가')
    expect(popupText()).toContain('개발 환경 설정 아래로 들어갑니다')
  })
})

describe('작업 추가 팝업', () => {
  it('제목과 내용을 적고 만들면 목록 건수가 늘어난다', async () => {
    const w = await mountView('/tasks/new')
    const taskStore = useTaskStore()
    expect(taskStore.rows).toHaveLength(21)

    await fill('input[placeholder="예: 보험료 산출 기간계 API 개발"]', 'CI 러너 붙이기')
    await fill('textarea', '[] 러너 등록\n- 사내 인증서가 필요하다')
    await click(popupButton('만들기'))

    expect(taskStore.rows).toHaveLength(22)
    const made = taskStore.rows.find((r) => r.task.title === 'CI 러너 붙이기')!
    expect(made.task.body.map((l) => l.kind)).toEqual(['check', 'bullet'])
    expect(w.text()).toContain('총 22건 중 1–8건')
  })

  it('제목이 비면 만들 수 없다', async () => {
    await mountView('/tasks/new')
    expect(popupText()).toContain('제목을 적어야 만들 수 있습니다')
    expect(popupButton('만들기')!.hasAttribute('disabled')).toBe(true)
  })
})

describe('칸반보드 탭', () => {
  /* 카드의 상태 셀렉트 — reka-ui 셀렉트는 jsdom 에서 열리지 않으므로 고른 값만 흘려 넣는다 */
  const cardSelect = (w: Awaited<ReturnType<typeof mountView>>, taskId: string) =>
    w
      .findAllComponents(Select)
      .find((s) => (s.element as HTMLElement)?.closest?.(`[data-task-id="${taskId}"]`))

  it('칸 넷이 상태 순서대로 서고, 묶음 작업은 카드가 되지 않는다', async () => {
    const w = await mountView('/tasks?view=board')
    expect(w.findAll('[data-column]').map((c) => c.attributes('data-column'))).toEqual([
      'todo',
      'doing',
      'blocked',
      'done',
    ])
    expect(w.text()).toContain('해야 할 일')
    expect(w.text()).toContain('막힘')

    /* 잎 작업 14건만 올라온다 — 자식이 있는 7건(설계 · 개발 환경 설정 · 개발 …)은 빠진다 */
    const ids = w.findAll('[data-task-id]').map((c) => c.attributes('data-task-id'))
    expect(ids).toHaveLength(14)
    /* 설계(k1) · 개발 환경 설정(k4) · 개발(k5) · AI Biz(k6) … 는 카드가 없다.
       제목 아래 경로로만 남는다 */
    for (const parentId of ['k1', 'k4', 'k5', 'k6', 'k7', 'k12', 'k14']) {
      expect(ids).not.toContain(parentId)
    }
    expect(w.get('[data-column="todo"]').findAll('[data-task-id]')).toHaveLength(7)
    expect(w.get('[data-column="doing"]').findAll('[data-task-id]')).toHaveLength(3)
    expect(w.get('[data-column="done"]').findAll('[data-task-id]')).toHaveLength(3)
  })

  it('카드의 상태를 바꾸면 다른 칸으로 옮겨간다', async () => {
    const w = await mountView('/tasks?view=board')
    expect(w.find('[data-column="todo"] [data-task-id="k21"]').exists()).toBe(true)

    cardSelect(w, 'k21')!.vm.$emit('update:modelValue', 'doing')
    await flushPromises()

    expect(w.find('[data-column="todo"] [data-task-id="k21"]').exists()).toBe(false)
    expect(w.find('[data-column="doing"] [data-task-id="k21"]').exists()).toBe(true)
    expect(useTaskStore().rows.find((r) => r.task.id === 'k21')!.task.status).toBe('doing')
  })

  it('막힌 카드는 막힘 칸에서 빨간 안건 배지를 들고 있다', async () => {
    const w = await mountView('/tasks?view=board')
    const card = w.get('[data-column="blocked"] [data-task-id="k18"]')
    expect(card.text()).toContain('HW-18')
    expect(card.text()).toContain('보험료 산출 기간계 API 개발')
    expect(card.text()).toContain('기간 미정')

    const badge = card.get('button[aria-label$="연관 안건"]')
    expect(badge.text()).toContain('안건 1')
    expect(badge.get('div').classes()).toContain('bg-destructive')
  })

  it('안건 배지를 누르면 상세가 아니라 그 안건으로 간다', async () => {
    const w = await mountView('/tasks?view=board')
    await w.get('[data-task-id="k18"] button[aria-label$="연관 안건"]').trigger('click')
    await flushPromises()

    expect(window.location.pathname).toBe('/threads/t5')
    expect(popupText()).not.toContain('보험료 산출 기간계 API 개발')
  })

  it('카드를 누르면 작업 상세가 뜨고 주소에 칸반이 남는다', async () => {
    const w = await mountView('/tasks?view=board')
    await w.get('[data-task-id="k18"]').trigger('click')
    await flushPromises()

    expect(popupText()).toContain('보험료 산출 기간계 API 개발')
    expect(window.location.pathname).toBe('/tasks/k18')
    expect(window.location.search).toContain('view=board')
  })

  it("칸 아래 '작업 추가'는 그 칸의 상태로 만든다", async () => {
    const w = await mountView('/tasks?view=board')
    const taskStore = useTaskStore()
    const add = w
      .get('[data-column="blocked"]')
      .findAll('button')
      .find((b) => b.text() === '작업 추가')
    await add!.trigger('click')
    await flushPromises()

    expect(window.location.search).toContain('status=blocked')
    expect(popupText()).toContain('작업 추가')

    await fill('input[placeholder="예: 보험료 산출 기간계 API 개발"]', '정산 배치 재설계')
    await click(popupButton('만들기'))

    const made = taskStore.rows.find((r) => r.task.title === '정산 배치 재설계')!
    expect(made.task.status).toBe('blocked')
  })
})

describe('간트차트 탭', () => {
  const parsed = (key: string) => chart.parsed.find((t) => t.key === key)!

  it('탭 셋이 서고 간트가 골라진다', async () => {
    const w = await mountView('/tasks?view=gantt')
    const tabs = w.findAll('a.border-b-2').map((a) => a.text())
    expect(tabs).toEqual(['목록', '간트차트', '칸반보드'])

    const gantt = w.findAll('a.border-b-2').find((a) => a.text() === '간트차트')!
    expect(gantt.classes()).toContain('border-foreground')
    /* 조회 조건 · 페이징은 목록 탭의 것이라 간트에는 없다 */
    expect(w.text()).not.toContain('조회 조건에 맞는 작업이 없습니다')
    expect(w.text()).toContain('/ 21 완료')
    expect(w.text()).toContain('막대 읽는 법')
  })

  it('목록과 달리 계층을 그대로 넘긴다. 기간 미정은 막대가 없다', async () => {
    await mountView('/tasks?view=gantt')
    expect(chart.parsed).toHaveLength(21)
    expect(parsed('HW-8').parent).toBe('k7')
    expect(parsed('HW-1').parent).toBe('0')
    expect(parsed('HW-18').unscheduled).toBe(true)
    expect(parsed('HW-4').unscheduled).toBeUndefined()
  })

  it('기본 편집창은 뜨지 않는다', async () => {
    await mountView('/tasks?view=gantt')
    expect(chart.events.onBeforeLightbox()).toBe(false)
  })

  it('줄을 누르면 작업 상세가 뜨고 주소에 간트가 남는다', async () => {
    await mountView('/tasks?view=gantt')
    chart.events.onTaskClick('k18', { target: document.createElement('div') })
    await flushPromises()

    expect(popupText()).toContain('보험료 산출 기간계 API 개발')
    expect(window.location.pathname).toBe('/tasks/k18')
    expect(window.location.search).toContain('view=gantt')
  })

  it('접기 화살표는 팝업을 열지 않는다', async () => {
    await mountView('/tasks?view=gantt')
    const caret = document.createElement('div')
    caret.className = 'gantt_tree_icon'
    document.body.appendChild(caret)

    expect(chart.events.onTaskClick('k5', { target: caret })).toBe(true)
    await flushPromises()
    expect(window.location.pathname).toBe('/tasks')
  })

  it("'+' 는 상위 작업이 채워진 채로 추가 팝업을 연다", async () => {
    await mountView('/tasks?view=gantt')
    /* 라이브러리가 제 손으로 줄을 만들지 않게 막는다 */
    expect(chart.events.onTaskCreated({ parent: 'k4' })).toBe(false)
    await flushPromises()

    expect(window.location.pathname).toBe('/tasks/new')
    expect(window.location.search).toContain('parent=k4')
    expect(window.location.search).toContain('view=gantt')
    expect(popupText()).toContain('개발 환경 설정 아래로 들어갑니다')
  })

  it('막대를 끌면 스토어의 기간이 바뀐다', async () => {
    await mountView('/tasks?view=gantt')
    const taskStore = useTaskStore()
    /* 간트의 끝은 열린 구간이라 9/19 로 놓으면 9/18 까지다 */
    chart.dragged.k4 = { start_date: new Date(2026, 8, 10), end_date: new Date(2026, 8, 19) }
    chart.events.onAfterTaskDrag('k4')
    await flushPromises()

    const row = taskStore.rows.find((r) => r.task.key === 'HW-4')!
    expect(row.task.start).toBe('2026-09-10')
    expect(row.task.due).toBe('2026-09-18')
  })

  it('탭을 떠나면 간트를 치운다', async () => {
    const w = await mountView('/tasks?view=gantt')
    expect(chart.destroyed).toBe(0)
    w.unmount()
    expect(chart.destroyed).toBe(1)
  })
})

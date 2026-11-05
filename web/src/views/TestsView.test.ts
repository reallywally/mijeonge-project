// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { createTestComment } from '@/api/comments'
import { resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { Select } from '@/components/ui/select'
import MemberPicker from '@/components/app/MemberPicker.vue'
import { useAuthStore } from '@/stores/auth'
import { usePartStore } from '@/stores/part'
import { useTestStore } from '@/stores/test'
import CcField from '@/components/app/CcField.vue'
import TasksView from './TasksView.vue'
import TestsView from './TestsView.vue'
import AgendaListView from './AgendaListView.vue'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 간트는 jsdom 에서 줄을 그리지 않는다 — 작업 화면 검사처럼 스텁을 세우고 무엇을 건네는지만 본다 */
const chart = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  templates: {} as Record<string, unknown>,
  events: {} as Record<string, (...args: unknown[]) => unknown>,
  parsed: [] as {
    id: string
    key: string
    parent: string
    type?: string
    status: string
    late?: boolean
    unscheduled?: boolean
    context?: boolean
  }[],
  dragged: {} as Record<string, { start_date: Date; end_date: Date }>,
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
  destructor() {},
  render() {},
  showDate() {},
  /* 하루 = 26px — 처음 열 때 오늘을 가운데로 미는 셈에만 쓴다 */
  posFromDate(d: Date) {
    return Math.round(d.getTime() / 86_400_000) * 26
  },
  scrollTo() {},
  getScrollState() {
    return { x: 0, y: 0 }
  },
  dateFromPos(x: number) {
    return new Date((x / 26) * 86_400_000)
  },
  getTask(id: string) {
    return chart.dragged[id]
  },
}))

vi.mock('dhtmlx-gantt', () => ({
  Gantt: { getGanttInstance: () => chart },
  escapeHTML: (value: string) => value,
}))

async function mountAt(path: string, email = 'u1@inno-ax.com') {
  await useAuthStore().login(email, MOCK_PASSWORD)
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/tests', component: TestsView },
      { path: '/tests/new', component: TestsView },
      { path: '/tests/:id', component: TestsView },
      { path: '/tasks', component: TasksView },
      { path: '/tasks/:id', component: TasksView },
      { path: '/agendas/:id', component: AgendaListView },
      { path: '/:rest(.*)', component: TestsView },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return { w, router }
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const popupText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? ''
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

/** 속성 패널의 상태 고르기 — 그 테스트의 지금 상태를 쥔 Select */
const statusSelect = (w: Awaited<ReturnType<typeof mountAt>>['w'], testId: string) =>
  w
    .findAllComponents(Select)
    .find((s) => s.props('modelValue') === useTestStore().byId[testId].status)!

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function type(selector: string, value: string) {
  const el = $(selector) as HTMLInputElement | HTMLTextAreaElement | null
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function blur(selector: string) {
  $(selector)!.dispatchEvent(new FocusEvent('blur'))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  chart.events = {}
  chart.parsed = []
  chart.dragged = {}
  /* 오늘을 계약의 검사 날로 */
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("테스트 화면 — '지금'", () => {
  it('맨 위 숫자 카드 · 지금 테스트 중 · 손쓸 테스트가 선다', async () => {
    await mountAt('/tests?view=list')
    const value = (key: string) => text(`[data-test-now-card="${key}"] [data-card-value]`)
    expect(
      ['testing', 'longRunning', 'overdue', 'blocked', 'fail', 'basisChanged'].map(value),
    ).toEqual(['2', '1', '1', '1', '1', '1'])

    expect($$('[data-test-testing]').map((r) => r.dataset.testTesting)).toEqual(['tc3', 'tc8'])
    /* 기간이 지난 것에 '7일 지남', 기간이 없으면 '기간 미정' */
    expect(text('[data-test-testing="tc3"]')).toContain('12일째')
    expect(text('[data-test-testing="tc3"]')).toContain('7일 지남')
    expect(text('[data-test-testing="tc8"]')).toContain('기간 미정')

    expect($$('[data-test-attention]').map((r) => r.dataset.testAttention)).toEqual([
      'tc3',
      'tc6',
      'tc4',
      'tc7',
    ])
    expect(text('[data-test-attention="tc6"]')).toContain('오래 막힘')
  })

  it('카드를 누르면 그 테스트만 거르고, 다시 누르면 푼다', async () => {
    await mountAt('/tests?view=list')
    expect($$('[data-test-row]')).toHaveLength(8)
    await click($('[data-test-now-card="blocked"]'))
    expect($$('[data-test-row]').map((r) => r.dataset.testRow)).toEqual(['tc6'])
    expect(text('[data-test-card-filter]')).toContain('막힘')
    await click($('[data-test-now-card="blocked"]'))
    expect($$('[data-test-row]')).toHaveLength(8)
  })

  it('목록 줄 — 묶음은 하위에서 모은 상태 · 경로 · 태그 칩 · N일째 · 신호', async () => {
    await mountAt('/tests?view=list')
    const row = (id: string) => text(`[data-test-row="${id}"]`)
    expect(row('tc5')).toContain('실패')
    expect(row('tc5')).toContain('최상위 테스트 · 하위 3건')
    expect(row('tc6')).toContain('HW-21')
    expect(row('tc6')).toContain('13일째')
    expect(row('tc3')).toContain('10/6 ~ 10/8')
    expect(row('tc4')).toContain('기준 바뀜')
    expect(row('tc4')).toContain('DB 결정')
  })
})

describe('테스트 상세', () => {
  it('줄을 누르면 주소가 붙고 상태 · N일째가 보인다. 상태 고르기로 성공으로 바꾼다', async () => {
    const { w } = await mountAt('/tests?view=list')
    await click($('[data-test-row="tc3"]'))
    expect(window.location.pathname).toBe('/tests/tc3')
    expect(popupText()).toContain('비밀번호 5회 틀림 잠금')
    expect(text('[data-test-status-days]')).toBe('12일째')

    statusSelect(w, 'tc3').vm.$emit('update:modelValue', 'pass')
    await flushPromises()
    expect(useTestStore().byId.tc3.status).toBe('pass')
    expect(text('[data-test-status-days]')).toBe('오늘부터')
  })

  it('상태 칸 · [성공] · [실패] 는 없다 — 고르기에서 실패 · 막힘을 골라도 메모 없이 바로 보낸다', async () => {
    const { w } = await mountAt('/tests/tc8')
    for (const gone of ['성공', '실패', '실패로 남기기', '막힘으로 남기기', '테스트 시작', '통과'])
      expect(button(gone), gone).toBeUndefined()
    expect($('textarea[aria-label="실패 메모"]')).toBeNull()

    statusSelect(w, 'tc8').vm.$emit('update:modelValue', 'fail')
    await flushPromises()
    expect(useTestStore().byId.tc8).toMatchObject({ status: 'fail', resultNote: '' })
    expect($('textarea[aria-label="실패 메모"]')).toBeNull()

    statusSelect(w, 'tc8').vm.$emit('update:modelValue', 'blocked')
    await flushPromises()
    expect(useTestStore().byId.tc8).toMatchObject({ status: 'blocked', resultNote: '' })

    statusSelect(w, 'tc8').vm.$emit('update:modelValue', 'ready')
    await flushPromises()
    expect(useTestStore().byId.tc8.status).toBe('ready')
    expect(text('[data-test-status-days]')).toBe('오늘부터')
  })

  it('묶음은 버튼 대신 하위 요약을 보인다', async () => {
    await mountAt('/tests/tc5')
    expect(text('[data-test-group-summary]')).toContain('실패')
    expect($$('[data-test-child]').map((r) => r.dataset.testChild)).toEqual(['tc6', 'tc7', 'tc8'])
    expect(button('성공')).toBeUndefined()
    expect(document.body.querySelector('[aria-label="상태"]')).toBeNull()
  })

  it('기준 바뀜이면 바뀐 결정 줄을 보이고 [그대로 맞다] 로 푼다', async () => {
    await mountAt('/tests/tc4')
    expect(text('[data-test-basis-entry]')).toContain('mysql 을 쓴다')
    await click(button('그대로 맞다'))
    expect($('[data-test-basis]')).toBeNull()
    expect(useTestStore().byId.tc4.signals).toEqual(['notStarted'])
  })

  it('테스트 내용은 글 칸 하나 — 벗어나면 저장된다', async () => {
    await mountAt('/tests/tc8')
    const field = $('textarea[aria-label="테스트 내용"]') as HTMLTextAreaElement
    expect(field.value).toBe('단계\n1. [계정 목록 내려받기] → 모든 계정이 담긴 CSV 가 받아진다')
    expect($('[aria-label="목적"]')).toBeNull()
    /* 멈춘 시계에서는 Vue 가 이벤트 시각(_vts)으로 blur 를 걸러 버린다 — 받은 뒤로는 진짜 시계로 */
    vi.useRealTimers()
    await type('textarea[aria-label="테스트 내용"]', '받은 CSV 를 연다')
    await blur('textarea[aria-label="테스트 내용"]')
    expect(useTestStore().byId.tc8.content).toBe('받은 CSV 를 연다')
  })

  it('태그 칩을 누르면 그 작업 상세로 간다', async () => {
    await mountAt('/tests/tc6')
    await click($('[data-test-ref="task:k21"] button'))
    expect(window.location.pathname).toBe('/tasks/k21')
  })

  it('지우기는 만든 사람 · 관리자에게만 보인다', async () => {
    await mountAt('/tests/tc2', 'u3@inno-ax.com')
    expect(popupText()).toContain('올바른 계정으로 로그인')
    expect($('[data-test-remove]')).toBeNull()
  })
})

describe('테스트 상세 — 조치 내역', () => {
  const thread = '[data-comment-thread="test"]'
  const items = () => $$(`${thread} li[data-comment-id]`)

  it('테스트 데이터 아래에 빈 타래로 서고, 남기면 맨 뒤에 붙고 조치 N 이 는다', async () => {
    await mountAt('/tests/tc8')
    expect(text(`${thread} [data-comment-count]`)).toBe('조치 0')
    expect(text(thread)).toContain('아직 조치 내역이 없습니다.')
    /* 지난 결과 메모가 없는 테스트에는 그 칸이 없다 */
    expect($('[data-test-result-note]')).toBeNull()

    await type(`${thread} textarea[aria-label="조치 내역"]`, ' 권한 설정을 다시 걸었다 ')
    await click(button('조치 남기기'))
    expect(items().map((li) => li.querySelector('p')?.textContent)).toEqual([
      '권한 설정을 다시 걸었다',
    ])
    expect(items()[0].textContent).toContain('김서연')
    expect(useTestStore().byId.tc8.commentCount).toBe(1)
    expect(text(`${thread} [data-comment-count]`)).toBe('조치 1')
    expect(($(`${thread} textarea[aria-label="조치 내역"]`) as HTMLTextAreaElement).value).toBe('')
  })

  it('작성자는 고치고, 지우기는 한 번 더 묻고 지운다 — 조치 N 이 준다', async () => {
    await mountAt('/tests/tc8')
    await type(`${thread} textarea[aria-label="조치 내역"]`, '계정을 다시 만들었다')
    await click(button('조치 남기기'))

    await click($(`${thread} button[aria-label="조치 내역 고치기"]`))
    await type(`${thread} textarea[aria-label="조치 내역 고치기"]`, '계정을 지우고 다시 만들었다')
    await click(button('저장'))
    expect(items()[0].querySelector('p')?.textContent).toBe('계정을 지우고 다시 만들었다')
    expect(items()[0].textContent).toContain('(수정됨)')

    await click($(`${thread} button[aria-label="조치 내역 지우기"]`))
    expect(text(thread)).toContain('지울까요?')
    await click(button('삭제'))
    expect(items()).toHaveLength(0)
    expect(useTestStore().byId.tc8.commentCount).toBe(0)
    expect(text(`${thread} [data-comment-count]`)).toBe('조치 0')
  })

  it('남의 조치 내역 — 일반 사용자는 메뉴가 없고, 프로젝트 관리자는 지우기만 선다', async () => {
    writeMockSession('u2')
    await createTestComment('tc8', { body: '박지훈이 남긴 조치' })
    const { w } = await mountAt('/tests/tc8', 'u3@inno-ax.com')
    expect(items()).toHaveLength(1)
    expect($(`${thread} button[aria-label="조치 내역 고치기"]`)).toBeNull()
    expect($(`${thread} button[aria-label="조치 내역 지우기"]`)).toBeNull()
    w.unmount()

    setActivePinia(createPinia())
    document.body.innerHTML = ''
    await mountAt('/tests/tc8')
    expect($(`${thread} button[aria-label="조치 내역 고치기"]`)).toBeNull()
    expect($(`${thread} button[aria-label="조치 내역 지우기"]`)).not.toBeNull()
  })

  it('지난 결과 메모가 있으면 타래 위에 읽기 전용으로 보인다', async () => {
    await mountAt('/tests/tc7')
    const note = $(`${thread} [data-test-result-note]`)
    expect(note?.textContent).toContain('지난 결과 메모')
    /* 줄바꿈을 살려 그리므로 앞뒤에 빈칸이 끼면 안 된다 */
    expect(note?.querySelector('p')?.textContent).toBe('관리 화면 주소를 직접 치면 열린다.')
    expect(note?.querySelector('textarea, input')).toBeNull()
  })
})

describe('테스트 추가', () => {
  it('?task= 로 오면 태그가 걸린 채 열리고, 만들면 그 상세로 간다', async () => {
    await mountAt('/tests/new?task=k21')
    expect($('[data-test-ref="task:k21"]')).not.toBeNull()
    await click(button('만들기'))
    expect(popupText()).toContain('제목은 1 ~ 200자로 적어 주세요.')

    await type('textarea[aria-label="제목"]', '계정 메일 다시 보내기')
    await click(button('만들기'))
    const made = useTestStore().tests.find((t) => t.title === '계정 메일 다시 보내기')!
    expect(made).toMatchObject({
      key: 'HW-T9',
      status: 'draft',
      refs: [{ kind: 'task', id: 'k21' }],
    })
    expect(window.location.pathname).toBe(`/tests/${made.id}`)
  })
})

describe('테스트 참조', () => {
  const chips = () => $$('[data-cc-field] [data-cc]').map((c) => c.dataset.cc)

  it('나를 참조를 켜면 내가 참조인 테스트만, 초기화하면 푼다', async () => {
    const { w } = await mountAt('/tests?view=list', 'u3@inno-ax.com')
    usePartStore().setScope('all')
    await flushPromises()
    const all = $$('[data-test-row]').length
    /* 이도현(u3)은 tc2 의 참조 */
    await w.find('[data-cc-mine]').trigger('click')
    expect($$('[data-test-row]').map((r) => r.dataset.testRow)).toEqual(['tc2'])
    await click(button('초기화'))
    expect($$('[data-test-row]')).toHaveLength(all)
  })

  it('상세 — 담당자 아래 참조 칩, 더하고 빼면 바로 저장되고 이력이 남는다', async () => {
    const { w } = await mountAt('/tests/tc2')
    expect(chips()).toEqual(['u3'])
    w.findComponent(CcField).findComponent(MemberPicker).vm.$emit('pick', 'u4')
    await flushPromises()
    expect(useTestStore().byId.tc2.ccIds).toEqual(['u3', 'u4'])
    await click($('[data-cc="u3"] [data-cc-remove]'))
    expect(useTestStore().byId.tc2.ccIds).toEqual(['u4'])
    expect(chips()).toEqual(['u4'])

    const { fetchTestHistory } = await import('@/api/history')
    const rows = (await fetchTestHistory('tc2'))
      .flatMap((e) => e.changes)
      .filter((c) => c.field === 'ccIds')
    expect(rows.map((c) => c.to)).toEqual([['u3', 'u4'], ['u4']])
  })

  it('추가 — 고른 참조가 실려 들어간다', async () => {
    const { w } = await mountAt('/tests/new')
    await type('textarea[aria-label="제목"]', '참조 붙인 테스트')
    w.findComponent(CcField).findComponent(MemberPicker).vm.$emit('pick', 'u2')
    await flushPromises()
    await click(button('만들기'))
    const made = useTestStore().tests.find((t) => t.title === '참조 붙인 테스트')!
    expect(made.ccIds).toEqual(['u2'])
  })
})

describe('테스트 간트', () => {
  it('테스트 메뉴로 들어오면 간트가 기본이고, 목록 탭은 view=list 로 간다', async () => {
    const { w } = await mountAt('/tests')
    const tab = (label: string) => w.findAll('a.border-b-2').find((a) => a.text() === label)!
    expect(tab('목록').attributes('href')).toBe('/tests?view=list')
    expect(tab('간트차트').attributes('href')).toBe('/tests')
    expect(tab('간트차트').classes()).toContain('border-primary')
  })

  it('묶음 트리 · 기간 미정 · 늦은 막대를 넘기고, 끌면 기간을 고친다', async () => {
    await mountAt('/tests')
    const parsed = (id: string) => chart.parsed.find((t) => t.id === id)!
    expect(chart.parsed).toHaveLength(8)
    expect(parsed('tc1')).toMatchObject({ type: 'project', parent: '0', status: 'testing' })
    expect(parsed('tc6')).toMatchObject({ parent: 'tc5', unscheduled: true })
    expect(parsed('tc3').late).toBe(true)
    expect(chart.config.drag_links).toBe(false)
    expect(text('[data-test-now-strip]')).toContain('기간 지남')

    chart.dragged.tc8 = { start_date: new Date(2026, 9, 14), end_date: new Date(2026, 9, 17) }
    chart.events.onAfterTaskDrag('tc8')
    await flushPromises()
    expect(useTestStore().byId.tc8).toMatchObject({ start: '2026-10-14', due: '2026-10-16' })
  })

  it('내 테스트만 — 켜면 내가 담당 · 참조인 테스트와 그 상위(흐리게)만, 목록에는 서지 않는다', async () => {
    const { w } = await mountAt('/tests', 'u3@inno-ax.com')
    usePartStore().setScope('all')
    await flushPromises()
    const toggle = w.find('[data-mine-only]')
    expect(toggle.attributes('data-state')).toBe('unchecked')
    expect(chart.parsed).toHaveLength(8)

    await toggle.trigger('click')
    await flushPromises()
    /* 이도현(u3) — tc5 · tc6 담당, tc2 참조. tc1 은 tc2 의 상위라 흐리게 선다 */
    expect(chart.parsed.map((t) => t.id).sort()).toEqual(['tc1', 'tc2', 'tc5', 'tc6'])
    expect(chart.parsed.filter((t) => t.context).map((t) => t.id)).toEqual(['tc1'])
    expect(w.find('[data-mine-count]').attributes('title')).toBe('담당 · 참조 3건')

    await toggle.trigger('click')
    await flushPromises()
    expect(chart.parsed).toHaveLength(8)

    await w.vm.$router.push('/tests?view=list')
    await flushPromises()
    expect(w.find('[data-mine-only]').exists()).toBe(false)
  })

  it("줄의 '+' 는 그 묶음 아래로 추가 팝업을 연다", async () => {
    await mountAt('/tests')
    expect(chart.events.onTaskCreated({ parent: 'tc5' })).toBe(false)
    await flushPromises()
    expect(window.location.pathname).toBe('/tests/new')
    expect(window.location.search).toContain('parent=tc5')
    expect(text('button[aria-label="상위 테스트"]')).toContain('HW-T5')
  })
})

describe('작업 상세의 태그한 테스트', () => {
  it('작업 상세에 읽기 전용 칩, [테스트 추가] 는 그 작업을 태그로 건 채 연다', async () => {
    await mountAt('/tasks/k21')
    expect(text('[data-tagged-test="tc6"]')).toContain('HW-T6')
    expect(text('[data-tagged-test="tc6"]')).toContain('막힘')
    await click(
      [...$$('[data-tagged-tests] button')].find((b) => b.textContent?.includes('테스트 추가')),
    )
    expect(window.location.pathname).toBe('/tests/new')
    expect(window.location.search).toContain('task=k21')
  })

  it('안건 상세에는 태그한 테스트 칸이 없다', async () => {
    await mountAt('/agendas/t2')
    expect($('[role="dialog"]')).not.toBeNull()
    expect($('[data-tagged-tests]')).toBeNull()
  })
})

describe('테스트 상세 — 변경 이력', () => {
  const entries = () => $$('[data-history-entry]').map((e) => e.textContent!.replace(/\s+/g, ' '))

  it('펼치면 부르고, 실패 줄은 상태 · 결과 메모를 한 줄에 — 긴 글은 펼친다', async () => {
    await mountAt('/tests/tc7')
    expect(entries()).toEqual([])
    await click($('[data-history-toggle]'))
    const [fail, created] = entries()
    expect(fail).toContain('김서연')
    expect(fail).toContain('상태: 테스트 중 → 실패')
    expect(fail).toContain('결과 메모: 없음 → 관리 화면 주소를 직접 치면 열린다.')
    expect(created).toContain('등록')

    /* 긴 결과 메모는 줄여 보이다가 펼친다 — 화면은 메모를 더 받지 않지만 계약은 note 를 그대로 받는다 */
    await useTestStore().setStatus('tc7', { status: 'fail', note: '가'.repeat(80) })
    await flushPromises()
    expect(entries()[0]).toContain('상태: 실패 (다시 고름)')
    expect(entries()[0]).toContain(`${'가'.repeat(60)}…`)
    await click($('[data-history-more]'))
    expect(entries()[0]).toContain('가'.repeat(80))
  })

  it('펼친 채로 테스트 내용 · 태그를 바꾸면 다시 부른다', async () => {
    await mountAt('/tests/tc1')
    await click($('[data-history-toggle]'))
    expect(entries()).toHaveLength(1)
    await useTestStore().patch('tc1', { content: '연다' })
    await useTestStore().addRef('tc1', { kind: 'task', id: 'k4' })
    await flushPromises()
    expect(entries()[0]).toContain('작업 태그 걸기: HW-4')
    expect(entries()[1]).toContain('테스트 내용')
  })
})

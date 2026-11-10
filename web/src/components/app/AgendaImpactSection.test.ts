// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as api from '@/api'
import { ApiError } from '@/api'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAgendaStore } from '@/stores/agenda'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import { useTestStore } from '@/stores/test'
import AgendaDetailDialog from './AgendaDetailDialog.vue'

/* 안건 상세의 AI 영향도 분석 칸 — 알림 줄 · 분석 → 결과 · 지우기 / 되돌리기 · 고치기 · 반영 · 409 · 권한 잠금 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function signedIn(email = 'u1@inno-ax.com') {
  await useAuthStore().login(email, MOCK_PASSWORD)
  await useDataStore().retry()
  await useTestStore().load()
}

async function mountDetail(agendaId: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)', component: Blank }],
  })
  await router.push('/agendas')
  const w = mount(AgendaDetailDialog, {
    props: { agendaId, open: true },
    global: { plugins: [router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { w, router }
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const row = (key: string) => $(`[data-impact-row="${key}"]`)
const applyButton = () => $('[data-impact-apply]') as HTMLButtonElement | null
const checked = (key: string) =>
  row(key)!.querySelector('[data-impact-pick]')!.getAttribute('data-state') === 'checked'

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

/** [AI 영향도 분석] → 결과까지 */
async function analyzed(agendaId = 't2') {
  const page = await mountDetail(agendaId)
  await click($('[data-impact-run]'))
  await vi.runAllTimersAsync()
  await flushPromises()
  return page
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  await signedIn()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('칸 · 알림 줄', () => {
  it('결정내용이 없으면 칸이 없고, 처음 결정(판 1)이면 알림 줄 없이 [AI 영향도 분석]', async () => {
    const { w } = await mountDetail('t3')
    expect($('[data-impact-section]')).toBeNull()
    w.unmount()

    await mountDetail('t2')
    expect($('[data-impact-section]')).toBeTruthy()
    expect($('[data-impact-alert]')).toBeNull()
    expect($('[data-impact-run]')!.textContent).toContain('AI 영향도 분석')
  })

  it('결정이 바뀌었는데(판 2) 그 판으로 분석한 적이 없으면 알림 줄 — 연결 작업 · 테스트 수', async () => {
    useAgendaStore().updateAgenda('t2', { decision: 'PostgreSQL 로 바꾼다' })
    await mountDetail('t2')
    expect($('[data-impact-alert-text]')!.textContent).toContain(
      '결정이 바뀌었어요 — 연결 작업 2 · 테스트 2',
    )
  })

  it('같은 화면에서 결정을 고쳐 판이 오르면 다시 받아 알림 줄이 선다', async () => {
    await mountDetail('t2')
    expect($('[data-impact-alert]')).toBeNull()
    useAgendaStore().updateAgenda('t2', { decision: 'PostgreSQL 로 바꾼다' })
    await flushPromises()
    expect($('[data-impact-alert]')).toBeTruthy()
  })
})

describe('분석 → 결과', () => {
  it('진행 한 줄과 [멈추기] 뒤 요약 · 전 → 후 · 고칠 작업 · 고칠 테스트 · 부딪히는 결정 · 접힌 살펴본 것', async () => {
    useAgendaStore().updateAgenda('t2', { decision: 'PostgreSQL 로 바꾼다' })
    await mountDetail('t2')
    await click($('[data-impact-run]'))
    expect($('[data-impact-progress]')!.textContent).toContain('결정을 읽는 중')
    expect($('[data-impact-stop]')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(130)
    expect($('[data-impact-progress]')!.textContent).toContain('연결 작업 읽는 중')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect($('[data-impact-progress]')).toBeNull()
    expect($('[data-impact-alert]')).toBeNull()
    expect($('[data-impact-run]')!.textContent).toContain('다시 분석')
    expect($('[data-impact-summary]')!.textContent).toContain('PostgreSQL 로 바꾼다')
    expect($('[data-impact-decision]')!.textContent).toContain('mysql 을 쓴다')
    expect($('[data-impact-decision]')!.textContent).toContain('PostgreSQL 로 바꾼다')
    expect($('[data-impact-meta]')!.textContent).toContain('김서연')

    expect($$('[data-impact-row]').map((r) => r.dataset.impactRow)).toEqual(['task:k4', 'test:tc2'])
    expect(row('task:k4')!.textContent).toContain('HW-4')
    expect(checked('task:k4')).toBe(true)
    /* 본문은 바뀐 줄만 — 지운 줄 · 넣은 줄과 그대로인 줄 접기 */
    const ops = [...row('task:k4')!.querySelectorAll<HTMLElement>('[data-op]')].map(
      (li) => li.dataset.op,
    )
    expect(ops).toContain('del')
    expect(ops).toContain('add')
    expect(ops).toContain('gap')
    expect(row('test:tc2')!.querySelector('[data-op="add"]')!.textContent).toContain(
      '바뀐 결정 확인: PostgreSQL 로 바꾼다',
    )

    expect($('[data-impact-conflict="t6"]')!.dataset.verdict).toBe('check')
    expect($('[data-impact-conflict="t6"]')!.textContent).toContain('확인 필요')

    expect($('[data-impact-seen]')).toBeNull()
    await click($('[data-impact-seen-toggle]'))
    expect($$('[data-impact-seen-row]').map((r) => r.dataset.impactSeenRow)).toEqual([
      'task:k22',
      'test:tc4',
    ])
    expect(applyButton()!.textContent).toContain('반영 2건')
  })

  it('[멈추기] 하면 아무것도 남지 않는다', async () => {
    await mountDetail('t2')
    await click($('[data-impact-run]'))
    await vi.advanceTimersByTimeAsync(130)
    await click($('[data-impact-stop]'))
    await vi.runAllTimersAsync()
    await flushPromises()
    expect($('[data-impact-progress]')).toBeNull()
    expect($('[data-impact-result]')).toBeNull()
    expect(mockDb().impacts).toEqual([])
  })

  it('키 칩을 누르면 그 상세 주소로', async () => {
    const { router } = await analyzed()
    await click($('[data-impact-open="task:k4"]'))
    expect(router.currentRoute.value.path).toBe('/tasks/k4')
  })
})

describe('검토', () => {
  it('[지우기] — 줄이 사라지고 반영에서 빠진다, [되돌리기] 로 살린다', async () => {
    await analyzed()
    await click(row('task:k4')!.querySelector('[data-impact-remove]'))
    expect(row('task:k4')).toBeNull()
    expect(applyButton()!.textContent).toContain('반영 1건')
    expect($('[data-impact-rows-removed]')!.textContent).toContain(
      "지운 항목 1개 — 마지막: 작업 HW-4 '개발 환경 설정'",
    )
    await click($('[data-impact-undo]'))
    expect(row('task:k4')).toBeTruthy()
    expect(checked('task:k4')).toBe(true)
    expect($('[data-impact-rows-removed]')).toBeNull()
    expect(applyButton()!.textContent).toContain('반영 2건')
  })

  it('[고치기] — 고친 안을 손으로 고쳐 그대로 반영한다', async () => {
    await analyzed()
    await click(row('test:tc2')!.querySelector('[data-impact-edit]'))
    const box = row('test:tc2')!.querySelector<HTMLTextAreaElement>('[data-impact-edit-content]')!
    box.value = '손으로 고친 테스트 내용'
    box.dispatchEvent(new Event('input'))
    await flushPromises()
    await click(row('task:k4')!.querySelector('[data-impact-remove]'))
    await click(applyButton())
    expect(mockDb().tests.find((t) => t.id === 'tc2')!.content).toBe('손으로 고친 테스트 내용')
    expect(useTestStore().byId.tc2.content).toBe('손으로 고친 테스트 내용')
  })

  it('작업 고칠 권한이 없으면 체크를 끄고 "고칠 권한이 없어요" 로 잠근다', async () => {
    resetMockAuth()
    await signedIn('u2@inno-ax.com')
    /* t5 의 연결 작업 k18 — 등록 이도현 · 담당 정하늘 */
    await analyzed('t5')
    expect(row('task:k18')!.dataset.impactStatus).toBe('locked')
    expect(row('task:k18')!.querySelector('[data-impact-locked]')!.textContent).toContain(
      '고칠 권한이 없어요',
    )
    expect(checked('task:k18')).toBe(false)
    expect(
      (row('task:k18')!.querySelector('[data-impact-edit]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(applyButton()!.textContent).toContain('반영 0건')
    expect(applyButton()!.disabled).toBe(true)
  })
})

describe('반영', () => {
  it('[반영 N건] — 작업 · 테스트가 스토어에 들어가고 그 줄은 반영함으로 잠근다', async () => {
    await analyzed()
    await click(applyButton())
    expect(row('task:k4')!.querySelector('[data-impact-applied]')!.textContent).toContain('반영함')
    expect(row('test:tc2')!.querySelector('[data-impact-applied]')).toBeTruthy()
    expect(row('task:k4')!.querySelector('[data-impact-remove]')).toBeNull()
    expect(applyButton()!.textContent).toContain('반영 0건')
    const k4 = useDataStore().allTasks.find((t) => t.id === 'k4')!
    expect(k4.body[0].text).toBe('서버 신청서 제출 — mysql 을 쓴다 기준')
    expect(useTestStore().byId.tc2.content).toContain('바뀐 결정 확인: mysql 을 쓴다')
  })

  it('409 IMPACT_TARGET_CHANGED — 걸린 줄에 "분석 뒤에 바뀌었어요" 를 달고 체크를 끈다, 나머지는 다시 반영', async () => {
    await analyzed()
    useTaskStore().setTitle('k4', '그사이 고친 제목')
    await click(applyButton())
    expect(row('task:k4')!.querySelector('[data-impact-changed]')!.textContent).toContain(
      '분석 뒤에 바뀌었어요',
    )
    expect(checked('task:k4')).toBe(false)
    expect(checked('test:tc2')).toBe(true)
    expect(applyButton()!.textContent).toContain('반영 1건')

    await click(applyButton())
    expect(row('test:tc2')!.querySelector('[data-impact-applied]')).toBeTruthy()
  })

  it('409 IMPACT_STALE — 결과를 흐리고 [다시 분석] 을 권한다, 반영은 꺼진다', async () => {
    await analyzed()
    vi.spyOn(api, 'applyAgendaImpact').mockRejectedValueOnce(
      new ApiError(409, { code: 'IMPACT_STALE', message: '결정이 바뀌어 다시 분석해야 합니다.' }),
    )
    await click(applyButton())
    expect($('[data-impact-stale-note]')!.textContent).toContain('이전 결정으로 한 분석이에요')
    expect($('[data-impact-result]')!.dataset.impactStale).toBe('true')
    expect(applyButton()!.disabled).toBe(true)
  })

  it('분석 뒤 결정을 또 고치면 이전 판 분석 — 흐리고 알림 줄이 다시 선다', async () => {
    await analyzed()
    useAgendaStore().updateAgenda('t2', { decision: 'PostgreSQL 로 바꾼다' })
    await flushPromises()
    expect($('[data-impact-stale-note]')).toBeTruthy()
    expect($('[data-impact-alert]')).toBeTruthy()
    expect(applyButton()!.disabled).toBe(true)
    await click($('[data-impact-rerun]'))
    await vi.runAllTimersAsync()
    await flushPromises()
    expect($('[data-impact-stale-note]')).toBeNull()
    expect(applyButton()!.disabled).toBe(false)
  })
})

/** 숨은 영향 — 서버 OS 결정(t1)을 록키로 바꾸고, 연결 안 된 HW-19 본문 · 닿지 않는 tc1 내용에 '우분투' 를 적는다 */
function plantHidden() {
  useDataStore().allTasks.find((t) => t.id === 'k19')!.body = [
    { id: 'h1', kind: 'check', text: 'OS 를 우분투로 설치한다', done: false, level: 0 },
  ]
  mockDb().tests.find((t) => t.id === 'tc1')!.content = '서버 OS: 우분투 최신'
  useAgendaStore().updateAgenda('t1', { decision: '록키 최신 버전으로 한다' })
}

const linkChecked = (key: string) =>
  row(key)!.querySelector('[data-impact-link]')!.getAttribute('data-state') === 'checked'

describe('숨은 영향 — 연결 안 된 줄', () => {
  it('고칠 작업 · 고칠 테스트에 같이 든다 — 배지 · [✓ 이 안건에 연결], check 줄은 확인 필요 + 근거, 연결만 고른다', async () => {
    plantHidden()
    await analyzed('t1')
    expect($$('[data-impact-row]').map((r) => r.dataset.impactRow)).toEqual([
      'task:k4',
      'task:k19',
      'test:tc2',
      'test:tc1',
    ])
    expect(row('task:k4')!.querySelector('[data-impact-unlinked]')).toBeNull()
    expect(row('task:k4')!.querySelector('[data-impact-link]')).toBeNull()

    const k19 = row('task:k19')!
    expect(k19.querySelector('[data-impact-unlinked]')!.textContent).toContain(
      '연결 안 됨 · AI 가 찾음',
    )
    expect(k19.textContent).toContain('이 안건에 연결')
    expect(linkChecked('task:k19')).toBe(true)
    expect(checked('task:k19')).toBe(true)
    expect(k19.querySelector('[data-op="add"]')!.textContent).toContain('OS 를 록키로 설치한다')

    const tc1 = row('test:tc1')!
    expect(tc1.querySelector('[data-impact-check]')!.textContent).toContain('확인 필요')
    expect(tc1.querySelector('[data-impact-reason]')!.textContent).toContain('우분투')
    expect(tc1.querySelector('[data-impact-pick]')).toBeNull()
    expect(tc1.querySelector('[data-impact-edit]')).toBeNull()
    expect(tc1.querySelector('[data-impact-diff]')).toBeNull()
    expect(linkChecked('test:tc1')).toBe(true)

    /* 살펴본 것(접힘)에는 들지 않는다 — t1 은 나머지가 다 고칠 줄이라 접힌 묶음이 없다 */
    expect($('[data-impact-seen-toggle]')).toBeNull()
    expect(applyButton()!.textContent).toContain('반영 4건')

    /* check 줄의 연결을 끄면 보낼 것이 없어 하나 준다, 고칠 안 줄의 연결을 꺼도 고칠 안은 남는다 */
    await click(tc1.querySelector('[data-impact-link]'))
    expect(applyButton()!.textContent).toContain('반영 3건')
    await click(k19.querySelector('[data-impact-link]'))
    expect(linkChecked('task:k19')).toBe(false)
    expect(applyButton()!.textContent).toContain('반영 3건')
  })

  it('[반영] — 연결한 줄은 "반영함 · 연결함", 링크가 데이터 스토어에 · 태그가 테스트 스토어에 든다', async () => {
    plantHidden()
    await analyzed('t1')
    await click(applyButton())
    expect(row('task:k19')!.querySelector('[data-impact-applied]')!.textContent).toContain(
      '반영함 · 연결함',
    )
    expect(row('test:tc1')!.querySelector('[data-impact-applied]')!.textContent).toContain(
      '반영함 · 연결함',
    )
    expect(row('task:k4')!.querySelector('[data-impact-applied]')!.textContent).not.toContain(
      '연결함',
    )
    expect(row('task:k19')!.querySelector('[data-impact-link]')).toBeNull()
    expect(useDataStore().taskAgendas).toContainEqual({ taskId: 'k19', agendaId: 't1' })
    expect(useTestStore().byId.tc1.refs).toContainEqual({ kind: 'agenda', id: 't1' })
  })

  it('연결을 끄고 반영하면 고칠 안만 — 링크가 생기지 않는다', async () => {
    plantHidden()
    await analyzed('t1')
    const spy = vi.spyOn(api, 'applyAgendaImpact')
    await click(row('task:k19')!.querySelector('[data-impact-link]'))
    await click(row('test:tc1')!.querySelector('[data-impact-remove]'))
    await click(applyButton())
    const sent = spy.mock.calls[0][1]
    expect(sent.tasks.find((t) => t.taskId === 'k19')).not.toHaveProperty('link')
    expect(sent.tests.map((t) => t.testId)).toEqual(['tc2'])
    expect(row('task:k19')!.querySelector('[data-impact-applied]')!.textContent).not.toContain(
      '연결함',
    )
    expect(useDataStore().taskAgendas).not.toContainEqual({ taskId: 'k19', agendaId: 't1' })
  })
})

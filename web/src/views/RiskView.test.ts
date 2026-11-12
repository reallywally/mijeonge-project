// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import * as api from '@/api'
import { ApiError } from '@/api'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { mockCreateRiskDraft } from '@/api/riskAnalyses'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD, riskReports } from '@/fixtures'
import { kstToday } from '@/lib/date'
import { toastError } from '@/lib/notify'
import { DEFAULT_RISK_SETTINGS } from '@/lib/risk'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useRiskStore } from '@/stores/risk'
import RiskView from './RiskView.vue'

/* 리스크 대시보드 — 카드 · 막대 · 섞은 목록 · 거르기 · [내 파트 | 전체] · 관리자만 [기준 바꾸기] · 422 를 칸에 붙이기 · 줄을 누르면 상세 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

let router: Router

async function mountRisks(path = '/risks') {
  router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/risks', component: RiskView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(RiskView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return w
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
/* 볼 파트 고르기 — 'all' 은 풀기 단추(고른 게 있을 때만 선다), 'mine' 은 고르기 단추 */
const scopeButton = (key: 'mine' | 'all') =>
  document.body.querySelector<HTMLButtonElement>(
    key === 'all' ? '[data-part-pick-clear]' : '[data-part-pick]',
  )
const pickLabel = () => document.body.querySelector('[data-part-pick-label]')?.textContent?.trim()
const field = (key: string) =>
  document.body.querySelector<HTMLInputElement>(`input[data-field="${key}"]`)
const problem = (key: string) => document.body.querySelector(`[data-problem="${key}"]`)

async function type(key: string, value: string) {
  const input = field(key)
  expect(input, `${key} 칸이 없다`).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input'))
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

const listRows = () => [...document.body.querySelectorAll<HTMLElement>('[data-risk-row]')]
const rowKeys = () => listRows().map((r) => `${r.dataset.riskRow}:${r.dataset.riskId}`)
const $card = (key: string) => document.body.querySelector<HTMLElement>(`[data-risk-card="${key}"]`)
const cardText = (key: string, part: 'big' | 'sub') =>
  $card(key)!.querySelector(`[data-card-${part}]`)!.textContent!.replace(/\s+/g, ' ').trim()

describe('대시보드', () => {
  it('전체로 보면(u1) 숫자 카드 · 신호 막대 · 섞은 목록이 다 선다', async () => {
    await signedIn('u1@inno-ax.com')
    usePartStore().setScope('all')
    const w = await mountRisks()

    /* 카드 — 큰 숫자 = 높음 + 중간 */
    expect(cardText('agenda', 'big')).toBe('4')
    expect(cardText('agenda', 'sub')).toBe('높음 0 · 중간 4 · 낮음 2')
    expect(cardText('task', 'big')).toBe('18')
    expect(cardText('task', 'sub')).toBe('높음 7 · 중간 11 · 낮음 1')
    expect(cardText('test', 'big')).toBe('4')
    expect(cardText('test', 'sub')).toBe('높음 1 · 중간 3 · 낮음 1')
    expect(cardText('delay', 'big')).toBe('19')
    expect(cardText('delay', 'sub')).toBe('오래 막힘 2 · 오래 걸림 7')

    /* 막대 — 많은 것부터, 종류별 마디. 흔들림은 머리를 따로 */
    const bars = [
      ...document.body.querySelectorAll<HTMLElement>('[data-bar-group="main"] [data-bar]'),
    ]
    expect(bars[0]!.dataset.bar).toBe('overdue')
    expect(bars[0]!.querySelector('[data-bar-total]')!.textContent!.trim()).toBe('19')
    expect(bars[0]!.getAttribute('title')).toBe('작업 17 · 안건 1 · 테스트 1')
    const churn = [
      ...document.body.querySelectorAll<HTMLElement>('[data-bar-group="churn"] [data-bar]'),
    ]
    expect(churn.map((b) => b.dataset.bar)).toEqual([
      'dueSlipped',
      'flaky',
      'contentChurn',
      'ownerChurn',
    ])
    expect(w.find('[data-bar-group="churn"]').text()).toContain('흔들림')

    /* 목록 — 세 종류를 점수 순으로, 30줄 */
    expect(listRows()).toHaveLength(30)
    expect(rowKeys().slice(0, 8)).toEqual([
      'test:tc3',
      'task:k3',
      'task:k20',
      'task:k4',
      'task:k21',
      'task:k9',
      'task:k1',
      'task:k7',
    ])
    const first = listRows()[2]!
    expect(first.querySelector('[data-risk-kind]')!.textContent).toBe('작업')
    expect(first.textContent).toContain('HW-20')
    expect(first.textContent).toContain('기한 넘김')
    expect(first.textContent).toContain('오래 걸림')
    expect(first.textContent).toContain('high')
    expect(first.querySelector('[data-risk-metric]')!.textContent!.trim()).toBe('기한 넘김 33일')
    expect(first.querySelector('[data-risk-owner]')!.textContent).toContain('이도현')
    expect(first.querySelector('[data-risk-owner] [data-avatar]')).toBeTruthy()
    /* 테스트의 기한 넘김은 '기간 지남' — 종류마다 화면 말 */
    expect(listRows()[0]!.textContent).toContain('기간 지남')

    /* 안건 줄은 핵심 숫자 옆에 '연관 작업' 수 */
    const data = useDataStore()
    const live = new Set(data.allTasks.map((t) => t.id))
    const agendaRows = listRows().filter((r) => r.dataset.riskRow === 'agenda')
    expect(agendaRows).toHaveLength(6)
    for (const row of agendaRows) {
      const linked = data.taskAgendas.filter(
        (l) => l.agendaId === row.dataset.riskId && live.has(l.taskId),
      )
      expect(row.querySelector('[data-risk-linked]')!.textContent!.trim()).toBe(
        `연관 작업 ${linked.length}`,
      )
    }
    expect(
      listRows()
        .find((r) => r.dataset.riskRow === 'task')!
        .querySelector('[data-risk-linked]'),
    ).toBeNull()

    /* '사람별' 칸은 2026-11-06 걷었다 */
    expect(w.find('section[aria-label="사람별"]').exists()).toBe(false)
    expect(w.find('[data-risk-settings]').attributes('title')).toBe(
      '기한 임박 3일 · 멈춤 7일 · high 6점 · medium 3점 · 흔들림 14일 안 내용 5번 · 미룸 2번',
    )
  })

  it('일반 사용자(u3)는 내 파트로 열린다 — 세 종류에 같이. 전체로 바꾸면 다 선다', async () => {
    await signedIn('u3@inno-ax.com')
    await mountRisks()

    expect(pickLabel()).toBe('인프라')
    expect(listRows()).toHaveLength(2 + 8 + 5)
    expect(cardText('agenda', 'sub')).toBe('높음 0 · 중간 1 · 낮음 1')

    await click(scopeButton('all'))
    expect(listRows()).toHaveLength(30)
  })

  it('카드를 누르면 그 종류로 · 다시 누르면 푼다. 지연은 세 신호로', async () => {
    await signedIn('u1@inno-ax.com')
    usePartStore().setScope('all')
    await mountRisks()

    await click($card('test'))
    expect($card('test')!.getAttribute('aria-pressed')).toBe('true')
    expect(rowKeys()).toEqual(['test:tc3', 'test:tc4', 'test:tc6', 'test:tc7', 'test:tc2'])
    await click($card('test'))
    expect(listRows()).toHaveLength(30)

    await click($card('delay'))
    expect(
      [...document.body.querySelectorAll<HTMLElement>('[data-signal-filter]')].map(
        (c) => c.dataset.signalFilter,
      ),
    ).toEqual(['overdue', 'longBlocked', 'longRunning'])
    expect(listRows()).toHaveLength(21)
    /* 걸린 신호 칩을 누르면 그 신호만 풀린다 */
    await click(document.body.querySelector('[data-signal-filter="overdue"]'))
    expect(listRows()).toHaveLength(9)
    await click(document.body.querySelector('[data-filter-clear]'))
    expect(listRows()).toHaveLength(30)
  })

  it('막대를 누르면 그 신호로, 등급은 여럿 · 종류 고르기는 목록 위에서', async () => {
    await signedIn('u1@inno-ax.com')
    usePartStore().setScope('all')
    await mountRisks()

    await click(document.body.querySelector('[data-bar="flaky"]'))
    expect(rowKeys()).toEqual(['test:tc2'])
    await click(document.body.querySelector('[data-bar="flaky"]'))
    expect(listRows()).toHaveLength(30)

    await click(document.body.querySelector('[data-level-filter="high"]'))
    expect(listRows()).toHaveLength(8)
    await click(document.body.querySelector('[data-level-filter="low"]'))
    expect(listRows()).toHaveLength(8 + 4)
    await click(document.body.querySelector('[data-kind-filter="agenda"]'))
    expect(rowKeys()).toEqual(['agenda:t4', 'agenda:t7'])
    expect(document.body.querySelector('[data-kind-filter="agenda"]')!.textContent).toContain('2')
    await click(document.body.querySelector('[data-kind-filter="all"]'))
    expect(listRows()).toHaveLength(12)
    expect(document.body.querySelector('[data-risk-count]')!.textContent!.trim()).toBe('12건')
  })

  it('30줄이 넘으면 [더 보기]', async () => {
    const p1 = riskReports.p1!
    const saved = p1.tasks
    p1.tasks = [
      ...saved,
      ...Array.from({ length: 5 }, (_, i) => ({
        ...saved.at(-1)!,
        taskId: `kx${i}`,
        key: `HW-X${i}`,
      })),
    ]
    try {
      await signedIn('u1@inno-ax.com')
      usePartStore().setScope('all')
      await mountRisks()
      expect(listRows()).toHaveLength(30)
      expect(document.body.querySelector('[data-risk-more]')!.textContent).toContain('5')
      await click(document.body.querySelector('[data-risk-more]'))
      expect(listRows()).toHaveLength(35)
      expect(document.body.querySelector('[data-risk-more]')).toBeNull()
    } finally {
      p1.tasks = saved
    }
  })

  it('[새로 고침] 은 다시 받는다', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()
    const risk = useRiskStore()
    const load = vi.spyOn(risk, 'load')

    await click(button('새로 고침'))
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('줄을 누르면 상세', () => {
  const dialog = () => document.body.querySelector('[role="dialog"]')
  const row = (key: string) => document.body.querySelector(`[data-risk-id="${key}"]`)

  it('안건 줄은 안건 상세', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()
    await click(row('t3'))
    expect(dialog()?.textContent).toContain('사내망에서 외부 모델 호출 허용 범위')
  })

  it('작업 줄은 작업 상세', async () => {
    await signedIn('u1@inno-ax.com')
    usePartStore().setScope('all')
    await mountRisks()
    await click(row('k20'))
    expect(dialog()?.textContent).toContain('DB 설치와 초기 스키마 반영')
  })

  it('테스트 줄은 테스트 상세', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()
    await click(row('tc3'))
    expect(dialog()?.textContent).toContain('비밀번호 5회 틀림 잠금')
  })
})

describe('기준 바꾸기', () => {
  it('일반 사용자에게는 안 보인다', async () => {
    await signedIn('u3@inno-ax.com')
    await mountRisks()
    expect(button('새로 고침')).toBeTruthy()
    expect(button('기준 바꾸기')).toBeUndefined()
  })

  it('시스템 관리자에게는 보인다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    await mountRisks()
    expect(button('기준 바꾸기')).toBeTruthy()
  })

  it('저장하면 기준 한 줄이 새 값으로 바뀐다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountRisks()

    await click(button('기준 바꾸기'))
    expect(field('staleDays')!.value).toBe('7')
    await type('staleDays', '14')
    await click(button('저장'))

    expect(w.find('[data-risk-settings]').attributes('title')).toContain('멈춤 14일')
  })

  it('흔들림 셋 — 묶음으로 보이고, 일곱 값을 통째로 보낸다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountRisks()
    const put = vi.spyOn(api, 'putRiskSettings')

    await click(button('기준 바꾸기'))
    expect(document.body.querySelector('[data-setting-group="흔들림"]')).toBeTruthy()
    expect(field('churnDays')!.value).toBe('14')
    expect(field('churnCount')!.value).toBe('5')
    expect(field('slipCount')!.value).toBe('2')

    await type('slipCount', '11')
    expect(problem('slipCount')?.textContent).toContain('1 ~ 10')
    await type('slipCount', '3')
    await type('churnDays', '30')
    await click(button('저장'))

    expect(put.mock.calls[0][1]).toEqual({
      dueSoonDays: 3,
      staleDays: 7,
      highScore: 6,
      mediumScore: 3,
      churnDays: 30,
      churnCount: 5,
      slipCount: 3,
    })
    expect(w.find('[data-risk-settings]').attributes('title')).toContain(
      '흔들림 30일 안 내용 5번 · 미룸 3번',
    )
    put.mockRestore()
  })

  it('화면이 먼저 막는다 — high <= medium 이면 high 칸에 까닭, 저장이 꺼진다', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()

    await click(button('기준 바꾸기'))
    await type('highScore', '3')
    expect(problem('highScore')?.textContent).toContain('medium 점수보다 커야 합니다.')
    expect(button('저장')!.disabled).toBe(true)

    await type('dueSoonDays', '31')
    expect(problem('dueSoonDays')?.textContent).toContain('1 ~ 30')
  })

  it('서버 422 의 detail 을 그 칸에 붙이고, 그 칸을 고치면 뗀다', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()
    const risk = useRiskStore()
    risk.saveSettings = vi
      .fn()
      .mockResolvedValue({ ok: false, detail: { staleDays: '서버가 받지 않은 값입니다.' } })

    await click(button('기준 바꾸기'))
    await click(button('저장'))
    expect(problem('staleDays')?.textContent).toContain('서버가 받지 않은 값입니다.')
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()

    await type('staleDays', '8')
    expect(problem('staleDays')).toBeNull()
  })
})

describe('AI 리스크 분석', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const card = () => document.body.querySelector('[data-risk-summary]')
  const line = () => document.body.querySelector('[data-summary-line]')?.textContent?.trim()
  const ANSWER =
    '한 줄 총평 — [[agenda:t9]] 가 병목입니다.\n- [[task:k3]] 기한 확인 [[agenda:nope]]'

  function answerWith(text = ANSWER) {
    return vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* () {
      yield { type: 'delta', text }
      yield { type: 'done', refs: [] }
    })
  }

  it('누를 때만 부른다 — 보이는 세 종류의 id 를 보내고, 끝나면 기준일 · 건수와 [다시 분석]', async () => {
    await signedIn('u3@inno-ax.com')
    const spy = answerWith()
    await mountRisks()

    expect(spy).not.toHaveBeenCalled()
    expect(line()).toBe('보이는 작업 8 · 안건 2 · 테스트 5건을 분석합니다')

    await click(button('AI 리스크 분석'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toEqual({
      agendaIds: ['t9', 't4'],
      taskIds: ['k3', 'k20', 'k4', 'k21', 'k1', 'k5', 'k17', 'k22'],
      testIds: ['tc3', 'tc4', 'tc6', 'tc7', 'tc2'],
    })
    expect(line()).toBe('2026-10-15 기준 · 작업 8 · 안건 2 · 테스트 5건')
    expect(button('다시 분석')).toBeTruthy()
    expect(card()?.textContent).toContain('가 병목입니다.')
  })

  it('근거는 챗봇 칩으로 — 스냅샷에 없는 id 는 안 그리고, 누르면 상세가 뜬다', async () => {
    await signedIn('u3@inno-ax.com')
    answerWith()
    await mountRisks()
    await click(button('AI 리스크 분석'))

    const agendaChip = card()?.querySelector('[data-ref-agenda="t9"]')
    expect(agendaChip?.textContent).toContain('공통 코드 체계 확정')
    expect(card()?.querySelector('[data-ref-task="k3"]')?.textContent).toContain('HW-3')
    expect(card()?.querySelectorAll('[data-ref-agenda]')).toHaveLength(1)
    expect(card()?.textContent).not.toContain('nope')
    expect(card()?.innerHTML).not.toContain('[[')

    await click(agendaChip)
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      '공통 코드 체계 확정',
    )
  })

  it('작업 칩을 누르면 작업 상세', async () => {
    await signedIn('u3@inno-ax.com')
    answerWith()
    await mountRisks()
    await click(button('AI 리스크 분석'))

    await click(card()?.querySelector('[data-ref-task="k3"]'))
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('프로그램 설계')
  })

  it('[내 파트 | 전체] 를 바꾸면 흐리게 하고 다시 분석을 권한다 — 저절로 부르지 않는다', async () => {
    await signedIn('u3@inno-ax.com')
    const spy = answerWith()
    await mountRisks()
    await click(button('AI 리스크 분석'))

    await click(scopeButton('all'))
    expect(card()?.querySelector('[data-summary-changed]')).toBeTruthy()
    expect(line()).toBe('목록이 바뀌었습니다 —')
    expect(spy).toHaveBeenCalledTimes(1)

    await click(button('다시 분석'))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][1]).toMatchObject({
      agendaIds: ['t5', 't3', 't8', 't9', 't4', 't7'],
      testIds: ['tc3', 'tc4', 'tc6', 'tc7', 'tc2'],
    })
    expect(spy.mock.calls[1][1].taskIds).toHaveLength(19)
    expect(card()?.querySelector('[data-summary-changed]')).toBeNull()
  })

  it('목록을 거르면 보이는 줄만 보낸다 — 거르기를 바꾸면 흐리게', async () => {
    await signedIn('u1@inno-ax.com')
    const spy = answerWith()
    await mountRisks()

    await click(document.body.querySelector('[data-bar="flaky"]'))
    expect(line()).toBe('보이는 작업 0 · 안건 0 · 테스트 1건을 분석합니다')
    await click(button('AI 리스크 분석'))
    expect(spy.mock.calls[0][1]).toEqual({ agendaIds: [], taskIds: [], testIds: ['tc2'] })

    await click($card('task'))
    expect(card()?.querySelector('[data-summary-changed]')).toBeTruthy()
  })

  it('테스트 칩을 누르면 테스트 상세', async () => {
    await signedIn('u1@inno-ax.com')
    answerWith('먼저 손쓸 것\n1. [[test:tc3]] — 기간 지남')
    await mountRisks()
    await click(button('AI 리스크 분석'))

    const chip = card()?.querySelector('[data-ref-test="tc3"]')
    expect(chip?.textContent).toContain('HW-T3')
    await click(chip)
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      '비밀번호 5회 틀림 잠금',
    )
  })

  it('받는 중엔 [멈춤] — 누르면 받은 데까지 남기고 멈춘다', async () => {
    await signedIn('u1@inno-ax.com')
    vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* (_p, _i, signal) {
      yield { type: 'delta', text: '한 줄 총평' }
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
      )
    })
    await mountRisks()

    await click(button('AI 리스크 분석'))
    expect(button('AI 리스크 분석')).toBeUndefined()
    await click(button('멈춤'))

    expect(card()?.textContent).toContain('한 줄 총평')
    expect(card()?.textContent).toContain('멈췄습니다.')
    expect(button('다시 분석')!.disabled).toBe(false)
  })

  it('보이는 줄이 0건이면 버튼이 꺼진다', async () => {
    await signedIn('u1@inno-ax.com')
    useDataStore().setProject('p3')
    await mountRisks()

    expect(button('AI 리스크 분석')!.disabled).toBe(true)
    expect(line()).toBe('보이는 리스크가 없어 분석할 것이 없습니다.')
  })

  it('오류는 챗봇과 같은 문구로', async () => {
    await signedIn('u1@inno-ax.com')
    vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* () {
      yield* []
      throw new ApiError(429, { code: 'CHAT_RATE_LIMITED', message: '' })
    })
    await mountRisks()

    await click(button('AI 리스크 분석'))
    expect(card()?.querySelector('[data-summary-error]')?.textContent?.trim()).toBe(
      '질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요.',
    )
  })

  it('화면을 떠나면 버린다', async () => {
    await signedIn('u1@inno-ax.com')
    answerWith()
    const w = await mountRisks()
    await click(button('AI 리스크 분석'))
    expect(useRiskStore().summary).not.toBeNull()

    w.unmount()
    expect(useRiskStore().summary).toBeNull()
  })
})

describe('저장한 분석', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
  const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
  const tabButton = (key: 'now' | 'saved') => $(`[role="tablist"] [data-tab="${key}"]`)
  const titleInput = () => $('[data-analysis-title-input]') as HTMLInputElement | null

  /** 서버처럼 끝까지 받은 분석을 임시로 남기고 done 에 그 id 를 싣는다 */
  function answerWithDraft() {
    return vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* () {
      const text = '한 줄 총평 — [[agenda:t9]] 가 병목입니다.'
      yield { type: 'delta', text }
      const analysisId = mockCreateRiskDraft({
        projectId: 'p1',
        me: useAuthStore().me!,
        asOf: '2026-10-15',
        settings: { ...DEFAULT_RISK_SETTINGS },
        agendas: useRiskStore().agendas,
        tasks: useRiskStore().tasks,
        tests: useRiskStore().tests,
        body: text,
        refs: [{ kind: 'agenda', id: 't9' }],
      })
      yield { type: 'done', refs: [{ kind: 'agenda', id: 't9' }], analysisId }
    })
  }

  it('탭은 [지금 리스크 | 저장한 분석 N] — 누르면 ?tab=saved, 뒤로 가면 돌아온다', async () => {
    await signedIn('u3@inno-ax.com')
    await mountRisks()

    expect(tabButton('now')!.getAttribute('aria-selected')).toBe('true')
    expect(tabButton('saved')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('저장한 분석 2')
    expect(listRows().length).toBeGreaterThan(0)

    await click(tabButton('saved'))
    expect(router.currentRoute.value.query.tab).toBe('saved')
    expect(listRows()).toHaveLength(0)
    expect($$('[data-analysis-row]')).toHaveLength(2)
    /* 지금 리스크 탭의 도구(새로 고침 · 내 파트)는 게시판에서 안 보인다 */
    expect(button('새로 고침')).toBeUndefined()

    router.back()
    await new Promise((r) => setTimeout(r, 10))
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(listRows().length).toBeGreaterThan(0)
  })

  it('게시판 — 최신이 위, 번호 · 제목 · 작성자(동그라미 + 이름) · 높음 n / 전체 m(세 종류 합), 누르면 상세', async () => {
    await signedIn('u3@inno-ax.com')
    await mountRisks('/risks?tab=saved')

    const [top, second] = $$('[data-analysis-row]')
    expect(top!.textContent).toContain('10월 셋째 주 리스크')
    expect(top!.querySelector('[data-analysis-author]')!.textContent).toContain('이도현')
    expect(top!.querySelector('[data-analysis-author] [data-avatar]')).toBeTruthy()
    expect(
      top!.querySelector('[data-analysis-counts]')!.textContent!.replace(/\s+/g, ' ').trim(),
    ).toBe('높음 3 / 전체 11')
    expect(top!.querySelector('[data-analysis-counts]')!.getAttribute('title')).toBe(
      '작업 4 · 안건 4 · 테스트 3건',
    )
    expect(second!.querySelector('[data-analysis-counts]')!.textContent).toContain('높음 1')
    expect(second!.firstElementChild!.textContent!.trim()).toBe('1')

    await click(top)
    expect(router.currentRoute.value.path).toBe('/risks/analyses/ra2')
  })

  it('비면 안내 한 줄', async () => {
    await signedIn('u3@inno-ax.com')
    useDataStore().setProject('p2')
    await mountRisks('/risks?tab=saved')
    expect($('[data-analysis-empty]')!.textContent!.trim()).toBe(
      '저장한 분석이 없습니다 — 지금 리스크 탭에서 분석하고 [저장] 하세요',
    )
    expect(tabButton('saved')!.textContent).toContain('0')
  })

  it('50개씩 — [더 보기] 로 잇고, 다 받으면 버튼이 없다', async () => {
    await signedIn('u3@inno-ax.com')
    const db = mockDb()
    const base = db.riskAnalyses[0]!
    for (let i = 3; i <= 53; i++)
      db.riskAnalyses.push({ ...structuredClone(base), id: `rx${i}`, seq: i, title: `분석 ${i}` })
    db.riskAnalysisNo.p1 = 53
    await mountRisks('/risks?tab=saved')

    expect($$('[data-analysis-row]')).toHaveLength(50)
    expect($$('[data-analysis-row]')[0]!.textContent).toContain('분석 53')
    await click($('[data-analysis-more]'))
    expect($$('[data-analysis-row]')).toHaveLength(53)
    expect($('[data-analysis-more]')).toBeNull()
  })

  it('analysisId 가 없으면 [저장] 이 없다 — Claude 를 안 부른 답', async () => {
    await signedIn('u3@inno-ax.com')
    vi.spyOn(api, 'streamRiskSummary').mockImplementation(async function* () {
      yield { type: 'delta', text: '지금 짚을 리스크가 없습니다.' }
      yield { type: 'done', refs: [] }
    })
    await mountRisks()
    await click(button('AI 리스크 분석'))
    expect(button('다시 분석')).toBeTruthy()
    expect($('[data-summary-save]')).toBeNull()
  })

  it("[저장] → 기본 제목 창 → 저장하면 '저장됨 · 보기' 로 바뀌고 탭 수가 는다", async () => {
    await signedIn('u3@inno-ax.com')
    answerWithDraft()
    await mountRisks()
    await click(button('AI 리스크 분석'))

    await click($('[data-summary-save]'))
    expect(titleInput()!.value).toBe(`리스크 분석 ${kstToday()}`)
    titleInput()!.value = '  내 분석  '
    titleInput()!.dispatchEvent(new Event('input'))
    await flushPromises()
    await click($('[data-analysis-title-submit]'))

    expect($('[data-analysis-title-dialog]')).toBeNull()
    expect($('[data-summary-save]')).toBeNull()
    const saved = useRiskStore().summary!.savedId!
    expect($('[data-summary-saved]')!.textContent).toContain('저장됨')
    expect($('[data-summary-saved-link]')!.getAttribute('href')).toBe(`/risks/analyses/${saved}`)
    expect(tabButton('saved')!.textContent).toContain('3')

    await click(tabButton('saved'))
    expect($$('[data-analysis-row]')[0]!.textContent).toContain('내 분석')
  })

  it('목록이 바뀌어 흐려져도 저장할 수 있다', async () => {
    await signedIn('u3@inno-ax.com')
    answerWithDraft()
    await mountRisks()
    await click(button('AI 리스크 분석'))
    await click(scopeButton('all'))
    expect(document.body.querySelector('[data-summary-changed]')).toBeTruthy()
    expect($('[data-summary-save]')).toBeTruthy()
  })

  it("404(24시간 지남) 면 창 안에 '오래된 분석' 문구 — 창은 닫히지 않는다", async () => {
    await signedIn('u3@inno-ax.com')
    answerWithDraft()
    await mountRisks()
    await click(button('AI 리스크 분석'))
    for (const row of mockDb().riskAnalyses)
      if (row.savedAt === null) row.createdAt = '2026-01-01T00:00:00Z'

    await click($('[data-summary-save]'))
    await click($('[data-analysis-title-submit]'))
    expect($('[data-analysis-title-problem]')!.textContent!.trim()).toBe(
      '오래된 분석이라 저장할 수 없습니다. 다시 분석해 주세요.',
    )
    expect($('[data-analysis-title-dialog]')).toBeTruthy()
    expect($('[data-summary-saved]')).toBeNull()
  })
})

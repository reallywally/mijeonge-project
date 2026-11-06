// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import * as api from '@/api'
import { ApiError } from '@/api'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useRiskStore } from '@/stores/risk'
import RiskView from './RiskView.vue'

/* 리스크 화면 — 표 셋 · [내 파트 | 전체] · 관리자만 [기준 바꾸기] · 422 를 칸에 붙이기 · 줄을 누르면 상세 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountRisks() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/risks', component: RiskView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push('/risks')
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

const rows = (kind: 'agenda' | 'owner') => document.body.querySelectorAll(`[data-risk-${kind}]`)
const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const scopeButton = (key: 'mine' | 'all') =>
  document.body.querySelector<HTMLButtonElement>(`[aria-label="보기 범위"] [data-scope="${key}"]`)
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

describe('표 둘', () => {
  it('프로젝트 관리자(u1)는 전체로 열린다 — 안건 6 · 사람 5, 기준 한 줄과 신호 말', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountRisks()

    expect(rows('agenda')).toHaveLength(6)
    /* '사람별' 칸은 2026-11-06 화면에서 걷었다(서버의 owners 는 챗봇 · AI 리스크 분석이 그대로 쓴다) */
    expect(w.find('section[aria-label="사람별"]').exists()).toBe(false)
    expect(rows('owner')).toHaveLength(0)
    /* '안건과 어긋난 작업' 칸은 2026-11-05 걷었다 */
    expect(w.text()).not.toContain('안건과 어긋난 작업')
    expect(document.body.querySelector('[data-risk-task]')).toBeNull()
    /* 본문의 '기준' 칸은 2026-11-06 걷었다 — 기준값은 위 줄의 'N/N 기준' 을 가리키면 보인다 */
    expect(w.find('[data-risk-settings]').attributes('title')).toBe(
      '기한 임박 3일 · 멈춤 7일 · high 6점 · medium 3점',
    )

    const first = rows('agenda')[0]!.textContent ?? ''
    expect(first).toContain('보험료 산출 기간계 API 호출 in · out 정의')
    expect(first).not.toContain('여러 번 미룸')
    expect(first).toContain('작업을 막는 중')
    expect(first).toContain('medium')
    expect(rows('agenda')[1]!.textContent).toContain('15일')
  })

  it('일반 사용자(u3)는 내 파트로 열린다. 전체로 바꾸면 다 선다', async () => {
    await signedIn('u3@inno-ax.com')
    await mountRisks()

    expect(scopeButton('mine')!.getAttribute('aria-pressed')).toBe('true')
    expect(rows('agenda')).toHaveLength(2)

    await click(scopeButton('all'))
    expect(rows('agenda')).toHaveLength(6)
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

  it('안건 줄은 안건 상세', async () => {
    await signedIn('u1@inno-ax.com')
    await mountRisks()

    await click(rows('agenda')[1])
    expect(dialog()?.textContent).toContain('사내망에서 외부 모델 호출 허용 범위')
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

  it('누를 때만 부른다 — 보이는 줄 그대로 보내고, 끝나면 기준일 · 건수와 [다시 분석]', async () => {
    await signedIn('u3@inno-ax.com')
    const spy = answerWith()
    await mountRisks()

    expect(spy).not.toHaveBeenCalled()
    expect(line()).toBe('보이는 안건 2건을 정리합니다')

    await click(button('AI 리스크 분석'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toEqual({ agendaIds: ['t9', 't4'] })
    expect(line()).toBe('2026-10-15 기준 · 보이는 2건')
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
    expect(spy.mock.calls[1][1]).toEqual({
      agendaIds: ['t5', 't3', 't8', 't9', 't4', 't7'],
    })
    expect(card()?.querySelector('[data-summary-changed]')).toBeNull()
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
    expect(line()).toBe('보이는 리스크가 없어 정리할 것이 없습니다.')
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

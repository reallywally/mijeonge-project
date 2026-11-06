// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import RiskAnalysisView from './RiskAnalysisView.vue'

/* 저장한 분석 상세 — 머리 · 글(근거 칩) · 지난 분석 대비 · 그때의 리스크 · 권한대로 [제목 고치기] [지우기] */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/risks/analyses/:analysisId', component: RiskAnalysisView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  mount({ template: '<RouterView />' }, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return router
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function signedIn(who: string) {
  await useAuthStore().login(`${who}@inno-ax.com`, MOCK_PASSWORD)
  await useDataStore().retry()
}

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
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

describe('그리기', () => {
  it('다른 프로젝트에서 주소로 들어오면 분석의 프로젝트로 옮긴다', async () => {
    await signedIn('u3')
    const data = useDataStore()
    const other = data.allProjects.find((p) => p.id !== 'p1')
    expect(other, '두 번째 프로젝트가 있어야 한다').toBeTruthy()
    data.setProject(other!.id)
    const router = await mountAt('/risks/analyses/ra2')
    expect(data.currentProjectId).toBe('p1')
    expect(router.currentRoute.value.path).toBe('/risks/analyses/ra2')
    expect(text('[data-analysis-heading]')).toBe('10월 셋째 주 리스크')
  })

  it('머리 — 제목 · 작성자 · 저장일 · 분석 기준', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    expect(text('[data-analysis-heading]')).toBe('10월 셋째 주 리스크')
    expect(text('[data-analysis-meta]')).toContain('이도현')
    expect($('[data-analysis-meta] [data-avatar]')).toBeTruthy()
    expect(text('[data-analysis-as-of]')).toBe('분석 기준 10월 15일')
    expect($('[data-analysis-back]')!.getAttribute('href')).toBe('/risks?tab=saved')
  })

  it('글의 근거는 칩 — 누르면 안건 상세', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    const body = $('[data-analysis-body]')!
    expect(body.innerHTML).not.toContain('[[')
    const chip = body.querySelector('[data-ref-agenda="t5"]')
    expect(chip?.textContent).toContain('보험료 산출')
    expect(body.querySelector('[data-ref-task="k18"]')).toBeTruthy()
    await click(chip)
    expect($('[role="dialog"]')?.textContent).toContain('보험료 산출')
  })

  it('그때의 리스크 — 세 종류를 섞어 점수 순, 종류 배지 · 신호는 종류별 화면 말', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    expect(text('[data-analysis-snapshot-as-of]')).toBe(
      '10월 15일 기준 · 안건 4 · 작업 4 · 테스트 3건',
    )
    const rows = $$('[data-analysis-row]')
    expect(rows.map((r) => r.dataset.analysisRow)).toEqual([
      'test:tc3',
      'task:k20',
      'task:k4',
      'agenda:t5',
      'agenda:t3',
      'agenda:t8',
      'agenda:t9',
      'task:k18',
      'test:tc4',
      'test:tc2',
      'task:k22',
    ])
    expect(rows[0]!.querySelector('[data-risk-kind]')!.textContent).toBe('테스트')
    expect(rows[0]!.textContent).toContain('HW-T3')
    expect(rows[0]!.textContent).toContain('기간 지남')
    expect(rows[1]!.textContent).toContain('HW-20')
    expect(rows[1]!.textContent).toContain('기한 넘김')
    expect(rows[4]!.textContent).toContain('기한 지남')
    expect(rows[4]!.textContent).toContain('medium')
    expect(rows[6]!.textContent).toContain('박지훈')
    expect(rows[9]!.textContent).toContain('결과 뒤집힘')
  })

  it('표의 테스트 줄을 누르면 테스트 상세', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    await click($('[data-analysis-row="test:tc3"]'))
    expect($('[role="dialog"]')?.textContent).toContain('비밀번호 5회 틀림 잠금')
  })

  it('지난 분석 대비 — 앞 분석 링크 · 새로 생김 · 풀림 · 등급 바뀜, 종류를 달아', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    expect($('[data-analysis-previous]')!.getAttribute('href')).toBe('/risks/analyses/ra1')
    expect(text('[data-compare-count="added"]')).toBe('새로 생김 9')
    expect(text('[data-compare-count="removed"]')).toBe('풀림 1')
    expect(text('[data-compare-count="changed"]')).toBe('등급 바뀜 1')
    expect(text('[data-analysis-compare]')).toContain('high → medium')
    expect(text('[data-analysis-compare]')).toContain('일정 조율')
    expect(text('[data-compare-ref="task:k20"]')).toBe('작업HW-20 DB 설치와 초기 스키마 반영')
    expect(text('[data-compare-ref="test:tc2"]')).toBe('테스트HW-T2 올바른 계정으로 로그인')
    expect(text('[data-compare-ref="agenda:t6"]')).toContain('안건')
  })

  it('옛 모양(문자열 · agendaId)의 대비도 읽는다', async () => {
    await signedIn('u3')
    const row = mockDb().riskAnalyses.find((r) => r.id === 'ra2')!
    row.facts.compare = {
      previousId: 'ra1',
      previousTitle: '리스크 분석 2026-10-08',
      previousSavedAt: '2026-10-08T01:12:00Z',
      added: ['t8'],
      removed: ['t6'],
      kept: [{ agendaId: 't3', levelFrom: 'high', levelTo: 'medium' }],
    }
    await mountAt('/risks/analyses/ra2')
    expect(text('[data-compare-count="added"]')).toBe('새로 생김 1')
    expect(text('[data-compare-ref="agenda:t8"]')).toBe('안건AI 심사 학습 데이터 범위')
    expect(text('[data-compare-ref="agenda:t3"]')).toContain('high → medium')
  })

  it('옛 분석(작업 · 테스트 전)은 안건 줄만', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra1')
    expect(text('[data-analysis-snapshot-as-of]')).toBe(
      '10월 8일 기준 · 안건 3 · 작업 0 · 테스트 0건',
    )
    expect($$('[data-analysis-row]').map((r) => r.dataset.analysisRow)).toEqual([
      'agenda:t3',
      'agenda:t5',
      'agenda:t6',
    ])
  })

  it('앞 분석이 없으면 대비 칸이 없다', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra1')
    expect(text('[data-analysis-heading]')).toBe('리스크 분석 2026-10-08')
    expect($('[data-analysis-compare]')).toBeNull()
  })

  it('없는 분석은 찾을 수 없다고 한다', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/zz')
    expect(text('[data-analysis-load-error]')).toBe(
      '분석을 찾을 수 없습니다. 지워졌거나 볼 수 없는 분석입니다.',
    )
  })
})

describe('권한', () => {
  it('작성자는 [제목 고치기] · [지우기] 둘 다', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    expect($('[data-analysis-rename]')).toBeTruthy()
    expect($('[data-analysis-remove]')).toBeTruthy()
  })

  it('프로젝트 관리자는 남의 것을 지울 수만 있다', async () => {
    await signedIn('u1')
    await mountAt('/risks/analyses/ra2')
    expect($('[data-analysis-rename]')).toBeNull()
    expect($('[data-analysis-remove]')).toBeTruthy()
  })

  it('일반 사용자는 남의 것에 아무 버튼도 없다', async () => {
    await signedIn('u2')
    await mountAt('/risks/analyses/ra2')
    expect($('[data-analysis-rename]')).toBeNull()
    expect($('[data-analysis-remove]')).toBeNull()
  })

  it('제목을 고치면 머리가 바뀐다', async () => {
    await signedIn('u3')
    await mountAt('/risks/analyses/ra2')
    await click($('[data-analysis-rename]'))
    const input = $('[data-analysis-title-input]') as HTMLInputElement
    expect(input.value).toBe('10월 셋째 주 리스크')
    input.value = '고친 제목'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    await click($('[data-analysis-title-submit]'))
    expect(text('[data-analysis-heading]')).toBe('고친 제목')
    expect($('[data-analysis-title-dialog]')).toBeNull()
  })

  it('지우면 게시판으로 간다', async () => {
    await signedIn('u1')
    const router = await mountAt('/risks/analyses/ra2')
    await click($('[data-analysis-remove]'))
    await click($('[data-analysis-remove-confirm]'))
    expect(router.currentRoute.value.fullPath).toBe('/risks?tab=saved')
  })
})

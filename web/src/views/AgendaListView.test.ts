// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useAgendaStore } from '@/stores/agenda'
import AgendaStateSelect from '@/components/app/AgendaStateSelect.vue'
import AgendaListView from './AgendaListView.vue'

/* 안건 상세 · 추가가 화면에서 실제로 저장까지 닿는지 본다. 팝업은 teleport 로 body 에 나간다. */
async function mountView(path = '/agendas') {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/agendas', name: 'agendas', component: AgendaListView },
      { path: '/agendas/new', name: 'agenda-new', component: AgendaListView },
      { path: '/agendas/:id', name: 'agenda', component: AgendaListView },
      { path: '/:rest(.*)', component: AgendaListView },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(AgendaListView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

const popupText = () => document.body.textContent ?? ''
const popupButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

async function click(el: Element | undefined) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function type(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function blur(selector: string) {
  document.body.querySelector<HTMLElement>(selector)!.dispatchEvent(new FocusEvent('blur'))
  await flushPromises()
}

enableAutoUnmount(afterEach)

/* 고치기는 작성자 · 담당자 · 관리자만이다 — 칸이 저장까지 닿는지 보는 검사들이라 프로젝트 관리자(u1)로 들어온다 */
beforeEach(async () => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
})

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.body.querySelector<T>(selector)
const agendaOf = (id: string) => useAgendaStore().agendas.find((t) => t.id === id)!

describe('안건 목록 화면', () => {
  it('상태 배지와 결정내용 첫 줄이 서고, 마지막 기록 · 이력 · 항목 수 칸은 없다', async () => {
    const { w } = await mountView()
    expect(w.text()).not.toContain('마지막 기록')
    expect(w.text()).not.toContain('미뤄짐')
    expect(w.find('[data-item-progress]').exists()).toBe(false)
    const lines = w.findAll('[data-decision-line]').map((x) => x.text())
    expect(lines).toContain('mysql 을 쓴다')
    expect(lines).toContain('우분투 최신 버전으로 한다')
  })
})

describe('안건 상세', () => {
  it('제목 · 설명 · 결정내용을 고치고 벗어나면 바로 저장되고, 빈 제목은 되돌아간다', async () => {
    await mountView('/agendas/t3')

    await type('textarea[aria-label="제목"]', '외부 모델 호출 범위')
    await blur('textarea[aria-label="제목"]')
    expect(agendaOf('t3').title).toBe('외부 모델 호출 범위')

    await type('textarea[aria-label="제목"]', '  ')
    await blur('textarea[aria-label="제목"]')
    expect(agendaOf('t3').title).toBe('외부 모델 호출 범위')
    expect($<HTMLTextAreaElement>('textarea[aria-label="제목"]')!.value).toBe('외부 모델 호출 범위')

    await type('textarea[aria-label="설명"]', ' 보안팀 회신 대기 ')
    await blur('textarea[aria-label="설명"]')
    expect(agendaOf('t3').description).toBe('보안팀 회신 대기')

    await type(
      'textarea[aria-label="결정내용"]',
      '사내 모델만 쓴다\n- 비식별 데이터도 밖으로 안 낸다\n',
    )
    await blur('textarea[aria-label="결정내용"]')
    expect(agendaOf('t3').decision).toBe('사내 모델만 쓴다\n- 비식별 데이터도 밖으로 안 낸다')
    expect(agendaOf('t3').decisionRev).toBe(1)
    /* 상태는 따로 고른다 — 결정내용을 적어도 논의중 그대로 */
    expect(agendaOf('t3').state).toBe('open')
  })

  it('속성 패널의 상태를 결정으로 고르면 저장되고, 결정일 때만 확인 요청 칸이 선다', async () => {
    const { w } = await mountView('/agendas/t3')
    expect($('[data-check-section]')).toBeNull()

    w.findComponent(AgendaStateSelect).vm.$emit('update:modelValue', 'decided')
    await flushPromises()
    expect(agendaOf('t3')).toMatchObject({ state: 'decided', decisionRev: 1 })
    expect(agendaOf('t3').decidedAt).not.toBeNull()
    expect($('[data-check-section]')).toBeTruthy()
    expect($('[data-agenda-decided-at]')).toBeTruthy()
  })

  it('결정된 안건은 정한 날과 결정내용이 그대로 선다', async () => {
    await mountView('/agendas/t2')
    expect($<HTMLTextAreaElement>('textarea[aria-label="결정내용"]')!.value).toBe(
      'mysql 을 쓴다\n- postgresql 은 기존 솔루션과 호환성 이슈가 있어 뺀다\n- supabase 는 비용 때문에 뺀다',
    )
    expect($('[data-agenda-decided-at]')!.textContent).toBe('9월 10일')
    expect($('[data-check-section]')).toBeTruthy()
  })
})

describe('안건 권한 · 지우기', () => {
  it('작성자 · 담당자 · 관리자가 아니면 읽기 전용 — 상태 · 결정내용도 잠기고 지우기 버튼이 없다', async () => {
    /* t1 — 작성자 · 담당자 이도현(u3). 박지훈(u2)은 p1 일반 사용자 */
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    await mountView('/agendas/t1')

    expect($('[data-agenda-readonly]')!.textContent).toContain('작성자 · 담당자 · 관리자만')
    expect($('[data-agenda-creator]')!.textContent).toBe('이도현')
    for (const label of ['제목', '설명', '결정내용'])
      expect($(`textarea[aria-label="${label}"]`)!.hasAttribute('readonly')).toBe(true)
    expect($('input[aria-label="결정 기한"]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-agenda-state-select]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-agenda-delete]')).toBeNull()

    /* 칸을 지나가도 아무것도 안 바뀐다 */
    await type('textarea[aria-label="결정내용"]', '바꿔 봄')
    await blur('textarea[aria-label="결정내용"]')
    expect(agendaOf('t1').decision).toBe('우분투 최신 버전으로 한다')
  })

  it('고칠 수 있으면 작성자 칸 · 지우기 버튼이 서고, 확인하면 지우고 팝업을 닫는다', async () => {
    const { router } = await mountView('/agendas/t4')
    expect($('[data-agenda-readonly]')).toBeNull()
    /* 담당자가 없던 옛 안건은 작성자도 모른다 */
    expect($('[data-agenda-creator]')!.textContent).toBe('—')

    await click($('[data-agenda-delete]')!)
    expect(popupText()).toContain("'개발 서버 백업 주기' 안건을 지울까요?")
    /* [취소] 하면 그대로다 */
    await click(popupButton('취소'))
    expect(useAgendaStore().agendas.some((t) => t.id === 't4')).toBe(true)

    await click($('[data-agenda-delete]')!)
    await click($('[data-delete-confirm]')!)
    expect(useAgendaStore().agendas.some((t) => t.id === 't4')).toBe(false)
    expect(router.currentRoute.value.path).toBe('/agendas')
  })

  it('맨 아래 변경 이력 — 등록 · 이행 때 채운 결정내용이 서고, 펼친 채 고치면 다시 부른다', async () => {
    await mountView('/agendas/t2')
    await click($('[data-history-toggle]')!)
    expect($('[data-history-entry="hh-t2-1"]')!.textContent).toContain('등록')
    expect($('[data-history-entry="hh-t2-2"]')!.textContent).toContain('결정내용')

    await type('textarea[aria-label="결정내용"]', 'mysql 8.4 를 쓴다')
    await blur('textarea[aria-label="결정내용"]')
    await flushPromises()
    const fields = [...document.body.querySelectorAll('[data-history-field="decision"]')]
    expect(fields.some((f) => f.textContent?.includes('mysql 8.4 를 쓴다'))).toBe(true)
  })

  it('모르는 칸(지난 모델의 후보 · 참조 · 이력 줄)은 그리지 않고, 그것뿐인 줄은 통째로 뺀다', async () => {
    const { mockDb } = await import('@/api/mockAuth')
    mockDb().agendaHistory.t4.push(
      {
        id: 'old-1',
        changedAt: '2026-09-11T00:00:00Z',
        changedBy: 'u1',
        backfilled: false,
        changes: [
          { field: 'options', from: null, to: '매일', subject: '' },
          { field: 'ccIds', from: [], to: ['u2'], subject: '' },
        ],
      },
      {
        id: 'old-2',
        changedAt: '2026-09-12T00:00:00Z',
        changedBy: 'u1',
        backfilled: false,
        changes: [
          { field: 'title', from: '백업', to: '개발 서버 백업 주기', subject: '' },
          { field: 'entryText', from: 'a', to: 'b', subject: 'decide' },
        ],
      },
    )
    await mountView('/agendas/t4')
    await click($('[data-history-toggle]')!)
    expect($('[data-history-entry="old-1"]')).toBeNull()
    expect($('[data-history-entry="old-2"] [data-history-field="title"]')).toBeTruthy()
    expect($('[data-history-entry="old-2"] [data-history-field="entryText"]')).toBeNull()
  })
})

describe('안건 추가', () => {
  it('제목 · 설명 · 결정내용 · 상태 넷 — 담당자 · 기한 칸은 없고, 만들면 그 안건의 상세로 간다', async () => {
    const { w, router } = await mountView('/agendas/new')
    expect(popupText()).toContain('안건 추가')
    expect(popupButton('만들기')!.hasAttribute('disabled')).toBe(true)
    expect($('input[aria-label="결정 기한"]')).toBeNull()
    expect($('[aria-label="담당자"]')).toBeNull()

    await type('textarea[aria-label="제목"]', '배포 창구 정하기')
    await type('textarea[aria-label="설명"]', '배포 요청이 여러 군데로 온다')
    await type('textarea[aria-label="결정내용"]', '운영팀으로 모은다')
    w.findComponent(AgendaStateSelect).vm.$emit('update:modelValue', 'decided')
    await flushPromises()
    await click(popupButton('만들기'))

    const made = useAgendaStore().agendas.find((t) => t.title === '배포 창구 정하기')!
    expect(made).toMatchObject({
      description: '배포 요청이 여러 군데로 온다',
      decision: '운영팀으로 모은다',
      state: 'decided',
      decisionRev: 1,
    })
    expect(router.currentRoute.value.path).toBe(`/agendas/${made.id}`)
  })
})

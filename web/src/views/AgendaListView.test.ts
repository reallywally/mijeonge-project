// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useAgendaStore } from '@/stores/agenda'
import AgendaPropertyPanel from '@/components/app/AgendaPropertyPanel.vue'
import CcField from '@/components/app/CcField.vue'
import MemberPicker from '@/components/app/MemberPicker.vue'
import { usePartStore } from '@/stores/part'
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

describe('참조', () => {
  /* 참조 칸의 '+ 참조' — 찾아 고르는 것은 MemberPicker.test.ts 가 보고, 여기는 고른 값만 흘려 넣는다 */
  const addCc = async (w: Awaited<ReturnType<typeof mountView>>['w'], id: string) => {
    w.findComponent(CcField).findComponent(MemberPicker).vm.$emit('pick', id)
    await flushPromises()
  }
  const chips = () =>
    [...document.body.querySelectorAll<HTMLElement>('[data-cc-field] [data-cc]')].map(
      (c) => c.dataset.cc,
    )

  it('목록 줄에 참조 수(있을 때만), 나를 참조를 켜면 내가 참조인 안건만', async () => {
    usePartStore().setScope('all')
    const { w } = await mountView()
    const rowOf = (title: string) => w.findAll('tbody tr').find((r) => r.text().includes(title))!
    expect(rowOf('DB 결정').find('[data-cc-count]').text()).toBe('참조 2')
    expect(rowOf('서버 OS 결정').find('[data-cc-count]').text()).toBe('참조 1')
    expect(rowOf('사내망에서 외부 모델').find('[data-cc-count]').exists()).toBe(false)

    /* 김서연(u1)은 t1 의 참조 */
    await w.find('[data-cc-mine]').trigger('click')
    expect(w.findAll('tbody tr').map((r) => r.text())).toHaveLength(1)
    expect(w.find('tbody tr').text()).toContain('서버 OS 결정')
  })

  it('상세 — 담당자 바로 아래 참조 칩, + 참조로 더하고 × 로 빼면 바로 저장되고 이력이 남는다', async () => {
    await mountView('/agendas/t2')
    expect(chips()).toEqual(['u2', 'u4'])
    /* 고를 것은 이미 고른 사람을 뺀 활성 멤버 */
    await click($('button[aria-label="참조 더하기"]')!)
    const choices = [...document.body.querySelectorAll<HTMLElement>('[data-member-choice]')].map(
      (c) => c.dataset.memberChoice,
    )
    expect(choices).toContain('u1')
    expect(choices).not.toContain('u2')

    /* 다이얼로그 안에서도 찾는 칸에 포커스가 가고, 이름으로 찾아 Enter 로 고른다 */
    const search = $<HTMLInputElement>('[data-member-picker] input')!
    expect(document.activeElement).toBe(search)
    await type('[data-member-picker] input', '서연')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(agendaOf('t2').ccIds).toEqual(['u2', 'u4', 'u1'])
    expect(chips()).toEqual(['u2', 'u4', 'u1'])
    /* Esc 는 목록만 닫고 안건 상세는 그대로 */
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect($('[data-member-picker]')).toBeNull()
    expect($('[data-cc-field]')).not.toBeNull()

    await click($('[data-cc="u2"] [data-cc-remove]')!)
    expect(agendaOf('t2').ccIds).toEqual(['u4', 'u1'])

    const { mockDb } = await import('@/api/mockAuth')
    const fields = mockDb()
      .agendaHistory.t2.flatMap((e) => e.changes)
      .filter((c) => c.field === 'ccIds')
    expect(fields.map((c) => [c.from, c.to])).toEqual([
      [
        ['u2', 'u4'],
        ['u2', 'u4', 'u1'],
      ],
      [
        ['u2', 'u4', 'u1'],
        ['u4', 'u1'],
      ],
    ])
  })

  it('빠진 사람(비활성)은 흐린 칩으로 남고, 고칠 때도 그대로 보낸다 — × 로는 뺀다', async () => {
    /* 한예린(u5)은 비활성 */
    const { w } = await mountView('/agendas/t2')
    agendaOf('t2').ccIds = ['u5', 'u2']
    await flushPromises()
    expect($('[data-cc="u5"]')!.className).toContain('text-muted-foreground')

    await addCc(w, 'u4')
    expect(agendaOf('t2').ccIds).toEqual(['u5', 'u2', 'u4'])
    await click($('[data-cc="u5"] [data-cc-remove]')!)
    expect(agendaOf('t2').ccIds).toEqual(['u2', 'u4'])
  })

  it('읽기 전용이면 칩만 — 빼기 · 더하기가 없다', async () => {
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    await mountView('/agendas/t1')
    expect(chips()).toEqual(['u1'])
    expect($('[data-cc-remove]')).toBeNull()
    expect($('[data-cc-add]')).toBeNull()
  })

  it('등록 — 고른 참조가 실려 들어간다', async () => {
    const { w } = await mountView('/agendas/new')
    await type('textarea[aria-label="제목"]', '참조 붙인 안건')
    await addCc(w, 'u3')
    await addCc(w, 'u4')
    expect(chips()).toEqual(['u3', 'u4'])
    await click(popupButton('만들기'))
    const made = useAgendaStore().agendas.find((t) => t.title === '참조 붙인 안건')!
    expect(made.ccIds).toEqual(['u3', 'u4'])
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

  it('모르는 칸(지난 모델의 후보 · 이력 줄)은 그리지 않고, 그것뿐인 줄은 통째로 뺀다 — 옛 참조 줄은 그린다', async () => {
    const { mockDb } = await import('@/api/mockAuth')
    mockDb().agendaHistory.t4.push(
      {
        id: 'old-1',
        changedAt: '2026-09-11T00:00:00Z',
        changedBy: 'u1',
        backfilled: false,
        changes: [
          { field: 'options', from: null, to: '매일', subject: '' },
          { field: 'entryDeleted', from: 'x', to: null, subject: 'defer' },
        ],
      },
      {
        id: 'old-3',
        changedAt: '2026-09-13T00:00:00Z',
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
    expect($('[data-history-entry="old-3"] [data-history-field="ccIds"]')!.textContent).toContain(
      '박지훈',
    )
    expect($('[data-history-entry="old-3"] [data-history-field="options"]')).toBeNull()
  })
})

describe('안건 추가', () => {
  it('상세와 같은 모양 — 제목 · 설명 · 결정내용과 속성 패널(상태 · 결정 기한 · 담당자 · 파트)을 적어 만들면 그 안건의 상세로 간다', async () => {
    const { w, router } = await mountView('/agendas/new')
    expect(popupText()).toContain('안건 추가')
    expect(popupButton('만들기')!.hasAttribute('disabled')).toBe(true)
    expect($('input[aria-label="결정 기한"]')).not.toBeNull()
    expect($('[aria-label="담당자"]')).not.toBeNull()

    await type('textarea[aria-label="제목"]', '배포 창구 정하기')
    await type('textarea[aria-label="설명"]', '배포 요청이 여러 군데로 온다')
    await type('textarea[aria-label="결정내용"]', '운영팀으로 모은다')
    w.findComponent(AgendaStateSelect).vm.$emit('update:modelValue', 'decided')
    const panel = w.findComponent(AgendaPropertyPanel)
    panel.vm.$emit('update:dueDate', '2026-12-01')
    panel.vm.$emit('update:ownerId', 'u2')
    panel.vm.$emit('update:partId', 'pt1')
    await flushPromises()
    await click(popupButton('만들기'))

    const made = useAgendaStore().agendas.find((t) => t.title === '배포 창구 정하기')!
    expect(made).toMatchObject({
      description: '배포 요청이 여러 군데로 온다',
      decision: '운영팀으로 모은다',
      state: 'decided',
      decisionRev: 1,
      dueDate: '2026-12-01',
      ownerId: 'u2',
      partId: 'pt1',
    })
    expect(router.currentRoute.value.path).toBe(`/agendas/${made.id}`)
  })
})

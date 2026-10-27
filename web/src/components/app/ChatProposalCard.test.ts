// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useDataStore } from '@/stores/data'
import type { ChatProposal, ProposedTask } from '@/types/domain'
import ChatProposalCard from './ChatProposalCard.vue'

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
})

const draft = (tempId: string, over: Partial<ProposedTask> = {}): ProposedTask => ({
  tempId,
  relatedId: null,
  title: `작업 ${tempId}`,
  ownerId: null,
  start: null,
  due: null,
  priority: 'normal',
  ...over,
})

const proposal = (over: Partial<ChatProposal> = {}): ChatProposal => ({
  tasks: [
    draft('t1', { title: '간담회 준비' }),
    draft('t2', {
      title: '일정 체크',
      ownerId: 'u1',
      start: '2026-10-13',
      due: '2026-10-16',
      priority: 'high',
    }),
    draft('t3', { title: '준비물 체크', ownerId: 'u2' }),
  ],
  status: 'pending',
  ...over,
})

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/tasks/:id', component: { template: '<div />' } },
    ],
  })
}

function card(p: ChatProposal, registering = false) {
  const r = router()
  const w = mount(ChatProposalCard, {
    props: { proposal: p, registering },
    global: { plugins: [r] },
  })
  return { w, r }
}

const button = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll('button').find((b) => b.text() === label)

describe('작업 초안 카드', () => {
  it('이미 있는 작업과 관련된 초안은 그 줄에 연관 작업의 키를 밝힌다 — 들여 그리지 않는다', () => {
    const { w } = card(
      proposal({
        tasks: [
          draft('t1', { relatedId: 'k20', title: '스키마 검토' }),
          draft('t2', { title: '목록 화면' }),
        ],
      }),
    )
    const rows = w.findAll('[data-proposed-task]')
    expect(rows[0].get('[data-proposal-related]').text()).toBe('연관: HW-20')
    expect(rows[1].find('[data-proposal-related]').exists()).toBe(false)
    expect(rows.every((r) => !r.classes().some((c) => c.startsWith('pl-')))).toBe(true)
  })

  it('대기 중이면 평평하게 한 줄씩 그리고, 담당자 · 기간 · 우선순위는 있을 때만 단다', () => {
    const { w } = card(proposal())
    const rows = w.findAll('[data-proposed-task]')
    expect(rows.map((r) => r.text())).toEqual([
      '간담회 준비',
      expect.stringContaining('일정 체크'),
      expect.stringContaining('준비물 체크'),
    ])

    expect(rows[1].text()).toContain('김서연')
    expect(rows[1].text()).toContain('10/13 ~ 10/16')
    expect(rows[1].text()).toContain('우선순위 높음')
    expect(rows[2].text()).toContain('박지훈')
    expect(rows[2].text()).not.toContain('우선순위')
    expect(rows[2].text()).not.toContain('~')
  })

  it('[등록] · [취소] 를 누르면 알린다. 등록 중에는 둘 다 막는다', async () => {
    const { w } = card(proposal())
    await button(w, '등록')!.trigger('click')
    await button(w, '취소')!.trigger('click')
    expect(w.emitted('register')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)

    const busy = card(proposal(), true).w
    expect(button(busy, '등록하는 중')!.attributes('disabled')).toBeDefined()
    expect(button(busy, '취소')!.attributes('disabled')).toBeDefined()
  })

  it('등록되면 작업 칩으로 바뀌고, 누르면 그 작업 상세로 간다. 지금 레코드에 없는 key 는 그리지 않는다', async () => {
    const data = useDataStore()
    const [a, b] = data.allTasks.filter((t) => t.projectId === 'p1')
    const { w, r } = card(
      proposal({
        status: 'registered',
        keyByTempId: { t1: a.key, t2: b.key, t3: 'HW-9999' },
      }),
    )
    expect(w.find('button').exists()).toBe(false)
    const links = w.findAll('a')
    expect(links.map((l) => l.attributes('href'))).toEqual([`/tasks/${a.id}`, `/tasks/${b.id}`])
    expect(links[0].text()).toContain(a.key)
    expect(links[0].text()).toContain(a.title)

    await links[1].trigger('click')
    await flushPromises()
    expect(r.currentRoute.value.path).toBe(`/tasks/${b.id}`)
  })

  it('취소되면 흐리게 한 줄로 접힌다', () => {
    const { w } = card(proposal({ status: 'cancelled' }))
    expect(w.text()).toBe('작업 초안 3건 · 취소함')
    expect(w.find('button').exists()).toBe(false)
    expect(w.find('[data-proposed-task]').exists()).toBe(false)
  })
})

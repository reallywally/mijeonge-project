// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import TasksView from './TasksView.vue'

/* 화면이 실제로 떠야 잡히는 것들 — 템플릿 오류, shadcn 컴포넌트 쓰는 법, 거르기가
   화면까지 닿는지. 타입 검사만으로는 안 걸린다. */
function mountView() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:p(.*)', component: TasksView }],
  })
  return mount(TasksView, { global: { plugins: [router] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('작업 목록 화면', () => {
  it('뜬다', () => {
    const w = mountView()
    expect(w.text()).toContain('작업')
    expect(w.text()).toContain('목록')
  })

  it('한 쪽에 여덟 줄씩 놓고 총 건수를 적는다', () => {
    const w = mountView()
    expect(w.findAll('tbody tr')).toHaveLength(8)
    expect(w.text()).toContain('총 21건 중 1–8건')
  })

  it('제목 아래에 어디에 속한 작업인지 경로가 붙는다', () => {
    const w = mountView()
    expect(w.text()).toContain('최상위 작업 · 하위 2건')
    expect(w.text()).toContain('설계')
  })

  it('상태 칩이 그 상태의 수를 들고 있다', () => {
    const w = mountView()
    const chips = w.findAll('button').map((b) => b.text())
    expect(chips.some((t) => t.startsWith('막힘') && t.endsWith('1'))).toBe(true)
    expect(chips.some((t) => t.startsWith('기간 미정') && t.endsWith('1'))).toBe(true)
  })

  it("'그 작업만 보기'를 누르면 막힌 작업만 남는다", async () => {
    const w = mountView()
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

  it('기간이 잡힌 작업은 기간이 슬래시로 적힌다', () => {
    const w = mountView()
    expect(w.text()).toContain('9/8 ~ 9/15')
  })
})

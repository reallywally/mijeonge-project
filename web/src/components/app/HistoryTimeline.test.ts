// @vitest-environment jsdom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_BODY, type HistoryEntryView } from '@/lib/history'
import HistoryTimeline from './HistoryTimeline.vue'

/* 본문 이력(Q65)은 줄을 살린 전 · 후 블록 — 긴 글은 앞 세 줄만 보이고 펼친다. 같은 줄이 다시 오면 내용만 바뀐다 */
enableAutoUnmount(afterEach)

const entry = (to: string): HistoryEntryView => ({
  id: 'h1',
  changedAt: '2026-11-01T01:00:00Z',
  who: '김철수',
  changes: [{ field: 'body', label: '본문', from: EMPTY_BODY, to, long: true, block: true }],
})

describe('HistoryTimeline — 본문', () => {
  it('전 · 후를 줄바꿈 그대로 블록으로, 다시 그리면 같은 줄의 글만 바뀐다', async () => {
    const w = mount(HistoryTimeline, { props: { entries: [entry('☐ 작업1')] } })
    expect(w.get('[data-history-from]').text()).toBe(EMPTY_BODY)
    expect(w.get('[data-history-to]').element.textContent).toBe('☐ 작업1')
    expect(w.find('[data-history-more]').exists()).toBe(false)

    await w.setProps({ entries: [entry('☐ 작업1\n☐ 작업2')] })
    expect(w.findAll('[data-history-entry]')).toHaveLength(1)
    expect(w.get('[data-history-to]').element.textContent).toBe('☐ 작업1\n☐ 작업2')

    await w.setProps({ entries: [] })
    expect(w.findAll('[data-history-entry]')).toHaveLength(0)
  })

  it('세 줄이 넘는 글은 앞 세 줄만, 펼치면 다', async () => {
    const w = mount(HistoryTimeline, { props: { entries: [entry('1\n2\n3\n4')] } })
    expect(w.get('[data-history-to]').element.textContent).toBe('1\n2\n3\n… 외 1줄')
    await w.get('[data-history-more]').trigger('click')
    expect(w.get('[data-history-to]').element.textContent).toBe('1\n2\n3\n4')
  })
})

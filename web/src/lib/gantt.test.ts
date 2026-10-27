import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dueToEnd,
  endToDue,
  FINISH_TO_START,
  linkToDependency,
  rangeLabel,
  toGanttItems,
  toGanttLinks,
  toTestGanttItems,
  weekLabel,
} from './gantt'
import { taskStatusLabel } from './task'
import { useTaskStore } from '@/stores/task'
import type { TestRow } from '@/types/domain'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('스토어를 간트가 먹는 모양으로', () => {
  const items = () => toGanttItems(useTaskStore().rows, taskStatusLabel)
  const item = (key: string) => items().find((i) => i.key === key)!

  it('작업은 평평하다 — 모두 뿌리 아래 한 줄씩, 묶음 막대가 없다 (Q61)', () => {
    expect(items()).toHaveLength(22)
    expect(items().every((i) => i.parent === '0' && i.type === undefined)).toBe(true)
    /* HW-8 은 HW-7 을 연관으로 걸었지만 그 아래로 들어가지 않는다 */
    expect(item('HW-8').parent).toBe('0')
  })

  it('끝 날짜는 하루 뒤로 — 9/15 까지 하는 일은 9/16 에서 끝난다', () => {
    const t = item('HW-4')
    expect(t.start_date).toEqual(new Date(2026, 8, 8))
    expect(t.end_date).toEqual(new Date(2026, 8, 16))
    expect(t.unscheduled).toBeUndefined()
  })

  it('기간이 없는 작업은 unscheduled — 막대를 그리지 않는다', () => {
    const t = item('HW-18')
    expect(t.unscheduled).toBe(true)
    expect(t.start_date).toBeUndefined()
    expect(t.end_date).toBeUndefined()
  })

  it('상태 · 담당자는 우리가 그리므로 값을 달고 간다', () => {
    expect(item('HW-18').statusLabel).toBe('막힘')
    expect(item('HW-18').ownerName).toBe('정하늘')
    expect(item('HW-5').ownerName).toBeNull()
  })

  it('끌어 놓은 끝 날짜는 다시 하루를 빼서 돌아온다', () => {
    expect(endToDue(dueToEnd('2026-09-15'))).toBe('2026-09-15')
    expect(endToDue(new Date(2026, 9, 1))).toBe('2026-09-30')
  })
})

describe('눈금과 기간 글씨', () => {
  it('한 주는 시작과 끝을 함께 적는다', () => {
    expect(weekLabel(new Date(2026, 8, 7))).toBe('9월 7일 – 9월 13일')
  })

  it('맨 아래 기간은 기간이 잡힌 작업의 처음과 끝이다', () => {
    expect(rangeLabel(useTaskStore().rows)).toBe('2026년 9월 7일 – 10월 20일')
  })

  it('기간이 잡힌 작업이 없으면 적지 않는다', () => {
    expect(rangeLabel([])).toBe('')
  })
})

describe('선행 관계 ↔ 간트 화살표', () => {
  const deps = [
    { taskId: 'k20', dependsOnId: 'k19' },
    { taskId: 'k21', dependsOnId: 'k20' },
  ]

  it('선행의 끝 → 뒤 작업의 시작(finish-to-start)으로 그린다', () => {
    const links = toGanttLinks(deps, [{ id: 'k19' }, { id: 'k20' }, { id: 'k21' }])
    expect(links).toEqual([
      { id: 'k19>k20', source: 'k19', target: 'k20', type: FINISH_TO_START },
      { id: 'k20>k21', source: 'k20', target: 'k21', type: FINISH_TO_START },
    ])
    expect(FINISH_TO_START).toBe('0')
  })

  it('한쪽이 간트에 없으면(거르기로 빠짐) 그리지 않는다', () => {
    expect(toGanttLinks(deps, [{ id: 'k19' }, { id: 'k20' }]).map((l) => l.id)).toEqual(['k19>k20'])
  })

  it('끌어 만든 화살표를 선행 관계로 — 끝 → 시작만 받는다', () => {
    expect(linkToDependency({ source: 'k15', target: 'k16', type: '0' })).toEqual({
      taskId: 'k16',
      dependsOnId: 'k15',
    })
    /* 시작 → 시작 · 끝 → 끝 · 시작 → 끝, 제자리 */
    for (const type of ['1', '2', '3'])
      expect(linkToDependency({ source: 'k15', target: 'k16', type })).toBeNull()
    expect(linkToDependency({ source: 'k15', target: 'k15', type: '0' })).toBeNull()
  })
})

describe('테스트를 간트가 먹는 모양으로', () => {
  const row = (id: string, parentId: string | null, start: string | null, due: string | null) =>
    ({
      test: { id, key: id.toUpperCase(), title: id, parentId, start, due },
      isGroup: false,
      status: 'draft',
      signals: id === 'c' ? ['overdue'] : [],
      ownerName: null,
      pathLabel: '',
      periodLabel: '',
      childCount: 0,
    }) as unknown as TestRow

  it('묶음 막대는 하위 테스트의 기간을 덮고, 기간 지남 · 오래 걸림은 late 로 표를 한다', () => {
    const items = toTestGanttItems(
      [
        row('g', null, null, null),
        row('a', 'g', '2026-10-06', '2026-10-08'),
        row('c', 'g', '2026-10-13', '2026-10-17'),
        row('u', 'g', null, null),
        row('e', null, null, null),
      ],
      (s) => s,
    )
    const by = (id: string) => items.find((i) => i.id === id)!
    expect(by('g')).toMatchObject({
      type: 'project',
      start_date: new Date(2026, 9, 6),
      end_date: new Date(2026, 9, 18),
    })
    expect(by('c').late).toBe(true)
    expect(by('a').late).toBeUndefined()
    expect(by('u').unscheduled).toBe(true)
    expect(by('e').unscheduled).toBe(true)
  })
})

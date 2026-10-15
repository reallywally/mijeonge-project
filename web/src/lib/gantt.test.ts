import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { dueToEnd, endToDue, rangeLabel, toGanttItems, weekLabel } from './gantt'
import { taskStatusLabel } from './task'
import { useTaskStore } from '@/stores/task'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('스토어를 간트가 먹는 모양으로', () => {
  const items = () => toGanttItems(useTaskStore().rows, taskStatusLabel)
  const item = (key: string) => items().find((i) => i.key === key)!

  it('목록과 달리 계층을 그대로 들고 간다', () => {
    expect(item('HW-1').parent).toBe('0')
    expect(item('HW-8').parent).toBe(item('HW-7').id)
    expect(items()).toHaveLength(22)
  })

  it('자식이 있는 작업은 묶음 막대가 된다', () => {
    expect(item('HW-5').type).toBe('project')
    expect(item('HW-8').type).toBeUndefined()
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

  it('거른 행만 받으면 그 안에서 묶음 · 부모를 본다 — 자식이 다 빠진 묶음은 막대가 된다', () => {
    const rows = useTaskStore().rows.filter((r) => ['k5', 'k6', 'k14', 'k15'].includes(r.task.id))
    const got = toGanttItems(rows, taskStatusLabel, (id) => id === 'k6' || id === 'k14')
    const by = (id: string) => got.find((i) => i.id === id)!
    expect(by('k14').type).toBe('project')
    expect(by('k15').type).toBeUndefined()
    expect(by('k6').context).toBe(true)
    expect(by('k15').context).toBeUndefined()

    /* k7 묶음의 자식이 하나도 안 들어오면 묶음이 아니다. 부모가 빠졌으면 최상위로 */
    const lone = toGanttItems(
      useTaskStore().rows.filter((r) => r.task.id === 'k7'),
      taskStatusLabel,
    )
    expect(lone[0].type).toBeUndefined()
    expect(lone[0].parent).toBe('0')
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

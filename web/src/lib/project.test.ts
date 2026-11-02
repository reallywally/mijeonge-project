import { describe, expect, it } from 'vitest'
import type { ProjectStatus } from '@/types/domain'
import {
  PROJECT_STATUS_OPTIONS,
  isProjectStatus,
  makeTaskKeyPrefix,
  orderProjects,
  projectDateRangeError,
  projectPeriod,
  projectStatusLabel,
  taskKeyPrefixError,
} from './project'

describe('makeTaskKeyPrefix', () => {
  it('이미 쓰는 접두사를 비껴간다', () => {
    expect(makeTaskKeyPrefix(['HW', 'PAS'])).toBe('PJ1')
    expect(makeTaskKeyPrefix(['PJ1', 'PJ2'])).toBe('PJ3')
  })
})

describe('taskKeyPrefixError', () => {
  it('비워 두는 것은 잘못이 아니다 — 자동으로 붙는다', () => {
    expect(taskKeyPrefixError('', ['HW'])).toBeNull()
    expect(taskKeyPrefixError('  ', ['HW'])).toBeNull()
  })

  it('소문자로 적어도 대문자로 보고 받아들인다', () => {
    expect(taskKeyPrefixError('sl', ['HW'])).toBeNull()
  })

  it('겹치는 접두사는 막는다 — HW-4 한 마디로 가리켜야 한다', () => {
    expect(taskKeyPrefixError('hw', ['HW'])).toContain('이미 쓰고 있는')
  })

  it('숫자로 시작하거나 너무 길면 막는다', () => {
    expect(taskKeyPrefixError('4HW', [])).toContain('1~8자')
    expect(taskKeyPrefixError('ABCDEFGHI', [])).toContain('1~8자')
    expect(taskKeyPrefixError('한화', [])).toContain('1~8자')
  })
})

describe('projectDateRangeError', () => {
  it('둘 다 있을 때만 앞뒤를 본다 — 같은 날은 된다', () => {
    expect(projectDateRangeError('2026-11-02', '2026-11-01')).toContain('앞섭니다')
    expect(projectDateRangeError('2026-11-01', '2026-11-01')).toBeNull()
    expect(projectDateRangeError('2026-11-02', '')).toBeNull()
    expect(projectDateRangeError('', '2026-11-01')).toBeNull()
  })
})

describe('orderProjects', () => {
  it('진행 → 준비 → 종료, 같은 상태끼리는 받은 순서 그대로', () => {
    const list: { id: string; status: ProjectStatus }[] = [
      { id: 'a', status: 'closed' },
      { id: 'b', status: 'planned' },
      { id: 'c', status: 'active' },
      { id: 'd', status: 'closed' },
      { id: 'e', status: 'planned' },
      { id: 'f', status: 'active' },
    ]
    expect(orderProjects(list).map((p) => p.id)).toEqual(['c', 'f', 'b', 'e', 'a', 'd'])
  })

  it('화면 이름은 준비 · 진행 · 종료', () => {
    expect(PROJECT_STATUS_OPTIONS.map((o) => o.label)).toEqual(['준비', '진행', '종료'])
    expect(projectStatusLabel('planned')).toBe('준비')
    expect(isProjectStatus('closed')).toBe(true)
    expect(isProjectStatus('archived')).toBe(false)
  })
})

describe('projectPeriod', () => {
  it('있는 쪽만 찍고, 둘 다 없으면 빈 문자열', () => {
    expect(projectPeriod({ startDate: '2026-03-02', endDate: '2026-12-31' })).toBe(
      '2026-03-02 ~ 2026-12-31',
    )
    expect(projectPeriod({ startDate: '2026-03-02', endDate: null })).toBe('2026-03-02 ~')
    expect(projectPeriod({ startDate: null, endDate: '2026-12-31' })).toBe('~ 2026-12-31')
    expect(projectPeriod({ startDate: null, endDate: null })).toBe('')
  })
})

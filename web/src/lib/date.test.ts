import { describe, expect, it } from 'vitest'
import { dayTime, monthDay, slashDay, today } from './date'

describe('monthDay', () => {
  it('앞자리 0을 떼고 한국식으로 적는다', () => {
    expect(monthDay('2026-03-12')).toBe('3월 12일')
    expect(monthDay('2026-09-04')).toBe('9월 4일')
  })
})

describe('slashDay', () => {
  it('좁은 칸에 쓰라고 슬래시로 준다', () => {
    expect(slashDay('2026-09-08')).toBe('9/8')
    expect(slashDay('2026-10-04')).toBe('10/4')
  })
})

describe('dayTime', () => {
  it('시각이 있으면 분까지만 붙인다', () => {
    expect(dayTime('2026-03-21T10:14:33')).toBe('3월 21일 10:14')
  })

  it('시각이 없으면 날짜만 남는다', () => {
    expect(dayTime('2026-03-21')).toBe('3월 21일')
  })
})

describe('today', () => {
  it('YYYY-MM-DD 로 준다', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

import { describe, expect, it } from 'vitest'
import { dayTime, kstToday, localDay, monthDay, nowIso, slashDay, today } from './date'

describe('localDay', () => {
  it('UTC 를 한국 시간으로 옮겨 날짜만 남긴다', () => {
    expect(localDay('2026-09-08T01:00:00Z')).toBe('2026-09-08')
    /* 밤 10시(UTC)는 한국에서 이미 다음 날 아침이다 */
    expect(localDay('2026-09-08T22:00:00Z')).toBe('2026-09-09')
  })

  it('날짜뿐인 문자열은 그대로 통과한다 — 사람이 고른 날짜는 시간대가 없다', () => {
    expect(localDay('2026-09-08')).toBe('2026-09-08')
  })
})

describe('monthDay', () => {
  it('앞자리 0을 떼고 한국식으로 적는다', () => {
    expect(monthDay('2026-03-12')).toBe('3월 12일')
    expect(monthDay('2026-09-04')).toBe('9월 4일')
  })

  it('createdAt 처럼 시각까지 있는 값도 읽는다', () => {
    expect(monthDay('2026-09-08T01:00:00Z')).toBe('9월 8일')
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

describe('kstToday', () => {
  it('브라우저 시간대가 아니라 한국 시간의 오늘을 준다', () => {
    expect(kstToday(new Date('2026-10-09T14:59:59Z'))).toBe('2026-10-09')
    expect(kstToday(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-10')
  })
})

describe('nowIso', () => {
  it('계약대로 Z 로 끝나는 UTC 로 준다 — 밀리초는 뗀다', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

import { describe, expect, it } from 'vitest'
import { BLANK_DECISION, firstLine, nextDecisionMarks } from '@/lib/agenda'

const NOW = '2026-11-04T01:00:00Z'

describe('결정 판 · 정해진 때', () => {
  it('결정내용이 바뀌면 판이 오르고, 앞뒤 공백만 다르면 그대로', () => {
    const before = { decision: '우분투', state: 'open' as const, decidedAt: null, decisionRev: 1 }
    expect(nextDecisionMarks(before, { decision: '록키', state: 'open' }, NOW)).toEqual({
      decidedAt: null,
      decisionRev: 2,
    })
    expect(nextDecisionMarks(before, { decision: ' 우분투\n', state: 'open' }, NOW)).toEqual({
      decidedAt: null,
      decisionRev: 1,
    })
  })

  it('decided 가 되면 지금 시각을 찍고 판이 오른다 — 글도 같이 바뀌어도 1만', () => {
    const before = { decision: '', state: 'open' as const, decidedAt: null, decisionRev: 0 }
    expect(nextDecisionMarks(before, { decision: '우분투', state: 'decided' }, NOW)).toEqual({
      decidedAt: NOW,
      decisionRev: 1,
    })
  })

  it('decided 그대로면 시각을 두고, 벗어나면 null', () => {
    const before = {
      decision: '우분투',
      state: 'decided' as const,
      decidedAt: '2026-09-09T02:00:00Z',
      decisionRev: 1,
    }
    expect(nextDecisionMarks(before, { decision: '우분투', state: 'decided' }, NOW)).toEqual({
      decidedAt: '2026-09-09T02:00:00Z',
      decisionRev: 1,
    })
    expect(nextDecisionMarks(before, { decision: '우분투', state: 'open' }, NOW)).toEqual({
      decidedAt: null,
      decisionRev: 1,
    })
  })

  it('등록 — 빈 안건에서 바뀐 것으로 센다. 결정내용 없이 decided 도 된다', () => {
    expect(nextDecisionMarks(BLANK_DECISION, { decision: '', state: 'queued' }, NOW)).toEqual({
      decidedAt: null,
      decisionRev: 0,
    })
    expect(nextDecisionMarks(BLANK_DECISION, { decision: '', state: 'decided' }, NOW)).toEqual({
      decidedAt: NOW,
      decisionRev: 1,
    })
  })
})

describe('결정내용 첫 줄', () => {
  it('빈 줄을 건너뛰고 앞뒤 공백을 뗀다', () => {
    expect(firstLine('\n  mysql 을 쓴다\n- 비용')).toBe('mysql 을 쓴다')
    expect(firstLine('')).toBe('')
  })
})

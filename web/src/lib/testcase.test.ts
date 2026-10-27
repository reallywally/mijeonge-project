import { describe, expect, it } from 'vitest'
import {
  dueLeftLabel,
  mergeSignals,
  sortAttention,
  testFieldProblems,
  testSignals,
  testSinceLabel,
  testStatusDays,
  testStatusProblem,
  worstStatus,
} from './testcase'
import type { SignalInput } from './testcase'

const TODAY = '2026-10-15'
const base: SignalInput = {
  status: 'draft',
  statusDays: 0,
  start: null,
  due: null,
  changedEntryIds: [],
  isGroup: false,
}

describe('신호 — 서버와 같은 셈(목업이 쓴다)', () => {
  it('오래 걸림 — 기간이 있으면 계획의 1.5배를 넘어야, 없으면 staleDays 를 넘어야', () => {
    /* 10/6 ~ 10/8 은 사흘 — 4.5일을 넘어야 한다 */
    const planned = { ...base, status: 'testing' as const, start: '2026-10-16', due: '2026-10-18' }
    expect(testSignals({ ...planned, statusDays: 4 }, TODAY, 7)).toEqual([])
    expect(testSignals({ ...planned, statusDays: 5 }, TODAY, 7)).toEqual(['longRunning'])
    const open = { ...base, status: 'testing' as const }
    expect(testSignals({ ...open, statusDays: 7 }, TODAY, 7)).toEqual([])
    expect(testSignals({ ...open, statusDays: 8 }, TODAY, 7)).toEqual(['longRunning'])
  })

  it('기간 지남 · 시작 안 함 — 오늘과 견준다, 성공이면 기간이 지나도 아님', () => {
    expect(testSignals({ ...base, due: '2026-10-14' }, TODAY, 7)).toEqual(['overdue'])
    expect(testSignals({ ...base, due: '2026-10-15' }, TODAY, 7)).toEqual([])
    expect(testSignals({ ...base, status: 'pass', due: '2026-10-01' }, TODAY, 7)).toEqual([])
    expect(testSignals({ ...base, status: 'ready', start: '2026-10-14' }, TODAY, 7)).toEqual([
      'notStarted',
    ])
    expect(testSignals({ ...base, status: 'testing', start: '2026-10-14' }, TODAY, 7)).toEqual([])
  })

  it('오래 막힘 · 실패 그대로 · 기준 바뀜, 표 순서대로 — 묶음은 늘 []', () => {
    expect(testSignals({ ...base, status: 'blocked', statusDays: 8 }, TODAY, 7)).toEqual([
      'longBlocked',
    ])
    expect(
      testSignals(
        { ...base, status: 'fail', statusDays: 8, due: '2026-10-01', changedEntryIds: ['e3'] },
        TODAY,
        7,
      ),
    ).toEqual(['overdue', 'failedIdle', 'basisChanged'])
    expect(
      testSignals({ ...base, isGroup: true, due: '2026-10-01', changedEntryIds: ['e3'] }, TODAY, 7),
    ).toEqual([])
  })

  it('며칠째 — 한국 시간 날짜끼리, 앞날이면 0', () => {
    /* 10/14 15:30Z 는 한국 시간 10/15 00:30 — 오늘 바뀐 것이다 */
    expect(testStatusDays('2026-10-14T15:30:00Z', TODAY)).toBe(0)
    expect(testStatusDays('2026-10-14T03:00:00Z', TODAY)).toBe(1)
    expect(testStatusDays('2026-10-20T03:00:00Z', TODAY)).toBe(0)
  })
})

describe('묶음 · 손쓸 테스트', () => {
  it('묶음의 상태는 하위 중 가장 나쁜 것 — 실패 > 막힘 > 테스트 중 > 작성 중 · 준비됨 > 성공', () => {
    expect(worstStatus(['pass', 'testing', 'ready'])).toBe('testing')
    expect(worstStatus(['blocked', 'fail', 'testing'])).toBe('fail')
    expect(worstStatus(['pass', 'blocked'])).toBe('blocked')
    expect(worstStatus(['ready', 'pass', 'draft'])).toBe('draft')
    expect(worstStatus(['pass', 'pass'])).toBe('pass')
    expect(worstStatus([])).toBeNull()
  })

  it('묶음의 신호는 하위 신호를 겹치지 않게 표 순서로 모은 것', () => {
    expect(
      mergeSignals([['basisChanged', 'overdue'], [], ['overdue', 'longRunning'], ['failedIdle']]),
    ).toEqual(['longRunning', 'overdue', 'failedIdle', 'basisChanged'])
  })

  it('손쓸 테스트 — 기간 지남 · 오래 막힘 · 오래 걸림 순, 같으면 N일째가 긴 것부터', () => {
    const rows = [
      { id: 'a', signals: ['notStarted' as const], statusDays: 30 },
      { id: 'b', signals: ['longRunning' as const], statusDays: 9 },
      { id: 'c', signals: ['longBlocked' as const], statusDays: 3 },
      { id: 'd', signals: ['longRunning' as const, 'overdue' as const], statusDays: 2 },
      { id: 'e', signals: ['longBlocked' as const], statusDays: 10 },
      { id: 'f', signals: ['basisChanged' as const], statusDays: 30 },
    ]
    expect(sortAttention(rows).map((r) => r.id)).toEqual(['d', 'e', 'c', 'b', 'a', 'f'])
  })
})

describe('화면 말 · 검사', () => {
  it('N일째 · 남은 날', () => {
    expect(testSinceLabel({ status: 'testing', statusDays: 5 })).toBe('테스트 중 · 5일째')
    expect(testSinceLabel({ status: 'blocked', statusDays: 0 })).toBe('막힘 · 오늘부터')
    expect(dueLeftLabel('2026-10-18', TODAY)).toBe('3일 남음')
    expect(dueLeftLabel(TODAY, TODAY)).toBe('오늘까지')
    expect(dueLeftLabel('2026-10-08', TODAY)).toBe('7일 지남')
    expect(dueLeftLabel(null, TODAY)).toBe('기간 미정')
  })

  it('입력 검사 — 자리를 서버처럼 짚는다', () => {
    expect(
      testFieldProblems({
        title: 'a'.repeat(201),
        steps: [
          { action: '열기', expected: '' },
          { action: '  ', expected: 'x' },
        ],
        start: '2026-10-09',
        due: '2026-10-08',
      }),
    ).toEqual({
      title: '제목은 1 ~ 200자로 적어 주세요.',
      'steps.1.action': '행동을 적어 주세요.',
      due: '끝나는 날이 시작하는 날보다 앞입니다.',
    })
    expect(testFieldProblems({ title: '로그인' })).toEqual({})
  })

  it('상태 검사 — 실패 · 막힘은 메모, 실패 단계는 1 ~ 단계 수, 다른 상태는 단계를 안 본다', () => {
    expect(testStatusProblem('blocked', ' ', null, 2)).toHaveProperty('note')
    expect(testStatusProblem('fail', '안 됨', 3, 2)).toHaveProperty('failedStep')
    expect(testStatusProblem('fail', '안 됨', null, 2)).toEqual({})
    expect(testStatusProblem('pass', undefined, 9, 2)).toEqual({})
  })
})

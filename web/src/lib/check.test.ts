import { describe, expect, it } from 'vitest'
import { taskAgendaLinks, tasks, agendas } from '@/fixtures'
import {
  checkBlock,
  checkRecipients,
  checksOfRev,
  groupByRev,
  sortReceived,
  sortSentBatches,
} from '@/lib/check'
import type { CheckRequest, Agenda } from '@/types/domain'

/* 확인 요청의 규칙 — 서버와 같은 셈을 화면 · 목업이 같이 쓴다 (docs/api/check.md) */
const agenda = (id: string) => agendas.find((t) => t.id === id)!
const p1 = new Set(['u1', 'u2', 'u3', 'u4'])
const recipients = (t: Agenda, senderId: string | null, eligible = (id: string) => p1.has(id)) =>
  checkRecipients({ agenda: t, tasks, taskAgendas: taskAgendaLinks, senderId, eligible })

const row = (
  id: string,
  createdAt: string,
  confirmedAt: string | null,
  decisionRev = 1,
): CheckRequest => ({
  id,
  projectId: 'p1',
  agendaId: 't1',
  decisionRev,
  decision: `판 ${decisionRev}`,
  senderId: 'u2',
  recipientId: 'u1',
  createdAt,
  confirmedAt,
})
const ids = (rows: { id: string }[]) => rows.map((c) => c.id)

describe('결정 판', () => {
  it('그 안건 · 그 판으로 보낸 줄만', () => {
    const rows = [
      row('a', '2026-10-01T00:00:00Z', null, 1),
      row('b', '2026-10-02T00:00:00Z', null, 2),
    ]
    expect(ids(checksOfRev(rows, 't1', 2))).toEqual(['b'])
    expect(checksOfRev(rows, 't2', 1)).toEqual([])
  })
})

describe('받는 사람', () => {
  it('연결 작업 담당자(작업 순) 다음에 참조(ccIds 순) — 겹치면 처음 자리 하나', () => {
    /* k4 · k22 둘 다 담당 u3, 참조 u2 · u4 */
    expect(recipients(agenda('t2'), 'u1')).toEqual(['u3', 'u2', 'u4'])
    /* 담당 u3 이 참조에도 있으면 작업 담당 자리 하나 */
    expect(recipients({ ...agenda('t2'), ccIds: ['u4', 'u3'] }, 'u1')).toEqual(['u3', 'u4'])
    /* 연결 작업도 참조도 없음 */
    expect(recipients(agenda('t6'), 'u1')).toEqual([])
  })

  it('누른 사람은 빠진다 — t1(담당 u3 · 참조 u1)', () => {
    expect(recipients(agenda('t1'), 'u3')).toEqual(['u1'])
    expect(recipients(agenda('t1'), 'u1')).toEqual(['u3'])
  })

  it('활성 멤버가 아니면 조용히 건너뛴다 — 참조도 같다', () => {
    expect(recipients(agenda('t2'), 'u1', (id) => id !== 'u3')).toEqual(['u2', 'u4'])
    expect(recipients(agenda('t2'), 'u1', (id) => id === 'u1')).toEqual([])
  })
})

describe('못 누르는 까닭', () => {
  const decided = agenda('t6')

  it('결정 전 → 이미 보냄 → 받을 사람 없음 순', () => {
    expect(checkBlock(agenda('t3'), false, 2)).toBe('not-decided')
    /* 결정내용이 비어도 결정 상태면 보낼 수 있다 */
    expect(checkBlock({ ...decided, decision: '' }, false, 1)).toBeNull()
    expect(checkBlock(decided, true, 0)).toBe('sent')
    expect(checkBlock(decided, false, 0)).toBe('no-recipients')
    expect(checkBlock(decided, false, 1)).toBeNull()
  })
})

describe('묶음 · 정렬', () => {
  it('결정 판별로 묶고 확인 수 · 보낼 때의 결정내용을 싣는다', () => {
    const rows = [
      row('a', '2026-10-01T00:00:00Z', null, 1),
      row('b', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 1),
      row('c', '2026-10-05T00:00:00Z', null, 2),
    ]
    const batches = groupByRev(rows)
    expect(batches.map((b) => [b.key, b.decision, ids(b.rows), b.confirmed])).toEqual([
      ['t1#1', '판 1', ['a', 'b'], 1],
      ['t1#2', '판 2', ['c'], 0],
    ])
    expect(sortSentBatches(batches).map((b) => b.decisionRev)).toEqual([2, 1])
  })

  it('받은 것 — 대기는 오래된 순, 확인은 최근 확인 순', () => {
    const rows = [
      row('a', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      row('b', '2026-10-05T00:00:00Z', null),
      row('c', '2026-10-03T00:00:00Z', '2026-10-09T00:00:00Z'),
      row('d', '2026-10-02T00:00:00Z', null),
    ]
    expect(ids(sortReceived(rows))).toEqual(['d', 'b', 'c', 'a'])
  })
})

import { describe, expect, it } from 'vitest'
import { entries, taskThreadLinks, tasks, threads } from '@/fixtures'
import {
  checkBlock,
  checkRecipients,
  groupByEntry,
  latestDecision,
  sortReceived,
  sortSentBatches,
} from '@/lib/check'
import type { CheckRequest, Entry, Thread } from '@/types/domain'

/* 확인 요청의 규칙 — 서버와 같은 셈을 화면 · 목업이 같이 쓴다 (docs/api/check.md) */
const thread = (id: string) => threads.find((t) => t.id === id)!
const p1 = new Set(['u1', 'u2', 'u3', 'u4'])
const recipients = (t: Thread, senderId: string | null, eligible = (id: string) => p1.has(id)) =>
  checkRecipients({ thread: t, tasks, taskThreads: taskThreadLinks, senderId, eligible })

const row = (
  id: string,
  createdAt: string,
  confirmedAt: string | null,
  entryId = id,
): CheckRequest => ({
  id,
  projectId: 'p1',
  threadId: 't1',
  entryId,
  senderId: 'u2',
  recipientId: 'u1',
  createdAt,
  confirmedAt,
})
const ids = (rows: { id: string }[]) => rows.map((c) => c.id)

describe('최근 결정', () => {
  it('decide · change 중 마지막 줄 — 미루기 · 다듬기는 결정이 아니다', () => {
    expect(latestDecision(entries, 't2')?.id).toBe('e3')
    expect(latestDecision(entries, 't3')).toBeNull()
    const later: Entry[] = [
      ...entries,
      { ...entries[0], id: 'x1', threadId: 't2', kind: 'change' },
      { ...entries[0], id: 'x2', threadId: 't2', kind: 'refine' },
    ]
    expect(latestDecision(later, 't2')?.id).toBe('x1')
  })
})

describe('받는 사람', () => {
  it('연결 작업 담당자 → 참조 순, 겹치면 처음 자리 하나', () => {
    /* k4 · k22 담당 u3, 참조 u2 · u4 */
    expect(recipients(thread('t2'), 'u1')).toEqual(['u3', 'u2', 'u4'])
    /* 연결 작업 없음, 참조 u2 */
    expect(recipients(thread('t6'), 'u1')).toEqual(['u2'])
  })

  it('누른 사람은 빠진다 — t1 을 u3 이 누르면 참조 u1 만', () => {
    expect(recipients(thread('t1'), 'u3')).toEqual(['u1'])
    expect(recipients(thread('t1'), 'u1')).toEqual(['u3'])
  })

  it('활성 멤버가 아니면 조용히 건너뛴다', () => {
    expect(recipients(thread('t2'), 'u1', (id) => id !== 'u3')).toEqual(['u2', 'u4'])
    expect(recipients({ ...thread('t6'), ccIds: [] }, 'u1')).toEqual([])
  })
})

describe('못 누르는 까닭', () => {
  const decided = thread('t6')
  const e6 = latestDecision(entries, 't6')

  it('결정 전 → 이미 보냄 → 받을 사람 없음 순', () => {
    expect(checkBlock(thread('t3'), null, false, 2)).toBe('not-decided')
    /* 결정 상태라도 결정 이력이 없으면 결정 전이다 */
    expect(checkBlock(decided, null, false, 2)).toBe('not-decided')
    expect(checkBlock(decided, e6, true, 0)).toBe('sent')
    expect(checkBlock(decided, e6, false, 0)).toBe('no-recipients')
    expect(checkBlock(decided, e6, false, 1)).toBeNull()
  })
})

describe('묶음 · 정렬', () => {
  it('결정별로 묶고 확인 수를 센다', () => {
    const rows = [
      row('a', '2026-10-01T00:00:00Z', null, 'e1'),
      row('b', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'e1'),
      row('c', '2026-10-05T00:00:00Z', null, 'e2'),
    ]
    const batches = groupByEntry(rows)
    expect(batches.map((b) => [b.entryId, ids(b.rows), b.confirmed])).toEqual([
      ['e1', ['a', 'b'], 1],
      ['e2', ['c'], 0],
    ])
    expect(sortSentBatches(batches).map((b) => b.entryId)).toEqual(['e2', 'e1'])
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

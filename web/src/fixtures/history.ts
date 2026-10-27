import { tasks } from '@/fixtures/tasks'
import { testCases } from '@/fixtures/tests'
import type { HistoryEntry } from '@/types/domain'

/**
 * 변경 이력 — docs/api/history.md '시드 · 목업'. 작업 · 테스트마다 등록 한 줄(바꾼 사람 = 작업은 담당자 ·
 * 테스트는 만든 사람, 등록 시각)에 시연 둘을 더한다 — k20 의 상태(task_log 시연 줄과 같은 때) ·
 * HW-T7 의 실패(그 테스트의 바뀐 시각). 배열 순서가 seq 순서다
 */

const created = (prefix: string, id: string, at: string, by: string | null): HistoryEntry => ({
  id: `${prefix}-${id}-1`,
  changedAt: at,
  changedBy: by,
  backfilled: false,
  changes: [{ field: 'created', from: null, to: null, subject: '' }],
})

export const taskHistory: Record<string, HistoryEntry[]> = Object.fromEntries(
  tasks.map((t) => [t.id, [created('th', t.id, t.createdAt, t.ownerId)]]),
)
taskHistory.k20.push({
  id: 'th-k20-2',
  changedAt: '2026-10-08T00:00:00Z',
  changedBy: 'u3',
  backfilled: false,
  changes: [{ field: 'status', from: 'todo', to: 'doing', subject: '' }],
})

export const testHistory: Record<string, HistoryEntry[]> = Object.fromEntries(
  testCases.map((t) => [t.id, [created('sh', t.id, t.createdAt, t.createdBy)]]),
)
const t7 = testCases.find((t) => t.id === 'tc7')!
testHistory.tc7.push({
  id: 'sh-tc7-2',
  changedAt: t7.statusChangedAt,
  changedBy: t7.statusChangedBy,
  backfilled: false,
  changes: [
    { field: 'status', from: 'testing', to: 'fail', subject: '' },
    { field: 'resultNote', from: null, to: t7.resultNote, subject: '' },
  ],
})

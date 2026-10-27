import { id, mockError, request } from '@/api/client'
import { later, mockDb, mockSessionMemberId, mockWorld, requireMe } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canSeeProject } from '@/lib/access'
import { nowIso } from '@/lib/date'
import { orderChanges, type HistoryKind } from '@/lib/history'
import type { HistoryChange, HistoryEntry } from '@/types/domain'

/* 변경 이력 (docs/api/history.md). 서버는 쓰기 요청마다 스스로 줄을 남기고 여기서는 읽기만 한다.
   목업 갈래는 서버가 없어 목업 쓰기(작업은 데이터 스토어 · 일괄 등록 · 회의록 apply, 테스트는 api/tests)가
   recordMockHistory 한 곳으로 줄을 남긴다 */

const book = (kind: HistoryKind) => (kind === 'task' ? mockDb().taskHistory : mockDb().testHistory)

/**
 * 목업 이력에 한 줄 — 요청 하나가 한 줄이다. 남길 칸이 없으면 줄을 안 만든다.
 * 바꾼 사람은 로그인한 사람(세션이 없으면 null), 칸은 계약의 칸 표 순서로 놓는다
 */
export function recordMockHistory(kind: HistoryKind, targetId: string, changes: HistoryChange[]) {
  if (changes.length === 0) return
  const db = mockDb()
  db.historySeq += 1
  ;(book(kind)[targetId] ??= []).push({
    id: `mh${db.historySeq}`,
    changedAt: nowIso(),
    changedBy: mockSessionMemberId(),
    backfilled: false,
    changes: orderChanges(structuredClone(changes), kind),
  })
}

/** 못 보는 프로젝트의 것도 없는 것처럼 404 — require_scope 와 같은 경계 */
function mockList(kind: HistoryKind, targetId: string): HistoryEntry[] {
  const me = requireMe()
  const projectId =
    kind === 'task'
      ? mockWorld().tasks.find((t) => t.id === targetId)?.projectId
      : mockDb().tests.find((t) => t.id === targetId)?.projectId
  if (!projectId || !canSeeProject(me, projectId))
    throw kind === 'task'
      ? mockError(404, 'TASK_NOT_FOUND', '작업을 찾을 수 없습니다.')
      : mockError(404, 'TEST_NOT_FOUND', '테스트를 찾을 수 없습니다.')
  return structuredClone(book(kind)[targetId] ?? [])
}

/** 작업의 변경 이력 — 오래된 것부터(seq 순) */
export const fetchTaskHistory = (taskId: string) =>
  isMockMode()
    ? later(() => mockList('task', taskId))
    : request<HistoryEntry[]>('GET', `/tasks/${id(taskId)}/history`)

/** 테스트의 변경 이력 — 오래된 것부터(seq 순) */
export const fetchTestHistory = (testId: string) =>
  isMockMode()
    ? later(() => mockList('test', testId))
    : request<HistoryEntry[]>('GET', `/tests/${id(testId)}/history`)

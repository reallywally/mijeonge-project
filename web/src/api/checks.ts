import { id, mockError, request } from '@/api/client'
import {
  forbidden,
  later,
  memberOf,
  mockDb,
  mockWorld,
  requireMe,
  requireProject,
} from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canSeeProject } from '@/lib/access'
import { checkRecipients, checksOfEntry, latestDecision } from '@/lib/check'
import { nowIso } from '@/lib/date'
import type { CheckPendingCount, CheckRequest } from '@/types/domain'

/* 확인 요청 (docs/api/check.md). 목업 갈래도 서버와 같은 순서 · 같은 코드로 거절한다 —
   THREAD_NOT_FOUND → CHECK_THREAD_NOT_DECIDED → CHECK_ALREADY_SENT → CHECK_NO_RECIPIENTS */

const notFound = () => mockError(404, 'CHECK_NOT_FOUND', '확인 요청을 찾을 수 없습니다.')

const mock = {
  list(projectId: string): CheckRequest[] {
    requireProject(requireMe(), projectId)
    return structuredClone(mockDb().checks.filter((c) => c.projectId === projectId))
  },
  send(threadId: string): CheckRequest[] {
    const me = requireMe()
    const world = mockWorld()
    const thread = world.threads.find((t) => t.id === threadId)
    /* 남의 프로젝트 안건은 없는 것처럼 */
    if (!thread || !canSeeProject(me, thread.projectId))
      throw mockError(404, 'THREAD_NOT_FOUND', '안건을 찾을 수 없습니다.')
    const decision = latestDecision(world.entries, threadId)
    if (thread.state !== 'decided' || !decision)
      throw mockError(400, 'CHECK_THREAD_NOT_DECIDED', '결정된 안건만 확인을 요청할 수 있습니다.')
    const db = mockDb()
    if (checksOfEntry(db.checks, decision.id).length > 0)
      throw mockError(409, 'CHECK_ALREADY_SENT', '이 결정은 이미 확인을 요청했습니다.')
    const recipients = checkRecipients({
      thread,
      tasks: world.tasks,
      taskThreads: world.taskThreads,
      senderId: me.id,
      eligible: (memberId) =>
        !!memberOf(memberId)?.active &&
        db.grants.some((g) => g.projectId === thread.projectId && g.memberId === memberId),
    })
    if (recipients.length === 0)
      throw mockError(
        400,
        'CHECK_NO_RECIPIENTS',
        '받을 사람이 없습니다. 연결 작업 담당자나 참조를 더해 주세요.',
      )

    const createdAt = nowIso()
    const made = recipients.map((recipientId) => {
      db.checkSeq += 1
      const row: CheckRequest = {
        id: `mck${db.checkSeq}`,
        projectId: thread.projectId,
        threadId,
        entryId: decision.id,
        senderId: me.id,
        recipientId,
        createdAt,
        confirmedAt: null,
      }
      db.checks.push(row)
      return row
    })
    return structuredClone(made)
  },
  confirm(checkId: string): CheckRequest {
    const me = requireMe()
    const row = mockDb().checks.find((c) => c.id === checkId)
    /* 남의 프로젝트 요청은 없는 것처럼 */
    if (!row || !canSeeProject(me, row.projectId)) throw notFound()
    if (row.recipientId !== me.id) throw forbidden()
    row.confirmedAt ??= nowIso()
    return structuredClone(row)
  },
  pendingCount(): CheckPendingCount {
    const me = requireMe()
    /* 지금 부여된 프로젝트만 센다 — 시스템 관리자도 부여된 것만 */
    const granted = new Set(
      mockDb()
        .grants.filter((g) => g.memberId === me.id)
        .map((g) => g.projectId),
    )
    const byProject: Record<string, number> = {}
    for (const c of mockDb().checks)
      if (c.recipientId === me.id && c.confirmedAt === null && granted.has(c.projectId))
        byProject[c.projectId] = (byProject[c.projectId] ?? 0) + 1
    const total = Object.values(byProject).reduce((sum, n) => sum + n, 0)
    return { total, byProject }
  },
}

/** 그 프로젝트의 요청 전부, 오래된 것 먼저. 거르기 · 정렬은 화면이 한다 */
export const fetchChecks = (projectId: string) =>
  isMockMode()
    ? later(() => mock.list(projectId))
    : request<CheckRequest[]>('GET', `/projects/${id(projectId)}/checks`)

/** 보내기 — 본문 없음. 받는 사람은 서버가 정하고 그 수만큼 줄이 생긴다. 보낸 사람은 로그인한 사람이다 */
export const sendCheck = (threadId: string) =>
  isMockMode()
    ? later(() => mock.send(threadId))
    : request<CheckRequest[]>('POST', `/threads/${id(threadId)}/checks`)

/** 확인 — 받은 사람만(그 밖은 403). 이미 확인했으면 그대로 돌려준다 */
export const confirmCheck = (checkId: string) =>
  isMockMode()
    ? later(() => mock.confirm(checkId))
    : request<CheckRequest>('POST', `/checks/${id(checkId)}/confirm`)

/** 내가 받은 대기 수 — 모든 프로젝트 합과 프로젝트별 */
export const fetchCheckPendingCount = () =>
  isMockMode()
    ? later(() => mock.pendingCount())
    : request<CheckPendingCount>('GET', '/checks/pending-count')

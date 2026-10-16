import { id, mockError, request } from '@/api/client'
import { forbidden, later, memberOf, mockDb, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { tasks, threads } from '@/fixtures'
import { canSeeProject } from '@/lib/access'
import { CHECK_RECIPIENTS_MAX, CHECK_TEXT_MAX, checkTextLength } from '@/lib/check'
import { nowIso } from '@/lib/date'
import type {
  CheckPendingCount,
  CheckRequest,
  CheckRequestInput,
  CheckTargetType,
} from '@/types/domain'

/* 확인 요청 (docs/api/check.md). 목업 갈래도 서버와 같은 순서 · 같은 코드로 거절한다 —
   422(모양 · 글자 수 · 사람 수) → CHECK_TARGET_NOT_FOUND → CHECK_RECIPIENT_SELF → MEMBER_NOT_IN_PROJECT */

const invalid = (detail: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

const notFound = () => mockError(404, 'CHECK_NOT_FOUND', '확인 요청을 찾을 수 없습니다.')

/* 화면에서 만든 목업 작업 · 안건은 픽스처에 없어 어느 프로젝트 것인지 모른다 — 그런 id 는 통과시키고,
   픽스처에 있는데 다른 프로젝트 · 다른 종류면 거절한다 */
function targetKnownElsewhere(projectId: string, type: CheckTargetType, targetId: string) {
  const own = type === 'task' ? tasks : threads
  const found = own.find((r) => r.id === targetId)
  if (found) return found.projectId !== projectId
  const other = type === 'task' ? threads : tasks
  return other.some((r) => r.id === targetId)
}

function validate(input: CheckRequestInput): Record<string, string> {
  const detail: Record<string, string> = {}
  if (input.targetType !== 'task' && input.targetType !== 'thread')
    detail.targetType = '작업이나 안건이어야 합니다.'
  if (typeof input.targetId !== 'string' || !input.targetId)
    detail.targetId = '걸 작업이나 안건이 없습니다.'
  if (!Array.isArray(input.recipientIds) || input.recipientIds.length === 0)
    detail.recipientIds = '받는 사람을 골라 주세요.'
  else if (input.recipientIds.length > CHECK_RECIPIENTS_MAX)
    detail.recipientIds = `받는 사람은 ${CHECK_RECIPIENTS_MAX}명까지입니다.`
  const n = typeof input.text === 'string' ? checkTextLength(input.text) : 0
  if (n === 0) detail.text = '내용을 적어 주세요.'
  else if (n > CHECK_TEXT_MAX) detail.text = `내용은 ${CHECK_TEXT_MAX}자까지입니다.`
  return detail
}

const mock = {
  list(projectId: string): CheckRequest[] {
    requireProject(requireMe(), projectId)
    return structuredClone(mockDb().checks.filter((c) => c.projectId === projectId))
  },
  send(projectId: string, input: CheckRequestInput): CheckRequest[] {
    const me = requireMe()
    requireProject(me, projectId)
    const detail = validate(input)
    if (Object.keys(detail).length > 0) throw invalid(detail)
    if (targetKnownElsewhere(projectId, input.targetType, input.targetId)) {
      const what = input.targetType === 'task' ? '작업' : '안건'
      throw mockError(
        400,
        'CHECK_TARGET_NOT_FOUND',
        `이 프로젝트에서 그 ${what}을 찾을 수 없습니다.`,
        { targetId: `${what}을 찾을 수 없습니다.` },
      )
    }
    /* 겹친 사람은 처음 나온 자리 하나로 — 오류는 보낸 배열의 자리를 짚는다 */
    const firstAt = new Map<string, number>()
    input.recipientIds.forEach((memberId, i) => {
      if (!firstAt.has(memberId)) firstAt.set(memberId, i)
    })
    if (firstAt.has(me.id))
      throw mockError(
        400,
        'CHECK_RECIPIENT_SELF',
        '자기 자신에게는 확인 요청을 보낼 수 없습니다.',
        { [`recipientIds.${firstAt.get(me.id)}`]: '나 자신은 고를 수 없습니다.' },
      )
    const db = mockDb()
    const outside: Record<string, string> = {}
    for (const [memberId, i] of firstAt) {
      const granted = db.grants.some((g) => g.projectId === projectId && g.memberId === memberId)
      if (!granted || !memberOf(memberId)?.active)
        outside[`recipientIds.${i}`] = '이 프로젝트에 부여되지 않았거나 비활성인 사람입니다.'
    }
    if (Object.keys(outside).length > 0)
      throw mockError(
        400,
        'MEMBER_NOT_IN_PROJECT',
        '이 프로젝트에 부여되지 않은 사람입니다.',
        outside,
      )

    const text = input.text.trim()
    const createdAt = nowIso()
    const made = [...firstAt.keys()].map((recipientId) => {
      db.checkSeq += 1
      const row: CheckRequest = {
        id: `mck${db.checkSeq}`,
        projectId,
        targetType: input.targetType,
        targetId: input.targetId,
        senderId: me.id,
        recipientId,
        text,
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

/** 보내기 — 받는 사람 수만큼 줄이 생긴다(recipientIds 순서). 보낸 사람은 로그인한 사람이다 */
export const sendCheck = (projectId: string, input: CheckRequestInput) =>
  isMockMode()
    ? later(() => mock.send(projectId, input))
    : request<CheckRequest[]>('POST', `/projects/${id(projectId)}/checks`, input)

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

import { id, mockError, request } from '@/api/client'
import {
  accountOf,
  endSessionsOf,
  forbidden,
  later,
  memberOf,
  mockDb,
  requireMe,
  toAccount,
} from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { isSystemAdmin } from '@/lib/access'
import { looksLikeEmail, normalizeEmail, passwordProblem } from '@/lib/member'
import { nowIso } from '@/lib/date'
import type { MemberAccount, MemberAccountInput, MemberAccountPatch } from '@/types/domain'

/* 사용자 관리 — 시스템 관리자만 (docs/api/auth.md '사용자 관리'). 목업 갈래도 같은 규칙 · 코드를 낸다 */

function requireSystemAdmin() {
  const me = requireMe()
  if (!isSystemAdmin(me)) throw forbidden()
  return me
}

const invalid = (detail: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

const notFound = () => mockError(404, 'MEMBER_NOT_FOUND', '멤버를 찾을 수 없습니다.')

const emailTaken = () => mockError(409, 'EMAIL_TAKEN', '이미 쓰고 있는 이메일입니다.')

function checkEmail(email: string, exceptMemberId: string | null) {
  if (!looksLikeEmail(email)) throw invalid({ email: '이메일 형식이 아닙니다.' })
  const normalized = normalizeEmail(email)
  if (mockDb().accounts.some((a) => a.email === normalized && a.memberId !== exceptMemberId))
    throw emailTaken()
  return normalized
}

/** 활성 시스템 관리자가 이 사람 하나뿐인가 */
function isLastSystemAdmin(memberId: string) {
  const db = mockDb()
  const admins = db.accounts.filter(
    (a) => a.systemRole === 'admin' && db.members.find((m) => m.id === a.memberId)?.active,
  )
  return admins.length === 1 && admins[0].memberId === memberId
}

let mockSeq = 0

const mock = {
  list(): MemberAccount[] {
    requireSystemAdmin()
    return mockDb()
      .members.map((m) => toAccount(m.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  },
  create(input: MemberAccountInput): MemberAccount {
    requireSystemAdmin()
    const name = input.name.trim()
    if (!name) throw invalid({ name: '이름을 적어 주세요.' })
    const problem = passwordProblem(input.password)
    if (problem) throw invalid({ password: problem })
    const email = checkEmail(input.email, null)
    mockSeq += 1
    const memberId = `mu${mockSeq}`
    mockDb().members.push({ id: memberId, name, active: true })
    mockDb().accounts.push({
      memberId,
      email,
      password: input.password,
      systemRole: input.systemRole,
      createdAt: nowIso(),
      lastLoginAt: null,
    })
    return toAccount(memberId)
  },
  patch(memberId: string, patch: MemberAccountPatch): MemberAccount {
    requireSystemAdmin()
    const member = memberOf(memberId)
    const account = accountOf(memberId)
    if (!member || !account) throw notFound()
    if (patch.name !== undefined && !patch.name.trim())
      throw invalid({ name: '이름을 적어 주세요.' })
    const email = patch.email === undefined ? undefined : checkEmail(patch.email, memberId)
    const demoted = patch.systemRole === 'user' && account.systemRole === 'admin'
    const deactivated = patch.active === false && member.active
    if ((demoted || deactivated) && isLastSystemAdmin(memberId))
      throw mockError(409, 'LAST_SYSTEM_ADMIN', '마지막 시스템 관리자는 내리거나 끌 수 없습니다.')
    if (patch.name !== undefined) member.name = patch.name.trim()
    if (email !== undefined) account.email = email
    if (patch.systemRole !== undefined) account.systemRole = patch.systemRole
    if (patch.active !== undefined) member.active = patch.active
    if (deactivated) endSessionsOf(memberId)
    return toAccount(memberId)
  },
  setPassword(memberId: string, password: string) {
    requireSystemAdmin()
    const account = accountOf(memberId)
    if (!account) throw notFound()
    if (!account.email)
      throw mockError(
        400,
        'MEMBER_EMAIL_REQUIRED',
        '이메일이 없는 멤버에는 비밀번호를 걸 수 없습니다.',
      )
    const problem = passwordProblem(password)
    if (problem) throw invalid({ password: problem })
    account.password = password
    endSessionsOf(memberId)
  },
}

/** 전체 멤버 — 비활성 포함, 이름 순 */
export const fetchMemberAccounts = () =>
  isMockMode() ? later(() => mock.list()) : request<MemberAccount[]>('GET', '/admin/members')

export const createMemberAccount = (input: MemberAccountInput) =>
  isMockMode()
    ? later(() => mock.create(input))
    : request<MemberAccount>('POST', '/admin/members', input)

/** 비활성으로 바꾸면 서버가 그 사람의 세션을 모두 끊는다 */
export const patchMemberAccount = (memberId: string, patch: MemberAccountPatch) =>
  isMockMode()
    ? later(() => mock.patch(memberId, patch))
    : request<MemberAccount>('PATCH', `/admin/members/${id(memberId)}`, patch)

/** 비밀번호를 새로 건다 — 그 사람의 세션이 모두 끊긴다 */
export const setMemberPassword = (memberId: string, password: string) =>
  isMockMode()
    ? later(() => mock.setPassword(memberId, password))
    : request<void>('PUT', `/admin/members/${id(memberId)}/password`, { password })

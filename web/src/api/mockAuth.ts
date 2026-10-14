import { mockError } from '@/api/client'
import { accounts, members, partMembers, parts, projectGrants } from '@/fixtures'
import type { MockAccount, MockProjectGrant } from '@/fixtures'
import { canManageProject, canSeeProject } from '@/lib/access'
import type { Me, Member, MemberAccount, Part, PartMember } from '@/types/domain'

/*
 * 목업 갈래의 '서버' — 계정 · 부여 · 세션을 들고 서버처럼 권한과 오류 코드를 본다 (docs/api/auth.md).
 * auth · admin · projects · parts · comments · tasks 의 목업 갈래가 같이 쓴다. 판단은 lib/access 의 함수 그대로다.
 *
 * 세션은 쿠키 대신 sessionStorage 에 둔다 — 새로고침해도 로그인이 남아야 서버 모드와 같게 돈다.
 */

interface MockDb {
  members: Member[]
  accounts: MockAccount[]
  grants: MockProjectGrant[]
  parts: Part[]
  partMembers: PartMember[]
}

const fresh = (): MockDb => ({
  members: structuredClone(members),
  accounts: structuredClone(accounts),
  grants: structuredClone(projectGrants),
  parts: structuredClone(parts),
  partMembers: structuredClone(partMembers),
})

let db = fresh()

const SESSION_KEY = 'innoflow.mockSession'
let memorySession: string | null = null

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return memorySession
  }
}

export function writeMockSession(memberId: string | null) {
  memorySession = memberId
  try {
    if (memberId === null) sessionStorage.removeItem(SESSION_KEY)
    else sessionStorage.setItem(SESSION_KEY, memberId)
  } catch {
    /* node(테스트) · 막힌 저장소에서는 메모리만 쓴다 */
  }
}

/** 테스트가 서로 물들지 않게 처음으로 되돌린다 — 로그아웃 상태다 */
export function resetMockAuth() {
  db = fresh()
  writeMockSession(null)
}

export const mockDb = () => db

export const accountOf = (memberId: string) => db.accounts.find((a) => a.memberId === memberId)
export const memberOf = (memberId: string) => db.members.find((m) => m.id === memberId)

export function meOf(memberId: string): Me | null {
  const member = memberOf(memberId)
  const account = accountOf(memberId)
  if (!member || !account || !member.active || !account.email) return null
  return {
    id: member.id,
    name: member.name,
    email: account.email,
    systemRole: account.systemRole,
    projectRoles: Object.fromEntries(
      db.grants.filter((g) => g.memberId === memberId).map((g) => [g.projectId, g.role]),
    ),
  }
}

/** 로그인한 사람. 세션이 없거나 그사이 꺼졌으면 401 */
export function requireMe(): Me {
  const memberId = readSession()
  const me = memberId ? meOf(memberId) : null
  if (!me) {
    writeMockSession(null)
    throw mockError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.')
  }
  return me
}

/** 그 사람의 세션을 끊는다 — 목업에는 지금 브라우저의 세션 하나뿐이다 */
export function endSessionsOf(memberId: string) {
  if (readSession() === memberId) writeMockSession(null)
}

/** 부여받지 않은 프로젝트는 없는 것처럼 404 (docs/api/auth.md '권한 셋') */
export function requireProject(me: Me, projectId: string) {
  if (!canSeeProject(me, projectId))
    throw mockError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
}

export const forbidden = () => mockError(403, 'FORBIDDEN', '권한이 없습니다.')

/** 그 프로젝트의 관리자 · 시스템 관리자만 — 프로젝트 멤버 · 파트 쓰기 */
export function requireManager(projectId: string) {
  const me = requireMe()
  requireProject(me, projectId)
  if (!canManageProject(me, projectId)) throw forbidden()
  return me
}

export function toAccount(memberId: string): MemberAccount {
  const member = memberOf(memberId)!
  const account = accountOf(memberId)!
  return {
    id: member.id,
    name: member.name,
    email: account.email,
    systemRole: account.systemRole,
    active: member.active,
    hasPassword: account.password !== null,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  }
}

/** 목업도 서버처럼 한 박자 늦게 답한다 — 받는 중 표시를 거치는 길이 같아지게 */
export const later = <T>(fn: () => T) => Promise.resolve().then(fn)

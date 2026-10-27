import { mockError } from '@/api/client'
import {
  accounts,
  checkRequests,
  entries,
  members,
  minutesRows,
  partMembers,
  parts,
  projectGrants,
  taskDependencies,
  taskThreadLinks,
  tasks,
  taskHistory,
  testCases,
  testHistory,
  threads,
} from '@/fixtures'
import type { MockAccount, MockProjectGrant, MockTestCase } from '@/fixtures'
import { canManageProject, canSeeProject } from '@/lib/access'
import type {
  CheckRequest,
  Entry,
  HistoryEntry,
  Me,
  Member,
  MemberAccount,
  Minutes,
  Part,
  PartMember,
  Report,
  RiskSettings,
  Task,
  TaskDependency,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

/*
 * 목업 갈래의 '서버' — 계정 · 부여 · 세션을 들고 서버처럼 권한과 오류 코드를 본다 (docs/api/auth.md).
 * auth · admin · projects · parts · comments · tasks · dependencies · risk · checks · minutes · reports · tests · history 의 목업 갈래가 같이 쓴다. 판단은 lib/access 의 함수 그대로다.
 *
 * 세션은 쿠키 대신 sessionStorage 에 둔다 — 새로고침해도 로그인이 남아야 서버 모드와 같게 돈다.
 */

interface MockDb {
  members: Member[]
  accounts: MockAccount[]
  grants: MockProjectGrant[]
  parts: Part[]
  partMembers: PartMember[]
  /** 프로젝트별 리스크 기준. 없으면 기본값 */
  riskSettings: Record<string, RiskSettings>
  /** 확인 요청 — 배열 순서가 seq 순서다 */
  checks: CheckRequest[]
  checkSeq: number
  /** 회의록 게시판 — 배열 순서가 seq 순서다 */
  minutes: Minutes[]
  minutesSeq: number
  /** 프로젝트 진행 리포트 — 배열 순서가 seq 순서다. 시드는 없다 */
  reports: Report[]
  reportSeq: number
  /** 테스트 — 배열 순서가 seq 순서다 */
  tests: MockTestCase[]
  testSeq: number
  /** 프로젝트별 다음 테스트 번호 — 지운 번호를 다시 쓰지 않는다 */
  nextTestNo: Record<string, number>
  /** 변경 이력 — 작업 · 테스트 id 마다 등록 순서대로 */
  taskHistory: Record<string, HistoryEntry[]>
  testHistory: Record<string, HistoryEntry[]>
  historySeq: number
}

const fresh = (): MockDb => ({
  members: structuredClone(members),
  accounts: structuredClone(accounts),
  grants: structuredClone(projectGrants),
  parts: structuredClone(parts),
  partMembers: structuredClone(partMembers),
  riskSettings: {},
  checks: structuredClone(checkRequests),
  checkSeq: 0,
  minutes: structuredClone(minutesRows),
  minutesSeq: 0,
  reports: [],
  reportSeq: 0,
  tests: structuredClone(testCases),
  testSeq: 0,
  nextTestNo: {},
  taskHistory: structuredClone(taskHistory),
  testHistory: structuredClone(testHistory),
  historySeq: 0,
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

/** 지금 로그인한 사람의 id — 없으면 null. 목업 이력의 '바꾼 사람' 처럼 거절하지 않고 적기만 하는 자리가 쓴다 */
export const mockSessionMemberId = () => readSession()

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

/** 목업의 안건 · 이력 · 작업 — 목업 갈래에서는 이것들을 데이터 스토어가 들고 고친다 */
export interface MockWorld {
  threads: Thread[]
  entries: Entry[]
  tasks: Task[]
  taskThreads: TaskThreadLink[]
  taskDependencies: TaskDependency[]
}

let worldOf: (() => MockWorld) | null = null

/* 화면에서 결정하거나 새로 만든 목업 안건도 서버처럼 따지려고, 데이터 스토어가 자기 배열을 알려 준다.
   알려 준 것이 없으면(api 만 부르는 테스트) 픽스처를 본다 */
export function provideMockWorld(fn: (() => MockWorld) | null) {
  worldOf = fn
}

export const mockWorld = (): MockWorld =>
  worldOf?.() ?? { threads, entries, tasks, taskThreads: taskThreadLinks, taskDependencies }

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
    career: account.career ?? null,
    skills: account.skills ?? null,
    notes: account.notes ?? null,
    hasPassword: account.password !== null,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  }
}

/** 목업도 서버처럼 한 박자 늦게 답한다 — 받는 중 표시를 거치는 길이 같아지게 */
export const later = <T>(fn: () => T) => Promise.resolve().then(fn)

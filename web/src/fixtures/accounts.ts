import type { ProjectRole, SystemRole } from '@/types/domain'

/*
 * 목업 계정 — 목업 갈래의 로그인 · 사용자 관리 · 프로젝트 멤버가 쓴다 (docs/api/auth.md).
 * 시스템 관리자 하나(관리자), 프로젝트 관리자 하나(김서연 · 한화손보 차세대), 나머지는 일반 사용자.
 * 비밀번호를 원문으로 들고 있는 것은 목업이라서다 — 서버는 argon2 해시만 둔다.
 */

export interface MockAccount {
  memberId: string
  email: string | null
  password: string | null
  systemRole: SystemRole
  career?: string | null
  skills?: string | null
  notes?: string | null
  createdAt: string
  lastLoginAt: string | null
}

export interface MockProjectGrant {
  projectId: string
  memberId: string
  role: ProjectRole
}

export const MOCK_ADMIN_PASSWORD = '1111'
// 서버 시드(server/scripts/seed.py)와 같은 값 — 목업과 서버를 오갈 때 계정을 두 벌 외우지 않게
export const MOCK_PASSWORD = MOCK_ADMIN_PASSWORD

export const accounts: MockAccount[] = [
  {
    memberId: 'u0',
    email: 'admin@inno-ax.com',
    password: MOCK_ADMIN_PASSWORD,
    systemRole: 'admin',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: '2026-10-12T00:30:00Z',
  },
  {
    memberId: 'u1',
    email: 'u1@inno-ax.com',
    password: MOCK_PASSWORD,
    systemRole: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: '2026-10-12T01:10:00Z',
  },
  {
    memberId: 'u2',
    email: 'u2@inno-ax.com',
    password: MOCK_PASSWORD,
    systemRole: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: null,
  },
  {
    memberId: 'u3',
    email: 'u3@inno-ax.com',
    password: MOCK_PASSWORD,
    systemRole: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: null,
  },
  /* 로그인이 생기기 전부터 있던 사람 — 이메일 · 비밀번호가 없어 관리자가 넣어 줘야 들어온다 */
  {
    memberId: 'u4',
    email: null,
    password: null,
    systemRole: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: null,
  },
  {
    memberId: 'u5',
    email: 'u5@inno-ax.com',
    password: MOCK_PASSWORD,
    systemRole: 'user',
    createdAt: '2026-09-01T00:00:00Z',
    lastLoginAt: '2026-09-20T02:00:00Z',
  },
]

/** 프로젝트별 부여. 경영지원 파트(p3)는 박지훈 · 이도현에게 부여하지 않았다 — 그 둘에게는 안 보인다 */
export const projectGrants: MockProjectGrant[] = [
  { projectId: 'p1', memberId: 'u1', role: 'admin' },
  { projectId: 'p1', memberId: 'u2', role: 'user' },
  { projectId: 'p1', memberId: 'u3', role: 'user' },
  { projectId: 'p1', memberId: 'u4', role: 'user' },
  { projectId: 'p2', memberId: 'u1', role: 'user' },
  { projectId: 'p2', memberId: 'u2', role: 'user' },
  { projectId: 'p2', memberId: 'u3', role: 'user' },
  { projectId: 'p2', memberId: 'u4', role: 'user' },
  { projectId: 'p3', memberId: 'u1', role: 'user' },
  { projectId: 'p3', memberId: 'u4', role: 'user' },
]

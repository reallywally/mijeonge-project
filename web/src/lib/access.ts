import type { Me, ProjectRole, TaskComment } from '@/types/domain'

/*
 * 권한 판단 — 메뉴 숨기기 · 라우터 가드 · 목업 서버가 모두 이 함수들을 쓴다 (docs/api/auth.md '권한 셋').
 * 메뉴를 숨기는 것은 편의이고 막는 것은 서버다. 판단이 갈리지 않게 한 곳에 둔다.
 */

export const isSystemAdmin = (me: Me | null) => me?.systemRole === 'admin'

export const projectRoleOf = (me: Me | null, projectId: string): ProjectRole | null =>
  me?.projectRoles[projectId] ?? null

/** 부여받지 않은 프로젝트는 없는 것처럼 다룬다. 시스템 관리자는 다 본다 */
export const canSeeProject = (me: Me | null, projectId: string) =>
  isSystemAdmin(me) || projectRoleOf(me, projectId) !== null

/** 프로젝트 멤버 부여 · 역할 변경 · 빼기, 프로젝트 이름 수정 */
export const canManageProject = (me: Me | null, projectId: string) =>
  isSystemAdmin(me) || projectRoleOf(me, projectId) === 'admin'

/** 프로젝트 등록 · 사용자 관리는 시스템 관리자만 */
export const canCreateProject = isSystemAdmin
export const canManageAccounts = isSystemAdmin

/** 댓글 고치기는 작성자만 */
export const canEditComment = (me: Me | null, comment: Pick<TaskComment, 'authorId'>) =>
  me !== null && comment.authorId === me.id

/** 댓글 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자 */
export const canDeleteComment = (
  me: Me | null,
  comment: Pick<TaskComment, 'authorId'>,
  projectId: string,
) => canEditComment(me, comment) || canManageProject(me, projectId)

/** 라우트가 요구하는 권한 — route.meta.access */
export type RouteAccess = 'systemAdmin' | 'projectAdmin'

/** 그 화면에 들어갈 수 있나. projectAdmin 은 경로의 프로젝트를 본다 */
export function canOpen(me: Me | null, access: RouteAccess | undefined, projectId = ''): boolean {
  if (!me) return false
  if (access === 'systemAdmin') return isSystemAdmin(me)
  if (access === 'projectAdmin') return canManageProject(me, projectId)
  return true
}

/** 볼 프로젝트가 하나도 없을 때 갈 곳 — 등록할 수 있는 사람만 등록 화면으로 */
export const emptyProjectsHome = (me: Me | null) =>
  canCreateProject(me) ? '/projects/new' : '/projects'

/**
 * 로그인 뒤 돌아갈 주소. 우리 앱 안의 경로만 받는다 —
 * `//evil.com` 이나 `https://…` 를 받으면 로그인 화면이 남의 사이트로 보내는 문이 된다.
 */
export function safeNext(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (value === '/login' || value.startsWith('/login?')) return '/'
  return value
}

/** 권한 셋 중 이 프로젝트에서의 나 — 시스템 관리자가 먼저다 */
export type Grade = 'systemAdmin' | 'projectAdmin' | 'user'

export function gradeOf(me: Me | null, projectId: string): Grade | null {
  if (!me) return null
  if (isSystemAdmin(me)) return 'systemAdmin'
  const role = projectRoleOf(me, projectId)
  if (role === 'admin') return 'projectAdmin'
  return 'user'
}

export const GRADE_LABEL: Record<Grade, string> = {
  systemAdmin: '시스템 관리자',
  projectAdmin: '프로젝트 관리자',
  user: '일반 사용자',
}

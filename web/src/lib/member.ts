import type { Member, ProjectMember, ProjectRole, SystemRole } from '@/types/domain'

/** 이름을 찍는 자리 — 비활성 멤버도 이름은 남기되 표시를 단다 */
export const memberLabel = (member: Member) =>
  member.active ? member.name : `${member.name} (비활성)`

/**
 * 담당자로 고를 수 있는 사람 — 그 프로젝트에 부여된 활성 멤버만 (docs/api/auth.md).
 * 순서는 멤버 목록의 순서를 따른다.
 */
export function assignableMembers(members: Member[], projectMembers: ProjectMember[]): Member[] {
  const granted = new Set(projectMembers.map((p) => p.memberId))
  return members.filter((m) => m.active && granted.has(m.id))
}

export const SYSTEM_ROLE_OPTIONS: { value: SystemRole; label: string }[] = [
  { value: 'user', label: '일반 사용자' },
  { value: 'admin', label: '시스템 관리자' },
]

export const PROJECT_ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: 'user', label: '일반 사용자' },
  { value: 'admin', label: '프로젝트 관리자' },
]

export const systemRoleLabel = (role: SystemRole) =>
  SYSTEM_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role

export const projectRoleLabel = (role: ProjectRole) =>
  PROJECT_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role

/** 비밀번호 규칙 — 10자 이상 · 200자 이하. 그 밖의 조합 규칙은 두지 않는다 */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`
  if (password.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 합니다.`
  return null
}

/** 로그인 이메일은 소문자로 저장된다 — 서버와 같은 꼴로 견준다 */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** 화면에서 먼저 거르는 정도의 모양 검사. 진짜 판정은 서버가 한다 */
export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

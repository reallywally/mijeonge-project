import type { Member, MemberAccount, ProjectMember, ProjectRole, SystemRole } from '@/types/domain'

/** 이름을 찍는 자리 — 비활성 멤버도 이름은 남기되 표시를 단다 */
export const memberLabel = (member: Member) =>
  member.active ? member.name : `${member.name} (비활성)`

/** 관리 화면에서 사람을 부르는 이름 — 관리자끼리 '5번' 으로 말한다 */
export const accountLabel = (account: Pick<MemberAccount, 'no' | 'name'>) =>
  `${account.no}번 · ${account.name}`

/** 사용자 관리 표의 순서 — 번호 오름차순(서버는 이름 순으로 준다) */
export const byMemberNo = (a: Pick<MemberAccount, 'no'>, b: Pick<MemberAccount, 'no'>) =>
  a.no - b.no

/**
 * 담당자로 고를 수 있는 사람 — 그 프로젝트에 부여된 활성 멤버만 (docs/api/auth.md).
 * 순서는 멤버 목록의 순서를 따른다.
 */
export function assignableMembers(members: Member[], projectMembers: ProjectMember[]): Member[] {
  const granted = new Set(projectMembers.map((p) => p.memberId))
  return members.filter((m) => m.active && granted.has(m.id))
}

/**
 * 사람 찾기 — 이름(있으면 이메일도)에 적은 말이 들어 있는지. 대소문자는 가리지 않고, 한글은 그대로 견준다.
 * 빈 말이면 모두 맞는다
 */
export function matchMember(member: Pick<Member, 'name'> & { email?: string }, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [member.name, member.email ?? ''].some((s) => s.toLowerCase().includes(q))
}

/** 참조(ccIds) — 겹친 id 는 앞의 하나만, 고른 순서 그대로 (docs/api/cc.md) */
export const uniqueIds = (ids: string[]) => [...new Set(ids)]

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

/** 마이페이지의 '내 프로젝트' — 내 쪽에서 부르는 짧은 말 */
export const myProjectRoleLabel = (role: ProjectRole) => (role === 'admin' ? '관리자' : '멤버')

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

/** 경력 · 기술 스펙 · 기타 사항 — 서버와 같은 길이 (docs/api/auth.md) */
export const PROFILE_TEXT_MAX = 2000

export const PROFILE_FIELDS = [
  { key: 'career', label: '경력', placeholder: '예: 보험 차세대 시스템 7년, PL 경험' },
  { key: 'skills', label: '기술 스펙', placeholder: '예: Java, Spring Boot, Oracle, Vue' },
  { key: 'notes', label: '기타 사항', placeholder: '예: 10월 말까지 반차 많음' },
] as const

export type ProfileField = (typeof PROFILE_FIELDS)[number]['key']

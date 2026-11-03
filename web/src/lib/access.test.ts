import { describe, expect, it } from 'vitest'
import {
  adminHome,
  canCreateProject,
  canDeleteComment,
  canDeleteTask,
  canDeleteThread,
  canEditComment,
  canEditEntry,
  canEditTask,
  canEditThread,
  canManageAccounts,
  canManageProject,
  canOpen,
  canOpenAdmin,
  canSeeProject,
  emptyProjectsHome,
  gradeOf,
  safeNext,
} from '@/lib/access'
import { assignableMembers, memberLabel, passwordProblem } from '@/lib/member'
import type { Me } from '@/types/domain'

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u2',
  name: '박지훈',
  email: 'u2@inno-ax.com',
  systemRole: 'user',
  projectRoles: { p1: 'user' },
  ...over,
})

const systemAdmin = me({ id: 'u0', systemRole: 'admin', projectRoles: {} })
const projectAdmin = me({ id: 'u1', projectRoles: { p1: 'admin', p2: 'user' } })
const user = me()

describe('권한 셋', () => {
  it('부여받지 않은 프로젝트는 안 보인다 — 시스템 관리자는 부여 없이도 다 본다', () => {
    expect(canSeeProject(user, 'p1')).toBe(true)
    expect(canSeeProject(user, 'p3')).toBe(false)
    expect(canSeeProject(systemAdmin, 'p3')).toBe(true)
    expect(canSeeProject(null, 'p1')).toBe(false)
  })

  it('프로젝트 관리는 그 프로젝트의 관리자와 시스템 관리자만', () => {
    expect(canManageProject(projectAdmin, 'p1')).toBe(true)
    expect(canManageProject(projectAdmin, 'p2')).toBe(false)
    expect(canManageProject(user, 'p1')).toBe(false)
    expect(canManageProject(systemAdmin, 'p9')).toBe(true)
  })

  it('프로젝트 등록 · 사용자 관리는 시스템 관리자만', () => {
    expect(canCreateProject(systemAdmin)).toBe(true)
    expect(canCreateProject(projectAdmin)).toBe(false)
    expect(canManageAccounts(systemAdmin)).toBe(true)
    expect(canManageAccounts(user)).toBe(false)
    expect(canManageAccounts(null)).toBe(false)
  })

  it('댓글 고치기는 작성자만, 지우기는 작성자 · 프로젝트 관리자 · 시스템 관리자', () => {
    const mine = { authorId: 'u2' }
    const theirs = { authorId: 'u3' }
    expect(canEditComment(user, mine)).toBe(true)
    expect(canEditComment(user, theirs)).toBe(false)
    expect(canEditComment(projectAdmin, theirs)).toBe(false)
    expect(canEditComment(systemAdmin, theirs)).toBe(false)

    expect(canDeleteComment(user, mine, 'p1')).toBe(true)
    expect(canDeleteComment(user, theirs, 'p1')).toBe(false)
    expect(canDeleteComment(projectAdmin, theirs, 'p1')).toBe(true)
    expect(canDeleteComment(projectAdmin, theirs, 'p2')).toBe(false)
    expect(canDeleteComment(systemAdmin, theirs, 'p3')).toBe(true)
    expect(canDeleteComment(null, { authorId: null }, 'p1')).toBe(false)
  })

  it('이 프로젝트에서의 나 — 시스템 관리자가 먼저다', () => {
    expect(gradeOf(systemAdmin, 'p1')).toBe('systemAdmin')
    expect(gradeOf(projectAdmin, 'p1')).toBe('projectAdmin')
    expect(gradeOf(projectAdmin, 'p2')).toBe('user')
    expect(gradeOf(null, 'p1')).toBeNull()
  })
})

describe('작업 고치기 · 지우기', () => {
  const task = (creatorId: string | null, ownerId: string | null) => ({ creatorId, ownerId })
  const other = me({ id: 'u4' })

  it('고치기는 등록한 사람 · 담당자 · 그 프로젝트 관리자 · 시스템 관리자', () => {
    expect(canEditTask(user, task('u2', 'u3'), 'p1')).toBe(true)
    expect(canEditTask(user, task('u3', 'u2'), 'p1')).toBe(true)
    expect(canEditTask(other, task('u2', 'u3'), 'p1')).toBe(false)
    expect(canEditTask(projectAdmin, task('u2', 'u3'), 'p1')).toBe(true)
    /* p2 에서는 일반 사용자다 */
    expect(canEditTask(projectAdmin, task('u2', 'u3'), 'p2')).toBe(false)
    expect(canEditTask(systemAdmin, task(null, null), 'p9')).toBe(true)
    expect(canEditTask(null, task('u2', 'u2'), 'p1')).toBe(false)
  })

  it('등록한 사람을 모르는(null) 옛 작업은 담당자 · 관리자만 고친다', () => {
    expect(canEditTask(user, task(null, null), 'p1')).toBe(false)
    expect(canEditTask(user, task(null, 'u2'), 'p1')).toBe(true)
  })

  it('지우기는 등록한 사람 · 그 프로젝트 관리자 · 시스템 관리자 — 담당자는 못 지운다', () => {
    expect(canDeleteTask(user, task('u2', 'u3'), 'p1')).toBe(true)
    expect(canDeleteTask(user, task('u3', 'u2'), 'p1')).toBe(false)
    expect(canDeleteTask(user, task(null, 'u2'), 'p1')).toBe(false)
    expect(canDeleteTask(projectAdmin, task('u2', 'u3'), 'p1')).toBe(true)
    expect(canDeleteTask(projectAdmin, task('u2', 'u3'), 'p2')).toBe(false)
    expect(canDeleteTask(systemAdmin, task(null, null), 'p9')).toBe(true)
    expect(canDeleteTask(null, task(null, null), 'p1')).toBe(false)
  })
})

describe('안건 · 이력 줄 고치기 · 지우기', () => {
  const thread = (creatorId: string | null, ownerId: string | null) => ({ creatorId, ownerId })
  const entry = (creatorId: string | null) => ({ creatorId })
  const other = me({ id: 'u4' })

  it('안건 고치기 · 지우기는 등록한 사람 · 담당자 · 그 프로젝트 관리자 · 시스템 관리자 — 담당자도 지운다', () => {
    for (const can of [canEditThread, canDeleteThread]) {
      expect(can(user, thread('u2', 'u3'), 'p1')).toBe(true)
      expect(can(user, thread('u3', 'u2'), 'p1')).toBe(true)
      expect(can(other, thread('u2', 'u3'), 'p1')).toBe(false)
      expect(can(projectAdmin, thread('u2', 'u3'), 'p1')).toBe(true)
      expect(can(projectAdmin, thread('u2', 'u3'), 'p2')).toBe(false)
      expect(can(systemAdmin, thread(null, null), 'p9')).toBe(true)
      expect(can(null, thread('u2', 'u2'), 'p1')).toBe(false)
      /* 등록한 사람을 모르는 옛 안건 */
      expect(can(user, thread(null, null), 'p1')).toBe(false)
    }
  })

  it('이력 줄은 그 줄을 남긴 사람에 안건을 고칠 수 있는 사람까지', () => {
    expect(canEditEntry(user, entry('u2'), thread('u3', 'u3'), 'p1')).toBe(true)
    expect(canEditEntry(user, entry('u3'), thread('u2', null), 'p1')).toBe(true)
    expect(canEditEntry(user, entry('u3'), thread(null, 'u2'), 'p1')).toBe(true)
    expect(canEditEntry(user, entry('u3'), thread('u3', 'u3'), 'p1')).toBe(false)
    expect(canEditEntry(user, entry(null), thread(null, null), 'p1')).toBe(false)
    expect(canEditEntry(projectAdmin, entry('u3'), thread('u3', 'u3'), 'p1')).toBe(true)
    expect(canEditEntry(projectAdmin, entry('u3'), thread('u3', 'u3'), 'p2')).toBe(false)
    expect(canEditEntry(systemAdmin, entry(null), thread(null, null), 'p9')).toBe(true)
    expect(canEditEntry(null, entry('u2'), thread('u2', 'u2'), 'p1')).toBe(false)
  })
})

describe('라우터 가드의 판단', () => {
  it('권한이 없는 화면은 로그인한 누구나 연다', () => {
    expect(canOpen(user, undefined)).toBe(true)
    expect(canOpen(null, undefined)).toBe(false)
  })

  it('사용자 관리는 시스템 관리자만, 프로젝트 멤버는 경로의 프로젝트를 본다', () => {
    expect(canOpen(systemAdmin, 'systemAdmin')).toBe(true)
    expect(canOpen(projectAdmin, 'systemAdmin')).toBe(false)
    expect(canOpen(projectAdmin, 'projectAdmin', 'p1')).toBe(true)
    expect(canOpen(projectAdmin, 'projectAdmin', 'p2')).toBe(false)
    expect(canOpen(user, 'projectAdmin', 'p1')).toBe(false)
    expect(canOpen(systemAdmin, 'projectAdmin', 'p3')).toBe(true)
  })

  it('볼 프로젝트가 없을 때 — 시스템 관리자만 등록 화면으로', () => {
    expect(emptyProjectsHome(systemAdmin)).toBe('/projects/new')
    expect(emptyProjectsHome(user)).toBe('/projects')
  })

  it('로그인 뒤 돌아갈 곳은 앱 안의 경로만 받는다', () => {
    expect(safeNext('/tasks/k4?view=board')).toBe('/tasks/k4?view=board')
    expect(safeNext(['/threads'])).toBe('/threads')
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext('/login?next=/tasks')).toBe('/')
  })
})

describe('관리자 페이지', () => {
  it('시스템 관리자나 어느 프로젝트든 관리자면 들어간다', () => {
    expect(canOpenAdmin(systemAdmin)).toBe(true)
    expect(canOpenAdmin(projectAdmin)).toBe(true)
    expect(canOpenAdmin(user)).toBe(false)
    expect(canOpenAdmin(null)).toBe(false)
  })

  it('/admin 첫 화면 — 지금 프로젝트 관리 > 사용자 관리 > 다른 프로젝트 관리 > 업무 화면', () => {
    expect(adminHome(projectAdmin, 'p1', ['p1', 'p2'])).toBe('/admin/projects/p1/settings')
    expect(adminHome(systemAdmin, 'p2', ['p1', 'p2'])).toBe('/admin/projects/p2/settings')
    expect(adminHome(systemAdmin, '', [])).toBe('/admin/members')
    expect(adminHome(projectAdmin, 'p2', ['p1', 'p2'])).toBe('/admin/projects/p1/settings')
    expect(adminHome(user, 'p1', ['p1'])).toBe('/tasks')
  })
})

describe('멤버', () => {
  const members = [
    { id: 'u1', name: '김서연', active: true },
    { id: 'u2', name: '박지훈', active: true },
    { id: 'u5', name: '한예린', active: false },
  ]

  it('담당자 후보는 그 프로젝트에 부여된 활성 멤버만', () => {
    const granted = [
      { memberId: 'u2', role: 'user' as const },
      { memberId: 'u5', role: 'user' as const },
    ]
    expect(assignableMembers(members, granted).map((m) => m.id)).toEqual(['u2'])
    expect(assignableMembers(members, [])).toEqual([])
  })

  it("비활성 멤버의 이름에는 '(비활성)' 이 붙는다", () => {
    expect(memberLabel(members[0])).toBe('김서연')
    expect(memberLabel(members[2])).toBe('한예린 (비활성)')
  })

  it('비밀번호는 10자 이상 200자 이하', () => {
    expect(passwordProblem('123456789')).not.toBeNull()
    expect(passwordProblem('1234567890')).toBeNull()
    expect(passwordProblem('x'.repeat(201))).not.toBeNull()
  })
})

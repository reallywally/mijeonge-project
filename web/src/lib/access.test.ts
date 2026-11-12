import { describe, expect, it } from 'vitest'
import {
  adminHome,
  canCreateProject,
  canDeleteComment,
  canCreateInPart,
  canDeleteTask,
  canDeleteTest,
  canDeleteAgenda,
  canEditComment,
  canEditTask,
  canEditTest,
  canEditAgenda,
  canManageAccounts,
  canManageProject,
  canMoveToPart,
  canOpen,
  canOpenAdmin,
  canSeeProject,
  emptyProjectsHome,
  gradeOf,
  normalizePartRights,
  safeNext,
} from '@/lib/access'
import { togglePartRight } from '@/lib/part'
import { assignableMembers, memberLabel, passwordProblem } from '@/lib/member'
import type { Me, PartMember, PartRights } from '@/types/domain'

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u2',
  name: '박지훈',
  email: 'u2@inno-ax.com',
  systemRole: 'user',
  projectRoles: { p1: 'user' },
  avatarUrl: null,
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

describe('작업 고치기 · 지우기 — 공통 작업', () => {
  const task = (creatorId: string | null, ownerId: string | null) => ({
    creatorId,
    ownerId,
    partId: null,
  })
  const other = me({ id: 'u4' })
  const none: PartMember[] = []

  it('고치기는 등록한 사람 · 담당자 · 그 프로젝트 관리자 · 시스템 관리자', () => {
    expect(canEditTask(user, task('u2', 'u3'), 'p1', none)).toBe(true)
    expect(canEditTask(user, task('u3', 'u2'), 'p1', none)).toBe(true)
    expect(canEditTask(other, task('u2', 'u3'), 'p1', none)).toBe(false)
    expect(canEditTask(projectAdmin, task('u2', 'u3'), 'p1', none)).toBe(true)
    /* p2 에서는 일반 사용자다 */
    expect(canEditTask(projectAdmin, task('u2', 'u3'), 'p2', none)).toBe(false)
    expect(canEditTask(systemAdmin, task(null, null), 'p9', none)).toBe(true)
    expect(canEditTask(null, task('u2', 'u2'), 'p1', none)).toBe(false)
  })

  it('등록한 사람을 모르는(null) 옛 작업은 담당자 · 관리자만 고친다', () => {
    expect(canEditTask(user, task(null, null), 'p1', none)).toBe(false)
    expect(canEditTask(user, task(null, 'u2'), 'p1', none)).toBe(true)
  })

  it('지우기는 등록한 사람 · 그 프로젝트 관리자 · 시스템 관리자 — 담당자는 못 지운다', () => {
    expect(canDeleteTask(user, task('u2', 'u3'), 'p1', none)).toBe(true)
    expect(canDeleteTask(user, task('u3', 'u2'), 'p1', none)).toBe(false)
    expect(canDeleteTask(user, task(null, 'u2'), 'p1', none)).toBe(false)
    expect(canDeleteTask(projectAdmin, task('u2', 'u3'), 'p1', none)).toBe(true)
    expect(canDeleteTask(projectAdmin, task('u2', 'u3'), 'p2', none)).toBe(false)
    expect(canDeleteTask(systemAdmin, task(null, null), 'p9', none)).toBe(true)
    expect(canDeleteTask(null, task(null, null), 'p1', none)).toBe(false)
  })
})

describe('파트 권한 — 파트 작업 · 테스트', () => {
  const rights = (over: Partial<PartRights> = {}): PartRights => ({
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    ...over,
  })
  /* u2 는 pt1 에 보기만, pt2 에 넷 다 */
  const pms: PartMember[] = [
    { partId: 'pt1', memberId: 'u2', ...rights() },
    {
      partId: 'pt2',
      memberId: 'u2',
      ...rights({ canCreate: true, canUpdate: true, canDelete: true }),
    },
  ]
  const task = (
    partId: string,
    creatorId: string | null = 'u2',
    ownerId: string | null = null,
  ) => ({
    creatorId,
    ownerId,
    partId,
  })

  it('등록 — 공통은 누구나, 파트는 그 파트의 등록 권한 · 관리자', () => {
    expect(canCreateInPart(user, null, 'p1', [])).toBe(true)
    expect(canCreateInPart(user, 'pt1', 'p1', pms)).toBe(false)
    expect(canCreateInPart(user, 'pt2', 'p1', pms)).toBe(true)
    /* 소속이 아닌 파트 */
    expect(canCreateInPart(user, 'pt3', 'p1', pms)).toBe(false)
    expect(canCreateInPart(projectAdmin, 'pt3', 'p1', [])).toBe(true)
    expect(canCreateInPart(systemAdmin, 'pt3', 'p9', [])).toBe(true)
    expect(canCreateInPart(null, null, 'p1', [])).toBe(false)
  })

  it('작업 고치기 — 등록한 사람이어도 파트의 수정 권한이 없으면 못 고친다. 담당자 · 관리자는 고친다', () => {
    expect(canEditTask(user, task('pt1'), 'p1', pms)).toBe(false)
    expect(canEditTask(user, task('pt1', 'u9', 'u2'), 'p1', pms)).toBe(true)
    expect(canEditTask(user, task('pt2', 'u9'), 'p1', pms)).toBe(true)
    expect(canEditTask(projectAdmin, task('pt1', 'u9'), 'p1', [])).toBe(true)
  })

  it('작업 지우기 — 파트의 삭제 권한 · 관리자만. 등록한 사람 · 담당자라도 권한이 없으면 못 지운다', () => {
    expect(canDeleteTask(user, task('pt1', 'u2', 'u2'), 'p1', pms)).toBe(false)
    expect(canDeleteTask(user, task('pt2', 'u9'), 'p1', pms)).toBe(true)
    expect(canDeleteTask(projectAdmin, task('pt1', 'u9'), 'p1', [])).toBe(true)
  })

  it('다른 파트로 옮기기 — 옮겨 갈 파트의 수정 권한. 공통으로는 누구나', () => {
    expect(canMoveToPart(user, null, 'p1', [])).toBe(true)
    expect(canMoveToPart(user, 'pt1', 'p1', pms)).toBe(false)
    expect(canMoveToPart(user, 'pt2', 'p1', pms)).toBe(true)
    expect(canMoveToPart(projectAdmin, 'pt1', 'p1', [])).toBe(true)
  })

  it('테스트 — 공통은 프로젝트 멤버 누구나 고치고, 지우기는 만든 사람 · 관리자', () => {
    const common = { ownerId: null, partId: null, createdBy: 'u9' }
    expect(canEditTest(user, common, 'p1', [])).toBe(true)
    expect(canEditTest(user, common, 'p3', [])).toBe(false)
    expect(canDeleteTest(user, common, 'p1', [])).toBe(false)
    expect(canDeleteTest(user, { ...common, createdBy: 'u2' }, 'p1', [])).toBe(true)
    expect(canDeleteTest(projectAdmin, common, 'p1', [])).toBe(true)
  })

  it('테스트 — 파트는 담당자 · 관리자 · 수정 권한이 고치고, 삭제 권한 · 관리자가 지운다', () => {
    const t = (partId: string, ownerId: string | null = null) => ({
      ownerId,
      partId,
      createdBy: 'u2',
    })
    expect(canEditTest(user, t('pt1'), 'p1', pms)).toBe(false)
    expect(canEditTest(user, t('pt1', 'u2'), 'p1', pms)).toBe(true)
    expect(canEditTest(user, t('pt2'), 'p1', pms)).toBe(true)
    expect(canEditTest(projectAdmin, t('pt1'), 'p1', [])).toBe(true)
    expect(canDeleteTest(user, t('pt1', 'u2'), 'p1', pms)).toBe(false)
    expect(canDeleteTest(user, t('pt2'), 'p1', pms)).toBe(true)
  })

  it('맞추기 — 삭제 ⇒ 수정, 등록 · 수정 ⇒ 보기', () => {
    const off = rights({ canView: false })
    expect(normalizePartRights({ ...off, canDelete: true })).toEqual({
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: true,
    })
    expect(normalizePartRights({ ...off, canCreate: true }).canView).toBe(true)
    expect(normalizePartRights(off)).toEqual(off)
  })

  it('칸 하나 켜고 끄기 — 켜면 앞선 것도 켜고, 보기를 끄면 다, 수정을 끄면 삭제도 끈다', () => {
    const off = rights({ canView: false })
    const all = rights({ canCreate: true, canUpdate: true, canDelete: true })
    expect(togglePartRight(off, 'canDelete', true)).toEqual({
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: true,
    })
    expect(togglePartRight(off, 'canCreate', true)).toEqual(rights({ canCreate: true }))
    expect(togglePartRight(all, 'canView', false)).toEqual(off)
    expect(togglePartRight(all, 'canUpdate', false)).toEqual(rights({ canCreate: true }))
    expect(togglePartRight(all, 'canCreate', false)).toEqual(
      rights({ canUpdate: true, canDelete: true }),
    )
    /* 화면이 보내는 넷은 서버가 다시 맞춰도 그대로다 */
    for (const r of ['canView', 'canCreate', 'canUpdate', 'canDelete'] as const)
      for (const on of [true, false]) {
        const next = togglePartRight(all, r, on)
        expect(normalizePartRights(next)).toEqual(next)
      }
  })
})

describe('안건 고치기 · 지우기', () => {
  const agenda = (creatorId: string | null, ownerId: string | null) => ({ creatorId, ownerId })
  const other = me({ id: 'u4' })

  it('안건 고치기 · 지우기는 등록한 사람 · 담당자 · 그 프로젝트 관리자 · 시스템 관리자 — 담당자도 지운다', () => {
    for (const can of [canEditAgenda, canDeleteAgenda]) {
      expect(can(user, agenda('u2', 'u3'), 'p1')).toBe(true)
      expect(can(user, agenda('u3', 'u2'), 'p1')).toBe(true)
      expect(can(other, agenda('u2', 'u3'), 'p1')).toBe(false)
      expect(can(projectAdmin, agenda('u2', 'u3'), 'p1')).toBe(true)
      expect(can(projectAdmin, agenda('u2', 'u3'), 'p2')).toBe(false)
      expect(can(systemAdmin, agenda(null, null), 'p9')).toBe(true)
      expect(can(null, agenda('u2', 'u2'), 'p1')).toBe(false)
      /* 등록한 사람을 모르는 옛 안건 */
      expect(can(user, agenda(null, null), 'p1')).toBe(false)
    }
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
    expect(safeNext(['/agendas'])).toBe('/agendas')
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
    { id: 'u1', name: '김서연', active: true, avatarUrl: null },
    { id: 'u2', name: '박지훈', active: true, avatarUrl: null },
    { id: 'u5', name: '한예린', active: false, avatarUrl: null },
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

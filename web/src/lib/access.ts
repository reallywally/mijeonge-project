import type {
  Agenda,
  Me,
  PartMember,
  PartRights,
  ProjectRole,
  Task,
  TaskComment,
  TestCase,
} from '@/types/domain'

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

/** 댓글 고치기는 작성자만. 회의록도 같은 경계다 (docs/api/minutes.md) */
export const canEditComment = (me: Me | null, comment: Pick<TaskComment, 'authorId'>) =>
  me !== null && comment.authorId === me.id

/** 댓글 지우기는 작성자 · 그 프로젝트 관리자 · 시스템 관리자. 회의록도 같은 경계다 */
export const canDeleteComment = (
  me: Me | null,
  comment: Pick<TaskComment, 'authorId'>,
  projectId: string,
) => canEditComment(me, comment) || canManageProject(me, projectId)

/* 파트 권한 (2026-11-12, docs/api/part.md) — 파트는 보기를 가리지 않는다. 소속마다 붙은 보기 · 등록 · 수정 · 삭제가
   그 파트의 작업 · 테스트 쓰기만 가른다. 안건은 따르지 않는다. 그 프로젝트 관리자 · 시스템 관리자는 늘 된다 */

export type PartRight = keyof PartRights

/** 내 소속(그 파트)의 그 권한 — 소속이 아니면 없다 */
export const hasPartRight = (
  me: Me | null,
  partMembers: readonly PartMember[],
  partId: string,
  right: PartRight,
) =>
  me !== null &&
  partMembers.some((pm) => pm.partId === partId && pm.memberId === me.id && pm[right])

/** 그 파트에 작업 · 테스트를 새로 둘 수 있나 — 공통(null)은 누구나 */
export const canCreateInPart = (
  me: Me | null,
  partId: string | null,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (partId === null ||
    canManageProject(me, projectId) ||
    hasPartRight(me, partMembers, partId, 'canCreate'))

/** 작업 · 테스트의 파트를 그 파트로 옮길 수 있나 — 공통(null)으로는 누구나. 원래 레코드를 고칠 권한은 따로 본다 */
export const canMoveToPart = (
  me: Me | null,
  partId: string | null,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (partId === null ||
    canManageProject(me, projectId) ||
    hasPartRight(me, partMembers, partId, 'canUpdate'))

/** 파트 소속에 다는 권한 — 지우기 ⇒ 수정, 등록 · 수정 ⇒ 보기. 서버도 같은 순서로 맞춘다 */
export function normalizePartRights(r: PartRights): PartRights {
  const canDelete = r.canDelete
  const canUpdate = r.canUpdate || canDelete
  const canCreate = r.canCreate
  return { canView: r.canView || canCreate || canUpdate, canCreate, canUpdate, canDelete }
}

/** 새 소속의 기본 — 보기 · 등록 · 수정, 지우기는 따로 준다 */
export const DEFAULT_PART_RIGHTS: PartRights = {
  canView: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}

/** 작업 고치기(속성 · 본문 · 체크박스 · 안건 연결). 공통 작업은 등록한 사람 · 담당자 · 관리자,
    파트 작업은 담당자 · 관리자 · 그 파트의 수정 권한. 댓글 · 확인 요청은 이 경계를 따르지 않는다 */
export const canEditTask = (
  me: Me | null,
  task: Pick<Task, 'creatorId' | 'ownerId' | 'partId'>,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (task.ownerId === me.id ||
    canManageProject(me, projectId) ||
    (task.partId === null
      ? task.creatorId === me.id
      : hasPartRight(me, partMembers, task.partId, 'canUpdate')))

/** 작업 지우기. 공통 작업은 등록한 사람 · 관리자(담당자는 못 지운다), 파트 작업은 관리자 · 그 파트의 삭제 권한 */
export const canDeleteTask = (
  me: Me | null,
  task: Pick<Task, 'creatorId' | 'partId'>,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (canManageProject(me, projectId) ||
    (task.partId === null
      ? task.creatorId === me.id
      : hasPartRight(me, partMembers, task.partId, 'canDelete')))

/** 테스트 고치기(속성 · 상태 · 태그 · 기준). 공통 테스트는 프로젝트 멤버 누구나,
    파트 테스트는 담당자 · 관리자 · 그 파트의 수정 권한. 조치 내역(댓글)은 따르지 않는다 */
export const canEditTest = (
  me: Me | null,
  test: Pick<TestCase, 'ownerId' | 'partId'>,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  canSeeProject(me, projectId) &&
  (test.partId === null ||
    test.ownerId === me.id ||
    canManageProject(me, projectId) ||
    hasPartRight(me, partMembers, test.partId, 'canUpdate'))

/** 테스트 지우기. 공통 테스트는 만든 사람 · 관리자, 파트 테스트는 관리자 · 그 파트의 삭제 권한 */
export const canDeleteTest = (
  me: Me | null,
  test: Pick<TestCase, 'createdBy' | 'partId'>,
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (canManageProject(me, projectId) ||
    (test.partId === null
      ? test.createdBy === me.id
      : hasPartRight(me, partMembers, test.partId, 'canDelete')))

/* 문서 (docs/api/document.md '권한') — 작업 · 테스트의 파트 권한을 그대로 쓴다. 공통 문서는 멤버 누구나 고치고,
   파트 문서는 관리자 · 만든 사람 · 그 파트 수정 권한. 만들기는 등록 권한(canCreateInPart), 옮기기는 canMoveToPart */

/** 문서 고치기(제목 · 본문 · 표 · 연결 · 확인 · 파트) */
export const canEditDoc = (
  me: Me | null,
  doc: { partId: string | null; createdBy: string | null },
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  canSeeProject(me, projectId) &&
  (doc.partId === null ||
    doc.createdBy === me.id ||
    canManageProject(me, projectId) ||
    hasPartRight(me, partMembers, doc.partId, 'canUpdate'))

/** 문서 지우기 — 관리자 · 만든 사람, 파트 문서는 그 파트 삭제 권한도 */
export const canDeleteDoc = (
  me: Me | null,
  doc: { partId: string | null; createdBy: string | null },
  projectId: string,
  partMembers: readonly PartMember[],
) =>
  me !== null &&
  (canManageProject(me, projectId) ||
    doc.createdBy === me.id ||
    (doc.partId !== null && hasPartRight(me, partMembers, doc.partId, 'canDelete')))

/** 문서 폴더 지우기(빈 폴더만) — 관리자 · 만든 사람. 만들기 · 이름 바꾸기 · 옮기기는 프로젝트 멤버 누구나 */
export const canDeleteDocFolder = (
  me: Me | null,
  folder: { createdBy: string | null },
  projectId: string,
) =>
  me !== null &&
  canSeeProject(me, projectId) &&
  (canManageProject(me, projectId) || folder.createdBy === me.id)

/** 안건 고치기(제목 · 설명 · 결정내용 · 상태 · 기한 · 담당자 · 파트)는 등록한 사람 · 담당자 · 그 프로젝트 관리자 ·
    시스템 관리자 — 결정내용 · 상태도 같은 PATCH 라 같은 넷만 바꾼다 (docs/api/agenda.md) */
export const canEditAgenda = (
  me: Me | null,
  agenda: Pick<Agenda, 'creatorId' | 'ownerId'>,
  projectId: string,
) =>
  me !== null &&
  (agenda.creatorId === me.id || agenda.ownerId === me.id || canManageProject(me, projectId))

/** 안건 지우기는 고치기와 같은 경계 — 작업과 달리 담당자도 지운다 */
export const canDeleteAgenda = canEditAgenda

/** 라우트가 요구하는 권한 — route.meta.access */
export type RouteAccess = 'systemAdmin' | 'projectAdmin'

/** 그 화면에 들어갈 수 있나. projectAdmin 은 경로의 프로젝트를 본다 */
export function canOpen(me: Me | null, access: RouteAccess | undefined, projectId = ''): boolean {
  if (!me) return false
  if (access === 'systemAdmin') return isSystemAdmin(me)
  if (access === 'projectAdmin') return canManageProject(me, projectId)
  return true
}

/** 관리자 페이지(/admin)에 들어갈 수 있나 — 시스템 관리자이거나 어느 프로젝트든 관리자 */
export const canOpenAdmin = (me: Me | null) =>
  isSystemAdmin(me) || Object.values(me?.projectRoles ?? {}).includes('admin')

/** 관리 화면 주소 — 프로젝트 관리 · 파트 관리 · 사용자 관리 */
export const projectSettingsPath = (projectId: string) => `/admin/projects/${projectId}/settings`
export const projectPartsPath = (projectId: string) => `/admin/projects/${projectId}/parts`
export const ADMIN_MEMBERS_PATH = '/admin/members'

/**
 * /admin 으로 들어왔을 때 갈 첫 관리 화면 — 지금 프로젝트를 관리할 수 있으면 그 프로젝트 관리,
 * 아니면 사용자 관리(시스템 관리자), 아니면 관리할 수 있는 다른 프로젝트, 다 아니면 업무 화면
 */
export function adminHome(me: Me | null, currentProjectId: string, projectIds: string[]): string {
  if (currentProjectId && canManageProject(me, currentProjectId))
    return projectSettingsPath(currentProjectId)
  if (canManageAccounts(me)) return ADMIN_MEMBERS_PATH
  const other = projectIds.find((id) => canManageProject(me, id))
  return other ? projectSettingsPath(other) : '/tasks'
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

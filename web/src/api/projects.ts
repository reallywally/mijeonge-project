import { id, mockError, request } from '@/api/client'
import {
  forbidden,
  later,
  memberOf,
  mockDb,
  requireManager,
  requireMe,
  requireProject,
} from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canCreateProject, canSeeProject, isSystemAdmin } from '@/lib/access'
import { nowIso } from '@/lib/date'
import {
  PROJECT_DESCRIPTION_MAX,
  TASK_KEY_PREFIX_RE,
  makeTaskKeyPrefix,
  orderProjects,
  projectDateRangeError,
} from '@/lib/project'
import type {
  Entry,
  Member,
  Part,
  PartMember,
  Project,
  ProjectInput,
  ProjectMember,
  ProjectPatch,
  ProjectRole,
  ProjectSnapshot,
  Task,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

/* 프로젝트 목록 · 등록 · 수정 · 삭제의 목업 갈래 — 서버처럼 권한 · 검증 · 소프트 삭제를 본다 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const invalid = (field: string, message: string) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', { [field]: message })

/** 설명 · 날짜 칸을 서버처럼 본다. 보낸 것만 본다 */
function checkFields(input: Pick<ProjectPatch, 'description' | 'startDate' | 'endDate'>) {
  if (typeof input.description === 'string' && input.description.length > PROJECT_DESCRIPTION_MAX)
    throw invalid('description', `설명은 ${PROJECT_DESCRIPTION_MAX}자 이하로 적어 주세요.`)
  for (const key of ['startDate', 'endDate'] as const) {
    const value = input[key]
    if (value !== undefined && value !== null && !DAY_RE.test(value))
      throw invalid(key, '날짜는 YYYY-MM-DD 로 적어 주세요.')
  }
}

function checkRange(startDate: string | null, endDate: string | null) {
  const problem = projectDateRangeError(startDate ?? '', endDate ?? '')
  if (problem) throw mockError(400, 'PROJECT_DATE_RANGE', problem)
}

const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null || value.trim() === '' ? null : value

const isDeleted = (projectId: string) => mockDb().deletedProjectIds.includes(projectId)

const mockProjects = {
  list(): Project[] {
    const me = requireMe()
    return structuredClone(
      orderProjects(mockDb().projects.filter((p) => !isDeleted(p.id) && canSeeProject(me, p.id))),
    )
  },
  create(input: ProjectInput): Project {
    const me = requireMe()
    if (!canCreateProject(me)) throw forbidden()
    const name = input.name.trim()
    if (!name) throw invalid('name', '이름을 적어 주세요.')
    checkFields(input)
    const startDate = blankToNull(input.startDate) ?? null
    const endDate = blankToNull(input.endDate) ?? null
    checkRange(startDate, endDate)
    const db = mockDb()
    /* 지운 프로젝트의 접두사도 쓰는 것으로 본다 — 기록에 그 키가 남아 있다 */
    const taken = db.projects.map((p) => p.taskKeyPrefix)
    const wanted = (input.taskKeyPrefix ?? '').trim().toUpperCase()
    if (wanted && !TASK_KEY_PREFIX_RE.test(wanted))
      throw invalid('taskKeyPrefix', '형식이 올바르지 않습니다.')
    if (wanted && taken.includes(wanted))
      throw mockError(409, 'PROJECT_PREFIX_TAKEN', '다른 프로젝트가 이미 쓰고 있는 접두사입니다.')
    const project: Project = {
      id: `np${db.projects.length + 1}`,
      name,
      taskKeyPrefix: wanted || makeTaskKeyPrefix(taken),
      description: blankToNull(input.description) ?? null,
      startDate,
      endDate,
      status: 'active',
      closedAt: null,
    }
    db.projects.push(project)
    return structuredClone(project)
  },
  patch(projectId: string, patch: ProjectPatch): Project {
    requireManager(projectId)
    const project = mockDb().projects.find((p) => p.id === projectId)
    if (!project) throw mockError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.')
    if (patch.name !== undefined && !patch.name.trim()) throw invalid('name', '이름을 적어 주세요.')
    checkFields(patch)
    const next: Project = { ...project }
    if (patch.name !== undefined) next.name = patch.name.trim()
    if (patch.description !== undefined) next.description = blankToNull(patch.description) ?? null
    if (patch.startDate !== undefined) next.startDate = blankToNull(patch.startDate) ?? null
    if (patch.endDate !== undefined) next.endDate = blankToNull(patch.endDate) ?? null
    /* 보낸 것과 남은 것을 합친 결과로 앞뒤를 본다 — 한쪽만 고쳐도 어긋날 수 있다 */
    checkRange(next.startDate, next.endDate)
    if (patch.status !== undefined && patch.status !== project.status) {
      next.status = patch.status
      next.closedAt = patch.status === 'closed' ? nowIso() : null
    }
    Object.assign(project, next)
    return structuredClone(next)
  },
  remove(projectId: string) {
    const me = requireMe()
    requireProject(me, projectId)
    if (!isSystemAdmin(me)) throw forbidden()
    mockDb().deletedProjectIds.push(projectId)
  },
}

/** 볼 수 있는 프로젝트 — 진행 중이 먼저다. 지운 것은 빠진다 */
export const fetchProjects = () =>
  isMockMode() ? later(() => mockProjects.list()) : request<Project[]>('GET', '/projects')

/** 비활성 멤버까지 이름을 다 낸다 — 옛 기록의 이름을 찍으려면 필요하다 */
export const fetchMembers = () =>
  isMockMode()
    ? later(() => {
        requireMe()
        return structuredClone(mockDb().members)
      })
    : request<Member[]>('GET', '/members')

/** 등록 — 시스템 관리자만. 설명 · 기간은 선택이다 */
export const createProject = (input: ProjectInput) =>
  isMockMode()
    ? later(() => mockProjects.create(input))
    : request<Project>('POST', '/projects', input)

/** 스냅샷을 data 스토어 이름으로 옮긴 것. JSON 키와 스토어 이름은 넷 다 다르다 (API.md 스냅샷 절) */
export interface SnapshotRecords {
  project: Project
  allThreads: Thread[]
  allEntries: Entry[]
  allTasks: Task[]
  taskThreads: TaskThreadLink[]
  parts: Part[]
  partMembers: PartMember[]
}

export function toRecords(snapshot: ProjectSnapshot): SnapshotRecords {
  return {
    project: snapshot.project,
    allThreads: snapshot.threads,
    allEntries: snapshot.entries,
    allTasks: snapshot.tasks,
    taskThreads: snapshot.taskThreadLinks,
    parts: snapshot.parts,
    partMembers: snapshot.partMembers,
  }
}

export const fetchSnapshot = async (projectId: string) =>
  toRecords(await request<ProjectSnapshot>('GET', `/projects/${id(projectId)}/snapshot`))

/* 프로젝트 멤버 — 읽기는 그 프로젝트의 누구나, 쓰기는 그 프로젝트 관리자 · 시스템 관리자 (docs/api/auth.md).
   목업 갈래는 권한과 지운 프로젝트(404)만 본다 */

const mockProjectMembers = {
  list(projectId: string): ProjectMember[] {
    requireProject(requireMe(), projectId)
    return mockDb()
      .grants.filter((g) => g.projectId === projectId)
      .map(({ memberId, role }) => ({ memberId, role }))
  },
  put(projectId: string, memberId: string, role: ProjectRole): ProjectMember {
    requireManager(projectId)
    const member = memberOf(memberId)
    if (!member) throw mockError(404, 'MEMBER_NOT_FOUND', '멤버를 찾을 수 없습니다.')
    if (!member.active)
      throw mockError(400, 'MEMBER_INACTIVE', '비활성 멤버는 프로젝트에 부여할 수 없습니다.')
    const grants = mockDb().grants
    const found = grants.find((g) => g.projectId === projectId && g.memberId === memberId)
    if (found) found.role = role
    else grants.push({ projectId, memberId, role })
    return { memberId, role }
  },
  remove(projectId: string, memberId: string) {
    requireManager(projectId)
    const db = mockDb()
    db.grants = db.grants.filter((g) => !(g.projectId === projectId && g.memberId === memberId))
    /* 그 프로젝트 파트들에서도 같이 빠진다 (docs/api/part.md) */
    const ownParts = new Set(db.parts.filter((p) => p.projectId === projectId).map((p) => p.id))
    db.partMembers = db.partMembers.filter(
      (pm) => !(pm.memberId === memberId && ownParts.has(pm.partId)),
    )
  },
}

export const fetchProjectMembers = (projectId: string) =>
  isMockMode()
    ? later(() => mockProjectMembers.list(projectId))
    : request<ProjectMember[]>('GET', `/projects/${id(projectId)}/members`)

/** 부여하거나 역할을 바꾼다 (멱등) */
export const putProjectMember = (projectId: string, memberId: string, role: ProjectRole) =>
  isMockMode()
    ? later(() => mockProjectMembers.put(projectId, memberId, role))
    : request<ProjectMember>('PUT', `/projects/${id(projectId)}/members/${id(memberId)}`, {
        role,
      })

/** 빼기 (멱등). 그 사람이 담당하던 작업 · 안건은 그대로 남고, 그 프로젝트 파트 소속은 같이 빠진다 */
export const deleteProjectMember = (projectId: string, memberId: string) =>
  isMockMode()
    ? later(() => mockProjectMembers.remove(projectId, memberId))
    : request<void>('DELETE', `/projects/${id(projectId)}/members/${id(memberId)}`)

/** 이름 · 설명 · 기간 · 상태 — 보낸 것만 바뀌고 null 은 지운다. 기간이 거꾸로면 400 PROJECT_DATE_RANGE */
export const patchProject = (projectId: string, patch: ProjectPatch) =>
  isMockMode()
    ? later(() => mockProjects.patch(projectId, patch))
    : request<Project>('PATCH', `/projects/${id(projectId)}`, patch)

/** 소프트 삭제 — 시스템 관리자만, 204. 이후 목록에서 빠지고 그 프로젝트 경로는 404 */
export const deleteProject = (projectId: string) =>
  isMockMode()
    ? later(() => mockProjects.remove(projectId))
    : request<void>('DELETE', `/projects/${id(projectId)}`)

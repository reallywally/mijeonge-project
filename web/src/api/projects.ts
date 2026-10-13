import { id, mockError, request } from '@/api/client'
import { forbidden, later, memberOf, mockDb, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { canManageProject } from '@/lib/access'
import type {
  Entry,
  Member,
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

export const fetchProjects = () => request<Project[]>('GET', '/projects')

/** 비활성 멤버까지 이름을 다 낸다 — 옛 기록의 이름을 찍으려면 필요하다 */
export const fetchMembers = () =>
  isMockMode()
    ? later(() => {
        requireMe()
        return structuredClone(mockDb().members)
      })
    : request<Member[]>('GET', '/members')

export const createProject = (input: ProjectInput) => request<Project>('POST', '/projects', input)

/** 스냅샷을 data 스토어 이름으로 옮긴 것. JSON 키와 스토어 이름은 넷 다 다르다 (API.md 스냅샷 절) */
export interface SnapshotRecords {
  project: Project
  allThreads: Thread[]
  allEntries: Entry[]
  allTasks: Task[]
  taskThreads: TaskThreadLink[]
}

export function toRecords(snapshot: ProjectSnapshot): SnapshotRecords {
  return {
    project: snapshot.project,
    allThreads: snapshot.threads,
    allEntries: snapshot.entries,
    allTasks: snapshot.tasks,
    taskThreads: snapshot.taskThreadLinks,
  }
}

export const fetchSnapshot = async (projectId: string) =>
  toRecords(await request<ProjectSnapshot>('GET', `/projects/${id(projectId)}/snapshot`))

/* 프로젝트 멤버 — 읽기는 그 프로젝트의 누구나, 쓰기는 그 프로젝트 관리자 · 시스템 관리자 (docs/api/auth.md).
   목업 갈래는 화면에서 만든 목업 프로젝트를 알 수 없어 있는지는 따지지 않고 권한만 본다 */

function requireManager(projectId: string) {
  const me = requireMe()
  requireProject(me, projectId)
  if (!canManageProject(me, projectId)) throw forbidden()
  return me
}

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

/** 빼기 (멱등). 그 사람이 담당하던 작업 · 안건은 그대로 남는다 */
export const deleteProjectMember = (projectId: string, memberId: string) =>
  isMockMode()
    ? later(() => mockProjectMembers.remove(projectId, memberId))
    : request<void>('DELETE', `/projects/${id(projectId)}/members/${id(memberId)}`)

/** 프로젝트 이름 수정. 목업은 프로젝트 레코드를 data 스토어가 들고 있어 스토어가 직접 고친다 */
export const patchProject = (projectId: string, patch: ProjectPatch) =>
  request<Project>('PATCH', `/projects/${id(projectId)}`, patch)

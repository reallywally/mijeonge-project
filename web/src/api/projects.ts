import { id, request } from '@/api/client'
import type {
  Entry,
  Member,
  Project,
  ProjectInput,
  ProjectSnapshot,
  Task,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

export const fetchProjects = () => request<Project[]>('GET', '/projects')

export const fetchMembers = () => request<Member[]>('GET', '/members')

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

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError } from '@/api'
import {
  entries,
  members,
  partMembers as partMemberFixtures,
  parts as partFixtures,
  projectGrants,
  projects,
  tasks,
  taskThreadLinks,
  threads,
} from '@/fixtures'
import { canCreateProject, canManageProject, canSeeProject } from '@/lib/access'
import { assignableMembers, memberLabel } from '@/lib/member'
import { toastError } from '@/lib/notify'
import { makeTaskKeyPrefix } from '@/lib/project'
import { recall, remember } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth'
import type {
  Entry,
  Member,
  Part,
  PartMember,
  Project,
  ProjectMember,
  ProjectRole,
  Task,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

const REMEMBERED_PROJECT = 'innoflow.projectId'

/**
 * 레코드가 사는 곳. 화면이 쓰는 계산은 thread · task 스토어가 맡는다.
 *
 * 서버 모드에서는 고른 프로젝트 하나치(스냅샷)만 들고, 목업 모드에서는 픽스처 전부를 들고 거른다.
 * 레코드를 한곳에 모아 두면 도메인 스토어끼리 서로의 레코드를 부르며 고리를 만들 일이 없다.
 */
/** 목업의 프로젝트별 부여 — 부팅 없이 마운트하는 화면 테스트도 담당자 후보를 갖게 */
function grantsOfFixtures(): Record<string, ProjectMember[]> {
  const byProject: Record<string, ProjectMember[]> = {}
  for (const g of projectGrants)
    (byProject[g.projectId] ??= []).push({ memberId: g.memberId, role: g.role })
  return byProject
}

const forbidden = () => new ApiError(403, { code: 'FORBIDDEN', message: '권한이 없습니다.' })

export const useDataStore = defineStore('data', () => {
  const mock = api.isMockMode()
  const auth = useAuthStore()

  /* 목업을 그대로 쓰면 스토어가 모듈 배열을 고치게 된다 — 테스트가 서로 물들고,
     프로젝트를 바꿔 돌아와도 앞의 수정이 남는다. 복사해서 시작한다. */
  const allProjects = ref<Project[]>(mock ? structuredClone(projects) : [])
  const allMembers = ref<Member[]>(mock ? structuredClone(members) : [])
  const allThreads = ref<Thread[]>(mock ? structuredClone(threads) : [])
  const allEntries = ref<Entry[]>(mock ? structuredClone(entries) : [])
  const allTasks = ref<Task[]>(mock ? structuredClone(tasks) : [])
  const taskThreads = ref<TaskThreadLink[]>(mock ? structuredClone(taskThreadLinks) : [])
  /** 파트와 소속. 서버 모드는 고른 프로젝트 하나치, 목업은 전부 — 프로젝트로 거르는 것은 part 스토어다 */
  const parts = ref<Part[]>(mock ? structuredClone(partFixtures) : [])
  const partMembers = ref<PartMember[]>(mock ? structuredClone(partMemberFixtures) : [])
  /** 프로젝트마다 부여된 사람 — 담당자를 고르는 자리가 이것으로 거른다 */
  const projectMembers = ref<Record<string, ProjectMember[]>>(mock ? grantsOfFixtures() : {})

  /**
   * 앱이 뜰 수 있는가. anonymous 는 로그인 전 — 라우터가 /login 으로 보낸다.
   * 목업은 처음부터 다 있다(화면 테스트가 부팅 없이 마운트한다). 부팅하면 로그인부터 다시 본다
   */
  const status = ref<'loading' | 'ready' | 'error' | 'anonymous'>(mock ? 'ready' : 'loading')
  const bootError = ref<ApiError | null>(null)
  /** 프로젝트를 바꾸고 스냅샷을 기다리는 중 */
  const syncing = ref(false)
  /** 스냅샷을 새로 받을 때마다 오른다 — 자기 사본을 들고 있는 칸(본문 편집기)이 서버 값으로 다시 선다 */
  const snapshotRevision = ref(0)
  /** 서버 모드에서 레코드를 들고 있는 프로젝트 */
  const loadedProjectId = ref<string | null>(null)

  /**
   * 고른 프로젝트. 이후 모든 화면은 이 프로젝트 안에서만 돈다.
   * 하나도 없을 수 있다 — 그때는 프로젝트 등록이 첫 화면이다 (API.md Q18).
   */
  const currentProjectId = ref(allProjects.value[0]?.id ?? '')
  const currentProject = computed<Project | null>(
    () => allProjects.value.find((p) => p.id === currentProjectId.value) ?? null,
  )

  /** 그 프로젝트의 레코드를 들고 있나 — 서버 모드는 고른 프로젝트 하나치만 받는다 */
  const holdsRecordsOf = (projectId: string) => mock || loadedProjectId.value === projectId

  function applySnapshot(records: api.SnapshotRecords) {
    const at = allProjects.value.findIndex((p) => p.id === records.project.id)
    if (at >= 0) allProjects.value[at] = records.project
    else allProjects.value.push(records.project)
    allThreads.value = records.allThreads
    allEntries.value = records.allEntries
    allTasks.value = records.allTasks
    taskThreads.value = records.taskThreads
    parts.value = records.parts
    partMembers.value = records.partMembers
    loadedProjectId.value = records.project.id
    snapshotRevision.value += 1
  }

  /** 스냅샷과 그 프로젝트의 멤버를 받아 갈아끼운다. 그사이 프로젝트를 또 바꿨으면 늦게 온 옛 응답은 버린다 (API.md Q7) */
  async function loadSnapshot(projectId: string) {
    const [records, granted] = await Promise.all([
      api.fetchSnapshot(projectId),
      api.fetchProjectMembers(projectId),
    ])
    if (records.project.id !== currentProjectId.value) return
    applySnapshot(records)
    projectMembers.value[projectId] = granted
  }

  /** 쓰기가 실패하면 서버 상태로 되돌린다 */
  async function reloadSnapshot() {
    if (mock || !currentProjectId.value) return
    try {
      await loadSnapshot(currentProjectId.value)
    } catch (e) {
      toastError(e)
    }
  }

  let booting: Promise<void> | null = null

  /** 목업 — 픽스처를 새로 들이고 서버처럼 내가 볼 수 있는 프로젝트만 남긴다 */
  async function bootMock() {
    const me = auth.me
    allProjects.value = structuredClone(projects).filter((p) => canSeeProject(me, p.id))
    allThreads.value = structuredClone(threads)
    allEntries.value = structuredClone(entries)
    allTasks.value = structuredClone(tasks)
    taskThreads.value = structuredClone(taskThreadLinks)
    parts.value = structuredClone(partFixtures)
    partMembers.value = structuredClone(partMemberFixtures)
    allMembers.value = await api.fetchMembers()
    const granted = await Promise.all(allProjects.value.map((p) => api.fetchProjectMembers(p.id)))
    projectMembers.value = Object.fromEntries(allProjects.value.map((p, i) => [p.id, granted[i]]))
    const wanted = recall(REMEMBERED_PROJECT)
    const picked = allProjects.value.find((p) => p.id === wanted) ?? allProjects.value[0]
    currentProjectId.value = picked?.id ?? ''
  }

  /** 프로젝트 · 멤버를 같이 받고, 프로젝트를 고른 뒤 스냅샷을 받는다 (API.md Q5 · Q7) */
  async function bootServer() {
    const [projectList, memberList] = await Promise.all([api.fetchProjects(), api.fetchMembers()])
    allProjects.value = projectList
    allMembers.value = memberList
    const wanted = recall(REMEMBERED_PROJECT)
    const picked = projectList.find((p) => p.id === wanted) ?? projectList[0]
    currentProjectId.value = picked?.id ?? ''
    if (picked) await loadSnapshot(picked.id)
  }

  /** 로그인한 사람(GET /api/auth/me)이 맨 앞이다. 로그인 전이면 anonymous 로 서고 나머지는 안 받는다 */
  function boot(): Promise<void> {
    booting ??= (async () => {
      status.value = 'loading'
      bootError.value = null
      try {
        const me = auth.me ?? (await auth.loadMe())
        if (!me) {
          status.value = 'anonymous'
          return
        }
        if (mock) await bootMock()
        else await bootServer()
        status.value = 'ready'
      } catch (e) {
        bootError.value = e as ApiError
        status.value = 'error'
      }
    })()
    return booting
  }

  function retry() {
    booting = null
    return boot()
  }

  function setProject(id: string) {
    if (!allProjects.value.some((p) => p.id === id)) return
    if (mock) {
      currentProjectId.value = id
      return
    }
    remember(REMEMBERED_PROJECT, id)
    if (id === currentProjectId.value && loadedProjectId.value === id) return
    currentProjectId.value = id
    syncing.value = true
    loadSnapshot(id)
      .catch(toastError)
      .finally(() => {
        if (currentProjectId.value === id) syncing.value = false
      })
  }

  /* 작업 키 번호(목업 전용). 서버는 project.next_task_no 를 잠가 올린다 (API.md Q19) —
     남은 작업을 세면 지운 번호를 다시 쓰게 되므로 세지 않고 들고 센다. */
  const nextTaskNo = ref<Record<string, number>>(
    Object.fromEntries(
      allProjects.value.map((p) => [
        p.id,
        allTasks.value
          .filter((t) => t.projectId === p.id)
          .reduce((max, t) => Math.max(max, Number(t.key.split('-').pop()) || 0), 0) + 1,
      ]),
    ),
  )

  /** 다음 작업 키를 떼 온다 — 같은 번호가 두 번 나가지 않는다 */
  function takeTaskKey(projectId: string) {
    const project = allProjects.value.find((p) => p.id === projectId)
    if (!project) return ''
    const no = nextTaskNo.value[projectId] ?? 1
    nextTaskNo.value[projectId] = no + 1
    return `${project.taskKeyPrefix}-${no}`
  }

  /** 접두사를 비웠을 때 붙을 값 — 서버가 만드는 값은 임의라 미리 맞힐 수 없다 (API.md Q21) */
  const suggestTaskKeyPrefix = () =>
    mock ? makeTaskKeyPrefix(allProjects.value.map((p) => p.taskKeyPrefix)) : null

  /**
   * 프로젝트를 만들고 그 자리에서 고른다. 접두사를 비우면 겹치지 않는 값이 붙는다.
   * 실패하면 알리고 null 이다.
   */
  async function addProject(name: string, taskKeyPrefix: string): Promise<string | null> {
    if (mock) {
      /* 목업도 서버처럼 시스템 관리자만 — 메뉴를 숨긴 것은 편의다 */
      if (!canCreateProject(auth.me)) {
        toastError(forbidden())
        return null
      }
      const id = nextId('np')
      const wanted = taskKeyPrefix.trim().toUpperCase()
      const prefix = wanted || makeTaskKeyPrefix(allProjects.value.map((p) => p.taskKeyPrefix))
      allProjects.value.push({ id, name, taskKeyPrefix: prefix })
      projectMembers.value[id] = []
      nextTaskNo.value[id] = 1
      currentProjectId.value = id
      return id
    }
    try {
      const project = await api.createProject({
        name,
        taskKeyPrefix: taskKeyPrefix.trim().toUpperCase(),
      })
      allProjects.value.push(project)
      projectMembers.value[project.id] = []
      setProject(project.id)
      return project.id
    } catch (e) {
      toastError(e)
      return null
    }
  }

  /* 같은 레코드에 요청이 겹치면 마지막에 보낸 것의 응답만 반영한다 — 순서 없이 도착한 옛 응답이
     새 값을 덮지 않게. 실패하면 알리고 스냅샷을 다시 받아 서버 상태로 되돌린다. */
  const latest = new Map<string, number>()
  let ticket = 0

  /** 화면에 먼저 반영한 수정을 서버로 보낸다. 반영했으면 true */
  async function save<T>(
    key: string,
    send: () => Promise<T>,
    apply: (res: T) => void,
  ): Promise<boolean> {
    ticket += 1
    const mine = ticket
    latest.set(key, mine)
    try {
      const res = await send()
      if (latest.get(key) !== mine) return false
      apply(res)
      return true
    } catch (e) {
      toastError(e)
      await reloadSnapshot()
      return false
    }
  }

  /** 이름 고치기 — 프로젝트 관리자 · 시스템 관리자. 실패하면 알리고 false */
  async function renameProject(projectId: string, name: string): Promise<boolean> {
    const at = allProjects.value.findIndex((p) => p.id === projectId)
    const trimmed = name.trim()
    if (at < 0 || !trimmed) return false
    if (mock) {
      if (!canManageProject(auth.me, projectId)) {
        toastError(forbidden())
        return false
      }
      allProjects.value[at] = { ...allProjects.value[at], name: trimmed }
      return true
    }
    try {
      const project = await api.patchProject(projectId, { name: trimmed })
      const now = allProjects.value.findIndex((p) => p.id === projectId)
      if (now >= 0) allProjects.value[now] = project
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  /** 프로젝트에 사람을 부여하거나 역할을 바꾼다 (멱등) */
  async function grantMember(projectId: string, memberId: string, role: ProjectRole) {
    try {
      const granted = await api.putProjectMember(projectId, memberId, role)
      const list = (projectMembers.value[projectId] ??= [])
      const at = list.findIndex((p) => p.memberId === memberId)
      if (at >= 0) list[at] = granted
      else list.push(granted)
      if (memberId === auth.me?.id) auth.setProjectRole(projectId, granted.role)
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  /** 프로젝트에서 뺀다. 담당하던 작업 · 안건은 그대로 남는다 — 기록이다. 그 프로젝트 파트 소속은 같이 걷는다 */
  async function revokeMember(projectId: string, memberId: string) {
    try {
      await api.deleteProjectMember(projectId, memberId)
      projectMembers.value[projectId] = (projectMembers.value[projectId] ?? []).filter(
        (p) => p.memberId !== memberId,
      )
      const ownParts = new Set(
        parts.value.filter((p) => p.projectId === projectId).map((p) => p.id),
      )
      partMembers.value = partMembers.value.filter(
        (pm) => !(pm.memberId === memberId && ownParts.has(pm.partId)),
      )
      if (memberId === auth.me?.id) {
        auth.setProjectRole(projectId, null)
        /* 나를 뺐으면 이제 그 프로젝트는 없는 것이다(시스템 관리자가 아니면) — 목록에서 걷고 다른 곳으로 옮긴다 */
        if (!canSeeProject(auth.me, projectId)) forgetProject(projectId)
      }
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  function forgetProject(projectId: string) {
    allProjects.value = allProjects.value.filter((p) => p.id !== projectId)
    delete projectMembers.value[projectId]
    if (currentProjectId.value !== projectId) return
    const next = allProjects.value[0]
    if (next) setProject(next.id)
    else currentProjectId.value = ''
  }

  /** '나' 는 로그인한 사람이다 — 서버가 세션으로 정한다 (docs/api/auth.md) */
  const currentMemberId = computed<string | null>(() => auth.me?.id ?? null)

  /** 이름을 찍는 자리 — 비활성 멤버는 '(비활성)' 이 붙는다 */
  const memberName = (id: string | null) => {
    const member = id ? allMembers.value.find((m) => m.id === id) : undefined
    return member ? memberLabel(member) : null
  }

  /** 담당자로 고를 수 있는 사람 — 고른 프로젝트의 활성 멤버만 */
  const assignable = computed(() =>
    assignableMembers(allMembers.value, projectMembers.value[currentProjectId.value] ?? []),
  )

  /**
   * 목업 갈래가 서버처럼 담당자를 거른다 — 새로 지정하는 담당자는 고른 프로젝트의 활성 멤버여야 한다.
   * 이미 걸려 있던 담당자(kept)를 그대로 두는 것은 막지 않는다 (docs/api/auth.md, API.md Q30).
   * 거절했으면 서버와 같은 코드로 알리고 true
   */
  function rejectOwner(
    ownerId: string | null | undefined,
    code: string,
    kept: string | null = null,
  ) {
    if (!mock || !ownerId || ownerId === kept) return false
    if (assignable.value.some((m) => m.id === ownerId)) return false
    toastError(
      new ApiError(400, {
        code,
        message: '담당자를 찾을 수 없습니다.',
        detail: { ownerId: '담당자를 찾을 수 없습니다.' },
      }),
    )
    return true
  }

  /**
   * 목업 갈래가 서버처럼 파트를 거른다 — 이 프로젝트의 파트가 아니면 PART_NOT_FOUND,
   * 새로 다는 파트가 보관이면 PART_ARCHIVED. 이미 달린 파트(kept)를 그대로 두는 것은 막지 않는다.
   * 거절했으면 서버와 같은 코드로 알리고 true
   */
  function rejectPart(partId: string | null | undefined, kept: string | null = null) {
    if (!mock || !partId || partId === kept) return false
    const part = parts.value.find((p) => p.id === partId && p.projectId === currentProjectId.value)
    if (part?.active) return false
    toastError(
      new ApiError(
        400,
        part
          ? {
              code: 'PART_ARCHIVED',
              message: '보관한 파트는 고를 수 없습니다.',
              detail: { partId: '보관한 파트입니다.' },
            }
          : {
              code: 'PART_NOT_FOUND',
              message: '파트를 찾을 수 없습니다.',
              detail: { partId: '파트를 찾을 수 없습니다.' },
            },
      ),
    )
    return true
  }

  /** 사용자 관리에서 등록 · 수정한 것을 멤버 목록에 맞춘다 */
  function upsertMember(member: Member) {
    const at = allMembers.value.findIndex((m) => m.id === member.id)
    if (at >= 0) allMembers.value[at] = member
    else allMembers.value.push(member)
  }

  /** 로그아웃 — 다른 사람이 같은 브라우저로 들어올 수 있어 들고 있던 것을 다 버린다 */
  function clear() {
    allProjects.value = []
    allMembers.value = []
    allThreads.value = []
    allEntries.value = []
    allTasks.value = []
    taskThreads.value = []
    parts.value = []
    partMembers.value = []
    projectMembers.value = {}
    loadedProjectId.value = null
    currentProjectId.value = ''
    syncing.value = false
    bootError.value = null
    latest.clear()
    booting = null
    status.value = 'anonymous'
  }

  let seq = 0
  function nextId(prefix: string) {
    seq += 1
    return `${prefix}${seq}`
  }

  return {
    mock,
    allProjects,
    allMembers,
    allThreads,
    allEntries,
    allTasks,
    taskThreads,
    parts,
    partMembers,
    projectMembers,
    assignable,
    status,
    bootError,
    syncing,
    snapshotRevision,
    loadedProjectId,
    currentProjectId,
    currentProject,
    holdsRecordsOf,
    boot,
    retry,
    loadSnapshot,
    reloadSnapshot,
    setProject,
    addProject,
    suggestTaskKeyPrefix,
    takeTaskKey,
    save,
    currentMemberId,
    memberName,
    upsertMember,
    rejectOwner,
    rejectPart,
    renameProject,
    grantMember,
    revokeMember,
    clear,
    nextId,
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import type { ApiError } from '@/api'
import { entries, members, projects, tasks, taskThreadLinks, threads } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { makeTaskKeyPrefix } from '@/lib/project'
import { CURRENT_MEMBER_ID } from '@/lib/session'
import type { Entry, Member, Project, Task, TaskThreadLink, Thread } from '@/types/domain'

const REMEMBERED_PROJECT = 'innoflow.projectId'

function recall(): string | null {
  try {
    return localStorage.getItem(REMEMBERED_PROJECT)
  } catch {
    return null
  }
}

function remember(projectId: string) {
  try {
    localStorage.setItem(REMEMBERED_PROJECT, projectId)
  } catch {
    /* 사생활 보호 모드 등에서 막혀 있어도 앱은 돈다 */
  }
}

/**
 * 레코드가 사는 곳. 화면이 쓰는 계산은 thread · task 스토어가 맡는다.
 *
 * 서버 모드에서는 고른 프로젝트 하나치(스냅샷)만 들고, 목업 모드에서는 픽스처 전부를 들고 거른다.
 * 레코드를 한곳에 모아 두면 도메인 스토어끼리 서로의 레코드를 부르며 고리를 만들 일이 없다.
 */
export const useDataStore = defineStore('data', () => {
  const mock = api.isMockMode()

  /* 목업을 그대로 쓰면 스토어가 모듈 배열을 고치게 된다 — 테스트가 서로 물들고,
     프로젝트를 바꿔 돌아와도 앞의 수정이 남는다. 복사해서 시작한다. */
  const allProjects = ref<Project[]>(mock ? structuredClone(projects) : [])
  const allMembers = ref<Member[]>(mock ? structuredClone(members) : [])
  const allThreads = ref<Thread[]>(mock ? structuredClone(threads) : [])
  const allEntries = ref<Entry[]>(mock ? structuredClone(entries) : [])
  const allTasks = ref<Task[]>(mock ? structuredClone(tasks) : [])
  const taskThreads = ref<TaskThreadLink[]>(mock ? structuredClone(taskThreadLinks) : [])

  /** 앱이 뜰 수 있는가 — 목업은 처음부터 다 있다 */
  const status = ref<'loading' | 'ready' | 'error'>(mock ? 'ready' : 'loading')
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
    loadedProjectId.value = records.project.id
    snapshotRevision.value += 1
  }

  /** 스냅샷을 받아 갈아끼운다. 그사이 프로젝트를 또 바꿨으면 늦게 온 옛 응답은 버린다 (API.md Q7) */
  async function loadSnapshot(projectId: string) {
    const records = await api.fetchSnapshot(projectId)
    if (records.project.id !== currentProjectId.value) return
    applySnapshot(records)
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

  /** 프로젝트 · 멤버를 같이 받고, 프로젝트를 고른 뒤 스냅샷을 받는다 (API.md Q5 · Q7) */
  function boot(): Promise<void> {
    if (mock) return Promise.resolve()
    booting ??= (async () => {
      status.value = 'loading'
      bootError.value = null
      try {
        const [projectList, memberList] = await Promise.all([
          api.fetchProjects(),
          api.fetchMembers(),
        ])
        allProjects.value = projectList
        allMembers.value = memberList
        const wanted = recall()
        const picked = projectList.find((p) => p.id === wanted) ?? projectList[0]
        currentProjectId.value = picked?.id ?? ''
        if (picked) await loadSnapshot(picked.id)
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
    remember(id)
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
      const id = nextId('np')
      const wanted = taskKeyPrefix.trim().toUpperCase()
      const prefix = wanted || makeTaskKeyPrefix(allProjects.value.map((p) => p.taskKeyPrefix))
      allProjects.value.push({ id, name, taskKeyPrefix: prefix })
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

  /** 지금 로그인한 사람. 인증이 붙기 전까지 프론트가 들고 있는 상수다 (API.md Q12) */
  const currentMemberId = ref(CURRENT_MEMBER_ID)
  const memberName = (id: string | null) =>
    id ? (allMembers.value.find((m) => m.id === id)?.name ?? null) : null

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
    nextId,
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  currentMemberId as defaultMemberId,
  entries,
  meetings,
  meetingTaskLinks,
  members,
  projects,
  tasks,
  taskThreadLinks,
  threads,
} from '@/fixtures'
import type {
  Entry,
  Meeting,
  MeetingTaskLink,
  Member,
  Project,
  Task,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

/**
 * 레코드가 사는 곳. 화면이 쓰는 계산은 thread · meeting · task 스토어가 맡는다.
 *
 * 백엔드가 붙으면 여기만 api 호출로 바뀐다 — 목록 계산과 화면은 그대로 둔다.
 * 스토어를 하나 더 두는 이유는, 안건이 회의 날짜를 필요로 하고 회의가 안건 제목을 필요로 해서
 * 도메인 스토어끼리 서로를 부르면 고리가 생기기 때문이다. 레코드를 한곳에 모으면 그 고리가 없다.
 */
export const useDataStore = defineStore('data', () => {
  /* 목업을 그대로 쓰면 스토어가 모듈 배열을 고치게 된다 — 테스트가 서로 물들고,
     프로젝트를 바꿔 돌아와도 앞의 수정이 남는다. 복사해서 시작한다. */
  const allProjects = ref<Project[]>(structuredClone(projects))
  const allMembers = ref<Member[]>(structuredClone(members))
  const allThreads = ref<Thread[]>(structuredClone(threads))
  const allEntries = ref<Entry[]>(structuredClone(entries))
  const allMeetings = ref<Meeting[]>(structuredClone(meetings))
  const allTasks = ref<Task[]>(structuredClone(tasks))
  const taskThreads = ref<TaskThreadLink[]>(structuredClone(taskThreadLinks))
  const meetingTasks = ref<MeetingTaskLink[]>(structuredClone(meetingTaskLinks))

  /** 고른 프로젝트. 이후 모든 화면은 이 프로젝트 안에서만 돈다. */
  const currentProjectId = ref(allProjects.value[0].id)
  const currentProject = computed(
    () => allProjects.value.find((p) => p.id === currentProjectId.value) ?? allProjects.value[0],
  )
  function setProject(id: string) {
    if (allProjects.value.some((p) => p.id === id)) currentProjectId.value = id
  }

  /** 지금 로그인한 사람. 로그인이 붙기 전까지 고정이다. */
  const currentMemberId = ref(defaultMemberId)
  const memberName = (id: string | null) =>
    id ? (allMembers.value.find((m) => m.id === id)?.name ?? null) : null

  let seq = 0
  function nextId(prefix: string) {
    seq += 1
    return `${prefix}${seq}`
  }

  return {
    allProjects,
    allMembers,
    allThreads,
    allEntries,
    allMeetings,
    allTasks,
    taskThreads,
    meetingTasks,
    currentProjectId,
    currentProject,
    setProject,
    currentMemberId,
    memberName,
    nextId,
  }
})

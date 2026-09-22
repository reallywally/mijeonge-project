import { defineStore } from 'pinia'
import { computed } from 'vue'
import { slashDay, today } from '@/lib/date'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'
import type {
  Meeting,
  Task,
  TaskDetail,
  TaskInput,
  TaskRow,
  TaskStatus,
  TaskThreadRow,
  Thread,
} from '@/types/domain'

/**
 * 작업.
 *
 * 계층으로 쌓이지만 목록은 펼치지 않는다 — 한 줄에 하나씩 놓고 어디에 속했는지는 경로로 적는다.
 * 계층째로 보는 건 간트차트가 맡는다. start · due 가 둘 다 없으면 기간 미정이라 간트에 막대가 없고,
 * 그래서 목록에서 챙겨야 한다.
 */
export const useTaskStore = defineStore('task', () => {
  const data = useDataStore()
  const threadStore = useThreadStore()

  const tasks = computed<Task[]>(() =>
    data.allTasks.filter((t) => t.projectId === data.currentProjectId),
  )

  const byId = computed<Record<string, Task>>(() =>
    Object.fromEntries(tasks.value.map((t) => [t.id, t])),
  )

  const childCountOf = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks.value) {
      if (t.parentId) counts[t.parentId] = (counts[t.parentId] ?? 0) + 1
    }
    return counts
  })

  /** 위로 올라가며 모은 조상들의 제목 */
  function ancestorTitles(task: Task) {
    const names: string[] = []
    let parent = task.parentId ? byId.value[task.parentId] : undefined
    while (parent) {
      names.unshift(parent.title)
      parent = parent.parentId ? byId.value[parent.parentId] : undefined
    }
    return names
  }

  /** 개발 › AI Biz › 가상비서 · 하위 2건 — 최상위면 '최상위 작업' */
  function pathLabel(task: Task) {
    const names = ancestorTitles(task)
    const base = names.length === 0 ? '최상위 작업' : names.join(' › ')
    const kids = childCountOf.value[task.id] ?? 0
    return kids > 0 ? `${base} · 하위 ${kids}건` : base
  }

  /** 자기까지 포함한 경로 — 상위 작업을 고르는 자리가 쓴다 */
  const fullPath = (task: Task) => [...ancestorTitles(task), task.title].join(' › ')

  /** 상위 작업 고르기 목록. 고르는 값은 이름이 아니라 id 다 */
  const parentOptions = computed<{ id: string; label: string }[]>(() =>
    tasks.value.map((t) => ({ id: t.id, label: fullPath(t) })),
  )

  const periodLabel = (task: Task) =>
    task.start && task.due ? `${slashDay(task.start)} ~ ${slashDay(task.due)}` : ''

  const threadsOfTask = (taskId: string): Thread[] =>
    data.taskThreads
      .filter((l) => l.taskId === taskId)
      .map((l) => data.allThreads.find((t) => t.id === l.threadId))
      .filter((t): t is Thread => t !== undefined)

  const meetingsOfTask = (taskId: string): Meeting[] =>
    data.meetingTasks
      .filter((l) => l.taskId === taskId)
      .map((l) => data.allMeetings.find((m) => m.id === l.meetingId))
      .filter((m): m is Meeting => m !== undefined)

  function toRow(task: Task): TaskRow {
    return {
      task,
      ownerName: data.memberName(task.ownerId),
      pathLabel: pathLabel(task),
      periodLabel: periodLabel(task),
      undated: !task.start || !task.due,
      threadCount: threadsOfTask(task.id).length,
      childCount: childCountOf.value[task.id] ?? 0,
    }
  }

  const rows = computed<TaskRow[]>(() => tasks.value.map(toRow))

  /** 기간이 안 잡혀 간트에 막대가 없는 작업 */
  const undatedCount = computed(() => rows.value.filter((r) => r.undated).length)
  /** 걸어 둔 안건이 안 정해져 멈춘 작업 */
  const blockedCount = computed(() => rows.value.filter((r) => r.task.status === 'blocked').length)

  const statusCounts = computed<Record<TaskStatus | 'all', number>>(() => ({
    all: rows.value.length,
    todo: rows.value.filter((r) => r.task.status === 'todo').length,
    doing: rows.value.filter((r) => r.task.status === 'doing').length,
    blocked: blockedCount.value,
    done: rows.value.filter((r) => r.task.status === 'done').length,
  }))

  /** 작업 상세에 붙는 안건 한 줄 — 지금 어디까지 정해졌는지까지 같이 본다 */
  function threadRow(thread: Thread): TaskThreadRow {
    const detail = threadStore.threadDetail(thread.id)
    const deferCount = detail?.deferCount ?? 0
    if (detail?.settled) {
      return { thread, deferCount, line: detail.current, where: detail.settledLabel }
    }
    const last = detail?.events[0]
    return {
      thread,
      deferCount,
      line: last ? last.entry.text : '아직 회의에서 다루지 않았습니다.',
      where: last?.meeting
        ? `${last.meeting.title} · ${last.at}`
        : '다음 회의에서 고를 수 있습니다',
    }
  }

  function taskDetail(taskId: string): TaskDetail | null {
    const task = data.allTasks.find((t) => t.id === taskId)
    if (!task) return null
    const children = tasks.value.filter((t) => t.parentId === taskId).map(toRow)
    return {
      task,
      ownerName: data.memberName(task.ownerId),
      pathLabel: pathLabel(task),
      periodLabel: periodLabel(task),
      parent: task.parentId ? (byId.value[task.parentId] ?? null) : null,
      children,
      threads: threadsOfTask(taskId).map(threadRow),
      meetings: meetingsOfTask(taskId),
      doneChildCount: children.filter((c) => c.task.status === 'done').length,
    }
  }

  function setStatus(taskId: string, status: TaskStatus) {
    const task = data.allTasks.find((t) => t.id === taskId)
    if (task) task.status = status
  }

  function setOwner(taskId: string, ownerId: string | null) {
    const task = data.allTasks.find((t) => t.id === taskId)
    if (task) task.ownerId = ownerId
  }

  function toggleBodyLine(taskId: string, lineId: string) {
    const line = data.allTasks.find((t) => t.id === taskId)?.body.find((l) => l.id === lineId)
    if (line && line.kind === 'check') line.done = !line.done
  }

  function addTask(input: TaskInput) {
    const id = data.nextId('nk')
    const n = data.allTasks.filter((t) => t.projectId === data.currentProjectId).length + 1
    data.allTasks.push({
      id,
      projectId: data.currentProjectId,
      key: `HW-${n}`,
      title: input.title,
      parentId: input.parentId,
      body: input.body,
      status: input.status,
      ownerId: input.ownerId,
      start: input.start,
      due: input.due,
      priority: input.priority,
      createdAt: today(),
    })
    for (const threadId of input.threadIds) linkThread(id, threadId)
    return id
  }

  /** 작업 상세에서 안건을 걸고 뗀다. 안건 화면에서는 이 링크를 읽기만 한다. */
  function linkThread(taskId: string, threadId: string) {
    const already = data.taskThreads.some((l) => l.taskId === taskId && l.threadId === threadId)
    if (!already) data.taskThreads.push({ taskId, threadId })
  }

  function unlinkThread(taskId: string, threadId: string) {
    data.taskThreads = data.taskThreads.filter(
      (l) => !(l.taskId === taskId && l.threadId === threadId),
    )
  }

  /** 작업 상세에서 회의를 건다. 회의 상세에서 거는 것과 같은 링크다. */
  function linkMeeting(taskId: string, meetingId: string) {
    const already = data.meetingTasks.some((l) => l.taskId === taskId && l.meetingId === meetingId)
    if (!already) data.meetingTasks.push({ meetingId, taskId })
  }

  function unlinkMeeting(taskId: string, meetingId: string) {
    data.meetingTasks = data.meetingTasks.filter(
      (l) => !(l.taskId === taskId && l.meetingId === meetingId),
    )
  }

  /** 어느 작업에 걸린 안건인지 — 안건 이력에서 읽기 전용으로 보여준다 */
  const tasksOfThread = (threadId: string): TaskRow[] =>
    data.taskThreads
      .filter((l) => l.threadId === threadId)
      .map((l) => data.allTasks.find((t) => t.id === l.taskId))
      .filter((t): t is Task => t !== undefined)
      .map(toRow)

  return {
    tasks,
    rows,
    undatedCount,
    blockedCount,
    statusCounts,
    pathLabel,
    fullPath,
    parentOptions,
    periodLabel,
    taskDetail,
    threadsOfTask,
    meetingsOfTask,
    tasksOfThread,
    setStatus,
    setOwner,
    toggleBodyLine,
    addTask,
    linkThread,
    unlinkThread,
    linkMeeting,
    unlinkMeeting,
  }
})

import { defineStore } from 'pinia'
import { computed } from 'vue'
import * as api from '@/api'
import { monthDay, nowIso, slashDay } from '@/lib/date'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { useThreadStore } from '@/stores/thread'
import type {
  Task,
  TaskDetail,
  TaskInput,
  TaskLine,
  TaskPatch,
  TaskPriority,
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
      line: last ? last.entry.text : '아직 아무 기록이 없습니다.',
      where: last ? `마지막 기록 · ${monthDay(last.at)}` : '기록 없음',
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
      doneChildCount: children.filter((c) => c.task.status === 'done').length,
    }
  }

  /* 작업 상세는 보는 자리가 곧 고치는 자리다 — 칸 하나를 고치면 그 값만 바로 들어간다.
     화면에 먼저 반영하고 서버에 보낸 뒤, 돌아온 레코드로 갈아끼운다. */
  const findTask = (taskId: string) => data.allTasks.find((t) => t.id === taskId)

  /* 본문은 타이핑마다 바뀌어 모아서 보낸다. 모으는 동안 다른 칸의 응답이 와도 본문은 화면 것을 지킨다 */
  const BODY_DEBOUNCE_MS = 500
  const bodyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /* 화면이 붙인 임시 줄 id → 서버가 붙인 id. 편집기는 임시 id 를 그대로 들고 있어 줄 키(포커스)가
     안 바뀌고, 다음에 보낼 때 여기서 서버 id 로 바꿔 실어 그 줄이 같은 줄로 남는다 */
  const lineIds = new Map<string, string>()
  const serverLineId = (id: string) => lineIds.get(id) ?? id

  function replaceTask(next: Task) {
    const at = data.allTasks.findIndex((t) => t.id === next.id)
    if (at < 0) return
    data.allTasks[at] = bodyTimers.has(next.id) ? { ...next, body: data.allTasks[at].body } : next
  }

  function patch(taskId: string, change: TaskPatch) {
    if (data.mock) return
    void data.save(`task:${taskId}`, () => api.patchTask(taskId, change), replaceTask)
  }

  function setStatus(taskId: string, status: TaskStatus) {
    const task = findTask(taskId)
    if (!task) return
    task.status = status
    patch(taskId, { status })
  }

  function setOwner(taskId: string, ownerId: string | null) {
    const task = findTask(taskId)
    if (!task) return
    task.ownerId = ownerId
    patch(taskId, { ownerId })
  }

  /** 간트에서 막대를 끌거나 늘렸을 때 되돌아오는 자리. 둘 다 null 이면 기간 미정이다. */
  function setPeriod(taskId: string, start: string | null, due: string | null) {
    const task = findTask(taskId)
    if (!task) return
    /* 한쪽만 아는 기간은 기간 미정과 구분이 안 된다 — 둘 다 있을 때만 기간으로 친다 */
    const both = start !== null && due !== null
    task.start = both ? start : null
    task.due = both ? due : null
    patch(taskId, { start: task.start, due: task.due })
  }

  /** 자기와 자기 아래 작업들 — 상위 작업으로 고르면 계층이 고리가 된다 */
  function selfAndDescendants(taskId: string): Set<string> {
    const ids = new Set([taskId])
    let grew = true
    while (grew) {
      grew = false
      for (const t of tasks.value) {
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id)
          grew = true
        }
      }
    }
    return ids
  }

  /** 수정할 때 고를 수 있는 상위 작업 — 자기와 자기 아래는 뺀다 */
  const parentOptionsFor = (taskId: string) => {
    const blocked = selfAndDescendants(taskId)
    return parentOptions.value.filter((o) => !blocked.has(o.id))
  }

  function setTitle(taskId: string, title: string) {
    const task = findTask(taskId)
    if (!task || !title.trim()) return
    task.title = title.trim()
    patch(taskId, { title: task.title })
  }

  /** 자기나 자기 아래 작업을 상위로 고르면 계층이 고리가 되니 받지 않는다 */
  function setParent(taskId: string, parentId: string | null) {
    const task = findTask(taskId)
    if (!task) return
    if (parentId && selfAndDescendants(taskId).has(parentId)) return
    task.parentId = parentId
    patch(taskId, { parentId })
  }

  function setPriority(taskId: string, priority: TaskPriority) {
    const task = findTask(taskId)
    if (!task) return
    task.priority = priority
    patch(taskId, { priority })
  }

  function sendBody(taskId: string, lines: TaskLine[]) {
    const sent = lines.map((l) => ({ ...l, id: serverLineId(l.id) }))
    void data.save(
      `task:${taskId}`,
      async () => {
        const res = await api.patchTask(taskId, { body: sent })
        /* 서버는 받은 순서대로 줄을 놓는다 — 같은 자리끼리 짝지으면 새 줄이 받은 id 를 안다.
           뒤에 보낸 요청에 밀려 응답을 버리더라도 짝은 남긴다 */
        if (res.body.length === lines.length) {
          lines.forEach((l, i) => lineIds.set(l.id, res.body[i].id))
        }
        return res
      },
      replaceTask,
    )
  }

  function setBody(taskId: string, body: TaskLine[]) {
    const task = findTask(taskId)
    if (!task) return
    task.body = body
    if (data.mock) return
    clearTimeout(bodyTimers.get(taskId))
    bodyTimers.set(
      taskId,
      setTimeout(() => {
        bodyTimers.delete(taskId)
        sendBody(taskId, findTask(taskId)?.body ?? body)
      }, BODY_DEBOUNCE_MS),
    )
  }

  function toggleBodyLine(taskId: string, lineId: string) {
    const line = findTask(taskId)?.body.find((l) => l.id === lineId)
    if (!line || line.kind !== 'check') return
    line.done = !line.done
    if (data.mock) return
    const done = line.done
    void data.save(
      `task:${taskId}`,
      () => api.patchTaskLine(taskId, serverLineId(lineId), done),
      replaceTask,
    )
  }

  function addLink(taskId: string, threadId: string) {
    const already = data.taskThreads.some((l) => l.taskId === taskId && l.threadId === threadId)
    if (!already) data.taskThreads.push({ taskId, threadId })
  }

  /**
   * 작업을 만든다. 서버 모드에서는 id · key 를 서버가 내므로 응답을 기다렸다가 넣는다.
   * 실패하면 알리고 null 이다.
   */
  async function addTask(input: TaskInput): Promise<string | null> {
    if (!data.mock) {
      try {
        const task = await api.createTask(data.currentProjectId, input)
        data.allTasks.push(task)
        /* 링크는 서버가 같이 세웠다 — 여기서는 들고만 있는다 */
        for (const threadId of input.threadIds) addLink(task.id, threadId)
        return task.id
      } catch (e) {
        toastError(e)
        return null
      }
    }
    const id = data.nextId('nk')
    data.allTasks.push({
      id,
      projectId: data.currentProjectId,
      /* 목업에서는 키를 프로젝트의 접두사와 다음 번호로 세운다 — 서버 모드는 서버가 낸다 */
      key: data.takeTaskKey(data.currentProjectId),
      title: input.title,
      parentId: input.parentId,
      body: input.body,
      status: input.status,
      ownerId: input.ownerId,
      start: input.start,
      due: input.due,
      priority: input.priority,
      createdAt: nowIso(),
    })
    for (const threadId of input.threadIds) addLink(id, threadId)
    return id
  }

  /** 작업 상세에서 안건을 걸고 뗀다. 안건 화면에서는 이 링크를 읽기만 한다. */
  function linkThread(taskId: string, threadId: string) {
    addLink(taskId, threadId)
    if (data.mock) return
    void data.save(
      `link:${taskId}:${threadId}`,
      () => api.linkTaskThread(taskId, threadId),
      () => {},
    )
  }

  function unlinkThread(taskId: string, threadId: string) {
    data.taskThreads = data.taskThreads.filter(
      (l) => !(l.taskId === taskId && l.threadId === threadId),
    )
    if (data.mock) return
    void data.save(
      `link:${taskId}:${threadId}`,
      () => api.unlinkTaskThread(taskId, threadId),
      () => {},
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
    parentOptionsFor,
    periodLabel,
    taskDetail,
    threadRow,
    threadsOfTask,
    tasksOfThread,
    setStatus,
    setOwner,
    setPeriod,
    toggleBodyLine,
    setTitle,
    setParent,
    setPriority,
    setBody,
    addTask,
    linkThread,
    unlinkThread,
  }
})

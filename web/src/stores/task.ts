import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError } from '@/api'
import { monthDay, nowIso, slashDay } from '@/lib/date'
import { bodyChanged, change, diffChanges } from '@/lib/history'
import { toastError } from '@/lib/notify'
import { inheritedPartId } from '@/lib/part'
import { recall, remember } from '@/lib/storage'
import {
  MAX_TASK_DEPTH,
  TASK_DEPTH_MESSAGE,
  hiddenDoneIds,
  subtreeHeights,
  taskDepths,
} from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { usePartStore } from '@/stores/part'
import { useThreadStore } from '@/stores/thread'
import type {
  HistoryChange,
  ParentChoice,
  ProposedTask,
  Task,
  TaskBatchResult,
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
  const partStore = usePartStore()
  const history = useHistoryStore()

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

  /** 작업마다 몇 단인지(최상위 1) · 자기 아래 높이(하위 없으면 1) — 4단 제한을 본다 (Q64) */
  const depthOf = computed(() => taskDepths(tasks.value))
  const heightOf = computed(() => subtreeHeights(tasks.value))

  /** 이 작업 밑에 하위를 더 둘 수 있는지 */
  const canAddChild = (taskId: string) => (depthOf.value[taskId] ?? 0) < MAX_TASK_DEPTH

  const depthReason = (depth: number) => `${depth}단이 됩니다 · ${MAX_TASK_DEPTH}단까지`

  /** 상위 작업 고르기 목록(등록). 고르는 값은 이름이 아니라 id 다. 밑에 두면 4단을 넘는 것은 막아 둔다 */
  const parentOptions = computed<ParentChoice[]>(() =>
    tasks.value.map((t) => {
      const depth = (depthOf.value[t.id] ?? 1) + 1
      return {
        id: t.id,
        key: t.key,
        label: fullPath(t),
        ...(depth > MAX_TASK_DEPTH ? { disabledReason: depthReason(depth) } : {}),
      }
    }),
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

  /** [내 파트 | 전체] 로 거른 행 — 목록 · 칸반 · 간트가 이것을 쓴다. 상세는 거르지 않는다 */
  const visibleRows = computed<TaskRow[]>(() =>
    partStore.visible ? rows.value.filter((r) => partStore.showsTask(r.task.id)) : rows.value,
  )

  /* 완료 숨기기 — 목록 · 간트가 같이 따른다(칸반은 완료 칸이 따로 있어 안 따른다). 처음은 켜짐이고
     바꾼 값은 브라우저에 기억한다. 보기만 거른다 — 아래 수 · 리포트 · 진척률은 숨긴 것도 센다 (Q64) */
  const HIDE_DONE_KEY = 'innoflow.tasks.hideDone'
  const hideDone = ref(recall(HIDE_DONE_KEY) !== 'off')
  function setHideDone(on: boolean) {
    hideDone.value = on
    remember(HIDE_DONE_KEY, on ? 'on' : 'off')
  }

  /** 지금 숨는 작업 — 완료인데 안 끝난 하위가 없는 것. 보이는 범위([내 파트 | 전체]) 안에서 본다 */
  const doneHiddenIds = computed<Set<string>>(() =>
    hideDone.value ? hiddenDoneIds(visibleRows.value.map((r) => r.task)) : new Set(),
  )
  /** 간트가 그리는 행 — 보이는 범위에서 숨긴 완료를 뺀 것 */
  const shownRows = computed<TaskRow[]>(() =>
    visibleRows.value.filter((r) => !doneHiddenIds.value.has(r.task.id)),
  )

  /* 아래 수는 보이는 것만 센다 — 화면에 없는 작업을 '몇 건' 이라 적으면 찾을 수 없다 */

  /** 기간이 안 잡혀 간트에 막대가 없는 작업 */
  const undatedCount = computed(() => visibleRows.value.filter((r) => r.undated).length)
  /** 걸어 둔 안건이 안 정해져 멈춘 작업 */
  const blockedCount = computed(
    () => visibleRows.value.filter((r) => r.task.status === 'blocked').length,
  )

  const statusCounts = computed<Record<TaskStatus | 'all', number>>(() => ({
    all: visibleRows.value.length,
    todo: visibleRows.value.filter((r) => r.task.status === 'todo').length,
    doing: visibleRows.value.filter((r) => r.task.status === 'doing').length,
    blocked: blockedCount.value,
    done: visibleRows.value.filter((r) => r.task.status === 'done').length,
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

  /* 목업은 서버가 없어 변경 이력도 여기서 남긴다 — 서버는 요청을 받아 스스로 남긴다 (docs/api/history.md) */
  function logMock(taskId: string, changes: HistoryChange[]) {
    if (!data.mock || changes.length === 0) return
    api.recordMockHistory('task', taskId, changes)
    history.touched('task', taskId)
  }

  /** 서버에 보낸 쓰기가 끝나면 펼쳐 둔 이력 칸이 다시 부르게 알린다 */
  function afterWrite(taskId: string, done: Promise<unknown>) {
    void done.finally(() => history.touched('task', taskId))
  }

  /** PATCH 한 번의 이력 — 지금 값에서 바뀐 칸만. 고치기 전에 부른다 */
  const logPatch = (task: Task, next: TaskPatch) =>
    logMock(task.id, diffChanges(task, next, 'task'))

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
    afterWrite(
      taskId,
      data.save(`task:${taskId}`, () => api.patchTask(taskId, change), replaceTask),
    )
  }

  function setStatus(taskId: string, status: TaskStatus) {
    const task = findTask(taskId)
    if (!task) return
    /* 상태가 바뀌면 기록이 한 줄 는다 — 목업은 여기서, 서버는 응답의 값으로 갈아끼운다.
       그대로인 것은 남기지 않는다 (docs/api/task-flow.md) */
    logPatch(task, { status })
    if (task.status !== status) {
      task.statusChangedAt = nowIso()
      task.statusSinceBackfill = false
    }
    task.status = status
    patch(taskId, { status })
  }

  function setOwner(taskId: string, ownerId: string | null) {
    const task = findTask(taskId)
    if (!task) return
    if (data.rejectOwner(ownerId, 'TASK_OWNER_NOT_FOUND', task.ownerId)) return
    logPatch(task, { ownerId })
    task.ownerId = ownerId
    patch(taskId, { ownerId })
  }

  /** 간트에서 막대를 끌거나 늘렸을 때 되돌아오는 자리. 둘 다 null 이면 기간 미정이다. */
  function setPeriod(taskId: string, start: string | null, due: string | null) {
    const task = findTask(taskId)
    if (!task) return
    /* 한쪽만 아는 기간은 기간 미정과 구분이 안 된다 — 둘 다 있을 때만 기간으로 친다 */
    const both = start !== null && due !== null
    logPatch(task, { start: both ? start : null, due: both ? due : null })
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

  /** 수정할 때 고를 수 있는 상위 작업 — 자기와 자기 아래는 뺀다. 옮기면 자기 아래까지 4단을 넘는 것은 막아 둔다.
      지금 상위는 막지 않는다 — 상위를 안 바꾸는 수정은 서버도 막지 않는다 */
  const parentOptionsFor = (taskId: string): ParentChoice[] => {
    const blocked = selfAndDescendants(taskId)
    const height = heightOf.value[taskId] ?? 1
    const current = byId.value[taskId]?.parentId ?? null
    return parentOptions.value
      .filter((o) => !blocked.has(o.id))
      .map(({ id, key, label }) => {
        const depth = (depthOf.value[id] ?? 1) + height
        return depth > MAX_TASK_DEPTH && id !== current
          ? { id, key, label, disabledReason: depthReason(depth) }
          : { id, key, label }
      })
  }

  /** 목업은 서버가 없어 4단 제한도 여기서 흉내 낸다 — 서버의 400 TASK_DEPTH_EXCEEDED 와 같은 모양 */
  function rejectDepth(parentId: string | null, height = 1) {
    if (!data.mock || !parentId) return false
    if ((depthOf.value[parentId] ?? 1) + height <= MAX_TASK_DEPTH) return false
    toastError(
      new ApiError(400, {
        code: 'TASK_DEPTH_EXCEEDED',
        message: TASK_DEPTH_MESSAGE,
        detail: { parentId: TASK_DEPTH_MESSAGE },
      }),
    )
    return true
  }

  function setTitle(taskId: string, title: string) {
    const task = findTask(taskId)
    if (!task || !title.trim()) return
    logPatch(task, { title: title.trim() })
    task.title = title.trim()
    patch(taskId, { title: task.title })
  }

  /** 자기나 자기 아래 작업을 상위로 고르면 계층이 고리가 되니 받지 않는다 */
  function setParent(taskId: string, parentId: string | null) {
    const task = findTask(taskId)
    if (!task) return
    if (parentId && selfAndDescendants(taskId).has(parentId)) return
    if (parentId !== task.parentId && rejectDepth(parentId, heightOf.value[taskId] ?? 1)) return
    logPatch(task, { parentId })
    task.parentId = parentId
    patch(taskId, { parentId })
  }

  /** 파트를 바꾼다(null 은 공통). 하위 작업은 따라 바뀌지 않는다 — 계약이 그렇다 */
  function setPart(taskId: string, partId: string | null) {
    const task = findTask(taskId)
    if (!task || task.partId === partId) return
    if (data.rejectPart(partId, task.partId)) return
    logPatch(task, { partId })
    task.partId = partId
    patch(taskId, { partId })
  }

  function setPriority(taskId: string, priority: TaskPriority) {
    const task = findTask(taskId)
    if (!task) return
    logPatch(task, { priority })
    task.priority = priority
    patch(taskId, { priority })
  }

  function sendBody(taskId: string, lines: TaskLine[]) {
    const sent = lines.map((l) => ({ ...l, id: serverLineId(l.id) }))
    const done = data.save(
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
    afterWrite(taskId, done)
  }

  /* 목업의 본문 이력 — 서버는 모아 보낸 한 번을 한 줄로 남긴다. 목업은 타이머 없이, 바로 앞 고침과
     BODY_DEBOUNCE_MS 안에 이어진 고침을 같은 한 번으로 본다 */
  const mockBodyAt = new Map<string, number>()

  function logMockBody(task: Task, body: TaskLine[]) {
    if (!data.mock || !bodyChanged(task.body, body)) return
    const now = Date.now()
    const last = mockBodyAt.get(task.id)
    mockBodyAt.set(task.id, now)
    if (last === undefined || now - last > BODY_DEBOUNCE_MS)
      logMock(task.id, [change('body', null, null)])
  }

  function setBody(taskId: string, body: TaskLine[]) {
    const task = findTask(taskId)
    if (!task) return
    logMockBody(task, body)
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
    logMock(taskId, [change('lineDone', !line.done, line.done, line.text)])
    if (data.mock) return
    const done = line.done
    afterWrite(
      taskId,
      data.save(
        `task:${taskId}`,
        () => api.patchTaskLine(taskId, serverLineId(lineId), done),
        replaceTask,
      ),
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
    if (data.rejectOwner(input.ownerId, 'TASK_OWNER_NOT_FOUND')) return null
    if (rejectDepth(input.parentId)) return null
    /* partId 를 안 보냈으면 상위 작업의 것을 따른다. 따라온 것도 새로 다는 것으로 보고 검사한다 —
       서버가 그렇게 한다 (API.md Q32) */
    const parentTask = input.parentId ? findTask(input.parentId) : null
    const partId = inheritedPartId(input.partId, parentTask)
    if (data.rejectPart(partId)) return null
    const id = data.nextId('nk')
    const createdAt = nowIso()
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
      partId,
      createdAt,
      commentCount: 0,
      minutesId: null,
      statusChangedAt: createdAt,
      statusSinceBackfill: false,
    })
    for (const threadId of input.threadIds) addLink(id, threadId)
    /* 등록 때 함께 건 안건은 created 에 든 것으로 본다 */
    logMock(id, [change('created', null, null)])
    return id
  }

  /**
   * 챗봇 초안을 한 번에 만든다. 목업 · 서버 모두 응답을 기다렸다가 넣는다 — 한 트랜잭션이라 반쯤 들어가는 일이 없다.
   * 실패하면 알리고 null 이다.
   */
  async function addTaskBatch(drafts: ProposedTask[]): Promise<TaskBatchResult | null> {
    const projectId = data.currentProjectId
    let result: TaskBatchResult
    try {
      result = await api.createTasksBatch(projectId, { tasks: drafts })
    } catch (e) {
      toastError(e)
      return null
    }
    /* 목업에서는 작업 키를 데이터 스토어 한 곳에서 센다 — 작업 추가(addTask)와 번호가 겹치지 않게 */
    const made = data.mock
      ? result.tasks.map((t) => ({ ...t, key: data.takeTaskKey(projectId) }))
      : result.tasks
    /* 그사이 프로젝트를 바꿨으면 지금 레코드에 섞지 않는다 — 돌아가면 스냅샷에 있다 */
    if (data.holdsRecordsOf(projectId)) data.allTasks.push(...made)
    return { tasks: made, taskIdByTempId: result.taskIdByTempId }
  }

  /** 작업 상세에서 안건을 걸고 뗀다. 안건 화면에서는 이 링크를 읽기만 한다. */
  function linkThread(taskId: string, threadId: string) {
    if (!data.taskThreads.some((l) => l.taskId === taskId && l.threadId === threadId))
      logMock(taskId, [change('thread', null, threadId)])
    addLink(taskId, threadId)
    if (data.mock) return
    afterWrite(
      taskId,
      data.save(
        `link:${taskId}:${threadId}`,
        () => api.linkTaskThread(taskId, threadId),
        () => {},
      ),
    )
  }

  function unlinkThread(taskId: string, threadId: string) {
    if (data.taskThreads.some((l) => l.taskId === taskId && l.threadId === threadId))
      logMock(taskId, [change('thread', threadId, null)])
    data.taskThreads = data.taskThreads.filter(
      (l) => !(l.taskId === taskId && l.threadId === threadId),
    )
    if (data.mock) return
    afterWrite(
      taskId,
      data.save(
        `link:${taskId}:${threadId}`,
        () => api.unlinkTaskThread(taskId, threadId),
        () => {},
      ),
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
    visibleRows,
    undatedCount,
    blockedCount,
    statusCounts,
    pathLabel,
    fullPath,
    parentOptions,
    parentOptionsFor,
    canAddChild,
    hideDone,
    setHideDone,
    doneHiddenIds,
    shownRows,
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
    setPart,
    setBody,
    addTask,
    addTaskBatch,
    linkThread,
    unlinkThread,
  }
})

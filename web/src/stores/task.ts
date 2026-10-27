import { defineStore } from 'pinia'
import { computed } from 'vue'
import * as api from '@/api'
import { monthDay, nowIso, slashDay } from '@/lib/date'
import { dependencyChoices } from '@/lib/dependency'
import { bodyChanged, change, diffChanges } from '@/lib/history'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { usePartStore } from '@/stores/part'
import { useThreadStore } from '@/stores/thread'
import type {
  HistoryChange,
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
 * 평평하다 — 계층 대신 한 방향 '연관 작업'(relatedIds)을 여럿 건다(Q61). 목록 · 칸반 · 간트 모두 한 줄에 하나씩.
 * start · due 가 둘 다 없으면 기간 미정이라 간트에 막대가 없고, 그래서 목록에서 챙겨야 한다.
 */
/** 한 작업이 거는 연관 작업은 이만큼까지 (Q61) */
export const RELATED_LIMIT = 20

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

  /** 연관 HW-3, HW-7 — 건 것이 없으면 '' */
  function relatedLabel(task: Task) {
    const keys = task.relatedIds.map((id) => byId.value[id]?.key).filter((k) => k !== undefined)
    return keys.length > 0 ? `연관 ${keys.join(', ')}` : ''
  }

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
      relatedLabel: relatedLabel(task),
      periodLabel: periodLabel(task),
      undated: !task.start || !task.due,
      threadCount: threadsOfTask(task.id).length,
    }
  }

  const rows = computed<TaskRow[]>(() => tasks.value.map(toRow))

  /** [내 파트 | 전체] 로 거른 행 — 목록 · 칸반 · 간트가 이것을 쓴다. 상세는 거르지 않는다 */
  const visibleRows = computed<TaskRow[]>(() =>
    partStore.visible ? rows.value.filter((r) => partStore.showsTask(r.task.id)) : rows.value,
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
    return {
      task,
      ownerName: data.memberName(task.ownerId),
      periodLabel: periodLabel(task),
      related: task.relatedIds
        .map((id) => byId.value[id])
        .filter((t): t is Task => t !== undefined)
        .map(toRow),
      threads: threadsOfTask(taskId).map(threadRow),
      dependsOn: dependsOnOf(taskId),
      dependents: dependentsOf(taskId),
    }
  }

  /* 선행 작업 — 레코드는 데이터 스토어에 있고, 고른 프로젝트의 작업끼리만 본다 */
  const dependencies = computed(() =>
    data.taskDependencies.filter((d) => byId.value[d.taskId] && byId.value[d.dependsOnId]),
  )

  /** 이 작업보다 먼저 끝나야 하는 작업 */
  const dependsOnOf = (taskId: string): Task[] =>
    dependencies.value.filter((d) => d.taskId === taskId).map((d) => byId.value[d.dependsOnId])

  /** 이 작업을 기다리는 작업 */
  const dependentsOf = (taskId: string): Task[] =>
    dependencies.value.filter((d) => d.dependsOnId === taskId).map((d) => byId.value[d.taskId])

  /** 선행으로 고를 수 있는 것 — 자기 · 이미 건 것은 빠지고, 순환이 되는 것은 까닭이 붙는다 */
  const dependencyChoicesFor = (taskId: string) =>
    dependencyChoices(tasks.value, dependencies.value, taskId)

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

  const hasDependency = (taskId: string, dependsOnId: string) =>
    data.taskDependencies.some((d) => d.taskId === taskId && d.dependsOnId === dependsOnId)

  function dropDependency(taskId: string, dependsOnId: string) {
    data.taskDependencies = data.taskDependencies.filter(
      (d) => !(d.taskId === taskId && d.dependsOnId === dependsOnId),
    )
  }

  /* 같은 쌍에 걸기 · 떼기가 겹치면 마지막에 보낸 것만 되돌릴 자격이 있다 — 앞의 실패가 뒤의 결과를 덮지 않게 */
  const dependencyTurn = new Map<string, number>()
  let dependencyTicket = 0
  const takeTurn = (key: string) => {
    dependencyTicket += 1
    dependencyTurn.set(key, dependencyTicket)
    return dependencyTicket
  }

  /**
   * 선행 작업을 건다. 화면에 먼저 넣고, 거절되면 빼고 까닭을 띄운다(링크와 같다).
   * 목업도 api 를 거친다 — 자기 · 순환 · 20개 검사가 서버와 같은 코드로 나와야 해서다.
   * 목업은 응답 뒤에 넣는다 — 목업 api 는 이미 걸린 관계를 검사 없이 통과시키므로(서버와 같다) 먼저 넣으면 제 검사를 건너뛴다.
   * 실패하면 그 까닭 한 줄, 되면 null. 제안 창처럼 그 줄에 까닭을 다는 자리는 quiet 로 토스트를 끈다
   */
  async function addDependency(
    taskId: string,
    dependsOnId: string,
    { quiet = false } = {},
  ): Promise<string | null> {
    if (hasDependency(taskId, dependsOnId)) return null
    const key = `${taskId}:${dependsOnId}`
    const mine = takeTurn(key)
    if (!data.mock) data.taskDependencies.push({ taskId, dependsOnId })
    try {
      await api.putTaskDependency(taskId, dependsOnId)
      if (!data.mock) history.touched('task', taskId)
      if (data.mock && !hasDependency(taskId, dependsOnId)) {
        data.taskDependencies.push({ taskId, dependsOnId })
        logMock(taskId, [change('dependsOn', null, dependsOnId)])
      }
      return null
    } catch (e) {
      if (!data.mock && dependencyTurn.get(key) === mine) dropDependency(taskId, dependsOnId)
      if (!quiet) toastError(e)
      return api.messageOf(e)
    }
  }

  /** 선행 작업을 뗀다. 실패하면 다시 넣고 알린다 */
  async function removeDependency(taskId: string, dependsOnId: string): Promise<boolean> {
    if (!hasDependency(taskId, dependsOnId)) return true
    const key = `${taskId}:${dependsOnId}`
    const mine = takeTurn(key)
    dropDependency(taskId, dependsOnId)
    try {
      await api.deleteTaskDependency(taskId, dependsOnId)
      if (data.mock) logMock(taskId, [change('dependsOn', dependsOnId, null)])
      else history.touched('task', taskId)
      return true
    } catch (e) {
      if (dependencyTurn.get(key) === mine && !hasDependency(taskId, dependsOnId))
        data.taskDependencies.push({ taskId, dependsOnId })
      toastError(e)
      return false
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

  /** 연관으로 더 걸 수 있는 작업 — 같은 프로젝트에서 자기 · 이미 건 것을 뺀다 */
  function relatedOptionsFor(taskId: string): Task[] {
    const already = new Set(findTask(taskId)?.relatedIds ?? [])
    return tasks.value.filter((t) => t.id !== taskId && !already.has(t.id))
  }

  function setTitle(taskId: string, title: string) {
    const task = findTask(taskId)
    if (!task || !title.trim()) return
    logPatch(task, { title: title.trim() })
    task.title = title.trim()
    patch(taskId, { title: task.title })
  }

  /* 목업 갈래가 서버처럼 연관 작업을 거른다 — 거절했으면 서버와 같은 코드로 알리고 true */
  function rejectRelated(task: Task, ids: string[]) {
    if (!data.mock) return false
    const fail = (
      status: number,
      code: string,
      message: string,
      detail?: Record<string, string>,
    ) => {
      toastError(new api.ApiError(status, { code, message, ...(detail ? { detail } : {}) }))
      return true
    }
    if (ids.length > RELATED_LIMIT)
      return fail(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', {
        relatedIds: `연관 작업은 ${RELATED_LIMIT}개까지입니다.`,
      })
    if (ids.includes(task.id))
      return fail(400, 'TASK_RELATED_SELF', '자기 자신은 연관 작업으로 걸 수 없습니다.')
    const own = (id: string) =>
      data.allTasks.some((t) => t.id === id && t.projectId === task.projectId)
    if (!ids.every(own)) return fail(400, 'TASK_RELATED_NOT_FOUND', '연관 작업을 찾을 수 없습니다.')
    return false
  }

  /**
   * 연관 작업을 통째로 갈아끼운다(PATCH relatedIds). 중복은 한 번으로 친다.
   * 화면에 먼저 놓는 순서는 '건 순서' — 남는 것은 제자리, 새로 건 것은 뒤. 서버 응답이 오면 그것으로 갈아끼운다
   */
  function setRelated(taskId: string, relatedIds: string[]) {
    const task = findTask(taskId)
    if (!task) return
    const ids = [...new Set(relatedIds)]
    if (rejectRelated(task, ids)) return
    const next = [
      ...task.relatedIds.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !task.relatedIds.includes(id)),
    ]
    /* 같은 집합이면 보낼 것이 없다 — 서버도 이력을 안 남긴다 */
    if (next.length === task.relatedIds.length && next.every((id, i) => id === task.relatedIds[i]))
      return
    logPatch(task, { relatedIds: next })
    task.relatedIds = next
    patch(taskId, { relatedIds: ids })
  }

  /** 여럿을 한 번에 더 건다 — 건 순서 뒤에 붙는다 */
  function addRelated(taskId: string, ids: string[]) {
    const task = findTask(taskId)
    if (!task) return
    const next = [...task.relatedIds, ...ids.filter((id) => !task.relatedIds.includes(id))]
    if (next.length !== task.relatedIds.length) setRelated(taskId, next)
  }

  function removeRelated(taskId: string, relatedId: string) {
    const task = findTask(taskId)
    if (!task || !task.relatedIds.includes(relatedId)) return
    setRelated(
      taskId,
      task.relatedIds.filter((id) => id !== relatedId),
    )
  }

  /** 파트를 바꾼다(null 은 공통) */
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
    /* partId 를 안 보냈으면 공통이다 (Q61) */
    const partId = input.partId ?? null
    if (data.rejectPart(partId)) return null
    const id = data.nextId('nk')
    const createdAt = nowIso()
    data.allTasks.push({
      id,
      projectId: data.currentProjectId,
      /* 목업에서는 키를 프로젝트의 접두사와 다음 번호로 세운다 — 서버 모드는 서버가 낸다 */
      key: data.takeTaskKey(data.currentProjectId),
      title: input.title,
      relatedIds: [],
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
    relatedLabel,
    relatedOptionsFor,
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
    setRelated,
    addRelated,
    removeRelated,
    setPriority,
    setPart,
    setBody,
    addTask,
    addTaskBatch,
    linkThread,
    unlinkThread,
    dependencies,
    dependsOnOf,
    dependentsOf,
    dependencyChoicesFor,
    addDependency,
    removeDependency,
  }
})

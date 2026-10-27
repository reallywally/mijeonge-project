import {
  isDayOrNull,
  isRecord,
  MOCK_STEP_MS,
  postSseMessages,
  settle,
  sleep,
  toProposedTask,
  type SseMessage,
} from '@/api/chat'
import { id, mockError, request, unreachable } from '@/api/client'
import { recordMockHistory } from '@/api/history'
import { forbidden, later, mockDb, mockWorld, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { mockMinutesDraft, mockMinutesTools, projects } from '@/fixtures'
import { canDeleteComment, canEditComment, canSeeProject } from '@/lib/access'
import { nowIso } from '@/lib/date'
import { change } from '@/lib/history'
import { compareMinutes, minutesApplyProblems, minutesInputProblems } from '@/lib/minutes'
import { inheritedPartId } from '@/lib/part'
import type {
  Entry,
  Me,
  Minutes,
  MinutesApplyInput,
  MinutesApplyResult,
  MinutesDraft,
  MinutesEvent,
  MinutesInput,
  MinutesItem,
  ProposedEntry,
  ProposedEntryBody,
  ProposedMinutesTask,
  ProposedThread,
  Task,
  TaskThreadLink,
  Thread,
} from '@/types/domain'

/* 회의록 (docs/api/minutes.md). 게시판(쓰기 · 읽기 · 고치기 · 지우기)과, 저장된 회의록 하나의 [AI 정리].
   draft 는 챗봇과 같은 SSE 틀(event 줄이 type, 스트림 전 오류는 ApiErrorBody), apply 는 한 트랜잭션.
   목업 갈래도 서버와 같은 검사 · 같은 생성 순서로 답한다 */

const invalid = (detail?: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

/* ── 게시판 ──────────────────────────────────────────── */

const notFound = () => mockError(404, 'MINUTES_NOT_FOUND', '회의록을 찾을 수 없습니다.')

/** 부여받지 않은 프로젝트의 회의록은 없는 것처럼 404 */
function requireMinutes(me: Me, minutesId: string): Minutes {
  const row = mockDb().minutes.find((m) => m.id === minutesId)
  if (!row || !canSeeProject(me, row.projectId)) throw notFound()
  return row
}

const itemOf = (m: Minutes): MinutesItem => ({
  id: m.id,
  projectId: m.projectId,
  title: m.title,
  meetingDate: m.meetingDate,
  authorId: m.authorId,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
})

/* 서버 응답처럼 늘 새 객체를 낸다 — 스토어가 받은 것을 고쳐도 목업 저장소가 따라 바뀌지 않게 */
const mock = {
  list(projectId: string): MinutesItem[] {
    requireProject(requireMe(), projectId)
    const rows = mockDb().minutes
    /* 같은 회의 날짜 · 같은 시각이면 나중에 넣은 것(seq) 먼저 */
    return rows
      .map((m, seq) => ({ m, seq }))
      .filter(({ m }) => m.projectId === projectId)
      .sort((a, b) => compareMinutes(a.m, b.m) || b.seq - a.seq)
      .map(({ m }) => itemOf(m))
  },
  create(projectId: string, input: MinutesInput): Minutes {
    /* 작성자는 로그인한 사람이다 — 요청에 실린 것을 믿지 않는다 */
    const me = requireMe()
    requireProject(me, projectId)
    const problems = minutesInputProblems(input)
    if (Object.keys(problems).length > 0) throw invalid(problems)
    const db = mockDb()
    db.minutesSeq += 1
    const at = nowIso()
    const row: Minutes = {
      id: `mm${db.minutesSeq}`,
      projectId,
      title: input.title.trim(),
      /* 빠져 와도 null 로 받는다 */
      meetingDate: input.meetingDate ?? null,
      authorId: me.id,
      createdAt: at,
      updatedAt: at,
      body: input.body.trim(),
      summary: '',
    }
    db.minutes.push(row)
    return structuredClone(row)
  },
  get: (minutesId: string): Minutes => structuredClone(requireMinutes(requireMe(), minutesId)),
  patch(minutesId: string, patch: Partial<MinutesInput>): Minutes {
    const me = requireMe()
    const row = requireMinutes(me, minutesId)
    if (!canEditComment(me, row)) throw forbidden()
    const problems = minutesInputProblems(patch)
    if (Object.keys(problems).length > 0) throw invalid(problems)
    const sent = (['title', 'meetingDate', 'body'] as const).filter((k) => patch[k] !== undefined)
    if (patch.title != null) row.title = patch.title.trim()
    if (patch.meetingDate !== undefined) row.meetingDate = patch.meetingDate
    if (patch.body != null) row.body = patch.body.trim()
    /* 보낸 칸이 없으면 고친 것이 아니다 */
    if (sent.length > 0) row.updatedAt = nowIso()
    return structuredClone(row)
  },
  /** 회의록만 지운다 — 출처를 단 줄의 minutesId 를 비우는 것은 스토어가 서버 모드와 같은 길로 한다 */
  remove(minutesId: string) {
    const me = requireMe()
    const row = requireMinutes(me, minutesId)
    if (!canDeleteComment(me, row, row.projectId)) throw forbidden()
    const db = mockDb()
    db.minutes = db.minutes.filter((m) => m.id !== minutesId)
  },
}

/** 그 프로젝트의 회의록 전부 — 본문 · 요약 없이, 회의 날짜 내림차순(없으면 맨 뒤) → 나중에 쓴 것 먼저 */
export const fetchMinutesList = (projectId: string) =>
  isMockMode()
    ? later(() => mock.list(projectId))
    : request<MinutesItem[]>('GET', `/projects/${id(projectId)}/minutes`)

/** 쓰기 — 작성자는 로그인한 사람 */
export const createMinutes = (projectId: string, input: MinutesInput) =>
  isMockMode()
    ? later(() => mock.create(projectId, input))
    : request<Minutes>('POST', `/projects/${id(projectId)}/minutes`, input)

export const fetchMinutes = (minutesId: string) =>
  isMockMode()
    ? later(() => mock.get(minutesId))
    : request<Minutes>('GET', `/minutes/${id(minutesId)}`)

/** 고치기 — 보낸 칸만. 작성자만(403) */
export const patchMinutes = (minutesId: string, patch: Partial<MinutesInput>) =>
  isMockMode()
    ? later(() => mock.patch(minutesId, patch))
    : request<Minutes>('PATCH', `/minutes/${id(minutesId)}`, patch)

/** 지우기 — 작성자 · 프로젝트 관리자 · 시스템 관리자(403). 거기서 나온 줄은 남고 minutesId 만 null 이 된다 */
export const deleteMinutes = (minutesId: string) =>
  isMockMode()
    ? later(() => mock.remove(minutesId))
    : request<void>('DELETE', `/minutes/${id(minutesId)}`)

/* ── draft ───────────────────────────────────────────── */

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** 아는 칸만 옮긴다 — 화면이 고쳐서 그대로 apply 로 돌려보내므로 모르는 칸을 싣지 않는다 */
function toEntryBody(v: unknown): ProposedEntryBody | null {
  if (!isRecord(v)) return null
  const { kind, ownerId } = v
  const text = str(v.text)
  const note = str(v.note)
  const ownerHint = str(v.ownerHint)
  const detail = strings(v.detail)
  if (kind !== 'decide' && kind !== 'defer' && kind !== 'refine') return null
  if (text === null || note === null || ownerHint === null || detail === null) return null
  if (ownerId !== null && typeof ownerId !== 'string') return null
  return { kind, text, detail, note, ownerId, ownerHint }
}

function toThread(v: unknown): ProposedThread | null {
  if (!isRecord(v)) return null
  const [tempId, title, description, ownerHint, quote] = [
    v.tempId,
    v.title,
    v.description,
    v.ownerHint,
    v.quote,
  ].map(str)
  const options = strings(v.options)
  const { ownerId, dueDate } = v
  const entry = v.entry === null ? null : toEntryBody(v.entry)
  if (tempId === null || title === null || description === null) return null
  if (ownerHint === null || quote === null || options === null) return null
  if (ownerId !== null && typeof ownerId !== 'string') return null
  if (!isDayOrNull(dueDate) || (v.entry !== null && entry === null)) return null
  return { tempId, title, description, options, ownerId, ownerHint, dueDate, entry, quote }
}

function toEntry(v: unknown): ProposedEntry | null {
  const body = toEntryBody(v)
  if (!body || !isRecord(v)) return null
  const [tempId, threadId, quote] = [v.tempId, v.threadId, v.quote].map(str)
  if (tempId === null || threadId === null || quote === null) return null
  return { ...body, tempId, threadId, quote }
}

function toTask(v: unknown): ProposedMinutesTask | null {
  const task = toProposedTask(v)
  if (!task || !isRecord(v)) return null
  const ownerHint = str(v.ownerHint)
  const quote = str(v.quote)
  const threadTempIds = strings(v.threadTempIds)
  const threadIds = strings(v.threadIds)
  if (ownerHint === null || quote === null || threadTempIds === null || threadIds === null)
    return null
  return { ...task, ownerHint, threadTempIds, threadIds, quote }
}

function every<T>(v: unknown, to: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map(to)
  return out.every((x): x is T => x !== null) ? out : null
}

function toDraft(v: unknown): MinutesDraft | null {
  if (!isRecord(v) || !isDayOrNull(v.meetingDate) || typeof v.summary !== 'string') return null
  const threads = every(v.threads, toThread)
  const entries = every(v.entries, toEntry)
  const tasks = every(v.tasks, toTask)
  if (!threads || !entries || !tasks) return null
  return { meetingDate: v.meetingDate, summary: v.summary, threads, entries, tasks }
}

/** event 줄이 type 이다. 모르는 event 는 건너뛰고(null), 아는 event 의 data 가 모양이 아니면 깨진 스트림이다 */
export function toMinutesEvent({ event, data }: SseMessage, status = 200): MinutesEvent | null {
  if (!['tool', 'draft', 'done', 'error'].includes(event)) return null
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    throw unreachable(status)
  }
  if (isRecord(body)) {
    if (event === 'tool' && typeof body.label === 'string')
      return {
        type: 'tool',
        name: typeof body.name === 'string' ? body.name : '',
        label: body.label,
      }
    if (event === 'draft') {
      const draft = toDraft(body.draft)
      if (draft) return { type: 'draft', draft }
    }
    if (event === 'done') return { type: 'done' }
    if (event === 'error' && typeof body.code === 'string' && typeof body.message === 'string')
      return { type: 'error', code: body.code, message: body.message }
  }
  throw unreachable(status)
}

async function* serverDraft(minutesId: string, signal: AbortSignal) {
  /* 저장된 본문으로 정리한다 — 본문을 싣지 않는다 */
  const path = `/minutes/${id(minutesId)}/draft`
  for await (const { message, status } of postSseMessages(path, undefined, signal)) {
    const event = toMinutesEvent(message, status)
    if (event) yield event
  }
}

/** 회의록과 상관없이 고정 초안을 진행 줄 둘과 함께 흘린다. 회의록이 있는지는 서버처럼 스트림 전에 본다 */
async function* mockDraft(minutesId: string, signal: AbortSignal): AsyncGenerator<MinutesEvent> {
  await later(() => requireMinutes(requireMe(), minutesId))
  for (const tool of mockMinutesTools) {
    await sleep(MOCK_STEP_MS * 3, signal)
    yield { type: 'tool', ...tool }
  }
  await sleep(MOCK_STEP_MS * 3, signal)
  yield { type: 'draft', draft: structuredClone(mockMinutesDraft) }
  yield { type: 'done' }
}

/** 계약의 끝맺음에 하나를 더한다 — 초안은 꼭 한 번 done 보다 먼저. 없이 done 이면 깨진 스트림이다 */
async function* needDraft(events: AsyncIterable<MinutesEvent>): AsyncGenerator<MinutesEvent> {
  let drafted = false
  for await (const event of events) {
    if (event.type === 'draft') drafted = true
    if (event.type === 'done' && !drafted) throw unreachable(200)
    yield event
  }
}

/** 저장된 회의록 → 초안. tool … → draft → done. 멈추면 AbortError(DOMException)로 끝난다. 아무것도 남지 않는다 */
export async function* streamMinutesDraft(
  minutesId: string,
  signal: AbortSignal,
): AsyncGenerator<MinutesEvent> {
  const events = isMockMode() ? mockDraft(minutesId, signal) : serverDraft(minutesId, signal)
  yield* needDraft(settle(events))
}

/* ── apply ───────────────────────────────────────────── */

let mockSeq = 0

export function resetMockMinutes() {
  mockSeq = 0
}

const nextId = (prefix: string) => {
  mockSeq += 1
  return `${prefix}${mockSeq}`
}

/** 한 코드로 걸린 자리 전부를 detail 로 — 하나라도 있으면 400 */
function reject(code: string, message: string, detail: Record<string, string>) {
  if (Object.keys(detail).length > 0) throw mockError(400, code, message, detail)
}

/**
 * 서버와 같은 순서로 본다 — 404 회의록 → 422 모양 → 400 안건 → 400 담당자(안건 → 이력 → 작업) → 400 상위 작업.
 * 만들 때는 새 안건(queued · 공통) → 그 이력 → 기존 안건의 이력 → 작업(todo · 본문 [] · key 배열 순) → 링크.
 * 만든 것에는 minutesId 를 달고, 회의록 요약을 저장한다(목업 서버의 것).
 * 안건 · 이력 · 작업 데이터는 고치지 않고 결과만 낸다 — 넣는 것은 스토어가 서버 모드와 같은 길로 한다
 */
function mockApply(minutesId: string, input: MinutesApplyInput): MinutesApplyResult {
  const minutes = requireMinutes(requireMe(), minutesId)
  const projectId = minutes.projectId
  const shape = minutesApplyProblems(input)
  if (Object.keys(shape).length > 0) throw invalid(shape)

  const world = mockWorld()
  const ownThread = (threadId: string) =>
    world.threads.find((t) => t.id === threadId && t.projectId === projectId)
  const notFound: Record<string, string> = {}
  input.entries.forEach((e, i) => {
    if (!ownThread(e.threadId)) notFound[`entries.${i}.threadId`] = '안건을 찾을 수 없습니다.'
  })
  input.tasks.forEach((t, i) =>
    t.threadIds.forEach((threadId, j) => {
      if (!ownThread(threadId)) notFound[`tasks.${i}.threadIds.${j}`] = '안건을 찾을 수 없습니다.'
    }),
  )
  reject('THREAD_NOT_FOUND', '안건을 찾을 수 없습니다.', notFound)

  /* 새로 지정하는 담당자는 그 프로젝트의 활성 멤버 — 안건 담당자를 그대로 적는 이력 줄은 새 지정이 아니다 */
  const db = mockDb()
  const assignable = (ownerId: string | null, kept: string | null = null) =>
    ownerId === null ||
    ownerId === kept ||
    (db.members.some((m) => m.id === ownerId && m.active) &&
      db.grants.some((g) => g.projectId === projectId && g.memberId === ownerId))
  const lost = '담당자를 찾을 수 없습니다.'
  const threadOwners: Record<string, string> = {}
  input.threads.forEach((t, i) => {
    if (!assignable(t.ownerId)) threadOwners[`threads.${i}.ownerId`] = lost
  })
  reject('THREAD_OWNER_NOT_FOUND', lost, threadOwners)
  const entryOwners: Record<string, string> = {}
  input.threads.forEach((t, i) => {
    if (t.entry && !assignable(t.entry.ownerId, t.ownerId))
      entryOwners[`threads.${i}.entry.ownerId`] = lost
  })
  input.entries.forEach((e, i) => {
    if (!assignable(e.ownerId, ownThread(e.threadId)?.ownerId ?? null))
      entryOwners[`entries.${i}.ownerId`] = lost
  })
  reject('ENTRY_OWNER_NOT_FOUND', lost, entryOwners)
  const taskOwners: Record<string, string> = {}
  input.tasks.forEach((t, i) => {
    if (!assignable(t.ownerId)) taskOwners[`tasks.${i}.ownerId`] = lost
  })
  reject('TASK_OWNER_NOT_FOUND', lost, taskOwners)

  const ownTask = (taskId: string) =>
    world.tasks.find((t) => t.id === taskId && t.projectId === projectId)
  const orphans: Record<string, string> = {}
  input.tasks.forEach((t, i) => {
    if (t.parentId !== null && !ownTask(t.parentId))
      orphans[`tasks.${i}.parentId`] = '상위 작업을 찾을 수 없습니다.'
  })
  reject('TASK_PARENT_NOT_FOUND', '상위 작업을 찾을 수 없습니다.', orphans)

  const createdAt = nowIso()
  const clean = (lines: string[]) => lines.map((s) => s.trim()).filter(Boolean)
  const toEntryRow = (threadId: string, e: ProposedEntryBody): Entry => ({
    id: nextId('mne'),
    threadId,
    kind: e.kind,
    text: e.text.trim(),
    detail: clean(e.detail),
    note: e.note.trim(),
    ownerId: e.ownerId,
    createdAt,
    minutesId,
  })
  /* 이력이 안건에 남기는 흔적 — POST /threads/{id}/entries 와 같다 */
  const touch = (thread: Thread, e: ProposedEntryBody) => {
    if (e.kind === 'decide') {
      thread.state = 'decided'
      if (e.ownerId) thread.ownerId = e.ownerId
    } else if (thread.state === 'queued') thread.state = 'open'
  }

  const threadIdByTempId: Record<string, string> = {}
  const threads: Thread[] = input.threads.map((t) => {
    const thread: Thread = {
      id: nextId('mnt'),
      projectId,
      title: t.title.trim(),
      description: t.description.trim(),
      options: clean(t.options),
      dueDate: t.dueDate,
      state: 'queued',
      ownerId: t.ownerId,
      parentThreadId: null,
      partId: null,
      ccIds: [],
      createdAt,
      minutesId,
    }
    threadIdByTempId[t.tempId] = thread.id
    return thread
  })

  const entries: Entry[] = []
  input.threads.forEach((t, i) => {
    if (!t.entry) return
    entries.push(toEntryRow(threads[i].id, t.entry))
    touch(threads[i], t.entry)
  })

  const updatedThreads: Thread[] = []
  for (const e of input.entries) {
    const before = ownThread(e.threadId)!
    /* 데이터 스토어의 반응형 객체라 structuredClone 을 못 쓴다 — 칸을 떠서 고친다 */
    const after: Thread = { ...before, options: [...before.options], ccIds: [...before.ccIds] }
    entries.push(toEntryRow(after.id, e))
    touch(after, e)
    if (after.state !== before.state || after.ownerId !== before.ownerId) updatedThreads.push(after)
  }

  const prefix = projects.find((p) => p.id === projectId)?.taskKeyPrefix ?? 'TASK'
  let no = world.tasks
    .filter((t) => t.projectId === projectId)
    .reduce((max, t) => Math.max(max, Number(t.key.split('-').pop()) || 0), 0)
  const taskIdByTempId: Record<string, string> = {}
  const madeByTempId: Record<string, Task> = {}
  const tasks: Task[] = input.tasks.map((t) => {
    const parent =
      t.parentTempId !== null
        ? madeByTempId[t.parentTempId]
        : t.parentId
          ? ownTask(t.parentId)!
          : null
    no += 1
    const task: Task = {
      id: nextId('mnk'),
      projectId,
      key: `${prefix}-${no}`,
      title: t.title.trim(),
      parentId: parent?.id ?? null,
      body: [],
      status: 'todo',
      ownerId: t.ownerId,
      start: t.start,
      due: t.due,
      priority: t.priority,
      partId: inheritedPartId(undefined, parent),
      createdAt,
      commentCount: 0,
      minutesId,
      /* 만들 때도 상태 기록이 한 줄 남는다 (docs/api/task-flow.md) */
      statusChangedAt: createdAt,
      statusSinceBackfill: false,
    }
    taskIdByTempId[t.tempId] = task.id
    madeByTempId[t.tempId] = task
    return task
  })

  const links: TaskThreadLink[] = []
  input.tasks.forEach((t, i) => {
    const threadIds = [...t.threadTempIds.map((tempId) => threadIdByTempId[tempId]), ...t.threadIds]
    for (const threadId of new Set(threadIds)) links.push({ taskId: tasks[i].id, threadId })
  })

  /* 등록 때 함께 건 안건은 created 에 든 것으로 본다 — 따로 줄을 안 만든다 */
  for (const t of tasks) recordMockHistory('task', t.id, [change('created', null, null)])

  /* 안 보냈거나 null 이면 지금 요약 그대로. 요약은 사람이 고친 것이 아니라 updatedAt 은 그대로 */
  if (input.summary != null) minutes.summary = input.summary.trim()

  return { threads, entries, updatedThreads, tasks, links, threadIdByTempId, taskIdByTempId }
}

/** 고른 초안을 한 번에 등록한다 — 한 트랜잭션이라 하나라도 틀리면 아무것도 안 남는다. 만든 것에 출처가 붙는다 */
export const applyMinutes = (minutesId: string, input: MinutesApplyInput) =>
  isMockMode()
    ? later(() => mockApply(minutesId, input))
    : request<MinutesApplyResult>('POST', `/minutes/${id(minutesId)}/apply`, input)

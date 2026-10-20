import type { ApiError } from '@/api/client'
import type {
  Entry,
  MinutesApplyInput,
  MinutesDraft,
  MinutesInput,
  MinutesItem,
  ProposedEntry,
  ProposedEntryBody,
  ProposedMinutesTask,
  ProposedThread,
  Task,
  Thread,
} from '@/types/domain'

/* 회의록 (docs/api/minutes.md) — 목업 api 와 화면이 같이 쓰는 규칙 */

/** 본문 상한 — 앞뒤 공백을 뗀 뒤 센다 */
export const MINUTES_MAX_CHARS = 60_000

/** 제목 상한 — 앞뒤 공백을 뗀 뒤 센다 */
export const MINUTES_TITLE_MAX = 200

/** apply 한 번에 넣을 수 있는 수. 셋 합은 1 이상 */
export const MINUTES_MAX = { threads: 20, entries: 20, tasks: 30 } as const

const KINDS: ProposedEntryBody['kind'][] = ['decide', 'defer', 'refine']

/** 글자 수 — 화면의 'N / 60,000' 과 서버 검사가 같은 수를 보게 앞뒤 공백을 떼고 센다 */
export const minutesLength = (text: string) => text.trim().length

/** 보낼 수 있는 글인가 — 1 ~ 60,000자 */
export const minutesTextOk = (text: string) => {
  const n = minutesLength(text)
  return n >= 1 && n <= MINUTES_MAX_CHARS
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

/**
 * 쓰기 · 고치기의 검사 — 보낸 칸만 본다(PATCH 는 보낸 칸만 바꾼다). 어긋난 칸 → 한 줄(422 detail 과 같은 자리).
 * 화면은 [저장] 을 막는 데, 목업 api 는 422 를 내는 데 같이 쓴다
 */
export function minutesInputProblems(
  input: Partial<Record<keyof MinutesInput, string | null>>,
): Record<string, string> {
  const detail: Record<string, string> = {}
  /* title · body 의 null 은 비우기가 아니라 422 다(서버 '구현'). meetingDate 의 null 은 비우기 */
  if (input.title !== undefined) {
    const n = (input.title ?? '').trim().length
    if (n === 0) detail.title = '제목을 적어 주세요.'
    else if (n > MINUTES_TITLE_MAX) detail.title = `제목은 ${MINUTES_TITLE_MAX}자까지입니다.`
  }
  if (input.body !== undefined) {
    const n = minutesLength(input.body ?? '')
    if (n === 0) detail.body = '회의록 본문을 적어 주세요.'
    else if (n > MINUTES_MAX_CHARS)
      detail.body = `본문은 ${MINUTES_MAX_CHARS.toLocaleString('ko-KR')}자까지입니다.`
  }
  if (input.meetingDate !== undefined && input.meetingDate !== null && !isDay(input.meetingDate))
    detail.meetingDate = '회의 날짜는 YYYY-MM-DD 입니다.'
  return detail
}

/** 목록 순서 — 회의 날짜 내림차순(없으면 맨 뒤), 같으면 나중에 쓴 것 먼저. 서버는 seq 로, 화면은 쓴 시각으로 가른다 */
export function compareMinutes(a: MinutesItem, b: MinutesItem): number {
  if (a.meetingDate !== b.meetingDate) {
    if (a.meetingDate === null) return 1
    if (b.meetingDate === null) return -1
    return a.meetingDate < b.meetingDate ? 1 : -1
  }
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

/** 이 회의록에서 나온 것 — 스냅샷을 minutesId 로 거른다(따로 API 가 없다) */
export interface MinutesOutcome {
  threads: Thread[]
  entries: Entry[]
  tasks: Task[]
}

export function minutesOutcome(
  minutesId: string,
  records: { threads: Thread[]; entries: Entry[]; tasks: Task[] },
): MinutesOutcome {
  return {
    threads: records.threads.filter((t) => t.minutesId === minutesId),
    entries: records.entries.filter((e) => e.minutesId === minutesId),
    tasks: records.tasks.filter((t) => t.minutesId === minutesId),
  }
}

export const outcomeCount = (o: MinutesOutcome) =>
  o.threads.length + o.entries.length + o.tasks.length

/**
 * apply 의 검사 규칙 중 DB 를 안 보는 것 — 어긋난 자리를 `threads.0.title` 처럼 한 번에 모은다(422 detail).
 * 안건 · 담당자 · 상위 작업이 있는지는 목업 api 가 데이터를 보고 따로 본다
 */
export function minutesApplyProblems(input: MinutesApplyInput): Record<string, string> {
  const detail: Record<string, string> = {}
  const { threads, entries, tasks } = input
  /* 요약 — null 은 안 보낸 것과 같다. 상한은 본문과 같다 */
  if (input.summary != null && minutesLength(input.summary) > MINUTES_MAX_CHARS)
    detail.summary = `요약은 ${MINUTES_MAX_CHARS.toLocaleString('ko-KR')}자까지입니다.`
  if (threads.length + entries.length + tasks.length === 0)
    /* 어느 묶음의 자리가 아니라 요청 전체 — 서버 오류 처리기가 쓰는 이름 그대로 (minutes.md '구현') */
    detail['요청'] = '새 안건 · 이력 · 작업 중 하나는 골라야 합니다.'
  if (threads.length > MINUTES_MAX.threads)
    detail.threads = `새 안건은 ${MINUTES_MAX.threads}개까지입니다.`
  if (entries.length > MINUTES_MAX.entries)
    detail.entries = `이력은 ${MINUTES_MAX.entries}개까지입니다.`
  if (tasks.length > MINUTES_MAX.tasks) detail.tasks = `작업은 ${MINUTES_MAX.tasks}개까지입니다.`

  /* tempId 는 세 묶음 전체에서 서로 달라야 한다 */
  const seen = new Set<string>()
  const claim = (at: string, tempId: string) => {
    if (!tempId.trim()) detail[`${at}.tempId`] = '임시 이름이 비었습니다.'
    else if (seen.has(tempId)) detail[`${at}.tempId`] = '임시 이름이 겹칩니다.'
    seen.add(tempId)
  }
  const body = (at: string, e: ProposedEntryBody) => {
    if (!KINDS.includes(e.kind)) detail[`${at}.kind`] = '결정 · 미룸 · 세부 추가 중 하나입니다.'
    if (!e.text.trim()) detail[`${at}.text`] = '내용을 적어 주세요.'
  }

  threads.forEach((t, i) => {
    claim(`threads.${i}`, t.tempId)
    if (!t.title.trim()) detail[`threads.${i}.title`] = '제목을 적어 주세요.'
    if (t.entry) body(`threads.${i}.entry`, t.entry)
  })

  const threadOnce = new Set<string>()
  entries.forEach((e, i) => {
    claim(`entries.${i}`, e.tempId)
    body(`entries.${i}`, e)
    if (threadOnce.has(e.threadId))
      detail[`entries.${i}.threadId`] = '한 안건에 이력은 하나까지입니다.'
    threadOnce.add(e.threadId)
  })

  const newThreads = new Set(threads.map((t) => t.tempId))
  const earlier = new Set<string>()
  tasks.forEach((t, i) => {
    const at = `tasks.${i}`
    claim(at, t.tempId)
    if (t.parentTempId !== null && !earlier.has(t.parentTempId))
      detail[`${at}.parentTempId`] = '상위 작업은 이 작업보다 앞에 있어야 합니다.'
    if (t.parentTempId !== null && t.parentId !== null)
      detail[`${at}.parentId`] = '상위는 parentTempId 와 parentId 중 하나만 둡니다.'
    if (!t.title.trim()) detail[`${at}.title`] = '제목을 적어 주세요.'
    if (t.start && t.due && t.start > t.due) detail[`${at}.due`] = '마감이 시작보다 빠릅니다.'
    t.threadTempIds.forEach((tempId, j) => {
      if (!newThreads.has(tempId))
        detail[`${at}.threadTempIds.${j}`] = '이 초안의 새 안건이 아닙니다.'
    })
    earlier.add(t.tempId)
  })
  return detail
}

/* 보낼 때는 반응형 객체를 떼고 계약의 칸만 새로 — 담당자를 골랐으면 부른 말(ownerHint)은 비운다(규칙: ownerId 가 null 일 때만) */
const hintOf = (ownerId: string | null, hint: string) => (ownerId === null ? hint : '')

function plainBody(e: ProposedEntryBody): ProposedEntryBody {
  return {
    kind: e.kind,
    text: e.text,
    detail: [...e.detail],
    note: e.note,
    ownerId: e.ownerId,
    ownerHint: hintOf(e.ownerId, e.ownerHint),
  }
}

/**
 * 고른 줄만 apply 모양으로. 빠진 새 안건을 가리키는 threadTempIds 는 지운다(남아 있으면 422).
 * 상위 작업이 빠진 작업은 최상위로 들어간다 — parentTempId 가 보내지 않는 줄을 가리키면 422 다
 */
export function toMinutesApplyInput(
  form: Pick<MinutesDraft, 'summary' | 'threads' | 'entries' | 'tasks'>,
  picked: Record<string, boolean>,
): MinutesApplyInput {
  const on = (tempId: string) => picked[tempId] === true
  const threads: ProposedThread[] = form.threads
    .filter((t) => on(t.tempId))
    .map((t) => ({
      tempId: t.tempId,
      title: t.title,
      description: t.description,
      options: [...t.options],
      ownerId: t.ownerId,
      ownerHint: hintOf(t.ownerId, t.ownerHint),
      dueDate: t.dueDate || null,
      entry: t.entry ? plainBody(t.entry) : null,
      quote: t.quote,
    }))
  const entries: ProposedEntry[] = form.entries
    .filter((e) => on(e.tempId))
    .map((e) => ({ ...plainBody(e), tempId: e.tempId, threadId: e.threadId, quote: e.quote }))
  const kept = new Set(threads.map((t) => t.tempId))
  const sentTasks = new Set<string>()
  const tasks: ProposedMinutesTask[] = []
  for (const t of form.tasks) {
    if (!on(t.tempId)) continue
    tasks.push({
      tempId: t.tempId,
      parentTempId:
        t.parentTempId !== null && sentTasks.has(t.parentTempId) ? t.parentTempId : null,
      parentId: t.parentId,
      title: t.title,
      ownerId: t.ownerId,
      ownerHint: hintOf(t.ownerId, t.ownerHint),
      start: t.start || null,
      due: t.due || null,
      priority: t.priority,
      threadTempIds: t.threadTempIds.filter((id) => kept.has(id)),
      threadIds: [...t.threadIds],
      quote: t.quote,
    })
    sentTasks.add(t.tempId)
  }
  return { summary: form.summary, threads, entries, tasks }
}

/**
 * apply 오류의 detail(`tasks.2.title`)을 보낸 줄의 tempId 로 옮긴다 — 화면은 고른 줄만 보내서 번호가 초안과 다르다.
 * 자리를 못 짚는 키(`threads`)는 버린다. 한 줄에 여럿이면 처음 것 하나
 */
export function minutesErrorsByTempId(
  detail: Record<string, string> | undefined,
  input: MinutesApplyInput,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(detail ?? {})) {
    const [group, index] = key.split('.')
    const list =
      group === 'threads'
        ? input.threads
        : group === 'entries'
          ? input.entries
          : group === 'tasks'
            ? input.tasks
            : null
    const tempId = list?.[Number(index)]?.tempId
    if (tempId && !(tempId in out)) out[tempId] = message
  }
  return out
}

/* 서버 message 는 그대로 띄울 한국어 한 줄이다. 비었을 때만 이것을 쓴다 */
const FALLBACK: Record<string, string> = {
  MINUTES_EMPTY: '회의록에서 정할 것 · 할 일을 찾지 못했습니다.',
  MINUTES_NOT_FOUND: '회의록을 찾을 수 없습니다.',
  MINUTES_DRAFT_FAILED: '초안을 만들지 못했습니다. 다시 정리해 주세요.',
  CHAT_UNAVAILABLE: 'AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 정리해 주세요.',
  CHAT_RATE_LIMITED: '요청이 너무 잦습니다. 잠시 뒤에 다시 정리해 주세요.',
  CHAT_REFUSED: '이 회의록은 정리할 수 없습니다.',
  INTERNAL_ERROR: '서버에서 오류가 발생했습니다.',
}

/** 정리(draft) 실패를 띄울 한 줄. 스트림 중 오류는 status 가 200 이라 code 로 가른다 */
export function minutesErrorText(error: ApiError): string {
  switch (error.code) {
    case 'SERVER_UNREACHABLE':
      return error.status === 200
        ? '정리하다가 연결이 끊겼습니다. 다시 정리해 주세요.'
        : '서버에 연결할 수 없습니다. 잠시 뒤에 다시 정리해 주세요.'
    default:
      return error.message || FALLBACK[error.code] || '초안을 받지 못했습니다.'
  }
}

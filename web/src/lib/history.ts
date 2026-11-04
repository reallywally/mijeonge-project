import { slashDay } from '@/lib/date'
import { taskPriorityLabel, taskStatusLabel } from '@/lib/task'
import { testStatusLabel } from '@/lib/testcase'
import { AGENDA_STATE_LABEL } from '@/lib/agenda'
import type {
  AgendaState,
  HistoryChange,
  HistoryEntry,
  TaskLine,
  TaskPriority,
  TaskStatus,
  TestStatus,
  Agenda,
  AgendaPatch,
} from '@/types/domain'

/* 변경 이력 (docs/api/history.md). 서버는 값을 id 그대로 남기고 이름은 화면이 지금의 것으로 찾는다.
   목업 갈래가 서버처럼 줄을 남길 때 쓰는 비교도 여기 둔다 — 화면 말로 바꾸는 것과 같은 칸 표를 본다 */

export type HistoryKind = 'task' | 'test' | 'agenda'

/** 한 줄 안의 칸 순서 — 계약의 '칸' 표 순서 그대로 */
export const HISTORY_FIELDS: Record<HistoryKind, string[]> = {
  task: [
    'created',
    'title',
    'status',
    'priority',
    'ownerId',
    'partId',
    /* 연관 작업은 2026-10-28 걷었다(Q62) — 지난 이력 줄에만 있어 읽기는 둔다 */
    'relatedIds',
    'parentId',
    'start',
    'due',
    'body',
    'lineDone',
    'agenda',
    /* 선행 작업은 2026-10-28 걷었다(Q63) — 지난 이력 줄에만 있어 읽기는 둔다 */
    'dependsOn',
  ],
  test: [
    'created',
    'title',
    'content',
    'testData',
    /* 목적 · 사전조건 · 단계 · 실패한 단계는 2026-10-27 걷었다(Q60) — 지난 이력 줄에만 있어 읽기는 둔다 */
    'purpose',
    'precondition',
    'steps',
    'parentId',
    'ownerId',
    'partId',
    'start',
    'due',
    'status',
    'failedStep',
    'resultNote',
    'taskRef',
    'agendaRef',
    'basis',
  ],
  /* 2026-11-04 전 줄의 칸(options · ccIds · entry… · item…)은 화면이 모른다 — 그리지 않고 건너뛴다 (docs/api/agenda.md) */
  agenda: [
    'created',
    'deleted',
    'title',
    'description',
    'decision',
    'state',
    'ownerId',
    'partId',
    'dueDate',
  ],
}

type Value = HistoryChange['from']

export const change = (field: string, from: Value, to: Value, subject = ''): HistoryChange => ({
  field,
  from,
  to,
  subject,
})

/** 칸 표 순서로 놓는다. 표에 없는 칸은 뒤에 받은 순서대로 */
export function orderChanges(changes: HistoryChange[], kind: HistoryKind): HistoryChange[] {
  const order = HISTORY_FIELDS[kind]
  const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length)
  return changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.field) - rank(b.c.field) || a.i - b.i)
    .map((x) => x.c)
}

/**
 * 고친 요청(next)이 지금 값(before)에서 바꾼 칸 — 보낸 칸 가운데 값이 달라진 것만, 칸 표 순서로.
 * 값이 글 · 수 · 참거짓 · null 인 칸만 본다(본문은 따로 — bodyChanged)
 */
export function diffChanges(
  before: object,
  next: object,
  kind: HistoryKind,
  skip: string[] = [],
): HistoryChange[] {
  const b = before as Record<string, unknown>
  const out: HistoryChange[] = []
  for (const [field, raw] of Object.entries(next)) {
    if (raw === undefined || skip.includes(field)) continue
    const from = (b[field] ?? null) as Value
    const to = raw as Value
    if (from !== to) out.push(change(field, from, to))
  }
  return orderChanges(out, kind)
}

/** 안건 PATCH 한 번이 바꾼 칸 — 목업이 서버처럼 남긴다. 값은 이미 다듬은(trim) 것을 받는다 */
export function agendaPatchChanges(before: Agenda, patch: AgendaPatch): HistoryChange[] {
  return diffChanges(before, patch, 'agenda')
}

/** 본문이 바뀌었나 — 줄 글 · 종류 · 체크 · 들여쓰기 · 순서. 줄 id 는 안 본다(서버가 다시 붙인다) */
export function bodyChanged(a: TaskLine[], b: TaskLine[]) {
  return (
    a.length !== b.length ||
    a.some(
      (l, i) =>
        l.text !== b[i].text ||
        l.kind !== b[i].kind ||
        l.done !== b[i].done ||
        l.level !== b[i].level,
    )
  )
}

/**
 * 본문을 이력 값 글로 (docs/api/history.md '본문') — 줄마다 들여쓰기(level 당 공백 두 칸) + 표시 + 글,
 * '\n' 으로 잇는다. 줄이 없으면 null. 서버가 남기는 값과 같아야 목업 이력이 서버처럼 보인다
 */
export function bodyText(lines: TaskLine[]): string | null {
  if (lines.length === 0) return null
  const mark = (l: TaskLine) => (l.kind === 'bullet' ? '• ' : l.done ? '☑ ' : '☐ ')
  return lines.map((l) => `${'  '.repeat(l.level)}${mark(l)}${l.text}`).join('\n')
}

/** 본문 이력을 이어 고친 것으로 합치는 시간 — 마지막 줄이 이 안이면 그 줄을 고친다 */
export const BODY_MERGE_MS = 10 * 60_000

/**
 * 본문만 바꾼 요청이 마지막 이력 줄에 합쳐지나 — ① 같은 사람 ② 칸이 body 하나뿐 ③ 값이 있는 줄
 * ④ BODY_MERGE_MS 안. 값이 없는(2026-11-01 전) 줄과는 합치지 않는다
 */
export function mergesBody(last: HistoryEntry | undefined, by: string | null, now: number) {
  /* 누가 바꿨는지 모르면 같은 사람인지도 모른다 — 서버도 합치지 않는다 */
  if (by === null || !last || last.backfilled || last.changedBy !== by) return false
  if (last.changes.length !== 1) return false
  const c = last.changes[0]
  if (c.field !== 'body' || (c.from === null && c.to === null)) return false
  return now - Date.parse(last.changedAt) <= BODY_MERGE_MS
}

/* ── 화면 말 ─────────────────────────────────────────── */

/** 지금의 이름을 찾는 길 — 못 찾으면 null(지웠거나 못 보는 것) */
export interface HistoryNames {
  member: (id: string) => string | null
  part: (id: string) => string | null
  /** 작업 키(HW-4) */
  task: (id: string) => string | null
  /** 안건 제목 */
  agenda: (id: string) => string | null
  /** 테스트 키(HW-T3) */
  test: (id: string) => string | null
}

export const MISSING = '(삭제됨)'
/** 빈 본문 */
export const EMPTY_BODY = '(내용 없음)'
/** 긴 글은 이만큼만 보이고 펼친다 */
export const HISTORY_CLIP = 60

/** 칸 하나를 화면 말로. value 만 있으면 'label: value', from · to 가 있으면 'label: from → to', 다 없으면 label 만 */
export interface HistoryChangeView {
  field: string
  label: string
  from?: string
  to?: string
  value?: string
  /** 긴 글(테스트 내용 · 목적 · 사전조건 · 테스트 데이터 · 결과 메모 · 본문) — 줄여 보이고 펼친다 */
  long: boolean
  /** 여러 줄 글(본문) — 전 · 후를 한 줄에 잇지 않고 블록으로 위아래에 놓는다 */
  block?: boolean
}

export interface HistoryEntryView {
  id: string
  changedAt: string
  /** 바꾼 사람의 이름. 등록(이전 기록 없음) 줄은 사람 없이 null */
  who: string | null
  changes: HistoryChangeView[]
}

const LABEL: Record<HistoryKind, Record<string, string>> = {
  task: {
    title: '제목',
    status: '상태',
    priority: '우선순위',
    ownerId: '담당자',
    partId: '파트',
    relatedIds: '연관 작업',
    parentId: '상위 작업',
    start: '시작 날짜',
    due: '기한',
  },
  test: {
    title: '제목',
    content: '테스트 내용',
    purpose: '목적',
    precondition: '사전조건',
    testData: '테스트 데이터',
    parentId: '상위 테스트',
    ownerId: '담당자',
    partId: '파트',
    start: '시작 날짜',
    due: '기한',
    status: '상태',
    failedStep: '실패한 단계',
    resultNote: '결과 메모',
  },
  agenda: {
    title: '제목',
    description: '설명',
    decision: '결정내용',
    state: '상태',
    ownerId: '담당자',
    partId: '파트',
    dueDate: '기한',
  },
}

const LONG_FIELDS = new Set([
  'content',
  'purpose',
  'precondition',
  'testData',
  'resultNote',
  'description',
])

const str = (v: Value) => (v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v))

/** 값 하나를 화면 말로 — null 의 뜻은 칸마다 다르다 */
function valueText(kind: HistoryKind, field: string, v: Value, names: HistoryNames): string {
  const name = (found: string | null) => found ?? MISSING
  switch (field) {
    case 'state':
      return v === null ? '없음' : (AGENDA_STATE_LABEL[v as AgendaState] ?? str(v))
    case 'status':
      if (v === null) return '없음'
      return (
        (kind === 'task' ? taskStatusLabel(v as TaskStatus) : testStatusLabel(v as TestStatus)) ||
        str(v)
      )
    case 'priority':
      return v === null ? '없음' : taskPriorityLabel(v as TaskPriority) || str(v)
    case 'ownerId':
      return v === null ? '없음' : name(names.member(str(v)))
    case 'partId':
      return v === null ? '공통' : name(names.part(str(v)))
    case 'relatedIds': {
      const ids = Array.isArray(v) ? v : []
      return ids.length === 0 ? '없음' : ids.map((id) => name(names.task(id))).join(', ')
    }
    case 'parentId':
      if (v === null) return kind === 'task' ? '최상위 작업' : '최상위 테스트'
      return name(kind === 'task' ? names.task(str(v)) : names.test(str(v)))
    case 'start':
    case 'due':
      return v === null ? '미정' : slashDay(str(v))
    case 'dueDate':
      return v === null ? '없음' : slashDay(str(v))
    case 'failedStep':
      return v === null ? '없음' : `${v}단계`
    case 'resultNote':
      return v === null ? '없음' : str(v)
    default:
      return str(v) === '' ? '(비움)' : str(v)
  }
}

/** 걸기 · 떼기 칸 — 걸기는 null → id, 떼기는 id → null */
const LINK: Record<string, { noun: string; find: keyof HistoryNames }> = {
  agenda: { noun: '안건', find: 'agenda' },
  /* 선행 작업은 2026-10-28 걷었다(Q63) — 지난 이력 줄에만 */
  dependsOn: { noun: '선행 작업', find: 'task' },
  taskRef: { noun: '작업 태그', find: 'task' },
  agendaRef: { noun: '안건 태그', find: 'agenda' },
}

export function changeView(
  kind: HistoryKind,
  c: HistoryChange,
  names: HistoryNames,
  backfilled = false,
): HistoryChangeView {
  const base = { field: c.field, long: false }
  switch (c.field) {
    case 'created':
      return { ...base, label: backfilled ? '등록(이전 기록 없음)' : '등록' }
    case 'body':
      /* 2026-11-01 전 줄은 값 없이 '바뀌었다' 만 남았다(Q65) */
      if (c.from === null && c.to === null) return { ...base, label: '본문 고침' }
      return {
        ...base,
        label: '본문',
        from: c.from === null ? EMPTY_BODY : str(c.from),
        to: c.to === null ? EMPTY_BODY : str(c.to),
        long: true,
        block: true,
      }
    case 'steps': {
      const n = (v: Value) => Number(v ?? 0)
      return {
        ...base,
        label:
          n(c.from) === n(c.to)
            ? `단계 고침 (${n(c.to)}개)`
            : `단계 고침 (${n(c.from)} → ${n(c.to)}개)`,
      }
    }
    case 'lineDone':
      return { ...base, label: `${c.to === true ? '☑' : '☐'} ${c.subject}` }
    case 'basis':
      return { ...base, label: '기준 그대로 맞다 확인' }
    case 'deleted':
      return { ...base, label: '삭제' }
    case 'decision':
      /* 결정내용은 여러 줄 글 — 본문처럼 줄을 살려 전 · 후를 위아래에 놓는다 */
      if (kind !== 'agenda') break
      return {
        ...base,
        label: '결정내용',
        from: str(c.from) === '' ? '(비움)' : str(c.from),
        to: str(c.to) === '' ? '(비움)' : str(c.to),
        long: true,
        block: true,
      }
  }
  const link = LINK[c.field]
  if (link) {
    const id = str(c.to ?? c.from)
    return {
      ...base,
      label: `${link.noun} ${c.to !== null ? '걸기' : '떼기'}`,
      value: names[link.find](id) ?? MISSING,
    }
  }
  const label = LABEL[kind][c.field] ?? c.field
  const from = valueText(kind, c.field, c.from, names)
  const to = valueText(kind, c.field, c.to, names)
  /* 같은 상태를 다시 고른 것 — N일째가 다시 0 이 된 까닭이라 남는다 */
  if (c.field === 'status' && c.from === c.to) return { ...base, label, value: `${to} (다시 고름)` }
  return { ...base, label, from, to, long: LONG_FIELDS.has(c.field) }
}

/** 안건은 모르는 칸(지난 모델의 칸)을 건너뛴다 — 작업 · 테스트는 지난 칸도 읽는다 */
const shows = (kind: HistoryKind, c: HistoryChange) =>
  kind !== 'agenda' || HISTORY_FIELDS.agenda.includes(c.field)

/** 이력 전체를 화면 말로 — 최근 것부터. 그릴 칸이 하나도 없는 줄은 뺀다 */
export function historyView(
  kind: HistoryKind,
  entries: HistoryEntry[],
  names: HistoryNames,
): HistoryEntryView[] {
  return [...entries]
    .reverse()
    .map((e) => ({
      id: e.id,
      changedAt: e.changedAt,
      who: e.backfilled
        ? null
        : e.changedBy === null
          ? '알 수 없음'
          : (names.member(e.changedBy) ?? MISSING),
      changes: e.changes
        .filter((c) => shows(kind, c))
        .map((c) => changeView(kind, c, names, e.backfilled)),
    }))
    .filter((e) => e.changes.length > 0)
}

/** 긴 글을 줄인다 — 줄바꿈은 한 칸으로 펴고 HISTORY_CLIP 자에서 자른다 */
export function clipText(text: string, max = HISTORY_CLIP): { text: string; clipped: boolean } {
  const flat = text.replace(/\s*\n\s*/g, ' ')
  if (flat.length <= max && flat === text) return { text, clipped: false }
  if (flat.length <= max) return { text: flat, clipped: true }
  return { text: `${flat.slice(0, max).trimEnd()}…`, clipped: true }
}

/** 여러 줄 글을 줄인다 — 줄바꿈은 살려 앞 maxLines 줄만, 줄마다 HISTORY_CLIP 자에서 자른다 */
export function clipLines(
  text: string,
  maxLines = 3,
  max = HISTORY_CLIP,
): { text: string; clipped: boolean } {
  const rows = text.split('\n')
  const kept = rows
    .slice(0, maxLines)
    .map((r) => (r.length > max ? `${r.slice(0, max).trimEnd()}…` : r))
  const clipped = rows.length > maxLines || kept.some((r, i) => r !== rows[i])
  if (rows.length > maxLines) kept.push(`… 외 ${rows.length - maxLines}줄`)
  return { text: kept.join('\n'), clipped }
}

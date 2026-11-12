import type jspreadsheet from 'jspreadsheet-ce'
import type { Agenda, DocAgendaLink, DocKind, SheetBook, SheetTab } from '@/types/domain'

/*
 * 문서 (docs/api/document.md) — 화면이 본문에 끼워 넣는 글 · 표 줄, 스프레드시트 ↔ SheetBook 변환, 크기 검사.
 * 서버는 본문을 해석하지 않는다 — 넣은 뒤엔 사람이 다듬는 글이다. 목업 갈래도 같은 검사를 쓴다.
 */

export const DOC_TITLE_MAX = 200
export const DOC_CONTENT_MAX = 200_000
export const DOC_AGENDAS_MAX = 50
/** 고치고 이만큼 쉬면 저장한다 */
export const DOC_SAVE_DELAY_MS = 800

export const DOC_KIND_LABEL: Record<DocKind, string> = { text: '글', sheet: '표' }

/** 결정내용이 비었을 때 본문에 넣는 말 */
export const UNDECIDED = '(아직 안 정함)'

export const decisionOf = (agenda: Pick<Agenda, 'decision'>) => agenda.decision.trim() || UNDECIDED

/* ── 본문에 넣기 ─────────────────────────────────────── */

/** 글 문서에 넣는 블록 — 제목 + 결정내용 */
export const agendaBlock = (agenda: Pick<Agenda, 'title' | 'decision'>) =>
  `### ${agenda.title}\n\n${decisionOf(agenda)}\n`

/**
 * 글의 at 자리(없으면 끝)에 블록을 끼운다. 앞 글과는 빈 줄 하나로 떼고, 뒤 글이 바로 붙으면 줄을 바꾼다.
 * cursor 는 넣은 블록 바로 뒤 — 이어서 넣으면 차례로 쌓인다
 */
export function insertBlock(
  content: string,
  block: string,
  at: number | null,
): { content: string; cursor: number } {
  const pos = at === null ? content.length : Math.max(0, Math.min(at, content.length))
  const before = content.slice(0, pos)
  const after = content.slice(pos)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const tail = after === '' || after.startsWith('\n') ? '' : '\n'
  const head = before + lead + block
  return { content: head + tail + after, cursor: head.length }
}

/* ── 표 — 계약 '표의 모양' ───────────────────────────── */

export const SHEETS_MAX = 10
export const SHEET_NAME_MAX = 31
/* 열 · 줄 · 칸 상한은 엑셀과 같다(A ~ XFD · 1,048,576줄 · 32,767자). 실제로 막히는 것은 대개 SHEET_BYTES_MAX 다 */
export const SHEET_COLUMNS_MAX = 16_384
export const SHEET_ROWS_MAX = 1_048_576
export const SHEET_CELL_MAX = 32_767
export const SHEET_STYLE_MAX = 200
export const SHEET_WIDTH_MIN = 20
export const SHEET_WIDTH_MAX = 1_000
export const SHEET_BYTES_MAX = 5 * 1024 * 1024
/** 새 열 · 가져온 열의 너비 — 이 너비인 빈 열은 저장하지 않는다 */
export const SHEET_COLUMN_WIDTH = 120
/** 편집기에 깔아 두는 크기 — 적은 것이 적어도 A ~ Z · 100줄은 칸이 보인다. 끝의 빈 줄 · 열은 저장하지 않는다 */
export const SHEET_MIN_COLUMNS = 26
export const SHEET_MIN_ROWS = 100
/** 쓴 범위가 더 크면 그 뒤에 더 까는 빈 칸 */
export const SHEET_SPARE_COLUMNS = 10
export const SHEET_SPARE_ROWS = 50
/** 오른쪽 · 아래 끝 가까이 스크롤하면 이만큼씩 늘린다 — 편집기가 칸마다 DOM 을 그려 한꺼번에 못 깐다 */
export const SHEET_GROW_COLUMNS = 26
export const SHEET_GROW_ROWS = 100

const clipCell = (text: string) => text.slice(0, SHEET_CELL_MAX)

export const blankTab = (name: string): SheetTab => ({
  name,
  columns: [{ width: 200 }, { width: 400 }],
  data: [['항목', '내용']],
  merges: {},
  styles: { A1: 'font-weight: bold', B1: 'font-weight: bold' },
})

/** sheet 를 안 보내고 만들 때 서버가 세우는 표 — 열 이름은 첫 줄 칸에 굵게 */
export const defaultSheetBook = (): SheetBook => ({ sheets: [blankTab('Sheet1')] })
/** text 문서의 sheet */
export const emptySheetBook = (): SheetBook => ({ sheets: [] })

/* 칸 주소 — 0 부터 센 (열, 줄) ↔ 'A1' */

export function columnName(col: number): string {
  let n = col + 1
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export const cellAddress = (col: number, row: number) => `${columnName(col)}${row + 1}`

/** 서버가 받는 꼴(`A1` ~ `XFD1048576`)만 푼다 */
export function parseAddress(address: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = Number(m[2])
  if (col > SHEET_COLUMNS_MAX || row > SHEET_ROWS_MAX) return null
  return { col: col - 1, row: row - 1 }
}

/* 시트 이름 */

/** 'Sheet n' 중 안 쓴 것 */
export function nextSheetName(names: string[]): string {
  for (let n = names.length + 1; ; n += 1) if (!names.includes(`Sheet${n}`)) return `Sheet${n}`
}

/** 서버는 이름을 다듬지 않는다 — 앞뒤 공백을 뗀 값으로 견준다 */
export function sheetNameProblem(name: string, others: string[]): string | null {
  const t = name.trim()
  if (!t) return '시트 이름을 적어 주세요.'
  if (t.length > SHEET_NAME_MAX) return `시트 이름은 ${SHEET_NAME_MAX}자까지입니다.`
  if (others.includes(t)) return '같은 이름의 시트가 있습니다.'
  return null
}

/** 겹치거나 길거나 빈 이름을 쓸 수 있는 이름으로 — 가져온 파일의 시트 이름에 쓴다 */
export function fitSheetName(name: string, taken: string[]): string {
  const base = name.trim().slice(0, SHEET_NAME_MAX)
  if (base && !taken.includes(base)) return base
  for (let n = 2; ; n += 1) {
    const tail = ` (${n})`
    const next = (base || 'Sheet').slice(0, SHEET_NAME_MAX - tail.length) + tail
    if (!taken.includes(next)) return next
  }
}

/* 칸 꾸밈 — 편집기는 칸의 style 속성을 통째로 돌려준다(병합 · 정렬 기본값이 섞임). 도구 줄로 고치는 것만 남긴다 */

const STYLE_KEYS = [
  'font-weight',
  'font-style',
  'text-decoration',
  'color',
  'background-color',
  'text-align',
] as const

export function cleanStyle(css: string): string {
  const kept: string[] = []
  for (const part of css.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const key = part.slice(0, i).trim().toLowerCase()
    const value = part.slice(i + 1).trim()
    if (!value || !(STYLE_KEYS as readonly string[]).includes(key)) continue
    if (key === 'text-align' && value === 'left') continue
    if (key === 'font-weight' && (value === 'normal' || value === '400')) continue
    if (key === 'font-style' && value === 'normal') continue
    const next = [...kept.filter((k) => !k.startsWith(`${key}:`)), `${key}: ${value}`]
    if (next.join('; ').length > SHEET_STYLE_MAX) continue
    kept.splice(0, kept.length, ...next)
  }
  return kept.join('; ')
}

export const clampWidth = (width: unknown) => {
  const n = Math.round(Number(width))
  if (!Number.isFinite(n) || n <= 0) return SHEET_COLUMN_WIDTH
  return Math.min(SHEET_WIDTH_MAX, Math.max(SHEET_WIDTH_MIN, n))
}

/** 편집기의 칸 값 — 서버는 문자열만 받는다. null · undefined 는 '' */
export const cellText = (value: unknown) =>
  value === null || value === undefined ? '' : clipCell(String(value))

/* ── 편집기 ↔ SheetBook ── */

/** 편집기에서 읽어 온 시트 하나 — Jspreadsheet 의 getData · getMerge · getStyle · getWidth 와 열 설정 그대로 */
export interface EditorSheet {
  name: string
  widths: unknown[]
  data: unknown[][]
  merges: Record<string, unknown>
  styles: Record<string, string>
}

/**
 * 쓴 범위의 열 수 — 값 · 병합 · 꾸밈 · 기본과 다른 너비가 있는 마지막 열까지(적어도 1).
 * 편집기가 넓혀 깐 빈 열은 여기 안 든다
 */
export function usedColumnCount(tab: SheetTab): number {
  let n = 1
  tab.columns.forEach((c, i) => {
    if (c.width !== SHEET_COLUMN_WIDTH) n = Math.max(n, i + 1)
  })
  for (const row of tab.data)
    for (let c = row.length - 1; c >= n; c -= 1)
      if (row[c] !== '' && row[c] !== undefined) {
        n = c + 1
        break
      }
  for (const [address, span] of Object.entries(tab.merges)) {
    const at = parseAddress(address)
    if (at) n = Math.max(n, at.col + (Number(span[0]) || 1))
  }
  for (const address of Object.keys(tab.styles)) {
    const at = parseAddress(address)
    if (at) n = Math.max(n, at.col + 1)
  }
  return Math.min(n, SHEET_COLUMNS_MAX)
}

/** 저장할 꼴로 — 끝의 빈 줄 · 빈 열을 떼고, 줄은 열 수만큼 채운다. 넓혀 깔기만 한 표는 같은 책이 된다 */
export function trimTab(tab: SheetTab): SheetTab {
  const n = usedColumnCount(tab)
  const columns = Array.from({ length: n }, (_, c) => ({
    width: tab.columns[c]?.width ?? SHEET_COLUMN_WIDTH,
  }))
  let rows = Math.min(tab.data.length, SHEET_ROWS_MAX)
  while (rows > 0 && tab.data[rows - 1].every((v) => v === '' || v === undefined)) rows -= 1
  const data = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: n }, (_, c) => tab.data[r][c] ?? ''),
  )
  return { name: tab.name, columns, data, merges: tab.merges, styles: tab.styles }
}

export const trimBook = (book: SheetBook): SheetBook => ({ sheets: book.sheets.map(trimTab) })

/** 편집기 시트 → 저장할 꼴. 끝의 빈 줄 · 빈 열은 뗀다 */
export function tabFromEditor(sheet: EditorSheet): SheetTab {
  const n = Math.min(Math.max(1, sheet.widths.length), SHEET_COLUMNS_MAX)
  const columns = Array.from({ length: n }, (_, c) => ({ width: clampWidth(sheet.widths[c]) }))
  const data = sheet.data
    .slice(0, SHEET_ROWS_MAX)
    .map((row) =>
      Array.from({ length: n }, (_, c) => cellText((row as unknown[] | undefined)?.[c])),
    )

  const merges: Record<string, [number, number]> = {}
  for (const [address, span] of Object.entries(sheet.merges ?? {})) {
    const at = parseAddress(address)
    if (!at || at.col >= n || !Array.isArray(span)) continue
    const cols = Math.trunc(Number(span[0]))
    const rows = Math.trunc(Number(span[1]))
    if (!(cols >= 1 && rows >= 1) || (cols === 1 && rows === 1)) continue
    merges[address] = [Math.min(cols, n - at.col), Math.min(rows, SHEET_ROWS_MAX - at.row)]
  }
  const styles: Record<string, string> = {}
  for (const [address, css] of Object.entries(sheet.styles ?? {})) {
    const at = parseAddress(address)
    if (!at || at.col >= n || typeof css !== 'string') continue
    const clean = cleanStyle(css)
    if (clean) styles[address] = clean
  }
  return trimTab({
    name: sheet.name.trim().slice(0, SHEET_NAME_MAX) || 'Sheet1',
    columns,
    data,
    merges,
    styles,
  })
}

/**
 * 편집기에 깔 크기 — 쓴 범위(값 · 병합 · 꾸밈이 닿는 칸)를 다 덮고 여유를 두되, 적어도 A ~ Z · 100줄.
 * 더 넓은 칸은 스크롤하면 늘린다
 */
export function editorSize(tab: SheetTab): { columns: number; rows: number } {
  let last = tab.data.length
  while (last > 0 && tab.data[last - 1].every((v) => v === '' || v === undefined)) last -= 1
  for (const [address, span] of Object.entries(tab.merges)) {
    const at = parseAddress(address)
    if (at) last = Math.max(last, at.row + span[1])
  }
  for (const address of Object.keys(tab.styles)) {
    const at = parseAddress(address)
    if (at) last = Math.max(last, at.row + 1)
  }
  const used = usedColumnCount(tab)
  return {
    columns: Math.min(
      SHEET_COLUMNS_MAX,
      Math.max(SHEET_MIN_COLUMNS, used > SHEET_MIN_COLUMNS ? used + SHEET_SPARE_COLUMNS : 0),
    ),
    rows: Math.min(
      SHEET_ROWS_MAX,
      Math.max(SHEET_MIN_ROWS, last > SHEET_MIN_ROWS ? last + SHEET_SPARE_ROWS : 0),
    ),
  }
}

/** 편집기의 열 설정 — title 을 안 줘서 머리가 늘 A · B · C */
export const editorColumn = (width = SHEET_COLUMN_WIDTH): jspreadsheet.Column => ({
  type: 'text',
  width,
  align: 'left',
  wordWrap: true,
})

/** 저장한 시트 → 편집기 시트 설정. 쓴 범위 밖은 빈 칸으로 깐다 */
export function worksheetOf(tab: SheetTab): jspreadsheet.WorksheetOptions {
  const size = editorSize(tab)
  const data = Array.from({ length: size.rows }, (_, r) =>
    Array.from({ length: size.columns }, (_, c) => tab.data[r]?.[c] ?? ''),
  )
  return {
    worksheetName: tab.name,
    data,
    columns: Array.from({ length: size.columns }, (_, c) => editorColumn(tab.columns[c]?.width)),
    mergeCells: Object.fromEntries(
      Object.entries(tab.merges).map(([k, v]) => [k, [v[0], v[1]] as [number, number]]),
    ),
    style: { ...tab.styles },
    minDimensions: [size.columns, size.rows],
    defaultColAlign: 'left',
    defaultColWidth: SHEET_COLUMN_WIDTH,
    allowComments: false,
    columnSorting: false,
    allowDeletingAllRows: false,
  }
}

/* ── 본문에 넣기 — 표 ── */

/** 표 문서에 넣는 한 줄 — [제목, 결정내용, …빈 칸]. 화면엔 늘 A ~ Z 가 깔려 있어 쓴 열이 하나여도 두 칸에 나눈다 */
export function agendaRow(agenda: Pick<Agenda, 'title' | 'decision'>, columnCount: number) {
  return [
    clipCell(agenda.title),
    clipCell(decisionOf(agenda)),
    ...Array<string>(Math.max(0, columnCount - 2)).fill(''),
  ]
}

/** index 번째 시트의 적은 줄 끝에 안건 한 줄. 줄이 꽉 찼거나 시트가 없으면 null */
export function appendAgendaRow(
  book: SheetBook,
  index: number,
  agenda: Pick<Agenda, 'title' | 'decision'>,
): SheetBook | null {
  const tab = book.sheets[index]
  if (!tab || tab.data.length >= SHEET_ROWS_MAX) return null
  const sheets = book.sheets.map((t, i) =>
    i === index
      ? {
          ...t,
          // 줄의 칸 수 ≤ 열 수 — 쓴 열이 하나뿐이면 B 열을 기본 너비로 더한다
          columns:
            t.columns.length >= 2 ? t.columns : [...t.columns, { width: SHEET_COLUMN_WIDTH }],
          data: [...t.data, agendaRow(agenda, t.columns.length)],
        }
      : t,
  )
  return { sheets }
}

/* ── 크기 검사 ── */

export const sheetBookBytes = (book: SheetBook) =>
  new TextEncoder().encode(JSON.stringify(book)).length

/** 서버의 422 와 같은 검사 — sheet 문서에 보낼 표 */
export function sheetBookProblem(book: SheetBook): string | null {
  if (book.sheets.length < 1 || book.sheets.length > SHEETS_MAX)
    return `시트는 1 ~ ${SHEETS_MAX}개입니다.`
  const names: string[] = []
  for (const tab of book.sheets) {
    if (!tab.name || tab.name.length > SHEET_NAME_MAX)
      return `시트 이름은 1 ~ ${SHEET_NAME_MAX}자입니다.`
    if (names.includes(tab.name)) return '시트 이름이 겹칩니다.'
    names.push(tab.name)
    const n = tab.columns.length
    if (n < 1 || n > SHEET_COLUMNS_MAX)
      return `열은 시트마다 1 ~ ${SHEET_COLUMNS_MAX.toLocaleString('ko-KR')}개입니다.`
    if (tab.columns.some((c) => typeof c !== 'object' || c === null || 'title' in c))
      return '열에는 너비만 둡니다 — 열 이름은 첫 줄 칸에 적습니다.'
    if (tab.data.length > SHEET_ROWS_MAX)
      return `줄은 시트마다 ${SHEET_ROWS_MAX.toLocaleString('ko-KR')}개까지입니다.`
    if (tab.data.some((row) => row.length > n)) return '줄의 칸 수가 열 수보다 많습니다.'
    if (tab.data.flat().some((v) => typeof v !== 'string' || v.length > SHEET_CELL_MAX))
      return `칸마다 ${SHEET_CELL_MAX.toLocaleString('ko-KR')}자까지입니다.`
    if (
      tab.columns.some(
        (c) => !Number.isFinite(c.width) || c.width < SHEET_WIDTH_MIN || c.width > SHEET_WIDTH_MAX,
      )
    )
      return `열 너비는 ${SHEET_WIDTH_MIN} ~ ${SHEET_WIDTH_MAX.toLocaleString('ko-KR')}px 입니다.`
    for (const [address, span] of Object.entries(tab.merges))
      if (
        !parseAddress(address) ||
        !Array.isArray(span) ||
        span.length !== 2 ||
        !span.every((v) => Number.isInteger(v) && v > 0)
      )
        return '병합 칸이 올바르지 않습니다.'
    for (const [address, css] of Object.entries(tab.styles))
      if (!parseAddress(address) || typeof css !== 'string' || css.length > SHEET_STYLE_MAX)
        return '칸 꾸밈이 올바르지 않습니다.'
  }
  if (sheetBookBytes(book) > SHEET_BYTES_MAX) return '표가 5MB 를 넘습니다.'
  return null
}

/* ── 검사 — 화면이 막고, 목업 서버가 422 로 낸다 ──────── */

export function docTitleProblem(title: string): string | null {
  const t = title.trim()
  if (!t) return '제목을 적어 주세요.'
  if (t.length > DOC_TITLE_MAX) return `제목은 ${DOC_TITLE_MAX}자까지입니다.`
  return null
}

export function agendaIdsProblem(agendaIds: string[]): string | null {
  if (agendaIds.length > DOC_AGENDAS_MAX) return `안건은 ${DOC_AGENDAS_MAX}개까지 연결합니다.`
  if (new Set(agendaIds).size !== agendaIds.length) return '같은 안건이 두 번 있습니다.'
  return null
}

/* ── 결정 바뀜 ───────────────────────────────────────── */

/**
 * 지금 판이 적어 둔 판보다 큰 연결 안건 — 연결 순서. revOf 가 null 이면(지운 안건) 뺀다.
 * 서버의 changedAgendaIds 와 같은 셈이다 — 화면은 들고 있는 안건으로 다시 세어 결정이 바뀌면 바로 보인다
 */
export function changedAgendaIds(
  links: DocAgendaLink[],
  revOf: (agendaId: string) => number | null,
): string[] {
  return links
    .filter((l) => {
      const rev = revOf(l.agendaId)
      return rev !== null && rev > l.seenRev
    })
    .map((l) => l.agendaId)
}

/* ── 글 서식 버튼 ────────────────────────────────────── */

export interface TextEdit {
  text: string
  /** 고친 뒤 고를 자리 */
  start: number
  end: number
}

/** 고른 글을 mark 로 감싼다(**굵게**). 고른 것이 없으면 placeholder 를 넣고 그것을 고른다 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  mark: string,
  placeholder: string,
): TextEdit {
  const picked = text.slice(start, end) || placeholder
  const next = text.slice(0, start) + mark + picked + mark + text.slice(end)
  return { text: next, start: start + mark.length, end: start + mark.length + picked.length }
}

/** 고른 줄들 앞에 prefix 를 단다(제목 '## ' · 목록 '- '). 이미 달려 있으면 뗀다 */
export function prefixLines(text: string, start: number, end: number, prefix: string): TextEdit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start))
  const lineEnd = nl === -1 ? text.length : nl
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const all = lines.every((l) => l.startsWith(prefix))
  const changed = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n')
  const next = text.slice(0, lineStart) + changed + text.slice(lineEnd)
  return { text: next, start: lineStart, end: lineStart + changed.length }
}

/** [표] 버튼이 넣는 마크다운 표 */
export const TABLE_SNIPPET = '| 항목 | 내용 |\n| --- | --- |\n|  |  |\n'

/** 읽기 전용 문서의 머리 말 — 공통 문서는 누구나 고치므로 파트 문서에만 뜬다 */
export const DOC_READONLY_HINT =
  '만든 사람 · 관리자 · 그 파트 수정 권한이 있는 사람만 고칠 수 있습니다'

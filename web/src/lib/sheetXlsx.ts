import type { CellObject, ColInfo, Range, WorkBook, WorkSheet } from 'xlsx'
import {
  cellAddress,
  cellText,
  clampWidth,
  fitSheetName,
  parseAddress,
  SHEET_BYTES_MAX,
  SHEET_CELL_MAX,
  SHEET_COLUMN_WIDTH,
  SHEET_COLUMNS_MAX,
  SHEET_ROWS_MAX,
  SHEET_STYLE_MAX,
  sheetBookBytes,
  SHEETS_MAX,
  trimTab,
} from '@/lib/document'
import type { SheetBook, SheetTab } from '@/types/domain'

/*
 * .xlsx ↔ SheetBook — SheetJS CE 의 통합 문서 객체만 다룬다(모듈은 화면이 버튼을 누를 때 불러온다).
 * 가져오기는 값 · 수식 · 병합 · 열 너비, 꾸밈은 CE 가 읽어 주는 만큼(굵게 · 기울임 · 글자색 · 칠). 내보내기는 CE 가 꾸밈을 못 쓴다
 */

/** 'FFRRGGBB' · 'RRGGBB' → '#rrggbb' */
function hexOf(rgb: unknown): string | null {
  if (typeof rgb !== 'string') return null
  const m = /^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(rgb)
  return m ? `#${m[1].toLowerCase()}` : null
}

/** CE 가 읽은 칸 꾸밈 → CSS 글 */
function styleOf(s: unknown): string {
  if (!s || typeof s !== 'object') return ''
  const style = s as {
    font?: { bold?: boolean; italic?: boolean; color?: { rgb?: string } }
    patternType?: string
    fgColor?: { rgb?: string }
    fill?: { patternType?: string; fgColor?: { rgb?: string } }
  }
  const parts: string[] = []
  if (style.font?.bold) parts.push('font-weight: bold')
  if (style.font?.italic) parts.push('font-style: italic')
  const color = hexOf(style.font?.color?.rgb)
  if (color && color !== '#000000') parts.push(`color: ${color}`)
  const fill = style.fill ?? style
  const bg = fill.patternType === 'solid' ? hexOf(fill.fgColor?.rgb) : null
  if (bg && bg !== '#ffffff') parts.push(`background-color: ${bg}`)
  return parts.join('; ').slice(0, SHEET_STYLE_MAX)
}

/** 칸 하나의 원문 — 수식은 '=…', 날짜 · 오류는 엑셀이 보이던 글, 숫자는 꾸밈 없는 값 */
function valueOf(cell: CellObject): string {
  if (cell.f) return `=${cell.f}`
  switch (cell.t) {
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'n':
      return String(cell.v ?? '')
    case 'd':
    case 'e':
      return cell.w ?? String(cell.v ?? '')
    case 'z':
      return ''
    default:
      return cellText(cell.v)
  }
}

/** 칸 주소 — 상한 밖도 푼다(넘는 것을 알아채려고) */
function cellAt(address: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(address)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(m[2]) - 1 }
}

function widthOf(col: ColInfo | undefined): number {
  if (!col) return SHEET_COLUMN_WIDTH
  if (col.wpx) return clampWidth(col.wpx)
  /* 엑셀 글자 폭 단위 — 기본 글꼴의 숫자 폭 7px 에 여백 5px */
  if (col.wch) return clampWidth(col.wch * 7 + 5)
  if (col.width) return clampWidth(col.width * 7 + 5)
  return SHEET_COLUMN_WIDTH
}

/** 빈 칸만 깔아도 이만큼 — 직렬화한 칸 하나 `"",` 3바이트 + 줄마다 `[],` */
const gridBytes = (cols: number, rows: number) => rows * (cols * 3 + 2)

interface Got {
  tab: SheetTab
  clipped: boolean
  /** 칸을 펴기만 해도 5MB 를 넘어 펴지 않았다 */
  tooBig: boolean
}

/**
 * 시트 하나 — '!ref' 범위를 다 돌지 않고 있는 칸만 본다(꾸밈만 있는 범위가 XFD1048576 까지 잡힌 파일이 있다).
 * 쓴 범위는 값 · 꾸밈이 있는 칸과 그 안에서 시작하는 병합까지
 */
function tabOf(ws: WorkSheet, name: string): Got {
  let clipped = false
  let cols = 0
  let rows = 0
  const cells: { col: number; row: number; value: string }[] = []
  const styles: Record<string, string> = {}
  for (const address of Object.keys(ws)) {
    if (address.startsWith('!')) continue
    const at = cellAt(address)
    if (!at) continue
    if (at.col >= SHEET_COLUMNS_MAX || at.row >= SHEET_ROWS_MAX) {
      clipped = true
      continue
    }
    const cell = ws[address] as CellObject
    const value = valueOf(cell)
    if (value.length > SHEET_CELL_MAX) clipped = true
    const css = styleOf(cell.s)
    if (value === '' && !css) continue
    if (value !== '') cells.push({ ...at, value: value.slice(0, SHEET_CELL_MAX) })
    if (css) styles[cellAddress(at.col, at.row)] = css
    cols = Math.max(cols, at.col + 1)
    rows = Math.max(rows, at.row + 1)
  }

  const merges: Record<string, [number, number]> = {}
  for (const m of ws['!merges'] ?? []) {
    if (m.s.c >= cols || m.s.r >= rows) continue
    const span: [number, number] = [
      Math.min(m.e.c, SHEET_COLUMNS_MAX - 1) - m.s.c + 1,
      Math.min(m.e.r, SHEET_ROWS_MAX - 1) - m.s.r + 1,
    ]
    if (m.e.c >= SHEET_COLUMNS_MAX || m.e.r >= SHEET_ROWS_MAX) clipped = true
    if (span[0] > 1 || span[1] > 1) merges[cellAddress(m.s.c, m.s.r)] = span
  }
  for (const [address, [c, r]] of Object.entries(merges)) {
    const at = parseAddress(address)!
    cols = Math.max(cols, at.col + c)
    rows = Math.max(rows, at.row + r)
  }

  const n = Math.max(1, cols)
  if (gridBytes(n, rows) > SHEET_BYTES_MAX)
    return {
      tab: { name, columns: [{ width: SHEET_COLUMN_WIDTH }], data: [], merges: {}, styles: {} },
      clipped,
      tooBig: true,
    }
  const data = Array.from({ length: rows }, () => Array<string>(n).fill(''))
  for (const { col, row, value } of cells) data[row][col] = value
  const colInfo = ws['!cols'] ?? []
  return {
    tab: trimTab({
      name,
      columns: Array.from({ length: n }, (_, c) => ({ width: widthOf(colInfo[c]) })),
      data,
      merges,
      styles,
    }),
    clipped,
    tooBig: false,
  }
}

/**
 * 읽은 통합 문서 → SheetBook. 시트 10 · 열 16,384 · 줄 1,048,576 · 칸 32,767자를 넘는 것은 자르고 clipped 로 알린다.
 * 표가 5MB 를 넘으면 tooBig — 화면이 가져오지 않고 알린다(서버가 422 로 막는다)
 */
export function bookFromWorkbook(wb: WorkBook): {
  book: SheetBook
  clipped: boolean
  tooBig: boolean
} {
  const names = wb.SheetNames.slice(0, SHEETS_MAX)
  let clipped = wb.SheetNames.length > SHEETS_MAX
  let tooBig = false
  const taken: string[] = []
  const sheets = names.map((sheetName) => {
    const name = fitSheetName(sheetName, taken)
    taken.push(name)
    const got = tabOf(wb.Sheets[sheetName] ?? {}, name)
    clipped ||= got.clipped
    tooBig ||= got.tooBig
    return got.tab
  })
  if (sheets.length === 0) sheets.push(tabOf({}, 'Sheet1').tab)
  const book = { sheets }
  return { book, clipped, tooBig: tooBig || sheetBookBytes(book) > SHEET_BYTES_MAX }
}

/** 엑셀이 시트 이름에 못 받는 글자 */
const xlsxSheetName = (name: string, taken: string[]) =>
  fitSheetName(name.replace(/[[\]:*?/\\]/g, '_').replace(/^'|'$/g, '_'), taken)

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

/**
 * SheetBook → 쓸 통합 문서. 수식 칸은 원문을 수식으로, 편집기가 계산한 값(shown)이 있으면 그 값을 같이 둔다 —
 * 엑셀이 다시 계산하기 전에도 값이 보이게. 열 이름은 파일에 없다(엑셀은 A · B 머리를 쓴다)
 */
export function workbookFromBook(
  book: SheetBook,
  shown?: (sheet: number, row: number, col: number) => string | undefined,
): WorkBook {
  const wb: WorkBook = { SheetNames: [], Sheets: {} }
  book.sheets.forEach((tab, i) => {
    const ws: WorkSheet = {}
    const n = tab.columns.length
    let lastRow = Math.max(0, tab.data.length - 1)
    tab.data.forEach((row, r) =>
      row.forEach((value, c) => {
        if (value === '') return
        const address = cellAddress(c, r)
        if (value.startsWith('=') && value.length > 1) {
          const v = shown?.(i, r, c) ?? ''
          ws[address] = NUMBER.test(v)
            ? { t: 'n', f: value.slice(1), v: Number(v) }
            : { t: 's', f: value.slice(1), v }
        } else
          ws[address] = NUMBER.test(value) ? { t: 'n', v: Number(value) } : { t: 's', v: value }
      }),
    )
    const merges: Range[] = []
    for (const [address, [cols, rows]] of Object.entries(tab.merges)) {
      const at = parseAddress(address)
      if (!at) continue
      merges.push({
        s: { c: at.col, r: at.row },
        e: { c: at.col + cols - 1, r: at.row + rows - 1 },
      })
      lastRow = Math.max(lastRow, at.row + rows - 1)
    }
    ws['!ref'] = `A1:${cellAddress(n - 1, lastRow)}`
    if (merges.length > 0) ws['!merges'] = merges
    ws['!cols'] = tab.columns.map((c) => ({ wpx: c.width }))
    const name = xlsxSheetName(tab.name, wb.SheetNames)
    wb.SheetNames.push(name)
    wb.Sheets[name] = ws
  })
  return wb
}

/** 내려받을 파일 이름 — 파일 이름에 못 쓰는 글자를 뺀 '문서 제목.xlsx' */
export const xlsxFileName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]/g, '_').trim() || '표 문서'}.xlsx`

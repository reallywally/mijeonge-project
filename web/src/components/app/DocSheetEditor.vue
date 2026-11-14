<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { toast } from 'vue-sonner'
import jspreadsheet from 'jspreadsheet-ce'
import 'jsuites/dist/jsuites.css'
import 'jspreadsheet-ce/dist/jspreadsheet.css'
import 'jspreadsheet-ce/dist/jspreadsheet.themes.css'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Ellipsis,
  Italic,
  Loader2,
  PaintBucket,
  Plus,
  Redo2,
  TableCellsMerge,
  TableCellsSplit,
  TriangleAlert,
  Undo2,
  FileDown,
  FileUp,
} from 'lucide-vue-next'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  agendaRow,
  cellAddress,
  defaultSheetBook,
  editorColumn,
  nextSheetName,
  parseAddress,
  SHEET_BYTES_MAX,
  SHEET_CELL_MAX,
  SHEET_COLUMN_WIDTH,
  SHEET_COLUMNS_MAX,
  SHEET_GROW_COLUMNS,
  SHEET_GROW_ROWS,
  SHEET_ROWS_MAX,
  sheetBookProblem,
  sheetNameProblem,
  SHEETS_MAX,
  tabFromEditor,
  trimBook,
  worksheetOf,
} from '@/lib/document'
import { cn } from '@/lib/utils'
import type { Agenda, SheetBook, SheetTab } from '@/types/domain'

/* 표 문서 — Jspreadsheet CE 스프레드시트를 이 칸에 직접 띄운다(Vue 래퍼 없이, 떠날 때 destroy).
   편집기 이벤트마다 지금 상태를 SheetBook 으로 뽑아 올리고, 부모(스토어)가 자동 저장한다.
   부모가 다른 표를 내려보내면(다시 불러오기) 편집기를 새로 띄운다. .xlsx 는 SheetJS 를 누를 때 불러온다.
   엑셀처럼 넓게 — 적어도 A ~ Z · 100줄을 깔고 끝 가까이 스크롤하면 늘린다. 저장은 쓴 범위뿐이다 */
const book = defineModel<SheetBook>({ required: true })
const props = defineProps<{ readonly?: boolean; title: string }>()

type Worksheet = jspreadsheet.WorksheetInstance
type Spreadsheet = jspreadsheet.SpreadsheetInstance

jspreadsheet.setDictionary({
  'This action will destroy any existing merged cells. Are you sure?':
    '이 작업을 하면 병합한 칸이 풀립니다. 계속할까요?',
  'This action will clear your search results. Are you sure?':
    '이 작업을 하면 찾은 결과가 지워집니다. 계속할까요?',
  'No cells selected': '고른 칸이 없습니다.',
  'Invalid merged properties': '두 칸 이상 골라야 병합합니다.',
  'Cell already merged': '이미 병합한 칸입니다.',
  'There is a conflict with another merged cell': '다른 병합 칸과 겹칩니다.',
  'Column name': '열 이름',
  'Are you sure to delete the selected rows?': '고른 줄을 지울까요?',
  'Are you sure to delete the selected columns?': '고른 열을 지울까요?',
})

const host = ref<HTMLDivElement | null>(null)
const ready = ref(false)
const names = ref<string[]>([])
const active = ref(0)
/** 저장하지 않는 사유 — 계약의 크기를 넘었을 때 */
const problem = ref<string | null>(null)
const busy = ref(false)

let spreadsheet: Spreadsheet | null = null
/** 지금 띄운 편집기 번호 — 늦게 끝난 옛 편집기의 onload 를 버린다 */
let generation = 0
/** 마지막으로 올린(또는 받아 띄운) 표 — 같은 것이 되돌아오면 편집기를 새로 띄우지 않는다 */
let lastBook: SheetBook | null = null
let lastJson = ''
let emitQueued = false
let emitAfterLoad = false
/** 고른 칸 — 도구 줄을 누르면 편집기의 선택이 풀릴 수 있어 따로 들고 있는다 */
let picked: { sheet: number; x1: number; y1: number; x2: number; y2: number } | null = null

const worksheet = (): Worksheet | null => spreadsheet?.worksheets[active.value] ?? null

/* ── 편집기 → SheetBook ── */

function extract(): SheetBook {
  const sheets: SheetTab[] = (spreadsheet?.worksheets ?? []).map((ws) => {
    const count = ws.headers.length
    return tabFromEditor({
      name: ws.options.worksheetName ?? '',
      widths: Array.from({ length: count }, (_, c) => ws.getWidth(c)),
      data: ws.getData(),
      merges: (ws.getMerge() ?? {}) as Record<string, unknown>,
      styles: ws.getStyle() as Record<string, string>,
    })
  })
  return { sheets }
}

function emitNow() {
  emitQueued = false
  if (!spreadsheet || !ready.value || props.readonly) return
  const next = extract()
  const json = JSON.stringify(next)
  problem.value = sheetBookProblem(next)
  if (json === lastJson) return
  lastJson = json
  lastBook = next
  book.value = next
}

/** 이벤트가 몰려 와도(붙여 넣기 · 되돌리기) 한 번만 뽑는다 */
function queueEmit() {
  if (emitQueued || !ready.value) return
  emitQueued = true
  queueMicrotask(emitNow)
}

/* ── 크기 상한 — 넘는 것은 막고 알린다 ── */

let warnedAt = 0
function warn(message: string) {
  const now = Date.now()
  if (now - warnedAt < 1500) return
  warnedAt = now
  toast(message)
}

const rowCount = (ws: Worksheet) => ws.options.data?.length ?? 0
const fmt = (v: number) => v.toLocaleString('ko-KR')

/* ── 넓혀 깔기 — 끝 가까이 스크롤하면 열 · 줄을 늘린다 ── */

/** 끝에서 이만큼(px) 안으로 오면 늘린다 */
const GROW_EDGE = 240
const GROW_THROTTLE_MS = 120
/** 표 높이 — 화면에 맞추되 너무 낮아지지 않게 */
const TABLE_HEIGHT = 'max(320px, calc(100dvh - 300px))'

/** 넓혀 그리기만 한 것 — 이벤트 · 되돌리기 기록을 안 남겨 저장도 안 나간다 */
function quietly(ws: Worksheet, run: () => void) {
  const ss = spreadsheet
  if (!ss) return
  const events = ss.ignoreEvents
  const history = ws.ignoreHistory
  ss.ignoreEvents = true
  ws.ignoreHistory = true
  try {
    run()
  } finally {
    ss.ignoreEvents = events
    ws.ignoreHistory = history
  }
}

function growColumns(ws: Worksheet) {
  const k = Math.min(SHEET_GROW_COLUMNS, SHEET_COLUMNS_MAX - ws.headers.length)
  if (k <= 0) return
  quietly(ws, () =>
    ws.insertColumn(
      k,
      ws.headers.length - 1,
      false,
      Array.from({ length: k }, () => editorColumn()),
    ),
  )
}

function growRows(ws: Worksheet) {
  const k = Math.min(SHEET_GROW_ROWS, SHEET_ROWS_MAX - rowCount(ws))
  if (k <= 0) return
  quietly(ws, () => ws.insertRow(k, rowCount(ws) - 1))
}

let growTimer: ReturnType<typeof setTimeout> | null = null

function growNearEdge(el: HTMLElement) {
  const ws = spreadsheet?.worksheets.find((w) => w.content === el)
  if (!ws) return
  if (el.scrollLeft + el.clientWidth >= el.scrollWidth - GROW_EDGE) growColumns(ws)
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - GROW_EDGE) growRows(ws)
}

/** 스크롤은 bubbling 이 없어 host 에서 capture 로 받는다. 몰려 오면 한 번만 본다 */
function onScroll(e: Event) {
  const el = e.target
  if (growTimer || !(el instanceof HTMLElement) || !el.classList.contains('jss_content')) return
  growTimer = setTimeout(() => {
    growTimer = null
    growNearEdge(el)
  }, GROW_THROTTLE_MS)
}

/* ── 우클릭 메뉴 — 줄 · 열 넣기 · 지우기 (한국어) ── */

type MenuItem = jspreadsheet.ContextMenuItem

function contextMenu(
  ws: Worksheet,
  x: string | number | null,
  y: string | number | null,
  _e: PointerEvent,
  _items: MenuItem[],
  role: jspreadsheet.ContextMenuRole,
): MenuItem[] | null | undefined {
  /* false 를 돌려주면 메뉴를 안 띄운다 — 타입은 배열 · null 만 적혀 있다 */
  if (props.readonly) return false as unknown as null
  const col = x === null ? null : Number(x)
  const row = y === null ? null : Number(y)
  const items: MenuItem[] = []
  if ((role === 'header' || role === 'cell') && col !== null && !Number.isNaN(col)) {
    items.push(
      { title: '왼쪽에 열 넣기', onclick: () => ws.insertColumn(1, col, true) },
      { title: '오른쪽에 열 넣기', onclick: () => ws.insertColumn(1, col, false) },
      {
        title: '열 지우기',
        onclick: () => ws.deleteColumn(ws.getSelectedColumns().length ? undefined : col),
      },
      { type: 'line', title: '' },
    )
  }
  if ((role === 'row' || role === 'cell') && row !== null && !Number.isNaN(row)) {
    items.push(
      { title: '위에 줄 넣기', onclick: () => ws.insertRow(1, row, 1) },
      { title: '아래에 줄 넣기', onclick: () => ws.insertRow(1, row) },
      {
        title: '줄 지우기',
        onclick: () => ws.deleteRow(ws.getSelectedRows().length ? undefined : row),
      },
      { type: 'line', title: '' },
    )
  }
  items.push({ title: '복사', shortcut: 'Ctrl + C', onclick: () => ws.copy() })
  return items
}

/* ── 띄우기 · 걷기 ── */

function destroy() {
  ready.value = false
  picked = null
  if (growTimer) clearTimeout(growTimer)
  growTimer = null
  if (spreadsheet && host.value) jspreadsheet.destroy(host.value as never, true)
  spreadsheet = null
}

function build(next: SheetBook, keepActive = 0) {
  if (!host.value) return
  destroy()
  generation += 1
  const mine = generation
  const source = next.sheets.length > 0 ? next : defaultSheetBook()
  host.value.innerHTML = ''
  const options: jspreadsheet.SpreadsheetOptions = {
    tabs: false,
    toolbar: false,
    about: false,
    allowExport: false,
    worksheets: source.sheets.map((tab) => ({
      ...worksheetOf(tab),
      tableOverflow: true,
      tableHeight: TABLE_HEIGHT,
      tableWidth: '100%',
      editable: !props.readonly,
    })),
    contextMenu,
    onload: (instance) => {
      if (mine !== generation) return
      spreadsheet = instance
      ready.value = true
      names.value = instance.worksheets.map((ws) => ws.options.worksheetName ?? '')
      const at = Math.min(keepActive, instance.worksheets.length - 1)
      if (at > 0) instance.worksheets[0].openWorksheet(at)
      active.value = at
      if (emitAfterLoad) {
        emitAfterLoad = false
        emitNow()
      }
    },
    onbeforechange: (_ws, _cell, _x, _y, value) => {
      if (typeof value === 'string' && value.length > SHEET_CELL_MAX) {
        warn(`칸마다 ${fmt(SHEET_CELL_MAX)}자까지라 넘는 것은 잘랐습니다.`)
        return value.slice(0, SHEET_CELL_MAX)
      }
      return undefined
    },
    onbeforeinsertrow: (ws, rows) => {
      if (rowCount(ws) + rows.length <= SHEET_ROWS_MAX) return undefined
      warn(`시트마다 ${fmt(SHEET_ROWS_MAX)}줄까지입니다.`)
      return false
    },
    onbeforeinsertcolumn: (ws, columns) => {
      if (ws.headers.length + columns.length > SHEET_COLUMNS_MAX) {
        warn(`시트마다 ${fmt(SHEET_COLUMNS_MAX)}열까지입니다.`)
        return false
      }
      /* 새 열도 머리는 A · B, 왼쪽 맞춤 */
      for (const c of columns)
        c.options = { ...c.options, type: 'text', align: 'left', wordWrap: true }
      return undefined
    },
    onbeforedeletecolumn: (ws, removed) => {
      if (ws.headers.length - removed.length >= 1) return undefined
      warn('열은 하나 이상 남깁니다.')
      return false
    },
    onbeforepaste: (ws, copied, x, y) => {
      const width = Math.max(0, ...copied.map((r) => r.length))
      if (Number(y) + copied.length > Math.max(rowCount(ws), SHEET_ROWS_MAX)) {
        warn(`시트마다 ${fmt(SHEET_ROWS_MAX)}줄까지라 붙여 넣지 않았습니다.`)
        return false
      }
      if (Number(x) + width > SHEET_COLUMNS_MAX) {
        warn(`시트마다 ${fmt(SHEET_COLUMNS_MAX)}열까지라 붙여 넣지 않았습니다.`)
        return false
      }
      return undefined
    },
    onselection: (ws, x1, y1, x2, y2) => {
      const sheet = spreadsheet?.worksheets.indexOf(ws) ?? -1
      if (sheet < 0) return
      picked = {
        sheet,
        x1: Math.min(x1, x2),
        y1: Math.min(y1, y2),
        x2: Math.max(x1, x2),
        y2: Math.max(y1, y2),
      }
    },
    onafterchanges: queueEmit,
    onchangestyle: queueEmit,
    onmerge: queueEmit,
    oninsertrow: queueEmit,
    oninsertcolumn: queueEmit,
    ondeleterow: queueEmit,
    ondeletecolumn: queueEmit,
    onmoverow: queueEmit,
    onmovecolumn: queueEmit,
    onresizecolumn: queueEmit,
    onchangeheader: queueEmit,
    onundo: queueEmit,
    onredo: queueEmit,
    oncreateworksheet: queueEmit,
    ondeleteworksheet: queueEmit,
  }
  jspreadsheet(host.value, options)
}

/* 견줄 때는 쓴 범위만 — 넓혀 깐 빈 칸 · 예전에 저장된 빈 열 때문에 저장이 나가지 않게 */
onMounted(() => {
  lastBook = toRaw(book.value)
  lastJson = JSON.stringify(trimBook(book.value))
  host.value?.addEventListener('scroll', onScroll, true)
  build(book.value)
})
onBeforeUnmount(() => {
  generation += 1
  host.value?.removeEventListener('scroll', onScroll, true)
  destroy()
})

/* 부모가 다른 표를 내려보냈을 때만 새로 띄운다 — 내가 올린 표가 되돌아온 것은 그냥 둔다 */
watch(book, (next) => {
  if (toRaw(next) === lastBook) return
  const json = JSON.stringify(trimBook(next))
  if (json === lastJson) return
  lastBook = toRaw(next)
  lastJson = json
  build(next, active.value)
})

watch(
  () => props.readonly,
  (ro) => {
    for (const ws of spreadsheet?.worksheets ?? []) ws.options.editable = !ro
    if (!ro) queueEmit()
  },
)

/* ── 도구 줄 ── */

/** 고른 칸 주소들 — 지금 시트에서 고른 것이 없으면 [] */
function pickedCells(): string[] {
  const p = picked
  if (!p || p.sheet !== active.value) return []
  const cells: string[] = []
  for (let y = p.y1; y <= p.y2; y += 1)
    for (let x = p.x1; x <= p.x2; x += 1) cells.push(cellAddress(x, y))
  return cells
}

function setStyle(key: string, value: (cells: string[], ws: Worksheet) => string) {
  const ws = worksheet()
  const cells = pickedCells()
  if (!ws || cells.length === 0 || props.readonly) {
    if (!props.readonly) warn('먼저 칸을 고르세요.')
    return
  }
  const v = value(cells, ws)
  ws.setStyle(Object.fromEntries(cells.map((c) => [c, `${key}: ${v}`])), null, null, true)
}

const styleOfCell = (ws: Worksheet, cell: string) => String(ws.getStyle(cell) ?? '')

function toggle(key: 'font-weight' | 'font-style', on: string, off: string, test: RegExp) {
  setStyle(key, (cells, ws) => (cells.every((c) => test.test(styleOfCell(ws, c))) ? off : on))
}

const bold = () => toggle('font-weight', 'bold', 'normal', /font-weight:\s*(bold|[6-9]00)/)
const italic = () => toggle('font-style', 'italic', 'normal', /font-style:\s*italic/)
const align = (to: 'left' | 'center' | 'right') => setStyle('text-align', () => to)

function color(key: 'color' | 'background-color', e: Event) {
  const value = (e.target as HTMLInputElement).value
  setStyle(key, () => value)
}

function merge() {
  const ws = worksheet()
  const p = picked
  if (!ws || !p || p.sheet !== active.value) return warn('먼저 칸을 고르세요.')
  const cols = p.x2 - p.x1 + 1
  const rows = p.y2 - p.y1 + 1
  if (cols * rows < 2) return warn('두 칸 이상 골라야 병합합니다.')
  const filled = pickedCells()
    .slice(1)
    .some((c) => String(ws.getValue(c) ?? '') !== '')
  if (filled && !window.confirm('병합하면 왼쪽 위 칸의 값만 남습니다. 병합할까요?')) return
  ws.setMerge(cellAddress(p.x1, p.y1), cols, rows)
}

/** 고른 칸에 걸친 병합을 모두 푼다. 편집기가 풀기 이벤트를 안 내서 직접 올린다 */
function unmerge() {
  const ws = worksheet()
  const p = picked
  if (!ws || !p || p.sheet !== active.value) return warn('먼저 칸을 고르세요.')
  const merges = (ws.getMerge() ?? {}) as Record<string, [number, number]>
  let any = false
  for (const [address, [cols, rows]] of Object.entries(merges)) {
    const at = parseAddress(address)
    if (!at) continue
    const { col: x, row: y } = at
    if (x > p.x2 || x + cols - 1 < p.x1 || y > p.y2 || y + rows - 1 < p.y1) continue
    ws.removeMerge(address)
    any = true
  }
  if (!any) return warn('고른 칸에 병합한 칸이 없습니다.')
  queueEmit()
}

const undo = () => worksheet()?.undo()
const redo = () => worksheet()?.redo()

/* ── 시트 탭 ── */

function openSheet(i: number) {
  if (!spreadsheet || i === active.value) return
  spreadsheet.worksheets[0].openWorksheet(i)
  active.value = i
}

function addSheet() {
  const ws = spreadsheet?.worksheets[0]
  if (!ws || names.value.length >= SHEETS_MAX) return
  const name = nextSheetName(names.value)
  ws.createWorksheet({
    ...worksheetOf({
      name,
      columns: [{ width: SHEET_COLUMN_WIDTH }],
      data: [],
      merges: {},
      styles: {},
    }),
    tableOverflow: true,
    tableHeight: TABLE_HEIGHT,
    tableWidth: '100%',
  })
  names.value = [...names.value, name]
  active.value = names.value.length - 1
}

const menuOpen = ref(false)
const renaming = ref('')
const renameProblem = computed(() =>
  sheetNameProblem(
    renaming.value,
    names.value.filter((_, i) => i !== active.value),
  ),
)

function openMenu(open: boolean) {
  menuOpen.value = open
  if (open) renaming.value = names.value[active.value] ?? ''
}

function rename() {
  const ws = worksheet()
  if (!ws || renameProblem.value) return
  const name = renaming.value.trim()
  ws.options.worksheetName = name
  names.value = names.value.map((n, i) => (i === active.value ? name : n))
  menuOpen.value = false
  queueEmit()
}

/* 지우기 · 가져오기는 확인 팝업을 거친다 */
const confirmBox = ref<{
  title: string
  description: string
  label: string
  action: () => void
} | null>(null)
const confirmOpen = computed({
  get: () => confirmBox.value !== null,
  set: (open: boolean) => {
    if (!open) confirmBox.value = null
  },
})

function askRemoveSheet() {
  menuOpen.value = false
  if (names.value.length <= 1) return
  const i = active.value
  confirmBox.value = {
    title: `'${names.value[i]}' 시트를 지울까요?`,
    description: '시트의 칸 · 꾸밈이 함께 지워집니다. 저장한 뒤에는 되돌릴 수 없습니다.',
    label: '지우기',
    action: () => {
      const ws = spreadsheet?.worksheets[0]
      if (!ws || !spreadsheet || spreadsheet.worksheets.length <= 1) return
      ws.deleteWorksheet(i)
      names.value = spreadsheet.worksheets.map((w) => w.options.worksheetName ?? '')
      active.value = spreadsheet.getWorksheetActive()
    },
  }
}

function runConfirm() {
  const box = confirmBox.value
  confirmBox.value = null
  box?.action()
}

/* ── .xlsx ── */

const fileInput = ref<HTMLInputElement | null>(null)

async function pickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  try {
    const [XLSX, { bookFromWorkbook }] = await Promise.all([
      import('xlsx'),
      import('@/lib/sheetXlsx'),
    ])
    const wb = XLSX.read(await file.arrayBuffer(), {
      cellFormula: true,
      cellStyles: true,
      cellDates: true,
    })
    const { book: next, clipped, tooBig } = bookFromWorkbook(wb)
    if (tooBig) {
      toast.error(
        `'${file.name}' 은 표가 ${SHEET_BYTES_MAX / 1024 / 1024}MB 를 넘어 가져오지 않았습니다 — 파일을 나눠 주세요.`,
      )
      return
    }
    confirmBox.value = {
      title: `'${file.name}' 으로 지금 시트를 바꿀까요?`,
      description: `지금 시트 ${names.value.length}개를 파일의 시트 ${next.sheets.length}개로 바꿉니다. 값 · 수식 · 병합 · 열 너비를 옮기고, 꾸밈은 읽히는 만큼만 옮깁니다.${
        clipped
          ? ` 시트 ${SHEETS_MAX}개 · ${fmt(SHEET_COLUMNS_MAX)}열 · ${fmt(SHEET_ROWS_MAX)}줄 · 칸 ${fmt(SHEET_CELL_MAX)}자를 넘는 것은 잘립니다.`
          : ''
      }`,
      label: '바꾸기',
      action: () => {
        emitAfterLoad = true
        build(next)
      },
    }
  } catch {
    toast.error('.xlsx 파일을 읽지 못했습니다.')
  } finally {
    busy.value = false
  }
}

async function download() {
  if (!spreadsheet) return
  busy.value = true
  try {
    const [XLSX, { workbookFromBook, xlsxFileName }] = await Promise.all([
      import('xlsx'),
      import('@/lib/sheetXlsx'),
    ])
    const sheets = spreadsheet.worksheets
    const wb = workbookFromBook(extract(), (s, r, c) => {
      const v = sheets[s]?.getValueFromCoords(c, r, true)
      return v === null || v === undefined ? undefined : String(v)
    })
    XLSX.writeFile(wb, xlsxFileName(props.title))
  } catch {
    toast.error('.xlsx 파일을 만들지 못했습니다.')
  } finally {
    busy.value = false
  }
}

/* ── [본문에 넣기] — 지금 보는 시트의 적은 줄 끝에 한 줄 ── */

function insertAgenda(agenda: Pick<Agenda, 'title' | 'decision'>): boolean {
  const ws = worksheet()
  if (!ws || props.readonly) return false
  const tab = extract().sheets[active.value]
  if (!tab) return false
  const at = tab.data.length
  if (at >= SHEET_ROWS_MAX) {
    warn(`시트마다 ${fmt(SHEET_ROWS_MAX)}줄까지입니다.`)
    return false
  }
  const cells = agendaRow(agenda, tab.columns.length)
  if (at < rowCount(ws)) ws.setRowData(at, cells)
  else if (ws.insertRow(cells) === false) return false
  return true
}

defineExpose({ insertAgenda, activeSheet: () => active.value })

const TOOL = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative')
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2" data-doc-sheet>
    <div
      class="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1 shadow-sm"
      data-doc-sheet-toolbar
      @mousedown.stop
    >
      <template v-if="!readonly">
        <Button
          variant="ghost"
          size="icon-sm"
          title="되돌리기 (Ctrl + Z)"
          aria-label="되돌리기"
          data-doc-sheet-undo
          @click="undo"
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="다시 (Ctrl + Y)"
          aria-label="다시"
          data-doc-sheet-redo
          @click="redo"
        >
          <Redo2 />
        </Button>
        <div class="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          title="굵게"
          aria-label="굵게"
          data-doc-sheet-bold
          @click="bold"
        >
          <Bold />
        </Button>
        <Button variant="ghost" size="icon-sm" title="기울임" aria-label="기울임" @click="italic">
          <Italic />
        </Button>
        <label :class="TOOL" title="글자색">
          <Baseline />
          <input
            type="color"
            class="absolute inset-0 cursor-pointer opacity-0"
            aria-label="글자색"
            @change="color('color', $event)"
          />
        </label>
        <label :class="TOOL" title="배경색">
          <PaintBucket />
          <input
            type="color"
            class="absolute inset-0 cursor-pointer opacity-0"
            aria-label="배경색"
            @change="color('background-color', $event)"
          />
        </label>
        <div class="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          title="왼쪽 맞춤"
          aria-label="왼쪽 맞춤"
          @click="align('left')"
        >
          <AlignLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="가운데 맞춤"
          aria-label="가운데 맞춤"
          @click="align('center')"
        >
          <AlignCenter />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="오른쪽 맞춤"
          aria-label="오른쪽 맞춤"
          @click="align('right')"
        >
          <AlignRight />
        </Button>
        <div class="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          title="병합"
          aria-label="병합"
          data-doc-sheet-merge
          @click="merge"
        >
          <TableCellsMerge />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="병합 풀기"
          aria-label="병합 풀기"
          @click="unmerge"
        >
          <TableCellsSplit />
        </Button>
      </template>
      <span class="grow" />
      <Loader2 v-if="busy" class="mr-1 size-3.5 animate-spin text-muted-foreground" />
      <template v-if="!readonly">
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.xls,.ods,.csv"
          class="hidden"
          data-doc-sheet-file
          @change="pickFile"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title=".xlsx 가져오기 — 지금 시트들을 바꿉니다"
          aria-label=".xlsx 가져오기"
          :disabled="busy || !ready"
          data-doc-sheet-import
          @click="fileInput?.click()"
        >
          <FileUp />
        </Button>
      </template>
      <Button
        variant="ghost"
        size="icon-sm"
        title=".xlsx 내려받기"
        aria-label=".xlsx 내려받기"
        :disabled="busy || !ready"
        data-doc-sheet-download
        @click="download"
      >
        <FileDown />
      </Button>
    </div>

    <p
      v-if="problem && !readonly"
      class="flex items-center gap-1.5 text-xs text-destructive"
      role="alert"
      data-doc-sheet-problem
    >
      <TriangleAlert class="size-3.5" />
      {{ problem }} 표를 저장하지 않았습니다 — 줄이거나 나눠 주세요.
    </p>

    <div class="doc-sheet overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div ref="host" class="min-h-[200px]" data-doc-sheet-host />
    </div>

    <div class="flex flex-wrap items-center gap-1" data-doc-sheet-tabs @mousedown.stop>
      <template v-for="(name, i) in names" :key="`${i}:${name}`">
        <div
          :class="
            cn(
              'flex h-7 items-center rounded-md border text-xs',
              i === active
                ? 'border-border bg-card font-medium text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          "
        >
          <button
            type="button"
            class="h-full max-w-[200px] truncate px-2.5"
            :aria-pressed="i === active"
            :data-doc-sheet-tab="i"
            @click="openSheet(i)"
          >
            {{ name }}
          </button>
          <Popover v-if="i === active && !readonly" :open="menuOpen" @update:open="openMenu">
            <PopoverTrigger as-child>
              <button
                type="button"
                class="mr-0.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="시트 메뉴"
                data-doc-sheet-tab-menu
              >
                <Ellipsis class="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" class="flex w-64 flex-col gap-2 p-3">
              <form class="flex flex-col gap-1.5" @submit.prevent="rename">
                <label class="text-xs font-medium text-muted-foreground" for="doc-sheet-name"
                  >시트 이름</label
                >
                <div class="flex gap-1.5">
                  <Input
                    id="doc-sheet-name"
                    v-model="renaming"
                    class="h-8 text-xs"
                    data-doc-sheet-name
                  />
                  <Button
                    type="submit"
                    size="sm"
                    class="h-8"
                    :disabled="!!renameProblem"
                    data-doc-sheet-rename
                    >바꾸기</Button
                  >
                </div>
                <p v-if="renameProblem && renaming !== name" class="text-xs text-destructive">
                  {{ renameProblem }}
                </p>
              </form>
              <Button
                v-if="names.length > 1"
                variant="ghost"
                size="sm"
                class="justify-start text-destructive hover:text-destructive"
                data-doc-sheet-remove
                @click="askRemoveSheet"
              >
                시트 지우기
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </template>
      <Button
        v-if="!readonly"
        variant="ghost"
        size="icon-sm"
        :disabled="!ready || names.length >= SHEETS_MAX"
        :title="names.length >= SHEETS_MAX ? `시트는 ${SHEETS_MAX}개까지입니다` : '시트 더하기'"
        aria-label="시트 더하기"
        data-doc-sheet-add
        @click="addSheet"
      >
        <Plus />
      </Button>
      <span class="grow" />
      <span class="text-xs text-muted-foreground">
        우클릭으로 줄 · 열 넣기 · 지우기, '=' 로 수식, 엑셀에서 복사해 붙여 넣기
      </span>
    </div>

    <Dialog v-model:open="confirmOpen">
      <DialogContent class="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle class="text-pretty">{{ confirmBox?.title }}</DialogTitle>
          <DialogDescription class="text-pretty">{{ confirmBox?.description }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="confirmBox = null">취소</Button>
          <Button variant="destructive" data-doc-sheet-confirm @click="runConfirm">{{
            confirmBox?.label
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style>
/* Jspreadsheet 의 색을 우리 토큰으로 — 다크 모드에서도 칸 · 머리 · 선택이 읽히게 */
.doc-sheet {
  --border_color: var(--border);
  --border_color_highlighted: var(--primary);
  --header_background: var(--muted);
  --header_color: var(--muted-foreground);
  --header_background_highlighted: var(--accent);
  --header_color_highlighted: var(--foreground);
  --content_background: var(--card);
  --content_color: var(--card-foreground);
  --content_background_highlighted: var(--accent);
  --content_color_highlighted: var(--accent-foreground);
  --selection: color-mix(in oklab, var(--primary) 10%, transparent);
  --cursor: color-mix(in oklab, var(--primary) 16%, transparent);
  --menu_background: var(--popover);
  --menu_color: var(--popover-foreground);
  --menu_background_highlighted: var(--accent);
  --menu_color_highlighted: var(--accent-foreground);
  --menu_box_shadow: 0 6px 16px color-mix(in oklab, var(--foreground) 14%, transparent);
  --jss-border-color: var(--primary);
}
/* 시트 탭은 아래에 우리 것을 둔다 — 편집기는 tabs: false 여도 시트를 더하면 제 탭 줄을 띄운다 */
.doc-sheet .jtabs-headers-container {
  display: none;
}
.doc-sheet .jss_container {
  display: block;
  padding-right: 0;
}
/* 표를 넘치게 두면 편집기가 칸 상자에 그림자를 직접 박는다 */
.doc-sheet .jss_content {
  display: block;
  box-shadow: none !important;
  scrollbar-color: var(--input) transparent;
}
.doc-sheet .jss_content::-webkit-scrollbar-track {
  background: transparent;
}
.doc-sheet .jss_content::-webkit-scrollbar-thumb {
  background: var(--input);
  border-radius: 4px;
}
.doc-sheet .jss_worksheet {
  background-color: var(--card);
  font-family: inherit;
  font-size: 13px;
  color: var(--card-foreground);
}
.doc-sheet .jss_worksheet > thead > tr > td,
.doc-sheet .jss_worksheet > tbody > tr > td:first-child {
  font-size: 12px;
  font-weight: 500;
}
.doc-sheet .jss_worksheet > tbody > tr > td.readonly {
  color: var(--muted-foreground);
}
.doc-sheet .jss_worksheet .editor,
.doc-sheet .jss_worksheet > tbody > tr > td > input,
.doc-sheet .jss_worksheet > tbody > tr > td > textarea {
  background-color: var(--background);
  color: var(--foreground);
  font: inherit;
}
.doc-sheet .jss_worksheet .highlight-selected {
  outline: 1px solid var(--primary);
}
.doc-sheet .jss_corner {
  background-color: var(--primary);
  border-color: var(--card);
}
.doc-sheet .jss_contextmenu {
  border-radius: var(--radius);
  font-size: 13px;
  padding: 4px 0;
}
.doc-sheet .jss_contextmenu > div:not(.contextmenu-line) {
  padding: 6px 12px;
}
.doc-sheet .jss_contextmenu .contextmenu-line {
  border-top-color: var(--border);
}
</style>

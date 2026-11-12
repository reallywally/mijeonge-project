import { describe, expect, it } from 'vitest'
import {
  agendaBlock,
  agendaIdsProblem,
  agendaRow,
  appendAgendaRow,
  cellAddress,
  changedAgendaIds,
  cleanStyle,
  columnName,
  defaultSheetBook,
  editorSize,
  fitSheetName,
  insertBlock,
  nextSheetName,
  parseAddress,
  prefixLines,
  SHEET_BYTES_MAX,
  SHEET_CELL_MAX,
  SHEET_COLUMN_WIDTH,
  SHEET_COLUMNS_MAX,
  SHEET_MIN_COLUMNS,
  SHEET_MIN_ROWS,
  SHEET_ROWS_MAX,
  sheetBookBytes,
  sheetBookProblem,
  sheetNameProblem,
  tabFromEditor,
  trimBook,
  trimTab,
  worksheetOf,
  wrapSelection,
} from './document'
import type { SheetBook, SheetTab } from '@/types/domain'

const os = { title: '서버 OS 결정', decision: '우분투 최신 버전으로 한다' }
const blank = { title: '백업 주기', decision: '  ' }

describe('본문에 넣기 — 글', () => {
  it('블록은 ### 제목 + 빈 줄 + 결정내용, 결정이 비면 (아직 안 정함)', () => {
    expect(agendaBlock(os)).toBe('### 서버 OS 결정\n\n우분투 최신 버전으로 한다\n')
    expect(agendaBlock(blank)).toBe('### 백업 주기\n\n(아직 안 정함)\n')
  })

  it('커서가 없으면 끝에 — 앞 글과 빈 줄 하나로 뗀다', () => {
    expect(insertBlock('', 'B\n', null)).toEqual({ content: 'B\n', cursor: 2 })
    expect(insertBlock('앞 글', 'B\n', null)).toEqual({ content: '앞 글\n\nB\n', cursor: 7 })
    expect(insertBlock('앞 글\n', 'B\n', null).content).toBe('앞 글\n\nB\n')
    expect(insertBlock('앞 글\n\n', 'B\n', null).content).toBe('앞 글\n\nB\n')
  })

  it('커서 자리에 끼우고, 뒤 글이 바로 붙으면 줄을 바꾼다. cursor 는 블록 바로 뒤', () => {
    const r = insertBlock('첫 줄\n둘째 줄', 'B\n', 4)
    expect(r.content).toBe('첫 줄\n\nB\n\n둘째 줄')
    expect(r.content.slice(0, r.cursor)).toBe('첫 줄\n\nB\n')
    /* 이어 넣으면 차례로 쌓인다 */
    const again = insertBlock(r.content, 'C\n', r.cursor)
    expect(again.content).toBe('첫 줄\n\nB\n\nC\n\n둘째 줄')
  })
})

describe('본문에 넣기 — 표', () => {
  it('[제목, 결정내용, …빈 칸] — 열이 하나여도 두 칸', () => {
    expect(agendaRow(os, 3)).toEqual(['서버 OS 결정', '우분투 최신 버전으로 한다', ''])
    expect(agendaRow(os, 2)).toEqual(['서버 OS 결정', '우분투 최신 버전으로 한다'])
    expect(agendaRow(blank, 1)).toEqual(['백업 주기', '(아직 안 정함)'])
  })

  it('지금 보는 시트의 적은 줄 끝에 한 줄 — 다른 시트 · 원본은 그대로, 칸은 32,767자로 자른다', () => {
    const book: SheetBook = {
      sheets: [
        { ...defaultSheetBook().sheets[0], data: [['a', 'b']] },
        { ...defaultSheetBook().sheets[0], name: 'Sheet2' },
      ],
    }
    const next = appendAgendaRow(book, 0, { title: 'x', decision: 'y'.repeat(SHEET_CELL_MAX + 9) })!
    expect(next.sheets[0].data).toHaveLength(2)
    expect(next.sheets[0].data[1][1]).toHaveLength(SHEET_CELL_MAX)
    expect(next.sheets[1]).toBe(book.sheets[1])
    expect(book.sheets[0].data).toHaveLength(1)
    /* 첫 줄이 '항목 · 내용' 머리여도 그 아래로 붙는다 */
    expect(appendAgendaRow(book, 1, os)!.sheets[1].data).toEqual([
      ['항목', '내용'],
      ['서버 OS 결정', '우분투 최신 버전으로 한다'],
    ])
  })

  it('쓴 열이 하나뿐인 시트엔 B 열을 기본 너비로 더해 두 칸에 넣는다', () => {
    const book: SheetBook = {
      sheets: [{ name: 'Sheet1', columns: [{ width: 300 }], data: [], merges: {}, styles: {} }],
    }
    const next = appendAgendaRow(book, 0, os)!
    expect(next.sheets[0].columns).toEqual([{ width: 300 }, { width: SHEET_COLUMN_WIDTH }])
    expect(next.sheets[0].data).toEqual([['서버 OS 결정', '우분투 최신 버전으로 한다']])
  })

  it('줄이 꽉 찼거나 없는 시트면 null', () => {
    const full: SheetBook = {
      sheets: [
        {
          ...defaultSheetBook().sheets[0],
          /* 듬성한 배열 — 줄 수만 본다 */
          data: new Array<string[]>(SHEET_ROWS_MAX),
        },
      ],
    }
    expect(appendAgendaRow(full, 0, os)).toBeNull()
    expect(appendAgendaRow(full, 3, os)).toBeNull()
  })
})

describe('칸 주소', () => {
  it('열 번호 ↔ 글자, (열, 줄) ↔ A1', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
    expect(cellAddress(0, 0)).toBe('A1')
    expect(cellAddress(27, 9)).toBe('AB10')
    expect(parseAddress('AB10')).toEqual({ col: 27, row: 9 })
    expect(parseAddress('A1')).toEqual({ col: 0, row: 0 })
    for (const bad of ['a1', 'A0', 'A', '1', 'ABCD1', 'A1:B2'])
      expect(parseAddress(bad), bad).toBeNull()
    /* 엑셀과 같은 끝 — XFD 열 · 1,048,576줄 */
    expect(columnName(SHEET_COLUMNS_MAX - 1)).toBe('XFD')
    expect(cellAddress(SHEET_COLUMNS_MAX - 1, SHEET_ROWS_MAX - 1)).toBe('XFD1048576')
    expect(parseAddress('XFD1048576')).toEqual({
      col: SHEET_COLUMNS_MAX - 1,
      row: SHEET_ROWS_MAX - 1,
    })
    for (const out of ['XFE1', 'ZZZ1', 'A1048577', 'A9999999'])
      expect(parseAddress(out), out).toBeNull()
    for (let c = 0; c < 800; c += 37)
      expect(parseAddress(cellAddress(c, 41))).toEqual({ col: c, row: 41 })
  })
})

describe('시트 이름', () => {
  it('새 이름은 안 쓴 Sheet n, 검사는 앞뒤 공백을 뗀 값으로', () => {
    expect(nextSheetName(['Sheet1'])).toBe('Sheet2')
    expect(nextSheetName(['Sheet1', 'Sheet3'])).toBe('Sheet4')
    expect(nextSheetName(['Sheet2', 'x'])).toBe('Sheet3')
    expect(sheetNameProblem('  ', [])).toContain('적어')
    expect(sheetNameProblem('x'.repeat(32), [])).toContain('31자')
    expect(sheetNameProblem(' 요약 ', ['요약'])).toContain('같은 이름')
    expect(sheetNameProblem(' 요약 ', ['Sheet1'])).toBeNull()
  })

  it('가져온 이름은 31자로 자르고 겹치면 (2) 를 단다', () => {
    expect(fitSheetName('요약', [])).toBe('요약')
    expect(fitSheetName('요약', ['요약'])).toBe('요약 (2)')
    expect(fitSheetName('요약', ['요약', '요약 (2)'])).toBe('요약 (3)')
    expect(fitSheetName('', [])).toBe('Sheet (2)')
    const long = fitSheetName('x'.repeat(40), ['x'.repeat(31)])
    expect(long).toHaveLength(31)
    expect(long.endsWith(' (2)')).toBe(true)
  })
})

describe('편집기 ↔ SheetBook', () => {
  const tab: SheetTab = {
    name: '요약',
    columns: [{ width: 200 }, { width: 80 }],
    data: [
      ['1', '2'],
      ['=SUM(A1:B1)', ''],
    ],
    merges: { A5: [2, 3] },
    styles: { A1: 'font-weight: bold' },
  }

  it('편집기 설정 — 엑셀처럼 적어도 A ~ Z · 100줄을 빈 칸으로 깐다', () => {
    const ws = worksheetOf(tab)
    expect(ws.worksheetName).toBe('요약')
    expect(ws.data).toHaveLength(SHEET_MIN_ROWS)
    expect(ws.data![0]).toHaveLength(SHEET_MIN_COLUMNS)
    expect((ws.data as string[][])[1].slice(0, 3)).toEqual(['=SUM(A1:B1)', '', ''])
    expect((ws.data as string[][])[99].every((v) => v === '')).toBe(true)
    /* title 을 안 줘서 머리는 A · B, 넓혀 깐 열은 기본 너비 */
    expect(ws.columns).toHaveLength(SHEET_MIN_COLUMNS)
    expect(ws.columns!.slice(0, 3).map((c) => [c.title, c.width])).toEqual([
      [undefined, 200],
      [undefined, 80],
      [undefined, SHEET_COLUMN_WIDTH],
    ])
    expect(ws.mergeCells).toEqual({ A5: [2, 3] })
    expect(ws.style).toEqual({ A1: 'font-weight: bold' })
    expect(ws.minDimensions).toEqual([SHEET_MIN_COLUMNS, SHEET_MIN_ROWS])
  })

  it('편집기에 깔 크기 — 쓴 범위가 더 크면 그만큼 + 여유, 엑셀 상한까지', () => {
    expect(editorSize(tab)).toEqual({ columns: 26, rows: 100 })
    /* 병합 · 꾸밈이 닿는 칸까지 덮는다 */
    expect(editorSize({ ...tab, merges: { A140: [1, 5] } }).rows).toBe(144 + 50)
    expect(editorSize({ ...tab, styles: { AD3: 'color: red' } }).columns).toBe(30 + 10)
    expect(editorSize({ ...tab, merges: { Z1: [4, 1] } }).columns).toBe(29 + 10)
    /* 너비만 바꾼 열도 쓴 범위다 */
    const wide = Array.from({ length: 40 }, (_, i) => ({ width: i === 39 ? 300 : 120 }))
    expect(editorSize({ ...tab, columns: wide }).columns).toBe(50)
    /* 끝의 빈 줄은 안 센다 */
    expect(editorSize({ ...tab, data: Array.from({ length: 3000 }, () => ['']) }).rows).toBe(100)
    expect(
      editorSize({
        ...tab,
        columns: Array.from({ length: SHEET_COLUMNS_MAX }, () => ({ width: 300 })),
        merges: { A1048570: [1, 7] },
      }),
    ).toEqual({ columns: SHEET_COLUMNS_MAX, rows: SHEET_ROWS_MAX })
  })

  it('저장은 쓴 범위뿐 — 끝의 빈 줄 · 빈 열을 떼고, 값 · 병합 · 꾸밈 · 기본과 다른 너비가 범위를 잡는다', () => {
    const editor = (patch: Partial<Parameters<typeof tabFromEditor>[0]>) =>
      tabFromEditor({
        name: 'S',
        widths: Array<number>(SHEET_MIN_COLUMNS).fill(SHEET_COLUMN_WIDTH),
        data: Array.from({ length: SHEET_MIN_ROWS }, () =>
          Array<string>(SHEET_MIN_COLUMNS).fill(''),
        ),
        merges: {},
        styles: {},
        ...patch,
      })
    /* 다 비면 1열 · 0줄 */
    expect(editor({})).toEqual({
      name: 'S',
      columns: [{ width: SHEET_COLUMN_WIDTH }],
      data: [],
      merges: {},
      styles: {},
    })
    const data = Array.from({ length: SHEET_MIN_ROWS }, () =>
      Array<string>(SHEET_MIN_COLUMNS).fill(''),
    )
    data[2][3] = 'x'
    const valued = editor({ data })
    expect(valued.columns).toHaveLength(4)
    expect(valued.data).toEqual([
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', 'x'],
    ])
    const widths = Array<number>(SHEET_MIN_COLUMNS).fill(SHEET_COLUMN_WIDTH)
    widths[6] = 200
    expect(editor({ widths }).columns).toHaveLength(7)
    expect(editor({ widths }).columns[6]).toEqual({ width: 200 })
    expect(
      editor({ styles: { J40: 'background-color: #fff2cc', K1: 'text-align: left' } }),
    ).toMatchObject({
      columns: Array.from({ length: 10 }, () => ({ width: SHEET_COLUMN_WIDTH })),
      data: [],
      styles: { J40: 'background-color: #fff2cc' },
    })
    expect(editor({ merges: { E2: [3, 2] } }).columns).toHaveLength(7)
    /* 저장된 표를 trimTab 해도 같은 꼴 — 넓혀 깔기만 하면 같은 책이라 안 보낸다 */
    const stored: SheetTab = {
      name: 'S',
      columns: Array.from({ length: 10 }, () => ({ width: SHEET_COLUMN_WIDTH })),
      data: [['a'], [], ['', 'b']],
      merges: {},
      styles: {},
    }
    expect(trimTab(stored)).toEqual({
      ...stored,
      columns: stored.columns.slice(0, 2),
      data: [
        ['a', ''],
        ['', ''],
        ['', 'b'],
      ],
    })
    const ws = worksheetOf(stored)
    expect(
      JSON.stringify(
        tabFromEditor({
          name: ws.worksheetName!,
          widths: ws.columns!.map((c) => c.width),
          data: ws.data as unknown[][],
          merges: ws.mergeCells!,
          styles: ws.style!,
        }),
      ),
    ).toBe(JSON.stringify(trimBook({ sheets: [stored] }).sheets[0]))
  })

  it('편집기에서 읽은 것 — 칸은 문자열(숫자 · null 도), 끝의 빈 줄은 떼고, 수식은 원문 그대로', () => {
    const got = tabFromEditor({
      name: ' 요약 ',
      widths: [200, '80.4'],
      data: [
        ['1', 2],
        ['=SUM(A1:B1)', null],
        [undefined, ''],
        ['', ''],
      ],
      merges: { A5: [2, 3], B9: [1, 1], bad: [2, 2] },
      styles: {
        A1: 'text-align: left; font-weight: bold; overflow: hidden;',
        B1: 'text-align: left;',
        A2: 'display: none; color: red; background-color: #fff2cc; text-align: center',
      },
    })
    expect(got).toEqual({
      name: '요약',
      columns: [{ width: 200 }, { width: 80 }],
      data: [
        ['1', '2'],
        ['=SUM(A1:B1)', ''],
      ],
      merges: { A5: [2, 3] },
      styles: {
        A1: 'font-weight: bold',
        A2: 'color: red; background-color: #fff2cc; text-align: center',
      },
    })
    /* 다시 띄워 읽으면 같다 */
    const ws = worksheetOf(got)
    expect(
      tabFromEditor({
        name: ws.worksheetName!,
        widths: ws.columns!.map((c) => c.width),
        data: ws.data as unknown[][],
        merges: ws.mergeCells!,
        styles: ws.style!,
      }),
    ).toEqual(got)
  })

  it('열은 너비만 — 20 ~ 1,000 으로 자른다', () => {
    const got = tabFromEditor({
      name: 'S',
      widths: [5, 5000, 'abc'],
      data: [],
      merges: {},
      styles: {},
    })
    /* 못 읽는 너비는 기본 너비 — 빈 열이라 끝에서 떨어진다 */
    expect(got.columns).toEqual([{ width: 20 }, { width: 1000 }])
  })

  it('꾸밈은 도구 줄로 고치는 것만, 기본값(왼쪽 · 보통)은 뺀다', () => {
    expect(cleanStyle('font-weight: normal; font-style: italic; width: 3px')).toBe(
      'font-style: italic',
    )
    expect(cleanStyle('color: red; color: blue')).toBe('color: blue')
    expect(cleanStyle('')).toBe('')
  })
})

describe('표 검사', () => {
  const ok = defaultSheetBook()
  const one = (patch: Partial<SheetTab>): SheetBook => ({ sheets: [{ ...ok.sheets[0], ...patch }] })

  it('기본 표는 통과, 시트 수 · 이름 · 열 · 줄 · 칸 · 너비 · 병합 · 꾸밈 · 크기를 본다', () => {
    expect(sheetBookProblem(ok)).toBeNull()
    expect(ok.sheets[0]).toEqual({
      name: 'Sheet1',
      columns: [{ width: 200 }, { width: 400 }],
      data: [['항목', '내용']],
      merges: {},
      styles: { A1: 'font-weight: bold', B1: 'font-weight: bold' },
    })
    /* 열 이름은 없다 — 서버도 422 */
    expect(
      sheetBookProblem(
        one({ columns: [{ title: '항목', width: 200 } as SheetTab['columns'][number]] }),
      ),
    ).toContain('너비만')
    expect(sheetBookProblem({ sheets: [] })).toContain('시트는')
    expect(
      sheetBookProblem({
        sheets: Array.from({ length: 11 }, (_, i) => ({ ...ok.sheets[0], name: `S${i}` })),
      }),
    ).toContain('시트는')
    expect(sheetBookProblem({ sheets: [ok.sheets[0], ok.sheets[0]] })).toContain('겹칩니다')
    expect(sheetBookProblem(one({ name: '' }))).toContain('시트 이름')
    expect(sheetBookProblem(one({ columns: [] }))).toContain('열은')
    expect(
      sheetBookProblem(
        one({
          columns: Array.from({ length: SHEET_COLUMNS_MAX + 1 }, () => ({ width: 100 })),
        }),
      ),
    ).toContain('열은')
    expect(sheetBookProblem(one({ data: new Array<string[]>(SHEET_ROWS_MAX + 1) }))).toContain(
      '줄은',
    )
    expect(sheetBookProblem(one({ data: [['a', 'b', 'c']] }))).toContain('칸 수')
    expect(sheetBookProblem(one({ data: [['x'.repeat(SHEET_CELL_MAX + 1)]] }))).toContain(
      '32,767자',
    )
    expect(sheetBookProblem(one({ data: [[1 as unknown as string]] }))).toContain('32,767자')
    expect(sheetBookProblem(one({ columns: [{ width: 10 }], data: [] }))).toContain('너비')
    expect(sheetBookProblem(one({ merges: { a1: [2, 1] } }))).toContain('병합')
    expect(sheetBookProblem(one({ merges: { A1: [0, 1] } }))).toContain('병합')
    expect(sheetBookProblem(one({ styles: { A1: 'x'.repeat(201) } }))).toContain('꾸밈')
    /* 열 · 줄 · 칸은 엑셀 상한까지 받는다 */
    expect(
      sheetBookProblem(
        one({
          columns: Array.from({ length: SHEET_COLUMNS_MAX }, () => ({ width: 100 })),
          data: [],
          merges: { XFC1048575: [2, 2] },
          styles: { XFD1048576: 'font-weight: bold' },
        }),
      ),
    ).toBeNull()
    expect(
      sheetBookProblem(one({ columns: [{ width: 100 }], data: [['x'.repeat(SHEET_CELL_MAX)]] })),
    ).toBeNull()
    expect(sheetBookProblem(one({ styles: { XFE1: 'font-weight: bold' } }))).toContain('꾸밈')
    /* 상한 안이라도 5MB 를 넘으면 — 실제로 막히는 것은 대개 이것 */
    const big = one({
      columns: [{ width: 100 }],
      data: Array.from({ length: 60 }, () => ['가'.repeat(SHEET_CELL_MAX)]),
    })
    expect(sheetBookBytes(big)).toBeGreaterThan(SHEET_BYTES_MAX)
    expect(sheetBookProblem(big)).toContain('5MB')
  })

  it('안건은 50개까지, 겹치면 안 된다', () => {
    expect(agendaIdsProblem(['t1', 't2'])).toBeNull()
    expect(agendaIdsProblem(['t1', 't1'])).toContain('두 번')
    expect(agendaIdsProblem(Array.from({ length: 51 }, (_, i) => `a${i}`))).toContain('50개')
  })
})

describe('결정 바뀜', () => {
  it('지금 판 > 적어 둔 판인 것만, 연결 순서로. 지운 안건은 뺀다', () => {
    const revs: Record<string, number> = { t1: 2, t2: 1 }
    const links = [
      { agendaId: 't1', seenRev: 1 },
      { agendaId: 'gone', seenRev: 0 },
      { agendaId: 't2', seenRev: 1 },
    ]
    expect(changedAgendaIds(links, (id) => revs[id] ?? null)).toEqual(['t1'])
  })
})

describe('서식 버튼', () => {
  it('굵게 — 고른 글을 감싸고, 없으면 자리 글을 넣어 고른다', () => {
    expect(wrapSelection('ab cd', 3, 5, '**', '굵게')).toEqual({
      text: 'ab **cd**',
      start: 5,
      end: 7,
    })
    expect(wrapSelection('', 0, 0, '**', '굵게')).toEqual({ text: '**굵게**', start: 2, end: 4 })
  })

  it('제목 · 목록 — 고른 줄마다 달고, 다 달려 있으면 뗀다', () => {
    expect(prefixLines('하나\n둘\n셋', 0, 4, '- ').text).toBe('- 하나\n- 둘\n셋')
    expect(prefixLines('- 하나\n- 둘', 0, 8, '- ').text).toBe('하나\n둘')
    expect(prefixLines('제목', 1, 1, '## ').text).toBe('## 제목')
  })
})

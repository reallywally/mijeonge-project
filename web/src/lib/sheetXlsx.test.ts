import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { SHEET_CELL_MAX, SHEET_ROWS_MAX, worksheetOf } from './document'
import { bookFromWorkbook, workbookFromBook, xlsxFileName } from './sheetXlsx'
import type { SheetBook } from '@/types/domain'

const book: SheetBook = {
  sheets: [
    {
      name: '요약',
      columns: [{ width: 200 }, { width: 80 }, { width: 120 }],
      data: [
        ['CPU', '2', ''],
        ['RAM', '4', ''],
        ['합', '=SUM(B1:B2)', ''],
        ['긴 칸', '', ''],
      ],
      merges: { A4: [3, 1] },
      styles: { A1: 'font-weight: bold' },
    },
    {
      name: '메모/초안',
      columns: [{ width: 120 }],
      data: [['우분투']],
      merges: {},
      styles: {},
    },
  ],
}

/** 파일로 썼다가 다시 읽는다 — 브라우저의 내려받기 → 가져오기와 같은 길 */
function roundTrip(b: SheetBook, shown?: Parameters<typeof workbookFromBook>[1]) {
  const bytes = XLSX.write(workbookFromBook(b, shown), { type: 'array', bookType: 'xlsx' })
  return XLSX.read(bytes, { cellFormula: true, cellStyles: true, cellDates: true })
}

describe('.xlsx', () => {
  it('내보낸 파일을 다시 가져오면 값 · 수식 · 병합 · 열 너비가 남는다(꾸밈은 CE 가 못 쓴다)', () => {
    const wb = roundTrip(book, (s, r, c) => (s === 0 && r === 2 && c === 1 ? '6' : undefined))
    /* 엑셀이 못 받는 글자는 _ 로 */
    expect(wb.SheetNames).toEqual(['요약', '메모_초안'])
    const ws = wb.Sheets['요약']
    expect(ws.B3.f).toBe('SUM(B1:B2)')
    expect(ws.B3.v).toBe(6)
    expect(ws.B1.t).toBe('n')

    const { book: back, clipped } = bookFromWorkbook(wb)
    expect(clipped).toBe(false)
    expect(back.sheets.map((s) => s.name)).toEqual(['요약', '메모_초안'])
    const [first] = back.sheets
    expect(first.data).toEqual([
      ['CPU', '2', ''],
      ['RAM', '4', ''],
      ['합', '=SUM(B1:B2)', ''],
      ['긴 칸', '', ''],
    ])
    expect(first.merges).toEqual({ A4: [3, 1] })
    expect(first.columns.every((c) => Object.keys(c).join() === 'width')).toBe(true)
    /* 너비는 엑셀 단위를 거쳐 오니 몇 px 어긋날 수 있다 */
    first.columns.forEach((c, i) =>
      expect(Math.abs(c.width - book.sheets[0].columns[i].width)).toBeLessThan(12),
    )
  })

  it('가져오기 — 참 · 거짓 · 날짜는 글로, 빈 파일은 시트 하나', () => {
    const ws = XLSX.utils.aoa_to_sheet([[true, false, new Date(Date.UTC(2026, 10, 12))]], {
      cellDates: true,
      dateNF: 'yyyy-mm-dd',
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const read = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { cellDates: true })
    const row = bookFromWorkbook(read).book.sheets[0].data[0]
    expect(row.slice(0, 2)).toEqual(['TRUE', 'FALSE'])
    expect(row[2]).toContain('2026')

    expect(bookFromWorkbook({ SheetNames: [], Sheets: {} }).book.sheets).toHaveLength(1)
  })

  it('가져오기 — 엑셀 상한(1,048,576줄 · 칸 32,767자)을 넘는 것은 자르고, 범위는 있는 칸만 본다', () => {
    /* 꾸밈 범위가 XFD1048576 까지 잡힌 파일 — 칸을 다 펴지 않는다 */
    const wb: XLSX.WorkBook = {
      SheetNames: ['T'],
      Sheets: {
        T: {
          '!ref': 'A1:XFD1048577',
          A1: { t: 's', v: 'x'.repeat(SHEET_CELL_MAX + 3) },
          C2: { t: 'n', v: 3 },
          A1048577: { t: 's', v: '넘친 줄' },
        },
      },
    }
    const got = bookFromWorkbook(wb)
    expect(got.clipped).toBe(true)
    expect(got.tooBig).toBe(false)
    const [tab] = got.book.sheets
    expect(tab.columns).toHaveLength(3)
    expect(tab.data).toHaveLength(2)
    expect(tab.data[0][0]).toHaveLength(SHEET_CELL_MAX)
    expect(tab.data[1]).toEqual(['', '', '3'])
    expect(got.book.sheets[0].data.length).toBeLessThan(SHEET_ROWS_MAX)
    /* 가져온 뒤에도 편집기는 A ~ Z · 100줄 */
    expect(worksheetOf(tab).minDimensions).toEqual([26, 100])
  })

  it('가져오기 — 5MB 를 넘으면 tooBig, 칸을 펴기만 해도 넘으면 펴지 않는다', () => {
    const far: XLSX.WorkBook = {
      SheetNames: ['T'],
      Sheets: {
        T: { '!ref': 'A1:XFD1048576', A1: { t: 'n', v: 1 }, XFD1048576: { t: 'n', v: 2 } },
      },
    }
    const got = bookFromWorkbook(far)
    expect(got.tooBig).toBe(true)
    expect(got.clipped).toBe(false)

    const heavy: XLSX.WorkBook = {
      SheetNames: ['T'],
      Sheets: {
        T: Object.fromEntries(
          Array.from({ length: 60 }, (_, r) => [
            `A${r + 1}`,
            { t: 's', v: '가'.repeat(SHEET_CELL_MAX) },
          ]),
        ),
      },
    }
    expect(bookFromWorkbook(heavy).tooBig).toBe(true)
  })

  it('파일 이름은 문서 제목 — 못 쓰는 글자는 _', () => {
    expect(xlsxFileName('결정 사항 모음')).toBe('결정 사항 모음.xlsx')
    expect(xlsxFileName('a/b:c')).toBe('a_b_c.xlsx')
    expect(xlsxFileName('  ')).toBe('표 문서.xlsx')
  })
})

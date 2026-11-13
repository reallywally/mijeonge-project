import { describe, expect, it } from 'vitest'
import { docFolderRows, documentRows } from '@/fixtures'
import {
  docTreeRows,
  folderDepth,
  folderMoveProblem,
  folderNameProblem,
  folderNameTaken,
  folderOptions,
  folderPath,
  subtreeHeight,
} from '@/lib/docFolder'
import type { DocFolder, ProjectDocSummary } from '@/types/domain'

/* 폴더 — 이름 · 깊이 · 옮기기 검사와 트리 펴기 */
const folders = docFolderRows
const docs = documentRows.map(
  (d) => ({ ...d, agendas: d.links, changedAgendaIds: [] }) as unknown as ProjectDocSummary,
)
const shape = (rows: ReturnType<typeof docTreeRows>) =>
  rows.map((r) =>
    r.type === 'folder' ? `${r.depth}f:${r.folder.name}` : `${r.depth}d:${r.doc.title}`,
  )

describe('이름', () => {
  it('앞뒤 공백 뗀 1 ~ 100자, 같은 부모 아래 겹침(대소문자 그대로)', () => {
    expect(folderNameProblem(' ')).not.toBeNull()
    expect(folderNameProblem(null)).not.toBeNull()
    expect(folderNameProblem('x'.repeat(100))).toBeNull()
    expect(folderNameProblem('x'.repeat(101))).not.toBeNull()
    expect(folderNameTaken(folders, null, ' 인프라 ')).toBe(true)
    expect(folderNameTaken(folders, 'df1', '인프라')).toBe(false)
    expect(folderNameTaken(folders, null, '인프라', 'df1')).toBe(false)
  })
})

describe('깊이 · 옮기기', () => {
  it('맨 위 폴더가 1단, 높이는 딸린 하위까지', () => {
    expect(folderDepth(folders, null)).toBe(0)
    expect(folderDepth(folders, 'df2')).toBe(2)
    expect(subtreeHeight(folders, 'df1')).toBe(2)
    expect(folderPath(folders, 'df2')).toBe('인프라 / 서버')
    expect(folderPath(folders, null)).toBe('최상위')
    expect(folderOptions(folders).map((f) => `${f.depth}${f.name}`)).toEqual([
      '1인프라',
      '2서버',
      '1회의 정리',
    ])
  })

  it('자기 · 하위로는 cycle, 5단을 넘으면 deep', () => {
    expect(folderMoveProblem(folders, 'df1', 'df1')).toBe('cycle')
    expect(folderMoveProblem(folders, 'df1', 'df2')).toBe('cycle')
    expect(folderMoveProblem(folders, 'df1', 'df3')).toBeNull()
    const chain: DocFolder[] = [...folders]
    let parent = 'df3'
    for (const id of ['x1', 'x2', 'x3']) {
      chain.push({ ...folders[2], id, parentId: parent, name: id })
      parent = id
    }
    /* x3 는 4단 — 인프라(높이 2)를 넣으면 6단 */
    expect(folderMoveProblem(chain, 'df1', 'x3')).toBe('deep')
    expect(folderMoveProblem(chain, 'df2', 'x3')).toBeNull()
  })
})

describe('트리 펴기', () => {
  it('폴더 먼저 이름순, 그다음 문서 제목순 — 펼친 폴더만 안을 보인다', () => {
    expect(shape(docTreeRows(folders, docs, new Set(), false))).toEqual([
      '0f:인프라',
      '0f:회의 정리',
      '0d:결정 사항 모음',
    ])
    const rows = docTreeRows(folders, docs, new Set(['df1']), false)
    expect(shape(rows)).toEqual([
      '0f:인프라',
      '1f:서버',
      '1d:서버 구성',
      '0f:회의 정리',
      '0d:결정 사항 모음',
    ])
    expect(rows[0]).toMatchObject({ count: 1, open: true })
  })

  it('거르는 중이면 맞는 문서가 없는 폴더는 숨기고 남은 폴더는 펼친다', () => {
    const only = docs.filter((d) => d.id === 'doc1')
    expect(shape(docTreeRows(folders, only, new Set(), true))).toEqual([
      '0f:인프라',
      '1d:서버 구성',
    ])
  })

  it('없는 폴더를 가리키는 문서는 맨 위', () => {
    const lost = docs.map((d) => ({ ...d, folderId: 'gone' }))
    expect(shape(docTreeRows([], lost, new Set(), false))).toEqual([
      '0d:결정 사항 모음',
      '0d:서버 구성',
    ])
  })
})

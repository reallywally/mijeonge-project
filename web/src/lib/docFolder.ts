import type { DocFolder, ProjectDocSummary } from '@/types/domain'

/*
 * 문서 폴더 (docs/api/document.md '폴더') — 이름 · 깊이 · 옮기기 검사와 트리 세우기.
 * 화면이 막고, 목업 서버가 같은 함수로 400 · 409 · 422 를 낸다.
 */

export const DOC_FOLDER_NAME_MAX = 100
/** 맨 위 폴더가 1단 */
export const DOC_FOLDER_DEPTH_MAX = 5

type FolderLink = Pick<DocFolder, 'id' | 'parentId'>
type NamedFolder = Pick<DocFolder, 'id' | 'parentId' | 'name'>

const koCompare = (a: string, b: string) => a.localeCompare(b, 'ko')

export function folderNameProblem(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return '폴더 이름을 적어 주세요.'
  const t = name.trim()
  if (!t) return '폴더 이름을 적어 주세요.'
  if (t.length > DOC_FOLDER_NAME_MAX) return `폴더 이름은 ${DOC_FOLDER_NAME_MAX}자까지입니다.`
  return null
}

/** 같은 부모 아래 같은 이름(앞뒤 공백 뗀 값, 대소문자 그대로) — 자기 자신(exceptId)은 뺀다 */
export const folderNameTaken = (
  folders: readonly NamedFolder[],
  parentId: string | null,
  name: string,
  exceptId?: string,
) => folders.some((f) => f.id !== exceptId && f.parentId === parentId && f.name === name.trim())

export const FOLDER_NAME_TAKEN = '같은 자리에 같은 이름의 폴더가 있습니다.'

/** 맨 위부터 그 폴더까지의 id — 자기 포함. 고리가 있어도 멈춘다 */
export function folderChain(folders: readonly FolderLink[], folderId: string | null): string[] {
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const out: string[] = []
  let at = folderId
  while (at !== null && byId.has(at) && !out.includes(at)) {
    out.unshift(at)
    at = byId.get(at)!.parentId
  }
  return out
}

/** 몇 단인가 — 맨 위 폴더가 1, 맨 위(null)는 0 */
export const folderDepth = (folders: readonly FolderLink[], folderId: string | null) =>
  folderChain(folders, folderId).length

/** 그 폴더와 딸린 하위 폴더의 높이 — 하위가 없으면 1 */
export function subtreeHeight(folders: readonly FolderLink[], folderId: string): number {
  const kids = folders.filter((f) => f.parentId === folderId)
  return 1 + Math.max(0, ...kids.map((k) => subtreeHeight(folders, k.id)))
}

/** target 이 folderId 자신이거나 그 하위인가 */
export const isWithin = (folders: readonly FolderLink[], target: string | null, folderId: string) =>
  folderChain(folders, target).includes(folderId)

/** 폴더를 parentId 아래로 옮기면 걸리는 것 — 고리 · 깊이. 없으면 null */
export function folderMoveProblem(
  folders: readonly FolderLink[],
  folderId: string,
  parentId: string | null,
): 'cycle' | 'deep' | null {
  if (parentId !== null && isWithin(folders, parentId, folderId)) return 'cycle'
  if (folderDepth(folders, parentId) + subtreeHeight(folders, folderId) > DOC_FOLDER_DEPTH_MAX)
    return 'deep'
  return null
}

export const FOLDER_MOVE_MESSAGE = {
  cycle: '폴더를 자기 안으로 옮길 수 없습니다.',
  deep: `폴더는 ${DOC_FOLDER_DEPTH_MAX}단까지입니다.`,
} as const

/** '인프라 / 서버' — 맨 위면 '최상위' */
export function folderPath(folders: readonly NamedFolder[], folderId: string | null): string {
  const names = new Map(folders.map((f) => [f.id, f.name] as const))
  const chain = folderChain(folders, folderId)
  return chain.length === 0 ? '최상위' : chain.map((id) => names.get(id)).join(' / ')
}

/** 폴더 고르기 목록 — 트리 순서(폴더 이름순)로 펴고 깊이를 붙인다 */
export function folderOptions(
  folders: readonly NamedFolder[],
): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders
      .filter((x) => x.parentId === parentId)
      .sort((a, b) => koCompare(a.name, b.name))) {
      out.push({ id: f.id, name: f.name, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

/* ── 트리 ─────────────────────────────────────────────── */

export interface DocTreeFolderRow {
  type: 'folder'
  folder: DocFolder
  depth: number
  /** 든 문서 수 — 하위까지, 보이는 문서로 센다 */
  count: number
  open: boolean
}

export interface DocTreeDocRow {
  type: 'doc'
  doc: ProjectDocSummary
  depth: number
}

export type DocTreeRow = DocTreeFolderRow | DocTreeDocRow

/**
 * 트리를 줄로 편다 — 폴더 먼저 이름순, 그다음 문서 제목순(한국어 정렬). 맨 위 줄이 depth 0.
 * filtering 이면 맞는 문서가 없는 폴더는 숨기고, 남은 폴더는 다 펼친다. 아니면 opened 에 든 폴더만 펼친다.
 * 없는 폴더를 가리키는 문서는 맨 위에 둔다
 */
export function docTreeRows(
  folders: readonly DocFolder[],
  docs: readonly ProjectDocSummary[],
  opened: ReadonlySet<string>,
  filtering: boolean,
): DocTreeRow[] {
  const known = new Set(folders.map((f) => f.id))
  const docsIn = new Map<string | null, ProjectDocSummary[]>()
  for (const d of docs) {
    const at = d.folderId !== null && known.has(d.folderId) ? d.folderId : null
    docsIn.set(at, [...(docsIn.get(at) ?? []), d])
  }
  const kidsOf = new Map<string | null, DocFolder[]>()
  for (const f of folders) {
    const at = f.parentId !== null && known.has(f.parentId) ? f.parentId : null
    kidsOf.set(at, [...(kidsOf.get(at) ?? []), f])
  }
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  const countOf = (id: string): number => {
    if (counts.has(id)) return counts.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const n =
      (docsIn.get(id)?.length ?? 0) +
      (kidsOf.get(id) ?? []).reduce((sum, k) => sum + countOf(k.id), 0)
    counts.set(id, n)
    return n
  }

  const out: DocTreeRow[] = []
  const walked = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    const kids = [...(kidsOf.get(parentId) ?? [])]
      .filter((f) => !walked.has(f.id) && (!filtering || countOf(f.id) > 0))
      .sort((a, b) => koCompare(a.name, b.name))
    for (const f of kids) {
      walked.add(f.id)
      const open = filtering || opened.has(f.id)
      out.push({ type: 'folder', folder: f, depth, count: countOf(f.id), open })
      if (open) walk(f.id, depth + 1)
    }
    const mine = [...(docsIn.get(parentId) ?? [])].sort((a, b) => koCompare(a.title, b.title))
    for (const d of mine) out.push({ type: 'doc', doc: d, depth })
  }
  walk(null, 0)
  return out
}

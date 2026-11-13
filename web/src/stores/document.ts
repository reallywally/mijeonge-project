import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '@/api'
import { ApiError, messageOf } from '@/api'
import {
  canCreateInPart,
  canDeleteDoc,
  canDeleteDocFolder,
  canEditDoc,
  canMoveToPart,
} from '@/lib/access'
import {
  FOLDER_MOVE_MESSAGE,
  FOLDER_NAME_TAKEN,
  folderMoveProblem,
  folderNameProblem,
  folderNameTaken,
} from '@/lib/docFolder'
import {
  changedAgendaIds,
  docContentProblem,
  DOC_SAVE_DELAY_MS,
  docTitleProblem,
  sheetBookProblem,
} from '@/lib/document'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import type {
  DocAgendaLink,
  DocFolder,
  DocInput,
  DocPatch,
  ProjectDoc,
  ProjectDocSummary,
  SheetBook,
} from '@/types/domain'

/** 문서 화면 머리의 저장 표시 — 고친 뒤 기다림(pending) · 보내는 중 · 저장됨 · 겹침(stale, 저장을 멈춘다) · 실패 */
export type DocSaveState = 'saved' | 'pending' | 'saving' | 'stale' | 'error'

/** 409 DOCUMENT_STALE 의 detail — 누가 언제 먼저 고쳤나 */
export interface DocStale {
  rev: number
  updatedBy: string | null
  updatedAt: string
}

/** 고치는 중인 제목 · 본문 · 표 — 서버에 보낸 값(byId)과 견주어 다른 것만 보낸다 */
export interface DocDraft {
  docId: string
  title: string
  content: string
  sheet: SheetBook
}

const summaryOf = (d: ProjectDoc): ProjectDocSummary => ({
  id: d.id,
  projectId: d.projectId,
  title: d.title,
  kind: d.kind,
  partId: d.partId,
  folderId: d.folderId,
  agendas: d.agendas,
  changedAgendaIds: d.changedAgendaIds,
  rev: d.rev,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
  updatedBy: d.updatedBy,
  updatedAt: d.updatedAt,
})

/** 409 의 detail — { rev: number, updatedBy: string | null, updatedAt: string }. 모양이 어긋나도 줄은 띄운다 */
function staleOf(detail: Record<string, unknown> | undefined, rev: number): DocStale {
  const d = detail ?? {}
  return {
    rev: typeof d.rev === 'number' ? d.rev : Number(d.rev) || rev,
    updatedBy: typeof d.updatedBy === 'string' && d.updatedBy ? d.updatedBy : null,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '',
  }
}

/* 반응형 프록시는 structuredClone 이 못 한다 — 표는 JSON 값뿐이라 JSON 으로 떠서 복사한다 */
const cloneSheet = (s: SheetBook): SheetBook => JSON.parse(JSON.stringify(s)) as SheetBook

const byUpdated = (a: ProjectDocSummary, b: ProjectDocSummary) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0

/**
 * 문서 (docs/api/document.md). 목록은 고른 프로젝트의 것 전부를 받아 화면이 거른다. 본문 · 표는 문서를 열 때 받는다(byId).
 * 고치기는 자동 저장이다 — 고치고 0.8초 쉬면 바뀐 칸만 rev 를 실어 PATCH, 응답의 rev 를 다음에 쓴다.
 * 409 면 저장을 멈추고 고친 글은 화면에 남긴다. 연결 · 확인 · 파트는 rev 와 무관하다.
 * '결정 바뀜' 은 들고 있는 안건의 지금 판으로 다시 센다 — 안건 결정을 고치면 다시 받지 않아도 바로 보인다.
 * 폴더는 목록과 같이 받아 평평하게 든다 — 트리는 화면이 세운다(lib/docFolder). 문서를 폴더에 넣기는 파트처럼 rev 와 무관하다
 */
export const useDocumentStore = defineStore('document', () => {
  const data = useDataStore()
  const auth = useAuthStore()
  const partStore = usePartStore()

  const rows = ref<ProjectDocSummary[]>([])
  /** rows 가 어느 프로젝트 것인가 — 프로젝트를 바꾼 사이 옛 목록을 그리지 않는다 */
  const rowsProjectId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 서버가 돌려준 문서 — 본문 · 표까지. 자동 저장은 이것의 rev 를 싣는다 */
  const byId = ref<Record<string, ProjectDoc>>({})
  /** 고른 프로젝트의 폴더 — rows 와 같이 받는다 */
  const folderRows = ref<DocFolder[]>([])
  let ticket = 0

  const list = computed(() =>
    rowsProjectId.value !== null && rowsProjectId.value === data.currentProjectId ? rows.value : [],
  )
  const loaded = computed(() => rowsProjectId.value === data.currentProjectId)
  const folders = computed(() => (loaded.value ? folderRows.value : []))
  /** 볼 파트로 거른 목록 — 문서 쪽 고르기. 문서를 주소로 열 때는 거르지 않는다 */
  const visibleList = computed(() =>
    list.value.filter((d) => partStore.showsPartIn(d.partId, 'document')),
  )

  /* ── 연결 안건 · 결정 바뀜 ── */

  /** 들고 있는 안건의 지금 판 — 없으면(지웠거나 다른 프로젝트) null */
  const revOf = (agendaId: string) =>
    data.allAgendas.find((a) => a.id === agendaId)?.decisionRev ?? null

  /** 연결 안건 — 연결 순서. 들고 있는 안건으로 지운 것을 거른다(받기 전이면 서버 값 그대로) */
  function linksOf(doc: ProjectDocSummary): DocAgendaLink[] {
    if (!data.holdsRecordsOf(doc.projectId)) return doc.agendas
    return doc.agendas.filter((l) => revOf(l.agendaId) !== null)
  }

  /** 결정 바뀜 — 지금 판 > 적어 둔 판. 서버의 changedAgendaIds 와 같은 셈 */
  function changedOf(doc: ProjectDocSummary): string[] {
    if (!data.holdsRecordsOf(doc.projectId)) return doc.changedAgendaIds
    return changedAgendaIds(doc.agendas, revOf)
  }

  /** 그 안건이 실린 문서 — 받아 둔 목록에서 */
  const docsOfAgenda = (agendaId: string) =>
    list.value.filter((d) => d.agendas.some((l) => l.agendaId === agendaId))

  /* ── 권한 — 버튼 숨김과 목업 403 이 같은 함수 ── */

  const canCreateIn = (partId: string | null) =>
    canCreateInPart(auth.me, partId, data.currentProjectId, data.partMembers)
  const canEdit = (doc: ProjectDocSummary) =>
    canEditDoc(auth.me, doc, doc.projectId, data.partMembers)
  const canDelete = (doc: ProjectDocSummary) =>
    canDeleteDoc(auth.me, doc, doc.projectId, data.partMembers)
  const canMoveTo = (doc: ProjectDocSummary, partId: string | null) =>
    partId === doc.partId || canMoveToPart(auth.me, partId, doc.projectId, data.partMembers)
  const canDeleteFolder = (folder: DocFolder) =>
    canDeleteDocFolder(auth.me, folder, folder.projectId)
  /** 빈 폴더인가 — 받아 둔 목록 전부로 본다(볼 파트로 걸러진 문서도 든 것이다) */
  const folderEmpty = (folderId: string) =>
    !folderRows.value.some((f) => f.parentId === folderId) &&
    !rows.value.some((d) => d.folderId === folderId)

  /* ── 받기 ── */

  /** 고른 프로젝트의 목록을 받는다. 늦게 온 옛 응답은 버린다 */
  async function load() {
    const projectId = data.currentProjectId
    const mine = ++ticket
    if (!projectId || !auth.me) {
      rows.value = []
      rowsProjectId.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      const [got, gotFolders] = await Promise.all([
        api.fetchDocuments(projectId),
        api.fetchDocFolders(projectId),
      ])
      if (mine !== ticket) return
      rows.value = got
      folderRows.value = gotFolders
      rowsProjectId.value = projectId
    } catch (e) {
      if (mine !== ticket) return
      error.value = messageOf(e)
    } finally {
      if (mine === ticket) loading.value = false
    }
  }

  /** 안건 상세의 '실린 문서' 가 쓴다 — 아직 안 받았으면 한 번 받는다 */
  function ensureLoaded() {
    if (!loaded.value && !loading.value) void load()
  }

  function upsertSummary(doc: ProjectDoc) {
    if (rowsProjectId.value !== doc.projectId) return
    const item = summaryOf(doc)
    const at = rows.value.findIndex((r) => r.id === doc.id)
    if (at >= 0) rows.value[at] = item
    else rows.value.push(item)
    rows.value.sort(byUpdated)
  }

  /**
   * 서버가 돌려준 문서를 넣는다. 늦게 온 응답이 더 옛 판이면(연결 PUT 과 저장 PATCH 가 엇갈림) 제목 · 본문 · 표 · rev 는
   * 지금 것을 지킨다 — 옛 rev 로 돌아가면 다음 저장이 소리 없이 409 가 된다
   */
  function put(doc: ProjectDoc) {
    const held = byId.value[doc.id]
    const next =
      held && held.rev > doc.rev
        ? { ...doc, title: held.title, content: held.content, sheet: held.sheet, rev: held.rev }
        : doc
    byId.value[doc.id] = next
    upsertSummary(next)
    return next
  }

  /** 하나 받는다. 못 받으면 ApiError 를 그대로 던진다 — 화면이 404 와 그 밖을 가른다 */
  async function fetchOne(documentId: string): Promise<ProjectDoc> {
    const doc = await api.fetchDocument(documentId)
    byId.value[doc.id] = doc
    upsertSummary(doc)
    return doc
  }

  /* ── 만들기 · 지우기 · 파트 ── */

  /** 만든다 — 새 문서 id, 실패하면 알리고 null */
  async function create(input: DocInput): Promise<string | null> {
    try {
      const doc = await api.createDocument(data.currentProjectId, {
        ...input,
        title: input.title.trim(),
      })
      byId.value[doc.id] = doc
      upsertSummary(doc)
      return doc.id
    } catch (e) {
      toastError(e)
      return null
    }
  }

  async function remove(documentId: string): Promise<boolean> {
    try {
      await api.deleteDocument(documentId)
    } catch (e) {
      toastError(e)
      return false
    }
    rows.value = rows.value.filter((d) => d.id !== documentId)
    delete byId.value[documentId]
    if (draft.value?.docId === documentId) closeDraft(false)
    return true
  }

  /** 파트 바꾸기 — rev 없이 보낸다 */
  async function setPart(documentId: string, partId: string | null): Promise<boolean> {
    return run(async () => put(await api.patchDocument(documentId, { partId })))
  }

  /** 폴더 옮기기 — rev 없이 보낸다(null 은 맨 위) */
  async function setFolder(documentId: string, folderId: string | null): Promise<boolean> {
    const held = byId.value[documentId] ?? rows.value.find((d) => d.id === documentId)
    if (held && held.folderId === folderId) return true
    return run(async () => put(await api.patchDocument(documentId, { folderId })))
  }

  /* ── 폴더 ── */

  function putFolder(folder: DocFolder) {
    if (rowsProjectId.value !== folder.projectId) return
    const at = folderRows.value.findIndex((f) => f.id === folder.id)
    if (at >= 0) folderRows.value[at] = folder
    else folderRows.value.push(folder)
  }

  /** 그 자리에서 알릴 말 — 이름 겹침 · 깊이 · 검증은 글로, 나머지도 글로 돌려준다 */
  const problemOf = (e: unknown) =>
    e instanceof ApiError && e.code === 'DOCUMENT_FOLDER_NAME_TAKEN'
      ? FOLDER_NAME_TAKEN
      : e instanceof ApiError && e.code === 'DOCUMENT_FOLDER_TOO_DEEP'
        ? FOLDER_MOVE_MESSAGE.deep
        : messageOf(e)

  /** 만든다 — 만든 폴더, 못 만들면 그 자리에 띄울 말 */
  async function createFolder(name: string, parentId: string | null): Promise<DocFolder | string> {
    const problem = folderNameProblem(name)
    if (problem) return problem
    if (folderNameTaken(folderRows.value, parentId, name)) return FOLDER_NAME_TAKEN
    try {
      const folder = await api.createDocFolder(data.currentProjectId, {
        name: name.trim(),
        parentId,
      })
      putFolder(folder)
      return folder
    } catch (e) {
      return problemOf(e)
    }
  }

  /** 이름 바꾸기 — 바꾼 폴더, 못 바꾸면 그 자리에 띄울 말 */
  async function renameFolder(folderId: string, name: string): Promise<DocFolder | string> {
    const held = folderRows.value.find((f) => f.id === folderId)
    const problem = folderNameProblem(name)
    if (problem) return problem
    if (!held) return '폴더를 찾을 수 없습니다.'
    if (held.name === name.trim()) return held
    if (folderNameTaken(folderRows.value, held.parentId, name, folderId)) return FOLDER_NAME_TAKEN
    try {
      const folder = await api.patchDocFolder(folderId, { name: name.trim() })
      putFolder(folder)
      return folder
    } catch (e) {
      return problemOf(e)
    }
  }

  /** 옮길 수 있나 — 고리 · 깊이 · 같은 이름. 걸리면 그 말 */
  function folderMoveBlock(folderId: string, parentId: string | null): string | null {
    const held = folderRows.value.find((f) => f.id === folderId)
    if (!held) return '폴더를 찾을 수 없습니다.'
    if (held.parentId === parentId) return null
    const problem = folderMoveProblem(folderRows.value, folderId, parentId)
    if (problem) return FOLDER_MOVE_MESSAGE[problem]
    if (folderNameTaken(folderRows.value, parentId, held.name, folderId)) return FOLDER_NAME_TAKEN
    return null
  }

  /** 폴더 옮기기 — 걸리는 것은 화면이 folderMoveBlock 으로 먼저 막는다. 여기선 보내지 않고 false */
  async function moveFolder(folderId: string, parentId: string | null): Promise<boolean> {
    const held = folderRows.value.find((f) => f.id === folderId)
    if (held?.parentId === parentId) return true
    if (folderMoveBlock(folderId, parentId)) return false
    return run(async () => putFolder(await api.patchDocFolder(folderId, { parentId })))
  }

  /** 빈 폴더만 지운다 */
  async function removeFolder(folderId: string): Promise<boolean> {
    const ok = await run(() => api.deleteDocFolder(folderId))
    if (ok) folderRows.value = folderRows.value.filter((f) => f.id !== folderId)
    return ok
  }

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  /* ── 연결 · 확인 — rev 와 무관 ── */

  const linkedIds = (documentId: string) =>
    (byId.value[documentId] ?? rows.value.find((d) => d.id === documentId))?.agendas.map(
      (l) => l.agendaId,
    ) ?? []

  /** 연결을 통째로 — 남는 안건은 적어 둔 판 그대로 */
  const setAgendas = (documentId: string, agendaIds: string[]) =>
    run(async () => put(await api.putDocumentAgendas(documentId, { agendaIds })))

  /** 끝에 하나 더한다 — 이미 있으면 그대로 */
  function linkAgenda(documentId: string, agendaId: string) {
    const ids = linkedIds(documentId)
    if (ids.includes(agendaId)) return Promise.resolve(true)
    return setAgendas(documentId, [...ids, agendaId])
  }

  const unlinkAgenda = (documentId: string, agendaId: string) =>
    setAgendas(
      documentId,
      linkedIds(documentId).filter((id) => id !== agendaId),
    )

  /** 결정 바뀜 지우기 — agendaIds 가 없으면 연결 안건 전부 */
  const confirm = (documentId: string, agendaIds?: string[]) =>
    run(async () => put(await api.confirmDocument(documentId, agendaIds ? { agendaIds } : {})))

  /* ── 자동 저장 ── */

  const draft = ref<DocDraft | null>(null)
  const saveState = ref<DocSaveState>('saved')
  const stale = ref<DocStale | null>(null)
  const saveError = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null

  function clearTimer() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  /** 문서를 받아 고칠 칸을 그 값으로 채운다. 못 받으면 ApiError 를 던진다 */
  async function openDraft(documentId: string): Promise<ProjectDoc> {
    const doc = await fetchOne(documentId)
    resetDraft(doc)
    return doc
  }

  function resetDraft(doc: ProjectDoc) {
    clearTimer()
    draft.value = {
      docId: doc.id,
      title: doc.title,
      content: doc.content,
      sheet: cloneSheet(doc.sheet),
    }
    saveState.value = 'saved'
    stale.value = null
    saveError.value = null
  }

  /** 보낼 것 — 서버 값과 다른 칸만. 제목은 앞뒤 공백을 뗀 값으로 견주고, 비었거나 너무 길면 싣지 않는다 */
  function changesOf(d: DocDraft, base: ProjectDoc): DocPatch | null {
    const patch: DocPatch = {}
    const title = d.title.trim()
    if (title !== base.title && docTitleProblem(title) === null) patch.title = title
    if (base.kind === 'text' && d.content !== base.content && docContentProblem(d.content) === null)
      patch.content = d.content
    if (
      base.kind === 'sheet' &&
      JSON.stringify(d.sheet) !== JSON.stringify(base.sheet) &&
      sheetBookProblem(d.sheet) === null
    )
      patch.sheet = cloneSheet(d.sheet)
    return Object.keys(patch).length > 0 ? patch : null
  }

  /** 고친다 — 화면에 바로, 저장은 0.8초 쉰 뒤. 겹침으로 멈췄으면 화면에만 남는다 */
  function edit(change: Partial<Omit<DocDraft, 'docId'>>) {
    const d = draft.value
    if (!d) return
    Object.assign(d, change)
    if (saveState.value === 'stale') return
    saveState.value = 'pending'
    clearTimer()
    timer = setTimeout(() => void save(), DOC_SAVE_DELAY_MS)
  }

  /** 지금 보낸다. 보내는 중이면 그것이 끝난 뒤 남은 것을 다시 본다 */
  async function save(): Promise<void> {
    clearTimer()
    if (inFlight) return inFlight
    const d = draft.value
    if (!d || saveState.value === 'stale') return
    const base = byId.value[d.docId]
    const patch = base ? changesOf(d, base) : null
    if (!base || !patch) {
      if (saveState.value !== 'error') saveState.value = 'saved'
      return
    }
    saveState.value = 'saving'
    inFlight = (async () => {
      /* 보내는 사이 화면을 떠났으면(draft 가 바뀜) 표시는 건드리지 않는다 */
      const here = () => draft.value === d
      try {
        put(await api.patchDocument(d.docId, { rev: base.rev, ...patch }))
        if (here()) saveError.value = null
      } catch (e) {
        if (!here()) {
          if (!(e instanceof ApiError && e.status === 409)) toastError(e)
        } else if (e instanceof ApiError && e.status === 409 && e.code === 'DOCUMENT_STALE') {
          stale.value = staleOf(e.detail, base.rev)
          saveState.value = 'stale'
        } else {
          saveError.value = messageOf(e)
          saveState.value = 'error'
        }
        return
      } finally {
        inFlight = null
      }
      if (!here()) return
      /* 보내는 사이 더 고쳤으면 이어서 기다린다 */
      const held = byId.value[d.docId]
      if (held && changesOf(d, held)) {
        saveState.value = 'pending'
        timer = setTimeout(() => void save(), DOC_SAVE_DELAY_MS)
      } else saveState.value = 'saved'
    })()
    return inFlight
  }

  /** 겹침 뒤 [다시 불러오기] — 서버 것으로 갈아끼운다. 내 글은 사라진다 */
  async function reloadDraft(): Promise<boolean> {
    const d = draft.value
    if (!d) return false
    try {
      const doc = await api.fetchDocument(d.docId)
      byId.value[doc.id] = doc
      upsertSummary(doc)
      if (draft.value?.docId === doc.id) resetDraft(doc)
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }

  /** 문서 화면을 떠날 때 — 기다리는 저장은 바로 보낸다(flush) */
  function closeDraft(flush = true) {
    const d = draft.value
    const waiting = saveState.value === 'pending' || saveState.value === 'saving'
    if (flush && d && waiting) void flushLeft(d)
    clearTimer()
    draft.value = null
    saveState.value = 'saved'
    stale.value = null
    saveError.value = null
  }

  /** 떠난 문서의 남은 것 — 보내는 중이던 것이 끝난 뒤 한 번 더. 실패는 알리기만 한다 */
  async function flushLeft(d: DocDraft) {
    if (inFlight) await inFlight
    const base = byId.value[d.docId]
    const patch = base ? changesOf(d, base) : null
    if (!base || !patch) return
    try {
      put(await api.patchDocument(d.docId, { rev: base.rev, ...patch }))
    } catch (e) {
      toastError(e)
    }
  }

  function clear() {
    ticket += 1
    clearTimer()
    rows.value = []
    folderRows.value = []
    rowsProjectId.value = null
    loading.value = false
    error.value = null
    byId.value = {}
    draft.value = null
    saveState.value = 'saved'
    stale.value = null
    saveError.value = null
  }

  return {
    list,
    visibleList,
    folders,
    loaded,
    loading,
    error,
    byId,
    linksOf,
    changedOf,
    docsOfAgenda,
    canCreateIn,
    canEdit,
    canDelete,
    canMoveTo,
    canDeleteFolder,
    folderEmpty,
    folderMoveBlock,
    load,
    ensureLoaded,
    fetchOne,
    create,
    remove,
    setPart,
    setFolder,
    createFolder,
    renameFolder,
    moveFolder,
    removeFolder,
    setAgendas,
    linkAgenda,
    unlinkAgenda,
    confirm,
    draft,
    saveState,
    stale,
    saveError,
    openDraft,
    edit,
    save,
    reloadDraft,
    closeDraft,
    clear,
  }
})

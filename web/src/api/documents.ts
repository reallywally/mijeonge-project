import { id, mockError, request } from '@/api/client'
import { forbidden, later, mockDb, mockWorld, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import type { MockDoc } from '@/fixtures'
import {
  canCreateInPart,
  canDeleteDoc,
  canDeleteDocFolder,
  canEditDoc,
  canMoveToPart,
  canSeeProject,
} from '@/lib/access'
import { nowIso } from '@/lib/date'
import {
  FOLDER_MOVE_MESSAGE,
  FOLDER_NAME_TAKEN,
  folderDepth,
  folderMoveProblem,
  folderNameProblem,
  folderNameTaken,
  DOC_FOLDER_DEPTH_MAX,
} from '@/lib/docFolder'
import {
  agendaIdsProblem,
  changedAgendaIds,
  docContentProblem,
  defaultSheetBook,
  docTitleProblem,
  emptySheetBook,
  sheetBookProblem,
} from '@/lib/document'
import type {
  DocAgendasInput,
  DocConfirmInput,
  DocFolder,
  DocFolderInput,
  DocFolderPatch,
  DocInput,
  DocPatch,
  Me,
  ProjectDoc,
  ProjectDocSummary,
} from '@/types/domain'

/* 문서 (docs/api/document.md). 목록 · 하나 읽기 · 고치기(rev 로 겹침을 막는다) · 지우기(진짜 지운다) · 연결 · 확인.
   목업 갈래도 서버와 같은 검사 · 같은 오류 코드로 답한다. 연결 안건의 지금 판은 목업 세계(데이터 스토어의 안건)에서 읽는다 */

const notFound = () => mockError(404, 'DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.')
const invalid = (detail: Record<string, string>) =>
  mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', detail)

/** 그 프로젝트의 안 지운 안건의 지금 판 — 없거나 지웠으면 null */
function revReader(projectId: string) {
  const agendas = mockWorld().agendas
  return (agendaId: string) =>
    agendas.find((a) => a.id === agendaId && a.projectId === projectId)?.decisionRev ?? null
}

/* 서버 응답처럼 늘 새 객체를 낸다 — 스토어가 받은 것을 고쳐도 목업 저장소가 따라 바뀌지 않게 */
function toSummary(row: MockDoc): ProjectDocSummary {
  const revOf = revReader(row.projectId)
  /* 지운 안건의 연결 줄은 남기되 읽을 때 거른다 */
  const agendas = row.links.filter((l) => revOf(l.agendaId) !== null).map((l) => ({ ...l }))
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    kind: row.kind,
    partId: row.partId,
    folderId: row.folderId,
    agendas,
    changedAgendaIds: changedAgendaIds(agendas, revOf),
    rev: row.rev,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  }
}

const toDoc = (row: MockDoc): ProjectDoc => ({
  ...toSummary(row),
  content: row.content,
  sheet: structuredClone(row.sheet),
})

/** 부여받지 않은 프로젝트의 문서는 없는 것처럼 404 */
function requireDoc(me: Me, documentId: string): MockDoc {
  const row = mockDb().documents.find((d) => d.id === documentId)
  if (
    !row ||
    !canSeeProject(me, row.projectId) ||
    mockDb().deletedProjectIds.includes(row.projectId)
  )
    throw notFound()
  return row
}

/** 다른 프로젝트 · 없는 · 지운 안건 — 하나라도 있으면 400 */
function rejectAgendas(projectId: string, agendaIds: string[]) {
  const revOf = revReader(projectId)
  const detail: Record<string, string> = {}
  agendaIds.forEach((agendaId, i) => {
    if (revOf(agendaId) === null) detail[`agendaIds.${i}`] = '안건을 찾을 수 없습니다.'
  })
  if (Object.keys(detail).length > 0)
    throw mockError(400, 'DOCUMENT_AGENDA_NOT_FOUND', '안건을 찾을 수 없습니다.', detail)
}

/** 다른 프로젝트 · 없는 파트는 PART_NOT_FOUND, 보관 파트를 새로 달면 PART_ARCHIVED — 작업 · 테스트와 같은 코드 · detail.
    이미 달린 파트(kept)를 그대로 두는 것은 막지 않는다 */
function rejectPart(
  projectId: string,
  partId: string | null | undefined,
  kept: string | null = null,
) {
  if (partId == null || partId === kept) return
  const part = mockDb().parts.find((p) => p.id === partId && p.projectId === projectId)
  if (!part)
    throw mockError(400, 'PART_NOT_FOUND', '파트를 찾을 수 없습니다.', {
      partId: '파트를 찾을 수 없습니다.',
    })
  if (!part.active)
    throw mockError(400, 'PART_ARCHIVED', '보관한 파트는 고를 수 없습니다.', {
      partId: '보관한 파트입니다.',
    })
}

const folderNotFound = (key: 'folderId' | 'parentId') =>
  mockError(400, 'DOCUMENT_FOLDER_NOT_FOUND', '폴더를 찾을 수 없습니다.', {
    [key]: '폴더를 찾을 수 없습니다.',
  })

/** 몸의 folderId · parentId — 다른 프로젝트 · 없는 폴더면 400 */
function rejectFolder(
  projectId: string,
  folderId: string | null | undefined,
  key: 'folderId' | 'parentId',
) {
  if (folderId == null) return
  if (!mockDb().docFolders.some((f) => f.id === folderId && f.projectId === projectId))
    throw folderNotFound(key)
}

/** 본문 · 표 · 제목의 모양 — kind 와 안 맞는 칸, 크기 */
function shapeProblems(
  kind: ProjectDoc['kind'],
  input: { title?: string; content?: string; sheet?: DocInput['sheet'] },
) {
  const problems: Record<string, string> = {}
  if (input.title !== undefined) {
    const p = docTitleProblem(input.title)
    if (p) problems.title = p
  }
  if (input.content !== undefined) {
    if (kind !== 'text') problems.content = '표 문서에는 본문을 보낼 수 없습니다.'
    else {
      const p = docContentProblem(input.content)
      if (p) problems.content = p
    }
  }
  if (input.sheet !== undefined) {
    if (kind !== 'sheet') problems.sheet = '글 문서에는 표를 보낼 수 없습니다.'
    else if (
      input.sheet === null ||
      typeof input.sheet !== 'object' ||
      !Array.isArray(input.sheet.sheets)
    )
      problems.sheet = '표 모양이 올바르지 않습니다.'
    else {
      const p = sheetBookProblem(input.sheet)
      if (p) problems.sheet = p
    }
  }
  return problems
}

const mock = {
  list(projectId: string, agendaId?: string): ProjectDocSummary[] {
    requireProject(requireMe(), projectId)
    return mockDb()
      .documents.map((row, seq) => ({ row, seq }))
      .filter(({ row }) => row.projectId === projectId)
      .map(({ row, seq }) => ({ summary: toSummary(row), seq }))
      .filter(({ summary }) => !agendaId || summary.agendas.some((l) => l.agendaId === agendaId))
      .sort(
        (a, b) =>
          (a.summary.updatedAt < b.summary.updatedAt
            ? 1
            : a.summary.updatedAt > b.summary.updatedAt
              ? -1
              : 0) || b.seq - a.seq,
      )
      .map(({ summary }) => summary)
  },

  create(projectId: string, input: DocInput): ProjectDoc {
    const me = requireMe()
    requireProject(me, projectId)
    const agendaIds = input.agendaIds ?? []
    const problems: Record<string, string> = {}
    if (input.kind !== 'text' && input.kind !== 'sheet') problems.kind = '종류는 글 · 표입니다.'
    else Object.assign(problems, shapeProblems(input.kind, { ...input, title: input.title ?? '' }))
    const linkProblem = agendaIdsProblem(agendaIds)
    if (linkProblem) problems.agendaIds = linkProblem
    if (Object.keys(problems).length > 0) throw invalid(problems)
    rejectAgendas(projectId, agendaIds)
    const partId = input.partId ?? null
    rejectPart(projectId, partId)
    const folderId = input.folderId ?? null
    rejectFolder(projectId, folderId, 'folderId')
    const db = mockDb()
    if (!canCreateInPart(me, partId, projectId, db.partMembers)) throw forbidden()

    db.documentSeq += 1
    const at = nowIso()
    const revOf = revReader(projectId)
    const row: MockDoc = {
      id: `doc${db.documentSeq}`,
      projectId,
      title: input.title.trim(),
      kind: input.kind,
      content: input.kind === 'text' ? (input.content ?? '') : '',
      sheet:
        input.kind === 'sheet'
          ? structuredClone(input.sheet ?? defaultSheetBook())
          : emptySheetBook(),
      partId,
      folderId,
      links: agendaIds.map((agendaId) => ({ agendaId, seenRev: revOf(agendaId) ?? 0 })),
      rev: 1,
      createdBy: me.id,
      createdAt: at,
      updatedBy: me.id,
      updatedAt: at,
    }
    db.documents.push(row)
    return toDoc(row)
  },

  get: (documentId: string) => toDoc(requireDoc(requireMe(), documentId)),

  patch(documentId: string, patch: DocPatch): ProjectDoc {
    const me = requireMe()
    const row = requireDoc(me, documentId)
    const bodySent = (['title', 'content', 'sheet'] as const).some((k) => patch[k] !== undefined)
    const problems = shapeProblems(row.kind, patch)
    if (bodySent && patch.rev === undefined) problems.rev = '판 번호(rev)를 보내 주세요.'
    if (Object.keys(problems).length > 0) throw invalid(problems)
    rejectPart(row.projectId, patch.partId, row.partId)
    rejectFolder(row.projectId, patch.folderId, 'folderId')
    const db = mockDb()
    if (!canEditDoc(me, row, row.projectId, db.partMembers)) throw forbidden()
    if (
      patch.partId !== undefined &&
      patch.partId !== row.partId &&
      !canMoveToPart(me, patch.partId, row.projectId, db.partMembers)
    )
      throw forbidden()
    if (bodySent && patch.rev !== row.rev)
      throw mockError(409, 'DOCUMENT_STALE', '다른 사람이 먼저 고쳤습니다.', {
        rev: row.rev,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
      })

    let bodyChanged = false
    if (patch.title !== undefined && patch.title.trim() !== row.title) {
      row.title = patch.title.trim()
      bodyChanged = true
    }
    if (patch.content !== undefined && patch.content !== row.content) {
      row.content = patch.content
      bodyChanged = true
    }
    if (patch.sheet !== undefined && JSON.stringify(patch.sheet) !== JSON.stringify(row.sheet)) {
      row.sheet = structuredClone(patch.sheet)
      bodyChanged = true
    }
    const partChanged = patch.partId !== undefined && patch.partId !== row.partId
    if (partChanged) row.partId = patch.partId ?? null
    /* 폴더도 파트처럼 rev 를 안 올린다 */
    const folderChanged = patch.folderId !== undefined && patch.folderId !== row.folderId
    if (folderChanged) row.folderId = patch.folderId ?? null
    if (bodyChanged) row.rev += 1
    if (bodyChanged || partChanged || folderChanged) {
      row.updatedBy = me.id
      row.updatedAt = nowIso()
    }
    return toDoc(row)
  },

  remove(documentId: string) {
    const me = requireMe()
    const row = requireDoc(me, documentId)
    const db = mockDb()
    if (!canDeleteDoc(me, row, row.projectId, db.partMembers)) throw forbidden()
    db.documents = db.documents.filter((d) => d.id !== documentId)
  },

  putAgendas(documentId: string, input: DocAgendasInput): ProjectDoc {
    const me = requireMe()
    const row = requireDoc(me, documentId)
    const problem = agendaIdsProblem(input.agendaIds)
    if (problem) throw invalid({ agendaIds: problem })
    rejectAgendas(row.projectId, input.agendaIds)
    if (!canEditDoc(me, row, row.projectId, mockDb().partMembers)) throw forbidden()
    /* 남는 안건은 적어 둔 판 그대로, 새로 들어온 안건은 지금 판 */
    const revOf = revReader(row.projectId)
    const links = input.agendaIds.map(
      (agendaId) =>
        row.links.find((l) => l.agendaId === agendaId) ?? {
          agendaId,
          seenRev: revOf(agendaId) ?? 0,
        },
    )
    if (JSON.stringify(links) !== JSON.stringify(row.links)) {
      row.links = links
      row.updatedBy = me.id
      row.updatedAt = nowIso()
    }
    return toDoc(row)
  },

  confirm(documentId: string, input: DocConfirmInput): ProjectDoc {
    const me = requireMe()
    const row = requireDoc(me, documentId)
    if (!canEditDoc(me, row, row.projectId, mockDb().partMembers)) throw forbidden()
    const revOf = revReader(row.projectId)
    const live = row.links.filter((l) => revOf(l.agendaId) !== null)
    const agendaIds = input.agendaIds ?? live.map((l) => l.agendaId)
    const detail: Record<string, string> = {}
    agendaIds.forEach((agendaId, i) => {
      if (!live.some((l) => l.agendaId === agendaId))
        detail[`agendaIds.${i}`] = '연결하지 않은 안건입니다.'
    })
    if (Object.keys(detail).length > 0)
      throw mockError(400, 'DOCUMENT_AGENDA_NOT_LINKED', '연결하지 않은 안건입니다.', detail)
    let changed = false
    for (const link of live) {
      const rev = revOf(link.agendaId)!
      if (agendaIds.includes(link.agendaId) && link.seenRev !== rev) {
        link.seenRev = rev
        changed = true
      }
    }
    if (changed) {
      row.updatedBy = me.id
      row.updatedAt = nowIso()
    }
    return toDoc(row)
  },
}

/* ── 폴더 — 만들기 · 이름 바꾸기 · 옮기기는 멤버 누구나, 지우기는 관리자 · 만든 사람(빈 폴더만) ── */

const folderOf = (row: DocFolder): DocFolder => ({ ...row })

/** 경로의 폴더 — 없거나 그 프로젝트 멤버가 아니면 404 */
function requireFolder(me: Me, folderId: string): DocFolder {
  const row = mockDb().docFolders.find((f) => f.id === folderId)
  if (
    !row ||
    !canSeeProject(me, row.projectId) ||
    mockDb().deletedProjectIds.includes(row.projectId)
  )
    throw mockError(404, 'DOCUMENT_FOLDER_NOT_FOUND', '폴더를 찾을 수 없습니다.')
  return row
}

const nameTaken = () =>
  mockError(409, 'DOCUMENT_FOLDER_NAME_TAKEN', FOLDER_NAME_TAKEN, { name: FOLDER_NAME_TAKEN })

const folderMock = {
  list(projectId: string): DocFolder[] {
    requireProject(requireMe(), projectId)
    return mockDb()
      .docFolders.map((row, seq) => ({ row, seq }))
      .filter(({ row }) => row.projectId === projectId)
      .sort((a, b) => a.row.name.localeCompare(b.row.name, 'ko') || a.seq - b.seq)
      .map(({ row }) => folderOf(row))
  },

  create(projectId: string, input: DocFolderInput): DocFolder {
    const me = requireMe()
    requireProject(me, projectId)
    const problem = folderNameProblem(input.name)
    if (problem) throw invalid({ name: problem })
    const parentId = input.parentId ?? null
    rejectFolder(projectId, parentId, 'parentId')
    const db = mockDb()
    const inProject = db.docFolders.filter((f) => f.projectId === projectId)
    if (folderDepth(inProject, parentId) + 1 > DOC_FOLDER_DEPTH_MAX)
      throw mockError(400, 'DOCUMENT_FOLDER_TOO_DEEP', FOLDER_MOVE_MESSAGE.deep, {
        parentId: FOLDER_MOVE_MESSAGE.deep,
      })
    const name = input.name.trim()
    if (folderNameTaken(inProject, parentId, name)) throw nameTaken()
    db.docFolderSeq += 1
    const at = nowIso()
    const row: DocFolder = {
      id: `df${db.docFolderSeq}`,
      projectId,
      parentId,
      name,
      createdBy: me.id,
      createdAt: at,
      updatedAt: at,
    }
    db.docFolders.push(row)
    return folderOf(row)
  },

  patch(folderId: string, patch: DocFolderPatch): DocFolder {
    const me = requireMe()
    const row = requireFolder(me, folderId)
    if (patch.name !== undefined) {
      const problem = folderNameProblem(patch.name)
      if (problem) throw invalid({ name: problem })
    }
    const db = mockDb()
    const inProject = db.docFolders.filter((f) => f.projectId === row.projectId)
    const parentId = patch.parentId === undefined ? row.parentId : patch.parentId
    if (patch.parentId !== undefined && parentId !== row.parentId) {
      rejectFolder(row.projectId, parentId, 'parentId')
      const moveProblem = folderMoveProblem(inProject, row.id, parentId)
      if (moveProblem)
        throw mockError(
          400,
          moveProblem === 'cycle' ? 'DOCUMENT_FOLDER_CYCLE' : 'DOCUMENT_FOLDER_TOO_DEEP',
          FOLDER_MOVE_MESSAGE[moveProblem],
          { parentId: FOLDER_MOVE_MESSAGE[moveProblem] },
        )
    }
    const name = patch.name === undefined ? row.name : patch.name.trim()
    if (name === row.name && parentId === row.parentId) return folderOf(row)
    if (folderNameTaken(inProject, parentId, name, row.id)) throw nameTaken()
    row.name = name
    row.parentId = parentId
    row.updatedAt = nowIso()
    return folderOf(row)
  },

  remove(folderId: string) {
    const me = requireMe()
    const row = requireFolder(me, folderId)
    const db = mockDb()
    if (!canDeleteDocFolder(me, row, row.projectId)) throw forbidden()
    if (
      db.docFolders.some((f) => f.parentId === folderId) ||
      db.documents.some((d) => d.folderId === folderId)
    )
      throw mockError(409, 'DOCUMENT_FOLDER_NOT_EMPTY', '안에 폴더나 문서가 있어 지울 수 없습니다.')
    db.docFolders = db.docFolders.filter((f) => f.id !== folderId)
  },
}

/** 목록 — 고친 때 늦은 순. agendaId 를 주면 그 안건이 연결된 문서만 */
export const fetchDocuments = (projectId: string, agendaId?: string) =>
  isMockMode()
    ? later(() => mock.list(projectId, agendaId))
    : request<ProjectDocSummary[]>(
        'GET',
        `/projects/${id(projectId)}/documents${agendaId ? `?agendaId=${id(agendaId)}` : ''}`,
      )

/** 만들기 — 연결 안건의 seenRev 는 지금 판 */
export const createDocument = (projectId: string, input: DocInput) =>
  isMockMode()
    ? later(() => mock.create(projectId, input))
    : request<ProjectDoc>('POST', `/projects/${id(projectId)}/documents`, input)

export const fetchDocument = (documentId: string) =>
  isMockMode()
    ? later(() => mock.get(documentId))
    : request<ProjectDoc>('GET', `/documents/${id(documentId)}`)

/** 고치기 — 제목 · 본문 · 표를 보내면 rev 도. 지금 판과 다르면 409 DOCUMENT_STALE */
export const patchDocument = (documentId: string, patch: DocPatch) =>
  isMockMode()
    ? later(() => mock.patch(documentId, patch))
    : request<ProjectDoc>('PATCH', `/documents/${id(documentId)}`, patch)

/** 지우기 — 진짜 지운다. 연결 줄도 같이 */
export const deleteDocument = (documentId: string) =>
  isMockMode()
    ? later(() => mock.remove(documentId))
    : request<void>('DELETE', `/documents/${id(documentId)}`)

/** 연결 통째로 — 남는 안건은 seenRev 그대로. rev 와 무관 */
export const putDocumentAgendas = (documentId: string, input: DocAgendasInput) =>
  isMockMode()
    ? later(() => mock.putAgendas(documentId, input))
    : request<ProjectDoc>('PUT', `/documents/${id(documentId)}/agendas`, input)

/** 결정 바뀜 지우기 — agendaIds 를 안 보내면 연결 안건 전부 */
export const confirmDocument = (documentId: string, input: DocConfirmInput = {}) =>
  isMockMode()
    ? later(() => mock.confirm(documentId, input))
    : request<ProjectDoc>('POST', `/documents/${id(documentId)}/confirm`, input)

/** 폴더 전부 — 평평한 배열, 이름순. 트리는 화면이 parentId 로 세운다 */
export const fetchDocFolders = (projectId: string) =>
  isMockMode()
    ? later(() => folderMock.list(projectId))
    : request<DocFolder[]>('GET', `/projects/${id(projectId)}/document-folders`)

/** 폴더 만들기 — 같은 부모 아래 같은 이름이면 409 DOCUMENT_FOLDER_NAME_TAKEN */
export const createDocFolder = (projectId: string, input: DocFolderInput) =>
  isMockMode()
    ? later(() => folderMock.create(projectId, input))
    : request<DocFolder>('POST', `/projects/${id(projectId)}/document-folders`, input)

/** 이름 바꾸기 · 옮기기 — 자기 하위로는 400 CYCLE, 5단을 넘으면 400 TOO_DEEP */
export const patchDocFolder = (folderId: string, patch: DocFolderPatch) =>
  isMockMode()
    ? later(() => folderMock.patch(folderId, patch))
    : request<DocFolder>('PATCH', `/document-folders/${id(folderId)}`, patch)

/** 빈 폴더만 지운다 — 안에 무엇이 있으면 409 DOCUMENT_FOLDER_NOT_EMPTY */
export const deleteDocFolder = (folderId: string) =>
  isMockMode()
    ? later(() => folderMock.remove(folderId))
    : request<void>('DELETE', `/document-folders/${id(folderId)}`)

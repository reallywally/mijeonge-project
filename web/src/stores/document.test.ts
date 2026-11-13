// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { ApiError } from '@/api'
import { mockDb, resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { DOC_SAVE_DELAY_MS, defaultSheetBook } from '@/lib/document'
import { toastError } from '@/lib/notify'
import { useAgendaStore } from '@/stores/agenda'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import { usePartStore } from '@/stores/part'
import type { SheetBook } from '@/types/domain'

/* 문서 스토어 — 목업 api 로 목록 · 만들기 · 자동 저장(rev) · 409 · 연결(seenRev 유지) · 확인 · 권한 · 파트 오류 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signIn(memberId = 'u1') {
  const auth = useAuthStore()
  if (memberId === 'u1') await auth.login('u1@inno-ax.com', MOCK_PASSWORD)
  else {
    writeMockSession(memberId)
    await auth.loadMe()
  }
}

const lastError = () => vi.mocked(toastError).mock.calls.at(-1)?.[0] as ApiError | undefined

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  await signIn()
  await useDataStore().retry()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('목록', () => {
  it('고친 때 늦은 순, 볼 파트를 고르면 공통 + 그 파트만', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(docs.list.map((d) => d.id)).toEqual(['doc2', 'doc1'])
    expect(docs.list.every((d) => docs.changedOf(d).length === 0)).toBe(true)
    expect(docs.docsOfAgenda('t1').map((d) => d.id)).toEqual(['doc2', 'doc1'])

    /* 안건처럼 전체로 시작한다. u1 의 내 파트는 AI(pt2) — 인프라(pt1) 문서는 빠진다 */
    expect(docs.visibleList.map((d) => d.id)).toEqual(['doc2', 'doc1'])
    usePartStore().setScope('mine', 'document')
    expect(docs.visibleList.map((d) => d.id)).toEqual(['doc2'])
    /* 다른 메뉴의 고르기와 따로다 */
    expect(usePartStore().pickedIdsOf('agenda')).toEqual([])
  })

  it('서버 갈래는 ?agendaId= 로 거른다', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
    const fetch = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.fetchDocuments('p1', 't1')
    expect(fetch).toHaveBeenCalledWith('/api/projects/p1/documents?agendaId=t1', expect.anything())
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

describe('만들기', () => {
  it('글 · 표 — 연결 안건의 seenRev 는 지금 판, 표는 기본 시트 하나(항목 · 내용)', async () => {
    const docs = useDocumentStore()
    await docs.load()
    const id = await docs.create({ title: '  서버  ', kind: 'text', agendaIds: ['t1', 't3'] })
    expect(id).not.toBeNull()
    const made = docs.byId[id!]
    expect(made).toMatchObject({ title: '서버', kind: 'text', rev: 1, createdBy: 'u1' })
    expect(made.agendas).toEqual([
      { agendaId: 't1', seenRev: 1 },
      { agendaId: 't3', seenRev: 0 },
    ])
    expect(docs.list[0].id).toBe(id)

    const sheetId = await docs.create({ title: '표', kind: 'sheet' })
    expect(docs.byId[sheetId!].sheet).toEqual(defaultSheetBook())
    expect(docs.byId[id!].sheet).toEqual({ sheets: [] })
  })

  it('kind 와 안 맞는 본문 · 겹친 안건은 422, 없는 안건은 400', async () => {
    await expect(
      api.createDocument('p1', { title: '표', kind: 'sheet', content: '글' }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      api.createDocument('p1', { title: '글', kind: 'text', agendaIds: ['t1', 't1'] }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      api.createDocument('p1', { title: '글', kind: 'text', agendaIds: ['t10'] }),
    ).rejects.toMatchObject({ status: 400, code: 'DOCUMENT_AGENDA_NOT_FOUND' })
  })

  it('표의 모양 — 빈 책 · 겹친 시트 이름 · 숫자 칸 · 열 이름 · 글 문서의 표는 422', async () => {
    const tab = defaultSheetBook().sheets[0]
    const bad: unknown[] = [
      { sheets: [] },
      { sheets: [tab, tab] },
      { sheets: [{ ...tab, data: [[1, 2]] }] },
      { sheets: [{ ...tab, merges: { a1: [2, 1] } }] },
      { sheets: [{ ...tab, columns: [{ title: '항목', width: 200 }, { width: 400 }] }] },
      null,
    ]
    for (const sheet of bad)
      await expect(
        api.createDocument('p1', { title: '표', kind: 'sheet', sheet: sheet as never }),
        JSON.stringify(sheet),
      ).rejects.toMatchObject({ status: 422 })
    await expect(
      api.createDocument('p1', { title: '글', kind: 'text', sheet: defaultSheetBook() }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('자동 저장', () => {
  it('고치고 0.8초 쉬면 바뀐 칸만 rev 를 실어 보내고, 응답의 rev 를 다음에 쓴다', async () => {
    const docs = useDocumentStore()
    await docs.load()
    await docs.openDraft('doc1')
    const patch = vi.spyOn(api, 'patchDocument')
    docs.edit({ content: '첫 고침' })
    expect(docs.saveState).toBe('pending')
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS - 1)
    expect(patch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(patch).toHaveBeenLastCalledWith('doc1', { rev: 3, content: '첫 고침' })
    expect(docs.saveState).toBe('saved')
    expect(docs.byId.doc1.rev).toBe(4)

    docs.edit({ content: '둘째 고침', title: '서버 구성 ' })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    /* 제목은 앞뒤 공백을 뗀 값으로 견준다 — 같으니 안 보낸다 */
    expect(patch).toHaveBeenLastCalledWith('doc1', { rev: 4, content: '둘째 고침' })
    expect(docs.byId.doc1.rev).toBe(5)
    expect(docs.list.find((d) => d.id === 'doc1')?.rev).toBe(5)
  })

  it('빈 제목은 보내지 않는다 — 본문은 보낸다', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc1')
    const patch = vi.spyOn(api, 'patchDocument')
    docs.edit({ title: '   ', content: '본문만' })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    expect(patch).toHaveBeenLastCalledWith('doc1', { rev: 3, content: '본문만' })
    expect(docs.byId.doc1.title).toBe('서버 구성')
  })

  it('표는 SheetBook 째 보낸다 — 계약을 넘는 표(시트 이름 겹침)는 안 보낸다', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc2')
    const patch = vi.spyOn(api, 'patchDocument')
    const [tab] = docs.byId.doc2.sheet.sheets
    const next = { sheets: [{ ...tab, data: [...tab.data, ['=SUM(B1:B2)', '', '']] }] }
    docs.edit({ sheet: next })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    expect(patch).toHaveBeenLastCalledWith('doc2', { rev: 2, sheet: next })
    expect(docs.byId.doc2.sheet.sheets[0].data[3]).toEqual(['=SUM(B1:B2)', '', ''])
    expect(docs.byId.doc2.rev).toBe(3)

    patch.mockClear()
    docs.edit({ sheet: { sheets: [tab, tab] } })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    expect(patch).not.toHaveBeenCalled()
  })

  it('다른 사람이 먼저 고쳤으면 409 — 저장을 멈추고 내 글은 남긴다. [다시 불러오기] 로 서버 것', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc1')
    await api.patchDocument('doc1', { rev: 3, content: '남이 쓴 글' })

    docs.edit({ content: '내 글' })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    expect(docs.saveState).toBe('stale')
    expect(docs.stale).toMatchObject({ rev: 4, updatedBy: 'u1' })
    expect(docs.draft?.content).toBe('내 글')

    const patch = vi.spyOn(api, 'patchDocument')
    docs.edit({ content: '내 글 더' })
    await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
    expect(patch).not.toHaveBeenCalled()
    expect(docs.draft?.content).toBe('내 글 더')

    expect(await docs.reloadDraft()).toBe(true)
    expect(docs.saveState).toBe('saved')
    expect(docs.stale).toBeNull()
    expect(docs.draft?.content).toBe('남이 쓴 글')
  })

  it('표 · 제목 · 본문을 보내면서 rev 가 없으면 422, 파트만은 rev 없이', async () => {
    await expect(api.patchDocument('doc1', { content: 'x' })).rejects.toMatchObject({
      status: 422,
    })
    const moved = await api.patchDocument('doc1', { partId: null })
    expect(moved).toMatchObject({ partId: null, rev: 3 })
  })

  it('떠나면 기다리던 저장을 바로 보낸다', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc2')
    const patch = vi.spyOn(api, 'patchDocument')
    const sheet: SheetBook = {
      sheets: [
        {
          name: '요약',
          columns: [{ width: 200 }],
          data: [['=1+1']],
          merges: {},
          styles: { A1: 'font-weight: bold' },
        },
        { name: 'Sheet2', columns: [{ width: 120 }], data: [], merges: {}, styles: {} },
      ],
    }
    docs.edit({ sheet })
    docs.closeDraft()
    await vi.waitFor(() => expect(docs.byId.doc2.rev).toBe(3))
    expect(patch).toHaveBeenCalledWith('doc2', { rev: 2, sheet })
    expect(docs.draft).toBeNull()
  })
})

describe('연결 · 결정 바뀜 · 확인', () => {
  it('결정이 바뀌면 바로 결정 바뀜 — 연결을 바꿔도 남는 안건의 seenRev 는 그대로, [확인] 으로 지운다', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc1')
    useAgendaStore().updateAgenda('t1', { decision: '데비안으로 바꾼다' })
    const doc = () => docs.byId.doc1
    expect(docs.changedOf(doc())).toEqual(['t1'])

    expect(await docs.linkAgenda('doc1', 't6')).toBe(true)
    expect(doc().agendas).toEqual([
      { agendaId: 't1', seenRev: 1 },
      { agendaId: 't2', seenRev: 1 },
      { agendaId: 't6', seenRev: 1 },
    ])
    /* 서버의 셈과 같다 */
    expect(doc().changedAgendaIds).toEqual(['t1'])
    expect(doc().rev).toBe(3)

    expect(await docs.confirm('doc1', ['t1'])).toBe(true)
    expect(doc().agendas[0]).toEqual({ agendaId: 't1', seenRev: 2 })
    expect(docs.changedOf(doc())).toEqual([])

    expect(await docs.unlinkAgenda('doc1', 't2')).toBe(true)
    expect(doc().agendas.map((l) => l.agendaId)).toEqual(['t1', 't6'])
  })

  it('[모두 확인] 은 연결 안건 전부, 연결 안 된 안건 확인은 400', async () => {
    const docs = useDocumentStore()
    await docs.openDraft('doc2')
    useAgendaStore().updateAgenda('t1', { decision: '데비안' })
    useAgendaStore().updateAgenda('t6', { decision: '미룬다' })
    expect(docs.changedOf(docs.byId.doc2)).toEqual(['t6', 't1'])
    await docs.confirm('doc2')
    expect(docs.changedOf(docs.byId.doc2)).toEqual([])

    expect(await docs.confirm('doc2', ['t3'])).toBe(false)
    expect(lastError()?.code).toBe('DOCUMENT_AGENDA_NOT_LINKED')
  })

  it('지운 안건의 연결은 읽을 때 빠진다', async () => {
    const docs = useDocumentStore()
    await useAgendaStore().deleteAgenda('t2')
    const doc = await docs.fetchOne('doc1')
    expect(doc.agendas.map((l) => l.agendaId)).toEqual(['t1'])
    expect(docs.linksOf(doc).map((l) => l.agendaId)).toEqual(['t1'])
  })
})

describe('권한 · 파트', () => {
  it('파트 문서는 만든 사람 · 관리자 · 그 파트 수정 권한, 공통 문서는 멤버 누구나', async () => {
    await signIn('u2')
    const docs = useDocumentStore()
    await docs.load()
    const doc1 = docs.list.find((d) => d.id === 'doc1')!
    const doc2 = docs.list.find((d) => d.id === 'doc2')!
    expect(docs.canEdit(doc1)).toBe(false)
    expect(docs.canEdit(doc2)).toBe(true)
    expect(docs.canDelete(doc2)).toBe(false)
    expect(docs.canCreateIn(null)).toBe(true)
    expect(docs.canCreateIn('pt1')).toBe(false)
    expect(docs.canCreateIn('pt3')).toBe(true)

    await expect(api.patchDocument('doc1', { rev: 3, title: '남의 것' })).rejects.toMatchObject({
      status: 403,
    })
    expect(await docs.create({ title: '인프라 문서', kind: 'text', partId: 'pt1' })).toBeNull()
    expect(lastError()?.status).toBe(403)
    /* 공통 문서를 고칠 수는 있어도 수정 권한이 없는 파트로 옮기지는 못한다 */
    expect(await docs.setPart('doc2', 'pt1')).toBe(false)
    expect(await docs.remove('doc2')).toBe(false)
    /* 자기 파트로 옮기면 그 파트 삭제 권한으로 지울 수도 있다 */
    expect(await docs.setPart('doc2', 'pt3')).toBe(true)
    expect(docs.canDelete(docs.byId.doc2)).toBe(true)
  })

  it('없는 파트는 PART_NOT_FOUND, 보관 파트를 새로 달면 PART_ARCHIVED — 달려 있던 보관 파트는 그대로 둔다', async () => {
    const docs = useDocumentStore()
    expect(await docs.setPart('doc2', 'nope')).toBe(false)
    expect(lastError()?.code).toBe('PART_NOT_FOUND')
    mockDb().parts.find((p) => p.id === 'pt1')!.active = false
    expect(await docs.setPart('doc2', 'pt1')).toBe(false)
    expect(lastError()).toMatchObject({
      code: 'PART_ARCHIVED',
      detail: { partId: expect.any(String) },
    })
    await expect(api.patchDocument('doc1', { partId: 'pt1' })).resolves.toMatchObject({
      partId: 'pt1',
    })
  })

  it('지우면 목록에서 빠진다 — 만든 사람', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(await docs.remove('doc2')).toBe(true)
    expect(docs.list.map((d) => d.id)).toEqual(['doc1'])
    await expect(api.fetchDocument('doc2')).rejects.toMatchObject({
      status: 404,
      code: 'DOCUMENT_NOT_FOUND',
    })
  })
})

describe('폴더', () => {
  it('목록과 같이 받는다 — 이름순 평평한 배열, 문서는 folderId', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(docs.folders.map((f) => f.name)).toEqual(['서버', '인프라', '회의 정리'])
    expect(docs.list.find((d) => d.id === 'doc1')!.folderId).toBe('df1')
    expect(docs.list.find((d) => d.id === 'doc2')!.folderId).toBeNull()
  })

  it('만들기 · 이름 바꾸기 — 같은 부모 아래 같은 이름은 그 자리의 말로, 다른 부모면 된다. 서버도 409', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(await docs.createFolder('  ', null)).toBe('폴더 이름을 적어 주세요.')
    expect(await docs.createFolder('인프라', null)).toContain('같은 이름의 폴더')
    const made = await docs.createFolder(' 인프라 ', 'df3')
    expect(made).toMatchObject({ name: '인프라', parentId: 'df3', createdBy: 'u1' })
    expect(docs.folders.some((f) => f.id === (made as { id: string }).id)).toBe(true)
    /* 대소문자는 그대로 견준다 */
    expect(await docs.createFolder('Infra', null)).toMatchObject({ name: 'Infra' })
    expect(await docs.createFolder('infra', null)).toMatchObject({ name: 'infra' })

    expect(await docs.renameFolder('df3', '인프라')).toContain('같은 이름의 폴더')
    expect(await docs.renameFolder('df3', '회의록')).toMatchObject({ name: '회의록' })
    await expect(
      api.createDocFolder('p1', { name: '서버', parentId: 'df1' }),
    ).rejects.toMatchObject({ status: 409, code: 'DOCUMENT_FOLDER_NAME_TAKEN' })
    await expect(api.createDocFolder('p1', { name: 'x'.repeat(101) })).rejects.toMatchObject({
      status: 422,
    })
    await expect(api.createDocFolder('p1', { name: '새', parentId: 'nope' })).rejects.toMatchObject(
      {
        status: 400,
        code: 'DOCUMENT_FOLDER_NOT_FOUND',
      },
    )
    await expect(api.patchDocFolder('nope', { name: '새' })).rejects.toMatchObject({
      status: 404,
      code: 'DOCUMENT_FOLDER_NOT_FOUND',
    })
  })

  it('옮기기 — 자기 하위로는 CYCLE, 5단을 넘으면 TOO_DEEP(딸린 하위까지 센다)', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(docs.folderMoveBlock('df1', 'df2')).toContain('자기 안으로')
    expect(await docs.moveFolder('df1', 'df2')).toBe(false)
    await expect(api.patchDocFolder('df1', { parentId: 'df2' })).rejects.toMatchObject({
      status: 400,
      code: 'DOCUMENT_FOLDER_CYCLE',
    })
    await expect(api.patchDocFolder('df1', { parentId: 'df1' })).rejects.toMatchObject({
      code: 'DOCUMENT_FOLDER_CYCLE',
    })

    /* df3 아래로 세 단 더 — df3(1) · a(2) · b(3) · c(4). 인프라(2단 높이)를 c 아래로 놓으면 6단 */
    let parent = 'df3'
    for (const name of ['a', 'b', 'c']) {
      const f = await docs.createFolder(name, parent)
      parent = (f as { id: string }).id
    }
    expect(docs.folderMoveBlock('df1', parent)).toContain('5단까지')
    await expect(api.patchDocFolder('df1', { parentId: parent })).rejects.toMatchObject({
      status: 400,
      code: 'DOCUMENT_FOLDER_TOO_DEEP',
    })
    const d = await docs.createFolder('d', parent)
    expect(typeof d).toBe('object')
    expect(await docs.createFolder('e', (d as { id: string }).id)).toContain('5단까지')

    /* 서버를 맨 위로 — 된다 */
    expect(await docs.moveFolder('df2', null)).toBe(true)
    expect(docs.folders.find((f) => f.id === 'df2')!.parentId).toBeNull()
  })

  it('지우기 — 빈 폴더만(409 NOT_EMPTY), 관리자 · 만든 사람만(403)', async () => {
    const docs = useDocumentStore()
    await docs.load()
    expect(docs.folderEmpty('df1')).toBe(false)
    expect(await docs.removeFolder('df1')).toBe(false)
    expect(lastError()).toMatchObject({ status: 409, code: 'DOCUMENT_FOLDER_NOT_EMPTY' })

    useDocumentStore().clear()
    writeMockSession('u2')
    await useAuthStore().loadMe()
    await docs.load()
    const df3 = docs.folders.find((f) => f.id === 'df3')!
    expect(docs.canDeleteFolder(df3)).toBe(false)
    expect(await docs.removeFolder('df3')).toBe(false)
    expect(lastError()?.status).toBe(403)
    /* 만들기 · 이름 바꾸기는 멤버 누구나 */
    const mine = await docs.createFolder('내 폴더', null)
    expect(docs.canDeleteFolder(mine as never)).toBe(true)
    expect(await docs.removeFolder((mine as { id: string }).id)).toBe(true)
    expect(docs.folders.some((f) => f.name === '내 폴더')).toBe(false)
  })

  it('문서 폴더 옮기기 — rev 를 안 올리고, 없는 폴더는 400, 못 고치는 문서는 403', async () => {
    const docs = useDocumentStore()
    await docs.load()
    const patch = vi.spyOn(api, 'patchDocument')
    expect(await docs.setFolder('doc2', 'df3')).toBe(true)
    expect(patch).toHaveBeenCalledWith('doc2', { folderId: 'df3' })
    expect(docs.list.find((d) => d.id === 'doc2')).toMatchObject({ folderId: 'df3', rev: 2 })
    /* 같은 자리면 보내지 않는다 */
    expect(await docs.setFolder('doc2', 'df3')).toBe(true)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(await docs.setFolder('doc2', 'nope')).toBe(false)
    expect(lastError()).toMatchObject({ code: 'DOCUMENT_FOLDER_NOT_FOUND' })

    const id = await docs.create({ title: '새 글', kind: 'text', folderId: 'df2' })
    expect(docs.byId[id!].folderId).toBe('df2')
    expect(await docs.create({ title: '없는 곳', kind: 'text', folderId: 'nope' })).toBeNull()
    expect(lastError()).toMatchObject({ status: 400, code: 'DOCUMENT_FOLDER_NOT_FOUND' })

    writeMockSession('u2')
    await useAuthStore().loadMe()
    await expect(api.patchDocument('doc1', { folderId: null })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('서버 갈래 경로', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
    const fetch = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.fetchDocFolders('p1')
    expect(fetch).toHaveBeenCalledWith('/api/projects/p1/document-folders', expect.anything())
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.deleteDocFolder('df1')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/document-folders/df1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

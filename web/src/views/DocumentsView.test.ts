// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import type jspreadsheet from 'jspreadsheet-ce'
import type { SheetBook } from '@/types/domain'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as api from '@/api'
import { mockDb, resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { columnName, DOC_SAVE_DELAY_MS, SHEET_COLUMNS_MAX, SHEET_ROWS_MAX } from '@/lib/document'
import { toastError } from '@/lib/notify'
import { useAgendaStore } from '@/stores/agenda'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import DocumentsView from './DocumentsView.vue'

/* 문서 화면 — 트리(폴더 · 펼침 기억 · 거르기 · 새 폴더 · 이름 · 지우기 · 끌어 옮기기) · 새 문서 · 글 문서(워드처럼 쓰는 편집기 · [본문에 넣기] · 자동 저장 · 예전 마크다운) ·
   표 문서(스프레드시트 · 줄 넣기 · 도구 줄 · 시트 탭 · 상한 · 잠금) · 409 줄 · 읽기 전용 · 안건 상세의 '실린 문서' */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))
vi.mock('vue-sonner', async (importOriginal) => {
  const real = await importOriginal<typeof import('vue-sonner')>()
  return { ...real, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }
})

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/documents', component: DocumentsView },
      { path: '/documents/:documentId', component: DocumentsView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  const w = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  return { w, router }
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

async function type(el: HTMLElement | null, value: string) {
  expect(el, '칸을 못 찾았다').toBeTruthy()
  ;(el as HTMLInputElement).value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

/** SearchPicker 에 적고 Enter */
async function pickIn(root: HTMLElement | null, text: string) {
  const input = root!.querySelector<HTMLInputElement>('input[role="combobox"]')!
  input.dispatchEvent(new Event('focus'))
  await type(input, text)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await flushPromises()
}

async function settle() {
  await vi.advanceTimersByTimeAsync(DOC_SAVE_DELAY_MS)
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
  await useDataStore().retry()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 끌어 옮기기 — jsdom 엔 DragEvent 가 없어 이름만 같은 이벤트를 보낸다(dataTransfer 없이) */
async function drag(from: HTMLElement | null, to: HTMLElement | null) {
  expect(from, '끌 것을 못 찾았다').toBeTruthy()
  from!.dispatchEvent(new Event('dragstart', { bubbles: true }))
  await flushPromises()
  expect(to, '놓을 자리를 못 찾았다').toBeTruthy()
  to!.dispatchEvent(new Event('dragover', { bubbles: true }))
  to!.dispatchEvent(new Event('drop', { bubbles: true }))
  await flushPromises()
}

const treeOrder = () =>
  $$('[data-doc-folder], [data-doc-item]').map((el) =>
    el.dataset.docFolder ? `f:${el.dataset.docFolder}` : `d:${el.dataset.docItem}`,
  )
const folderRow = (id: string) => $(`[data-doc-folder="${id}"] > div`)
const docRow = (id: string) => $(`[data-doc-item="${id}"] > button`)

async function nameFolder(name: string) {
  await type($('[data-doc-folder-name-input]'), name)
  $('[data-doc-folder-name-input]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  await flushPromises()
}

describe('트리', () => {
  it('폴더 먼저 이름순, 그다음 문서 제목순 — 펼치면 하위가 보이고 펼침을 기억한다. 결정이 바뀌면 주황 점', async () => {
    useAgendaStore().updateAgenda('t1', { decision: '데비안으로 바꾼다' })
    const { router } = await mountAt('/documents')
    expect(treeOrder()).toEqual(['f:df1', 'f:df3', 'd:doc2'])
    expect($('[data-doc-folder="df1"] [data-doc-folder-count]')!.textContent?.trim()).toBe('1')
    expect($('[data-doc-folder="df3"] [data-doc-folder-count]')!.textContent?.trim()).toBe('0')
    expect($('[data-doc-item="doc2"] [data-doc-kind="sheet"]')).toBeTruthy()
    expect($('[data-doc-item="doc2"] [data-doc-changed]')!.textContent?.trim()).toBe('1')
    /* 오른쪽은 안내 + 최근 고친 문서 */
    expect($('[data-doc-empty]')).toBeTruthy()
    expect($$('[data-doc-recent]').map((r) => r.dataset.docRecent)).toEqual(['doc2', 'doc1'])

    await click($('[data-doc-folder="df1"] [data-doc-folder-toggle]'))
    expect(treeOrder()).toEqual(['f:df1', 'f:df2', 'd:doc1', 'f:df3', 'd:doc2'])
    expect($('[data-doc-item="doc1"] [data-doc-kind="text"]')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('innoflow.docFolders.u1.p1')!)).toEqual(['df1'])

    await click(docRow('doc2'))
    expect(router.currentRoute.value.path).toBe('/documents/doc2')
    expect($('[data-doc-item="doc2"]')!.dataset.selected).toBe('true')
    expect($('[data-doc-empty]')).toBeNull()
  })

  it('문서를 열면 그 위 폴더를 펼치고 강조한다, 머리에 폴더 경로', async () => {
    mockDb().documents.find((d) => d.id === 'doc1')!.folderId = 'df2'
    await mountAt('/documents/doc1')
    expect(treeOrder()).toEqual(['f:df1', 'f:df2', 'd:doc1', 'f:df3', 'd:doc2'])
    expect($('[data-doc-item="doc1"]')!.dataset.selected).toBe('true')
    expect($('[data-doc-crumbs]')!.textContent).toContain('인프라')
    expect($('[data-doc-crumbs]')!.textContent).toContain('서버')
  })

  it('검색 · ?agendaId= 로 거르면 맞는 문서와 그 위 폴더만 펼쳐 보인다 — 빈 폴더는 숨긴다', async () => {
    const { router } = await mountAt('/documents')
    await type($('[data-doc-search]'), '구성')
    expect(treeOrder()).toEqual(['f:df1', 'd:doc1'])
    expect($('[data-doc-folder="df1"]')!.dataset.open).toBe('true')
    await type($('[data-doc-search]'), '없는 말')
    expect(treeOrder()).toEqual([])
    expect($('[data-doc-tree-empty]')!.textContent).toContain('맞는 문서가 없습니다')
    await type($('[data-doc-search]'), '')
    expect(treeOrder()).toEqual(['f:df1', 'f:df3', 'd:doc2'])

    await router.push('/documents?agendaId=t6')
    await flushPromises()
    expect(treeOrder()).toEqual(['d:doc2'])
    expect($('[data-doc-agenda-filter]')!.textContent).toContain('일정 조율')
    /* 문서를 열어도 거르기는 남는다 */
    await click(docRow('doc2'))
    expect(router.currentRoute.value.fullPath).toBe('/documents/doc2?agendaId=t6')
    await click($('[data-doc-agenda-filter-clear]'))
    expect(router.currentRoute.value.fullPath).toBe('/documents/doc2')
    expect(treeOrder()).toEqual(['f:df1', 'f:df3', 'd:doc2'])
  })

  it('[새 폴더] — 같은 자리에 같은 이름이면 그 자리에서 알리고, 하위 폴더 · 이름 바꾸기도 줄에서 바로', async () => {
    await mountAt('/documents')
    await click($('[data-doc-folder-new]'))
    await nameFolder('인프라')
    expect($('[data-doc-folder-problem]')!.textContent).toContain('같은 이름의 폴더')
    await nameFolder('설계')
    expect($('[data-doc-folder-name-input]')).toBeNull()
    const made = mockDb().docFolders.find((f) => f.name === '설계')!
    expect(made.parentId).toBeNull()
    expect(treeOrder()).toEqual(['f:' + made.id, 'f:df1', 'f:df3', 'd:doc2'])

    /* 하위 폴더 — 그 폴더를 펼치고 안에 칸 */
    await click($('[data-doc-folder="df3"] [data-doc-folder-menu]'))
    await click($('[data-doc-folder-new-sub]'))
    await nameFolder('11월')
    const sub = mockDb().docFolders.find((f) => f.name === '11월')!
    expect(sub.parentId).toBe('df3')
    expect(treeOrder()).toEqual(['f:' + made.id, 'f:df1', 'f:df3', 'f:' + sub.id, 'd:doc2'])

    /* 이름 바꾸기 — 같은 부모 아래 겹치면 알린다 */
    await click($('[data-doc-folder="df3"] [data-doc-folder-menu]'))
    await click($('[data-doc-folder-rename]'))
    await nameFolder('인프라')
    expect($('[data-doc-folder-problem]')!.textContent).toContain('같은 이름의 폴더')
    await nameFolder('회의록 정리')
    expect($('[data-doc-folder="df3"] [data-doc-folder-name]')!.textContent?.trim()).toBe(
      '회의록 정리',
    )
    expect(mockDb().docFolders.find((f) => f.id === 'df3')!.name).toBe('회의록 정리')
  })

  it('지우기는 빈 폴더만 — 아니면 막힌 채 이유', async () => {
    await mountAt('/documents')
    await click($('[data-doc-folder="df1"] [data-doc-folder-menu]'))
    expect($('[data-doc-folder-remove]')!.hasAttribute('disabled')).toBe(true)
    expect($('[data-doc-folder-remove-reason]')!.textContent).toContain('안에 폴더나 문서가 있어')

    await click($('[data-doc-folder="df3"] [data-doc-folder-menu]'))
    expect($('[data-doc-folder-remove]')!.hasAttribute('disabled')).toBe(false)
    await click($('[data-doc-folder-remove]'))
    expect(mockDb().docFolders.some((f) => f.id === 'df3')).toBe(false)
    expect(treeOrder()).toEqual(['f:df1', 'd:doc2'])
  })

  it('끌어 옮기기 — 문서 · 폴더를 폴더 줄에 놓으면 그 안, 최상위에 놓으면 맨 위. 문서의 rev 는 안 오른다', async () => {
    await mountAt('/documents')
    await drag(docRow('doc2'), folderRow('df3'))
    expect(mockDb().documents.find((d) => d.id === 'doc2')!.folderId).toBe('df3')
    expect(mockDb().documents.find((d) => d.id === 'doc2')!.rev).toBe(2)
    expect(treeOrder()).toEqual(['f:df1', 'f:df3', 'd:doc2'])
    expect($('[data-doc-folder="df3"]')!.dataset.open).toBe('true')

    /* 폴더를 자기 하위로는 안 받는다 */
    await click($('[data-doc-folder="df1"] [data-doc-folder-toggle]'))
    await drag(folderRow('df1'), folderRow('df2'))
    expect(mockDb().docFolders.find((f) => f.id === 'df1')!.parentId).toBeNull()

    await drag(folderRow('df1'), folderRow('df3'))
    expect(mockDb().docFolders.find((f) => f.id === 'df1')!.parentId).toBe('df3')
    expect(treeOrder()).toEqual(['f:df3', 'f:df1', 'f:df2', 'd:doc1', 'd:doc2'])

    /* 끄는 동안만 '최상위' 자리가 뜬다 */
    expect($('[data-doc-tree-root]')).toBeNull()
    docRow('doc1')!.dispatchEvent(new Event('dragstart', { bubbles: true }))
    await flushPromises()
    await drag(docRow('doc1'), $('[data-doc-tree-root]'))
    expect(mockDb().documents.find((d) => d.id === 'doc1')!.folderId).toBeNull()
    expect(mockDb().documents.find((d) => d.id === 'doc1')!.rev).toBe(3)
    expect($('[data-doc-tree-root]')).toBeNull()
  })

  it('못 고치는 문서는 끌어도 놓을 자리가 없다', async () => {
    writeMockSession('u2')
    await useAuthStore().loadMe()
    await mountAt('/documents')
    await click($('[data-doc-folder="df1"] [data-doc-folder-toggle]'))
    expect(docRow('doc1')!.getAttribute('draggable')).toBe('false')
    await drag(docRow('doc1'), folderRow('df3'))
    expect(mockDb().documents.find((d) => d.id === 'doc1')!.folderId).toBe('df1')
  })

  it('문서 메뉴의 폴더 고르기 — rev 는 그대로, 머리 경로가 바뀐다', async () => {
    await mountAt('/documents/doc1')
    const patch = vi.spyOn(api, 'patchDocument')
    await click($('[data-doc-menu]'))
    await click($('[data-doc-folder-choice="df3"]'))
    expect(patch).toHaveBeenCalledWith('doc1', { folderId: 'df3' })
    expect(useDocumentStore().byId.doc1.rev).toBe(3)
    expect(useDocumentStore().byId.doc1.folderId).toBe('df3')
    expect($('[data-doc-crumbs]')!.textContent).toContain('회의 정리')
    expect($('[data-doc-folder="df3"]')!.dataset.open).toBe('true')
  })

  it('[새 문서] — 제목 · 종류 · 안건을 골라 만들면 그 문서로 간다, 폴더는 보던 문서의 폴더', async () => {
    const { router } = await mountAt('/documents/doc1')
    await click($('[data-doc-new]'))
    const dialog = $('[data-doc-create]')!
    expect($('[data-doc-create-folder]')!.textContent).toContain('인프라')
    expect($('[data-doc-create-submit]')!.hasAttribute('disabled')).toBe(true)
    await type($('[data-doc-create-title]'), '결정 모음 표')
    await click($('[data-doc-create-kind="sheet"]'))
    await pickIn(dialog, 'DB')
    expect($$('[data-doc-create-agenda]').map((r) => r.dataset.docCreateAgenda)).toEqual(['t2'])
    await click($('[data-doc-create-submit]'))
    expect(router.currentRoute.value.path).toMatch(/^\/documents\/doc\d+$/)
    const id = router.currentRoute.value.path.split('/').at(-1)!
    expect(mockDb().documents.find((d) => d.id === id)!.folderId).toBe('df1')
    expect(($('[data-doc-title]') as HTMLInputElement).value).toBe('결정 모음 표')
    await vi.waitFor(() => expect($('[data-doc-sheet]')).toBeTruthy())
    expect($$('[data-doc-agenda]').map((r) => r.dataset.docAgenda)).toEqual(['t2'])
    expect($(`[data-doc-item="${id}"]`)!.dataset.selected).toBe('true')
  })

  it('폴더 메뉴의 [새 문서] 는 그 폴더에, 맨 위의 [새 문서] 는 최상위에', async () => {
    const { router } = await mountAt('/documents')
    await click($('[data-doc-new]'))
    expect($('[data-doc-create-folder]')!.textContent).toContain('최상위')
    await click($('[data-doc-create-cancel]'))

    await click($('[data-doc-folder="df3"] [data-doc-folder-menu]'))
    await click($('[data-doc-folder-new-doc]'))
    expect($('[data-doc-create-folder]')!.textContent).toContain('회의 정리')
    await type($('[data-doc-create-title]'), '11월 회의')
    await click($('[data-doc-create-submit]'))
    const id = router.currentRoute.value.path.split('/').at(-1)!
    expect(mockDb().documents.find((d) => d.id === id)!.folderId).toBe('df3')
    expect(treeOrder()).toContain(`d:${id}`)
  })
})

describe('글 문서', () => {
  /** 글 편집기는 따로 받아 뜬다 — 본문 칸이 설 때까지 기다린다 */
  async function openText(path = '/documents/doc1') {
    const mounted = await mountAt(path)
    await vi.waitFor(() => expect($('[data-doc-content]')).toBeTruthy())
    await flushPromises()
    return mounted
  }

  it('워드처럼 쓰는 편집기 — [본문에 넣기] 는 끝에 제목 + 결정 블록, 0.8초 뒤 HTML 로 저장', async () => {
    await openText()
    const body = () => $('[data-doc-content]')!
    expect(body().getAttribute('contenteditable')).toBe('true')
    expect($$('[data-doc-content] h3').map((h) => h.textContent)).toEqual([
      '서버 OS 결정',
      'DB 결정',
    ])
    await click($('[data-doc-insert="t1"]'))
    expect($$('[data-doc-content] h3').map((h) => h.textContent)).toEqual([
      '서버 OS 결정',
      'DB 결정',
      '서버 OS 결정',
    ])
    expect($('[data-doc-save-state]')!.textContent).toContain('저장 중')
    await settle()
    expect($('[data-doc-save-state]')!.textContent).toContain('저장됨')
    const saved = useDocumentStore().byId.doc1
    expect(saved.rev).toBe(4)
    expect(saved.content.endsWith('<h3>서버 OS 결정</h3><p>우분투 최신 버전으로 한다</p>')).toBe(
      true,
    )
    /* 이어 넣으면 넣은 것 뒤에 쌓인다 */
    await click($('[data-doc-insert="t2"]'))
    expect(
      $$('[data-doc-content] h3')
        .map((h) => h.textContent)
        .at(-1),
    ).toBe('DB 결정')
    expect($$('[data-doc-content] > ul').at(-1)!.textContent).toContain('supabase')
  })

  it('예전 마크다운 글은 열 때 HTML 로 옮겨 보이고, 고치기 전엔 저장하지 않는다', async () => {
    mockDb().documents.find((d) => d.id === 'doc1')!.content = '### 옛 제목\n\n- 하나\n- 둘'
    await openText()
    expect($('[data-doc-content] h3')!.textContent).toBe('옛 제목')
    expect($$('[data-doc-content] li').map((li) => li.textContent)).toEqual(['하나', '둘'])
    await settle()
    expect(useDocumentStore().byId.doc1.rev).toBe(3)
  })

  it('결정이 바뀐 안건은 주황 테두리 · 판 n → m · [확인], [모두 확인] 으로 지운다', async () => {
    useAgendaStore().updateAgenda('t1', { decision: '데비안' })
    await mountAt('/documents/doc1')
    expect($('[data-doc-agenda="t1"]')!.dataset.changed).toBe('true')
    expect($('[data-doc-agenda="t1"] [data-doc-agenda-changed]')!.textContent).toContain(
      '결정 바뀜 — 판 1 → 2',
    )
    expect($('[data-doc-agenda="t2"] [data-doc-agenda-changed]')).toBeNull()
    await click($('[data-doc-confirm-all]'))
    expect($('[data-doc-agenda-changed]')).toBeNull()
    expect($('[data-doc-confirm-all]')).toBeNull()
  })

  it('[안건 연결] 로 고르면 바로 붙는다', async () => {
    await mountAt('/documents/doc1')
    await click($('[data-doc-link-open]'))
    await pickIn($('[data-doc-link-dialog]'), '일정 조율')
    expect($$('[data-doc-agenda]').map((r) => r.dataset.docAgenda)).toEqual(['t1', 't2', 't6'])
  })

  it('다른 사람이 먼저 고쳤으면 줄을 띄우고 멈춘다 — [다시 불러오기] 로 서버 것', async () => {
    await openText()
    await api.patchDocument('doc1', { rev: 3, content: '<p>남이 쓴 글</p>' })
    await click($('[data-doc-insert="t1"]'))
    await settle()
    expect($('[data-doc-stale]')!.textContent).toContain('다른 사람이 먼저 고쳤습니다')
    /* 내 글은 화면에 남는다 */
    expect($$('[data-doc-content] h3')).toHaveLength(3)
    expect($('[data-doc-content]')!.getAttribute('contenteditable')).toBe('false')

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await click($('[data-doc-reload]'))
    expect($('[data-doc-stale]')).toBeNull()
    expect($('[data-doc-content]')!.textContent).toBe('남이 쓴 글')
    expect($('[data-doc-content]')!.getAttribute('contenteditable')).toBe('true')
  })

  it('권한이 없으면 읽기 전용 — 칸이 잠기고 버튼이 숨는다, .docx 내려받기만', async () => {
    writeMockSession('u2')
    await useAuthStore().loadMe()
    await openText()
    expect($('[data-doc-readonly]')).toBeTruthy()
    expect(($('[data-doc-title]') as HTMLInputElement).readOnly).toBe(true)
    expect($('[data-doc-content]')!.getAttribute('contenteditable')).toBe('false')
    expect($('[data-doc-text-bold]')).toBeNull()
    expect($('[data-doc-text-import]')).toBeNull()
    expect($('[data-doc-text-download]')).toBeTruthy()
    expect($('[data-doc-link-open]')).toBeNull()
    expect($('[data-doc-insert]')).toBeNull()
    expect($('[data-doc-menu]')).toBeNull()
  })

  it('안건 제목을 누르면 안건 상세 — "실린 문서" 에 이 문서 칩', async () => {
    const { router } = await mountAt('/documents/doc1')
    await click($('[data-doc-agenda="t2"] [data-doc-agenda-open]'))
    const dialog = $('[role="dialog"]')!
    expect(dialog.querySelector('[data-agenda-doc="doc1"]')!.textContent).toContain('서버 구성')
    await click(dialog.querySelector('[data-agenda-doc="doc1"]'))
    expect(router.currentRoute.value.path).toBe('/documents/doc1')
  })
})

describe('안건 상세 — 실린 문서', () => {
  it('[문서에 담기] — 기존 문서를 고르면 연결되고, 새 문서는 이 안건을 담아 만든다', async () => {
    const { router } = await mountAt('/documents/doc1')
    await click($('[data-doc-agenda="t2"] [data-doc-agenda-open]'))
    expect($$('[data-agenda-doc]').map((c) => c.dataset.agendaDoc)).toEqual(['doc1'])
    await click($('[data-agenda-docs-add]'))
    await pickIn($('[data-agenda-docs-dialog]'), '결정 사항')
    expect($$('[data-agenda-doc]').map((c) => c.dataset.agendaDoc)).toEqual(['doc2', 'doc1'])
    expect(useDocumentStore().byId.doc2.agendas.map((l) => l.agendaId)).toEqual(['t6', 't1', 't2'])

    await click($('[data-agenda-docs-add]'))
    await click($('[data-agenda-docs-new]'))
    expect(($('[data-doc-create-title]') as HTMLInputElement).value).toBe('DB 결정')
    expect($$('[data-doc-create-agenda]').map((r) => r.dataset.docCreateAgenda)).toEqual(['t2'])
    await click($('[data-doc-create-submit]'))
    expect(router.currentRoute.value.path).toMatch(/^\/documents\/doc3$/)
  })
})

describe('표 문서', () => {
  type Sheet = { worksheets: jspreadsheet.WorksheetInstance[]; getWorksheetActive: () => number }
  /** 편집기가 다 뜰 때까지 — 띄운 뒤 host 에 spreadsheet 가 붙는다 */
  async function editor(): Promise<Sheet> {
    await vi.waitFor(() => {
      const host = $('[data-doc-sheet-host]') as (HTMLElement & { spreadsheet?: Sheet }) | null
      expect(host?.spreadsheet?.worksheets.length).toBeGreaterThan(0)
    })
    await flushPromises()
    return ($('[data-doc-sheet-host]') as HTMLElement & { spreadsheet: Sheet }).spreadsheet
  }
  const cell = (x: number, y: number) =>
    $(`[data-doc-sheet-host] .jss_worksheet td[data-x="${x}"][data-y="${y}"]`)
  const saved = () => useDocumentStore().byId.doc2.sheet

  it('스프레드시트로 뜨고, [본문에 넣기] 는 적은 줄 끝에 한 줄 — 0.8초 뒤 SheetBook 째 저장', async () => {
    await mountAt('/documents/doc2')
    const ss = await editor()
    /* 머리는 엑셀처럼 A ~ Z 가 빈 칸까지 깔리고, 열 이름은 첫 줄 칸에 굵게 */
    expect(ss.worksheets[0].headers.map((h) => h.textContent)).toEqual(
      Array.from({ length: 26 }, (_, i) => columnName(i)),
    )
    expect(ss.worksheets[0].rows).toHaveLength(100)
    expect(cell(25, 99)).toBeTruthy()
    expect(cell(0, 0)!.textContent).toBe('항목')
    expect(cell(0, 0)!.style.fontWeight).toBe('bold')
    expect(cell(0, 2)!.textContent).toBe('서버 OS 결정')
    expect($$('[data-doc-sheet-tab]').map((t) => t.textContent?.trim())).toEqual(['Sheet1'])

    const patch = vi.spyOn(api, 'patchDocument')
    await click($('[data-doc-insert="t1"]'))
    expect(cell(0, 3)!.textContent).toBe('서버 OS 결정')
    expect(cell(1, 3)!.textContent).toBe('우분투 최신 버전으로 한다')
    await settle()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(saved().sheets[0].data.map((r) => r[0])).toEqual([
      '항목',
      '일정 조율 — 전체 일정을 미룰지, 테스트 기간을 줄일지',
      '서버 OS 결정',
      '서버 OS 결정',
    ])
    expect(saved().sheets[0].styles).toEqual({
      A1: 'font-weight: bold',
      B1: 'font-weight: bold',
      C1: 'font-weight: bold',
      A2: 'font-weight: bold',
      A3: 'font-weight: bold',
    })
    expect(useDocumentStore().byId.doc2.rev).toBe(3)

    /* 수식은 계산해 보이고, 저장은 원문 */
    const ws = ss.worksheets[0]
    ws.setValueFromCoords(0, 4, '2', true)
    ws.setValueFromCoords(1, 4, '=A5*3', true)
    await settle()
    expect(cell(1, 4)!.textContent).toBe('6')
    expect(saved().sheets[0].data[4]).toEqual(['2', '=A5*3', ''])

    /* 되돌리기 */
    await click($('[data-doc-sheet-undo]'))
    await settle()
    expect(saved().sheets[0].data[4]).toEqual(['2', '', ''])
  })

  it('도구 줄 — 고른 칸에 굵게 · 병합, 시트 더하기 · 이름 바꾸기 · 지우기', async () => {
    await mountAt('/documents/doc2')
    const ss = await editor()
    const ws = ss.worksheets[0]
    ws.updateSelectionFromCoords(1, 1, 2, 1)
    await click($('[data-doc-sheet-bold]'))
    ws.updateSelectionFromCoords(0, 3, 2, 4)
    await click($('[data-doc-sheet-merge]'))
    await settle()
    expect(saved().sheets[0].styles).toMatchObject({
      B2: 'font-weight: bold',
      C2: 'font-weight: bold',
    })
    expect(saved().sheets[0].merges).toEqual({ A4: [3, 2] })

    await click($('[data-doc-sheet-add]'))
    await editor()
    await settle()
    expect(saved().sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2'])
    /* 새 시트도 A ~ Z 를 깔지만 저장은 쓴 범위(빈 1열)만 */
    expect(ss.worksheets[1].headers).toHaveLength(26)
    expect(saved().sheets[1].columns).toHaveLength(1)
    expect(saved().sheets[1].data).toEqual([])
    expect(ss.getWorksheetActive()).toBe(1)

    await click($('[data-doc-sheet-tab-menu]'))
    await type($('[data-doc-sheet-name]'), ' Sheet1 ')
    expect($('[data-doc-sheet-rename]')!.hasAttribute('disabled')).toBe(true)
    await type($('[data-doc-sheet-name]'), ' 메모 ')
    await click($('[data-doc-sheet-rename]'))
    await settle()
    expect(saved().sheets.map((s) => s.name)).toEqual(['Sheet1', '메모'])

    await click($('[data-doc-sheet-tab-menu]'))
    await click($('[data-doc-sheet-remove]'))
    await click($('[data-doc-sheet-confirm]'))
    await settle()
    expect(saved().sheets.map((s) => s.name)).toEqual(['Sheet1'])
    expect($$('[data-doc-sheet-tab]')).toHaveLength(1)
  })

  it('끝 가까이 스크롤하면 열 26개 · 줄 100개씩 늘린다 — 넓히기만 해서는 저장 · 되돌리기가 안 생긴다', async () => {
    await mountAt('/documents/doc2')
    const ss = await editor()
    const ws = ss.worksheets[0]
    const patch = vi.spyOn(api, 'patchDocument')
    const history = ws.history.length
    /* jsdom 은 크기가 0 이라 어디서 스크롤해도 끝이다. 몰려 와도 한 번만 늘린다 */
    ws.content.dispatchEvent(new Event('scroll'))
    ws.content.dispatchEvent(new Event('scroll'))
    await settle()
    expect(ws.headers).toHaveLength(52)
    expect(ws.headers.slice(25, 28).map((h) => h.textContent)).toEqual(['Z', 'AA', 'AB'])
    expect(ws.rows).toHaveLength(200)
    expect(cell(51, 199)).toBeTruthy()
    expect(patch).not.toHaveBeenCalled()
    expect(useDocumentStore().byId.doc2.rev).toBe(2)
    expect(ws.history).toHaveLength(history)

    /* 늘린 칸에 적으면 그 칸까지가 쓴 범위 */
    ws.setValueFromCoords(27, 150, '먼 칸', true)
    await settle()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(saved().sheets[0].columns).toHaveLength(28)
    expect(saved().sheets[0].data).toHaveLength(151)
    expect(saved().sheets[0].data[150][27]).toBe('먼 칸')
    /* 비우면 다시 줄어든다 */
    ws.setValueFromCoords(27, 150, '', true)
    await settle()
    expect(saved().sheets[0].columns).toHaveLength(3)
    expect(saved().sheets[0].data).toHaveLength(3)
  })

  it('열 · 줄은 엑셀 상한(16,384열 · 1,048,576줄)까지 — 넘으면 더하지 않고 알린다', async () => {
    await mountAt('/documents/doc2')
    const ss = await editor()
    const ws = ss.worksheets[0]
    expect(ws.insertColumn(SHEET_COLUMNS_MAX)).toBe(false)
    expect(ws.headers).toHaveLength(26)
    expect(toast).toHaveBeenCalledWith('시트마다 16,384열까지입니다.')
    expect(ws.insertRow(SHEET_ROWS_MAX)).toBe(false)
    expect(ws.rows).toHaveLength(100)
    ws.insertColumn(1, 0, true)
    await settle()
    expect(saved().sheets[0].columns).toHaveLength(4)
    expect(saved().sheets[0].data[0]).toEqual(['', '항목', '내용', '비고'])
  })

  it('다른 사람이 먼저 고쳤으면 편집기를 잠그고, [다시 불러오기] 는 서버 표로 다시 띄운다', async () => {
    await mountAt('/documents/doc2')
    const ss = await editor()
    const theirs = JSON.parse(JSON.stringify(saved())) as SheetBook
    theirs.sheets[0].data[0][0] = '남이 고친 칸'
    await api.patchDocument('doc2', { rev: 2, sheet: theirs })
    ss.worksheets[0].setValueFromCoords(2, 0, '내 메모', true)
    await settle()
    expect($('[data-doc-stale]')).toBeTruthy()
    expect(ss.worksheets[0].options.editable).toBe(false)
    expect($('[data-doc-sheet-bold]')).toBeNull()

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await click($('[data-doc-reload]'))
    const again = await editor()
    await vi.waitFor(() => expect(cell(0, 0)?.textContent).toBe('남이 고친 칸'))
    expect(cell(2, 0)!.textContent).toBe('비고')
    expect(again.worksheets[0].options.editable).toBe(true)
  })

  it('권한이 없으면 읽기 전용 — 도구 줄 · 가져오기 · 시트 더하기가 숨고 내려받기만', async () => {
    useDocumentStore()
    mockDb().documents.find((d) => d.id === 'doc2')!.partId = 'pt1'
    writeMockSession('u2')
    await useAuthStore().loadMe()
    await mountAt('/documents/doc2')
    const ss = await editor()
    expect(ss.worksheets[0].options.editable).toBe(false)
    expect($('[data-doc-sheet-bold]')).toBeNull()
    expect($('[data-doc-sheet-import]')).toBeNull()
    expect($('[data-doc-sheet-add]')).toBeNull()
    expect($('[data-doc-sheet-download]')).toBeTruthy()
  })
})

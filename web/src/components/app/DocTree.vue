<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  dropTargetForElements,
  draggable,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { TreeItem, TreeRoot, type TreeItemSelectEvent, type TreeItemToggleEvent } from 'reka-ui'
import {
  ChevronRight,
  Ellipsis,
  ExternalLink,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderRoot,
  Loader2,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import DocRemoveDialog from '@/components/app/DocRemoveDialog.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DOC_FOLDER_DEPTH_MAX,
  DOC_FOLDER_NAME_MAX,
  docTree,
  folderChain,
  folderOptions,
  type DocTreeNode,
} from '@/lib/docFolder'
import { DOC_KIND_LABEL } from '@/lib/document'
import { recall, remember } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { useAgendaStore } from '@/stores/agenda'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import type { DocFolder, DocKind, ProjectDocSummary } from '@/types/domain'

/* 문서 트리 — 문서 화면 왼쪽. 폴더 먼저 이름순, 그다음 문서 제목순. 검색 · 종류 · ?agendaId= 로 거르는 중이면
   맞는 문서와 그 위 폴더만 펼쳐 보인다. 볼 파트는 문서만 거르고 폴더는 그대로 둔다(빈 폴더도 만들 자리라서).
   펼침은 사람 · 프로젝트마다 브라우저에 기억한다 (docs/api/document.md '트리 + 상세') */
const props = defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{ (e: 'new-doc', folderId: string | null): void }>()

const route = useRoute()
const router = useRouter()
const data = useDataStore()
const docs = useDocumentStore()
const agendaStore = useAgendaStore()

const query = ref('')
const kindFilter = ref<'all' | DocKind>('all')
const KIND_FILTERS = [
  { value: 'all', label: '모든 종류', icon: Files },
  { value: 'text', label: DOC_KIND_LABEL.text, icon: FileText },
  { value: 'sheet', label: DOC_KIND_LABEL.sheet, icon: FileSpreadsheet },
] as const
const agendaId = computed(() =>
  typeof route.query.agendaId === 'string' && route.query.agendaId ? route.query.agendaId : null,
)
const agendaTitle = computed(
  () => agendaStore.agendas.find((a) => a.id === agendaId.value)?.title ?? '알 수 없는 안건',
)
const filtering = computed(
  () => query.value.trim() !== '' || kindFilter.value !== 'all' || agendaId.value !== null,
)

const shownDocs = computed(() => {
  const q = query.value.trim().toLowerCase()
  return docs.visibleList.filter(
    (d) =>
      (!q || d.title.toLowerCase().includes(q)) &&
      (kindFilter.value === 'all' || d.kind === kindFilter.value) &&
      (!agendaId.value || docs.linksOf(d).some((l) => l.agendaId === agendaId.value)),
  )
})

/* ── 펼침 — 브라우저에 기억 ── */

const openKey = computed(
  () => `innoflow.docFolders.${data.currentMemberId ?? ''}.${data.currentProjectId}`,
)
const opened = ref(new Set<string>())
watch(
  openKey,
  (key) => {
    let ids: string[] = []
    try {
      const value: unknown = JSON.parse(recall(key) ?? '[]')
      if (Array.isArray(value)) ids = value.filter((v): v is string => typeof v === 'string')
    } catch {
      /* 깨진 값은 처음부터 */
    }
    opened.value = new Set(ids)
  },
  { immediate: true },
)
function setOpen(ids: string[], open: boolean) {
  const next = new Set(opened.value)
  for (const id of ids) {
    if (open) next.add(id)
    else next.delete(id)
  }
  if (next.size === opened.value.size && ids.every((id) => opened.value.has(id) === open)) return
  opened.value = next
  remember(openKey.value, JSON.stringify([...next]))
}
function toggle(folderId: string) {
  if (filtering.value) return
  setOpen([folderId], !opened.value.has(folderId))
}

/* 문서를 열면 그 위 폴더를 펼친다 */
watch(
  () => {
    const id = props.selectedId
    const doc = id ? (docs.byId[id] ?? docs.list.find((d) => d.id === id)) : undefined
    return doc ? folderChain(docs.folders, doc.folderId).join('/') : ''
  },
  (chain) => {
    if (chain) setOpen(chain.split('/'), true)
  },
  { immediate: true },
)

const KIND_ICON = { text: FileText, sheet: FileSpreadsheet }
/* 글은 작업 색(파랑), 표는 완료 색(초록) — 다크 모드는 토큰이 맞춘다 */
const KIND_COLOR = { text: 'text-kind-task', sheet: 'text-status-done' }

/* ── 노드 — reka Tree 가 펼친 것만 줄로 편다. 새 폴더 칸도 노드 하나 ── */

type NewNode = { type: 'new'; key: 'new' }
type Node = DocTreeNode | NewNode

type Editing = { mode: 'new'; parentId: string | null } | { mode: 'rename'; folderId: string }
const editing = ref<Editing | null>(null)
const nameDraft = ref('')
const nameProblem = ref<string | null>(null)
const nameBusy = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
/* 칸은 v-for 안에 하나뿐이다 — 배열 ref 대신 함수로 받는다 */
const setNameInput = (el: unknown) => {
  nameInput.value = el instanceof HTMLInputElement ? el : null
}

function findFolderNode(nodes: Node[], folderId: string): DocTreeNode | undefined {
  for (const n of nodes) {
    if (n.type !== 'folder') continue
    if (n.folder.id === folderId) return n
    const inner = findFolderNode(n.children, folderId)
    if (inner) return inner
  }
  return undefined
}

const nodes = computed<Node[]>(() => {
  const tree: Node[] = docTree(docs.folders, shownDocs.value, filtering.value)
  const e = editing.value
  if (e?.mode !== 'new') return tree
  const blank: NewNode = { type: 'new', key: 'new' }
  const parent = e.parentId ? findFolderNode(tree, e.parentId) : undefined
  if (parent?.type === 'folder') (parent.children as Node[]).unshift(blank)
  else tree.unshift(blank)
  return tree
})

const getKey = (n: Node) => n?.key ?? ''
/* 빈 폴더는 잎으로 — 펼침 화살표를 안 그린다 */
const getChildren = (n: Node) =>
  n?.type === 'folder' && n.children.length ? (n.children as Node[]) : undefined

/** 펼친 폴더 — 거르는 중이면 남은 폴더 전부 */
const expandedKeys = computed(() => {
  if (!filtering.value) return [...opened.value].map((id) => `f:${id}`)
  const keys: string[] = []
  const walk = (list: Node[]) => {
    for (const n of list) {
      if (n.type !== 'folder') continue
      keys.push(n.key)
      walk(n.children)
    }
  }
  walk(nodes.value)
  return keys
})

const selectedNode = computed<Node | undefined>(() => {
  const key = `d:${props.selectedId}`
  const walk = (list: Node[]): Node | undefined => {
    for (const n of list) {
      if (n.key === key) return n
      if (n.type === 'folder') {
        const inner = walk(n.children)
        if (inner) return inner
      }
    }
    return undefined
  }
  return props.selectedId ? walk(nodes.value) : undefined
})

const visibleCount = computed(() => nodes.value.filter((n) => n.type !== 'new').length)

/* 줄 — 단계마다 14px. 세로 안내선은 위 단계의 화살표 가운데에 */
const INDENT = 14
const PAD = 6
const rowPad = (level: number) => ({ paddingLeft: `${PAD + (level - 1) * INDENT}px` })
const guideAt = (i: number) => ({ left: `${PAD + (i - 1) * INDENT + 7.5}px` })

/* reka 의 고르기 · 펼치기는 막고 우리가 한다 — 문서는 연다, 폴더는 펼침(기억 · 거르는 중이면 고정) */
function onSelect(ev: TreeItemSelectEvent<Node>, node: Node) {
  ev.preventDefault()
  if (node.type === 'doc') openDoc(node.doc.id)
  else if (node.type === 'folder' && ev.detail.originalEvent.type === 'keydown')
    toggle(node.folder.id)
}
function onToggle(ev: TreeItemToggleEvent<Node>, node: Node) {
  ev.preventDefault()
  if (node.type === 'folder') toggle(node.folder.id)
}

function onItemKeydown(e: KeyboardEvent, node: Node) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'F2' && node.type === 'folder') {
    e.preventDefault()
    void startEdit({ mode: 'rename', folderId: node.folder.id }, node.folder.name)
  }
}

/* ── 새 폴더 · 이름 칸 ── */

async function startEdit(next: Editing, name = '') {
  menuOpen.value = false
  editing.value = next
  nameDraft.value = name
  nameProblem.value = null
  if (next.mode === 'new' && next.parentId) setOpen([next.parentId], true)
  /* 메뉴가 닫히며 포커스 가두기를 풀 때까지 한 번 더 기다린다 */
  await nextTick()
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function cancelEdit() {
  const e = editing.value
  editing.value = null
  nameProblem.value = null
  if (e?.mode === 'rename') void focusRow(`f:${e.folderId}`)
}

async function focusRow(key: string) {
  await nextTick()
  scrollEl.value?.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)?.focus()
}

async function submitName() {
  const e = editing.value
  if (!e || nameBusy.value) return
  nameBusy.value = true
  const got =
    e.mode === 'new'
      ? await docs.createFolder(nameDraft.value, e.parentId)
      : await docs.renameFolder(e.folderId, nameDraft.value)
  nameBusy.value = false
  if (editing.value !== e) return
  if (typeof got === 'string') {
    nameProblem.value = got
    return
  }
  editing.value = null
  nameProblem.value = null
  void focusRow(`f:${got.id}`)
}

/* 칸 안의 키는 트리로 올리지 않는다 — 화살표 · 글자가 줄 이동 · 접기로 새지 않게 */
function onNameKeydown(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    void submitName()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function onNameBlur() {
  /* 아무것도 안 적고 떠나면 그만둔다. 알림이 떠 있으면 그대로 둔다 — 고치거나 Esc */
  if (nameBusy.value || nameProblem.value) return
  if (!nameDraft.value.trim()) cancelEdit()
  else void submitName()
}

const renaming = (node: Node) =>
  node.type === 'folder' &&
  editing.value?.mode === 'rename' &&
  editing.value.folderId === node.folder.id

/* ── 메뉴 — 오른쪽 클릭과 (…) 이 같은 메뉴 하나를 띄운다 ── */

type MenuTarget = { type: 'folder'; folder: DocFolder } | { type: 'doc'; doc: ProjectDocSummary }
const menuOpen = ref(false)
const menuTarget = ref<MenuTarget | null>(null)
const menuKey = computed(() => {
  const t = menuTarget.value
  if (!menuOpen.value || !t) return null
  return t.type === 'folder' ? `f:${t.folder.id}` : `d:${t.doc.id}`
})

/* 줄의 contextmenu 가 트리 전체의 트리거보다 먼저 온다 — 무엇에 띄울지 여기서 정한다 */
function aimMenu(node: Node | null) {
  if (node?.type === 'folder') menuTarget.value = { type: 'folder', folder: node.folder }
  else if (node?.type === 'doc') menuTarget.value = { type: 'doc', doc: node.doc }
  else menuTarget.value = null
}

/** 줄 밖(빈 곳)이면 트리 메뉴 — 새 폴더 · 새 문서 */
function onAreaContextmenu(e: MouseEvent) {
  if (!(e.target instanceof Element) || !e.target.closest('[data-tree-key]')) aimMenu(null)
}

const menuFolder = computed(() =>
  menuTarget.value?.type === 'folder' ? menuTarget.value.folder : null,
)
const menuDoc = computed(() => (menuTarget.value?.type === 'doc' ? menuTarget.value.doc : null))

/* 메뉴 항목 — 템플릿 핸들러 안에선 좁힌 타입이 풀려서 여기서 다시 본다 */
const menuAct = {
  newDoc() {
    if (menuFolder.value) emit('new-doc', menuFolder.value.id)
  },
  newSub() {
    if (menuFolder.value) void startEdit({ mode: 'new', parentId: menuFolder.value.id })
  },
  rename() {
    const f = menuFolder.value
    if (f) void startEdit({ mode: 'rename', folderId: f.id }, f.name)
  },
  removeFolder() {
    if (menuFolder.value) void removeFolder(menuFolder.value)
  },
  open() {
    if (menuDoc.value) openDoc(menuDoc.value.id)
  },
  move(folderId: string | null) {
    if (menuDoc.value) void moveDoc(menuDoc.value, folderId)
  },
  removeDoc() {
    if (menuDoc.value) askRemoveDoc(menuDoc.value)
  },
}

/** (…) — 단추 아래에 같은 메뉴를 띄운다 */
function openMenuAt(e: MouseEvent) {
  const btn = e.currentTarget as HTMLElement
  const r = btn.getBoundingClientRect()
  btn.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left,
      clientY: r.bottom + 4,
    }),
  )
}

const depthOf = (folderId: string) => folderChain(docs.folders, folderId).length

function removeBlock(folder: DocFolder): string | null {
  if (!docs.folderEmpty(folder.id)) return '안에 폴더나 문서가 있어 지울 수 없습니다.'
  if (!docs.canDeleteFolder(folder)) return '만든 사람 · 관리자만 지울 수 있습니다.'
  return null
}

async function removeFolder(folder: DocFolder) {
  if (removeBlock(folder)) return
  if (await docs.removeFolder(folder.id)) {
    setOpen([folder.id], false)
    toast.success(`'${folder.name}' 폴더를 지웠습니다.`)
  }
}

const folderChoices = computed(() => folderOptions(docs.folders))

async function moveDoc(doc: ProjectDocSummary, folderId: string | null) {
  if (doc.folderId === folderId) return
  if ((await docs.setFolder(doc.id, folderId)) && folderId) setOpen([folderId], true)
}

const removeDocId = ref<string | null>(null)
const removeDocOpen = ref(false)
function askRemoveDoc(doc: ProjectDocSummary) {
  removeDocId.value = doc.id
  removeDocOpen.value = true
}
function onDocRemoved(id: string) {
  if (id === props.selectedId) void router.replace({ path: '/documents', query: route.query })
}

/* ── 끌어 옮기기 (pragmatic-drag-and-drop) — 폴더 줄에 놓으면 그 안, 빈 곳 · '최상위' 는 맨 위.
   문서 줄 · 새 폴더 칸도 놓을 자리로 등록해 둔다 — 안 그러면 그 위에서 놓은 것이 바깥(맨 위)으로 샌다 ── */

type DragItem = { type: 'doc' | 'folder'; id: string }
const DRAG_KEY = 'docTreeItem'
const TARGET_KEY = 'docTreeTarget'
const ROOT = 'root'

const dragging = ref<DragItem | null>(null)
const dropAt = ref<string | null>(null)

function dragItemOf(data: Record<string | symbol, unknown>): DragItem | null {
  const v = data[DRAG_KEY] as Partial<DragItem> | undefined
  return v && (v.type === 'doc' || v.type === 'folder') && typeof v.id === 'string'
    ? { type: v.type, id: v.id }
    : null
}
/** 놓을 자리 — 폴더 id, 맨 위는 null, 놓을 자리가 아니면 undefined */
function targetOf(data: Record<string | symbol, unknown>): string | null | undefined {
  if (!(TARGET_KEY in data)) return undefined
  const v = data[TARGET_KEY]
  return typeof v === 'string' ? v : null
}

function canDrop(item: DragItem, target: string | null): boolean {
  if (item.type === 'doc') {
    const doc = docs.list.find((x) => x.id === item.id)
    return !!doc && doc.folderId !== target && docs.canEdit(doc)
  }
  const folder = docs.folders.find((f) => f.id === item.id)
  return !!folder && folder.parentId !== target && docs.folderMoveBlock(item.id, target) === null
}

function canDrag(node: Node | undefined): boolean {
  if (!node || renaming(node)) return false
  if (node.type === 'doc') return docs.canEdit(node.doc)
  return node.type === 'folder'
}

function dragItemFor(node: Node): DragItem | null {
  if (node.type === 'doc') return { type: 'doc', id: node.doc.id }
  if (node.type === 'folder') return { type: 'folder', id: node.folder.id }
  return null
}

/* 끄는 동안 닫힌 폴더 위에 머물면 펼친다 */
const HOVER_OPEN_MS = 600
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let hoverFolder: string | null = null
function hoverOpen(folderId: string | null) {
  if (hoverFolder === folderId) return
  clearTimeout(hoverTimer)
  hoverFolder = folderId
  if (!folderId || filtering.value || opened.value.has(folderId)) return
  hoverTimer = setTimeout(() => setOpen([folderId], true), HOVER_OPEN_MS)
}

async function drop(item: DragItem, target: string | null) {
  if (!canDrop(item, target)) return
  if (item.type === 'doc') await docs.setFolder(item.id, target)
  else await docs.moveFolder(item.id, target)
  if (target) setOpen([target], true)
}

/* 줄마다 붙인다 — 붙인 뒤엔 줄의 지금 노드를 읽는다(노드는 그릴 때마다 새로 생긴다) */
const rowNode = new WeakMap<HTMLElement, Node>()
const rowCleanup = new WeakMap<HTMLElement, () => void>()
const vTreeDnd: Directive<HTMLElement, Node> = {
  mounted(el, binding) {
    rowNode.set(el, binding.value)
    const offDrag = draggable({
      element: el,
      canDrag: () => canDrag(rowNode.get(el)),
      getInitialData: () => {
        const node = rowNode.get(el)
        const item = node ? dragItemFor(node) : null
        return item ? { [DRAG_KEY]: item } : {}
      },
    })
    const offDrop = dropTargetForElements({
      element: el,
      getData: () => {
        const node = rowNode.get(el)
        return node?.type === 'folder' ? { [TARGET_KEY]: node.folder.id } : {}
      },
      canDrop: ({ source }) => dragItemOf(source.data) !== null,
    })
    /* 못 끄는 줄(남의 문서 · 이름 칸)은 draggable 을 끈다 — 칸 안의 글자 고르기가 끌기로 바뀌지 않게 */
    el.draggable = canDrag(binding.value)
    rowCleanup.set(el, () => {
      offDrag()
      offDrop()
    })
  },
  updated(el, binding) {
    rowNode.set(el, binding.value)
    el.draggable = canDrag(binding.value)
  },
  unmounted(el) {
    rowCleanup.get(el)?.()
    rowCleanup.delete(el)
  },
}

const scrollEl = ref<HTMLElement | null>(null)
let offArea: (() => void) | null = null
onMounted(() => {
  const el = scrollEl.value
  if (!el) return
  const offs = [
    dropTargetForElements({
      element: el,
      getData: () => ({ [TARGET_KEY]: null }),
      canDrop: ({ source }) => dragItemOf(source.data) !== null,
    }),
    autoScrollForElements({
      element: el,
      canScroll: ({ source }) => dragItemOf(source.data) !== null,
    }),
    monitorForElements({
      canMonitor: ({ source }) => dragItemOf(source.data) !== null,
      onDragStart: ({ source }) => {
        dragging.value = dragItemOf(source.data)
      },
      onDropTargetChange: ({ source, location }) => {
        const item = dragItemOf(source.data)
        const top = location.current.dropTargets[0]
        const target = top ? targetOf(top.data) : undefined
        dropAt.value =
          item && target !== undefined && canDrop(item, target) ? (target ?? ROOT) : null
        hoverOpen(typeof target === 'string' && target !== item?.id ? target : null)
      },
      onDrop: ({ source, location }) => {
        const item = dragItemOf(source.data)
        const top = location.current.dropTargets[0]
        const target = top ? targetOf(top.data) : undefined
        dragging.value = null
        dropAt.value = null
        hoverOpen(null)
        if (item && target !== undefined) void drop(item, target)
      },
    }),
  ]
  offArea = () => offs.forEach((off) => off())
})
onBeforeUnmount(() => {
  offArea?.()
  clearTimeout(hoverTimer)
})

const isDragged = (node: Node) =>
  !!dragging.value &&
  ((node.type === 'doc' && dragging.value.type === 'doc' && dragging.value.id === node.doc.id) ||
    (node.type === 'folder' &&
      dragging.value.type === 'folder' &&
      dragging.value.id === node.folder.id))

function openDoc(id: string) {
  void router.push({ path: `/documents/${id}`, query: route.query })
}

function clearAgenda() {
  const rest = { ...route.query }
  delete rest.agendaId
  void router.replace({ path: route.path, query: rest })
}
</script>

<template>
  <aside
    class="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar"
    aria-label="문서 트리"
    data-doc-tree
  >
    <div class="flex flex-col gap-1.5 px-2 pt-2.5 pb-2">
      <div class="flex h-7 items-center gap-1 pl-1.5">
        <span class="text-[13px] font-semibold">문서</span>
        <span class="text-xs text-muted-foreground tabular-nums">{{ shownDocs.length }}</span>
        <div class="grow" />
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label="새 폴더"
          title="새 폴더"
          data-doc-folder-new
          @click="startEdit({ mode: 'new', parentId: null })"
        >
          <FolderPlus class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label="새 문서"
          title="새 문서"
          data-doc-new
          @click="emit('new-doc', null)"
        >
          <FilePlus class="size-4" />
        </button>
      </div>
      <label class="relative block">
        <Search
          class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          v-model="query"
          type="search"
          placeholder="문서 제목 찾기"
          aria-label="문서 제목 찾기"
          class="h-7 w-full rounded-md border border-input bg-card pr-2 pl-7 text-[13px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
          data-doc-search
        />
      </label>
      <div class="flex items-center gap-1.5">
        <PartScopeToggle area="document" />
        <div class="grow" />
        <div
          class="flex h-7 items-center gap-px rounded-md border border-input bg-card p-0.5"
          role="group"
          aria-label="종류 거르기"
        >
          <button
            v-for="k in KIND_FILTERS"
            :key="k.value"
            type="button"
            :aria-pressed="kindFilter === k.value"
            :aria-label="k.label"
            :title="k.label"
            :data-doc-kind-filter="k.value"
            :class="
              cn(
                'flex h-full w-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                kindFilter === k.value && 'bg-accent text-foreground',
              )
            "
            @click="kindFilter = k.value"
          >
            <component :is="k.icon" class="size-3.5" />
          </button>
        </div>
      </div>
      <p
        v-if="agendaId"
        class="flex items-center gap-1.5 rounded-md border border-primary/35 bg-brand-soft px-2 py-1 text-xs text-primary"
        data-doc-agenda-filter
      >
        <span class="min-w-0 grow truncate">'{{ agendaTitle }}' 이 실린 문서만</span>
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded hover:bg-primary/10"
          aria-label="안건 거르기 풀기"
          data-doc-agenda-filter-clear
          @click="clearAgenda"
        >
          <X class="size-3" />
        </button>
      </p>
    </div>

    <ContextMenu v-model:open="menuOpen">
      <ContextMenuTrigger as-child>
        <div
          ref="scrollEl"
          class="min-h-0 grow overflow-y-auto border-t border-border px-1.5 pt-1.5 pb-6"
          data-doc-tree-area
          @contextmenu="onAreaContextmenu"
        >
          <p v-if="docs.error" class="px-2 py-3 text-[13px] text-destructive" role="alert">
            {{ docs.error }}
          </p>
          <div
            v-else-if="!docs.loaded && docs.loading"
            class="flex items-center gap-2 px-2 py-3 text-[13px] text-muted-foreground"
          >
            <Loader2 class="size-4 animate-spin" />
            문서를 받는 중입니다.
          </div>

          <template v-else>
            <div
              v-if="dragging"
              :class="
                cn(
                  'mb-1 flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground',
                  dropAt === ROOT && 'border-primary bg-brand-soft text-primary',
                )
              "
              data-doc-tree-root
            >
              <FolderRoot class="size-3.5" />
              최상위로 옮기기
            </div>

            <TreeRoot
              v-slot="{ flattenItems }"
              :items="nodes"
              :get-key="getKey"
              :get-children="getChildren"
              :expanded="expandedKeys"
              :model-value="selectedNode"
              aria-label="폴더 · 문서"
              class="flex flex-col"
            >
              <TreeItem
                v-for="item in flattenItems"
                :key="item._id"
                v-slot="{ isExpanded, isSelected }"
                v-bind="item.bind"
                :data-tree-key="item._id"
                :data-doc-folder="item.value.type === 'folder' ? item.value.folder.id : undefined"
                :data-open="
                  item.value.type === 'folder' ? expandedKeys.includes(item._id) : undefined
                "
                :data-doc-item="item.value.type === 'doc' ? item.value.doc.id : undefined"
                :data-menu="menuKey === item._id ? 'open' : undefined"
                class="group relative outline-none"
                @select="(ev: TreeItemSelectEvent<Node>) => onSelect(ev, item.value)"
                @toggle="(ev: TreeItemToggleEvent<Node>) => onToggle(ev, item.value)"
                @keydown="(ev: KeyboardEvent) => onItemKeydown(ev, item.value)"
                @contextmenu="aimMenu(item.value)"
              >
                <!-- 단계 안내선 -->
                <span
                  v-for="i in item.level - 1"
                  :key="i"
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-y-0 w-px bg-border"
                  :style="guideAt(i)"
                />

                <!-- 새 폴더 칸 -->
                <template v-if="item.value.type === 'new'">
                  <div
                    v-tree-dnd="item.value"
                    class="flex h-7 items-center gap-1.5 pr-1"
                    :style="rowPad(item.level)"
                  >
                    <span class="size-4 shrink-0" />
                    <Folder class="size-4 shrink-0 text-muted-foreground" />
                    <input
                      :ref="setNameInput"
                      v-model="nameDraft"
                      :maxlength="DOC_FOLDER_NAME_MAX"
                      placeholder="새 폴더 이름"
                      aria-label="새 폴더 이름"
                      class="h-6 min-w-0 grow rounded border border-ring bg-card px-1.5 text-[13px] ring-2 ring-ring/20 outline-none"
                      data-doc-folder-name-input
                      @input="nameProblem = null"
                      @keydown="onNameKeydown"
                      @click.stop
                      @contextmenu.stop
                      @blur="onNameBlur"
                    />
                  </div>
                  <p
                    v-if="nameProblem"
                    class="pt-0.5 pr-1 pb-1 text-xs text-destructive"
                    :style="rowPad(item.level + 2)"
                    role="alert"
                    data-doc-folder-problem
                  >
                    {{ nameProblem }}
                  </p>
                </template>

                <!-- 폴더 -->
                <template v-else-if="item.value.type === 'folder'">
                  <div
                    v-tree-dnd="item.value"
                    :class="
                      cn(
                        'relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none group-hover:bg-accent group-focus-visible:ring-1 group-focus-visible:ring-ring/60 group-focus-visible:ring-inset group-data-[menu]:bg-accent',
                        dropAt === item.value.folder.id &&
                          'bg-brand-soft ring-1 ring-primary ring-inset group-hover:bg-brand-soft',
                        isDragged(item.value) && 'opacity-40',
                      )
                    "
                    :style="rowPad(item.level)"
                  >
                    <span
                      class="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                      aria-hidden="true"
                      data-doc-folder-toggle
                    >
                      <ChevronRight
                        v-if="item.hasChildren"
                        class="size-3 transition-transform duration-150"
                        :class="isExpanded && 'rotate-90'"
                      />
                    </span>
                    <component
                      :is="isExpanded ? FolderOpen : Folder"
                      class="size-4 shrink-0 text-muted-foreground"
                    />
                    <input
                      v-if="renaming(item.value)"
                      :ref="setNameInput"
                      v-model="nameDraft"
                      :maxlength="DOC_FOLDER_NAME_MAX"
                      aria-label="폴더 이름"
                      class="h-6 min-w-0 grow rounded border border-ring bg-card px-1.5 text-[13px] ring-2 ring-ring/20 outline-none"
                      data-doc-folder-name-input
                      @input="nameProblem = null"
                      @keydown="onNameKeydown"
                      @click.stop
                      @contextmenu.stop
                      @blur="onNameBlur"
                    />
                    <template v-else>
                      <span class="min-w-0 grow truncate" data-doc-folder-name>{{
                        item.value.folder.name
                      }}</span>
                      <span class="grid shrink-0 place-items-center">
                        <span
                          class="col-start-1 row-start-1 min-w-5 pr-1 text-right text-xs text-muted-foreground tabular-nums group-hover:invisible group-focus-visible:invisible group-data-[menu]:invisible"
                          data-doc-folder-count
                          >{{ item.value.count }}</span
                        >
                        <button
                          type="button"
                          tabindex="-1"
                          aria-haspopup="menu"
                          class="invisible col-start-1 row-start-1 flex size-5 items-center justify-center rounded text-muted-foreground group-hover:visible group-focus-visible:visible group-data-[menu]:visible hover:bg-background hover:text-foreground"
                          :aria-label="`${item.value.folder.name} 메뉴`"
                          data-doc-folder-menu
                          @click.stop="openMenuAt"
                        >
                          <Ellipsis class="size-3.5" />
                        </button>
                      </span>
                    </template>
                  </div>
                  <p
                    v-if="nameProblem && renaming(item.value)"
                    class="pt-0.5 pr-1 pb-1 text-xs text-destructive"
                    :style="rowPad(item.level + 2)"
                    role="alert"
                    data-doc-folder-problem
                  >
                    {{ nameProblem }}
                  </p>
                </template>

                <!-- 문서 -->
                <div
                  v-else
                  v-tree-dnd="item.value"
                  :class="
                    cn(
                      'relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none group-hover:bg-accent group-focus-visible:ring-1 group-focus-visible:ring-ring/60 group-focus-visible:ring-inset group-data-[menu]:bg-accent',
                      isSelected &&
                        'bg-brand-soft font-medium text-foreground group-hover:bg-brand-soft',
                      isDragged(item.value) && 'opacity-40',
                    )
                  "
                  :style="rowPad(item.level)"
                >
                  <span class="size-4 shrink-0" />
                  <component
                    :is="KIND_ICON[item.value.doc.kind]"
                    :class="cn('size-4 shrink-0', KIND_COLOR[item.value.doc.kind])"
                    :aria-label="DOC_KIND_LABEL[item.value.doc.kind]"
                    :data-doc-kind="item.value.doc.kind"
                  />
                  <span class="min-w-0 grow truncate">{{ item.value.doc.title }}</span>
                  <span class="grid shrink-0 place-items-center">
                    <span
                      v-if="docs.changedOf(item.value.doc).length > 0"
                      class="col-start-1 row-start-1 flex items-center gap-1 pr-1 text-xs text-status-warn tabular-nums group-hover:invisible group-focus-visible:invisible group-data-[menu]:invisible"
                      :title="`결정 바뀜 ${docs.changedOf(item.value.doc).length}`"
                      data-doc-changed
                    >
                      <span class="size-1.5 rounded-full bg-status-warn" />
                      {{ docs.changedOf(item.value.doc).length }}
                    </span>
                    <button
                      type="button"
                      tabindex="-1"
                      aria-haspopup="menu"
                      class="invisible col-start-1 row-start-1 flex size-5 items-center justify-center rounded text-muted-foreground group-hover:visible group-focus-visible:visible group-data-[menu]:visible hover:bg-background hover:text-foreground"
                      :aria-label="`${item.value.doc.title} 메뉴`"
                      data-doc-item-menu
                      @click.stop="openMenuAt"
                    >
                      <Ellipsis class="size-3.5" />
                    </button>
                  </span>
                </div>
              </TreeItem>
            </TreeRoot>

            <p
              v-if="visibleCount === 0 && !editing"
              class="px-2 py-6 text-center text-[13px] text-muted-foreground"
              data-doc-tree-empty
            >
              {{
                filtering
                  ? '맞는 문서가 없습니다.'
                  : docs.list.length === 0
                    ? '아직 만든 문서가 없습니다.'
                    : '볼 파트의 문서가 없습니다.'
              }}
            </p>
          </template>
        </div>
      </ContextMenuTrigger>

      <!-- 닫힐 때 트리로 포커스를 돌리면 막 띄운 이름 칸이 blur 로 닫힌다 -->
      <ContextMenuContent class="w-56" @close-auto-focus="(e: Event) => e.preventDefault()">
        <template v-if="menuFolder">
          <ContextMenuItem data-doc-folder-new-doc @select="menuAct.newDoc">
            <FilePlus />
            새 문서
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="depthOf(menuFolder.id) >= DOC_FOLDER_DEPTH_MAX"
            :title="
              depthOf(menuFolder.id) >= DOC_FOLDER_DEPTH_MAX
                ? `폴더는 ${DOC_FOLDER_DEPTH_MAX}단까지입니다.`
                : undefined
            "
            data-doc-folder-new-sub
            @select="menuAct.newSub"
          >
            <FolderPlus />
            하위 폴더
          </ContextMenuItem>
          <ContextMenuItem data-doc-folder-rename @select="menuAct.rename">
            <Pencil />
            이름 바꾸기
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            class="text-destructive focus:text-destructive"
            :disabled="removeBlock(menuFolder) !== null"
            data-doc-folder-remove
            @select="menuAct.removeFolder"
          >
            <Trash2 />
            지우기
          </ContextMenuItem>
          <p
            v-if="removeBlock(menuFolder)"
            class="px-2 pb-1 text-xs text-muted-foreground text-pretty"
            data-doc-folder-remove-reason
          >
            {{ removeBlock(menuFolder) }}
          </p>
        </template>

        <template v-else-if="menuDoc">
          <ContextMenuItem data-doc-item-open @select="menuAct.open">
            <ExternalLink />
            열기
          </ContextMenuItem>
          <ContextMenuSub v-if="docs.canEdit(menuDoc)">
            <ContextMenuSubTrigger data-doc-item-move>
              <FolderInput />
              폴더 옮기기
            </ContextMenuSubTrigger>
            <ContextMenuSubContent class="max-h-72 w-52 overflow-y-auto">
              <ContextMenuItem
                :disabled="menuDoc.folderId === null"
                data-doc-item-move-to="root"
                @select="menuAct.move(null)"
              >
                <FolderRoot class="text-muted-foreground" />
                최상위
              </ContextMenuItem>
              <ContextMenuItem
                v-for="f in folderChoices"
                :key="f.id"
                :disabled="menuDoc.folderId === f.id"
                :style="{ paddingLeft: `${8 + (f.depth - 1) * 12}px` }"
                :data-doc-item-move-to="f.id"
                @select="menuAct.move(f.id)"
              >
                <Folder class="text-muted-foreground" />
                <span class="truncate">{{ f.name }}</span>
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <template v-if="docs.canDelete(menuDoc)">
            <ContextMenuSeparator />
            <ContextMenuItem
              class="text-destructive focus:text-destructive"
              data-doc-item-remove
              @select="menuAct.removeDoc"
            >
              <Trash2 />
              지우기
            </ContextMenuItem>
          </template>
        </template>

        <template v-else>
          <ContextMenuItem
            data-doc-tree-menu-new-folder
            @select="startEdit({ mode: 'new', parentId: null })"
          >
            <FolderPlus />
            새 폴더
          </ContextMenuItem>
          <ContextMenuItem data-doc-tree-menu-new-doc @select="emit('new-doc', null)">
            <FilePlus />
            새 문서
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <DocRemoveDialog
      v-model:open="removeDocOpen"
      :document-id="removeDocId"
      @removed="onDocRemoved"
    />
  </aside>
</template>

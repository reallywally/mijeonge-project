<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  ChevronRight,
  Ellipsis,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderRoot,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DOC_FOLDER_DEPTH_MAX,
  DOC_FOLDER_NAME_MAX,
  docTreeRows,
  folderChain,
  type DocTreeRow,
} from '@/lib/docFolder'
import { DOC_KIND_LABEL } from '@/lib/document'
import { recall, remember } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { useAgendaStore } from '@/stores/agenda'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import type { DocFolder, DocKind } from '@/types/domain'

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

/* ── 줄 — 트리 + 새 폴더 · 이름 칸 ── */

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

type Row = DocTreeRow | { type: 'new'; depth: number }

const rows = computed<Row[]>(() => {
  const tree: Row[] = docTreeRows(docs.folders, shownDocs.value, opened.value, filtering.value)
  const e = editing.value
  if (e?.mode !== 'new') return tree
  if (e.parentId === null) return [{ type: 'new', depth: 0 }, ...tree]
  const at = tree.findIndex((r) => r.type === 'folder' && r.folder.id === e.parentId)
  if (at < 0) return [{ type: 'new', depth: 0 }, ...tree]
  return [
    ...tree.slice(0, at + 1),
    { type: 'new', depth: tree[at].depth + 1 },
    ...tree.slice(at + 1),
  ]
})

const rowKey = (r: Row) =>
  r.type === 'folder' ? `f:${r.folder.id}` : r.type === 'doc' ? `d:${r.doc.id}` : 'new'

const indent = (depth: number) => ({ paddingLeft: `${8 + depth * 16}px` })

async function startEdit(next: Editing, name = '') {
  menuFor.value = null
  editing.value = next
  nameDraft.value = name
  nameProblem.value = null
  if (next.mode === 'new' && next.parentId) setOpen([next.parentId], true)
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function cancelEdit() {
  editing.value = null
  nameProblem.value = null
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
}

function onNameBlur() {
  /* 아무것도 안 적고 떠나면 그만둔다. 알림이 떠 있으면 그대로 둔다 — 고치거나 Esc */
  if (nameBusy.value || nameProblem.value) return
  if (!nameDraft.value.trim()) cancelEdit()
  else void submitName()
}

/* ── 폴더 메뉴(…) ── */

const menuFor = ref<string | null>(null)
/* 다른 폴더의 메뉴를 열면 앞 메뉴의 닫힘이 뒤에 온다 — 제 것일 때만 비운다 */
function setMenu(folderId: string, open: boolean) {
  if (open) menuFor.value = folderId
  else if (menuFor.value === folderId) menuFor.value = null
}
const depthOf = (folderId: string) => folderChain(docs.folders, folderId).length

function removeBlock(folder: DocFolder): string | null {
  if (!docs.folderEmpty(folder.id)) return '안에 폴더나 문서가 있어 지울 수 없습니다.'
  if (!docs.canDeleteFolder(folder)) return '만든 사람 · 관리자만 지울 수 있습니다.'
  return null
}

async function removeFolder(folder: DocFolder) {
  if (removeBlock(folder)) return
  menuFor.value = null
  if (await docs.removeFolder(folder.id)) {
    setOpen([folder.id], false)
    toast.success(`'${folder.name}' 폴더를 지웠습니다.`)
  }
}

function newDocIn(folderId: string) {
  menuFor.value = null
  emit('new-doc', folderId)
}

/* ── 끌어 옮기기 — 문서 · 폴더를 폴더 줄이나 '최상위' 에 놓는다. 못 옮기는 곳은 놓을 자리로 안 받는다 ── */

type Dragging = { type: 'doc' | 'folder'; id: string }
const dragging = ref<Dragging | null>(null)
const dropAt = ref<string | null>(null)
const ROOT = 'root'

function canDrop(target: string | null): boolean {
  const d = dragging.value
  if (!d) return false
  if (d.type === 'doc') {
    const doc = docs.list.find((x) => x.id === d.id)
    return !!doc && doc.folderId !== target && docs.canEdit(doc)
  }
  const folder = docs.folders.find((f) => f.id === d.id)
  return !!folder && folder.parentId !== target && docs.folderMoveBlock(d.id, target) === null
}

function onDragStart(e: DragEvent, item: Dragging) {
  dragging.value = item
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.id)
  }
}

function onDragOver(e: DragEvent, target: string | null) {
  if (!canDrop(target)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropAt.value = target ?? ROOT
}

function onDragLeave(target: string | null) {
  if (dropAt.value === (target ?? ROOT)) dropAt.value = null
}

function onDragEnd() {
  dragging.value = null
  dropAt.value = null
}

async function onDrop(e: DragEvent, target: string | null) {
  const d = dragging.value
  const ok = canDrop(target)
  onDragEnd()
  if (!d || !ok) return
  e.preventDefault()
  if (d.type === 'doc') await docs.setFolder(d.id, target)
  else await docs.moveFolder(d.id, target)
  if (target) setOpen([target], true)
}

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
    <div class="flex flex-col gap-2 border-b border-border px-3 py-3">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold">문서</span>
        <span class="text-xs text-muted-foreground tabular-nums">{{ shownDocs.length }}</span>
        <div class="grow" />
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          aria-label="새 폴더"
          title="새 폴더"
          data-doc-folder-new
          @click="startEdit({ mode: 'new', parentId: null })"
        >
          <FolderPlus class="size-4" />
        </Button>
        <Button size="sm" class="h-7" data-doc-new @click="emit('new-doc', null)">
          <Plus class="size-3.5" />
          새 문서
        </Button>
      </div>
      <label class="relative block">
        <Search
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="query"
          placeholder="문서 제목 찾기"
          class="pl-8"
          aria-label="문서 제목 찾기"
          data-doc-search
        />
      </label>
      <div class="flex items-center gap-2">
        <PartScopeToggle area="document" />
        <Select v-model="kindFilter">
          <SelectTrigger class="h-7 w-[96px] shrink-0 text-xs" aria-label="종류 거르기">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">모든 종류</SelectItem>
            <SelectItem value="text">{{ DOC_KIND_LABEL.text }}</SelectItem>
            <SelectItem value="sheet">{{ DOC_KIND_LABEL.sheet }}</SelectItem>
          </SelectContent>
        </Select>
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

    <div class="min-h-0 grow overflow-y-auto px-2 py-2">
      <p v-if="docs.error" class="px-2 py-3 text-sm text-destructive" role="alert">
        {{ docs.error }}
      </p>
      <div
        v-else-if="!docs.loaded && docs.loading"
        class="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"
      >
        <Loader2 class="size-4 animate-spin" />
        문서를 받는 중입니다.
      </div>

      <template v-else>
        <div
          v-if="dragging"
          class="mb-1 flex h-8 items-center gap-1.5 rounded-md border border-dashed px-2 text-xs text-muted-foreground"
          :class="dropAt === ROOT ? 'border-primary bg-brand-soft text-primary' : 'border-border'"
          data-doc-tree-root
          @dragover="onDragOver($event, null)"
          @dragleave="onDragLeave(null)"
          @drop="onDrop($event, null)"
        >
          <FolderRoot class="size-3.5" />
          최상위로 옮기기
        </div>

        <ul role="tree" aria-label="폴더 · 문서" class="flex flex-col gap-px">
          <template v-for="r in rows" :key="rowKey(r)">
            <li v-if="r.type === 'new'" role="none" class="flex flex-col gap-1 py-0.5">
              <div class="flex items-center gap-1.5 pr-1" :style="indent(r.depth)">
                <span class="size-4 shrink-0" />
                <Folder class="size-4 shrink-0 text-muted-foreground" />
                <input
                  :ref="setNameInput"
                  v-model="nameDraft"
                  :maxlength="DOC_FOLDER_NAME_MAX"
                  placeholder="새 폴더 이름"
                  aria-label="새 폴더 이름"
                  class="h-7 min-w-0 grow rounded-md border border-input bg-card px-2 text-[13px] outline-none focus-visible:border-ring"
                  data-doc-folder-name-input
                  @input="nameProblem = null"
                  @keydown.enter.prevent="submitName"
                  @keydown.esc.prevent="cancelEdit"
                  @blur="onNameBlur"
                />
              </div>
              <p
                v-if="nameProblem"
                class="pr-1 text-xs text-destructive"
                :style="indent(r.depth + 2)"
                role="alert"
                data-doc-folder-problem
              >
                {{ nameProblem }}
              </p>
            </li>

            <li
              v-else-if="r.type === 'folder'"
              role="treeitem"
              :aria-level="r.depth + 1"
              :aria-expanded="r.open"
              :data-doc-folder="r.folder.id"
              :data-open="r.open"
              class="flex flex-col gap-1"
            >
              <div
                :class="
                  cn(
                    'group flex h-8 items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent',
                    dropAt === r.folder.id && 'bg-brand-soft ring-1 ring-primary/50',
                  )
                "
                :style="indent(r.depth)"
                :draggable="editing?.mode !== 'rename' || editing.folderId !== r.folder.id"
                @dragstart="onDragStart($event, { type: 'folder', id: r.folder.id })"
                @dragend="onDragEnd"
                @dragover="onDragOver($event, r.folder.id)"
                @dragleave="onDragLeave(r.folder.id)"
                @drop="onDrop($event, r.folder.id)"
              >
                <button
                  type="button"
                  class="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground"
                  :aria-label="r.open ? `${r.folder.name} 접기` : `${r.folder.name} 펼치기`"
                  data-doc-folder-toggle
                  @click="toggle(r.folder.id)"
                >
                  <ChevronRight
                    class="size-3.5 transition-transform"
                    :class="r.open && 'rotate-90'"
                  />
                </button>
                <component
                  :is="r.open ? FolderOpen : Folder"
                  class="size-4 shrink-0 text-muted-foreground"
                />
                <input
                  v-if="editing?.mode === 'rename' && editing.folderId === r.folder.id"
                  :ref="setNameInput"
                  v-model="nameDraft"
                  :maxlength="DOC_FOLDER_NAME_MAX"
                  aria-label="폴더 이름"
                  class="h-7 min-w-0 grow rounded-md border border-input bg-card px-2 text-[13px] outline-none focus-visible:border-ring"
                  data-doc-folder-name-input
                  @input="nameProblem = null"
                  @keydown.enter.prevent="submitName"
                  @keydown.esc.prevent="cancelEdit"
                  @blur="onNameBlur"
                />
                <template v-else>
                  <button
                    type="button"
                    class="min-w-0 grow truncate text-left"
                    data-doc-folder-name
                    @click="toggle(r.folder.id)"
                  >
                    {{ r.folder.name }}
                  </button>
                  <span
                    class="shrink-0 text-xs text-muted-foreground tabular-nums"
                    data-doc-folder-count
                    >{{ r.count }}</span
                  >
                  <Popover
                    :open="menuFor === r.folder.id"
                    @update:open="(v: boolean) => setMenu(r.folder.id, v)"
                  >
                    <PopoverTrigger as-child>
                      <button
                        type="button"
                        class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                        :aria-label="`${r.folder.name} 메뉴`"
                        data-doc-folder-menu
                      >
                        <Ellipsis class="size-3.5" />
                      </button>
                    </PopoverTrigger>
                    <!-- 닫힐 때 트리거로 포커스를 돌리면 막 띄운 이름 칸이 blur 로 닫힌다 -->
                    <PopoverContent
                      align="start"
                      class="flex w-56 flex-col gap-px p-1"
                      data-doc-folder-menu-list
                      @close-auto-focus="(e: Event) => e.preventDefault()"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        class="justify-start"
                        data-doc-folder-new-doc
                        @click="newDocIn(r.folder.id)"
                      >
                        <FilePlus class="size-3.5" />
                        새 문서
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="justify-start"
                        :disabled="depthOf(r.folder.id) >= DOC_FOLDER_DEPTH_MAX"
                        :title="
                          depthOf(r.folder.id) >= DOC_FOLDER_DEPTH_MAX
                            ? `폴더는 ${DOC_FOLDER_DEPTH_MAX}단까지입니다.`
                            : undefined
                        "
                        data-doc-folder-new-sub
                        @click="startEdit({ mode: 'new', parentId: r.folder.id })"
                      >
                        <FolderPlus class="size-3.5" />
                        하위 폴더
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="justify-start"
                        data-doc-folder-rename
                        @click="startEdit({ mode: 'rename', folderId: r.folder.id }, r.folder.name)"
                      >
                        <Pencil class="size-3.5" />
                        이름 바꾸기
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        class="justify-start text-destructive hover:text-destructive"
                        :disabled="removeBlock(r.folder) !== null"
                        data-doc-folder-remove
                        @click="removeFolder(r.folder)"
                      >
                        <Trash2 class="size-3.5" />
                        지우기
                      </Button>
                      <p
                        v-if="removeBlock(r.folder)"
                        class="px-2 pb-1 text-xs text-muted-foreground text-pretty"
                        data-doc-folder-remove-reason
                      >
                        {{ removeBlock(r.folder) }}
                      </p>
                    </PopoverContent>
                  </Popover>
                </template>
              </div>
              <p
                v-if="nameProblem && editing?.mode === 'rename' && editing.folderId === r.folder.id"
                class="pr-1 text-xs text-destructive"
                :style="indent(r.depth + 2)"
                role="alert"
                data-doc-folder-problem
              >
                {{ nameProblem }}
              </p>
            </li>

            <li
              v-else
              role="treeitem"
              :aria-level="r.depth + 1"
              :aria-selected="r.doc.id === selectedId"
              :data-doc-item="r.doc.id"
              :data-selected="r.doc.id === selectedId"
            >
              <button
                type="button"
                :class="
                  cn(
                    'flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm hover:bg-accent',
                    r.doc.id === selectedId && 'bg-accent font-medium text-foreground',
                  )
                "
                :style="indent(r.depth)"
                :draggable="docs.canEdit(r.doc)"
                @dragstart="onDragStart($event, { type: 'doc', id: r.doc.id })"
                @dragend="onDragEnd"
                @click="openDoc(r.doc.id)"
              >
                <span class="size-4 shrink-0" />
                <component
                  :is="KIND_ICON[r.doc.kind]"
                  class="size-4 shrink-0 text-muted-foreground"
                  :aria-label="DOC_KIND_LABEL[r.doc.kind]"
                  :data-doc-kind="r.doc.kind"
                />
                <span class="min-w-0 grow truncate">{{ r.doc.title }}</span>
                <span
                  v-if="docs.changedOf(r.doc).length > 0"
                  class="flex shrink-0 items-center gap-1 text-xs text-status-warn tabular-nums"
                  :title="`결정 바뀜 ${docs.changedOf(r.doc).length}`"
                  data-doc-changed
                >
                  <span class="size-1.5 rounded-full bg-status-warn" />
                  {{ docs.changedOf(r.doc).length }}
                </span>
              </button>
            </li>
          </template>
        </ul>

        <p
          v-if="rows.length === 0"
          class="px-2 py-6 text-center text-sm text-muted-foreground"
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
  </aside>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  Check,
  ChevronRight,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderRoot,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import AgendaDetailDialog from '@/components/app/AgendaDetailDialog.vue'
import DocAgendaPanel from '@/components/app/DocAgendaPanel.vue'
import DocRemoveDialog from '@/components/app/DocRemoveDialog.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartField from '@/components/app/PartField.vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ApiError, messageOf } from '@/api'
import { dayTime } from '@/lib/date'
import { folderChain, folderOptions } from '@/lib/docFolder'
import {
  agendaNodes,
  appendAgendaRow,
  DOC_KIND_LABEL,
  DOC_READONLY_HINT,
  DOC_TITLE_MAX,
  docTitleProblem,
  emptySheetBook,
  SHEET_ROWS_MAX,
} from '@/lib/document'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import type { JSONContent } from '@tiptap/core'
import type { Agenda, SheetBook } from '@/types/domain'

/* 스프레드시트(Jspreadsheet · 수식 엔진)와 글 편집기(Tiptap)는 크다 — 그 종류의 문서를 열 때만 받는다 */
const DocSheetEditor = defineAsyncComponent(() => import('@/components/app/DocSheetEditor.vue'))
const DocTextEditor = defineAsyncComponent(() => import('@/components/app/DocTextEditor.vue'))

/* 문서 하나 — 문서 화면의 트리 오른쪽. 넓게 편집, 맨 오른쪽 좁게 '연결한 안건'. 제목 · 본문 · 표는 고치면 0.8초 뒤 저장된다(rev 를 싣는다).
   다른 사람이 먼저 고쳤으면(409) 저장을 멈추고 줄을 띄운다 — 내 글은 화면에 남아 복사할 수 있다.
   권한이 없으면 칸을 잠그고 버튼을 숨긴다 (docs/api/document.md '화면') */
const props = defineProps<{ documentId: string }>()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const docs = useDocumentStore()

const documentId = computed(() => props.documentId)
/** 트리로 돌아갈 주소 — ?agendaId= 거르기는 지킨다 */
const listTo = computed(() => ({ path: '/documents', query: route.query }))
const loadState = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const loadError = ref('')
const doc = computed(() => (loadState.value === 'ready' ? docs.byId[documentId.value] : undefined))
const draft = computed(() => (docs.draft?.docId === documentId.value ? docs.draft : null))

async function load(id: string) {
  loadState.value = 'loading'
  try {
    const got = await docs.openDraft(id)
    if (documentId.value !== id) return
    /* 다른 프로젝트의 문서 주소로 들어왔으면 그 프로젝트로 옮긴다 — 연결 안건은 그 프로젝트의 스냅샷에서 읽는다 */
    if (got.projectId !== data.currentProjectId) data.setProject(got.projectId)
    loadState.value = 'ready'
  } catch (e) {
    if (documentId.value !== id) return
    loadState.value = e instanceof ApiError && e.status === 404 ? 'missing' : 'error'
    loadError.value = messageOf(e)
  }
}
watch(documentId, (id) => void load(id), { immediate: true })

/* 보는 중에 위에서 프로젝트를 바꾸면 이 문서는 그 프로젝트의 것이 아니다 — 목록으로 */
watch(
  () => data.currentProjectId,
  (projectId) => {
    if (doc.value && doc.value.projectId !== projectId) void router.replace(listTo.value)
  },
)

const canEdit = computed(() => (doc.value ? docs.canEdit(doc.value) : false))
const canDelete = computed(() => (doc.value ? docs.canDelete(doc.value) : false))
/** 겹침으로 멈췄으면 더 고치지 못하게 잠근다 — 고른 글을 복사할 수는 있다 */
const locked = computed(() => !canEdit.value || docs.saveState === 'stale')

const title = computed({
  get: () => draft.value?.title ?? '',
  set: (v: string) => docs.edit({ title: v }),
})
const content = computed({
  get: () => draft.value?.content ?? '',
  set: (v: string) => docs.edit({ content: v }),
})
const sheet = computed<SheetBook>({
  get: () => draft.value?.sheet ?? emptySheetBook(),
  set: (v) => docs.edit({ sheet: v }),
})
const titleProblem = computed(() => (draft.value ? docTitleProblem(draft.value.title) : null))

const saveLabel = computed(() => {
  switch (docs.saveState) {
    case 'pending':
    case 'saving':
      return '저장 중…'
    case 'error':
      return '저장하지 못했습니다'
    case 'stale':
      return '저장 멈춤'
    default:
      return '저장됨'
  }
})

const textEditor = ref<{ insert: (nodes: JSONContent[]) => void } | null>(null)
const sheetEditor = ref<{
  insertAgenda: (agenda: Agenda) => boolean
  activeSheet: () => number
} | null>(null)

/** [본문에 넣기] — 글은 커서 자리에 제목 + 결정 블록, 표는 지금 보는 시트의 적은 줄 끝에 한 줄 */
function insert(agenda: Agenda) {
  const d = draft.value
  if (!d || !doc.value || locked.value) return
  if (doc.value.kind === 'text') {
    textEditor.value?.insert(agendaNodes(agenda))
    return
  }
  /* 편집기에 넣으면 되돌리기로 뺄 수 있다. 편집기가 아직 안 떴으면 표에 바로 넣는다 */
  if (sheetEditor.value) {
    sheetEditor.value.insertAgenda(agenda)
    return
  }
  const next = appendAgendaRow(d.sheet, 0, agenda)
  if (next) docs.edit({ sheet: next })
  else toast(`시트마다 ${SHEET_ROWS_MAX.toLocaleString('ko-KR')}줄까지입니다.`)
}

async function reload() {
  if (!window.confirm('서버의 문서로 다시 불러올까요? 저장하지 못한 내 글은 사라집니다.')) return
  await docs.reloadDraft()
}

/* 문서 메뉴(…) — 파트 바꾸기 · 폴더 옮기기 · 지우기 */
const menuOpen = ref(false)
function setPart(partId: string | null) {
  if (!doc.value || partId === doc.value.partId) return
  void docs.setPart(doc.value.id, partId)
}
async function setFolder(folderId: string | null) {
  if (!doc.value || folderId === doc.value.folderId) return
  if (await docs.setFolder(doc.value.id, folderId)) menuOpen.value = false
}
const folderChoices = computed(() => folderOptions(docs.folders))
/** 머리의 폴더 경로 — 맨 위부터 */
const crumbs = computed(() => {
  const names = new Map(docs.folders.map((f) => [f.id, f.name] as const))
  return folderChain(docs.folders, doc.value?.folderId ?? null).map((id) => ({
    id,
    name: names.get(id) ?? '',
  }))
})

const removeOpen = ref(false)

/* 떠날 때 — 기다리던 저장은 바로 보낸다. 묻지 않는다 */
onBeforeRouteLeave(() => {
  docs.closeDraft()
  return true
})
onBeforeRouteUpdate((to, from) => {
  if (to.params.documentId !== from.params.documentId) {
    docs.closeDraft()
    /* 안건 상세의 '실린 문서' 로 다른 문서에 왔으면 팝업은 닫는다 */
    agendaDetailId.value = null
  }
  return true
})
onBeforeUnmount(() => {
  if (docs.draft?.docId === documentId.value) docs.closeDraft()
})

/* 새로고침 · 탭 닫기 — 아직 못 보낸 것이 있으면 브라우저가 묻게 한다 */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (docs.saveState === 'pending' || docs.saveState === 'saving') e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

/* 안건 상세 — 이 화면 안에서만 여닫는다 */
const agendaDetailId = ref<string | null>(null)
const agendaOpen = computed({
  get: () => agendaDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) agendaDetailId.value = null
  },
})
</script>

<template>
  <div class="flex min-w-0 grow flex-col overflow-hidden">
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <nav
        class="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground"
        aria-label="폴더 경로"
        data-doc-crumbs
      >
        <span class="shrink-0">문서</span>
        <template v-for="c in crumbs" :key="c.id">
          <ChevronRight class="size-3 shrink-0" />
          <span class="truncate">{{ c.name }}</span>
        </template>
      </nav>
      <div class="grow" />
      <span
        v-if="doc && !canEdit"
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
        data-doc-readonly
      >
        <Lock class="size-3" />
        {{ DOC_READONLY_HINT }}
      </span>
    </div>

    <div
      v-if="loadState === 'loading'"
      class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 class="size-4 animate-spin" />
      문서를 받는 중입니다.
    </div>
    <div v-else-if="!doc || !draft" class="px-6 pt-6">
      <p
        class="rounded-lg border border-border px-[17px] py-3 text-sm text-muted-foreground"
        role="alert"
        data-doc-load-error
      >
        {{
          loadState === 'missing'
            ? '문서를 찾을 수 없습니다. 지워졌거나 볼 수 없는 문서입니다.'
            : loadError
        }}
      </p>
    </div>

    <div v-else class="flex min-h-0 grow">
      <div class="flex min-w-0 grow flex-col gap-4 overflow-y-auto px-6 pt-5 pb-[26px]">
        <header class="flex items-start gap-3">
          <component
            :is="doc.kind === 'text' ? FileText : FileSpreadsheet"
            class="mt-2.5 size-5 shrink-0 text-muted-foreground"
            :aria-label="`${DOC_KIND_LABEL[doc.kind]} 문서`"
          />
          <div class="flex min-w-0 grow flex-col gap-1">
            <input
              v-model="title"
              :readonly="locked"
              :maxlength="DOC_TITLE_MAX"
              aria-label="제목"
              placeholder="제목"
              class="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[22px] font-bold tracking-[-0.025em] outline-none placeholder:text-muted-foreground"
              :class="
                locked
                  ? 'cursor-default'
                  : 'hover:bg-accent focus-visible:border-input focus-visible:bg-background'
              "
              data-doc-title
            />
            <p v-if="titleProblem && canEdit" class="px-1.5 text-xs text-destructive">
              {{ titleProblem }} 제목은 저장하지 않았습니다.
            </p>
            <p
              class="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 text-xs text-muted-foreground"
              data-doc-meta
            >
              <span
                class="inline-flex items-center gap-1"
                :class="docs.saveState === 'error' ? 'text-destructive' : ''"
                :title="docs.saveError ?? undefined"
                data-doc-save-state
              >
                <Loader2
                  v-if="docs.saveState === 'pending' || docs.saveState === 'saving'"
                  class="size-3 animate-spin"
                />
                <Check v-else-if="docs.saveState === 'saved'" class="size-3" />
                {{ saveLabel }}
              </span>
              <span>·</span>
              <span>{{ data.memberName(doc.updatedBy) ?? '알 수 없음' }}</span>
              <span>·</span>
              <span :title="`${dayTime(doc.createdAt)} 만듦`"
                >{{ dayTime(doc.updatedAt) }} 고침</span
              >
              <PartChip :part-id="doc.partId" />
            </p>
          </div>

          <Popover v-if="canEdit || canDelete" v-model:open="menuOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" size="icon" aria-label="문서 메뉴" data-doc-menu>
                <Ellipsis class="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="flex w-64 flex-col gap-2 p-3" data-doc-menu-list>
              <dl v-if="canEdit">
                <PartField
                  :model-value="doc.partId"
                  right="canUpdate"
                  trigger-class="h-8 w-full text-xs"
                  @update:model-value="setPart"
                />
              </dl>
              <div v-if="canEdit" class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">폴더</span>
                <ul
                  class="flex max-h-48 flex-col gap-px overflow-y-auto rounded-md border border-border p-1"
                  role="listbox"
                  aria-label="폴더"
                  data-doc-folder-pick
                >
                  <li>
                    <button
                      type="button"
                      role="option"
                      :aria-selected="doc.folderId === null"
                      class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                      :class="doc.folderId === null ? 'bg-accent font-medium' : ''"
                      data-doc-folder-choice="root"
                      @click="setFolder(null)"
                    >
                      <FolderRoot class="size-3.5 shrink-0 text-muted-foreground" />
                      최상위
                    </button>
                  </li>
                  <li v-for="f in folderChoices" :key="f.id">
                    <button
                      type="button"
                      role="option"
                      :aria-selected="doc.folderId === f.id"
                      class="flex w-full items-center gap-1.5 rounded py-1 pr-1.5 text-left text-xs hover:bg-accent"
                      :class="doc.folderId === f.id ? 'bg-accent font-medium' : ''"
                      :style="{ paddingLeft: `${6 + (f.depth - 1) * 12}px` }"
                      :data-doc-folder-choice="f.id"
                      @click="setFolder(f.id)"
                    >
                      <Folder class="size-3.5 shrink-0 text-muted-foreground" />
                      <span class="truncate">{{ f.name }}</span>
                    </button>
                  </li>
                </ul>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ DOC_KIND_LABEL[doc.kind] }} 문서 ·
                {{ data.memberName(doc.createdBy) ?? '알 수 없음' }} 만듦
              </p>
              <Button
                v-if="canDelete"
                variant="ghost"
                size="sm"
                class="justify-start text-destructive hover:text-destructive"
                data-doc-remove
                @click="((menuOpen = false), (removeOpen = true))"
              >
                <Trash2 class="size-3.5" />
                문서 지우기
              </Button>
            </PopoverContent>
          </Popover>
        </header>

        <div
          v-if="docs.saveState === 'stale'"
          class="flex items-center gap-2.5 rounded-lg border border-status-warn/40 bg-status-warn/10 px-4 py-2.5 text-sm"
          role="alert"
          data-doc-stale
        >
          <TriangleAlert class="size-4 shrink-0 text-status-warn" />
          <span class="grow text-pretty">
            다른 사람이 먼저 고쳤습니다<template v-if="docs.stale?.updatedBy">
              ({{ data.memberName(docs.stale.updatedBy) ?? '알 수 없음'
              }}<template v-if="docs.stale.updatedAt">
                · {{ dayTime(docs.stale.updatedAt) }}</template
              >)</template
            >. 저장을 멈췄습니다 — 내 글은 아래에 남아 있으니 필요하면 복사해 두세요.
          </span>
          <Button variant="outline" size="sm" data-doc-reload @click="reload">
            <RefreshCw class="size-3.5" />
            다시 불러오기
          </Button>
        </div>
        <p
          v-else-if="docs.saveState === 'error'"
          class="text-sm text-destructive"
          role="alert"
          data-doc-save-error
        >
          {{ docs.saveError }} 다시 고치면 다시 저장합니다.
        </p>

        <DocTextEditor
          v-if="doc.kind === 'text'"
          ref="textEditor"
          v-model="content"
          :readonly="locked"
          :title="draft.title.trim() || doc.title"
        />
        <DocSheetEditor
          v-else
          ref="sheetEditor"
          v-model="sheet"
          :readonly="locked"
          :title="draft.title.trim() || doc.title"
        />
      </div>

      <DocAgendaPanel
        :doc="doc"
        :readonly="locked"
        @insert="insert"
        @open-agenda="(id) => (agendaDetailId = id)"
      />
    </div>

    <AgendaDetailDialog v-model:open="agendaOpen" :agenda-id="agendaDetailId" />

    <DocRemoveDialog
      v-model:open="removeOpen"
      :document-id="documentId"
      @removed="router.replace(listTo)"
    />
  </div>
</template>

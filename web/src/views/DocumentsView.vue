<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Search,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import DocCreateDialog from '@/components/app/DocCreateDialog.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import StatusPill from '@/components/app/StatusPill.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayTime } from '@/lib/date'
import { DOC_KIND_LABEL } from '@/lib/document'
import { useDataStore } from '@/stores/data'
import { useDocumentStore } from '@/stores/document'
import { usePartStore } from '@/stores/part'
import type { DocKind } from '@/types/domain'

/* 문서 목록 — 고른 프로젝트의 문서 전부를 받아 여기서 제목 · 종류로, 위 줄의 볼 파트로 거른다(안건처럼 전체로 시작).
   결정 바뀜 n 은 들고 있는 안건의 지금 판으로 센다 (docs/api/document.md '화면') */
const data = useDataStore()
const docs = useDocumentStore()
const partStore = usePartStore()
const router = useRouter()

watch(
  () => data.currentProjectId,
  () => void docs.load(),
  { immediate: true },
)

const titleDraft = ref('')
const query = ref('')
const kindFilter = ref<'all' | DocKind>('all')
const page = ref(1)
const perPage = 10

const filtered = computed(() =>
  docs.visibleList.filter(
    (d) =>
      d.title.includes(query.value) && (kindFilter.value === 'all' || d.kind === kindFilter.value),
  ),
)

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage)))
const current = computed(() => Math.min(page.value, pageCount.value))
const start = computed(() => (current.value - 1) * perPage)
const pageRows = computed(() => filtered.value.slice(start.value, start.value + perPage))
const rangeLabel = computed(() =>
  filtered.value.length === 0
    ? '0건'
    : `총 ${filtered.value.length}건 중 ${start.value + 1}–${start.value + pageRows.value.length}건`,
)

function resetPage() {
  page.value = 1
}
watch(() => partStore.pickedIdsOf('document'), resetPage)

function search() {
  query.value = titleDraft.value.trim()
  resetPage()
}
function resetAll() {
  titleDraft.value = ''
  query.value = ''
  kindFilter.value = 'all'
  resetPage()
}

const KIND_ICON = { text: FileText, sheet: FileSpreadsheet }

function open(id: string) {
  void router.push(`/documents/${id}`)
}

/* 새 문서 — 목록 위 팝업. 만들면 그 문서로 간다 */
const createOpen = ref(false)
function onCreated(id: string) {
  open(id)
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">문서</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
      <div class="grow" />
      <PartScopeToggle area="document" />
    </div>

    <div class="flex min-h-0 grow overflow-y-auto px-6 pt-6">
      <div class="flex w-full flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">문서</h1>
            <p class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              여러 안건에서 정한 것을 주제 하나로 모아 '지금 정해진 모습' 을 한 장으로 적습니다. 글
              문서와 표 문서가 있고, 연결한 안건의 결정이 바뀌면 알려 줍니다.
            </p>
          </div>
          <Button class="shrink-0" data-doc-new @click="createOpen = true">
            <Plus class="size-4" />
            새 문서
          </Button>
        </header>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
          <Input
            v-model="titleDraft"
            placeholder="문서 제목에 들어가는 말"
            class="grow"
            aria-label="문서 제목 찾기"
            data-doc-search
            @keyup.enter="search"
          />
          <span class="shrink-0 text-sm text-muted-foreground">종류</span>
          <Select v-model="kindFilter" @update:model-value="resetPage">
            <SelectTrigger class="w-[112px] shrink-0" aria-label="종류 거르기">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="text">{{ DOC_KIND_LABEL.text }}</SelectItem>
              <SelectItem value="sheet">{{ DOC_KIND_LABEL.sheet }}</SelectItem>
            </SelectContent>
          </Select>
          <Button class="shrink-0" @click="search">
            <Search class="size-4" />
            조회
          </Button>
          <Button variant="outline" class="shrink-0" @click="resetAll">초기화</Button>
        </section>

        <p
          v-if="docs.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ docs.error }}
        </p>

        <div
          v-if="!docs.loaded && docs.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          문서를 받는 중입니다.
        </div>

        <div
          v-else
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead class="h-10 w-[56px] text-xs font-medium text-muted-foreground"
                  >종류</TableHead
                >
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">제목</TableHead>
                <TableHead
                  class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                  >연결 안건</TableHead
                >
                <TableHead class="h-10 w-[120px] text-xs font-medium text-muted-foreground"
                  >결정 바뀜</TableHead
                >
                <TableHead class="h-10 w-[120px] text-xs font-medium text-muted-foreground"
                  >파트</TableHead
                >
                <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                  >고친 사람</TableHead
                >
                <TableHead class="h-10 w-[120px] text-xs font-medium text-muted-foreground"
                  >고친 때</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="d in pageRows"
                :key="d.id"
                class="h-12 cursor-pointer"
                :data-doc-item="d.id"
                @click="open(d.id)"
              >
                <TableCell>
                  <component
                    :is="KIND_ICON[d.kind]"
                    class="size-4 text-muted-foreground"
                    :aria-label="DOC_KIND_LABEL[d.kind]"
                    :data-doc-kind="d.kind"
                  />
                </TableCell>
                <TableCell class="min-w-0">
                  <button
                    type="button"
                    class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                  >
                    {{ d.title }}
                  </button>
                </TableCell>
                <TableCell
                  class="text-right text-sm tabular-nums"
                  :class="docs.linksOf(d).length > 0 ? '' : 'text-muted-foreground'"
                  data-doc-agenda-count
                  >{{ docs.linksOf(d).length }}</TableCell
                >
                <TableCell>
                  <StatusPill v-if="docs.changedOf(d).length > 0" tone="warn" data-doc-changed
                    >결정 바뀜 {{ docs.changedOf(d).length }}</StatusPill
                  >
                </TableCell>
                <TableCell>
                  <PartChip v-if="d.partId" :part-id="d.partId" />
                  <span v-else class="text-sm text-muted-foreground">공통</span>
                </TableCell>
                <TableCell class="text-sm">{{ data.memberName(d.updatedBy) ?? '—' }}</TableCell>
                <TableCell class="text-sm text-muted-foreground">{{
                  dayTime(d.updatedAt)
                }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="7" class="h-[110px] text-center text-sm text-muted-foreground">
                  {{
                    docs.list.length === 0
                      ? '아직 만든 문서가 없습니다.'
                      : '조회 조건에 맞는 문서가 없습니다.'
                  }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex items-center gap-2.5 pb-[26px]">
          <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
          <div class="grow" />
          <Button
            variant="outline"
            size="icon"
            :disabled="current <= 1"
            @click="page = current - 1"
          >
            <ChevronLeft class="size-4" />
          </Button>
          <Button
            v-for="n in pageCount"
            :key="n"
            :variant="n === current ? 'default' : 'outline'"
            size="icon"
            class="text-xs"
            @click="page = n"
          >
            {{ n }}
          </Button>
          <Button
            variant="outline"
            size="icon"
            :disabled="current >= pageCount"
            @click="page = current + 1"
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>

    <DocCreateDialog v-model:open="createOpen" @created="onCreated" />
  </AppShell>
</template>

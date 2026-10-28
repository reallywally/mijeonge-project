<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Download, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import ThreadCreateDialog from '@/components/app/ThreadCreateDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
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
import { partFilterOf } from '@/lib/part'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useThreadStore } from '@/stores/thread'
import type { ThreadRow } from '@/types/domain'

const data = useDataStore()
const threadStore = useThreadStore()
const partStore = usePartStore()
const route = useRoute()
const router = useRouter()

/* 조회 조건 — 제목 · 파트 · 담당자 · 상태. 작업 목록과 같은 자리, 같은 순서다.
   파트 거르기는 [내 파트 | 전체] 로 거른 뒤에 한 번 더 좁힌다 */
const titleDraft = ref('')
const query = ref('')
const stateFilter = ref<'all' | 'queued' | 'open' | 'decided' | 'stuck' | 'overdue'>('all')
const ownerFilter = ref<string>('all')
const partFilter = ref<string>('all')
const page = ref(1)
const perPage = 5

const counts = computed(() => ({
  all: threadStore.visibleRows.length,
  queued: threadStore.visibleRows.filter((r) => r.thread.state === 'queued').length,
  open: threadStore.visibleRows.filter((r) => r.thread.state === 'open').length,
  decided: threadStore.visibleRows.filter((r) => r.thread.state === 'decided').length,
  stuck: threadStore.visibleRows.filter((r) => r.deferCount >= 3).length,
  overdue: threadStore.overdueCount,
}))

const stateChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'queued' as const, label: '대기', n: counts.value.queued },
  { key: 'open' as const, label: '논의중', n: counts.value.open },
  { key: 'decided' as const, label: '결정됨', n: counts.value.decided },
  { key: 'stuck' as const, label: '3번 이상 미뤄짐', n: counts.value.stuck },
  { key: 'overdue' as const, label: '기한 지남', n: counts.value.overdue },
])

function matchesState(row: ThreadRow) {
  if (stateFilter.value === 'all') return true
  if (stateFilter.value === 'stuck') return row.deferCount >= 3
  if (stateFilter.value === 'overdue') return row.overdue
  return row.thread.state === stateFilter.value
}

function matchesOwner(row: ThreadRow) {
  if (ownerFilter.value === 'all') return true
  if (ownerFilter.value === 'none') return row.thread.ownerId === null
  return row.thread.ownerId === ownerFilter.value
}

function matchesPart(row: ThreadRow) {
  if (partFilter.value === 'all') return true
  if (partFilter.value === 'common') return row.thread.partId === null
  return row.thread.partId === partFilter.value
}

const filtered = computed(() =>
  threadStore.visibleRows.filter(
    (r) =>
      r.thread.title.includes(query.value) && matchesState(r) && matchesOwner(r) && matchesPart(r),
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
/* 보기 범위를 바꾸면 줄 수가 달라진다 — 없는 쪽에 머물지 않게 첫 쪽으로 */
watch(() => partStore.scope, resetPage)

/* 파트 관리의 '안건 N건 보기' 로 오면 그 파트로 걸러진 채 연다(?part=). 파트를 받기 전이면 받은 뒤에 맞춘다 */
watch(
  () => [route.query.part, partStore.parts.length] as const,
  ([raw]) => {
    if (raw === undefined) return
    partFilter.value = partFilterOf(raw, partStore.parts)
    resetPage()
  },
  { immediate: true },
)

function search() {
  query.value = titleDraft.value.trim()
  resetPage()
}
function resetAll() {
  titleDraft.value = ''
  query.value = ''
  stateFilter.value = 'all'
  ownerFilter.value = 'all'
  partFilter.value = 'all'
  resetPage()
}
function pickState(key: typeof stateFilter.value) {
  stateFilter.value = key
  resetPage()
}

/* 안건 상세 — 목록을 그대로 두고 그 위에 띄우되, 주소를 갖는다.
   /threads/:id 로 들어오면 그 안건이 열린 채로 시작한다 (새로고침 · 뒤로가기가 산다) */
const detailId = computed(() => (route.params.id as string | undefined) ?? null)
const detailOpen = computed({
  get: () => detailId.value !== null,
  set: (open: boolean) => {
    if (!open) router.push('/threads')
  },
})

function openThread(id: string) {
  router.push(`/threads/${id}`)
}

/* 안건 추가 — 상세와 같은 모양의 팝업. /threads/new 로 주소를 갖는다 (작업 추가와 같은 방식) */
const createOpen = computed({
  get: () => route.path === '/threads/new',
  set: (open: boolean) => {
    if (!open) router.push('/threads')
  },
})

function openCreate() {
  router.push('/threads/new')
}

/* 새 안건이 조회 조건에 걸려 안 보이는 일이 없게 조건을 풀고, 그 안건의 상세로 간다 */
function onCreated(id: string) {
  resetAll()
  openThread(id)
}
</script>

<template>
  <AppShell>
    <template #actions>
      <Button variant="outline" size="icon">
        <Download class="size-4" />
      </Button>
    </template>

    <template #aside>
      <div class="h-px bg-border" />
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-muted-foreground">눈여겨볼 것</div>
        <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            아직 아무 기록이 없는 안건이 {{ counts.queued }}건 있습니다.
          </p>
          <button
            type="button"
            class="min-h-6 text-left text-[12.5px] font-semibold underline-offset-4 hover:underline"
            @click="pickState('queued')"
          >
            그 안건만 보기
          </button>
        </div>
        <div
          class="flex flex-col gap-1.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5"
        >
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            3번 이상 미뤄진 안건이 {{ counts.stuck }}건 있습니다.
          </p>
          <button
            type="button"
            class="min-h-6 text-left text-[12.5px] font-semibold text-destructive underline-offset-4 hover:underline"
            @click="pickState('stuck')"
          >
            그 안건만 보기
          </button>
        </div>
        <div
          class="flex flex-col gap-1.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5"
        >
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            기한이 지난 안건이 {{ counts.overdue }}건 있습니다.
          </p>
          <button
            type="button"
            class="min-h-6 text-left text-[12.5px] font-semibold text-destructive underline-offset-4 hover:underline"
            @click="pickState('overdue')"
          >
            그 안건만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">안건</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
      <div class="grow" />
      <PartScopeToggle />
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">안건</h1>
            <p class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              정해야 할 것을 안건으로 먼저 등록해 두고, 정해지면 무엇을 왜 그렇게 정했는지 남깁니다.
              못 정하면 사유를 달아 미룹니다 — 몇 번 미뤄졌는지가 그대로 보입니다.
            </p>
          </div>
          <Button class="shrink-0" @click="openCreate">
            <Plus class="size-4" />
            안건 추가
          </Button>
        </header>

        <section
          class="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="안건 제목에 들어가는 말"
              class="grow"
              @keyup.enter="search"
            />
            <template v-if="partStore.parts.length > 0">
              <span class="shrink-0 text-sm text-muted-foreground">파트</span>
              <Select v-model="partFilter" @update:model-value="resetPage">
                <SelectTrigger class="w-[132px] shrink-0" aria-label="파트 거르기">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="common">공통</SelectItem>
                  <SelectItem v-for="p in partStore.parts" :key="p.id" :value="p.id">{{
                    p.active ? p.name : `${p.name} (보관)`
                  }}</SelectItem>
                </SelectContent>
              </Select>
            </template>
            <span class="shrink-0 text-sm text-muted-foreground">담당자</span>
            <Select v-model="ownerFilter" @update:model-value="resetPage">
              <SelectTrigger class="w-[132px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">{{
                  data.memberName(m.id)
                }}</SelectItem>
                <SelectItem value="none">미정</SelectItem>
              </SelectContent>
            </Select>
            <Button class="shrink-0" @click="search">
              <Search class="size-4" />
              조회
            </Button>
            <Button variant="outline" class="shrink-0" @click="resetAll">초기화</Button>
          </div>

          <div class="flex items-start gap-2.5">
            <span class="w-[52px] shrink-0 pt-2 text-sm text-muted-foreground">상태</span>
            <div class="flex grow flex-wrap gap-1.5">
              <button
                v-for="c in stateChips"
                :key="c.key"
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors"
                :class="
                  stateFilter === c.key
                    ? 'border-primary/35 bg-brand-soft text-primary'
                    : 'border-border bg-card hover:bg-muted'
                "
                @click="pickState(c.key)"
              >
                {{ c.label }}
                <span
                  :class="stateFilter === c.key ? 'text-primary/70' : 'text-muted-foreground'"
                  >{{ c.n }}</span
                >
              </button>
            </div>
          </div>
        </section>

        <div
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">안건</TableHead>
                <TableHead class="h-10 w-[124px] text-xs font-medium text-muted-foreground"
                  >상태</TableHead
                >
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >담당자</TableHead
                >
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >마지막 기록</TableHead
                >
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >결정 기한</TableHead
                >
                <TableHead class="h-10 w-10 text-right text-xs font-medium text-muted-foreground"
                  >이력</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in pageRows"
                :key="row.thread.id"
                class="h-12 cursor-pointer"
                @click="openThread(row.thread.id)"
              >
                <TableCell class="min-w-0">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="h-[22px] w-1 shrink-0 rounded-full"
                      :class="{
                        'bg-border': row.thread.state === 'queued',
                        'bg-primary': row.thread.state === 'open',
                        'bg-muted-foreground/40': row.thread.state === 'decided',
                      }"
                    />
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                    >
                      {{ row.thread.title }}
                    </button>
                    <PartChip :part-id="row.thread.partId" />
                  </div>
                </TableCell>
                <TableCell>
                  <ThreadStateBadge :state="row.thread.state" :defer-count="row.deferCount" />
                </TableCell>
                <TableCell class="text-sm" :class="row.ownerName ? '' : 'text-muted-foreground'">
                  {{ row.ownerName ?? '미정' }}
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{
                  row.lastEntryLabel
                }}</TableCell>
                <TableCell
                  class="text-sm"
                  :class="row.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'"
                  :title="row.overdue ? '기한 지남' : undefined"
                  >{{ row.dueLabel }}</TableCell
                >
                <TableCell class="text-right text-sm text-muted-foreground">{{
                  row.entryCount
                }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="6" class="h-[110px] text-center text-sm text-muted-foreground">
                  조회 조건에 맞는 안건이 없습니다.
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

    <ThreadDetailDialog v-model:open="detailOpen" :thread-id="detailId" @open-thread="openThread" />

    <ThreadCreateDialog v-model:open="createOpen" @created="onCreated" />
  </AppShell>
</template>

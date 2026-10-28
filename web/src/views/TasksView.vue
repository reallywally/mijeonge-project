<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GanttChartSquare,
  List,
  MessageSquare,
  Plus,
  Search,
  SquareKanban,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import TaskBoard from '@/components/app/TaskBoard.vue'
import TaskCreateDialog from '@/components/app/TaskCreateDialog.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import TaskGantt from '@/components/app/TaskGantt.vue'
import TaskStatusBadge from '@/components/app/TaskStatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { TASK_STATUS_OPTIONS, taskStatusLabel } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'
import type { TaskRow, TaskStatus } from '@/types/domain'

/* 작업 목록 — 안건 목록과 같은 게시판이다. 계층을 펼치지 않고 한 줄에 하나씩 놓고,
   어디에 속했는지는 제목 아래 경로로 적는다. 계층째로 보는 건 간트차트가 맡는다. */
const data = useDataStore()
const taskStore = useTaskStore()
const partStore = usePartStore()
const route = useRoute()
const router = useRouter()

/* 세 탭은 같은 작업을 보는 방식만 다르다. 주소로 가른다 — 기본은 간트다 —
   /tasks(간트) · /tasks?view=list(목록) · /tasks?view=board(칸반). 팝업(/tasks/:id ·
   /tasks/new)에도 이 쿼리를 달고 다녀서, 팝업을 닫으면 열었던 탭으로 돌아간다. */
type TaskView = 'list' | 'gantt' | 'board'
const view = computed<TaskView>(() => {
  const q = route.query.view
  return q === 'board' || q === 'list' ? q : 'gantt'
})
const viewQuery = computed(() => (view.value === 'gantt' ? {} : { view: view.value }))

/* 조회 조건 — 제목 · 파트 · 담당자. 안건 목록과 같은 자리, 같은 순서다. 목록 탭의 것이다.
   파트 거르기는 [내 파트 | 전체] 로 거른 뒤에 한 번 더 좁힌다 */
const titleDraft = ref('')
const query = ref('')
const statusFilter = ref<'all' | TaskStatus | 'undated'>('all')
const ownerFilter = ref<string>('all')
const partFilter = ref<string>('all')
const page = ref(1)
const perPage = 8

const counts = computed(() => ({
  ...taskStore.statusCounts,
  undated: taskStore.undatedCount,
}))

/* 간트 탭 오른쪽에 적는 숫자 — 시안의 '4 / 21 완료' */
const doneLabel = computed(() => `${counts.value.done} / ${counts.value.all} 완료`)

const statusChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'todo' as const, label: '해야 할 일', n: counts.value.todo },
  { key: 'doing' as const, label: '진행 중', n: counts.value.doing },
  { key: 'done' as const, label: '완료', n: counts.value.done },
  { key: 'blocked' as const, label: '막힘', n: counts.value.blocked },
  { key: 'undated' as const, label: '기간 미정', n: counts.value.undated },
])

function matchesStatus(row: TaskRow) {
  if (statusFilter.value === 'all') return true
  if (statusFilter.value === 'undated') return row.undated
  return row.task.status === statusFilter.value
}

function matchesOwner(row: TaskRow) {
  if (ownerFilter.value === 'all') return true
  if (ownerFilter.value === 'none') return row.task.ownerId === null
  return row.task.ownerId === ownerFilter.value
}

function matchesPart(row: TaskRow) {
  if (partFilter.value === 'all') return true
  if (partFilter.value === 'common') return row.task.partId === null
  return row.task.partId === partFilter.value
}

const filtered = computed(() =>
  taskStore.visibleRows.filter(
    (r) =>
      r.task.title.includes(query.value) && matchesStatus(r) && matchesOwner(r) && matchesPart(r),
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

/* 파트 관리의 '작업 N건 보기' 로 오면 그 파트로 걸러진 채 연다(?part=). 파트를 받기 전이면 받은 뒤에 맞춘다 */
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
  statusFilter.value = 'all'
  ownerFilter.value = 'all'
  partFilter.value = 'all'
  resetPage()
}
function pickStatus(key: (typeof statusChips.value)[number]['key']) {
  statusFilter.value = key
  resetPage()
}

/* 작업 상세 · 작업 추가 — 목록을 그대로 두고 그 위에 띄우되, 주소를 갖는다.
   /tasks/:id 로 들어오면 그 작업이 열린 채로 시작한다 (새로고침 · 뒤로가기가 산다) */
const detailId = computed(() => (route.params.id as string | undefined) ?? null)
const detailOpen = computed({
  get: () => detailId.value !== null,
  set: (open: boolean) => {
    if (!open) router.push({ path: '/tasks', query: viewQuery.value })
  },
})

/* 하위 작업 추가로 들어오면 상위 작업이 채워진 채로 열리고, 닫으면 그 상위 작업으로 돌아간다 */
const createParentId = computed(() => (route.query.parent as string | undefined) ?? null)
/* 칸반의 칸마다 있는 '작업 추가' — 그 칸의 상태로 폼이 열린다 */
const createStatus = computed<TaskStatus | null>(() => {
  const value = route.query.status
  return TASK_STATUS_OPTIONS.some((o) => o.value === value) ? (value as TaskStatus) : null
})
const createOpen = computed({
  get: () => route.path === '/tasks/new',
  set: (open: boolean) => {
    if (open) return
    const back = createParentId.value ? `/tasks/${createParentId.value}` : '/tasks'
    router.push({ path: back, query: viewQuery.value })
  },
})

function openTask(id: string) {
  router.push({ path: `/tasks/${id}`, query: viewQuery.value })
}

function openCreate(parentId: string | null = null, status: TaskStatus | null = null) {
  router.push({
    path: '/tasks/new',
    query: {
      ...viewQuery.value,
      ...(parentId ? { parent: parentId } : {}),
      ...(status ? { status } : {}),
    },
  })
}

/* 간트 막대 읽는 법 — 왼쪽에 둔다. 색은 TaskGantt 의 막대와 같은 토큰을 쓴다 */
const barLegend = [
  { label: '묶음 작업 · 자식들의 기간', bar: 'h-2 rounded-full bg-border' },
  { label: '해야 할 일', bar: 'h-3.5 rounded-[4px] border border-border bg-muted' },
  {
    label: '진행 중',
    bar: 'h-3.5 rounded-[4px] border border-status-doing/55 bg-status-doing/15',
  },
  { label: '완료', bar: 'h-3.5 rounded-[4px] bg-status-done' },
  { label: '막힘', bar: 'h-3.5 rounded-[4px] bg-status-blocked' },
  {
    label: '기간 미정 · 막대가 없습니다',
    bar: 'h-3.5 rounded-[4px] border border-dashed border-destructive',
  },
]

/* 여러 줄을 한 번에 — 담당자나 상태를 몰아서 바꾼다 */
const checked = ref<Set<string>>(new Set())
const checkedCount = computed(() => checked.value.size)
const pageAllChecked = computed(
  () => pageRows.value.length > 0 && pageRows.value.every((r) => checked.value.has(r.task.id)),
)

function toggleRow(id: string, on: boolean) {
  const next = new Set(checked.value)
  if (on) next.add(id)
  else next.delete(id)
  checked.value = next
}

function togglePage(on: boolean) {
  const next = new Set(checked.value)
  for (const row of pageRows.value) {
    if (on) next.add(row.task.id)
    else next.delete(row.task.id)
  }
  checked.value = next
}

function bulkStatus(value: string) {
  for (const id of checked.value) taskStore.setStatus(id, value as TaskStatus)
  checked.value = new Set()
}

function bulkOwner(value: string) {
  for (const id of checked.value) taskStore.setOwner(id, value === 'none' ? null : value)
  checked.value = new Set()
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
        <div class="text-xs font-medium text-muted-foreground">
          {{ view === 'gantt' ? '막대 읽는 법' : '눈여겨볼 것' }}
        </div>
        <div
          v-if="view === 'board'"
          class="flex flex-col gap-1.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5"
        >
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            막힘 칸에 있는 작업은 연관 안건이 정해지면 다시 움직입니다. 카드의 안건 배지를 눌러
            안건으로 갑니다.
          </p>
        </div>
        <div
          v-if="view === 'gantt'"
          class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <div v-for="b in barLegend" :key="b.label" class="flex items-center gap-2.5">
            <span class="w-[34px] shrink-0" :class="b.bar" />
            <span class="text-xs text-muted-foreground">{{ b.label }}</span>
          </div>
        </div>
        <div
          v-if="view === 'list'"
          class="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            기간이 아직 안 잡힌 작업이 {{ counts.undated }}건 있습니다. 간트차트에는 막대가
            없습니다.
          </p>
          <button
            type="button"
            class="min-h-6 text-left text-[12.5px] font-semibold underline-offset-4 hover:underline"
            @click="pickStatus('undated')"
          >
            그 작업만 보기
          </button>
        </div>
        <div
          v-if="view === 'list'"
          class="flex flex-col gap-1.5 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2.5"
        >
          <p class="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            안건이 안 정해져서 멈춘 작업이 {{ counts.blocked }}건 있습니다.
          </p>
          <button
            type="button"
            class="min-h-6 text-left text-[12.5px] font-semibold text-destructive underline-offset-4 hover:underline"
            @click="pickStatus('blocked')"
          >
            그 작업만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-6">
      <RouterLink
        :to="{ path: '/tasks', query: { view: 'list' } }"
        class="inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-[13px] transition-colors"
        :class="
          view === 'list'
            ? 'border-primary font-semibold text-foreground [&>svg]:text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        <List class="size-4" />
        목록
      </RouterLink>
      <RouterLink
        :to="{ path: '/tasks' }"
        class="inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-[13px] transition-colors"
        :class="
          view === 'gantt'
            ? 'border-primary font-semibold text-foreground [&>svg]:text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        <GanttChartSquare class="size-4" />
        간트차트
      </RouterLink>
      <RouterLink
        :to="{ path: '/tasks', query: { view: 'board' } }"
        class="inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-[13px] transition-colors"
        :class="
          view === 'board'
            ? 'border-primary font-semibold text-foreground [&>svg]:text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        <SquareKanban class="size-4" />
        칸반보드
      </RouterLink>
      <div class="grow" />
      <PartScopeToggle />
      <span v-if="view === 'list'" class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
      <template v-else>
        <span v-if="view === 'gantt'" class="text-xs text-muted-foreground">{{ doneLabel }}</span>
        <Button size="sm" @click="openCreate()">
          <Plus class="size-4" />
          작업 추가
        </Button>
      </template>
    </div>

    <TaskGantt
      v-if="view === 'gantt'"
      @open-task="openTask"
      @add-task="(parentId) => openCreate(parentId)"
    />

    <TaskBoard
      v-if="view === 'board'"
      @open-task="openTask"
      @add-task="(status) => openCreate(null, status)"
      @open-thread="(id) => router.push(`/threads/${id}`)"
    />

    <div
      v-if="view === 'list'"
      class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]"
    >
      <div class="flex w-full max-w-[1040px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">작업</h1>
            <p class="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              목록 · 간트차트 · 칸반보드는 같은 작업을 보는 방식만 다릅니다. 목록은 계층을 펼치지
              않고 안건 목록처럼 한 줄에 하나씩 놓는 게시판입니다. 어디에 속한 작업인지는 제목 아래
              경로로 보이고, 계층째로 보려면 간트차트로 갑니다.
            </p>
          </div>
          <Button class="shrink-0" @click="openCreate()">
            <Plus class="size-4" />
            작업 추가
          </Button>
        </header>

        <section
          class="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="작업 제목에 들어가는 말"
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
                v-for="c in statusChips"
                :key="c.key"
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors"
                :class="
                  statusFilter === c.key
                    ? 'border-primary/35 bg-brand-soft text-primary'
                    : 'border-border bg-card hover:bg-muted'
                "
                @click="pickStatus(c.key)"
              >
                {{ c.label }}
                <span
                  :class="statusFilter === c.key ? 'text-primary/70' : 'text-muted-foreground'"
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
                <TableHead class="h-10 w-10">
                  <Checkbox
                    :model-value="pageAllChecked"
                    aria-label="이 쪽 전체 선택"
                    @update:model-value="(v) => togglePage(v === true)"
                  />
                </TableHead>
                <TableHead class="h-10 w-[72px] text-xs font-medium text-muted-foreground"
                  >번호</TableHead
                >
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">작업</TableHead>
                <TableHead class="h-10 w-[132px] text-xs font-medium text-muted-foreground"
                  >상태</TableHead
                >
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >담당자</TableHead
                >
                <TableHead class="h-10 w-[124px] text-xs font-medium text-muted-foreground"
                  >기간</TableHead
                >
                <TableHead
                  class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                  >연관 안건</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in pageRows"
                :key="row.task.id"
                class="group h-[52px] cursor-pointer"
                @click="openTask(row.task.id)"
              >
                <TableCell @click.stop>
                  <Checkbox
                    :model-value="checked.has(row.task.id)"
                    :aria-label="`${row.task.title} 선택`"
                    @update:model-value="(v) => toggleRow(row.task.id, v === true)"
                  />
                </TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ row.task.key }}</TableCell>
                <TableCell class="min-w-0">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="h-[22px] w-[3px] shrink-0 rounded-full"
                      :class="{
                        'bg-border': row.task.status === 'todo',
                        'bg-status-doing': row.task.status === 'doing',
                        'bg-status-blocked': row.task.status === 'blocked',
                        'bg-status-done/50': row.task.status === 'done',
                      }"
                    />
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span class="flex min-w-0 items-center gap-2">
                        <span
                          class="truncate text-[13.5px] font-medium group-hover:text-primary"
                          :class="
                            row.task.status === 'done' || partStore.isContextTask(row.task.id)
                              ? 'text-muted-foreground'
                              : ''
                          "
                          >{{ row.task.title }}</span
                        >
                        <PartChip :part-id="row.task.partId" />
                        <span
                          v-if="row.task.commentCount > 0"
                          class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                          :aria-label="`댓글 ${row.task.commentCount}개`"
                          :title="`댓글 ${row.task.commentCount}개`"
                        >
                          <MessageSquare class="size-3" />
                          {{ row.task.commentCount }}
                        </span>
                      </span>
                      <span class="truncate text-xs text-muted-foreground">{{
                        row.pathLabel
                      }}</span>
                    </span>
                  </div>
                </TableCell>
                <TableCell @click.stop>
                  <Select
                    :model-value="row.task.status"
                    @update:model-value="(v) => taskStore.setStatus(row.task.id, v as TaskStatus)"
                  >
                    <SelectTrigger
                      class="h-7 w-auto gap-0.5 rounded-full border-transparent bg-transparent px-0 pr-1 shadow-none hover:border-transparent hover:bg-muted focus:ring-[3px]"
                      :aria-label="`상태 ${taskStatusLabel(row.task.status)}`"
                    >
                      <TaskStatusBadge :status="row.task.status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">해야 할 일</SelectItem>
                      <SelectItem value="doing">진행 중</SelectItem>
                      <SelectItem value="blocked">막힘</SelectItem>
                      <SelectItem value="done">완료</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell class="text-sm" :class="row.ownerName ? '' : 'text-muted-foreground'">
                  {{ row.ownerName ?? '미정' }}
                </TableCell>
                <TableCell
                  class="text-sm"
                  :class="row.undated ? 'text-destructive' : 'text-muted-foreground'"
                >
                  {{ row.undated ? '기간 미정' : row.periodLabel }}
                </TableCell>
                <TableCell class="text-right text-sm text-muted-foreground">
                  {{ row.threadCount === 0 ? '—' : row.threadCount }}
                </TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="7" class="h-[110px] text-center text-sm text-muted-foreground">
                  조회 조건에 맞는 작업이 없습니다.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div
            v-if="checkedCount > 0"
            class="flex items-center gap-2.5 border-t border-border bg-muted/50 px-4 py-2.5"
          >
            <span class="text-sm font-medium">{{ checkedCount }}건 선택</span>
            <Select :model-value="''" @update:model-value="(v) => bulkOwner(String(v))">
              <SelectTrigger class="h-8 w-[150px] bg-background text-xs">
                <span>담당자 바꾸기</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="m in data.assignable" :key="m.id" :value="m.id">{{
                  m.name
                }}</SelectItem>
                <SelectItem value="none">미정</SelectItem>
              </SelectContent>
            </Select>
            <Select :model-value="''" @update:model-value="(v) => bulkStatus(String(v))">
              <SelectTrigger class="h-8 w-[150px] bg-background text-xs">
                <span>상태 바꾸기</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">해야 할 일</SelectItem>
                <SelectItem value="doing">진행 중</SelectItem>
                <SelectItem value="blocked">막힘</SelectItem>
                <SelectItem value="done">완료</SelectItem>
              </SelectContent>
            </Select>
            <button
              type="button"
              class="text-sm text-muted-foreground underline-offset-4 hover:underline"
              @click="checked = new Set()"
            >
              선택 해제
            </button>
          </div>
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

    <TaskDetailDialog
      v-model:open="detailOpen"
      :task-id="detailId"
      @open-task="openTask"
      @open-thread="(id) => router.push(`/threads/${id}`)"
    />

    <TaskCreateDialog
      v-model:open="createOpen"
      :parent-id="createParentId"
      :initial-status="createStatus"
      @created="(id) => openTask(id)"
    />
  </AppShell>
</template>

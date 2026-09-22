<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GanttChartSquare,
  List,
  Plus,
  Search,
  SquareKanban,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
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
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import type { TaskRow, TaskStatus } from '@/types/domain'

/* 작업 목록 — 안건 목록과 같은 게시판이다. 계층을 펼치지 않고 한 줄에 하나씩 놓고,
   어디에 속했는지는 제목 아래 경로로 적는다. 계층째로 보는 건 간트차트가 맡는다. */
const data = useDataStore()
const taskStore = useTaskStore()

/* 조회 조건 — 제목 · 담당자. 안건 목록과 같은 자리, 같은 순서다 */
const titleDraft = ref('')
const query = ref('')
const statusFilter = ref<'all' | TaskStatus | 'undated'>('all')
const ownerFilter = ref<string>('all')
const page = ref(1)
const perPage = 8

const counts = computed(() => ({
  ...taskStore.statusCounts,
  undated: taskStore.undatedCount,
}))

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

const filtered = computed(() =>
  taskStore.rows.filter(
    (r) => r.task.title.includes(query.value) && matchesStatus(r) && matchesOwner(r),
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
function search() {
  query.value = titleDraft.value.trim()
  resetPage()
}
function resetAll() {
  titleDraft.value = ''
  query.value = ''
  statusFilter.value = 'all'
  ownerFilter.value = 'all'
  resetPage()
}
function pickStatus(key: (typeof statusChips.value)[number]['key']) {
  statusFilter.value = key
  resetPage()
}

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
        <div class="text-xs font-medium text-muted-foreground">눈여겨볼 것</div>
        <div
          class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-border bg-card px-[13px] py-3 shadow-sm"
        >
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            기간이 아직 안 잡힌 작업이 {{ counts.undated }}건 있습니다. 간트차트에는 막대가
            없습니다.
          </p>
          <button
            type="button"
            class="min-h-[30px] text-left text-sm font-medium underline-offset-4 hover:underline"
            @click="pickStatus('undated')"
          >
            그 작업만 보기
          </button>
        </div>
        <div
          class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-destructive bg-card px-[13px] py-3 shadow-sm"
        >
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            안건이 안 정해져서 멈춘 작업이 {{ counts.blocked }}건 있습니다.
          </p>
          <button
            type="button"
            class="min-h-[30px] text-left text-sm font-medium text-destructive underline-offset-4 hover:underline"
            @click="pickStatus('blocked')"
          >
            그 작업만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-[46px] shrink-0 items-center gap-1 border-b border-border px-[26px]">
      <span
        class="inline-flex h-[46px] items-center gap-1.5 border-b-2 border-foreground px-3 text-sm font-medium"
      >
        <List class="size-4" />
        목록
      </span>
      <button
        type="button"
        disabled
        class="inline-flex h-[46px] cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-muted-foreground/60"
        title="다음 단계에서 붙습니다"
      >
        <GanttChartSquare class="size-4" />
        간트차트
      </button>
      <button
        type="button"
        disabled
        class="inline-flex h-[46px] cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-muted-foreground/60"
        title="다음 단계에서 붙습니다"
      >
        <SquareKanban class="size-4" />
        칸반보드
      </button>
      <div class="grow" />
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[1040px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">작업</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              목록 · 간트차트 · 칸반보드는 같은 작업을 보는 방식만 다릅니다. 목록은 계층을 펼치지
              않고 안건 목록처럼 한 줄에 하나씩 놓는 게시판입니다. 어디에 속한 작업인지는 제목 아래
              경로로 보이고, 계층째로 보려면 간트차트로 갑니다.
            </p>
          </div>
          <Button class="shrink-0" disabled title="다음 단계에서 붙습니다">
            <Plus class="size-4" />
            작업 추가
          </Button>
        </header>

        <section
          class="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
        >
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="작업 제목에 들어가는 말"
              class="grow bg-background"
              @keyup.enter="search"
            />
            <span class="shrink-0 text-sm text-muted-foreground">담당자</span>
            <Select v-model="ownerFilter" @update:model-value="resetPage">
              <SelectTrigger class="w-[132px] shrink-0 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">{{
                  m.name
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
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors"
                :class="
                  statusFilter === c.key
                    ? 'border-primary bg-primary text-primary-foreground shadow'
                    : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                "
                @click="pickStatus(c.key)"
              >
                {{ c.label }}
                <span
                  :class="
                    statusFilter === c.key ? 'text-primary-foreground/60' : 'text-muted-foreground'
                  "
                  >{{ c.n }}</span
                >
              </button>
            </div>
          </div>
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
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
              <TableRow v-for="row in pageRows" :key="row.task.id" class="h-14">
                <TableCell>
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
                      class="h-[26px] w-1 shrink-0 rounded-full"
                      :class="{
                        'bg-border': row.task.status === 'todo',
                        'bg-primary': row.task.status === 'doing',
                        'bg-destructive': row.task.status === 'blocked',
                        'bg-muted-foreground/40': row.task.status === 'done',
                      }"
                    />
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span
                        class="truncate text-sm"
                        :class="row.task.status === 'done' ? 'text-muted-foreground' : ''"
                        >{{ row.task.title }}</span
                      >
                      <span class="truncate text-xs text-muted-foreground">{{
                        row.pathLabel
                      }}</span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    :model-value="row.task.status"
                    @update:model-value="(v) => taskStore.setStatus(row.task.id, v as TaskStatus)"
                  >
                    <SelectTrigger class="h-8 w-[120px] text-xs">
                      <SelectValue />
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
                <SelectItem v-for="m in data.allMembers" :key="m.id" :value="m.id">{{
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
  </AppShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  GanttChartSquare,
  List,
  ListTree,
  Loader2,
  Plus,
  Search,
  SquareKanban,
  X,
} from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import TestDetailDialog from '@/components/app/TestDetailDialog.vue'
import TestGantt from '@/components/app/TestGantt.vue'
import TestSignalChips from '@/components/app/TestSignalChips.vue'
import TestStatusBadge from '@/components/app/TestStatusBadge.vue'
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
import { kstToday } from '@/lib/date'
import { dueLeftLabel, testStatusLabel } from '@/lib/testcase'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { matchesNowCard, TEST_NOW_CARDS, useTestStore } from '@/stores/test'
import type { TestNowKey } from '@/stores/test'
import type { TestRef, TestRow, TestStatus } from '@/types/domain'

/* 테스트 — 작업과 따로 둔 기능 · 시나리오 테스트. 이 화면의 핵심은 지금의 상황 파악이다:
   맨 위 '지금' 이 무엇을 테스트하고 있나 · 무엇이 오래 걸리나 · 기간이 지난 것을 먼저 보이고,
   그 아래가 게시판 목록(한 줄에 하나, 경로는 제목 아래)이다. 계층째로 보는 건 간트가 맡는다 */
const data = useDataStore()
const auth = useAuthStore()
const testStore = useTestStore()
const route = useRoute()
const router = useRouter()

watch(
  () => [data.currentProjectId, auth.me?.id] as const,
  () => void testStore.load(),
  { immediate: true },
)

/* 두 보기는 같은 테스트를 보는 방식만 다르다 — /tests(목록) · /tests?view=gantt(간트).
   팝업(/tests/:id · /tests/new)에도 이 쿼리를 달고 다녀서, 닫으면 열었던 보기로 돌아간다 */
type TestView = 'list' | 'gantt'
const view = computed<TestView>(() => (route.query.view === 'gantt' ? 'gantt' : 'list'))
const viewQuery = computed(() => (view.value === 'list' ? {} : { view: view.value }))

const today = computed(() => kstToday())

/* '지금' 의 숫자 카드 — 누르면 그 테스트만 거른다. 다시 누르면 푼다 */
const isNowKey = (v: unknown): v is TestNowKey => TEST_NOW_CARDS.some((c) => c.key === v)
const card = ref<TestNowKey | null>(isNowKey(route.query.card) ? route.query.card : null)

function pickCard(key: TestNowKey) {
  card.value = card.value === key ? null : key
  page.value = 1
  /* 간트에서 누르면 거른 목록으로 간다 */
  if (view.value === 'gantt') router.push({ path: '/tests' })
}

/* 조회 조건 — 제목 · 담당자. 작업 목록과 같은 자리 */
const titleDraft = ref('')
const query = ref('')
const ownerFilter = ref<string>('all')
const page = ref(1)
const perPage = 10

function matchesOwner(row: TestRow) {
  if (ownerFilter.value === 'all') return true
  if (ownerFilter.value === 'none') return row.test.ownerId === null
  return row.test.ownerId === ownerFilter.value
}

const filtered = computed(() =>
  testStore.visibleRows.filter(
    (r) =>
      r.test.title.includes(query.value) &&
      matchesOwner(r) &&
      /* 카드는 돌리는 테스트(묶음이 아닌 것)를 센다 — 거를 때도 같다 */
      (card.value === null || (!r.isGroup && matchesNowCard(r, card.value))),
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

function search() {
  query.value = titleDraft.value.trim()
  page.value = 1
}
function resetAll() {
  titleDraft.value = ''
  query.value = ''
  ownerFilter.value = 'all'
  card.value = null
  page.value = 1
}

const cardLabel = computed(() => TEST_NOW_CARDS.find((c) => c.key === card.value)?.label ?? '')

/* 테스트 상세 · 추가 — 목록 위 팝업이되 주소를 갖는다 (새로고침 · 뒤로가기가 산다) */
const detailId = computed(() =>
  route.path === '/tests/new' ? null : ((route.params.id as string | undefined) ?? null),
)
const detailOpen = computed({
  get: () => detailId.value !== null,
  set: (open: boolean) => {
    if (!open) router.push({ path: '/tests', query: viewQuery.value })
  },
})

/* 줄의 + 로 오면 상위가, 작업 · 안건 상세의 [테스트 추가] 로 오면 태그가 채워진 채 열린다 */
const createParentId = computed(() => (route.query.parent as string | undefined) ?? null)
const createRefs = computed<TestRef[]>(() => {
  const refs: TestRef[] = []
  if (typeof route.query.task === 'string') refs.push({ kind: 'task', id: route.query.task })
  if (typeof route.query.thread === 'string') refs.push({ kind: 'thread', id: route.query.thread })
  return refs
})
const createOpen = computed({
  get: () => route.path === '/tests/new',
  set: (open: boolean) => {
    if (open) return
    const back = createParentId.value ? `/tests/${createParentId.value}` : '/tests'
    router.push({ path: back, query: viewQuery.value })
  },
})

function openTest(id: string) {
  router.push({ path: `/tests/${id}`, query: viewQuery.value })
}

function openCreate(parentId: string | null = null) {
  router.push({
    path: '/tests/new',
    query: { ...viewQuery.value, ...(parentId ? { parent: parentId } : {}) },
  })
}

const refChips = (row: TestRow) => row.test.refs.map(testStore.refChip)

const daysLabel = (row: TestRow) =>
  row.isGroup ? '—' : row.test.statusDays === 0 ? '오늘부터' : `${row.test.statusDays}일째`

/* 상태 막대 색 — 작업 목록의 왼쪽 띠와 같은 자리 */
const STRIPE: Record<TestStatus, string> = {
  draft: 'bg-border',
  ready: 'bg-border',
  testing: 'bg-primary',
  pass: 'bg-muted-foreground/40',
  fail: 'bg-destructive',
  blocked: 'bg-destructive',
}

/* 간트 막대 읽는 법 — 색은 GanttChart 의 막대와 같은 토큰을 쓴다 */
const barLegend = [
  { label: '묶음 · 하위 테스트의 기간', bar: 'h-2 rounded-full bg-border' },
  { label: '테스트 중', bar: 'h-4 rounded-sm border border-primary bg-secondary' },
  { label: '성공', bar: 'h-4 rounded-sm bg-primary' },
  { label: '실패 · 막힘', bar: 'h-4 rounded-sm bg-destructive' },
  {
    label: '기간 지남 · 오래 걸림',
    bar: 'h-4 rounded-sm border-2 border-destructive bg-secondary',
  },
]

const STATUS_ORDER: TestStatus[] = ['draft', 'ready', 'testing', 'pass', 'fail', 'blocked']
</script>

<template>
  <AppShell>
    <template #aside>
      <div class="h-px bg-border" />
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-muted-foreground">
          {{ view === 'gantt' ? '막대 읽는 법' : '전체 숫자' }}
        </div>
        <div
          v-if="view === 'gantt'"
          class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[13px] py-3 shadow-sm"
        >
          <div v-for="b in barLegend" :key="b.label" class="flex items-center gap-2.5">
            <span class="w-[34px] shrink-0" :class="b.bar" />
            <span class="text-xs text-muted-foreground">{{ b.label }}</span>
          </div>
        </div>
        <dl
          v-else
          class="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-[13px] py-3 text-xs shadow-sm"
          data-test-totals
        >
          <div class="flex justify-between">
            <dt class="text-muted-foreground">테스트</dt>
            <dd class="font-medium">{{ testStore.totals.all }}건</dd>
          </div>
          <div v-for="s in STATUS_ORDER" :key="s" class="flex justify-between">
            <dt class="text-muted-foreground">{{ testStatusLabel(s) }}</dt>
            <dd>{{ testStore.totals.byStatus[s] }}</dd>
          </div>
          <div class="flex justify-between border-t border-border pt-1.5">
            <dt class="text-muted-foreground">태그 없는 테스트</dt>
            <dd>{{ testStore.totals.untagged }}</dd>
          </div>
        </dl>
      </div>
    </template>

    <div class="flex h-[46px] shrink-0 items-center gap-1 border-b border-border px-[26px]">
      <RouterLink
        :to="{ path: '/tests' }"
        class="inline-flex h-[46px] items-center gap-1.5 border-b-2 px-3 text-sm"
        :class="
          view === 'list'
            ? 'border-foreground font-medium'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        <List class="size-4" />
        목록
      </RouterLink>
      <RouterLink
        :to="{ path: '/tests', query: { view: 'gantt' } }"
        class="inline-flex h-[46px] items-center gap-1.5 border-b-2 px-3 text-sm"
        :class="
          view === 'gantt'
            ? 'border-foreground font-medium'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
      >
        <GanttChartSquare class="size-4" />
        간트차트
      </RouterLink>
      <div class="grow" />
      <PartScopeToggle />
      <span v-if="view === 'list'" class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
      <Button v-else size="sm" @click="openCreate()">
        <Plus class="size-4" />
        테스트 추가
      </Button>
    </div>

    <!-- 간트 위에도 '지금' 숫자는 한 줄로 — 누르면 거른 목록으로 간다 -->
    <div
      v-if="view === 'gantt'"
      class="flex shrink-0 items-center gap-2 border-b border-border px-[26px] py-2"
      data-test-now-strip
    >
      <span class="text-xs font-medium text-muted-foreground">지금</span>
      <button
        v-for="c in TEST_NOW_CARDS"
        :key="c.key"
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs hover:bg-accent"
        @click="pickCard(c.key)"
      >
        {{ c.label }}
        <span
          class="font-medium"
          :class="c.key !== 'testing' && testStore.nowCounts[c.key] > 0 ? 'text-destructive' : ''"
          >{{ testStore.nowCounts[c.key] }}</span
        >
      </button>
    </div>

    <TestGantt v-if="view === 'gantt'" @open-test="openTest" @add-test="openCreate" />

    <div
      v-if="view === 'list'"
      class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]"
    >
      <!-- 내용이 화면보다 길다 — 늘이지 않고(self-start) 바깥이 스크롤한다. 늘이면 표가 눌려 잘린다 -->
      <div class="flex w-full max-w-[1180px] flex-col gap-4 self-start">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">테스트</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              지금 무엇을 테스트하고 있는지, 무엇이 오래 걸리는지, 기간이 지난 것이 무엇인지를 먼저
              봅니다. 목록은 한 줄에 하나씩 놓는 게시판이고, 묶음째로 보려면 간트차트로 갑니다.
            </p>
          </div>
          <Button class="shrink-0" @click="openCreate()">
            <Plus class="size-4" />
            테스트 추가
          </Button>
        </header>

        <p
          v-if="testStore.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ testStore.error }}
        </p>

        <div
          v-if="!testStore.loaded && testStore.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          테스트를 받는 중입니다.
        </div>

        <template v-else>
          <!-- 지금 -->
          <section class="flex flex-col gap-3" aria-label="지금" data-test-now>
            <div class="grid grid-cols-6 gap-2.5">
              <button
                v-for="c in TEST_NOW_CARDS"
                :key="c.key"
                type="button"
                class="flex flex-col gap-1 rounded-lg border bg-card px-[15px] py-3 text-left shadow-sm transition-colors hover:bg-accent"
                :class="card === c.key ? 'border-primary ring-1 ring-primary' : 'border-border'"
                :aria-pressed="card === c.key"
                :data-test-now-card="c.key"
                @click="pickCard(c.key)"
              >
                <span class="text-xs text-muted-foreground">{{ c.label }}</span>
                <span
                  class="text-2xl font-semibold tracking-tight"
                  :class="
                    c.key !== 'testing' && testStore.nowCounts[c.key] > 0 ? 'text-destructive' : ''
                  "
                  data-card-value
                  >{{ testStore.nowCounts[c.key] }}</span
                >
              </button>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="flex min-w-0 flex-col gap-2">
                <div class="flex items-baseline gap-2">
                  <span class="text-sm font-medium">지금 테스트 중</span>
                  <span class="text-xs text-muted-foreground"
                    >{{ testStore.testingNow.length }}건 · 오래된 것부터</span
                  >
                </div>
                <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="h-9 text-xs font-medium text-muted-foreground"
                          >테스트</TableHead
                        >
                        <TableHead class="h-9 w-[64px] text-xs font-medium text-muted-foreground"
                          >담당</TableHead
                        >
                        <TableHead class="h-9 w-[64px] text-xs font-medium text-muted-foreground"
                          >며칠째</TableHead
                        >
                        <TableHead class="h-9 w-[84px] text-xs font-medium text-muted-foreground"
                          >기간</TableHead
                        >
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow
                        v-for="r in testStore.testingNow"
                        :key="r.test.id"
                        class="cursor-pointer"
                        :data-test-testing="r.test.id"
                        @click="openTest(r.test.id)"
                      >
                        <TableCell class="min-w-0 py-2">
                          <span class="flex min-w-0 items-center gap-1.5 text-sm">
                            <span class="shrink-0 text-xs text-muted-foreground">{{
                              r.test.key
                            }}</span>
                            <span class="truncate">{{ r.test.title }}</span>
                          </span>
                        </TableCell>
                        <TableCell
                          class="text-sm"
                          :class="r.ownerName ? '' : 'text-muted-foreground'"
                          >{{ r.ownerName ?? '미정' }}</TableCell
                        >
                        <TableCell
                          class="text-sm"
                          :class="r.signals.includes('longRunning') ? 'text-destructive' : ''"
                          >{{ daysLabel(r) }}</TableCell
                        >
                        <TableCell
                          class="text-xs"
                          :class="
                            r.signals.includes('overdue')
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          "
                          >{{ dueLeftLabel(r.test.due, today) }}</TableCell
                        >
                      </TableRow>
                      <TableRow
                        v-if="testStore.testingNow.length === 0"
                        class="hover:bg-transparent"
                      >
                        <TableCell
                          colspan="4"
                          class="h-16 text-center text-sm text-muted-foreground"
                        >
                          지금 테스트 중인 것이 없습니다.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div class="flex min-w-0 flex-col gap-2">
                <div class="flex items-baseline gap-2">
                  <span class="text-sm font-medium">손쓸 테스트</span>
                  <span class="text-xs text-muted-foreground"
                    >{{ testStore.attention.length }}건 · 기간 지남 · 오래 막힘 · 오래 걸림 순</span
                  >
                </div>
                <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="h-9 text-xs font-medium text-muted-foreground"
                          >테스트</TableHead
                        >
                        <TableHead class="h-9 w-[96px] text-xs font-medium text-muted-foreground"
                          >상태</TableHead
                        >
                        <TableHead class="h-9 w-[64px] text-xs font-medium text-muted-foreground"
                          >담당</TableHead
                        >
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow
                        v-for="r in testStore.attention"
                        :key="r.test.id"
                        class="cursor-pointer"
                        :data-test-attention="r.test.id"
                        @click="openTest(r.test.id)"
                      >
                        <TableCell class="min-w-0 py-2">
                          <span class="flex min-w-0 items-center gap-1.5 text-sm">
                            <span class="shrink-0 text-xs text-muted-foreground">{{
                              r.test.key
                            }}</span>
                            <span class="truncate">{{ r.test.title }}</span>
                          </span>
                          <TestSignalChips class="mt-1" :signals="r.signals" />
                        </TableCell>
                        <TableCell class="text-xs">
                          <span class="flex flex-col gap-0.5">
                            <span>{{ testStatusLabel(r.status) }}</span>
                            <span class="text-muted-foreground">{{ daysLabel(r) }}</span>
                          </span>
                        </TableCell>
                        <TableCell
                          class="text-sm"
                          :class="r.ownerName ? '' : 'text-muted-foreground'"
                          >{{ r.ownerName ?? '미정' }}</TableCell
                        >
                      </TableRow>
                      <TableRow
                        v-if="testStore.attention.length === 0"
                        class="hover:bg-transparent"
                      >
                        <TableCell
                          colspan="3"
                          class="h-16 text-center text-sm text-muted-foreground"
                        >
                          손쓸 테스트가 없습니다.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </section>

          <section
            class="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
              <Input
                v-model="titleDraft"
                placeholder="테스트 제목에 들어가는 말"
                class="grow bg-background"
                @keyup.enter="search"
              />
              <span class="shrink-0 text-sm text-muted-foreground">담당자</span>
              <Select v-model="ownerFilter" @update:model-value="page = 1">
                <SelectTrigger class="w-[132px] shrink-0 bg-background" aria-label="담당자 거르기">
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
            <div v-if="card" class="flex items-center gap-2 text-sm" data-test-card-filter>
              <span class="text-muted-foreground">지금 카드로 거름</span>
              <button
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-primary-foreground"
                @click="card = null"
              >
                {{ cardLabel }}
                <X class="size-3" />
              </button>
            </div>
          </section>

          <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="h-10 w-[72px] text-xs font-medium text-muted-foreground"
                    >번호</TableHead
                  >
                  <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                    >테스트</TableHead
                  >
                  <TableHead class="h-10 w-[150px] text-xs font-medium text-muted-foreground"
                    >태그</TableHead
                  >
                  <TableHead class="h-10 w-[88px] text-xs font-medium text-muted-foreground"
                    >상태</TableHead
                  >
                  <TableHead class="h-10 w-[64px] text-xs font-medium text-muted-foreground"
                    >며칠째</TableHead
                  >
                  <TableHead class="h-10 w-[132px] text-xs font-medium text-muted-foreground"
                    >신호</TableHead
                  >
                  <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                    >기간</TableHead
                  >
                  <TableHead class="h-10 w-[64px] text-xs font-medium text-muted-foreground"
                    >담당</TableHead
                  >
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="row in pageRows"
                  :key="row.test.id"
                  class="group h-14 cursor-pointer"
                  :data-test-row="row.test.id"
                  @click="openTest(row.test.id)"
                >
                  <TableCell class="text-xs text-muted-foreground">{{ row.test.key }}</TableCell>
                  <TableCell class="min-w-0">
                    <div class="flex items-center gap-2.5">
                      <span
                        class="h-[26px] w-1 shrink-0 rounded-full"
                        :class="STRIPE[row.status]"
                      />
                      <span class="flex min-w-0 flex-col gap-0.5">
                        <span class="flex min-w-0 items-center gap-2">
                          <span
                            class="truncate text-sm underline-offset-4 group-hover:underline"
                            :class="
                              row.status === 'pass' || testStore.isContext(row.test.id)
                                ? 'text-muted-foreground'
                                : ''
                            "
                            >{{ row.test.title }}</span
                          >
                          <PartChip :part-id="row.test.partId" />
                        </span>
                        <span class="truncate text-xs text-muted-foreground">{{
                          row.pathLabel
                        }}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span v-if="row.test.refs.length" class="flex flex-wrap gap-1">
                      <span
                        v-for="c in refChips(row)"
                        :key="`${c.ref.kind}:${c.ref.id}`"
                        class="inline-flex max-w-[140px] items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs"
                        :class="c.missing ? 'text-muted-foreground' : ''"
                        :title="c.title"
                      >
                        <component
                          :is="c.ref.kind === 'task' ? SquareKanban : ListTree"
                          class="size-3 shrink-0 text-muted-foreground"
                        />
                        <span class="truncate">{{ c.label }}</span>
                      </span>
                    </span>
                    <span v-else class="text-sm text-muted-foreground">—</span>
                  </TableCell>
                  <TableCell><TestStatusBadge :status="row.status" /></TableCell>
                  <TableCell class="text-xs text-muted-foreground">{{ daysLabel(row) }}</TableCell>
                  <TableCell><TestSignalChips :signals="row.signals" :max="2" /></TableCell>
                  <TableCell
                    class="text-xs"
                    :class="
                      row.signals.includes('overdue') && !row.isGroup
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    "
                    >{{ row.periodLabel || '기간 미정' }}</TableCell
                  >
                  <TableCell class="text-sm" :class="row.ownerName ? '' : 'text-muted-foreground'">
                    {{ row.ownerName ?? '미정' }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                  <TableCell
                    colspan="8"
                    class="h-[110px] text-center text-sm text-muted-foreground"
                  >
                    {{
                      testStore.tests.length === 0
                        ? '아직 테스트가 없습니다. [테스트 추가] 로 첫 테스트를 적습니다.'
                        : '조회 조건에 맞는 테스트가 없습니다.'
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
        </template>
      </div>
    </div>

    <TestDetailDialog
      v-model:open="detailOpen"
      :test-id="detailId"
      @open-test="openTest"
      @open-task="(id) => router.push(`/tasks/${id}`)"
      @open-thread="(id) => router.push(`/threads/${id}`)"
    />

    <TestDetailDialog
      v-model:open="createOpen"
      :test-id="null"
      :initial-parent-id="createParentId"
      :initial-refs="createRefs"
      @open-test="openTest"
      @open-task="(id) => router.push(`/tasks/${id}`)"
      @open-thread="(id) => router.push(`/threads/${id}`)"
      @created="openTest"
    />
  </AppShell>
</template>

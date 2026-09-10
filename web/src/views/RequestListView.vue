<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Download, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import RequestDetailDialog from '@/components/app/RequestDetailDialog.vue'
import RequestKindLabel from '@/components/app/RequestKindLabel.vue'
import RequestSpecBadge from '@/components/app/RequestSpecBadge.vue'
import RequestStateBadge from '@/components/app/RequestStateBadge.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { RequestKind, RequestRow } from '@/types/domain'

const store = useMijeongeStore()

/* 어느 요청을 볼 것인가 — 실제로 제일 많이 열릴 곳은 "내게 온 요청"이다 */
const scope = ref<'all' | 'mine' | 'sent'>('all')

/* 조회 조건 — 제목 · 담당자 · 진행 · 종류. 안건 목록과 같은 자리, 같은 순서다. */
const titleDraft = ref('')
const query = ref('')
const stateFilter = ref<'all' | 'todo' | 'doing' | 'done' | 'unspecced'>('all')
const kindFilter = ref<'all' | RequestKind>('all')
const assigneeFilter = ref<string>('all')
const page = ref(1)
const perPage = 5

const me = computed(() => store.currentMemberId)

function inScope(row: RequestRow) {
  if (scope.value === 'mine') return row.request.assigneeId === me.value
  if (scope.value === 'sent') return row.request.requesterId === me.value
  return true
}

const scoped = computed(() => store.requestRows.filter(inScope))

const scopeTabs = computed(() => [
  { key: 'all' as const, label: '전체 요청', n: store.requestRows.length },
  { key: 'mine' as const, label: '내게 온 요청', n: store.requestRows.filter((r) => r.request.assigneeId === me.value).length },
  { key: 'sent' as const, label: '내가 보낸 요청', n: store.requestRows.filter((r) => r.request.requesterId === me.value).length },
])

const counts = computed(() => ({
  all: scoped.value.length,
  todo: scoped.value.filter((r) => r.request.state === 'todo').length,
  doing: scoped.value.filter((r) => r.request.state === 'doing').length,
  done: scoped.value.filter((r) => r.request.state === 'done').length,
  unspecced: scoped.value.filter((r) => r.specState !== 'confirmed').length,
  data: scoped.value.filter((r) => r.request.kind === 'data').length,
  check: scoped.value.filter((r) => r.request.kind === 'check').length,
  etc: scoped.value.filter((r) => r.request.kind === 'etc').length,
}))

const stateChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'todo' as const, label: '요청됨', n: counts.value.todo },
  { key: 'doing' as const, label: '하는 중', n: counts.value.doing },
  { key: 'done' as const, label: '완료', n: counts.value.done },
  { key: 'unspecced' as const, label: '내용 정리 중', n: counts.value.unspecced },
])

const kindChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'data' as const, label: '데이터 정리', n: counts.value.data },
  { key: 'check' as const, label: '확인', n: counts.value.check },
  { key: 'etc' as const, label: '기타', n: counts.value.etc },
])

function matchesState(row: RequestRow) {
  if (stateFilter.value === 'all') return true
  if (stateFilter.value === 'unspecced') return row.specState !== 'confirmed'
  return row.request.state === stateFilter.value
}

function matchesAssignee(row: RequestRow) {
  if (assigneeFilter.value === 'all') return true
  if (assigneeFilter.value === 'none') return row.request.assigneeId === null
  return row.request.assigneeId === assigneeFilter.value
}

const filtered = computed(() =>
  scoped.value.filter(
    (r) =>
      r.request.title.includes(query.value) &&
      matchesState(r) &&
      matchesAssignee(r) &&
      (kindFilter.value === 'all' || r.request.kind === kindFilter.value),
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

/* 눈여겨볼 것 — 요청이 멈추는 두 자리 */
const asideCounts = computed(() => ({
  unspecced: store.requestRows.filter((r) => r.specState !== 'confirmed' && r.request.state !== 'done').length,
  idle: store.requestRows.filter((r) => r.request.state === 'todo' && r.commentCount === 0).length,
}))

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
  stateFilter.value = 'all'
  kindFilter.value = 'all'
  assigneeFilter.value = 'all'
  resetPage()
}
function pickScope(key: typeof scope.value) {
  scope.value = key
  resetPage()
}
function pickState(key: typeof stateFilter.value) {
  stateFilter.value = key
  resetPage()
}
function pickKind(key: typeof kindFilter.value) {
  kindFilter.value = key
  resetPage()
}
function showUnspecced() {
  scope.value = 'all'
  resetAll()
  stateFilter.value = 'unspecced'
}
function showIdle() {
  scope.value = 'all'
  resetAll()
  stateFilter.value = 'todo'
}

/* 요청 상세 — 목록을 그대로 두고 그 위에 띄운다 */
const detailId = ref<string | null>(null)
const detailOpen = ref(false)

function openRequest(id: string) {
  detailId.value = id
  detailOpen.value = true
}

/* 요청을 안건으로 올렸을 때 그 안건 이력으로 넘어간다 */
const threadId = ref<string | null>(null)
const threadOpen = ref(false)

function openThread(id: string) {
  detailOpen.value = false
  threadId.value = id
  threadOpen.value = true
}

/* 한 줄 등록 — 자잘한 요청은 팝업을 띄울 만큼 적을 게 없다. 나머지는 댓글로 좁힌다. */
const newTitle = ref('')
const newKind = ref<RequestKind>('data')
const newAssignee = ref<string>('none')

function submitRequest() {
  const title = newTitle.value.trim()
  if (!title) return
  store.addRequest(title, newKind.value, newAssignee.value === 'none' ? null : newAssignee.value)
  newTitle.value = ''
  scope.value = 'all'
  resetAll()
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
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-destructive bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            무엇을 해야 하는지 아직 정리되지 않은 요청이 {{ asideCounts.unspecced }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium text-destructive underline-offset-4 hover:underline" @click="showUnspecced">
            그 요청만 보기
          </button>
        </div>
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-border bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            아무도 손대지 않은 요청이 {{ asideCounts.idle }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium underline-offset-4 hover:underline" @click="showIdle">
            그 요청만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">요청</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-2xl font-semibold tracking-tight">요청</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            회의에서 정할 일이 아니라 누가 해주면 끝나는 일입니다. 데이터 정리, 확인 부탁 같은 것들이
            여기 쌓입니다. 한 줄로 적어 두고 나머지는 댓글로 주고받습니다 — 오간 이야기는 요청 안에서
            정리됩니다.
          </p>
        </header>

        <div class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-[13px] py-2.5 shadow-sm">
          <Plus class="size-4 shrink-0 text-muted-foreground" />
          <Input
            v-model="newTitle"
            placeholder="요청 한 줄 적기 — 예: 3월 결제 실패 데이터 정리"
            class="grow"
            @keyup.enter="submitRequest"
          />
          <Select v-model="newKind">
            <SelectTrigger class="w-[124px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="data">데이터 정리</SelectItem>
              <SelectItem value="check">확인</SelectItem>
              <SelectItem value="etc">기타</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="newAssignee">
            <SelectTrigger class="w-[124px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">담당자 미정</SelectItem>
              <SelectItem v-for="m in store.allMembers" :key="m.id" :value="m.id">{{ m.name }}</SelectItem>
            </SelectContent>
          </Select>
          <Button class="shrink-0" :disabled="newTitle.trim().length === 0" @click="submitRequest">등록</Button>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            v-for="t in scopeTabs"
            :key="t.key"
            type="button"
            class="inline-flex h-[34px] items-center gap-2 rounded-md border px-3.5 text-xs font-medium transition-colors"
            :class="
              scope === t.key
                ? 'border-border bg-accent text-accent-foreground'
                : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
            "
            @click="pickScope(t.key)"
          >
            {{ t.label }}
            <span class="text-muted-foreground">{{ t.n }}</span>
          </button>
        </div>

        <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]">
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="요청 제목에 들어가는 말"
              class="grow bg-background"
              @keyup.enter="search"
            />
            <span class="shrink-0 text-sm text-muted-foreground">담당자</span>
            <Select v-model="assigneeFilter" @update:model-value="resetPage">
              <SelectTrigger class="w-[132px] shrink-0 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem v-for="m in store.allMembers" :key="m.id" :value="m.id">{{ m.name }}</SelectItem>
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
            <span class="w-[52px] shrink-0 pt-2 text-sm text-muted-foreground">진행</span>
            <div class="flex grow flex-wrap gap-1.5">
              <button
                v-for="c in stateChips"
                :key="c.key"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors"
                :class="
                  stateFilter === c.key
                    ? 'border-primary bg-primary text-primary-foreground shadow'
                    : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                "
                @click="pickState(c.key)"
              >
                {{ c.label }}
                <span :class="stateFilter === c.key ? 'text-primary-foreground/60' : 'text-muted-foreground'">{{ c.n }}</span>
              </button>
            </div>
          </div>

          <div class="flex items-start gap-2.5">
            <span class="w-[52px] shrink-0 pt-2 text-sm text-muted-foreground">종류</span>
            <div class="flex grow flex-wrap gap-1.5">
              <button
                v-for="c in kindChips"
                :key="c.key"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors"
                :class="
                  kindFilter === c.key
                    ? 'border-primary bg-primary text-primary-foreground shadow'
                    : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                "
                @click="pickKind(c.key)"
              >
                {{ c.label }}
                <span :class="kindFilter === c.key ? 'text-primary-foreground/60' : 'text-muted-foreground'">{{ c.n }}</span>
              </button>
            </div>
          </div>
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">요청</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">정리</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">진행</TableHead>
                <TableHead class="h-10 w-[76px] text-xs font-medium text-muted-foreground">담당자</TableHead>
                <TableHead class="h-10 w-[76px] text-xs font-medium text-muted-foreground">기한</TableHead>
                <TableHead class="h-10 w-10 text-right text-xs font-medium text-muted-foreground">댓글</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in pageRows"
                :key="row.request.id"
                class="h-13 cursor-pointer"
                @click="openRequest(row.request.id)"
              >
                <TableCell class="min-w-0">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="h-[24px] w-1 shrink-0 rounded-full"
                      :class="{
                        'bg-border': row.request.state === 'todo',
                        'bg-primary': row.request.state === 'doing',
                        'bg-muted-foreground/40': row.request.state === 'done',
                      }"
                    />
                    <RequestKindLabel :kind="row.request.kind" />
                    <button type="button" class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline">
                      {{ row.request.title }}
                    </button>
                  </div>
                </TableCell>
                <TableCell>
                  <RequestSpecBadge :state="row.specState" />
                </TableCell>
                <TableCell>
                  <RequestStateBadge :state="row.request.state" />
                </TableCell>
                <TableCell class="text-sm" :class="row.assigneeName ? '' : 'text-muted-foreground'">
                  {{ row.assigneeName ?? '미정' }}
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ row.dueLabel }}</TableCell>
                <TableCell class="text-right text-sm text-muted-foreground">{{ row.commentCount }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="6" class="h-[110px] text-center text-sm text-muted-foreground">
                  조회 조건에 맞는 요청이 없습니다.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex items-center gap-2.5 pb-[26px]">
          <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
          <div class="grow" />
          <Button variant="outline" size="icon" :disabled="current <= 1" @click="page = current - 1">
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
          <Button variant="outline" size="icon" :disabled="current >= pageCount" @click="page = current + 1">
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>

    <RequestDetailDialog v-model:open="detailOpen" :request-id="detailId" @open-thread="openThread" />
    <ThreadDetailDialog v-model:open="threadOpen" :thread-id="threadId" @open-thread="openThread" />
  </AppShell>
</template>

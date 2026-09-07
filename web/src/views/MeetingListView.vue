<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Download, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import MeetingDetailDialog from '@/components/app/MeetingDetailDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { MeetingRow } from '@/types/domain'

const store = useMijeongeStore()

/* 조회 조건 — 제목 · 결과 · 참석자. 안건 목록과 같은 자리, 같은 순서다. */
const titleDraft = ref('')
const query = ref('')
const resultFilter = ref<'all' | 'decided' | 'undecided' | 'deferred'>('all')
const attendeeFilter = ref<string>('all')
const page = ref(1)
const perPage = 5

const counts = computed(() => ({
  all: store.meetingRows.length,
  decided: store.meetingRows.filter((r) => r.decidedCount > 0).length,
  undecided: store.meetingRows.filter((r) => r.decidedCount === 0).length,
  deferred: store.meetingRows.filter((r) => r.deferredCount > 0).length,
}))

const resultChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'decided' as const, label: '결정 남김', n: counts.value.decided },
  { key: 'undecided' as const, label: '결정 없이 끝남', n: counts.value.undecided },
  { key: 'deferred' as const, label: '미룬 안건 있음', n: counts.value.deferred },
])

function matchesResult(row: MeetingRow) {
  if (resultFilter.value === 'all') return true
  if (resultFilter.value === 'decided') return row.decidedCount > 0
  if (resultFilter.value === 'undecided') return row.decidedCount === 0
  return row.deferredCount > 0
}

function matchesAttendee(row: MeetingRow) {
  if (attendeeFilter.value === 'all') return true
  return row.meeting.attendeeIds.includes(attendeeFilter.value)
}

const filtered = computed(() =>
  store.meetingRows.filter(
    (r) => r.meeting.title.includes(query.value) && matchesResult(r) && matchesAttendee(r),
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
  resultFilter.value = 'all'
  attendeeFilter.value = 'all'
  resetPage()
}
function pickResult(key: typeof resultFilter.value) {
  resultFilter.value = key
  resetPage()
}

/* 회의 하나 보기 — 목록을 그대로 두고 그 위에 띄운다 */
const detailId = ref<string | null>(null)
const detailOpen = ref(false)

function openMeeting(id: string) {
  detailId.value = id
  detailOpen.value = true
}

/* 회의에서 다룬 안건을 누르면 회의를 닫고 그 안건 이력으로 넘어간다 */
const threadId = ref<string | null>(null)
const threadOpen = ref(false)

function openThread(id: string) {
  detailOpen.value = false
  threadId.value = id
  threadOpen.value = true
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
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-border bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            아무것도 정하지 못하고 끝난 회의가 {{ counts.undecided }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium underline-offset-4 hover:underline" @click="pickResult('undecided')">
            그 회의만 보기
          </button>
        </div>
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-destructive bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            안건을 미룬 채 끝난 회의가 {{ counts.deferred }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium text-destructive underline-offset-4 hover:underline" @click="pickResult('deferred')">
            그 회의만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">회의</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">회의</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              지난 회의가 언제 열렸고 무엇이 정해졌는지 여기서 봅니다. 회의를 열면 등록된 안건 중에서
              이번에 다룰 것을 고르고, 안건에 남긴 줄이 그대로 그 회의의 기록이 됩니다.
            </p>
          </div>
          <Button class="shrink-0" as-child>
            <RouterLink to="/meetings/new">
              <Plus class="size-4" />
              회의 추가
            </RouterLink>
          </Button>
        </header>

        <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]">
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="회의 이름에 들어가는 말"
              class="grow bg-background"
              @keyup.enter="search"
            />
            <span class="shrink-0 text-sm text-muted-foreground">참석자</span>
            <Select v-model="attendeeFilter" @update:model-value="resetPage">
              <SelectTrigger class="w-[132px] shrink-0 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem v-for="m in store.allMembers" :key="m.id" :value="m.id">{{ m.name }}</SelectItem>
              </SelectContent>
            </Select>
            <Button class="shrink-0" @click="search">
              <Search class="size-4" />
              조회
            </Button>
            <Button variant="outline" class="shrink-0" @click="resetAll">초기화</Button>
          </div>

          <div class="flex items-start gap-2.5">
            <span class="w-[52px] shrink-0 pt-2 text-sm text-muted-foreground">결과</span>
            <div class="flex grow flex-wrap gap-1.5">
              <button
                v-for="c in resultChips"
                :key="c.key"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors"
                :class="
                  resultFilter === c.key
                    ? 'border-primary bg-primary text-primary-foreground shadow'
                    : 'border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
                "
                @click="pickResult(c.key)"
              >
                {{ c.label }}
                <span :class="resultFilter === c.key ? 'text-primary-foreground/60' : 'text-muted-foreground'">{{ c.n }}</span>
              </button>
            </div>
          </div>
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">회의</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">날짜</TableHead>
                <TableHead class="h-10 w-[160px] text-xs font-medium text-muted-foreground">참석자</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">다룬 안건</TableHead>
                <TableHead class="h-10 w-[60px] text-right text-xs font-medium text-muted-foreground">결정</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in pageRows"
                :key="row.meeting.id"
                class="h-12 cursor-pointer"
                @click="openMeeting(row.meeting.id)"
              >
                <TableCell class="min-w-0">
                  <div class="flex items-center gap-2.5">
                    <span
                      class="h-[22px] w-1 shrink-0 rounded-full"
                      :class="row.decidedCount > 0 ? 'bg-primary' : 'bg-border'"
                    />
                    <button type="button" class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline">
                      {{ row.meeting.title }}
                    </button>
                  </div>
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ row.dateLabel }}</TableCell>
                <TableCell class="truncate text-sm" :class="row.attendeeNames.length ? '' : 'text-muted-foreground'">
                  {{ row.attendeeNames.length ? row.attendeeNames.join(', ') : '—' }}
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ row.threadCount }}건</TableCell>
                <TableCell class="text-right text-sm" :class="row.decidedCount ? '' : 'text-muted-foreground'">
                  {{ row.decidedCount }}
                </TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="5" class="h-[110px] text-center text-sm text-muted-foreground">
                  조회 조건에 맞는 회의가 없습니다.
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

    <MeetingDetailDialog v-model:open="detailOpen" :meeting-id="detailId" @open-thread="openThread" />
    <ThreadDetailDialog v-model:open="threadOpen" :thread-id="threadId" @open-thread="openThread" />
  </AppShell>
</template>

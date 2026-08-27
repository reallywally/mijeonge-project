<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Download, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMijeongeStore } from '@/stores/mijeonge'
import type { ThreadRow } from '@/types/domain'

const store = useMijeongeStore()

/* 조회 조건 — 제목 · 상태 · 담당자 */
const titleDraft = ref('')
const query = ref('')
const stateFilter = ref<'all' | 'queued' | 'open' | 'decided' | 'stuck'>('all')
const ownerFilter = ref<string>('all')
const page = ref(1)
const perPage = 5

const counts = computed(() => ({
  all: store.rows.length,
  queued: store.rows.filter((r) => r.thread.state === 'queued').length,
  open: store.rows.filter((r) => r.thread.state === 'open').length,
  decided: store.rows.filter((r) => r.thread.state === 'decided').length,
  stuck: store.rows.filter((r) => r.deferCount >= 3).length,
}))

const stateChips = computed(() => [
  { key: 'all' as const, label: '전체', n: counts.value.all },
  { key: 'queued' as const, label: '대기', n: counts.value.queued },
  { key: 'open' as const, label: '미결정', n: counts.value.open },
  { key: 'decided' as const, label: '결정됨', n: counts.value.decided },
  { key: 'stuck' as const, label: '3번 이상 미뤄짐', n: counts.value.stuck },
])

function matchesState(row: ThreadRow) {
  if (stateFilter.value === 'all') return true
  if (stateFilter.value === 'stuck') return row.deferCount >= 3
  return row.thread.state === stateFilter.value
}

function matchesOwner(row: ThreadRow) {
  if (ownerFilter.value === 'all') return true
  if (ownerFilter.value === 'none') return row.thread.ownerId === null
  return row.thread.ownerId === ownerFilter.value
}

const filtered = computed(() =>
  store.rows.filter(
    (r) => r.thread.title.includes(query.value) && matchesState(r) && matchesOwner(r),
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
  stateFilter.value = 'all'
  ownerFilter.value = 'all'
  resetPage()
}
function pickState(key: typeof stateFilter.value) {
  stateFilter.value = key
  resetPage()
}

/* 안건 추가 팝업 */
const addOpen = ref(false)
const newTitle = ref('')
const newOwner = ref<string>('none')

function submitThread() {
  const title = newTitle.value.trim()
  if (!title) return
  store.addThread(title, newOwner.value === 'none' ? null : newOwner.value)
  newTitle.value = ''
  newOwner.value = 'none'
  addOpen.value = false
  resetAll()
}
</script>

<template>
  <AppShell>
    <template #actions>
      <Button variant="outline" size="icon">
        <Download class="size-4" />
      </Button>
      <Button variant="outline">회의 추가</Button>
      <Button @click="addOpen = true">
        <Plus class="size-4" />
        안건 추가
      </Button>
    </template>

    <template #aside>
      <div class="h-px bg-border" />
      <div class="flex flex-col gap-3">
        <div class="text-xs font-medium text-muted-foreground">눈여겨볼 것</div>
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-border bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            아직 회의에서 다루지 않은 안건이 {{ counts.queued }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium underline-offset-4 hover:underline" @click="pickState('queued')">
            그 안건만 보기
          </button>
        </div>
        <div class="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-destructive bg-card px-[13px] py-3 shadow-sm">
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            3번 이상 미뤄진 안건이 {{ counts.stuck }}건 있습니다.
          </p>
          <button type="button" class="min-h-[30px] text-left text-sm font-medium text-destructive underline-offset-4 hover:underline" @click="pickState('stuck')">
            그 안건만 보기
          </button>
        </div>
      </div>
    </template>

    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">안건</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-2xl font-semibold tracking-tight">안건</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            오른쪽 위 안건 추가로 먼저 등록해 두고, 회의를 열 때 등록된 안건 중에서 이번에 다룰 것을 고릅니다.
            회의록은 따로 쓰지 않습니다 — 회의에서 안건에 남긴 줄이 그대로 그 회의의 기록이 됩니다.
          </p>
        </header>

        <section class="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]">
          <div class="flex items-center gap-2.5">
            <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
            <Input
              v-model="titleDraft"
              placeholder="안건 제목에 들어가는 말"
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
            <span class="w-[52px] shrink-0 pt-2 text-sm text-muted-foreground">상태</span>
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
        </section>

        <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">안건</TableHead>
                <TableHead class="h-10 w-[124px] text-xs font-medium text-muted-foreground">상태</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">담당자</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground">마지막 회의</TableHead>
                <TableHead class="h-10 w-10 text-right text-xs font-medium text-muted-foreground">이력</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in pageRows" :key="row.thread.id" class="h-12 cursor-pointer">
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
                    <span class="min-w-0 truncate text-sm">{{ row.thread.title }}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <ThreadStateBadge :state="row.thread.state" :defer-count="row.deferCount" />
                </TableCell>
                <TableCell class="text-sm" :class="row.ownerName ? '' : 'text-muted-foreground'">
                  {{ row.ownerName ?? '미정' }}
                </TableCell>
                <TableCell class="text-sm text-muted-foreground">{{ row.lastMeetingLabel }}</TableCell>
                <TableCell class="text-right text-sm text-muted-foreground">{{ row.entryCount }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="5" class="h-[110px] text-center text-sm text-muted-foreground">
                  조회 조건에 맞는 안건이 없습니다.
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

    <Dialog v-model:open="addOpen">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>안건 추가</DialogTitle>
          <DialogDescription class="text-pretty">
            회의와 무관하게 먼저 등록해 둡니다. 등록만 된 안건은 대기 상태로, 다음 회의에서 고를 후보가 됩니다.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-3.5 py-1">
          <div class="flex flex-col gap-2">
            <Label>무엇을 정해야 하나요</Label>
            <Input
              v-model="newTitle"
              placeholder="예: 결제 실패 안내 문구를 어떤 톤으로 쓸지"
              @keyup.enter="submitThread"
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label>담당자 (선택)</Label>
            <Select v-model="newOwner">
              <SelectTrigger class="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">미정</SelectItem>
                <SelectItem v-for="m in store.allMembers" :key="m.id" :value="m.id">{{ m.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="addOpen = false">취소</Button>
          <Button :disabled="!newTitle.trim()" @click="submitThread">저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>
</template>

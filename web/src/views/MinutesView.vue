<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { monthDay } from '@/lib/date'
import { outcomeCount } from '@/lib/minutes'
import { useDataStore } from '@/stores/data'
import { useMinutesStore } from '@/stores/minutes'

/* 회의록 게시판 — 고른 프로젝트의 회의록 전부를 받아 여기서 제목으로 거른다.
   '나온 것' 은 스냅샷에서 그 회의록을 출처로 단 안건 · 이력 · 작업의 수다 (docs/api/minutes.md '화면') */
const data = useDataStore()
const minutes = useMinutesStore()
const router = useRouter()

watch(
  () => data.currentProjectId,
  () => void minutes.load(),
  { immediate: true },
)

const titleDraft = ref('')
const query = ref('')
const page = ref(1)
const perPage = 10

const filtered = computed(() => minutes.list.filter((m) => m.title.includes(query.value)))

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
  page.value = 1
}

const nameOf = (id: string) => data.memberName(id) ?? '알 수 없음'
const made = (id: string) => outcomeCount(minutes.outcomeOf(id))

function open(id: string) {
  void router.push(`/minutes/${id}`)
}
</script>

<template>
  <AppShell>
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">회의록</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight">회의록</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              회의록을 남겨 두고, 회의록마다 [AI 정리] 로 새 안건 · 기존 안건에 붙일 이력 · 작업을
              골라 등록합니다. 등록한 것에는 어느 회의에서 나왔는지가 남습니다.
            </p>
          </div>
          <Button class="shrink-0" data-minutes-new @click="router.push('/minutes/new')">
            <Plus class="size-4" />
            새 회의록
          </Button>
        </header>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-[17px] py-[15px]"
        >
          <span class="w-[52px] shrink-0 text-sm text-muted-foreground">제목</span>
          <Input
            v-model="titleDraft"
            placeholder="회의록 제목에 들어가는 말"
            class="grow bg-background"
            aria-label="회의록 제목 찾기"
            data-minutes-search
            @keyup.enter="search"
          />
          <Button class="shrink-0" @click="search">
            <Search class="size-4" />
            조회
          </Button>
          <Button variant="outline" class="shrink-0" @click="resetAll">초기화</Button>
        </section>

        <p
          v-if="minutes.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ minutes.error }}
        </p>

        <div
          v-if="!minutes.loaded && minutes.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          회의록을 받는 중입니다.
        </div>

        <div v-else class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                  >회의 날짜</TableHead
                >
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">제목</TableHead>
                <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                  >작성자</TableHead
                >
                <TableHead
                  class="h-10 w-[72px] text-right text-xs font-medium text-muted-foreground"
                  >나온 것</TableHead
                >
                <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                  >고친 날</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="m in pageRows"
                :key="m.id"
                class="h-12 cursor-pointer"
                :data-minutes-item="m.id"
                @click="open(m.id)"
              >
                <TableCell
                  class="text-sm"
                  :class="m.meetingDate ? '' : 'text-muted-foreground'"
                  data-minutes-meeting-date
                  >{{ m.meetingDate ? monthDay(m.meetingDate) : '—' }}</TableCell
                >
                <TableCell class="min-w-0">
                  <button
                    type="button"
                    class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                  >
                    {{ m.title }}
                  </button>
                </TableCell>
                <TableCell class="text-sm">{{ nameOf(m.authorId) }}</TableCell>
                <TableCell
                  class="text-right text-sm"
                  :class="made(m.id) > 0 ? '' : 'text-muted-foreground'"
                  data-minutes-made
                  >{{ made(m.id) }}</TableCell
                >
                <TableCell class="text-sm text-muted-foreground">{{
                  monthDay(m.updatedAt)
                }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="5" class="h-[110px] text-center text-sm text-muted-foreground">
                  {{
                    minutes.list.length === 0
                      ? '아직 남긴 회의록이 없습니다.'
                      : '조회 조건에 맞는 회의록이 없습니다.'
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
  </AppShell>
</template>

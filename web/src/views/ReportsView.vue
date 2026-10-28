<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, FileChartColumn, Loader2, Square, X } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import ReportFactsCards from '@/components/app/ReportFactsCards.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dayTime } from '@/lib/date'
import { periodLabel, rateLabel, reportPeriodLabel } from '@/lib/progress'
import { useDataStore } from '@/stores/data'
import { useReportStore } from '@/stores/report'

/* 리포트 목록 — 위에서 [리포트 만들기] 를 누르면 숫자 카드(facts)부터 그리고 아래로 글이 흘러나온다.
   다 받으면(서버가 저장하면) 그 상세로 간다. 멈추거나 떠나면 저장되지 않는다 (docs/api/report.md '화면') */
const data = useDataStore()
const report = useReportStore()
const router = useRouter()

watch(
  () => data.currentProjectId,
  () => void report.load(),
  { immediate: true },
)

/* 만드는 것은 이 화면에서만 산다 — 떠나면 끊고 버린다 */
onBeforeUnmount(() => report.resetDraft())
onBeforeRouteLeave(() => {
  if (!report.generating) return true
  if (!window.confirm('만드는 중인 리포트는 저장되지 않습니다. 이 화면을 떠날까요?')) return false
  report.resetDraft()
  return true
})

const periodHint = computed(() => reportPeriodLabel())

async function generate() {
  const id = await report.generate()
  if (id) await router.push(`/reports/${id}`)
}

const page = ref(1)
const perPage = 10
const pageCount = computed(() => Math.max(1, Math.ceil(report.list.length / perPage)))
const current = computed(() => Math.min(page.value, pageCount.value))
const start = computed(() => (current.value - 1) * perPage)
const pageRows = computed(() => report.list.slice(start.value, start.value + perPage))
const rangeLabel = computed(() =>
  report.list.length === 0
    ? '0건'
    : `총 ${report.list.length}건 중 ${start.value + 1}–${start.value + pageRows.value.length}건`,
)

const nameOf = (id: string) => data.memberName(id) ?? '알 수 없음'

/* 근거 칩을 누르면 상세 팝업. 이 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 */
const threadDetailId = ref<string | null>(null)
const taskDetailId = ref<string | null>(null)
const threadOpen = computed({
  get: () => threadDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) threadDetailId.value = null
  },
})
const taskOpen = computed({
  get: () => taskDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) taskDetailId.value = null
  },
})
function openThread(id: string) {
  taskDetailId.value = null
  threadDetailId.value = id
}
function openTask(id: string) {
  threadDetailId.value = null
  taskDetailId.value = id
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">리포트</span>
      <span class="text-xs text-muted-foreground">{{ rangeLabel }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4">
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 grow flex-col gap-2.5">
            <h1 class="text-[22px] font-bold tracking-[-0.025em]">리포트</h1>
            <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
              지난 7일의 진행을 규칙으로 세고, AI 가 무엇을 먼저 손써야 하는지 근거와 함께 씁니다.
              만든 리포트는 남아 다음 리포트가 지난번과 견줍니다.
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              :disabled="report.generating || !data.currentProjectId"
              data-report-generate
              @click="generate"
            >
              <Loader2 v-if="report.generating" class="size-4 animate-spin" />
              <FileChartColumn v-else class="size-4" />
              리포트 만들기
            </Button>
            <span class="text-xs text-muted-foreground" data-report-period-hint>{{
              periodHint
            }}</span>
          </div>
        </header>

        <!-- 만드는 중 — facts 가 오면 숫자 카드부터. 글은 AI 가 낸 것이라 v-html 없이 줄바꿈만 살린다 -->
        <section
          v-if="report.draft"
          class="flex flex-col gap-3 rounded-lg border border-border bg-card px-[17px] py-[15px] shadow-sm"
          aria-label="만드는 중인 리포트"
          aria-live="polite"
          data-report-draft
        >
          <div class="flex items-center gap-2.5">
            <Loader2
              v-if="report.draft.status === 'streaming'"
              class="size-4 shrink-0 animate-spin text-muted-foreground"
            />
            <span class="min-w-0 grow text-sm font-medium" data-report-draft-line>{{
              report.draft.status === 'streaming'
                ? report.draft.facts
                  ? '리포트를 쓰는 중…'
                  : '지난 7일을 세는 중…'
                : report.draft.status === 'stopped'
                  ? '멈췄습니다 — 이 리포트는 저장되지 않았습니다.'
                  : report.draft.status === 'error'
                    ? '만들지 못했습니다 — 저장되지 않았습니다.'
                    : '저장했습니다.'
            }}</span>
            <Button
              v-if="report.draft.status === 'streaming'"
              variant="outline"
              class="shrink-0"
              data-report-stop
              @click="report.stop()"
            >
              <Square class="size-3.5 fill-current" />
              멈추기
            </Button>
            <Button
              v-else-if="report.draft.status !== 'done'"
              variant="ghost"
              class="shrink-0"
              data-report-draft-close
              @click="report.resetDraft()"
            >
              <X class="size-4" />
              닫기
            </Button>
          </div>
          <p v-if="report.draft.status === 'streaming'" class="text-xs text-muted-foreground">
            다 받기 전에 멈추거나 이 화면을 떠나면 저장되지 않습니다.
          </p>
          <ReportFactsCards v-if="report.draft.facts" :facts="report.draft.facts" />
          <ChatRefText
            v-if="report.draft.text"
            :text="report.draft.text"
            data-report-draft-text
            @open-thread="openThread"
            @open-task="openTask"
          />
          <p
            v-if="report.draft.status === 'error'"
            class="text-sm text-destructive"
            role="alert"
            data-report-error
          >
            {{ report.draft.error }}
          </p>
        </section>

        <p
          v-if="report.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ report.error }}
        </p>

        <div
          v-if="!report.loaded && report.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          리포트를 받는 중입니다.
        </div>

        <div
          v-else
          class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
        >
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/60 hover:bg-muted/60">
                <TableHead class="h-10 text-xs font-medium text-muted-foreground">기간</TableHead>
                <TableHead class="h-10 w-[96px] text-xs font-medium text-muted-foreground"
                  >만든 사람</TableHead
                >
                <TableHead
                  class="h-10 w-[72px] text-right text-xs font-medium text-muted-foreground"
                  >완료율</TableHead
                >
                <TableHead
                  class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                  >손쓸 작업</TableHead
                >
                <TableHead class="h-10 w-[120px] text-xs font-medium text-muted-foreground"
                  >만든 시각</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="r in pageRows"
                :key="r.id"
                class="h-12 cursor-pointer"
                :data-report-item="r.id"
                @click="router.push(`/reports/${r.id}`)"
              >
                <TableCell class="min-w-0">
                  <button
                    type="button"
                    class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                  >
                    {{ periodLabel(r) }}
                  </button>
                </TableCell>
                <TableCell class="text-sm">{{ nameOf(r.createdBy) }}</TableCell>
                <TableCell class="text-right text-sm" data-report-rate>{{
                  rateLabel(r.doneRate)
                }}</TableCell>
                <TableCell
                  class="text-right text-sm"
                  :class="r.attentionCount > 0 ? '' : 'text-muted-foreground'"
                  data-report-attention
                  >{{ r.attentionCount }}</TableCell
                >
                <TableCell class="text-sm text-muted-foreground">{{
                  dayTime(r.createdAt)
                }}</TableCell>
              </TableRow>
              <TableRow v-if="pageRows.length === 0" class="hover:bg-transparent">
                <TableCell colspan="5" class="h-[110px] text-center text-sm text-muted-foreground">
                  아직 만든 리포트가 없습니다.
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

    <ThreadDetailDialog
      v-model:open="threadOpen"
      :thread-id="threadDetailId"
      @open-thread="openThread"
    />
    <TaskDetailDialog
      v-model:open="taskOpen"
      :task-id="taskDetailId"
      @open-task="openTask"
      @open-thread="openThread"
    />
  </AppShell>
</template>

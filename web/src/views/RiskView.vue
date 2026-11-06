<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Loader2, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Square } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import IdCell from '@/components/app/IdCell.vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import ChatRefText from '@/components/app/ChatRefText.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import RiskSettingsDialog from '@/components/app/RiskSettingsDialog.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import AgendaDetailDialog from '@/components/app/AgendaDetailDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { canManageProject } from '@/lib/access'
import { monthDay } from '@/lib/date'
import { riskSettingsLine, AGENDA_SIGNAL_LABEL } from '@/lib/risk'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useRiskStore } from '@/stores/risk'
import type { RiskLevel } from '@/types/domain'

/* 리스크 — 무엇이 안 정해져서 무엇이 멈췄나 · 멈출 건가. 계산은 서버가 하고 여기는 받아 그린다(Q35).
   받는 때는 들어올 때 · 기준을 바꾼 뒤 · [새로 고침] 뿐이다. 프로젝트를 바꾸면 그 프로젝트 것으로 다시 받는다 */
const data = useDataStore()
const auth = useAuthStore()
const risk = useRiskStore()

watch(
  () => data.currentProjectId,
  () => void risk.load(),
  { immediate: true },
)

/* AI 리스크 분석은 이 화면에서만 산다 — 떠나면 버리고, 받는 중이면 끊는다 */
onBeforeUnmount(() => risk.resetSummary())

const summaryLine = computed(() => {
  const s = risk.summary
  if (s && risk.summaryChanged) return '목록이 바뀌었습니다 —'
  if (s?.status === 'streaming') return `보이는 안건 ${s.agendaIds.length}건을 정리하는 중…`
  if (s) return `${s.asOf} 기준 · 보이는 ${s.agendaIds.length}건`
  if (risk.tooManyToSummarize) return '보이는 줄이 너무 많습니다 — 내 파트로 좁혀 주세요.'
  if (risk.visibleCount === 0) return '보이는 리스크가 없어 정리할 것이 없습니다.'
  return `보이는 안건 ${risk.visibleIds.agendaIds.length}건을 정리합니다`
})

const canEditSettings = computed(
  () => data.currentProjectId !== '' && canManageProject(auth.me, data.currentProjectId),
)

const LEVEL_TONE: Record<RiskLevel, StatusTone> = {
  high: 'blocked',
  medium: 'warn',
  low: 'todo',
}

const settingsOpen = ref(false)

/* 안건 줄 · 요약의 근거 칩을 누르면 기존 상세 팝업. 리스크 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 */
const agendaDetailId = ref<string | null>(null)
const taskDetailId = ref<string | null>(null)
const agendaOpen = computed({
  get: () => agendaDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) agendaDetailId.value = null
  },
})
const taskOpen = computed({
  get: () => taskDetailId.value !== null,
  set: (open: boolean) => {
    if (!open) taskDetailId.value = null
  },
})

function openAgenda(id: string) {
  taskDetailId.value = null
  agendaDetailId.value = id
}
function openTask(id: string) {
  agendaDetailId.value = null
  taskDetailId.value = id
}
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">리스크</span>
      <!-- 기준값(기한 임박 · 멈춤 · 등급 점수)은 가리키면 보인다 — 본문의 '기준' 칸은 2026-11-06 걷었다 -->
      <span
        v-if="risk.report"
        class="text-xs text-muted-foreground"
        :title="riskSettingsLine(risk.report.settings)"
        data-risk-settings
      >
        {{ monthDay(risk.report.asOf) }} 기준
      </span>
      <div class="grow" />
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0"
        :disabled="risk.loading"
        @click="risk.load()"
      >
        <Loader2 v-if="risk.loading" class="size-4 animate-spin" />
        <RefreshCw v-else class="size-4" />
        새로 고침
      </Button>
      <Button
        v-if="canEditSettings"
        variant="ghost"
        size="sm"
        class="shrink-0"
        :disabled="!risk.report"
        @click="settingsOpen = true"
      >
        <SlidersHorizontal class="size-4" />
        기준 바꾸기
      </Button>
      <PartScopeToggle />
    </div>

    <div class="flex min-h-0 grow overflow-y-auto px-6 pt-6">
      <div class="flex w-full flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-[22px] font-bold tracking-[-0.025em]">리스크</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            안 정해진 안건이 어떤 작업을 막고 있는지, 막기 전에 봅니다. 신호마다 점수를 매겨 합으로
            등급을 가릅니다 — 같은 데이터면 늘 같은 결과입니다.
          </p>
        </header>

        <!-- AI 리스크 분석(2026-11-06 'AI 요약' 에서 이름만 바뀜) — 누를 때만 부른다. 답은 AI 가 낸 글이라 v-html 없이 줄바꿈만 살린다 -->
        <section
          v-if="risk.report"
          class="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-[17px] py-[11px] shadow-sm"
          aria-label="AI 리스크 분석"
          data-risk-summary
        >
          <div class="flex items-center gap-2.5">
            <Sparkles class="size-4 shrink-0 text-muted-foreground" />
            <span class="shrink-0 text-sm font-medium">AI 리스크 분석</span>
            <span class="min-w-0 grow truncate text-xs text-muted-foreground" data-summary-line>{{
              summaryLine
            }}</span>
            <Button
              v-if="risk.summarizing"
              variant="outline"
              class="shrink-0"
              @click="risk.stopSummary()"
            >
              <Square class="size-3.5 fill-current" />
              멈춤
            </Button>
            <Button
              v-else-if="risk.summary"
              variant="outline"
              class="shrink-0"
              :disabled="!risk.canSummarize"
              @click="risk.summarize()"
            >
              <RotateCcw class="size-4" />
              다시 분석
            </Button>
            <Button
              v-else
              variant="outline"
              class="shrink-0"
              :disabled="!risk.canSummarize"
              @click="risk.summarize()"
            >
              <Sparkles class="size-4" />
              AI 리스크 분석
            </Button>
          </div>

          <div
            v-if="risk.summary"
            class="flex flex-col gap-1.5 transition-opacity"
            :class="risk.summaryChanged ? 'opacity-50' : ''"
            :data-summary-changed="risk.summaryChanged || undefined"
            aria-live="polite"
          >
            <ChatRefText
              v-if="risk.summary.text"
              :text="risk.summary.text"
              data-summary-text
              @open-agenda="openAgenda"
              @open-task="openTask"
            />
            <p
              v-if="risk.summary.status === 'streaming' && !risk.summary.text"
              class="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Loader2 class="size-3.5 animate-spin" />
              분석을 준비하는 중…
            </p>
            <p v-else-if="risk.summary.status === 'stopped'" class="text-xs text-muted-foreground">
              멈췄습니다.
            </p>
            <p
              v-else-if="risk.summary.status === 'error'"
              class="text-xs text-destructive"
              role="alert"
              data-summary-error
            >
              {{ risk.summary.error }}
            </p>
          </div>
        </section>

        <p
          v-if="risk.error"
          class="rounded-lg border border-destructive/40 px-[17px] py-3 text-sm text-destructive"
          role="alert"
        >
          {{ risk.error }}
        </p>

        <template v-if="risk.report">
          <!-- 안건 리스크 -->
          <section class="flex flex-col gap-2.5" aria-label="안건 리스크">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">안건 리스크</h2>
              <span class="text-xs text-muted-foreground">{{ risk.agendas.length }}건</span>
            </div>
            <div
              class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
            >
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/60 hover:bg-muted/60">
                    <TableHead class="h-10 w-[80px] text-xs font-medium text-muted-foreground"
                      >ID</TableHead
                    >
                    <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                      >안건</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >등급</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >막는 작업</TableHead
                    >
                    <TableHead
                      class="h-10 w-[84px] text-right text-xs font-medium text-muted-foreground"
                      >기한 넘김</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >담당자</TableHead
                    >
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="row in risk.agendas"
                    :key="row.agendaId"
                    class="cursor-pointer"
                    data-risk-agenda
                    @click="openAgenda(row.agendaId)"
                  >
                    <TableCell><IdCell :id="row.agendaId" /></TableCell>
                    <TableCell class="min-w-0 py-2.5">
                      <div class="flex min-w-0 items-center gap-2.5">
                        <button
                          type="button"
                          class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                        >
                          {{ row.title }}
                        </button>
                        <PartChip :part-id="row.partId" />
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1">
                        <Badge
                          v-for="s in row.signals"
                          :key="s"
                          variant="outline"
                          class="font-normal whitespace-nowrap text-muted-foreground"
                          :class="
                            s === 'overdue' || s === 'blocking' ? 'border-destructive/40' : ''
                          "
                          >{{ AGENDA_SIGNAL_LABEL[s] }}</Badge
                        >
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill :tone="LEVEL_TONE[row.level]" :title="`${row.score}점`">{{
                        row.level
                      }}</StatusPill>
                    </TableCell>
                    <TableCell
                      class="text-right text-sm"
                      :class="row.impactTaskCount > 0 ? 'font-medium' : 'text-muted-foreground'"
                      >{{ row.impactTaskCount }}</TableCell
                    >
                    <TableCell
                      class="text-right text-sm"
                      :class="
                        row.overdueDays > 0
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      "
                      >{{ row.overdueDays > 0 ? `${row.overdueDays}일` : '—' }}</TableCell
                    >
                    <TableCell
                      class="text-sm"
                      :class="row.ownerId ? '' : 'text-muted-foreground'"
                      >{{ data.memberName(row.ownerId) ?? '미정' }}</TableCell
                    >
                  </TableRow>
                  <TableRow v-if="risk.agendas.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="6" class="h-20 text-center text-sm text-muted-foreground">
                      눈에 띄는 안건 리스크가 없습니다.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        </template>

        <div
          v-else-if="risk.loading"
          class="flex h-[110px] items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" />
          리스크를 받는 중입니다.
        </div>
      </div>
    </div>

    <AgendaDetailDialog v-model:open="agendaOpen" :agenda-id="agendaDetailId" />
    <TaskDetailDialog
      v-model:open="taskOpen"
      :task-id="taskDetailId"
      @open-task="openTask"
      @open-agenda="openAgenda"
    />
    <RiskSettingsDialog v-model:open="settingsOpen" />
  </AppShell>
</template>

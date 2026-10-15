<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2, RefreshCw, SlidersHorizontal } from 'lucide-vue-next'
import AppShell from '@/components/app/AppShell.vue'
import PartChip from '@/components/app/PartChip.vue'
import PartScopeToggle from '@/components/app/PartScopeToggle.vue'
import RiskSettingsDialog from '@/components/app/RiskSettingsDialog.vue'
import TaskDetailDialog from '@/components/app/TaskDetailDialog.vue'
import TaskStatusBadge from '@/components/app/TaskStatusBadge.vue'
import ThreadDetailDialog from '@/components/app/ThreadDetailDialog.vue'
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
import { riskSettingsLine, TASK_SIGNAL_LABEL, THREAD_SIGNAL_LABEL } from '@/lib/risk'
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

const canEditSettings = computed(
  () => data.currentProjectId !== '' && canManageProject(auth.me, data.currentProjectId),
)

const LEVEL_VARIANT: Record<RiskLevel, 'destructive' | 'secondary' | 'outline'> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
}

const dayLabel = (day: string | null) => (day ? monthDay(day) : '—')
const threadTitle = (threadId: string) =>
  data.allThreads.find((t) => t.id === threadId)?.title ?? threadId

const settingsOpen = ref(false)

/* 줄을 누르면 기존 상세 팝업. 리스크 화면 안에서만 여닫으므로 주소를 바꾸지 않는다 */
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
    <div class="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border px-[26px]">
      <span class="text-xs font-medium text-muted-foreground">리스크</span>
      <span v-if="risk.report" class="text-xs text-muted-foreground">
        {{ monthDay(risk.report.asOf) }} 기준
      </span>
      <div class="grow" />
      <PartScopeToggle />
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div class="flex w-full max-w-[900px] flex-col gap-4 pb-[26px]">
        <header class="flex flex-col gap-2.5">
          <h1 class="text-2xl font-semibold tracking-tight">리스크</h1>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            안 정해진 안건이 어떤 작업을 막고 있는지, 막기 전에 봅니다. 신호마다 점수를 매겨 합으로
            등급을 가릅니다 — 같은 데이터면 늘 같은 결과입니다.
          </p>
        </header>

        <section
          class="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-[17px] py-[11px]"
        >
          <span class="shrink-0 text-sm text-muted-foreground">기준</span>
          <span class="min-w-0 grow truncate text-sm" data-risk-settings>{{
            risk.report ? riskSettingsLine(risk.report.settings) : '—'
          }}</span>
          <span v-if="risk.report" class="shrink-0 text-xs text-muted-foreground">
            {{ risk.report.asOf }}
          </span>
          <Button
            variant="outline"
            class="shrink-0 bg-background"
            :disabled="risk.loading"
            @click="risk.load()"
          >
            <Loader2 v-if="risk.loading" class="size-4 animate-spin" />
            <RefreshCw v-else class="size-4" />
            새로 고침
          </Button>
          <Button
            v-if="canEditSettings"
            variant="outline"
            class="shrink-0 bg-background"
            :disabled="!risk.report"
            @click="settingsOpen = true"
          >
            <SlidersHorizontal class="size-4" />
            기준 바꾸기
          </Button>
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
              <span class="text-xs text-muted-foreground">{{ risk.threads.length }}건</span>
            </div>
            <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
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
                    v-for="row in risk.threads"
                    :key="row.threadId"
                    class="cursor-pointer"
                    data-risk-thread
                    @click="openThread(row.threadId)"
                  >
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
                          >{{ THREAD_SIGNAL_LABEL[s] }}</Badge
                        >
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge :variant="LEVEL_VARIANT[row.level]" :title="`${row.score}점`">{{
                        row.level
                      }}</Badge>
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
                  <TableRow v-if="risk.threads.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="5" class="h-20 text-center text-sm text-muted-foreground">
                      눈에 띄는 안건 리스크가 없습니다.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          <!-- 안건과 어긋난 작업 -->
          <section class="flex flex-col gap-2.5" aria-label="안건과 어긋난 작업">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">안건과 어긋난 작업</h2>
              <span class="text-xs text-muted-foreground">{{ risk.tasks.length }}건</span>
            </div>
            <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                      >작업</TableHead
                    >
                    <TableHead class="h-10 w-[148px] text-xs font-medium text-muted-foreground"
                      >신호</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >상태</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >담당자</TableHead
                    >
                    <TableHead class="h-10 w-[84px] text-xs font-medium text-muted-foreground"
                      >기한</TableHead
                    >
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="row in risk.tasks"
                    :key="row.taskId"
                    class="cursor-pointer"
                    data-risk-task
                    @click="openTask(row.taskId)"
                  >
                    <TableCell class="min-w-0 py-2.5">
                      <div class="flex min-w-0 items-center gap-2.5">
                        <span class="shrink-0 text-xs text-muted-foreground">{{ row.key }}</span>
                        <button
                          type="button"
                          class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
                        >
                          {{ row.title }}
                        </button>
                        <PartChip :part-id="row.partId" />
                      </div>
                      <div
                        v-if="row.threadIds.length > 0"
                        class="mt-1 truncate text-xs text-muted-foreground"
                      >
                        걸린 안건 · {{ row.threadIds.map(threadTitle).join(' · ') }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        :variant="row.signal === 'decidedButBlocked' ? 'secondary' : 'outline'"
                        class="whitespace-nowrap"
                        >{{ TASK_SIGNAL_LABEL[row.signal] }}</Badge
                      >
                    </TableCell>
                    <TableCell><TaskStatusBadge :status="row.status" /></TableCell>
                    <TableCell
                      class="text-sm"
                      :class="row.ownerId ? '' : 'text-muted-foreground'"
                      >{{ data.memberName(row.ownerId) ?? '미정' }}</TableCell
                    >
                    <TableCell class="text-sm text-muted-foreground">{{
                      dayLabel(row.due)
                    }}</TableCell>
                  </TableRow>
                  <TableRow v-if="risk.tasks.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="5" class="h-20 text-center text-sm text-muted-foreground">
                      안건과 어긋난 작업이 없습니다.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          <!-- 사람별 — [내 파트 | 전체] 와 상관없이 다 보인다 -->
          <section class="flex flex-col gap-2.5" aria-label="사람별">
            <div class="flex items-baseline gap-2">
              <h2 class="text-base font-semibold">사람별</h2>
              <span class="text-xs text-muted-foreground">정하면 풀리는 일이 많은 순</span>
            </div>
            <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/50 hover:bg-muted/50">
                    <TableHead class="h-10 text-xs font-medium text-muted-foreground"
                      >담당자</TableHead
                    >
                    <TableHead
                      class="h-10 w-[112px] text-right text-xs font-medium text-muted-foreground"
                      >안 정해진 안건</TableHead
                    >
                    <TableHead
                      class="h-10 w-[96px] text-right text-xs font-medium text-muted-foreground"
                      >기한 넘김</TableHead
                    >
                    <TableHead
                      class="h-10 w-[96px] text-right text-xs font-medium text-muted-foreground"
                      >막힌 작업</TableHead
                    >
                    <TableHead
                      class="h-10 w-[128px] text-right text-xs font-medium text-muted-foreground"
                      >정하면 풀리는 일</TableHead
                    >
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="row in risk.owners"
                    :key="row.memberId ?? 'none'"
                    class="hover:bg-transparent"
                    data-risk-owner
                  >
                    <TableCell
                      class="text-sm"
                      :class="row.memberId ? '' : 'text-muted-foreground'"
                      >{{
                        row.memberId
                          ? (data.memberName(row.memberId) ?? row.memberId)
                          : '담당자 없음'
                      }}</TableCell
                    >
                    <TableCell class="text-right text-sm">{{ row.openThreads }}</TableCell>
                    <TableCell
                      class="text-right text-sm"
                      :class="
                        row.overdueThreads > 0
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      "
                      >{{ row.overdueThreads }}</TableCell
                    >
                    <TableCell
                      class="text-right text-sm"
                      :class="row.blockedTasks > 0 ? '' : 'text-muted-foreground'"
                      >{{ row.blockedTasks }}</TableCell
                    >
                    <TableCell
                      class="text-right text-sm"
                      :class="row.blockingImpact > 0 ? 'font-medium' : 'text-muted-foreground'"
                      >{{ row.blockingImpact }}</TableCell
                    >
                  </TableRow>
                  <TableRow v-if="risk.owners.length === 0" class="hover:bg-transparent">
                    <TableCell colspan="5" class="h-20 text-center text-sm text-muted-foreground">
                      몰린 사람이 없습니다.
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
    <RiskSettingsDialog v-model:open="settingsOpen" />
  </AppShell>
</template>

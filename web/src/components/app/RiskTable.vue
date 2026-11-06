<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import IdCell from '@/components/app/IdCell.vue'
import MemberAvatar from '@/components/app/MemberAvatar.vue'
import PartChip from '@/components/app/PartChip.vue'
import RiskKindBadge from '@/components/app/RiskKindBadge.vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
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
import { slashDay } from '@/lib/date'
import {
  isStrongSignal,
  MERGED_SIGNAL_LABEL,
  RISK_KIND_LABEL,
  RISK_KINDS,
  RISK_LEVEL_LABEL,
  RISK_LEVELS,
  signalLabel,
  type RiskRow,
} from '@/lib/risk'
import { useDataStore } from '@/stores/data'
import { useRiskStore } from '@/stores/risk'
import type { RiskKind, RiskLevel } from '@/types/domain'

/* 리스크 목록 — 세 종류를 한 표에 점수 순으로 섞는다. 위 필터 줄(종류 · 등급 · 걸린 신호)은 카드 · 막대와 같은 거르기다.
   30줄씩 [더 보기]. 줄을 누르면 그 상세 팝업 — 여는 것은 리스크 화면이 맡는다 */
const emit = defineEmits<{ open: [kind: RiskKind, id: string] }>()

const data = useDataStore()
const risk = useRiskStore()

const PAGE = 30
const limit = ref(PAGE)
watch(
  () => risk.filter,
  () => (limit.value = PAGE),
)
const shown = computed(() => risk.filteredRows.slice(0, limit.value))
const hidden = computed(() => risk.filteredRows.length - shown.value.length)

/* 종류 고르기의 수 — 등급 · 신호 거르기는 지난 수 */
const kindCounts = computed(() => {
  const f = risk.filter
  const rest = risk.rows.filter(
    (r) =>
      (f.levels.length === 0 || f.levels.includes(r.level)) &&
      (f.signals.length === 0 || r.signals.some((s) => f.signals.includes(s))),
  )
  const out: Record<RiskKind | 'all', number> = { all: rest.length, agenda: 0, task: 0, test: 0 }
  for (const r of rest) out[r.kind] += 1
  return out
})
const kindTabs = computed(() => [
  { key: null, label: '전체', count: kindCounts.value.all },
  ...RISK_KINDS.map((k) => ({ key: k, label: RISK_KIND_LABEL[k], count: kindCounts.value[k] })),
])
/* 고르기 줄은 누른 것으로 — 카드처럼 다시 눌러 풀지 않는다 */
function pickKind(kind: RiskKind | null) {
  if (kind !== risk.filter.kind) risk.setKind(kind)
}

const LEVEL_TONE: Record<RiskLevel, StatusTone> = {
  high: 'blocked',
  medium: 'warn',
  low: 'todo',
}

/* '연관 작업' — 이 안건에 연결된 작업 수(상태 가리지 않음, 지운 작업 빼고). 안건 줄에만 핵심 숫자 옆에 붙인다 */
const linkedCounts = computed(() => {
  const live = new Set(data.allTasks.map((t) => t.id))
  const counts = new Map<string, number>()
  for (const l of data.taskAgendas)
    if (live.has(l.taskId)) counts.set(l.agendaId, (counts.get(l.agendaId) ?? 0) + 1)
  return counts
})
const linkedCount = (agendaId: string) => linkedCounts.value.get(agendaId) ?? 0

const ownerName = (r: RiskRow) => data.memberName(r.ownerId) ?? '미정'
const overdueDue = (r: RiskRow) => r.overdueDays > 0

const TH = 'h-10 text-xs font-medium text-muted-foreground'
</script>

<template>
  <section class="flex flex-col gap-2.5" aria-label="리스크 목록" data-risk-list>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 class="text-base font-semibold">리스크 목록</h2>

      <div
        role="group"
        aria-label="종류"
        class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5"
      >
        <button
          v-for="t in kindTabs"
          :key="t.key ?? 'all'"
          type="button"
          class="inline-flex h-6 items-center gap-1.5 rounded-sm px-2.5 text-xs"
          :class="
            risk.filter.kind === t.key
              ? 'bg-background font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          "
          :aria-pressed="risk.filter.kind === t.key"
          :data-kind-filter="t.key ?? 'all'"
          @click="pickKind(t.key)"
        >
          {{ t.label }}
          <span class="text-muted-foreground tabular-nums">{{ t.count }}</span>
        </button>
      </div>

      <div role="group" aria-label="등급" class="flex items-center gap-1">
        <button
          v-for="l in RISK_LEVELS"
          :key="l"
          type="button"
          class="inline-flex h-7 items-center rounded-full border px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :class="
            risk.filter.levels.includes(l)
              ? 'border-foreground/30 bg-muted'
              : 'border-transparent opacity-70 hover:opacity-100'
          "
          :aria-pressed="risk.filter.levels.includes(l)"
          :data-level-filter="l"
          @click="risk.toggleLevel(l)"
        >
          <StatusPill :tone="LEVEL_TONE[l]">{{ RISK_LEVEL_LABEL[l] }}</StatusPill>
        </button>
      </div>

      <div v-if="risk.filter.signals.length" class="flex flex-wrap items-center gap-1">
        <button
          v-for="s in risk.filter.signals"
          :key="s"
          type="button"
          class="inline-flex h-6 items-center gap-1 rounded-full border border-primary/40 bg-brand-soft pr-1.5 pl-2.5 text-xs text-foreground hover:border-primary"
          :aria-label="`${MERGED_SIGNAL_LABEL[s]} 거르기 풀기`"
          :data-signal-filter="s"
          @click="risk.removeSignal(s)"
        >
          {{ MERGED_SIGNAL_LABEL[s] }}
          <X class="size-3" />
        </button>
      </div>

      <Button
        v-if="risk.filtered"
        variant="ghost"
        size="sm"
        class="h-7 text-xs text-muted-foreground"
        data-filter-clear
        @click="risk.clearFilter()"
        >거르기 풀기</Button
      >
      <span class="grow" />
      <span class="text-xs text-muted-foreground tabular-nums" data-risk-count
        >{{ risk.filteredRows.length }}건</span
      >
    </div>

    <div
      class="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
    >
      <Table>
        <TableHeader>
          <TableRow class="bg-muted/60 hover:bg-muted/60">
            <TableHead :class="[TH, 'w-[64px]']">종류</TableHead>
            <TableHead :class="[TH, 'hidden w-[84px] sm:table-cell']">키</TableHead>
            <TableHead :class="TH">제목</TableHead>
            <TableHead :class="[TH, 'w-[84px]']">등급</TableHead>
            <TableHead :class="[TH, 'hidden w-[150px] md:table-cell']">핵심 숫자</TableHead>
            <TableHead :class="[TH, 'hidden w-[120px] lg:table-cell']">담당자</TableHead>
            <TableHead :class="[TH, 'hidden w-[64px] text-right lg:table-cell']">기한</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in shown"
            :key="`${row.kind}:${row.id}`"
            class="cursor-pointer"
            :data-risk-row="row.kind"
            :data-risk-id="row.id"
            @click="emit('open', row.kind, row.id)"
          >
            <TableCell class="py-2.5 align-top"><RiskKindBadge :kind="row.kind" /></TableCell>
            <TableCell class="hidden py-2.5 align-top sm:table-cell">
              <span v-if="row.key" class="font-mono text-xs text-muted-foreground">{{
                row.key
              }}</span>
              <IdCell v-else :id="row.id" />
            </TableCell>
            <TableCell class="max-w-0 min-w-0 py-2.5">
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
                  :class="isStrongSignal(s) ? 'border-destructive/40' : ''"
                  :data-row-signal="s"
                  >{{ signalLabel(s, row.kind) }}</Badge
                >
              </div>
              <!-- 좁은 화면 — 숨긴 칸(핵심 숫자 · 담당자)을 제목 아래 한 줄로 -->
              <p class="mt-1.5 truncate text-xs text-muted-foreground md:hidden">
                {{ row.metric }} · {{ ownerName(row) }}
              </p>
            </TableCell>
            <TableCell class="py-2.5 align-top">
              <StatusPill :tone="LEVEL_TONE[row.level]" :title="`${row.score}점`">{{
                row.level
              }}</StatusPill>
            </TableCell>
            <TableCell class="hidden py-2.5 align-top md:table-cell">
              <span
                class="text-sm tabular-nums"
                :class="overdueDue(row) ? 'font-medium text-destructive' : ''"
                data-risk-metric
                >{{ row.metric }}</span
              >
              <span
                v-if="row.kind === 'agenda'"
                class="mt-0.5 block text-xs text-muted-foreground"
                data-risk-linked
                >연관 작업 {{ linkedCount(row.id) }}</span
              >
            </TableCell>
            <TableCell class="hidden py-2.5 align-top lg:table-cell">
              <span
                class="flex min-w-0 items-center gap-2 text-sm"
                :class="row.ownerId ? '' : 'text-muted-foreground'"
                data-risk-owner
              >
                <MemberAvatar
                  v-if="row.ownerId"
                  :name="ownerName(row)"
                  :src="data.memberAvatar(row.ownerId)"
                />
                <span class="truncate">{{ ownerName(row) }}</span>
              </span>
            </TableCell>
            <TableCell
              class="hidden py-2.5 text-right align-top text-sm tabular-nums lg:table-cell"
              :class="overdueDue(row) ? 'text-destructive' : 'text-muted-foreground'"
              >{{ row.due ? slashDay(row.due) : '—' }}</TableCell
            >
          </TableRow>
          <TableRow v-if="risk.filteredRows.length === 0" class="hover:bg-transparent">
            <TableCell
              colspan="7"
              class="h-20 text-center text-sm text-muted-foreground"
              data-risk-empty
            >
              {{
                risk.filtered
                  ? '거른 조건에 맞는 리스크가 없습니다.'
                  : '눈에 띄는 리스크가 없습니다.'
              }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-if="hidden > 0" class="flex justify-center">
      <Button variant="outline" data-risk-more @click="limit += PAGE">
        더 보기
        <span class="text-muted-foreground tabular-nums">{{ hidden }}</span>
      </Button>
    </div>
  </section>
</template>

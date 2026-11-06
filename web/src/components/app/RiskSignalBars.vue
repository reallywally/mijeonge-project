<script setup lang="ts">
import { computed } from 'vue'
import { RISK_KIND_LABEL, RISK_KINDS, type SignalBar } from '@/lib/risk'
import { useRiskStore } from '@/stores/risk'
import type { RiskKind } from '@/types/domain'

/* 신호별 — 신호마다 몇 줄에 걸렸나를 종류별로 쌓은 가로 막대. 많은 것부터, 흔들림 넷은 머리를 따로.
   차트 라이브러리 없이 칸 너비로만 그린다. 누르면 그 신호로 거르고, 다시 누르면 푼다 */
const risk = useRiskStore()

const SEGMENT: Record<RiskKind, string> = {
  agenda: 'bg-kind-agenda',
  task: 'bg-kind-task',
  test: 'bg-kind-test',
}

/* 막대 길이는 두 묶음을 통틀어 가장 긴 것에 맞춘다 — 묶음끼리도 길이를 견줄 수 있게 */
const max = computed(() =>
  Math.max(1, ...[...risk.bars.main, ...risk.bars.churn].map((b) => b.total)),
)
const groups = computed(() =>
  [
    { key: 'main', label: null, bars: risk.bars.main },
    { key: 'churn', label: '흔들림', bars: risk.bars.churn },
  ].filter((g) => g.bars.length > 0),
)

const active = (b: SignalBar) =>
  risk.filter.signals.length === 1 && risk.filter.signals[0] === b.signal
const breakdown = (b: SignalBar) =>
  RISK_KINDS.filter((k) => b.byKind[k] > 0)
    .map((k) => `${RISK_KIND_LABEL[k]} ${b.byKind[k]}`)
    .join(' · ')
</script>

<template>
  <section
    aria-label="신호별"
    class="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card px-[17px] py-3.5 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
    data-risk-bars
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 class="text-sm font-medium">신호별</h2>
      <span class="grow" />
      <span
        v-for="k in RISK_KINDS"
        :key="k"
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <span class="size-2 rounded-xs" :class="SEGMENT[k]" aria-hidden="true" />
        {{ RISK_KIND_LABEL[k] }}
      </span>
    </div>

    <p v-if="groups.length === 0" class="py-6 text-center text-sm text-muted-foreground">
      걸린 신호가 없습니다.
    </p>

    <div v-for="g in groups" :key="g.key" class="flex flex-col gap-0.5" :data-bar-group="g.key">
      <div
        v-if="g.label"
        class="mt-1 mb-1 flex items-center gap-2 border-t border-dashed border-border pt-2.5 text-xs font-medium text-muted-foreground"
      >
        {{ g.label }}
        <span class="font-normal">— 기한 · 내용 · 담당 · 결과가 거듭 바뀜</span>
      </div>
      <button
        v-for="b in g.bars"
        :key="b.signal"
        type="button"
        class="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2rem] items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :class="active(b) ? 'bg-muted' : ''"
        :aria-pressed="active(b)"
        :title="breakdown(b)"
        :data-bar="b.signal"
        @click="risk.setSignals([b.signal])"
      >
        <span class="truncate text-xs" :class="active(b) ? 'font-medium' : 'text-foreground/80'">{{
          b.label
        }}</span>
        <span class="flex h-2.5 min-w-0 items-center">
          <span
            class="flex h-full gap-px overflow-hidden rounded-xs"
            :style="{ width: `${(b.total / max) * 100}%` }"
          >
            <span
              v-for="k in RISK_KINDS"
              v-show="b.byKind[k] > 0"
              :key="k"
              class="h-full"
              :class="SEGMENT[k]"
              :style="{ width: `${(b.byKind[k] / b.total) * 100}%` }"
              :data-segment="k"
            />
          </span>
        </span>
        <span class="text-right text-xs font-medium tabular-nums" data-bar-total>{{
          b.total
        }}</span>
      </button>
    </div>
  </section>
</template>

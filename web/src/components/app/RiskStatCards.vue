<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Hourglass, ListTree, FlaskConical, SquareKanban } from 'lucide-vue-next'
import { DELAY_SIGNALS, RISK_KIND_LABEL, RISK_KINDS } from '@/lib/risk'
import { useRiskStore } from '@/stores/risk'
import type { RiskKind } from '@/types/domain'

/* 대시보드 첫 줄 — 종류별 리스크 수(높음 + 중간) · 지연. 누르면 아래 목록을 그것으로 거르고, 다시 누르면 푼다 */
const risk = useRiskStore()

const ICON: Record<RiskKind, Component> = {
  agenda: ListTree,
  task: SquareKanban,
  test: FlaskConical,
}
const DOT: Record<RiskKind, string> = {
  agenda: 'bg-kind-agenda',
  task: 'bg-kind-task',
  test: 'bg-kind-test',
}

const kindCards = computed(() =>
  RISK_KINDS.map((kind) => {
    const c = risk.cards.kinds[kind]
    const total = c.high + c.medium + c.low
    const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100)
    return {
      kind,
      count: c,
      big: c.high + c.medium,
      total,
      segments: [
        { key: 'high', width: pct(c.high), class: 'bg-status-blocked' },
        { key: 'medium', width: pct(c.medium), class: 'bg-status-warn' },
        { key: 'low', width: pct(c.low), class: 'bg-status-todo/40' },
      ],
    }
  }),
)

const delayActive = computed(
  () =>
    risk.filter.signals.length === DELAY_SIGNALS.length &&
    DELAY_SIGNALS.every((s) => risk.filter.signals.includes(s)),
)

const CARD =
  'group flex min-w-0 flex-col gap-2.5 rounded-lg border bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
</script>

<template>
  <section aria-label="리스크 숫자" class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-risk-cards>
    <button
      v-for="c in kindCards"
      :key="c.kind"
      type="button"
      :class="[CARD, risk.filter.kind === c.kind ? 'border-primary/60 ring-1 ring-primary/30' : '']"
      :aria-pressed="risk.filter.kind === c.kind"
      :data-risk-card="c.kind"
      @click="risk.setKind(c.kind)"
    >
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="size-2 shrink-0 rounded-full" :class="DOT[c.kind]" aria-hidden="true" />
        {{ RISK_KIND_LABEL[c.kind] }} 리스크
        <component
          :is="ICON[c.kind]"
          class="ml-auto size-4 shrink-0 text-muted-foreground/70"
          aria-hidden="true"
        />
      </span>
      <span class="flex items-baseline gap-1">
        <span class="text-3xl font-semibold tracking-tight tabular-nums" data-card-big>{{
          c.big
        }}</span>
        <span class="text-xs text-muted-foreground">건</span>
      </span>
      <span class="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          v-for="s in c.segments"
          :key="s.key"
          class="h-full"
          :class="s.class"
          :style="{ width: `${s.width}%` }"
        />
      </span>
      <span class="truncate text-xs text-muted-foreground tabular-nums" data-card-sub
        >높음 {{ c.count.high }} · 중간 {{ c.count.medium }} · 낮음 {{ c.count.low }}</span
      >
    </button>

    <button
      type="button"
      :class="[CARD, delayActive ? 'border-primary/60 ring-1 ring-primary/30' : '']"
      :aria-pressed="delayActive"
      data-risk-card="delay"
      @click="risk.setSignals(DELAY_SIGNALS)"
    >
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="size-2 shrink-0 rounded-full bg-status-blocked" aria-hidden="true" />
        지연
        <Hourglass class="ml-auto size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      </span>
      <span class="flex items-baseline gap-1">
        <span
          class="text-3xl font-semibold tracking-tight tabular-nums"
          :class="risk.cards.delay.overdue > 0 ? 'text-destructive' : ''"
          data-card-big
          >{{ risk.cards.delay.overdue }}</span
        >
        <span class="text-xs text-muted-foreground">건 기한 넘김</span>
      </span>
      <span class="h-1.5" aria-hidden="true" />
      <span class="truncate text-xs text-muted-foreground tabular-nums" data-card-sub
        >오래 막힘 {{ risk.cards.delay.longBlocked }} · 오래 걸림
        {{ risk.cards.delay.longRunning }}</span
      >
    </button>
  </section>
</template>

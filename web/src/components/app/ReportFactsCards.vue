<script setup lang="ts">
import { computed } from 'vue'
import { rateLabel } from '@/lib/progress'
import type { ProgressFacts } from '@/types/domain'

/* 리포트 맨 위 숫자 카드 — 만드는 중(facts 가 먼저 온다)과 상세가 같이 쓴다.
   완료율 · 막힘은 바로 앞 리포트(previous)와 견준다. 막힘은 늘면 나쁜 쪽이라 색을 거꾸로 칠한다 */
const props = defineProps<{ facts: ProgressFacts }>()

interface Card {
  key: string
  label: string
  value: string
  /** 지난 리포트 대비 — 없으면 null */
  delta: { text: string; worse: boolean } | null
}

function deltaOf(diff: number, unit: string, upIsGood: boolean): Card['delta'] {
  if (diff === 0) return { text: '지난번과 같음', worse: false }
  return {
    text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${unit}`,
    worse: upIsGood ? diff < 0 : diff > 0,
  }
}

const cards = computed<Card[]>(() => {
  const { progress, previous, attention } = props.facts
  return [
    {
      key: 'doneRate',
      label: '완료율',
      value: rateLabel(progress.doneRate),
      delta: previous
        ? deltaOf(
            Math.round(progress.doneRate * 100) - Math.round(previous.doneRate * 100),
            '%p',
            true,
          )
        : null,
    },
    { key: 'completed', label: '완료', value: `${progress.completedTaskIds.length}`, delta: null },
    { key: 'started', label: '시작', value: `${progress.startedTaskIds.length}`, delta: null },
    {
      key: 'blocked',
      label: '막힘',
      value: `${progress.blocked}`,
      delta: previous ? deltaOf(progress.blocked - previous.blocked, '', false) : null,
    },
    { key: 'attention', label: '손쓸 작업', value: `${attention.length}`, delta: null },
  ]
})
</script>

<template>
  <div class="grid grid-cols-5 gap-2.5" data-report-cards>
    <div
      v-for="c in cards"
      :key="c.key"
      class="flex flex-col gap-1 rounded-lg border border-border bg-card px-[15px] py-3 shadow-sm"
      :data-report-card="c.key"
    >
      <span class="text-xs text-muted-foreground">{{ c.label }}</span>
      <span class="text-[22px] font-bold tracking-[-0.025em]" data-card-value>{{ c.value }}</span>
      <span
        v-if="c.delta"
        class="text-xs"
        :class="c.delta.worse ? 'text-destructive' : 'text-muted-foreground'"
        data-card-delta
        >{{ c.delta.text }}</span
      >
    </div>
  </div>
</template>

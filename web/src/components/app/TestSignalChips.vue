<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { TEST_SIGNAL_LABEL } from '@/lib/testcase'
import type { TestSignal } from '@/types/domain'

/* 신호 칩 — 손쓸 테스트 표 · 목록 · 상세가 같이 쓴다. 기간 지남 · 오래 막힘 · 오래 걸림은 눈에 띄게 */
const props = defineProps<{
  signals: TestSignal[]
  /** 좁은 칸 — 이만큼만 칩으로, 나머지는 '+N' (묶음은 하위 신호를 다 모아 길어진다) */
  max?: number
}>()

const shown = computed(() =>
  props.max === undefined ? props.signals : props.signals.slice(0, props.max),
)
const hidden = computed(() => props.signals.length - shown.value.length)

const STRONG: TestSignal[] = ['overdue', 'longBlocked', 'longRunning']
</script>

<template>
  <span v-if="signals.length" class="flex flex-wrap gap-1" data-test-signals>
    <Badge
      v-for="s in shown"
      :key="s"
      variant="outline"
      class="font-normal whitespace-nowrap"
      :class="
        STRONG.includes(s) ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'
      "
      :data-test-signal="s"
      >{{ TEST_SIGNAL_LABEL[s] }}</Badge
    >
    <Badge
      v-if="hidden > 0"
      variant="outline"
      class="font-normal text-muted-foreground"
      :title="
        signals
          .slice(shown.length)
          .map((s) => TEST_SIGNAL_LABEL[s])
          .join(' · ')
      "
      >+{{ hidden }}</Badge
    >
  </span>
</template>

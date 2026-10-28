<script setup lang="ts">
import { computed } from 'vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import type { ThreadState } from '@/types/domain'

const props = defineProps<{ state: ThreadState; deferCount?: number }>()

/* 3번 이상 미뤄진 것만 빨강으로 따로 세운다 — 이 앱이 잡으려는 문제라서. 한두 번 미뤄진 것은 주의 */
const look = computed<{ label: string; tone: StatusTone }>(() => {
  if (props.state === 'decided') return { label: '결정됨', tone: 'done' }
  if (props.state === 'queued') return { label: '대기', tone: 'todo' }
  /* 논의중인 안건은 몇 번 미뤄졌는지가 곧 상태다 — 한 번도 안 미뤘으면 그냥 논의중 */
  const n = props.deferCount ?? 0
  if (n === 0) return { label: '논의중', tone: 'doing' }
  return { label: `${n}번 미뤄짐`, tone: n >= 3 ? 'blocked' : 'warn' }
})
</script>

<template>
  <StatusPill :tone="look.tone">{{ look.label }}</StatusPill>
</template>

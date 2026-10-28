<script setup lang="ts">
import { computed } from 'vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import { testStatusLabel } from '@/lib/testcase'
import type { TestStatus } from '@/types/domain'

const props = defineProps<{ status: TestStatus }>()

/* 실패 · 막힘만 빨강으로 세운다 — 손쓸 것이 거기 있다 */
const tone = computed<StatusTone>(() => {
  if (props.status === 'pass') return 'done'
  if (props.status === 'fail' || props.status === 'blocked') return 'blocked'
  if (props.status === 'testing') return 'doing'
  if (props.status === 'draft') return 'idle'
  return 'todo'
})
</script>

<template>
  <StatusPill :tone="tone" :data-test-status="status">{{ testStatusLabel(status) }}</StatusPill>
</template>

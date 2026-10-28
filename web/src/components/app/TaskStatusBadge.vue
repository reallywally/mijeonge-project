<script setup lang="ts">
import { computed } from 'vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import { taskStatusLabel } from '@/lib/task'
import type { TaskStatus } from '@/types/domain'

const props = defineProps<{ status: TaskStatus }>()

/* 막힘만 빨강으로 세운다 — 안건이 안 정해져 멈춘 것이 이 앱이 잡으려는 문제다. */
const tone = computed<StatusTone>(() => {
  if (props.status === 'done') return 'done'
  if (props.status === 'blocked') return 'blocked'
  if (props.status === 'doing') return 'doing'
  return 'todo'
})
</script>

<template>
  <StatusPill :tone="tone">{{ taskStatusLabel(status) }}</StatusPill>
</template>

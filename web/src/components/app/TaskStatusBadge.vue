<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { taskStatusLabel } from '@/lib/task'
import type { TaskStatus } from '@/types/domain'

const props = defineProps<{ status: TaskStatus }>()

/* 막힘만 destructive 로 세운다 — 안건이 안 정해져 멈춘 것이 이 앱이 잡으려는 문제다. */
const variant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(() => {
  if (props.status === 'done') return 'default'
  if (props.status === 'blocked') return 'destructive'
  if (props.status === 'doing') return 'secondary'
  return 'outline'
})
</script>

<template>
  <Badge :variant="variant" class="whitespace-nowrap">{{ taskStatusLabel(status) }}</Badge>
</template>

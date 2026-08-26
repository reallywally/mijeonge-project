<script setup lang="ts">
import { computed } from 'vue'
import type { ThreadState } from '@/types/domain'

const props = defineProps<{ state: ThreadState; deferCount?: number }>()

const look = computed(() => {
  if (props.state === 'queued') return { label: '다음 회의 대기', cls: 'bg-chip text-secondary-foreground' }
  if (props.state === 'open') return { label: `${props.deferCount ?? 0}번 미뤄짐`, cls: 'bg-brand-bg text-brand' }
  return { label: '결정됨', cls: 'bg-ok-bg text-ok' }
})
</script>

<template>
  <span
    class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] whitespace-nowrap"
    :class="look.cls"
  >
    <span class="size-[5px] rounded-full bg-current" />
    {{ look.label }}
  </span>
</template>

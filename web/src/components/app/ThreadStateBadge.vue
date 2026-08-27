<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { ThreadState } from '@/types/domain'

const props = defineProps<{ state: ThreadState; deferCount?: number }>()

/* 상태를 shadcn Badge 기본 배리언트에 얹는다.
   3번 이상 미뤄진 것만 destructive 로 따로 세운다 — 이 앱이 잡으려는 문제라서. */
const look = computed<{ label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }>(() => {
  if (props.state === 'decided') return { label: '결정됨', variant: 'default' }
  if (props.state === 'queued') return { label: '다음 회의 대기', variant: 'outline' }
  const n = props.deferCount ?? 0
  return { label: `${n}번 미뤄짐`, variant: n >= 3 ? 'destructive' : 'secondary' }
})
</script>

<template>
  <Badge :variant="look.variant" class="whitespace-nowrap">{{ look.label }}</Badge>
</template>

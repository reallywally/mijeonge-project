<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { SpecState } from '@/types/domain'

const props = defineProps<{ state: SpecState }>()

/* 요청이 멈추는 가장 흔한 자리가 "무엇을 해달라는 건지 아직 모름"이라, 목록에서도 보이게 한다.
   다시 정리해야 하는 것만 destructive 로 세운다 — 확정해 놓고 대화가 흘러간 경우다. */
const look = computed<{ label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }>(() => {
  if (props.state === 'confirmed') return { label: '확정', variant: 'default' }
  if (props.state === 'stale') return { label: '다시 정리', variant: 'destructive' }
  if (props.state === 'draft') return { label: '초안', variant: 'secondary' }
  return { label: '정리 중', variant: 'outline' }
})
</script>

<template>
  <Badge :variant="look.variant" class="whitespace-nowrap">{{ look.label }}</Badge>
</template>

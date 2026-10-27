<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { testStatusLabel } from '@/lib/testcase'
import type { TestStatus } from '@/types/domain'

const props = defineProps<{ status: TestStatus }>()

/* 실패 · 막힘만 destructive 로 세운다 — 손쓸 것이 거기 있다. 성공은 채우고, 테스트 중은 옅게 채운다 */
const variant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(() => {
  if (props.status === 'pass') return 'default'
  if (props.status === 'fail' || props.status === 'blocked') return 'destructive'
  if (props.status === 'testing') return 'secondary'
  return 'outline'
})
</script>

<template>
  <Badge :variant="variant" class="whitespace-nowrap" :data-test-status="status">{{
    testStatusLabel(status)
  }}</Badge>
</template>

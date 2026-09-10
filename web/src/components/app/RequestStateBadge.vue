<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { RequestState } from '@/types/domain'

const props = defineProps<{ state: RequestState }>()

const look = computed<{ label: string; variant: 'default' | 'secondary' | 'outline' }>(() => {
  if (props.state === 'done') return { label: '완료', variant: 'default' }
  if (props.state === 'doing') return { label: '하는 중', variant: 'secondary' }
  return { label: '요청됨', variant: 'outline' }
})
</script>

<template>
  <Badge :variant="look.variant" class="whitespace-nowrap">{{ look.label }}</Badge>
</template>

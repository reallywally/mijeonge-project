<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { EntryKind } from '@/types/domain'

const props = defineProps<{ kind: EntryKind }>()

/* 안건에 붙는 여섯 가지 행위. 결정을 남긴 줄(결정 · 변경)만 채운 배지로 세운다 —
   이력을 훑을 때 눈에 걸려야 하는 건 "여기서 뭔가 정해졌다"는 표시다. */
const LOOK: Record<EntryKind, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  decide: { label: '결정', variant: 'default' },
  change: { label: '변경', variant: 'default' },
  refine: { label: '세부 추가', variant: 'secondary' },
  split: { label: '하위 안건으로 분리', variant: 'outline' },
  defer: { label: '미룸', variant: 'secondary' },
  raise: { label: '제기', variant: 'outline' },
}

const look = computed(() => LOOK[props.kind])
</script>

<template>
  <Badge :variant="look.variant" class="whitespace-nowrap rounded-sm">{{ look.label }}</Badge>
</template>

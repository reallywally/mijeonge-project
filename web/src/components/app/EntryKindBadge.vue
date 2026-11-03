<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { ENTRY_KIND_LABEL } from '@/lib/history'
import type { EntryKind } from '@/types/domain'

const props = defineProps<{ kind: EntryKind }>()

/* 안건에 붙는 여섯 가지 행위. 결정을 남긴 줄(결정 · 변경)만 채운 배지로 세운다 —
   이력을 훑을 때 눈에 걸려야 하는 건 "여기서 뭔가 정해졌다"는 표시다. */
const VARIANT: Record<EntryKind, 'default' | 'secondary' | 'outline'> = {
  decide: 'default',
  change: 'default',
  refine: 'secondary',
  split: 'outline',
  defer: 'secondary',
  raise: 'outline',
}

const look = computed(() => ({ label: ENTRY_KIND_LABEL[props.kind], variant: VARIANT[props.kind] }))
</script>

<template>
  <Badge :variant="look.variant" class="whitespace-nowrap rounded-sm">{{ look.label }}</Badge>
</template>

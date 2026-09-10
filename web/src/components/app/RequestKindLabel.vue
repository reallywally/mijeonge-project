<script setup lang="ts">
import { computed } from 'vue'
import type { RequestKind } from '@/types/domain'

const props = defineProps<{ kind: RequestKind }>()

const LABEL: Record<RequestKind, string> = {
  data: '데이터 정리',
  check: '확인',
  etc: '기타',
}

const label = computed(() => LABEL[props.kind])
</script>

<template>
  <span class="inline-flex h-[21px] shrink-0 items-center rounded-sm border border-border bg-muted/50 px-2 text-[11px] text-muted-foreground">
    {{ label }}
  </span>
</template>

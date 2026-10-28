<script setup lang="ts">
import { computed } from 'vue'
import { usePartStore } from '@/stores/part'

/* 작업 · 안건이 속한 파트. 공통(null)이면 아무것도 그리지 않는다 — 대부분이 공통이라 칩이 붙으면 노이즈다 */
const props = defineProps<{ partId: string | null }>()
const partStore = usePartStore()
const name = computed(() => partStore.partName(props.partId))
</script>

<template>
  <span
    v-if="name"
    class="inline-flex h-5 max-w-[120px] shrink-0 items-center rounded-[4px] bg-secondary px-1.5 text-[11.5px] font-medium text-secondary-foreground/80"
    :title="`파트 · ${name}`"
    data-part-chip
  >
    <span class="truncate">{{ name }}</span>
  </span>
</template>

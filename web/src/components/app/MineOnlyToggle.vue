<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import { useTaskStore } from '@/stores/task'

/* 내 작업만 — 작업 간트가 따른다(스토어가 브라우저에 기억한다). 내가 등록했거나 담당인 작업만 남기고,
   트리가 끊기지 않게 그 상위 작업은 흐리게 세운다 */
const taskStore = useTaskStore()
</script>

<template>
  <div class="flex items-center gap-2">
    <label class="flex cursor-pointer items-center gap-1.5 text-xs">
      <Checkbox
        :model-value="taskStore.mineOnly"
        aria-label="내 작업만"
        data-mine-only
        @update:model-value="(v) => taskStore.setMineOnly(v === true)"
      />
      내 작업만
    </label>
    <span
      v-if="taskStore.mineOnly"
      class="text-xs text-muted-foreground"
      title="내가 등록했거나 담당인 작업"
      data-mine-count
      >등록 · 담당 {{ taskStore.mineShownCount }}건</span
    >
  </div>
</template>

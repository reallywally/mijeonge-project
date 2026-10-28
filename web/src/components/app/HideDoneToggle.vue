<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import { useTaskStore } from '@/stores/task'

/* 완료 숨기기 — 작업 목록 · 간트가 같은 값을 따른다(스토어가 브라우저에 기억한다).
   몇 건이 숨었는지는 화면마다 다르게 세어 넘겨받는다 — 목록은 조회 조건 안에서, 간트는 전체에서 */
defineProps<{
  /** 실제로 숨은 완료 작업 수. 0 이면 적지 않는다 */
  hidden: number
  /** 다른 조건이 완료를 직접 골라 숨기기가 안 먹을 때 — 그 이유 */
  disabledReason?: string
}>()

const taskStore = useTaskStore()
</script>

<template>
  <div class="flex items-center gap-2" :title="disabledReason">
    <label
      class="flex items-center gap-1.5 text-xs"
      :class="disabledReason ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'"
    >
      <Checkbox
        :model-value="taskStore.hideDone"
        :disabled="!!disabledReason"
        aria-label="완료 숨기기"
        data-hide-done
        @update:model-value="(v) => taskStore.setHideDone(v === true)"
      />
      완료 숨기기
    </label>
    <span
      v-if="hidden > 0 && !disabledReason"
      class="text-xs text-muted-foreground"
      data-hidden-done
      >완료 {{ hidden }}건 숨김</span
    >
  </div>
</template>

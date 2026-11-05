<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'

/* 내 것만 — 작업 간트('내 작업만')와 테스트 간트('내 테스트만')가 같이 쓴다. 무엇이 내 것인지는 스토어가 정한다.
   건수는 옆에 적지 않고 가리킬 때만 보인다 — 켜고 끌 때 체크박스 옆이 늘었다 줄면 다시 누르기 불편하다 */
const props = defineProps<{
  label: string
  /** 켰을 때 가리키면 보일 말 — 예: '등록 · 담당 3건' */
  countTitle: string
}>()
const on = defineModel<boolean>({ required: true })
</script>

<template>
  <div class="flex items-center gap-2">
    <label
      class="flex cursor-pointer items-center gap-1.5 text-xs"
      :title="on ? props.countTitle : undefined"
      data-mine-count
    >
      <Checkbox
        :model-value="on"
        :aria-label="props.label"
        data-mine-only
        @update:model-value="(v) => (on = v === true)"
      />
      {{ props.label }}
    </label>
  </div>
</template>

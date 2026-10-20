<script setup lang="ts">
import { computed } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { useDataStore } from '@/stores/data'

/* 담당자 고르기 — 작업 속성 칸의 것과 같은 모양(미정 + 고른 프로젝트의 활성 멤버).
   AI 가 사람을 못 정해 부른 말(hint)만 남겼으면 비어 있는 동안 "회의록: 김 책임 — 골라 주세요" 를 띄운다 */
const props = defineProps<{
  label: string
  hint?: string
}>()
const ownerId = defineModel<string | null>({ required: true })

const data = useDataStore()
const NONE = 'none'

const ownerName = computed(() => data.memberName(ownerId.value))
const hinted = computed(() => ownerId.value === null && !!props.hint)
</script>

<template>
  <Select
    :model-value="ownerId ?? NONE"
    @update:model-value="(v) => (ownerId = v === NONE ? null : String(v))"
  >
    <SelectTrigger
      class="h-8 w-full bg-background text-xs"
      :class="hinted ? 'border-dashed' : ''"
      :aria-label="label"
      :data-owner-hint="hinted ? hint : undefined"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span
          class="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-secondary text-[10px]"
          :class="ownerName ? '' : 'text-muted-foreground'"
        >
          {{ ownerName ? ownerName.charAt(0) : '–' }}
        </span>
        <span class="truncate" :class="ownerName ? '' : 'text-muted-foreground'">
          {{ ownerName ?? (hinted ? `회의록: ${hint} — 골라 주세요` : '미정') }}
        </span>
      </span>
    </SelectTrigger>
    <SelectContent>
      <SelectItem :value="NONE">미정 (담당자 없음)</SelectItem>
      <SelectItem v-for="m in data.assignable" :key="m.id" :value="m.id">
        {{ m.name }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>

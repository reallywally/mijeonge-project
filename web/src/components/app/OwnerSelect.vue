<script setup lang="ts">
import { computed } from 'vue'
import MemberPicker from '@/components/app/MemberPicker.vue'
import { cn } from '@/lib/utils'
import { useDataStore } from '@/stores/data'

/* 담당자 고르기 — 작업 · 안건 · 테스트의 속성 칸과 회의록 검토가 같이 쓴다(미정 + 고른 프로젝트의 활성 멤버, 이름으로 찾기).
   속성 패널은 triggerClass 로 ghost 모양을 준다.
   AI 가 사람을 못 정해 부른 말(hint)만 남겼으면 비어 있는 동안 "회의록: 김 책임 — 골라 주세요" 를 띄운다 */
const props = defineProps<{
  label: string
  hint?: string
  triggerClass?: string
  disabled?: boolean
}>()
const ownerId = defineModel<string | null>({ required: true })

const data = useDataStore()

const ownerName = computed(() => data.memberName(ownerId.value))
const hinted = computed(() => ownerId.value === null && !!props.hint)
</script>

<template>
  <MemberPicker
    :label="label"
    :selected-id="ownerId"
    allow-none
    :disabled="disabled"
    :trigger-class="cn('bg-background text-xs', hinted && 'border-dashed', triggerClass)"
    :data-owner-hint="hinted ? hint : undefined"
    @pick="(id) => (ownerId = id)"
  >
    <template #trigger>
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
    </template>
  </MemberPicker>
</template>

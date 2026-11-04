<script setup lang="ts">
import AgendaStateBadge from '@/components/app/AgendaStateBadge.vue'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { AGENDA_STATES } from '@/lib/agenda'
import type { AgendaState } from '@/types/domain'

/* 안건 상태 고르기 — 대기 · 논의중 · 결정됨. 사람이 직접 고른다(이력에서 세지 않는다).
   안건 추가와 상세의 속성 패널이 같이 쓴다 */
const state = defineModel<AgendaState>({ required: true })
defineProps<{ triggerClass: string; disabled?: boolean }>()
</script>

<template>
  <Select
    :model-value="state"
    :disabled="disabled"
    @update:model-value="(v) => (state = v as AgendaState)"
  >
    <SelectTrigger :class="triggerClass" aria-label="상태" data-agenda-state-select>
      <AgendaStateBadge :state="state" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="s in AGENDA_STATES" :key="s" :value="s" :data-agenda-state-option="s">
        <AgendaStateBadge :state="s" />
      </SelectItem>
    </SelectContent>
  </Select>
</template>

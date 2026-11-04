<script setup lang="ts">
import { computed } from 'vue'
import StatusPill, { type StatusTone } from '@/components/app/StatusPill.vue'
import { AGENDA_STATE_LABEL } from '@/lib/agenda'
import type { AgendaState } from '@/types/domain'

const props = defineProps<{ state: AgendaState }>()

const TONE: Record<AgendaState, StatusTone> = { queued: 'todo', open: 'doing', decided: 'done' }

const look = computed(() => ({ label: AGENDA_STATE_LABEL[props.state], tone: TONE[props.state] }))
</script>

<template>
  <StatusPill :tone="look.tone">{{ look.label }}</StatusPill>
</template>

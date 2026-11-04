<script setup lang="ts">
import { computed } from 'vue'
import { ListTree } from 'lucide-vue-next'
import { useDataStore } from '@/stores/data'

/* 요청이 걸린 안건 — 누르면 안건 상세 팝업. 근거 칩(ChatRefText)과 같은 모양이다.
   스냅샷에 없으면(그사이 지워졌거나 아직 못 받음) 누를 것이 없어 흐린 글씨만 둔다 */
const props = defineProps<{ agendaId: string }>()
const emit = defineEmits<{ open: [id: string] }>()

const data = useDataStore()
const agenda = computed(() => data.allAgendas.find((t) => t.id === props.agendaId) ?? null)
</script>

<template>
  <button
    v-if="agenda"
    type="button"
    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
    :data-check-agenda="agendaId"
    @click.stop="emit('open', agendaId)"
  >
    <ListTree class="size-3 shrink-0 text-muted-foreground" />
    <span class="truncate">{{ agenda.title }}</span>
  </button>
  <span v-else class="text-xs text-muted-foreground">찾을 수 없는 안건</span>
</template>

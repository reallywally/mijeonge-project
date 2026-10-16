<script setup lang="ts">
import { computed } from 'vue'
import { ListTree, SquareKanban } from 'lucide-vue-next'
import { useDataStore } from '@/stores/data'
import type { CheckTargetType } from '@/types/domain'

/* 요청이 걸린 작업 · 안건 — 누르면 기존 상세 팝업. 근거 칩(ChatRefText)과 같은 모양이다.
   스냅샷에 없으면(그사이 지워졌거나 아직 못 받음) 누를 것이 없어 흐린 글씨만 둔다 */
const props = defineProps<{ targetType: CheckTargetType; targetId: string }>()
const emit = defineEmits<{ 'open-thread': [id: string]; 'open-task': [id: string] }>()

const data = useDataStore()

const target = computed(() => {
  if (props.targetType === 'task') {
    const task = data.allTasks.find((t) => t.id === props.targetId)
    return task ? { key: task.key, title: task.title } : null
  }
  const thread = data.allThreads.find((t) => t.id === props.targetId)
  return thread ? { key: '', title: thread.title } : null
})

function open() {
  if (props.targetType === 'task') emit('open-task', props.targetId)
  else emit('open-thread', props.targetId)
}
</script>

<template>
  <button
    v-if="target"
    type="button"
    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
    :data-check-target="targetId"
    @click.stop="open"
  >
    <SquareKanban v-if="targetType === 'task'" class="size-3 shrink-0 text-muted-foreground" />
    <ListTree v-else class="size-3 shrink-0 text-muted-foreground" />
    <span v-if="target.key" class="shrink-0 font-mono text-muted-foreground">{{ target.key }}</span>
    <span class="truncate">{{ target.title }}</span>
  </button>
  <span v-else class="text-xs text-muted-foreground"
    >찾을 수 없는 {{ targetType === 'task' ? '작업' : '안건' }}</span
  >
</template>

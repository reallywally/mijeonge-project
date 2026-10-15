<script setup lang="ts">
import { computed } from 'vue'
import ThreadStateBadge from '@/components/app/ThreadStateBadge.vue'
import { splitRefs } from '@/lib/chat'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { ThreadState } from '@/types/domain'

/* AI 가 낸 답 본문. v-html 로 그리지 않고 줄바꿈만 살린다 — 근거 표시만 칩으로 바꾼다.
   스냅샷(지금 프로젝트)에 없는 id 는 그리지 않는다 — 지어낸 id 를 보이지 않는다 (docs/api/chat.md) */
const props = defineProps<{ text: string }>()
const emit = defineEmits<{ 'open-thread': [id: string]; 'open-task': [id: string] }>()

const threadStore = useThreadStore()
const taskStore = useTaskStore()

type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'thread'; id: string; title: string; state: ThreadState; deferCount: number }
  | { kind: 'task'; id: string; key: string; title: string }

const pieces = computed(() => {
  const out: Piece[] = []
  for (const seg of splitRefs(props.text)) {
    if ('text' in seg) out.push({ kind: 'text', text: seg.text })
    else if (seg.ref.kind === 'thread') {
      const row = threadStore.rows.find((r) => r.thread.id === seg.ref.id)
      if (row)
        out.push({
          kind: 'thread',
          id: row.thread.id,
          title: row.thread.title,
          state: row.thread.state,
          deferCount: row.deferCount,
        })
    } else {
      const task = taskStore.tasks.find((t) => t.id === seg.ref.id)
      if (task) out.push({ kind: 'task', id: task.id, key: task.key, title: task.title })
    }
  }
  return out
})
</script>

<template>
  <p class="text-sm leading-relaxed break-words whitespace-pre-wrap">
    <template v-for="(p, i) in pieces" :key="i">
      <template v-if="p.kind === 'text'">{{ p.text }}</template>
      <button
        v-else-if="p.kind === 'thread'"
        type="button"
        class="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 align-middle text-xs hover:bg-accent"
        :data-ref-thread="p.id"
        @click="emit('open-thread', p.id)"
      >
        <span class="truncate">{{ p.title }}</span>
        <ThreadStateBadge :state="p.state" :defer-count="p.deferCount" />
      </button>
      <button
        v-else
        type="button"
        class="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 align-middle text-xs hover:bg-accent"
        :data-ref-task="p.id"
        @click="emit('open-task', p.id)"
      >
        <span class="shrink-0 font-mono text-muted-foreground">{{ p.key }}</span>
        <span class="truncate">{{ p.title }}</span>
      </button>
    </template>
  </p>
</template>

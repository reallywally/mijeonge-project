<script setup lang="ts">
import { computed } from 'vue'
import { Ban, CircleCheck, CornerDownRight, ListPlus, Loader2 } from 'lucide-vue-next'
import PersonChip from '@/components/app/PersonChip.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { slashDay } from '@/lib/date'
import { taskPriorityLabel } from '@/lib/task'
import { useDataStore } from '@/stores/data'
import { useTaskStore } from '@/stores/task'
import type { ChatProposal, ProposedTask, Task } from '@/types/domain'

/* 챗봇 답 안의 작업 초안. 챗봇은 저장하지 않는다 — 사람이 [등록] 을 눌러야 들어간다 (API.md '작업 초안') */
const props = defineProps<{
  proposal: ChatProposal
  registering: boolean
}>()

const emit = defineEmits<{ register: []; cancel: [] }>()

const data = useDataStore()
const taskStore = useTaskStore()

/* 깊이는 셋까지만 들인다 — 좁은 창이라 더 들이면 제목이 밀려난다 */
const INDENT = ['', 'pl-5', 'pl-10', 'pl-15']

/** 상위가 늘 앞에 있으므로 앞에서부터 깊이를 센다. 이미 있는 작업 밑에 붙는 것은 한 칸 들인다 */
const depthOf = computed<Record<string, number>>(() => {
  const depth: Record<string, number> = {}
  for (const t of props.proposal.tasks)
    depth[t.tempId] =
      t.parentTempId !== null ? (depth[t.parentTempId] ?? -1) + 1 : t.parentId !== null ? 1 : 0
  return depth
})

/** 초안이 붙을 이미 있는 작업들 — 처음 나온 순서대로. 지금 레코드에 없으면 id 만 보인다 */
const anchors = computed(() =>
  [...new Set(props.proposal.tasks.map((t) => t.parentId).filter((id) => id !== null))].map(
    (id) => ({ id, task: taskStore.tasks.find((k) => k.id === id) }),
  ),
)

const indent = (tempId: string) => INDENT[Math.min(depthOf.value[tempId] ?? 0, INDENT.length - 1)]

function period(t: ProposedTask) {
  if (t.start && t.due) return `${slashDay(t.start)} ~ ${slashDay(t.due)}`
  if (t.start) return `${slashDay(t.start)} ~`
  if (t.due) return `~ ${slashDay(t.due)}`
  return ''
}

/** 등록된 작업 — key 로 찾는다. 지금 레코드에 없는 것은 그리지 않는다 */
const registered = computed(() => {
  const keys = props.proposal.keyByTempId ?? {}
  return props.proposal.tasks
    .map((t) => ({
      tempId: t.tempId,
      task: taskStore.tasks.find((k) => k.key === keys[t.tempId]),
    }))
    .filter((r): r is { tempId: string; task: Task } => r.task !== undefined)
})
</script>

<template>
  <p
    v-if="proposal.status === 'cancelled'"
    class="flex items-center gap-1.5 text-xs text-muted-foreground opacity-70"
  >
    <Ban class="size-3.5" />
    작업 초안 {{ proposal.tasks.length }}건 · 취소함
  </p>

  <div
    v-else-if="proposal.status === 'registered'"
    class="w-full rounded-lg border border-border bg-card p-3 text-sm"
  >
    <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CircleCheck class="size-3.5" />
      작업 {{ proposal.tasks.length }}건을 등록했습니다
    </p>
    <ul class="mt-2 flex flex-col gap-1">
      <li v-for="r in registered" :key="r.tempId" :class="indent(r.tempId)">
        <RouterLink
          :to="`/tasks/${r.task.id}`"
          class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
        >
          <span class="shrink-0 font-mono text-muted-foreground">{{ r.task.key }}</span>
          <span class="truncate">{{ r.task.title }}</span>
        </RouterLink>
      </li>
    </ul>
  </div>

  <div v-else class="w-full rounded-lg border border-border bg-card p-3 text-sm">
    <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ListPlus class="size-3.5" />
      작업 초안 {{ proposal.tasks.length }}건 · 아직 등록 전
    </p>
    <p
      v-for="a in anchors"
      :key="a.id"
      class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
      data-proposal-anchor
    >
      <span class="font-mono">{{ a.task?.key ?? a.id }}</span>
      <span class="truncate font-medium text-foreground">{{ a.task?.title }}</span>
      <span class="shrink-0">밑에 붙습니다</span>
    </p>
    <ul class="mt-2 flex flex-col gap-2">
      <li
        v-for="t in proposal.tasks"
        :key="t.tempId"
        :class="['flex gap-1.5', indent(t.tempId)]"
        data-proposed-task
      >
        <CornerDownRight
          v-if="t.parentTempId !== null || t.parentId !== null"
          class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
        <div class="flex min-w-0 flex-col gap-1">
          <span class="font-medium break-words">{{ t.title }}</span>
          <div
            v-if="t.ownerId || t.start || t.due || t.priority !== 'normal'"
            class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          >
            <PersonChip v-if="data.memberName(t.ownerId)" :name="data.memberName(t.ownerId)!" />
            <span v-if="period(t)">{{ period(t) }}</span>
            <Badge v-if="t.priority !== 'normal'" variant="outline">
              우선순위 {{ taskPriorityLabel(t.priority) }}
            </Badge>
          </div>
        </div>
      </li>
    </ul>
    <div class="mt-3 flex justify-end gap-2">
      <Button variant="ghost" size="sm" :disabled="registering" @click="emit('cancel')">
        취소
      </Button>
      <Button size="sm" :disabled="registering" @click="emit('register')">
        <Loader2 v-if="registering" class="animate-spin" />
        {{ registering ? '등록하는 중' : '등록' }}
      </Button>
    </div>
  </div>
</template>

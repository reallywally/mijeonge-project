<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import SearchPicker from '@/components/app/SearchPicker.vue'
import { DEPENDENCY_REASONS } from '@/lib/dependency'
import { taskStatusLabel } from '@/lib/task'
import { useTaskStore } from '@/stores/task'
import type { Task, TaskStatus } from '@/types/domain'

/* 선행 작업 — 작업 상세의 한 묶음. 고르면 바로 걸리고, 칩의 X 로 뗀다.
   선행이 안 끝나도 막지 않는다 — 칩에 상태 점을 찍어 알려 주기만 한다 (docs/api/task-flow.md).
   '이 작업을 기다리는 작업' 은 그 작업의 상세에서 거는 것이라 여기서는 읽기만 한다 */
const props = defineProps<{ taskId: string }>()
const emit = defineEmits<{ (e: 'open-task', id: string): void }>()

const taskStore = useTaskStore()

const dependsOn = computed(() => taskStore.dependsOnOf(props.taskId))
const dependents = computed(() => taskStore.dependentsOf(props.taskId))
const choices = computed(() => taskStore.dependencyChoicesFor(props.taskId))
const unfinished = computed(() => dependsOn.value.filter((t) => t.status !== 'done').length)

const DOT: Record<Exclude<TaskStatus, 'done'>, string> = {
  todo: 'bg-muted-foreground',
  doing: 'bg-primary',
  blocked: 'bg-destructive',
}
const dotOf = (t: Task) => (t.status === 'done' ? null : DOT[t.status])

const chip =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background pl-2 text-xs'
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" data-task-dependencies>
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">선행 작업</span>
      <span class="text-xs text-muted-foreground">{{ dependsOn.length }}건</span>
      <span class="grow" />
      <span class="truncate text-xs text-muted-foreground">이 작업보다 먼저 끝나야 하는 작업</span>
    </div>

    <SearchPicker
      :items="choices"
      :text="(c) => `${c.task.key} ${c.task.title}`"
      :key-of="(c) => c.task.id"
      :disabled-reason="(c) => (c.problem ? DEPENDENCY_REASONS[c.problem] : null)"
      placeholder="작업 번호나 제목으로 찾기"
      empty-label="선행으로 걸 수 있는 작업이 없습니다"
      @pick="(c) => taskStore.addDependency(taskId, c.task.id)"
    >
      <template #item="{ item }">
        <span class="shrink-0 text-muted-foreground">{{ item.task.key }}</span>
        <span class="min-w-0 grow truncate">{{ item.task.title }}</span>
      </template>
    </SearchPicker>

    <div v-if="dependsOn.length" class="flex flex-wrap gap-1.5">
      <span v-for="t in dependsOn" :key="t.id" :class="chip" data-depends-on>
        <span
          v-if="dotOf(t)"
          class="size-1.5 shrink-0 rounded-full"
          :class="dotOf(t)"
          :title="`아직 안 끝남 — ${taskStatusLabel(t.status)}`"
          :aria-label="`아직 안 끝남 — ${taskStatusLabel(t.status)}`"
          data-unfinished
        />
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 underline-offset-4 hover:underline"
          @click="emit('open-task', t.id)"
        >
          <span class="shrink-0 text-muted-foreground">{{ t.key }}</span>
          <span class="truncate" :class="t.status === 'done' ? 'text-muted-foreground' : ''">{{
            t.title
          }}</span>
        </button>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="`${t.title} 선행에서 빼기`"
          title="선행에서 빼기"
          @click="taskStore.removeDependency(taskId, t.id)"
        >
          <X class="size-3" />
        </button>
      </span>
    </div>
    <p v-else class="text-xs text-muted-foreground">선행 작업이 없습니다.</p>
    <p v-if="unfinished > 0" class="text-xs text-muted-foreground">
      아직 안 끝난 선행 작업이 {{ unfinished }}건 있습니다. 시작은 막지 않습니다.
    </p>

    <div class="mt-1 flex items-baseline gap-2">
      <span class="text-xs font-medium">이 작업을 기다리는 작업</span>
      <span class="text-xs text-muted-foreground">{{ dependents.length }}건</span>
    </div>
    <div v-if="dependents.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="t in dependents"
        :key="t.id"
        type="button"
        :class="[chip, 'pr-2 underline-offset-4 hover:underline']"
        data-dependent
        @click="emit('open-task', t.id)"
      >
        <span class="shrink-0 text-muted-foreground">{{ t.key }}</span>
        <span class="truncate">{{ t.title }}</span>
      </button>
    </div>
    <p v-else class="text-xs text-muted-foreground">이 작업을 기다리는 작업이 없습니다.</p>
  </section>
</template>

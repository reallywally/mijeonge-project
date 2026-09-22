<script setup lang="ts">
import { computed } from 'vue'
import { ListTree, Plus } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TASK_STATUS_OPTIONS } from '@/lib/task'
import { useTaskStore } from '@/stores/task'
import type { TaskStatus } from '@/types/domain'

/* 칸반보드 — 목록과 같은 작업을 상태로만 갈라 놓은 것이다.
   묶음 작업(자식이 있는 작업)은 카드가 되지 않는다. 잎 작업만 올라온다 —
   묶음은 자기 일이 아니라 아래 것들의 합이라 칸을 옮긴다는 말이 성립하지 않는다. */
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-task', status: TaskStatus): void
  (e: 'open-thread', id: string): void
}>()

const taskStore = useTaskStore()

/* 칸 머리의 점 — 목록에서 제목 앞에 세우는 띠와 같은 색이다 */
const dotClass: Record<TaskStatus, string> = {
  todo: 'bg-border',
  doing: 'bg-primary',
  blocked: 'bg-destructive',
  done: 'bg-muted-foreground/40',
}

const columns = computed(() => {
  const leaves = taskStore.rows.filter((r) => r.childCount === 0)
  return TASK_STATUS_OPTIONS.map((o) => ({
    ...o,
    dot: dotClass[o.value],
    cards: leaves.filter((r) => r.task.status === o.value),
  }))
})

/* 배지를 누르면 그 안건으로 간다. 여러 건 걸린 작업은 첫 번째로 보내고
   나머지는 작업 상세에서 본다 — 배지 하나로 여러 곳을 가리킬 수는 없다 */
function openThread(taskId: string) {
  const first = taskStore.threadsOfTask(taskId)[0]
  if (first) emit('open-thread', first.id)
}

const threadTitles = (taskId: string) =>
  taskStore
    .threadsOfTask(taskId)
    .map((t) => t.title)
    .join(' · ')
</script>

<template>
  <div class="flex min-h-0 grow flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-[26px]">
      <div class="grow" />
      <span class="text-xs text-muted-foreground">
        카드의 상태를 바꾸면 칸이 옮겨집니다. 묶음 작업은 카드가 되지 않습니다.
      </span>
    </div>

    <div class="flex min-h-0 grow gap-2.5 overflow-x-hidden px-4 py-3.5">
      <section
        v-for="col in columns"
        :key="col.value"
        :data-column="col.value"
        class="flex min-w-0 grow basis-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/50"
      >
        <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span class="size-[7px] shrink-0 rounded-full" :class="col.dot" />
          <span class="text-sm font-medium">{{ col.label }}</span>
          <span class="text-xs text-muted-foreground">{{ col.cards.length }}</span>
        </header>

        <div class="flex min-h-0 grow flex-col gap-2 overflow-y-auto p-2.5">
          <div
            v-for="row in col.cards"
            :key="row.task.id"
            :data-task-id="row.task.id"
            role="button"
            tabindex="0"
            class="group flex shrink-0 cursor-pointer flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5 shadow-sm hover:border-muted-foreground/40"
            @click="emit('open-task', row.task.id)"
            @keydown.enter="emit('open-task', row.task.id)"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">{{ row.task.key }}</span>
              <div class="grow" />
              <button
                v-if="row.threadCount > 0"
                type="button"
                :title="threadTitles(row.task.id)"
                :aria-label="`${row.task.title} 연관 안건`"
                @click.stop="openThread(row.task.id)"
              >
                <Badge :variant="row.task.status === 'blocked' ? 'destructive' : 'outline'">
                  <ListTree class="size-3" />
                  안건 {{ row.threadCount }}
                </Badge>
              </button>
            </div>

            <span
              class="text-sm leading-snug text-pretty underline-offset-4 group-hover:underline"
              :class="row.task.status === 'done' ? 'text-muted-foreground' : ''"
            >
              {{ row.task.title }}
            </span>
            <span class="truncate text-xs text-muted-foreground">{{ row.pathLabel }}</span>

            <div class="flex items-center gap-2">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs"
                :class="row.ownerName ? '' : 'text-muted-foreground'"
              >
                {{ row.ownerName ? row.ownerName.charAt(0) : '–' }}
              </span>
              <span
                class="truncate text-xs"
                :class="row.undated ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ row.undated ? '기간 미정' : row.periodLabel }}
              </span>
              <div class="grow" />
              <div class="shrink-0" @click.stop>
                <Select
                  :model-value="row.task.status"
                  @update:model-value="(v) => taskStore.setStatus(row.task.id, v as TaskStatus)"
                >
                  <SelectTrigger class="h-7 w-[104px] bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="o in TASK_STATUS_OPTIONS" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <p
            v-if="col.cards.length === 0"
            class="flex h-[68px] shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
          >
            비어 있습니다
          </p>

          <button
            type="button"
            class="flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            @click="emit('add-task', col.value)"
          >
            <Plus class="size-3.5" />
            작업 추가
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import SearchPicker from '@/components/app/SearchPicker.vue'
import { taskStatusLabel } from '@/lib/task'
import { RELATED_LIMIT, useTaskStore } from '@/stores/task'
import type { TaskRow, TaskStatus } from '@/types/domain'

/* 연관 작업 — 작업 상세의 한 묶음(Q61). 한 방향이라 이 작업이 건 것만 보이고, 걸린 쪽 상세에는 안 보인다.
   '연관 작업 추가' 로 찾기 칸을 열어 하나씩 골라 잇달아 걸고(고를 때마다 바로 저장), 줄의 X 로 뗀다 */
const props = defineProps<{ taskId: string; related: TaskRow[] }>()
const emit = defineEmits<{ (e: 'open-task', id: string): void }>()

const taskStore = useTaskStore()

const choices = computed(() => taskStore.relatedOptionsFor(props.taskId))
const full = computed(() => props.related.length >= RELATED_LIMIT)

const DOT: Record<TaskStatus, string> = {
  todo: 'bg-border',
  doing: 'bg-primary',
  blocked: 'bg-destructive',
  done: 'bg-muted-foreground/40',
}

const adding = ref(false)
const pickerBox = ref<HTMLElement | null>(null)

async function openPicker() {
  adding.value = true
  await nextTick()
  pickerBox.value?.querySelector('input')?.focus()
}

/* 다른 작업으로 옮기면 찾기 칸을 닫는다 */
watch(
  () => props.taskId,
  () => {
    adding.value = false
  },
)
</script>

<template>
  <section class="flex flex-col gap-2.5" data-task-related>
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">연관 작업</span>
      <span class="text-xs text-muted-foreground">{{ related.length }}건</span>
      <span class="grow" />
      <span class="truncate text-xs text-muted-foreground">이 작업과 이어진 작업</span>
    </div>

    <div class="flex flex-col overflow-hidden rounded-md border border-border">
      <div
        class="flex h-8 items-center gap-3 border-b border-border bg-muted/50 px-3 text-xs font-medium tracking-wider text-muted-foreground"
      >
        <span class="min-w-0 grow">작업</span>
        <span class="w-[92px] shrink-0">상태</span>
        <span class="w-14 shrink-0">담당자</span>
        <span class="w-6 shrink-0" />
      </div>

      <div
        v-for="row in related"
        :key="row.task.id"
        class="flex min-h-[38px] items-center gap-3 border-b border-border px-3 py-1"
        data-related-row
      >
        <span class="flex min-w-0 grow items-center gap-2.5">
          <span class="shrink-0 text-xs text-muted-foreground">{{ row.task.key }}</span>
          <button
            type="button"
            class="min-w-0 truncate text-left text-sm underline-offset-4 hover:underline"
            :class="row.task.status === 'done' ? 'text-muted-foreground' : ''"
            @click="emit('open-task', row.task.id)"
          >
            {{ row.task.title }}
          </button>
        </span>
        <span class="flex w-[92px] shrink-0 items-center gap-1.5 text-xs">
          <span class="size-1.5 shrink-0 rounded-full" :class="DOT[row.task.status]" />
          {{ taskStatusLabel(row.task.status) }}
        </span>
        <span class="w-14 shrink-0 truncate text-xs text-muted-foreground">
          {{ row.ownerName ?? '미정' }}
        </span>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="`${row.task.title} 연관에서 빼기`"
          title="연관에서 빼기"
          @click="taskStore.removeRelated(taskId, row.task.id)"
        >
          <X class="size-3" />
        </button>
      </div>

      <p
        v-if="related.length === 0"
        class="border-b border-border px-3 py-2.5 text-xs text-muted-foreground"
      >
        연관 작업이 없습니다.
      </p>

      <div
        v-if="adding"
        ref="pickerBox"
        class="flex items-center gap-2 px-2 py-1.5"
        data-related-picker
      >
        <SearchPicker
          class="grow"
          :items="full ? [] : choices"
          :text="(t) => `${t.key} ${t.title}`"
          :key-of="(t) => t.id"
          placeholder="작업 번호나 제목으로 찾기 — 골라서 잇달아 겁니다"
          :empty-label="
            full ? `연관 작업은 ${RELATED_LIMIT}개까지입니다` : '더 걸 수 있는 작업이 없습니다'
          "
          @pick="(t) => taskStore.addRelated(taskId, [t.id])"
        >
          <template #item="{ item }">
            <span class="shrink-0 text-muted-foreground">{{ item.key }}</span>
            <span class="min-w-0 grow truncate">{{ item.title }}</span>
          </template>
        </SearchPicker>
        <button
          type="button"
          class="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          @click="adding = false"
        >
          닫기
        </button>
      </div>
      <button
        v-else
        type="button"
        class="flex min-h-[34px] items-center gap-1.5 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        @click="openPicker"
      >
        <Plus class="size-3.5" />
        연관 작업 추가
      </button>
    </div>
  </section>
</template>

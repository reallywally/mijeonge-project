<script setup lang="ts">
import { computed } from 'vue'
import { ListTree, SquareKanban, X } from 'lucide-vue-next'
import SearchPicker from '@/components/app/SearchPicker.vue'
import { TEST_REF_MAX } from '@/lib/testcase'
import { useTaskStore } from '@/stores/task'
import { useTestStore } from '@/stores/test'
import { useThreadStore } from '@/stores/thread'
import type { TestRef } from '@/types/domain'

/* 태그 — 테스트에 거는 작업 · 안건 참조. 작업 번호나 안건 제목으로 찾아 걸고(상위 작업 찾기와 같은 찾기),
   칩을 누르면 그 작업 · 안건 상세로 간다. 작업이 지워지면 서버가 그 태그만 뺀다 */
const props = defineProps<{ refs: TestRef[] }>()
const emit = defineEmits<{
  (e: 'add', ref: TestRef): void
  (e: 'remove', ref: TestRef): void
  (e: 'open', ref: TestRef): void
}>()

const testStore = useTestStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()

const chips = computed(() => props.refs.map(testStore.refChip))
const full = computed(() => props.refs.length >= TEST_REF_MAX)

interface Choice {
  ref: TestRef
  key: string
  title: string
}

/* 고를 것 — 아직 안 건 작업(번호 · 제목) · 안건(제목) */
const choices = computed<Choice[]>(() => {
  if (full.value) return []
  const has = (kind: TestRef['kind'], id: string) =>
    props.refs.some((r) => r.kind === kind && r.id === id)
  return [
    ...taskStore.tasks
      .filter((t) => !has('task', t.id))
      .map((t) => ({ ref: { kind: 'task' as const, id: t.id }, key: t.key, title: t.title })),
    ...threadStore.threads
      .filter((t) => !has('thread', t.id))
      .map((t) => ({ ref: { kind: 'thread' as const, id: t.id }, key: '안건', title: t.title })),
  ]
})

const chip =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background pl-2 text-xs'
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" data-test-refs>
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">태그</span>
      <span class="text-xs text-muted-foreground">{{ refs.length }}건</span>
      <span class="grow" />
      <span class="truncate text-xs text-muted-foreground"
        >이 테스트가 확인하는 작업 · 안건 — 없어도 됩니다</span
      >
    </div>

    <SearchPicker
      :items="choices"
      :text="(c) => `${c.key} ${c.title}`"
      :key-of="(c) => `${c.ref.kind}:${c.ref.id}`"
      placeholder="작업 번호나 안건 제목으로 찾기"
      :empty-label="
        full ? `태그는 ${TEST_REF_MAX}개까지 겁니다` : '걸 수 있는 작업 · 안건이 없습니다'
      "
      @pick="(c) => emit('add', c.ref)"
    >
      <template #item="{ item }">
        <component
          :is="item.ref.kind === 'task' ? SquareKanban : ListTree"
          class="size-3 shrink-0 text-muted-foreground"
        />
        <span class="shrink-0 text-muted-foreground">{{ item.key }}</span>
        <span class="min-w-0 grow truncate">{{ item.title }}</span>
      </template>
    </SearchPicker>

    <div v-if="chips.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="c in chips"
        :key="`${c.ref.kind}:${c.ref.id}`"
        :class="chip"
        :data-test-ref="`${c.ref.kind}:${c.ref.id}`"
      >
        <component
          :is="c.ref.kind === 'task' ? SquareKanban : ListTree"
          class="size-3 shrink-0 text-muted-foreground"
        />
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 underline-offset-4 enabled:hover:underline"
          :disabled="c.missing"
          :title="c.title"
          @click="emit('open', c.ref)"
        >
          <span class="truncate" :class="c.missing ? 'text-muted-foreground' : ''">{{
            c.label
          }}</span>
          <span
            v-if="c.ref.kind === 'task' && !c.missing"
            class="max-w-[160px] truncate text-muted-foreground"
            >{{ c.title }}</span
          >
        </button>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="`${c.label} 태그 떼기`"
          title="태그 떼기"
          @click="emit('remove', c.ref)"
        >
          <X class="size-3" />
        </button>
      </span>
    </div>
    <p v-else class="text-xs text-muted-foreground">건 작업 · 안건이 없습니다.</p>
  </section>
</template>

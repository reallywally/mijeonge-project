<script setup lang="ts">
import { computed } from 'vue'
import TestSignalChips from '@/components/app/TestSignalChips.vue'
import TestStatusBadge from '@/components/app/TestStatusBadge.vue'
import { testStatusLabel } from '@/lib/testcase'
import { useTestStore } from '@/stores/test'
import type { TestRow, TestStatus } from '@/types/domain'

/* 묶음의 하위 요약 — 묶음은 직접 돌리지 않는다. 상태별 수와 하위 줄을 보인다.
   돌리는 테스트의 상태는 오른쪽 속성 패널의 고르기 하나로만 바꾼다 (docs/api/test-comment.md) */
const props = defineProps<{ row: TestRow }>()
const emit = defineEmits<{ (e: 'open-test', id: string): void }>()

const testStore = useTestStore()

const children = computed(() =>
  (testStore.childrenOf[props.row.test.id] ?? []).map(testStore.toRow),
)
const childCounts = computed(() => {
  const counts: Partial<Record<TestStatus, number>> = {}
  for (const c of children.value) counts[c.status] = (counts[c.status] ?? 0) + 1
  return (['fail', 'blocked', 'testing', 'draft', 'ready', 'pass'] as TestStatus[])
    .filter((s) => counts[s])
    .map((s) => ({ status: s, n: counts[s]! }))
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium">하위 테스트</span>
      <span class="grow" />
      <span class="text-xs text-muted-foreground">묶음은 하위 상태 중 가장 나쁜 것을 보입니다</span>
    </div>

    <div class="flex flex-wrap items-center gap-2" data-test-group-summary>
      <TestStatusBadge :status="row.status" />
      <span v-for="c in childCounts" :key="c.status" class="text-xs text-muted-foreground"
        >{{ testStatusLabel(c.status) }} {{ c.n }}</span
      >
      <TestSignalChips :signals="row.signals" />
    </div>
    <div class="flex flex-col overflow-hidden rounded-md border border-border">
      <div
        v-for="c in children"
        :key="c.test.id"
        class="flex min-h-[38px] items-center gap-3 border-b border-border px-3 py-1 last:border-b-0"
        :data-test-child="c.test.id"
      >
        <span class="shrink-0 text-xs text-muted-foreground">{{ c.test.key }}</span>
        <button
          type="button"
          class="min-w-0 grow truncate text-left text-[13px] underline-offset-4 hover:underline"
          @click="emit('open-test', c.test.id)"
        >
          {{ c.test.title }}
        </button>
        <TestSignalChips :signals="c.signals" />
        <TestStatusBadge :status="c.status" />
        <span class="w-[64px] shrink-0 text-right text-xs text-muted-foreground">{{
          c.isGroup ? '묶음' : c.test.statusDays === 0 ? '오늘부터' : `${c.test.statusDays}일째`
        }}</span>
      </div>
    </div>
  </section>
</template>

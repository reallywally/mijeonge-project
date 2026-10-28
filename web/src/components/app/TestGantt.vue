<script setup lang="ts">
import { computed } from 'vue'
import GanttChart from '@/components/app/GanttChart.vue'
import { periodRangeLabel, toTestGanttItems } from '@/lib/gantt'
import { testStatusLabel } from '@/lib/testcase'
import { useTestStore } from '@/stores/test'
import type { TestRow } from '@/types/domain'

/* 테스트 간트차트 — 작업 간트와 같은 껍데기(GanttChart)에 묶음 트리를 그린다. 막대는 테스트 기간이고,
   끌어 놓으면 PATCH 로 기간을 바꾼다. 줄의 + 는 그 묶음 아래 테스트를 만든다 */
const props = defineProps<{
  /** 거른 줄 — 비우면 [내 파트 | 전체] 로 거른 것 전부 */
  rows?: TestRow[]
}>()
const emit = defineEmits<{
  (e: 'open-test', id: string): void
  (e: 'add-test', parentId: string | null): void
}>()

const testStore = useTestStore()

const shown = computed(() => props.rows ?? testStore.visibleRows)
const items = computed(() => toTestGanttItems(shown.value, testStatusLabel, testStore.isContext))
const period = computed(() => periodRangeLabel(shown.value.map((r) => r.test)))
</script>

<template>
  <GanttChart
    :items="items"
    :period="period"
    title-label="테스트"
    hint="막대를 끌거나 늘리면 테스트 기간이 바뀝니다. 묶음 줄은 하위 테스트의 상태를 모아 보입니다."
    @open="(id) => emit('open-test', id)"
    @add="(parentId) => emit('add-test', parentId)"
    @move="(id, start, due) => testStore.setPeriod(id, start, due)"
  />
</template>

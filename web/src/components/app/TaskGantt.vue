<script setup lang="ts">
import { computed } from 'vue'
import GanttChart from '@/components/app/GanttChart.vue'
import { rangeLabel, toGanttItems } from '@/lib/gantt'
import { taskStatusLabel } from '@/lib/task'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'

/* 작업 간트차트 — 목록이 평평한 게시판인 자리에서 이쪽은 계층 트리다. 그리기는 GanttChart 가 하고
   여기는 작업 스토어를 잇는다: 끌어 놓은 기간을 스토어에 넣으면 스토어가 다시 그린다 */
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-task', parentId: string | null): void
}>()

const taskStore = useTaskStore()
const partStore = usePartStore()

/* [내 파트 | 전체] 로 거르고 완료 숨기기를 뺀 것. 둘 다 보이는 작업의 조상은 세워 트리가 끊기지 않는다.
   4단 작업 줄은 + 를 숨긴다 — 그 밑은 5단이다 */
const items = computed(() =>
  toGanttItems(taskStore.shownRows, taskStatusLabel, partStore.isContextTask).map((item) =>
    taskStore.canAddChild(item.id) ? item : { ...item, noAdd: true },
  ),
)
const period = computed(() => rangeLabel(taskStore.shownRows))
</script>

<template>
  <GanttChart
    :items="items"
    :period="period"
    title-label="작업"
    hint="막대를 끌거나 늘리면 기간이 바뀝니다."
    @open="(id) => emit('open-task', id)"
    @add="(parentId) => emit('add-task', parentId)"
    @move="(id, start, due) => taskStore.setPeriod(id, start, due)"
  />
</template>

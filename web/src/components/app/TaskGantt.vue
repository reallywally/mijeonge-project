<script setup lang="ts">
import { computed } from 'vue'
import GanttChart from '@/components/app/GanttChart.vue'
import { rangeLabel, toGanttItems } from '@/lib/gantt'
import { taskStatusLabel } from '@/lib/task'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'

/* 작업 간트차트 — 목록이 평평한 게시판인 자리에서 이쪽은 계층 트리다. 그리기는 GanttChart 가 하고
   여기는 작업 스토어를 잇는다: 끌어 놓은 기간 · 자리를 스토어에 넣으면 스토어가 다시 그린다 */
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-task', parentId: string | null): void
}>()

const taskStore = useTaskStore()
const partStore = usePartStore()

/* [내 파트 | 전체] 로 거르고 완료 숨기기를 뺀 것. 둘 다 보이는 작업의 조상은 세워 트리가 끊기지 않는다.
   4단 작업 줄은 + 를 숨긴다 — 그 밑은 5단이다. 고칠 권한이 없는 작업(작성자 · 담당자 · 관리자가 아님)은
   막대를 끌 수 없다 */
const items = computed(() => {
  const locked = new Set(
    taskStore.shownRows.filter((r) => !taskStore.canEdit(r.task)).map((r) => r.task.id),
  )
  return toGanttItems(
    taskStore.shownRows,
    taskStatusLabel,
    (id) => partStore.isContextTask(id) || taskStore.isMineContext(id),
  ).map((item) => ({
    ...item,
    ...(taskStore.canAddChild(item.id) ? {} : { noAdd: true }),
    ...(locked.has(item.id) ? { readonly: true } : {}),
  }))
})
const period = computed(() => rangeLabel(taskStore.shownRows))

/* 바로 뒤에 선 줄이 진짜 형제가 아니면(상위가 걸러져 최상위로 올라선 줄) 맨 끝으로 놓는다 —
   서버는 형제가 아닌 beforeId 를 400 으로 돌려보낸다 */
function reorder(id: string, parentId: string | null, beforeId: string | null) {
  const sibling =
    beforeId !== null && taskStore.tasks.some((t) => t.id === beforeId && t.parentId === parentId)
  taskStore.moveTask(id, parentId, sibling ? beforeId : null)
}
</script>

<template>
  <GanttChart
    :items="items"
    :period="period"
    title-label="작업"
    hint="막대를 끌거나 늘리면 기간이 바뀝니다. 줄을 끌면 상위 · 순서가 바뀝니다."
    reorderable
    :can-drop="taskStore.canMove"
    @open="(id) => emit('open-task', id)"
    @add="(parentId) => emit('add-task', parentId)"
    @move="(id, start, due) => taskStore.setPeriod(id, start, due)"
    @reorder="reorder"
  />
</template>

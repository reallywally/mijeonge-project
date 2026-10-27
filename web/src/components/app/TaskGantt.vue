<script setup lang="ts">
import { computed } from 'vue'
import type { Link } from 'dhtmlx-gantt'
import { toast } from 'vue-sonner'
import GanttChart from '@/components/app/GanttChart.vue'
import { DEPENDENCY_ERRORS, dependencyProblem } from '@/lib/dependency'
import { linkToDependency, rangeLabel, toGanttItems, toGanttLinks } from '@/lib/gantt'
import type { GanttLink } from '@/lib/gantt'
import { taskStatusLabel } from '@/lib/task'
import { useTaskStore } from '@/stores/task'

/* 작업 간트차트 — 작업은 평평하게 한 줄씩 선다(Q61). 그리기는 GanttChart 가 하고
   여기는 작업 스토어를 잇는다: 끌어 놓은 기간과 끌어 건 선행 관계를 스토어에 넣으면 스토어가 다시 그린다 */
const emit = defineEmits<{ (e: 'open-task', id: string): void }>()

const taskStore = useTaskStore()

/* [내 파트 | 전체] 로 거른 것 — 평평하게 한 줄씩 */
const items = computed(() => toGanttItems(taskStore.visibleRows, taskStatusLabel))
const period = computed(() => rangeLabel(taskStore.visibleRows))
/* 선행 관계 — 선행의 끝 → 뒤 작업의 시작. 한쪽이 거르기로 빠졌으면 그리지 않는다 */
const links = computed(() => toGanttLinks(taskStore.dependencies, items.value))

/* 끌어 건 화살표 — 못 거는 것은 그 자리에서 까닭을 띄운다 */
function onLinkAdd(link: Link) {
  const dep = linkToDependency(link)
  if (!dep) {
    toast.error('앞 작업 막대의 오른쪽 끝에서 뒤 작업 막대의 왼쪽 끝으로 끌어 겁니다.')
    return
  }
  const problem = dependencyProblem(taskStore.dependencies, dep.taskId, dep.dependsOnId)
  if (problem) {
    toast.error(DEPENDENCY_ERRORS[problem].message)
    return
  }
  void taskStore.addDependency(dep.taskId, dep.dependsOnId)
}

const keyTitle = (id: string) => {
  const task = taskStore.tasks.find((t) => t.id === id)
  return task ? `${task.key} ${task.title}` : ''
}

/* 화살표를 누르면 묻고 뗀다 */
function confirmUnlink(id: string) {
  const link: GanttLink | undefined = links.value.find((l) => l.id === id)
  if (!link) return
  const message = `선행 관계를 뗄까요?\n${keyTitle(link.source)} → ${keyTitle(link.target)}`
  if (!window.confirm(message)) return
  void taskStore.removeDependency(link.target, link.source)
}
</script>

<template>
  <GanttChart
    :items="items"
    :links="links"
    :period="period"
    title-label="작업"
    hint="막대를 끌거나 늘리면 기간이 바뀝니다. 막대 끝에서 다른 막대로 끌면 선행 작업이 걸리고, 화살표를 누르면 뗍니다."
    linkable
    :addable="false"
    @open="(id) => emit('open-task', id)"
    @move="(id, start, due) => taskStore.setPeriod(id, start, due)"
    @link-add="onLinkAdd"
    @link-click="confirmUnlink"
  />
</template>

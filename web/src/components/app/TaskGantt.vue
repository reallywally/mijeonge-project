<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Gantt, escapeHTML } from 'dhtmlx-gantt'
import type { GanttStatic, Link, Task as GanttTask } from 'dhtmlx-gantt'
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'
import { toast } from 'vue-sonner'
import { isoDay } from '@/lib/date'
import { DEPENDENCY_ERRORS, dependencyProblem } from '@/lib/dependency'
import {
  endToDue,
  linkToDependency,
  rangeLabel,
  toGanttItems,
  toGanttLinks,
  weekLabel,
} from '@/lib/gantt'
import type { GanttItem, GanttLink } from '@/lib/gantt'
import { taskStatusLabel } from '@/lib/task'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'

/* 간트차트 — 목록이 평평한 게시판인 자리에서 이쪽은 계층 트리다.
   고리는 한 방향이다: 스토어 → gantt.parse. 되돌아오는 건 끌어 놓은 기간과 끌어 건 선행 관계뿐이다 —
   선행 관계는 간트가 제 손으로 그리지 않게 막고 스토어에 넣어, 스토어가 다시 그리게 한다.
   라이브러리 기본 편집창(lightbox)은 끄고 우리 작업 상세 팝업을 띄운다. */
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-task', parentId: string | null): void
}>()

const taskStore = useTaskStore()
const partStore = usePartStore()
const host = ref<HTMLElement | null>(null)
const scale = ref<'week' | 'month'>('week')

/* [내 파트 | 전체] 로 거른 것. '내 파트' 여도 보이는 작업의 조상은 서 있어 트리가 끊기지 않는다 */
const items = computed(() =>
  toGanttItems(taskStore.visibleRows, taskStatusLabel, partStore.isContextTask),
)
const period = computed(() => rangeLabel(taskStore.visibleRows))
/* 선행 관계 — 선행의 끝 → 뒤 작업의 시작. 한쪽이 거르기로 빠졌으면 그리지 않는다 */
const links = computed(() => toGanttLinks(taskStore.dependencies, items.value))

/* 그리드 칸은 dhtmlx 가 innerHTML 로 그린다 — Vue 컴포넌트를 넣을 수 없어 글자로 짠다.
   우리 것임을 알아보게 tg- 를 붙이고 색은 아래 <style> 에서 토큰으로만 준다 */
const asItem = (task: GanttTask) => task as unknown as GanttItem

function titleCell(task: GanttTask) {
  const item = asItem(task)
  /* 기간 미정 작업은 오른쪽에 막대가 없다 — 왜 없는지를 제목 옆에 적어 둔다.
     시안은 이 말을 막대 자리에 놓지만, 그 자리에 무언가를 그리는 API(addTaskLayer)가
     Community 판에는 없다 */
  const undated = item.unscheduled ? '<span class="tg-undated">기간 미정</span>' : ''
  return `<span class="tg-key">${escapeHTML(item.key)}</span><span class="tg-title">${escapeHTML(item.text)}</span>${undated}`
}

function statusCell(task: GanttTask) {
  const item = asItem(task)
  return `<span class="tg-badge tg-badge-${item.status}"><i class="tg-dot"></i>${escapeHTML(item.statusLabel)}</span>`
}

function ownerCell(task: GanttTask) {
  const name = asItem(task).ownerName
  if (!name) return '<span class="tg-avatar tg-avatar-none">–</span>'
  return `<span class="tg-avatar" title="${escapeHTML(name)}">${escapeHTML(name.charAt(0))}</span>`
}

/* 주말 회색 띠와 오늘 세로선. dhtmlx v10 Community 에는 marker 플러그인이 없어
   오늘 선은 그날 칸의 테두리를 세워서 그린다. 눈금은 날짜 줄에만 붙인다 —
   위의 주 · 개월 줄까지 물들면 그 주 전체가 주말로 보인다 */
function cellClass(date: Date) {
  const classes: string[] = []
  const day = date.getDay()
  if (day === 0 || day === 6) classes.push('tg-weekend')
  if (isoDay(date) === isoDay(new Date())) classes.push('tg-today')
  return classes.join(' ')
}

function applyScale(g: GanttStatic) {
  if (scale.value === 'week') {
    g.config.min_column_width = 26
    g.config.scales = [
      { unit: 'week', step: 1, format: weekLabel },
      { unit: 'day', step: 1, format: (d: Date) => String(d.getDate()), css: cellClass },
    ]
  } else {
    g.config.min_column_width = 13
    g.config.scales = [
      { unit: 'month', step: 1, format: (d: Date) => `${d.getFullYear()}년 ${d.getMonth() + 1}월` },
      /* 개월 눈금은 칸이 좁아 월요일에만 날짜를 적는다 */
      {
        unit: 'day',
        step: 1,
        format: (d: Date) => (d.getDay() === 1 ? String(d.getDate()) : ''),
        css: cellClass,
      },
    ]
  }
}

let chart: GanttStatic | null = null
/* 끌어 놓은 결과를 스토어에 되돌리면 watch 가 다시 돌아 화면이 튄다 — 그 한 번만 건너뛴다.
   간트는 이미 제 손으로 막대를 옮겨 놓았다 */
let fromChart = false

function setup(g: GanttStatic, el: HTMLElement) {
  g.config.date_format = '%Y-%m-%d'
  g.config.show_unscheduled = true
  g.config.start_on_monday = true
  /* 눈금을 주 · 개월에 딱 맞춰 끊는다 — 안 그러면 맨 앞에 반 토막 난 주가 선다 */
  g.config.scale_offset_minimal = false
  g.config.row_height = 34
  g.config.scale_height = 46
  g.config.grid_width = 462
  g.config.open_tree_initially = true
  /* 진척도는 모델에 없다 — 끌어서 만들 수 없게 막는다. 선행 관계는 막대 끝에서 끌어 건다 */
  g.config.drag_links = true
  g.config.drag_progress = false
  g.config.details_on_dblclick = false
  g.config.columns = [
    { name: 'text', label: '작업', tree: true, width: '*', resize: true, template: titleCell },
    { name: 'status', label: '상태', width: 104, template: statusCell },
    { name: 'owner', label: '담당자', width: 64, align: 'center', template: ownerCell },
    { name: 'add', label: '', width: 44 },
  ]
  applyScale(g)

  g.templates.task_class = (_s: Date, _e: Date, task: GanttTask) =>
    `tg-bar tg-bar-${asItem(task).status}`
  g.templates.task_text = () => ''
  g.templates.link_class = () => 'tg-link'
  g.templates.timeline_cell_class = (_task: GanttTask, date: Date) => cellClass(date)
  g.templates.grid_row_class = (_s: Date, _e: Date, task: GanttTask) =>
    [
      asItem(task).unscheduled ? 'tg-row-unscheduled' : '',
      asItem(task).context ? 'tg-row-context' : '',
    ].join(' ')

  g.attachEvent('onBeforeLightbox', () => false)
  g.attachEvent('onTaskClick', (id: string | number, e: Event) => {
    /* 접기 화살표와 + 는 팝업을 열지 않는다 — 각자 제 일을 한다 */
    const target = e.target as HTMLElement | null
    if (target?.closest('.gantt_tree_icon') || target?.closest('.gantt_add')) return true
    emit('open-task', String(id))
    return false
  })
  /* 그리드의 + 열 — 라이브러리가 직접 줄을 만들지 않게 막고 우리 추가 팝업을 연다 */
  g.attachEvent('onTaskCreated', (task: GanttTask) => {
    emit('add-task', task.parent ? String(task.parent) : null)
    return false
  })
  g.attachEvent('onAfterTaskDrag', (id: string | number) => {
    const moved = g.getTask(id)
    if (!moved.start_date || !moved.end_date) return true
    fromChart = true
    void nextTick(() => {
      fromChart = false
    })
    taskStore.setPeriod(String(id), isoDay(moved.start_date), endToDue(moved.end_date))
    return true
  })

  /* 끌어 건 화살표 — 간트가 직접 넣지 않게 늘 false 를 내고 스토어에 맡긴다. 못 거는 것은 그 자리에서 까닭을 띄운다 */
  g.attachEvent('onBeforeLinkAdd', (_id: string | number, link: Link) => {
    if (syncingLinks) return true
    const dep = linkToDependency(link)
    if (!dep) {
      toast.error('앞 작업 막대의 오른쪽 끝에서 뒤 작업 막대의 왼쪽 끝으로 끌어 겁니다.')
      return false
    }
    const problem = dependencyProblem(
      taskStore.tasks,
      taskStore.dependencies,
      dep.taskId,
      dep.dependsOnId,
    )
    if (problem) {
      toast.error(DEPENDENCY_ERRORS[problem].message)
      return false
    }
    void taskStore.addDependency(dep.taskId, dep.dependsOnId)
    return false
  })
  /* 화살표를 누르면 묻고 뗀다. 두 번 누르기는 라이브러리의 기본 지우기 창이 떠서 막는다 */
  g.attachEvent('onLinkClick', (id: string | number) => {
    const link = links.value.find((l) => l.id === String(id))
    if (link) confirmUnlink(link)
  })
  g.attachEvent('onLinkDblClick', () => false)

  g.init(el)
  g.parse({ data: items.value, links: links.value })
}

const keyTitle = (id: string) => {
  const task = taskStore.tasks.find((t) => t.id === id)
  return task ? `${task.key} ${task.title}` : ''
}

function confirmUnlink(link: GanttLink) {
  const message = `선행 관계를 뗄까요?\n${keyTitle(link.source)} → ${keyTitle(link.target)}`
  if (!window.confirm(message)) return
  void taskStore.removeDependency(link.target, link.source)
}

/* 스토어에서 바뀐 선행 관계만 간트에 옮긴다 — 통째로 다시 그리면 보던 자리가 처음으로 튄다.
   여기서 넣는 addLink 는 onBeforeLinkAdd 를 거치므로 그동안은 통과시킨다 */
let syncingLinks = false
function syncLinks(g: GanttStatic, next: GanttLink[]) {
  const wanted = new Set(next.map((l) => l.id))
  syncingLinks = true
  try {
    for (const l of g.getLinks()) if (!wanted.has(String(l.id))) g.deleteLink(l.id)
    for (const l of next) if (!g.isLinkExists(l.id)) g.addLink({ ...l })
  } finally {
    syncingLinks = false
  }
}

onMounted(() => {
  if (!host.value) return
  chart = Gantt.getGanttInstance()
  setup(chart, host.value)
})

onBeforeUnmount(() => {
  chart?.clearAll()
  chart?.destructor()
  chart = null
})

watch(items, (next) => {
  if (!chart || fromChart) return
  chart.clearAll()
  chart.parse({ data: next, links: links.value })
})

/* 막대를 옮겨도 links 는 새 배열로 다시 서므로, 걸린 쌍이 달라졌을 때만 옮긴다 */
watch(
  () => links.value.map((l) => l.id).join(','),
  () => {
    if (chart) syncLinks(chart, links.value)
  },
)

watch(scale, () => {
  if (!chart) return
  applyScale(chart)
  chart.render()
})

function showToday() {
  chart?.showDate(new Date())
}
</script>

<template>
  <div class="tg-root flex min-h-0 grow flex-col">
    <div ref="host" class="min-h-0 grow" />

    <footer
      class="flex h-[42px] shrink-0 items-center gap-2 border-t border-border bg-background px-4"
    >
      <span class="text-xs text-muted-foreground">
        막대를 끌거나 늘리면 기간이 바뀝니다. 막대 끝에서 다른 막대로 끌면 선행 작업이 걸리고,
        화살표를 누르면 뗍니다.
      </span>
      <div class="grow" />
      <span class="text-xs text-muted-foreground">{{ period }}</span>
      <button
        type="button"
        class="inline-flex h-7 items-center rounded-md border border-border bg-background px-3 text-xs hover:bg-accent hover:text-accent-foreground"
        @click="showToday"
      >
        오늘
      </button>
      <div class="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5">
        <button
          v-for="s in [
            { key: 'week' as const, label: '주' },
            { key: 'month' as const, label: '개월' },
          ]"
          :key="s.key"
          type="button"
          class="inline-flex h-6 items-center rounded-sm px-3 text-xs"
          :class="scale === s.key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'"
          @click="scale = s.key"
        >
          {{ s.label }}
        </button>
      </div>
    </footer>
  </div>
</template>

<!-- dhtmlx 는 자기 CSS 를 갖고 온다. 우리 토큰과 부딪히는 색만 덮어쓴다.
     scoped 를 쓰면 dhtmlx 가 innerHTML 로 만든 것들에 표시가 안 붙어서, .tg-root 로 가둔다. -->
<style>
.tg-root .gantt_container,
.tg-root .gantt_grid,
.tg-root .gantt_task {
  font-family: inherit;
  font-size: 13px;
  background: var(--background);
  color: var(--foreground);
}

.tg-root .gantt_grid_scale,
.tg-root .gantt_task_scale {
  background: var(--muted);
  color: var(--muted-foreground);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
}

.tg-root .gantt_grid_scale .gantt_grid_head_cell,
.tg-root .gantt_task_scale .gantt_scale_cell {
  color: var(--muted-foreground);
  font-size: 11px;
  border-right: 1px solid var(--border);
}

.tg-root .gantt_row,
.tg-root .gantt_task_row,
.tg-root .gantt_grid_data .gantt_row.odd,
.tg-root .gantt_task_bg .gantt_task_row.odd {
  background: var(--background);
  border-bottom: 1px solid var(--border);
}

.tg-root .gantt_grid_data .gantt_row:hover,
.tg-root .gantt_grid_data .gantt_row.gantt_selected,
.tg-root .gantt_task_bg .gantt_task_row.gantt_selected {
  background: var(--muted);
}

.tg-root .gantt_task_cell,
.tg-root .gantt_grid_column_resize_wrap .gantt_grid_resize_wrap_line,
.tg-root .gantt_layout_cell_border_right,
.tg-root .gantt_layout_cell_border_left {
  border-color: var(--border);
}

.tg-root .gantt_task_cell.tg-weekend,
.tg-root .gantt_scale_cell.tg-weekend {
  background: var(--muted);
}

.tg-root .gantt_task_cell.tg-today,
.tg-root .gantt_scale_cell.tg-today {
  border-right-color: var(--destructive);
}

.tg-root .gantt_scale_cell.tg-today {
  color: var(--destructive);
  font-weight: 600;
}

/* 그리드 칸 — 번호는 흐리게, 제목은 본문색으로 */
.tg-root .tg-key {
  margin-right: 7px;
  color: var(--muted-foreground);
  font-size: 11px;
}

.tg-root .tg-title {
  font-size: 12.5px;
}

.tg-root .tg-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: 11px;
}

.tg-root .tg-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
}

.tg-root .tg-badge-done {
  background: var(--primary);
  color: var(--primary-foreground);
}

.tg-root .tg-badge-blocked {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.tg-root .tg-badge-todo {
  color: var(--muted-foreground);
}

.tg-root .tg-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: var(--secondary);
  font-size: 10.5px;
}

.tg-root .tg-avatar-none {
  background: transparent;
  color: var(--muted-foreground);
}

/* 선행 관계 화살표 — 흐리게 두고 가리키면 짙게 */
.tg-root {
  --dhx-gantt-link-background: var(--muted-foreground);
  --dhx-gantt-link-background-hover: var(--foreground);
  --dhx-gantt-link-handle-border: var(--primary);
  --dhx-gantt-link-handle-background: var(--background);
}

/* 막대 — 완료는 채우고, 진행 중은 테두리, 해야 할 일은 옅게, 묶음은 자식들의 기간 */
.tg-root .gantt_task_line.tg-bar {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--secondary);
}

.tg-root .gantt_task_line.tg-bar-doing {
  border-color: var(--primary);
}

.tg-root .gantt_task_line.tg-bar-done {
  background: var(--primary);
  border-color: var(--primary);
}

.tg-root .gantt_task_line.tg-bar-blocked {
  background: var(--destructive);
  border-color: var(--destructive);
}

.tg-root .gantt_task_line.gantt_project {
  height: 8px !important;
  margin-top: 13px;
  border: 0;
  border-radius: 9999px;
  background: var(--border);
}

.tg-root .gantt_task_progress {
  background: transparent;
}

.tg-root .tg-undated {
  display: inline-flex;
  align-items: center;
  height: 20px;
  margin-left: 7px;
  padding: 0 8px;
  border: 1px dashed var(--destructive);
  border-radius: var(--radius-sm);
  color: var(--destructive);
  font-size: 11px;
  white-space: nowrap;
}

.tg-root .gantt_grid_data .gantt_row.tg-row-unscheduled .tg-title {
  color: var(--muted-foreground);
}

/* '내 파트' 에서 길을 잇느라 선 조상 — 내 일이 아니라 흐리게 */
.tg-root .gantt_grid_data .gantt_row.tg-row-context {
  opacity: 0.55;
}
</style>

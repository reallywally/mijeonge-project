<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Gantt, escapeHTML } from 'dhtmlx-gantt'
import type { GanttStatic, Task as GanttTask } from 'dhtmlx-gantt'
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'
import { isoDay } from '@/lib/date'
import { endToDue, rangeLabel, toGanttItems, weekLabel } from '@/lib/gantt'
import type { GanttItem } from '@/lib/gantt'
import { taskStatusLabel } from '@/lib/task'
import { useTaskStore } from '@/stores/task'

/* 간트차트 — 목록이 평평한 게시판인 자리에서 이쪽은 계층 트리다.
   고리는 한 방향이다: 스토어 → gantt.parse. 되돌아오는 건 끌어 놓은 기간 하나뿐이다.
   라이브러리 기본 편집창(lightbox)은 끄고 우리 작업 상세 팝업을 띄운다. */
const emit = defineEmits<{
  (e: 'open-task', id: string): void
  (e: 'add-task', parentId: string | null): void
}>()

const taskStore = useTaskStore()
const host = ref<HTMLElement | null>(null)
const scale = ref<'week' | 'month'>('week')

const items = computed(() => toGanttItems(taskStore.rows, taskStatusLabel))
const period = computed(() => rangeLabel(taskStore.rows))

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
  /* 선후 관계도 진척도 모델에 없다 — 끌어서 만들 수 없게 막는다 */
  g.config.drag_links = false
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
  g.templates.timeline_cell_class = (_task: GanttTask, date: Date) => cellClass(date)
  g.templates.grid_row_class = (_s: Date, _e: Date, task: GanttTask) =>
    asItem(task).unscheduled ? 'tg-row-unscheduled' : ''

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

  g.init(el)
  g.parse({ data: items.value, links: [] })
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
  chart.parse({ data: next, links: [] })
})

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
        막대를 끌거나 늘리면 기간이 바뀝니다. 기간 미정 작업은 막대가 없습니다.
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
</style>

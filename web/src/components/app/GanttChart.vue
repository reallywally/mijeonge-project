<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Gantt, escapeHTML } from 'dhtmlx-gantt'
import type { GanttStatic, Task as GanttTask } from 'dhtmlx-gantt'
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'
import { isoDay } from '@/lib/date'
import { endToDue, weekLabel } from '@/lib/gantt'
import type { GanttItem } from '@/lib/gantt'

/* 간트차트 껍데기 — 작업 간트(TaskGantt)와 테스트 간트(TestGantt)가 같이 쓴다. 무엇을 그리는지는 모른다:
   줄(items)을 받아 그리고, 손놀림(누르기 · + · 끌기)을 알리기만 한다.
   고리는 한 방향이다: 부모의 스토어 → items → gantt.parse. 끌어 놓은 기간은 알리고,
   부모가 스토어에 넣어 다시 내려 준다. 화살표(링크)는 그리지 않는다 — 선행 작업은 걷었다(Q63).
   라이브러리 기본 편집창(lightbox)은 끄고 부모가 우리 상세 팝업을 띄운다. */
const props = defineProps<{
  items: GanttItem[]
  /** 맨 아래에 적는 전체 기간 */
  period: string
  /** 첫 열의 이름 — 작업 · 테스트 */
  titleLabel: string
  /** 맨 아래의 손놀림 안내 */
  hint: string
}>()
const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'add', parentId: string | null): void
  (e: 'move', id: string, start: string, due: string): void
}>()

const host = ref<HTMLElement | null>(null)
const scale = ref<'week' | 'month'>('week')

/* 그리드 칸은 dhtmlx 가 innerHTML 로 그린다 — Vue 컴포넌트를 넣을 수 없어 글자로 짠다.
   우리 것임을 알아보게 tg- 를 붙이고 색은 아래 <style> 에서 토큰으로만 준다 */
const asItem = (task: GanttTask) => task as unknown as GanttItem

function titleCell(task: GanttTask) {
  const item = asItem(task)
  /* 기간 미정은 오른쪽에 막대가 없다 — 왜 없는지를 제목 옆에 적어 둔다.
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
/* 끌어 놓은 결과가 부모의 스토어를 거쳐 되돌아오면 watch 가 다시 돌아 화면이 튄다 — 그동안은 건너뛴다.
   간트는 이미 제 손으로 막대를 옮겨 놓았다. 되돌아오는 길(부모 다시 그리기 · 목업 응답)이 모두
   마이크로태스크라 한 박자(setTimeout) 뒤에 푼다 */
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
  /* 진척도 · 화살표는 모델에 없다 — 끌어서 만들 수 없게 막는다 */
  g.config.drag_links = false
  g.config.drag_progress = false
  g.config.details_on_dblclick = false
  g.config.columns = [
    {
      name: 'text',
      label: props.titleLabel,
      tree: true,
      width: '*',
      resize: true,
      template: titleCell,
    },
    { name: 'status', label: '상태', width: 104, template: statusCell },
    { name: 'owner', label: '담당자', width: 64, align: 'center', template: ownerCell },
    { name: 'add', label: '', width: 44 },
  ]
  applyScale(g)

  g.templates.task_class = (_s: Date, _e: Date, task: GanttTask) =>
    `tg-bar tg-bar-${asItem(task).status}${asItem(task).late ? ' tg-bar-late' : ''}`
  g.templates.task_text = () => ''
  g.templates.timeline_cell_class = (_task: GanttTask, date: Date) => cellClass(date)
  g.templates.grid_row_class = (_s: Date, _e: Date, task: GanttTask) =>
    [
      asItem(task).unscheduled ? 'tg-row-unscheduled' : '',
      asItem(task).context ? 'tg-row-context' : '',
      asItem(task).noAdd ? 'tg-row-noadd' : '',
    ].join(' ')

  g.attachEvent('onBeforeLightbox', () => false)
  g.attachEvent('onTaskClick', (id: string | number, e: Event) => {
    /* 접기 화살표와 + 는 팝업을 열지 않는다 — 각자 제 일을 한다 */
    const target = e.target as HTMLElement | null
    if (target?.closest('.gantt_tree_icon') || target?.closest('.gantt_add')) return true
    emit('open', String(id))
    return false
  })
  /* 그리드의 + 열 — 라이브러리가 직접 줄을 만들지 않게 막고 부모가 추가 팝업을 연다 */
  g.attachEvent('onTaskCreated', (task: GanttTask) => {
    /* + 를 숨긴 줄(4단 작업)이면 받지 않는다 — 숨김을 비켜 들어온 손놀림까지 */
    if (task.parent && props.items.find((i) => i.id === String(task.parent))?.noAdd) return false
    emit('add', task.parent ? String(task.parent) : null)
    return false
  })
  g.attachEvent('onAfterTaskDrag', (id: string | number) => {
    const moved = g.getTask(id)
    if (!moved.start_date || !moved.end_date) return true
    fromChart = true
    setTimeout(() => {
      fromChart = false
    })
    emit('move', String(id), isoDay(moved.start_date), endToDue(moved.end_date))
    return true
  })

  g.init(el)
  g.parse({ data: props.items })
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

watch(
  () => props.items,
  (next) => {
    if (!chart || fromChart) return
    chart.clearAll()
    chart.parse({ data: next })
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
      <span class="text-xs text-muted-foreground">{{ hint }}</span>
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
  background: var(--card);
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
  background: var(--brand-soft);
}

.tg-root .gantt_task_cell,
.tg-root .gantt_grid_column_resize_wrap .gantt_grid_resize_wrap_line,
.tg-root .gantt_layout_cell_border_right,
.tg-root .gantt_layout_cell_border_left {
  border-color: var(--border);
}

.tg-root .gantt_task_cell.tg-weekend,
.tg-root .gantt_scale_cell.tg-weekend {
  background: color-mix(in oklab, var(--muted) 70%, var(--background));
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
  height: 20px;
  padding: 0 7px 0 6px;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--card);
  color: var(--foreground);
  font-size: 11px;
  font-weight: 500;
}

.tg-root .tg-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--status-todo);
}

/* 상태 색은 StatusPill 과 같다 — 진행 · 테스트 중은 파랑, 완료 · 성공은 초록, 막힘 · 실패는 빨강 */
.tg-root .tg-badge-doing,
.tg-root .tg-badge-testing {
  border-color: color-mix(in oklab, var(--status-doing) 22%, var(--card));
  background: color-mix(in oklab, var(--status-doing) 9%, var(--card));
  color: color-mix(in oklab, var(--status-doing) 75%, var(--foreground));
}
.tg-root .tg-badge-doing .tg-dot,
.tg-root .tg-badge-testing .tg-dot {
  background: var(--status-doing);
}

.tg-root .tg-badge-done,
.tg-root .tg-badge-pass {
  border-color: color-mix(in oklab, var(--status-done) 24%, var(--card));
  background: color-mix(in oklab, var(--status-done) 10%, var(--card));
  color: color-mix(in oklab, var(--status-done) 70%, var(--foreground));
}
.tg-root .tg-badge-done .tg-dot,
.tg-root .tg-badge-pass .tg-dot {
  background: var(--status-done);
}

.tg-root .tg-badge-blocked,
.tg-root .tg-badge-fail {
  border-color: color-mix(in oklab, var(--status-blocked) 24%, var(--card));
  background: color-mix(in oklab, var(--status-blocked) 9%, var(--card));
  color: color-mix(in oklab, var(--status-blocked) 80%, var(--foreground));
}
.tg-root .tg-badge-blocked .tg-dot,
.tg-root .tg-badge-fail .tg-dot {
  background: var(--status-blocked);
}

.tg-root .tg-badge-todo,
.tg-root .tg-badge-draft,
.tg-root .tg-badge-ready {
  color: var(--muted-foreground);
}

.tg-root .tg-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: var(--brand-soft);
  color: var(--primary);
  font-size: 10.5px;
  font-weight: 600;
}

.tg-root .tg-avatar-none {
  background: transparent;
  color: var(--muted-foreground);
}

/* 막대 — 완료 · 성공은 초록으로 채우고, 진행 중 · 테스트 중은 옅은 파랑, 해야 할 일은 옅은 회색, 묶음은 자식들의 기간 */
.tg-root .gantt_task_line.tg-bar {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--muted);
  box-shadow: 0 1px 1px rgb(16 24 40 / 0.04);
}

.tg-root .gantt_task_line.tg-bar-doing,
.tg-root .gantt_task_line.tg-bar-testing {
  border-color: color-mix(in oklab, var(--status-doing) 55%, var(--card));
  background: color-mix(in oklab, var(--status-doing) 16%, var(--card));
}

.tg-root .gantt_task_line.tg-bar-done,
.tg-root .gantt_task_line.tg-bar-pass {
  background: var(--status-done);
  border-color: var(--status-done);
}

.tg-root .gantt_task_line.tg-bar-blocked,
.tg-root .gantt_task_line.tg-bar-fail {
  background: var(--status-blocked);
  border-color: var(--status-blocked);
}

/* 기간 지남 · 오래 걸림 — 막대는 상태 색 그대로 두고 테두리만 세운다 */
.tg-root .gantt_task_line.tg-bar-late {
  border: 2px solid var(--destructive);
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
.tg-root .gantt_grid_data .gantt_row.tg-row-noadd .gantt_add {
  visibility: hidden;
  pointer-events: none;
}

.tg-root .gantt_grid_data .gantt_row.tg-row-context {
  opacity: 0.55;
}
</style>

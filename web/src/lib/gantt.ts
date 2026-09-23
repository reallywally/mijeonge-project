import { dayToDate, isoDay, shiftDays } from '@/lib/date'
import type { TaskRow, TaskStatus } from '@/types/domain'

/**
 * 스토어의 작업 행을 dhtmlx-gantt 가 먹는 모양으로 옮긴다.
 *
 * 상태 · 담당자 열은 우리가 template 으로 직접 그리므로 계산해 둔 값을 그대로 달고 간다.
 * 기간이 없는 작업은 unscheduled 로 — 그리드에는 서고 막대는 안 그려진다.
 */
export interface GanttItem {
  id: string
  /** 그리드에 적히는 제목 */
  text: string
  key: string
  /** 최상위는 dhtmlx 의 뿌리 id 인 '0' 이다 */
  parent: string
  status: TaskStatus
  statusLabel: string
  ownerName: string | null
  start_date?: Date
  end_date?: Date
  unscheduled?: boolean
  /** 자식이 있는 묶음 작업 — 막대가 자식들의 기간이 되고 끌 수 없다 */
  type?: 'project'
  open: boolean
}

/** 간트의 끝 날짜는 열린 구간이다 — 9/15 까지 하는 일은 9/16 에서 끝난다 */
export const dueToEnd = (due: string) => shiftDays(dayToDate(due), 1)

/** 막대를 놓은 자리를 다시 우리 날짜로 — 끝에서 하루를 뺀다 */
export const endToDue = (end: Date) => isoDay(shiftDays(end, -1))

export function toGanttItems(rows: TaskRow[], statusLabel: (s: TaskStatus) => string): GanttItem[] {
  return rows.map((row) => {
    const task = row.task
    const scheduled = task.start !== null && task.due !== null
    return {
      id: task.id,
      text: task.title,
      key: task.key,
      parent: task.parentId ?? '0',
      status: task.status,
      statusLabel: statusLabel(task.status),
      ownerName: row.ownerName,
      open: true,
      ...(row.childCount > 0 ? { type: 'project' as const } : {}),
      ...(scheduled
        ? { start_date: dayToDate(task.start!), end_date: dueToEnd(task.due!) }
        : { unscheduled: true }),
    }
  })
}

/** 눈금에 적는 한 주 — 9월 7일 – 9월 13일 */
export function weekLabel(start: Date) {
  const end = shiftDays(start, 6)
  const day = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`
  return `${day(start)} – ${day(end)}`
}

/** 맨 아래에 적는 기간 — 기간이 잡힌 작업이 하나도 없으면 빈 글자 */
export function rangeLabel(rows: TaskRow[]) {
  const days = rows.flatMap((r) => (r.undated ? [] : [r.task.start!, r.task.due!])).sort()
  if (days.length === 0) return ''
  const first = dayToDate(days[0])
  const last = dayToDate(days[days.length - 1])
  return `${first.getFullYear()}년 ${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`
}

import { dayToDate, isoDay, shiftDays } from '@/lib/date'
import type { TaskDependency, TaskRow, TaskStatus, TestRow } from '@/types/domain'

/**
 * 스토어의 작업 · 테스트 행을 dhtmlx-gantt 가 먹는 모양으로 옮긴다. 차트(GanttChart)는 둘을 가리지 않는다.
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
  /** 작업 상태 또는 테스트 상태 — 배지 · 막대 색의 이름(tg-badge-doing · tg-badge-pass)이 된다 */
  status: string
  statusLabel: string
  ownerName: string | null
  start_date?: Date
  end_date?: Date
  unscheduled?: boolean
  /** 자식이 있는 묶음(테스트) — 막대가 자식들의 기간이 되고 끌 수 없다 */
  type?: 'project'
  open: boolean
  /** '내 파트' 에서 보이는 테스트의 조상이라 선 것 — 흐리게 그린다 */
  context?: boolean
  /** 기간 지남 · 오래 걸림 — 막대 테두리를 세운다(테스트) */
  late?: boolean
}

/** 간트의 끝 날짜는 열린 구간이다 — 9/15 까지 하는 일은 9/16 에서 끝난다 */
export const dueToEnd = (due: string) => shiftDays(dayToDate(due), 1)

/** 막대를 놓은 자리를 다시 우리 날짜로 — 끝에서 하루를 뺀다 */
export const endToDue = (end: Date) => isoDay(shiftDays(end, -1))

/** 작업은 평평하다(Q61) — 모두 뿌리('0') 아래 한 줄씩 선다. 묶음 막대는 테스트에만 있다 */
export function toGanttItems(rows: TaskRow[], statusLabel: (s: TaskStatus) => string): GanttItem[] {
  return rows.map((row) => {
    const task = row.task
    const scheduled = task.start !== null && task.due !== null
    return {
      id: task.id,
      text: task.title,
      key: task.key,
      parent: '0',
      status: task.status,
      statusLabel: statusLabel(task.status),
      ownerName: row.ownerName,
      open: true,
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

/**
 * 테스트 행을 간트로 — 막대는 테스트 기간이다. 묶음인지 · 부모가 누구인지는 **건네받은 행 안에서** 본다 —
 * '내 파트' 로 거르면 자식이 다 빠진 묶음이 생기는데, 그것을 묶음으로 두면 자식 없는 project 막대가 기간 없이 선다.
 * 부모가 빠졌으면 최상위로 올린다.
 * 묶음 줄의 상태는 하위에서 모은 것(row.status)이다
 */
export function toTestGanttItems(
  rows: TestRow[],
  statusLabel: (s: TestRow['status']) => string,
  isContext: (testId: string) => boolean = () => false,
): GanttItem[] {
  const ids = new Set(rows.map((r) => r.test.id))
  const parents = new Set(rows.map((r) => r.test.parentId).filter((id) => id !== null))
  /* 묶음 막대는 하위 테스트의 기간을 덮는다 — 묶음에 기간을 따로 두지 않는 일이 많아(시드도 그렇다)
     자기 기간 대신 하위에서 센다. 하위에 기간이 하나도 없으면 묶음도 기간 미정이다 */
  const span = new Map<string, { start: string; due: string }>()
  for (const r of rows) {
    if (r.test.start === null || r.test.due === null || parents.has(r.test.id)) continue
    const seen = new Set<string>()
    let up = r.test.parentId
    while (up !== null && ids.has(up) && !seen.has(up)) {
      seen.add(up)
      const cur = span.get(up)
      span.set(up, {
        start: cur && cur.start < r.test.start ? cur.start : r.test.start,
        due: cur && cur.due > r.test.due ? cur.due : r.test.due,
      })
      up = rows.find((x) => x.test.id === up)?.test.parentId ?? null
    }
  }
  return rows.map((row) => {
    const t = row.test
    const period = parents.has(t.id)
      ? (span.get(t.id) ?? null)
      : t.start !== null && t.due !== null
        ? { start: t.start, due: t.due }
        : null
    return {
      id: t.id,
      text: t.title,
      key: t.key,
      parent: t.parentId !== null && ids.has(t.parentId) ? t.parentId : '0',
      status: row.status,
      statusLabel: statusLabel(row.status),
      ownerName: row.ownerName,
      open: true,
      ...(isContext(t.id) ? { context: true } : {}),
      ...(parents.has(t.id) ? { type: 'project' as const } : {}),
      ...(row.signals.includes('overdue') || row.signals.includes('longRunning')
        ? { late: true }
        : {}),
      ...(period
        ? { start_date: dayToDate(period.start), end_date: dueToEnd(period.due) }
        : { unscheduled: true }),
    }
  })
}

/** 맨 아래에 적는 기간 — 기간이 잡힌 작업이 하나도 없으면 빈 글자 */
export function rangeLabel(rows: TaskRow[]) {
  return periodRangeLabel(rows.map((r) => (r.undated ? {} : r.task)))
}

/** 기간들을 덮는 한 줄 — 둘 다 있는 것만 센다 */
export function periodRangeLabel(periods: { start?: string | null; due?: string | null }[]) {
  const days = periods.flatMap((p) => (p.start && p.due ? [p.start, p.due] : [])).sort()
  if (days.length === 0) return ''
  const first = dayToDate(days[0])
  const last = dayToDate(days[days.length - 1])
  return `${first.getFullYear()}년 ${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`
}

/** dhtmlx 의 finish-to-start — 선행의 끝 → 뒤 작업의 시작. 우리 선행 관계는 이것 하나뿐이다 */
export const FINISH_TO_START = '0'

export interface GanttLink {
  id: string
  /** 선행 작업 */
  source: string
  /** 뒤 작업 */
  target: string
  type: typeof FINISH_TO_START
}

export const linkIdOf = (d: TaskDependency) => `${d.dependsOnId}>${d.taskId}`

/** 선행 관계를 화살표로 — 양쪽 작업이 다 간트에 서 있는 것만. 한쪽이 거르기로 빠졌으면 그릴 자리가 없다 */
export function toGanttLinks(deps: TaskDependency[], items: { id: string }[]): GanttLink[] {
  const ids = new Set(items.map((i) => i.id))
  return deps
    .filter((d) => ids.has(d.taskId) && ids.has(d.dependsOnId))
    .map((d) => ({
      id: linkIdOf(d),
      source: d.dependsOnId,
      target: d.taskId,
      type: FINISH_TO_START,
    }))
}

/** 끌어 만든 화살표를 우리 선행 관계로. 끝 → 시작이 아니거나 제자리로 끌었으면 null */
export function linkToDependency(link: {
  source: string | number
  target: string | number
  type: string
}): TaskDependency | null {
  if (String(link.type) !== FINISH_TO_START || link.source === link.target) return null
  return { taskId: String(link.target), dependsOnId: String(link.source) }
}

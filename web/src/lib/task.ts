import type { TaskLine, TaskPriority, TaskStatus } from '@/types/domain'

/* 상태 넷은 목록 · 칸반 · 추가 · 상세가 모두 같은 순서로 쓴다 */
export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '해야 할 일' },
  { value: 'doing', label: '진행 중' },
  { value: 'blocked', label: '막힘' },
  { value: 'done', label: '완료' },
]

export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'normal', label: '보통' },
  { value: 'high', label: '높음' },
]

export const taskStatusLabel = (status: TaskStatus) =>
  TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? ''

export const taskPriorityLabel = (priority: TaskPriority) =>
  TASK_PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? ''

/**
 * 작업 추가의 내용 칸에 적은 글을 본문 줄로 옮긴다.
 *
 * `[]` · `[x]` 로 시작하면 체크박스, `-` · `*` 로 시작하면 불릿이고,
 * 그 밖의 줄도 불릿으로 둔다. 앞의 두 칸(또는 탭 하나)이 한 단계다.
 */
export function parseTaskBody(text: string): TaskLine[] {
  const lines: TaskLine[] = []
  for (const raw of text.split('\n')) {
    const rest = raw.replace(/^[\t ]+/, '')
    if (rest === '') continue

    const indent = raw.slice(0, raw.length - rest.length).replace(/\t/g, '  ').length
    const check = /^\[([ xX]?)\][\t ]*/.exec(rest)
    const bullet = check ? null : /^[-*][\t ]+/.exec(rest)
    const marker = check?.[0] ?? bullet?.[0] ?? ''
    const body = rest.slice(marker.length).trim()
    if (body === '') continue

    lines.push({
      id: `l${lines.length + 1}`,
      kind: check ? 'check' : 'bullet',
      text: body,
      done: check ? check[1].toLowerCase() === 'x' : false,
      level: Math.min(Math.floor(indent / 2), 3),
    })
  }
  return lines
}

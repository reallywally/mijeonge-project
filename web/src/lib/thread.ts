import type { Entry, ThreadState } from '@/types/domain'

/**
 * 남은 이력 줄로 다시 잰 안건 상태 — 이력 줄을 지웠을 때 서버와 같은 규칙으로 되돌린다.
 * 결정 · 변경이 하나라도 있으면 결정됨, 줄이 있으면 논의중, 없으면 대기
 */
export function threadStateOf(remaining: Pick<Entry, 'kind'>[]): ThreadState {
  if (remaining.some((e) => e.kind === 'decide' || e.kind === 'change')) return 'decided'
  return remaining.length > 0 ? 'open' : 'queued'
}

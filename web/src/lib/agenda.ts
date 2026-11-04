import type { Agenda, AgendaState } from '@/types/domain'

export const AGENDA_STATE_LABEL: Record<AgendaState, string> = {
  queued: '대기',
  open: '논의중',
  decided: '결정됨',
}

/** 상태 고르기의 순서 */
export const AGENDA_STATES: AgendaState[] = ['queued', 'open', 'decided']

/** 결정내용의 첫 줄 — 목록 · 작업 상세의 미리보기. 빈 줄은 건너뛴다 */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  )
}

type DecisionMarks = Pick<Agenda, 'decision' | 'state' | 'decidedAt' | 'decisionRev'>

/** 아직 아무것도 없는 안건 — 등록도 이 상태에서 바뀐 것으로 센다 */
export const BLANK_DECISION: DecisionMarks = {
  decision: '',
  state: 'queued',
  decidedAt: null,
  decisionRev: 0,
}

/**
 * 결정내용 · 상태가 바뀐 뒤의 decidedAt · decisionRev — 서버만 올리지만 목업이 같은 규칙으로 흉내 낸다.
 * 결정내용이 바뀌거나(앞뒤 공백 뗀 값으로) decided 가 되면 판이 1 오른다(둘 다여도 1). decided 에서 벗어나면 decidedAt 은 null
 */
export function nextDecisionMarks(
  before: DecisionMarks,
  after: Pick<Agenda, 'decision' | 'state'>,
  now: string,
): Pick<Agenda, 'decidedAt' | 'decisionRev'> {
  const changed = before.decision.trim() !== after.decision.trim()
  const becameDecided = before.state !== 'decided' && after.state === 'decided'
  return {
    decidedAt: after.state !== 'decided' ? null : becameDecided ? now : before.decidedAt,
    decisionRev: before.decisionRev + (changed || becameDecided ? 1 : 0),
  }
}

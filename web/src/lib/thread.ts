import type { DecisionItem, Entry, ThreadState } from '@/types/domain'

/** 결정 줄 — 그 항목을 정했다고 세는 줄 */
export const isDecisionKind = (kind: Entry['kind']) => kind === 'decide' || kind === 'change'

/**
 * 안건 상태를 이력으로 다시 잰다 — 서버와 같은 규칙.
 * 지우지 않은 항목이 하나 이상이고 전부 결정 · 변경 줄이 있으면 결정됨, 아니면 줄이 있으면 논의중, 없으면 대기.
 * 지운 항목에 달린 줄은 '정함' 을 세는 데서 빠지지만 줄이 있다는 것(논의중)에는 든다
 */
export function threadStateOf(
  items: Pick<DecisionItem, 'id'>[],
  entries: Pick<Entry, 'kind' | 'itemId'>[],
): ThreadState {
  const settled = new Set(entries.filter((e) => isDecisionKind(e.kind)).map((e) => e.itemId))
  if (items.length > 0 && items.every((i) => settled.has(i.id))) return 'decided'
  return entries.length > 0 ? 'open' : 'queued'
}

/** 항목 이름의 상한 — 앞뒤 공백을 뗀 뒤 센다 */
export const ITEM_TITLE_MAX = 200

/** 항목 이름이 틀린 까닭. 괜찮으면 '' */
export function itemTitleProblem(title: string): string {
  const n = title.trim().length
  if (n === 0) return '항목 이름을 적어 주세요.'
  if (n > ITEM_TITLE_MAX) return `항목 이름은 ${ITEM_TITLE_MAX}자까지입니다.`
  return ''
}

import type { ImpactApplyInput, ImpactBodyLine } from '@/types/domain'

/* AI 영향도 분석의 화면 계산 (docs/api/impact.md) — 줄 열쇠 · 전 → 후 비교 · 반영 오류를 줄에 붙이기 */

export type ImpactKind = 'task' | 'test'

/** 검토 줄의 열쇠 — 고름 · 지우기 · 오류가 이것으로 줄을 가리킨다 */
export const impactKey = (kind: ImpactKind, id: string) => `${kind}:${id}`

/** 작업 제목 · 테스트 제목 — 작업 등록 · 테스트 PATCH 와 같은 1 ~ 200자 */
export const IMPACT_TITLE_MAX = 200
/** 본문 들여쓰기 — PATCH body 와 같은 0 ~ 3 */
export const IMPACT_LEVEL_MAX = 3
/** 고친 안 · 반영의 본문 상한 — 서버가 영향도에만 건다(impact.md '구현에서 메운 것 (서버)') */
export const IMPACT_BODY_LINES_MAX = 200
export const IMPACT_LINE_MAX = 4000

export const IMPACT_CHANGED_TEXT = '분석 뒤에 바뀌었어요'
export const IMPACT_LOCKED_TEXT = '고칠 권한이 없어요'
export const IMPACT_EMPTY_SUMMARY = '살펴볼 연결 작업 · 테스트 · 다른 결정이 없습니다.'

/** 줄 하나를 보는 모양 그대로 — 들여쓰기 · 표시 · 글. 변경 이력의 본문 값(lib/history bodyText)과 같은 표시 */
export const bodyLineLabel = (l: ImpactBodyLine) =>
  `${'  '.repeat(l.level)}${l.kind === 'bullet' ? '• ' : l.done ? '☑ ' : '☐ '}${l.text}`

/** 본문이 같은가 — 종류 · 글 · 체크 · 들여쓰기 · 순서. 서버의 '분석 뒤 바뀜' 판단과 같은 칸 */
export const sameBody = (a: ImpactBodyLine[], b: ImpactBodyLine[]) =>
  a.length === b.length &&
  a.every(
    (l, i) =>
      l.kind === b[i].kind &&
      l.text === b[i].text &&
      l.done === b[i].done &&
      l.level === b[i].level,
  )

/** 줄 id 를 떼고 아는 칸만 — 편집기는 id 를 단 TaskLine 을 쓴다 */
export const bareLines = (lines: ImpactBodyLine[]): ImpactBodyLine[] =>
  lines.map(({ kind, text, done, level }) => ({ kind, text, done, level }))

export type DiffOp = { op: 'same' | 'del' | 'add'; text: string }
export type CompactOp = DiffOp | { op: 'gap'; count: number }

/** 줄 단위 비교(LCS) — 지운 줄을 넣은 줄보다 먼저 */
export function lineDiff(before: string[], after: string[]): DiffOp[] {
  const n = before.length
  const m = after.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      out.push({ op: 'same', text: before[i] })
      i += 1
      j += 1
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ op: 'del', text: before[i] })
      i += 1
    } else {
      out.push({ op: 'add', text: after[j] })
      j += 1
    }
  }
  return out
}

/** 짧은 비교 — 바뀐 줄과 그 앞뒤 context 줄만 두고, 나머지 그대로인 줄은 'n줄 그대로' 하나로 접는다 */
export function compactDiff(ops: DiffOp[], context = 1): CompactOp[] {
  const near = ops.map((_, i) =>
    ops.slice(Math.max(0, i - context), i + context + 1).some((o) => o.op !== 'same'),
  )
  const out: CompactOp[] = []
  ops.forEach((o, i) => {
    if (o.op !== 'same' || near[i]) {
      out.push(o)
      return
    }
    const last = out.at(-1)
    if (last?.op === 'gap') last.count += 1
    else out.push({ op: 'gap', count: 1 })
  })
  return out
}

export const textLines = (text: string) => (text === '' ? [] : text.split('\n'))

/** 본문 전 → 후의 짧은 비교 */
export const bodyDiff = (before: ImpactBodyLine[], after: ImpactBodyLine[]) =>
  compactDiff(lineDiff(before.map(bodyLineLabel), after.map(bodyLineLabel)))

/** 글 칸(테스트 내용 · 테스트 데이터) 전 → 후의 짧은 비교 */
export const textDiff = (before: string, after: string) =>
  compactDiff(lineDiff(textLines(before), textLines(after)))

/** 고친 안의 칸 검사 — 서버와 같은 것을 미리 본다. 칸 → 한 줄 */
export function taskProposalProblems(p: { title?: string; body?: ImpactBodyLine[] }) {
  const out: Record<string, string> = {}
  if (p.title !== undefined) {
    const title = p.title.trim()
    if (title.length < 1 || title.length > IMPACT_TITLE_MAX)
      out.title = `제목은 1 ~ ${IMPACT_TITLE_MAX}자로 적어 주세요.`
  }
  if (p.body && p.body.length > IMPACT_BODY_LINES_MAX)
    out.body = `본문은 ${IMPACT_BODY_LINES_MAX}줄까지입니다.`
  else if (p.body?.some((l) => l.text.length > IMPACT_LINE_MAX))
    out.body = `한 줄은 ${IMPACT_LINE_MAX.toLocaleString()}자까지입니다.`
  else if (
    p.body?.some((l) => !Number.isInteger(l.level) || l.level < 0 || l.level > IMPACT_LEVEL_MAX)
  )
    out.body = `들여쓰기는 ${IMPACT_LEVEL_MAX}단까지입니다.`
  return out
}

export const UNCHANGED_TEXT = '지금 값과 다른 칸이 없습니다.'

/** 보낸 칸이 모두 분석 때 값과 같은가 — 그러면 반영할 것이 없다(서버도 422) */
export const taskUnchanged = (
  p: { title?: string; body?: ImpactBodyLine[] },
  before: { title: string; body: ImpactBodyLine[] },
) =>
  (p.title === undefined || p.title.trim() === before.title) &&
  (p.body === undefined || sameBody(p.body, before.body))

export const testUnchanged = (
  p: { title?: string; content?: string; testData?: string },
  before: { title: string; content: string; testData: string },
) =>
  (p.title === undefined || p.title.trim() === before.title) &&
  (p.content === undefined || p.content === before.content) &&
  (p.testData === undefined || p.testData === before.testData)

/**
 * 반영 오류의 detail 을 줄 열쇠로 — `tasks.N` · `tests.N` · `tasks.N.title` 처럼 보낸 순서의 자리다.
 * 같은 줄의 여러 칸은 첫 것 하나만
 */
export function applyErrorsByKey(
  detail: Record<string, string> | undefined,
  input: ImpactApplyInput,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, message] of Object.entries(detail ?? {})) {
    const [group, index] = path.split('.')
    const i = Number(index)
    if (!Number.isInteger(i)) continue
    const key =
      group === 'tasks' && input.tasks[i]
        ? impactKey('task', input.tasks[i].taskId)
        : group === 'tests' && input.tests[i]
          ? impactKey('test', input.tests[i].testId)
          : null
    if (key && !(key in out)) out[key] = message
  }
  return out
}

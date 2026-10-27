import { localDay, slashDay } from '@/lib/date'
import type { TestCase, TestSignal, TestStatus } from '@/types/domain'

/* 테스트 (docs/api/test.md). 며칠째 · 신호는 서버가 센다 — 여기의 testSignals 는 목업 api 만 쓴다.
   묶음의 상태 · 신호 모으기, '지금' 의 정렬 · 화면 말은 화면이 정할 몫이라 여기 한 벌로 둔다 */

/* 상태 여섯은 목록 · 상세 · 간트가 같은 순서로 쓴다 */
export const TEST_STATUS_OPTIONS: { value: TestStatus; label: string }[] = [
  { value: 'draft', label: '작성 중' },
  { value: 'ready', label: '준비됨' },
  { value: 'testing', label: '테스트 중' },
  { value: 'pass', label: '성공' },
  { value: 'fail', label: '실패' },
  { value: 'blocked', label: '막힘' },
]

export const testStatusLabel = (status: TestStatus) =>
  TEST_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? ''

/** 계약 표의 순서 — 서버가 이 순서로 내고, 묶음에서 모을 때도 이 순서로 둔다 */
export const TEST_SIGNALS: TestSignal[] = [
  'longRunning',
  'overdue',
  'notStarted',
  'longBlocked',
  'failedIdle',
  'basisChanged',
]

export const TEST_SIGNAL_LABEL: Record<TestSignal, string> = {
  longRunning: '오래 걸림',
  overdue: '기간 지남',
  notStarted: '시작 안 함',
  longBlocked: '오래 막힘',
  failedIdle: '실패 그대로',
  basisChanged: '기준 바뀜',
}

/** 묶음의 상태 — 하위 중 가장 나쁜 것: 실패 > 막힘 > 테스트 중 > 작성 중 · 준비됨 > 성공 */
const BADNESS: Record<TestStatus, number> = {
  fail: 0,
  blocked: 1,
  testing: 2,
  draft: 3,
  ready: 3,
  pass: 4,
}

/** 작성 중 · 준비됨이 섞이면 작성 중으로 — 아직 덜 된 쪽을 보인다 */
export function worstStatus(statuses: TestStatus[]): TestStatus | null {
  let worst: TestStatus | null = null
  for (const s of statuses) {
    if (
      worst === null ||
      BADNESS[s] < BADNESS[worst] ||
      (BADNESS[s] === BADNESS[worst] && s === 'draft')
    )
      worst = s
  }
  return worst
}

/** 여러 신호 목록을 하나로 — 겹치지 않게, 계약 표 순서로 */
export function mergeSignals(lists: TestSignal[][]): TestSignal[] {
  const got = new Set(lists.flat())
  return TEST_SIGNALS.filter((s) => got.has(s))
}

/** YYYY-MM-DD 둘 사이의 날 수(to − from) */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 지금 상태가 된 지 며칠 — 한국 시간 날짜끼리. 시계가 어긋나 앞날이면 0 */
export const testStatusDays = (statusChangedAt: string, today: string) =>
  Math.max(0, daysBetween(localDay(statusChangedAt), today))

export interface SignalInput {
  status: TestStatus
  statusDays: number
  start: string | null
  due: string | null
  changedEntryIds: string[]
  isGroup: boolean
}

/**
 * 규칙이 붙이는 신호 — 서버와 같은 셈(문턱은 '넘어야', plannedDays = due − start + 1).
 * 목업 api 가 서버 대신 쓴다. 화면은 받은 signals 를 그대로 그린다
 */
export function testSignals(t: SignalInput, today: string, staleDays: number): TestSignal[] {
  if (t.isGroup) return []
  const out: TestSignal[] = []
  if (t.status === 'testing') {
    const limit =
      t.start !== null && t.due !== null ? (daysBetween(t.start, t.due) + 1) * 1.5 : staleDays
    if (t.statusDays > limit) out.push('longRunning')
  }
  if (t.due !== null && t.due < today && t.status !== 'pass') out.push('overdue')
  if (t.start !== null && t.start < today && (t.status === 'draft' || t.status === 'ready'))
    out.push('notStarted')
  if (t.status === 'blocked' && t.statusDays > staleDays) out.push('longBlocked')
  if (t.status === 'fail' && t.statusDays > staleDays) out.push('failedIdle')
  if (t.changedEntryIds.length > 0) out.push('basisChanged')
  return out
}

/** 손쓸 테스트의 앞뒤 — 기간 지남 · 오래 막힘 · 오래 걸림 순. 그 밖의 신호만 붙은 것은 그 뒤 */
const ATTENTION_RANK: Partial<Record<TestSignal, number>> = {
  overdue: 0,
  longBlocked: 1,
  longRunning: 2,
}

export const attentionRank = (signals: TestSignal[]) =>
  Math.min(3, ...signals.map((s) => ATTENTION_RANK[s] ?? 3))

/** 손쓸 테스트 정렬 — 순위 → N일째가 긴 것 → 받은 순서(seq) */
export function sortAttention<T extends { signals: TestSignal[]; statusDays: number }>(
  rows: T[],
): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        attentionRank(a.row.signals) - attentionRank(b.row.signals) ||
        b.row.statusDays - a.row.statusDays ||
        a.i - b.i,
    )
    .map((x) => x.row)
}

/** '테스트 중 · 5일째' — 오늘 바뀌었으면 '오늘부터' */
export function testSinceLabel(t: Pick<TestCase, 'status' | 'statusDays'>, status = t.status) {
  const span = t.statusDays === 0 ? '오늘부터' : `${t.statusDays}일째`
  return `${testStatusLabel(status)} · ${span}`
}

export const testPeriodLabel = (t: Pick<TestCase, 'start' | 'due'>) =>
  t.start && t.due
    ? `${slashDay(t.start)} ~ ${slashDay(t.due)}`
    : t.due
      ? `~ ${slashDay(t.due)}`
      : t.start
        ? `${slashDay(t.start)} ~`
        : ''

/** 기간의 끝까지 — '3일 남음' · '오늘까지' · '2일 지남'. 기한이 없으면 '기간 미정' */
export function dueLeftLabel(due: string | null, today: string) {
  if (!due) return '기간 미정'
  const left = daysBetween(today, due)
  if (left > 0) return `${left}일 남음`
  if (left === 0) return '오늘까지'
  return `${-left}일 지남`
}

/* 입력 검사 — 계약 '검사' 그대로. 목업 api 가 서버처럼 422 를 내고, 화면이 보내기 전에 같은 말을 띄운다 */
export const TEST_TITLE_MAX = 200
/** 테스트 내용 — 지난 단계를 옮겨 담는 칸이라 넉넉히 */
export const TEST_CONTENT_MAX = 10000
export const TEST_TEXT_MAX = 4000
export const TEST_REF_MAX = 20

export interface TestFieldsInput {
  title?: string
  content?: string
  testData?: string
  start?: string | null
  due?: string | null
}

/** 어긴 자리 → 까닭. detail 키는 서버와 같다 */
export function testFieldProblems(input: TestFieldsInput): Record<string, string> {
  const detail: Record<string, string> = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (title.length < 1 || title.length > TEST_TITLE_MAX)
      detail.title = `제목은 1 ~ ${TEST_TITLE_MAX}자로 적어 주세요.`
  }
  if (input.content !== undefined && input.content.length > TEST_CONTENT_MAX)
    detail.content = `${TEST_CONTENT_MAX.toLocaleString()}자까지 적을 수 있습니다.`
  if (input.testData !== undefined && input.testData.length > TEST_TEXT_MAX)
    detail.testData = `${TEST_TEXT_MAX.toLocaleString()}자까지 적을 수 있습니다.`
  if (input.start && input.due && input.start > input.due)
    detail.due = '끝나는 날이 시작하는 날보다 앞입니다.'
  return detail
}

/** 상태 바꾸기의 검사 — 실패 · 막힘은 메모 필수 */
export function testStatusProblem(
  status: TestStatus,
  note: string | undefined,
): Record<string, string> {
  const detail: Record<string, string> = {}
  if ((status === 'fail' || status === 'blocked') && !(note ?? '').trim())
    detail.note = status === 'fail' ? '실패한 까닭을 적어 주세요.' : '막힌 까닭을 적어 주세요.'
  if ((note ?? '').length > TEST_TEXT_MAX)
    detail.note = `${TEST_TEXT_MAX.toLocaleString()}자까지 적을 수 있습니다.`
  return detail
}

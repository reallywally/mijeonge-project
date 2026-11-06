import type {
  AgendaRisk,
  AgendaRiskSignal,
  RiskAnalysisCompare,
  RiskAnalysisFacts,
  RiskCompareRef,
  RiskKind,
  RiskLevel,
  RiskSettings,
  TaskRisk,
  TaskRiskSignal,
  TestRisk,
  TestRiskSignal,
} from '@/types/domain'

/* 리스크의 화면 말 · 기준 검사 · 대시보드 셈 (docs/api/risk.md · risk-dashboard.md). 판정(신호 · 점수 · 등급)은 서버 몫이라 여기 없다 —
   여기는 받은 줄을 세고 거르고 섞기만 한다 */

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  dueSoonDays: 3,
  staleDays: 7,
  highScore: 6,
  mediumScore: 3,
  churnDays: 14,
  churnCount: 5,
  slipCount: 2,
}

export type RiskSettingKey = keyof RiskSettings

export interface RiskSettingField {
  key: RiskSettingKey
  label: string
  unit: string
  min: number
  max: number
}

/** 대화 상자의 묶음 · 칸 순서 · 이름 · 범위. 범위는 서버 검사와 같다 */
export const RISK_SETTING_GROUPS: { label: string; fields: RiskSettingField[] }[] = [
  {
    label: '지연',
    fields: [
      { key: 'dueSoonDays', label: '기한 임박', unit: '일', min: 1, max: 30 },
      { key: 'staleDays', label: '오래 멈춤', unit: '일', min: 1, max: 90 },
    ],
  },
  {
    label: '흔들림',
    fields: [
      { key: 'churnDays', label: '세는 기간', unit: '일', min: 1, max: 90 },
      { key: 'churnCount', label: '내용 변경', unit: '번', min: 2, max: 50 },
      { key: 'slipCount', label: '기한 미룸', unit: '번', min: 1, max: 10 },
    ],
  },
  {
    label: '등급',
    fields: [
      { key: 'highScore', label: 'high 점수', unit: '점', min: 2, max: 30 },
      { key: 'mediumScore', label: 'medium 점수', unit: '점', min: 1, max: 29 },
    ],
  },
]

export const RISK_SETTING_FIELDS: RiskSettingField[] = RISK_SETTING_GROUPS.flatMap((g) => g.fields)

/** 칸마다 틀린 까닭. 비어 있으면 보내도 된다. 대소가 어긋나면 서버처럼 highScore 에 단다 */
export function riskSettingsProblems(settings: Record<RiskSettingKey, unknown>) {
  const problems: Partial<Record<RiskSettingKey, string>> = {}
  for (const f of RISK_SETTING_FIELDS) {
    const value = settings[f.key]
    if (typeof value !== 'number' || !Number.isInteger(value))
      problems[f.key] = '정수를 넣어 주세요.'
    else if (value < f.min || value > f.max)
      problems[f.key] = `${f.min} ~ ${f.max} 사이로 넣어 주세요.`
  }
  if (
    !problems.highScore &&
    !problems.mediumScore &&
    (settings.highScore as number) <= (settings.mediumScore as number)
  )
    problems.highScore = 'medium 점수보다 커야 합니다.'
  return problems
}

/** 일곱 값만 골라 낸다 — PUT 은 통째로, 다른 키는 싣지 않는다 */
export const pickRiskSettings = (s: RiskSettings): RiskSettings => ({
  dueSoonDays: s.dueSoonDays,
  staleDays: s.staleDays,
  highScore: s.highScore,
  mediumScore: s.mediumScore,
  churnDays: s.churnDays,
  churnCount: s.churnCount,
  slipCount: s.slipCount,
})

/** 기준 한 줄 — 위 줄의 'N/N 기준' 을 가리키면 보인다. 옛 분석의 기준엔 흔들림 셋이 없을 수 있다 */
export function riskSettingsLine(s: RiskSettings) {
  const base = `기한 임박 ${s.dueSoonDays}일 · 멈춤 ${s.staleDays}일 · high ${s.highScore}점 · medium ${s.mediumScore}점`
  if (s.churnDays === undefined) return base
  return `${base} · 흔들림 ${s.churnDays}일 안 내용 ${s.churnCount}번 · 미룸 ${s.slipCount}번`
}

export const AGENDA_SIGNAL_LABEL: Record<AgendaRiskSignal, string> = {
  overdue: '기한 지남',
  dueSoon: '기한 임박',
  stale: '오래 멈춤',
  blocking: '작업을 막는 중',
  decisionAfterTaskDue: '작업 기한이 먼저',
  noOwner: '담당자 없음',
  noDueDate: '기한 없음',
}

export const TASK_SIGNAL_LABEL: Record<TaskRiskSignal, string> = {
  overdue: '기한 넘김',
  longBlocked: '오래 막힘',
  longRunning: '오래 걸림',
  dueSlipped: '기한 거듭 미룸',
  notStarted: '시작 안 함',
  contentChurn: '내용 자주 바뀜',
  ownerChurn: '담당자 자주 바뀜',
}

export const TEST_RISK_SIGNAL_LABEL: Record<TestRiskSignal, string> = {
  overdue: '기간 지남',
  failedIdle: '실패 그대로',
  longBlocked: '오래 막힘',
  basisChanged: '기준 바뀜',
  longRunning: '오래 걸림',
  flaky: '결과 뒤집힘',
  dueSlipped: '기한 거듭 미룸',
  notStarted: '시작 안 함',
}

const LABELS: Record<RiskKind, Record<string, string>> = {
  agenda: AGENDA_SIGNAL_LABEL,
  task: TASK_SIGNAL_LABEL,
  test: TEST_RISK_SIGNAL_LABEL,
}

/** 신호의 화면 말 — 스냅샷이라 이름이 문자열로 온다. 모르는 이름은 그대로 보인다 */
export const signalLabel = (signal: string, kind: RiskKind = 'agenda') =>
  LABELS[kind][signal] ?? signal

export const RISK_KIND_LABEL: Record<RiskKind, string> = {
  agenda: '안건',
  task: '작업',
  test: '테스트',
}
export const RISK_KINDS: RiskKind[] = ['task', 'agenda', 'test']

export const RISK_LEVELS: RiskLevel[] = ['high', 'medium', 'low']
export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
}

/** 저장한 분석 제목 상한 — 서버 검사와 같다 (docs/api/risk-analysis.md) */
export const RISK_ANALYSIS_TITLE_MAX = 100

/** [저장] 창의 기본 제목 — 한국 시간 오늘 */
export const defaultAnalysisTitle = (day: string) => `리스크 분석 ${day}`

/** 스냅샷의 등급 — 모르는 값은 null(화면이 글자 그대로 둔다) */
export const asRiskLevel = (v: string): RiskLevel | null =>
  (RISK_LEVELS as string[]).includes(v) ? (v as RiskLevel) : null

/* ── 대시보드 — 세 종류를 한 모양으로 ── */

/** 세 종류의 신호 이름을 합친 것. 같은 이름은 같은 뜻이라 막대 하나로 센다 */
export type RiskSignal = AgendaRiskSignal | TaskRiskSignal | TestRiskSignal

/** 신호별 막대의 말 — 종류마다 다른 말(기한 지남 · 기한 넘김 · 기간 지남)을 하나로 */
export const MERGED_SIGNAL_LABEL: Record<RiskSignal, string> = {
  overdue: '기한 넘김',
  longBlocked: '오래 막힘',
  longRunning: '오래 걸림',
  notStarted: '시작 안 함',
  failedIdle: '실패 그대로',
  stale: '오래 멈춤',
  blocking: '작업을 막는 중',
  dueSoon: '기한 임박',
  decisionAfterTaskDue: '작업 기한이 먼저',
  basisChanged: '기준 바뀜',
  noOwner: '담당자 없음',
  noDueDate: '기한 없음',
  dueSlipped: '기한 거듭 미룸',
  contentChurn: '내용 자주 바뀜',
  ownerChurn: '담당자 자주 바뀜',
  flaky: '결과 뒤집힘',
}

/** '흔들림' 묶음 — 막대에서 머리를 따로 단다 */
export const CHURN_SIGNALS: RiskSignal[] = ['dueSlipped', 'contentChurn', 'ownerChurn', 'flaky']
/** 숫자 카드 '지연' 을 누르면 거는 신호 */
export const DELAY_SIGNALS: RiskSignal[] = ['overdue', 'longBlocked', 'longRunning']
/** 눈에 띄게 그리는 신호 — 점수 3 */
const STRONG = new Set<RiskSignal>(['overdue', 'blocking', 'longBlocked', 'failedIdle'])
export const isStrongSignal = (s: string) => STRONG.has(s as RiskSignal)

/** 대시보드 목록 한 줄 — 세 종류를 섞어 그린다 */
export interface RiskRow {
  kind: RiskKind
  id: string
  /** 작업 · 테스트 키. 안건은 아직 키가 없어 null */
  key: string | null
  title: string
  level: RiskLevel
  score: number
  signals: RiskSignal[]
  ownerId: string | null
  partId: string | null
  /** 기한 — 안건은 결정 기한 */
  due: string | null
  overdueDays: number
  /** 그 줄의 가장 큰 신호 하나를 숫자로 */
  metric: string
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/* 핵심 숫자 — 점수가 큰 신호부터 본다. 표의 신호 순서가 점수 순이라 첫 신호가 가장 크다 */

function agendaMetric(a: AgendaRisk, asOf: string): string {
  const order: AgendaRiskSignal[] = [
    'overdue',
    'blocking',
    'decisionAfterTaskDue',
    'stale',
    'dueSoon',
    'noOwner',
    'noDueDate',
  ]
  const top = order.find((s) => a.signals.includes(s))
  switch (top) {
    case 'overdue':
      return `기한 넘김 ${a.overdueDays}일`
    case 'blocking':
      return `막힌 작업 ${a.blockedTaskIds.length}건`
    case 'decisionAfterTaskDue':
      return a.nearestTaskDue
        ? `작업 기한 ${daysBetween(a.nearestTaskDue, asOf)}일 지남`
        : '작업 기한이 먼저'
    case 'stale':
      return `${a.idleDays}일째 멈춤`
    case 'dueSoon':
      return a.dueDate ? `D-${Math.max(0, daysBetween(asOf, a.dueDate))}` : '기한 임박'
    default:
      return top ? AGENDA_SIGNAL_LABEL[top] : ''
  }
}

function taskMetric(t: TaskRisk, asOf: string): string {
  switch (t.signals[0]) {
    case 'overdue':
      return `기한 넘김 ${t.overdueDays}일`
    case 'longBlocked':
      return `${t.statusDays}일째 막힘`
    case 'longRunning':
      return t.plannedDays ? `${t.statusDays}일째 · 계획 ${t.plannedDays}일` : `${t.statusDays}일째`
    case 'dueSlipped':
      return `미룸 ${t.slipCount}번`
    case 'notStarted':
      return t.start && t.start < asOf
        ? `시작 ${daysBetween(t.start, asOf)}일 늦음`
        : t.due
          ? `D-${Math.max(0, daysBetween(asOf, t.due))}`
          : '시작 안 함'
    case 'contentChurn':
      return `내용 ${t.contentChanges}번 바뀜`
    case 'ownerChurn':
      return `담당 ${t.ownerChanges}번 바뀜`
    default:
      return ''
  }
}

function testMetric(t: TestRisk): string {
  switch (t.signals[0]) {
    case 'overdue':
      return `기간 지남 ${t.overdueDays}일`
    case 'failedIdle':
      return `${t.statusDays}일째 실패`
    case 'longBlocked':
      return `${t.statusDays}일째 막힘`
    case 'longRunning':
      return `${t.statusDays}일째 테스트 중`
    case 'flaky':
      return `뒤집힘 ${t.flips}번`
    case 'dueSlipped':
      return `미룸 ${t.slipCount}번`
    case 'basisChanged':
      return '기준 바뀜'
    case 'notStarted':
      return `${t.statusDays}일째 시작 전`
    default:
      return ''
  }
}

export const agendaRow = (a: AgendaRisk, asOf: string): RiskRow => ({
  kind: 'agenda',
  id: a.agendaId,
  key: null,
  title: a.title,
  level: a.level,
  score: a.score,
  signals: a.signals,
  ownerId: a.ownerId,
  partId: a.partId,
  due: a.dueDate,
  overdueDays: a.overdueDays,
  metric: agendaMetric(a, asOf),
})

export const taskRow = (t: TaskRisk, asOf: string): RiskRow => ({
  kind: 'task',
  id: t.taskId,
  key: t.key,
  title: t.title,
  level: t.level,
  score: t.score,
  signals: t.signals,
  ownerId: t.ownerId,
  partId: t.partId,
  due: t.due,
  overdueDays: t.overdueDays,
  metric: taskMetric(t, asOf),
})

export const testRow = (t: TestRisk): RiskRow => ({
  kind: 'test',
  id: t.testId,
  key: t.key,
  title: t.title,
  level: t.level,
  score: t.score,
  signals: t.signals,
  ownerId: t.ownerId,
  partId: t.partId,
  due: t.due,
  overdueDays: t.overdueDays,
  metric: testMetric(t),
})

const KIND_ORDER: Record<RiskKind, number> = { task: 0, agenda: 1, test: 2 }

/** 세 종류를 한 표로 — 점수 ↓ → 기한 넘긴 날 ↓ → 작업 · 안건 · 테스트 → 받은 순서. 같은 종류 안의 서버 순서는 그대로 남는다 */
export function mixRiskRows(groups: RiskRow[][]): RiskRow[] {
  return groups
    .flat()
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        b.row.score - a.row.score ||
        b.row.overdueDays - a.row.overdueDays ||
        KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] ||
        a.i - b.i,
    )
    .map((x) => x.row)
}

export interface RiskFilter {
  /** null 은 전체 */
  kind: RiskKind | null
  /** 비면 전체. 여럿이면 그중 하나 */
  levels: RiskLevel[]
  /** 비면 전체. 여럿이면 그중 하나라도 걸린 줄 */
  signals: RiskSignal[]
}

export const EMPTY_RISK_FILTER: RiskFilter = { kind: null, levels: [], signals: [] }

export const filterRiskRows = (rows: RiskRow[], f: RiskFilter) =>
  rows.filter(
    (r) =>
      (f.kind === null || r.kind === f.kind) &&
      (f.levels.length === 0 || f.levels.includes(r.level)) &&
      (f.signals.length === 0 || r.signals.some((s) => f.signals.includes(s))),
  )

export interface RiskKindCount {
  high: number
  medium: number
  low: number
}

/** 숫자 카드 — 종류마다 등급별 수와 '지연'(기한 넘김 합 · 오래 막힘 · 오래 걸림) */
export function riskCards(rows: RiskRow[]) {
  const kinds = Object.fromEntries(
    RISK_KINDS.map((k) => [k, { high: 0, medium: 0, low: 0 } as RiskKindCount]),
  ) as Record<RiskKind, RiskKindCount>
  const has = (s: RiskSignal) => rows.filter((r) => r.signals.includes(s)).length
  for (const r of rows) kinds[r.kind][r.level] += 1
  return {
    kinds,
    delay: {
      overdue: has('overdue'),
      longBlocked: has('longBlocked'),
      longRunning: has('longRunning'),
    },
  }
}

export interface SignalBar {
  signal: RiskSignal
  label: string
  total: number
  /** 종류별 수 — 쌓은 막대의 마디 */
  byKind: Record<RiskKind, number>
}

/** 신호별 막대 — 많은 것부터, 같으면 이름 순. 흔들림 묶음은 따로 낸다 */
export function signalBars(rows: RiskRow[]): { main: SignalBar[]; churn: SignalBar[] } {
  const bars = new Map<RiskSignal, SignalBar>()
  for (const r of rows)
    for (const s of r.signals) {
      let bar = bars.get(s)
      if (!bar) {
        bar = {
          signal: s,
          label: MERGED_SIGNAL_LABEL[s] ?? s,
          total: 0,
          byKind: { agenda: 0, task: 0, test: 0 },
        }
        bars.set(s, bar)
      }
      bar.total += 1
      bar.byKind[r.kind] += 1
    }
  const sorted = [...bars.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label, 'ko'),
  )
  return {
    main: sorted.filter((b) => !CHURN_SIGNALS.includes(b.signal)),
    churn: sorted.filter((b) => CHURN_SIGNALS.includes(b.signal)),
  }
}

/* ── 저장한 분석 — 옛 모양(2026-11-06 전)도 읽는다. 서버는 옛 줄을 고치지 않는다 ── */

type WireRef = string | { kind?: string; id?: string; agendaId?: string }
type WireKept = {
  kind?: string
  id?: string
  agendaId?: string
  levelFrom: string
  levelTo: string
}

const asKind = (v: unknown): RiskKind =>
  v === 'task' || v === 'test' || v === 'agenda' ? v : 'agenda'

function readRef(raw: WireRef): RiskCompareRef {
  if (typeof raw === 'string') return { kind: 'agenda', id: raw }
  return { kind: asKind(raw.kind), id: String(raw.id ?? raw.agendaId ?? '') }
}

/** compare 의 added · removed · kept 를 { kind, id } 로. 문자열(= 안건 id) · agendaId 모양도 받는다 */
export function readCompare(raw: unknown): RiskAnalysisCompare | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : [])
  return {
    previousId: String(c.previousId ?? ''),
    previousTitle: String(c.previousTitle ?? ''),
    previousSavedAt: String(c.previousSavedAt ?? ''),
    added: list<WireRef>(c.added).map(readRef),
    removed: list<WireRef>(c.removed).map(readRef),
    kept: list<WireKept>(c.kept).map((k) => ({
      ...readRef(k),
      levelFrom: k.levelFrom,
      levelTo: k.levelTo,
    })),
  }
}

/** 저장된 그대로의 facts — 2026-11-06 전 것은 tasks · tests 가 없고 compare 가 옛 모양이다 */
export type StoredRiskAnalysisFacts = Omit<RiskAnalysisFacts, 'tasks' | 'tests' | 'compare'> & {
  tasks?: RiskAnalysisFacts['tasks']
  tests?: RiskAnalysisFacts['tests']
  compare: unknown
}

/** facts 의 옛 모양 — tasks · tests 가 없으면 [], compare 는 위처럼 */
export function readFacts(raw: StoredRiskAnalysisFacts): RiskAnalysisFacts {
  return {
    ...raw,
    agendas: raw.agendas ?? [],
    tasks: raw.tasks ?? [],
    tests: raw.tests ?? [],
    compare: readCompare(raw.compare),
  }
}

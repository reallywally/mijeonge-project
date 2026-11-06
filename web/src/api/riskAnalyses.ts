import { id, mockError, request } from '@/api/client'
import { forbidden, later, memberOf, mockDb, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import type { MockRiskAnalysis } from '@/fixtures'
import { canDeleteComment, canEditComment, canSeeProject } from '@/lib/access'
import { nowIso } from '@/lib/date'
import { readFacts, RISK_ANALYSIS_TITLE_MAX } from '@/lib/risk'
import type {
  AgendaRisk,
  ChatRef,
  Me,
  RiskAnalysis,
  RiskAnalysisCompare,
  RiskAnalysisFacts,
  RiskAnalysisListItem,
  RiskAnalysisPage,
  RiskAnalysisSaveInput,
  RiskCompareRef,
  RiskKind,
  RiskSettings,
  TaskRisk,
  TestRisk,
} from '@/types/domain'

/* 저장한 AI 리스크 분석 — 게시판 (docs/api/risk-analysis.md). 분석이 끝나면 서버가 임시로 남기고(done.analysisId),
   [저장] 이 거기에 제목을 붙여 게시판에 올린다. 목업 갈래도 같은 규칙 · 같은 오류 코드로 돈다 */

/** 게시판 한 번에 받는 수 — 계약 기본값 */
export const RISK_ANALYSIS_PAGE = 50
/** 임시 분석을 저장할 수 있는 시간 */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

const notFound = () => mockError(404, 'RISK_ANALYSIS_NOT_FOUND', '리스크 분석을 찾을 수 없습니다.')

const expired = (row: MockRiskAnalysis, now = Date.now()) =>
  now - Date.parse(row.createdAt) > DRAFT_TTL_MS

/** 앞뒤 공백을 떼고 1 ~ 100자. 아니면 422 (detail.title) */
function checkedTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (title.length === 0 || title.length > RISK_ANALYSIS_TITLE_MAX)
    throw mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.', {
      title: `제목은 1 ~ ${RISK_ANALYSIS_TITLE_MAX}자로 넣어 주세요.`,
    })
  return title
}

type Saved = MockRiskAnalysis & { seq: number; title: string; savedAt: string }
const isSaved = (r: MockRiskAnalysis): r is Saved => r.savedAt !== null

function itemOf(r: Saved): RiskAnalysisListItem {
  const facts = readFacts(r.facts)
  const high = [...facts.agendas, ...facts.tasks, ...facts.tests].filter(
    (a) => a.level === 'high',
  ).length
  return {
    id: r.id,
    projectId: r.projectId,
    seq: r.seq,
    title: r.title,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    savedAt: r.savedAt,
    agendaCount: facts.agendas.length,
    taskCount: facts.tasks.length,
    testCount: facts.tests.length,
    highCount: high,
  }
}

/* 서버 응답처럼 늘 새 객체를 낸다 — 스토어가 받은 것을 고쳐도 목업 저장소가 따라 바뀌지 않게 */
const detailOf = (r: Saved): RiskAnalysis =>
  structuredClone({
    ...itemOf(r),
    body: r.body,
    refs: r.refs,
    facts: readFacts(r.facts),
    titleEditedAt: r.titleEditedAt,
  })

/** 저장한 것만 — 임시 · 없는 것 · 못 보는 프로젝트 것은 404 */
function requireSaved(me: Me, analysisId: string): Saved {
  const row = mockDb().riskAnalyses.find((r) => r.id === analysisId)
  if (!row || !isSaved(row) || !canSeeProject(me, row.projectId)) throw notFound()
  return row
}

type SnapRow = { kind: RiskKind; id: string; level: string }

/** 스냅샷의 세 종류를 { kind, id, level } 한 줄로 */
const snapRows = (f: Pick<RiskAnalysisFacts, 'agendas' | 'tasks' | 'tests'>): SnapRow[] => [
  ...f.agendas.map((a) => ({ kind: 'agenda' as const, id: a.agendaId, level: a.level })),
  ...f.tasks.map((t) => ({ kind: 'task' as const, id: t.taskId, level: t.level })),
  ...f.tests.map((t) => ({ kind: 'test' as const, id: t.testId, level: t.level })),
]
const keyOf = (r: RiskCompareRef) => `${r.kind}:${r.id}`
const refOf = (r: SnapRow): RiskCompareRef => ({ kind: r.kind, id: r.id })

/** 그 프로젝트의 가장 최근 저장 분석 대비 — 분석을 돌린 때 센다. 세 종류를 { kind, id } 로 */
function compareWith(
  projectId: string,
  facts: Pick<RiskAnalysisFacts, 'agendas' | 'tasks' | 'tests'>,
): RiskAnalysisCompare | null {
  const prev = mockDb()
    .riskAnalyses.filter((r): r is Saved => r.projectId === projectId && isSaved(r))
    .sort((a, b) => b.seq - a.seq)[0]
  if (!prev) return null
  const beforeRows = snapRows(readFacts(prev.facts))
  const before = new Map(beforeRows.map((r) => [keyOf(r), r.level]))
  const nowRows = snapRows(facts)
  const now = new Set(nowRows.map(keyOf))
  return {
    previousId: prev.id,
    previousTitle: prev.title,
    previousSavedAt: prev.savedAt,
    added: nowRows.filter((r) => !before.has(keyOf(r))).map(refOf),
    removed: beforeRows.filter((r) => !now.has(keyOf(r))).map(refOf),
    kept: nowRows
      .filter((r) => before.has(keyOf(r)))
      .map((r) => ({ ...refOf(r), levelFrom: before.get(keyOf(r))!, levelTo: r.level })),
  }
}

/**
 * 목업 요약 스트림이 끝까지 흘렀을 때 임시 분석을 남긴다 — 서버의 risks/summary 와 같은 자리.
 * 24시간 넘은 임시 줄은 이때 지운다. 돌려준 id 가 done.analysisId 다
 */
export function mockCreateRiskDraft(input: {
  projectId: string
  me: Me
  asOf: string
  settings: RiskSettings
  agendas: AgendaRisk[]
  tasks?: TaskRisk[]
  tests?: TestRisk[]
  body: string
  refs: ChatRef[]
}): string {
  const db = mockDb()
  const now = Date.now()
  db.riskAnalyses = db.riskAnalyses.filter((r) => isSaved(r) || !expired(r, now))
  const nameOf = (id: string | null) => (id && memberOf(id)?.name) || null
  const agendas = input.agendas.map((a) => ({
    agendaId: a.agendaId,
    key: null,
    title: a.title,
    level: a.level,
    score: a.score,
    signals: [...a.signals],
    ownerName: nameOf(a.ownerId),
  }))
  const tasks = (input.tasks ?? []).map((t) => ({
    taskId: t.taskId,
    key: t.key,
    title: t.title,
    level: t.level,
    score: t.score,
    signals: [...t.signals],
    ownerName: nameOf(t.ownerId),
  }))
  const tests = (input.tests ?? []).map((t) => ({
    testId: t.testId,
    key: t.key,
    title: t.title,
    level: t.level,
    score: t.score,
    signals: [...t.signals],
    ownerName: nameOf(t.ownerId),
  }))
  db.riskAnalysisSeq += 1
  const row: MockRiskAnalysis = {
    id: `ra${db.riskAnalysisSeq}`,
    projectId: input.projectId,
    seq: null,
    title: null,
    body: input.body,
    refs: structuredClone(input.refs),
    facts: {
      asOf: input.asOf,
      settings: structuredClone(input.settings),
      agendas,
      tasks,
      tests,
      compare: compareWith(input.projectId, { agendas, tasks, tests }),
    },
    createdBy: input.me.id,
    createdAt: nowIso(),
    savedAt: null,
    titleEditedAt: null,
  }
  db.riskAnalyses.push(row)
  return row.id
}

/* 서버 갈래 — 2026-11-06 전에 저장한 분석은 compare 가 옛 모양(문자열 · agendaId)이고 tasks · tests 가 없다. 화면이 둘 다 읽는다 */
const readAnalysis = (a: RiskAnalysis): RiskAnalysis => ({
  ...a,
  taskCount: a.taskCount ?? 0,
  testCount: a.testCount ?? 0,
  ...(a.facts ? { facts: readFacts(a.facts) } : {}),
})
const readItem = (a: RiskAnalysisListItem): RiskAnalysisListItem => ({
  ...a,
  taskCount: a.taskCount ?? 0,
  testCount: a.testCount ?? 0,
})

const mock = {
  list(projectId: string, limit: number, offset: number): RiskAnalysisPage {
    requireProject(requireMe(), projectId)
    const rows = mockDb()
      .riskAnalyses.filter((r): r is Saved => r.projectId === projectId && isSaved(r))
      .sort((a, b) => b.seq - a.seq)
    const size = Math.min(Math.max(1, limit), 200)
    const from = Math.max(0, offset)
    return { items: rows.slice(from, from + size).map(itemOf), total: rows.length }
  },
  save(projectId: string, input: RiskAnalysisSaveInput): RiskAnalysis {
    const me = requireMe()
    requireProject(me, projectId)
    const title = checkedTitle(input.title)
    const db = mockDb()
    const row = db.riskAnalyses.find((r) => r.id === input.analysisId)
    /* 없거나 · 다른 프로젝트 · 남이 돌린 것은 있는 줄도 모르게 404 */
    if (!row || row.projectId !== projectId || row.createdBy !== me.id) throw notFound()
    if (isSaved(row)) throw mockError(409, 'RISK_ANALYSIS_ALREADY_SAVED', '이미 저장한 분석입니다.')
    if (expired(row)) throw notFound()
    const no = (db.riskAnalysisNo[projectId] ?? 0) + 1
    db.riskAnalysisNo[projectId] = no
    row.seq = no
    row.title = title
    row.savedAt = nowIso()
    return detailOf(row as Saved)
  },
  get: (analysisId: string): RiskAnalysis => detailOf(requireSaved(requireMe(), analysisId)),
  rename(analysisId: string, rawTitle: unknown): RiskAnalysis {
    const me = requireMe()
    const row = requireSaved(me, analysisId)
    if (!canEditComment(me, { authorId: row.createdBy ?? '' })) throw forbidden()
    const title = checkedTitle(rawTitle)
    /* 같은 제목이면 고친 시각을 찍지 않는다 — 서버와 같다 */
    if (title !== row.title) {
      row.title = title
      row.titleEditedAt = nowIso()
    }
    return detailOf(row)
  },
  remove(analysisId: string) {
    const me = requireMe()
    const row = requireSaved(me, analysisId)
    if (!canDeleteComment(me, { authorId: row.createdBy ?? '' }, row.projectId)) throw forbidden()
    const db = mockDb()
    db.riskAnalyses = db.riskAnalyses.filter((r) => r.id !== analysisId)
  },
}

/** 게시판 — 저장한 것만, 번호 내림차순 */
export const fetchRiskAnalyses = (projectId: string, offset = 0, limit = RISK_ANALYSIS_PAGE) =>
  isMockMode()
    ? later(() => mock.list(projectId, limit, offset))
    : request<RiskAnalysisPage>(
        'GET',
        `/projects/${id(projectId)}/risk-analyses?limit=${limit}&offset=${offset}`,
      ).then((page) => ({ ...page, items: (page.items ?? []).map(readItem) }))

/** 임시 분석에 제목을 붙여 저장 — 24시간 지남 · 남의 것은 404, 두 번째는 409 RISK_ANALYSIS_ALREADY_SAVED */
export const saveRiskAnalysis = (projectId: string, input: RiskAnalysisSaveInput) =>
  isMockMode()
    ? later(() => mock.save(projectId, input))
    : request<RiskAnalysis>('POST', `/projects/${id(projectId)}/risk-analyses`, input).then(
        readAnalysis,
      )

export const fetchRiskAnalysis = (analysisId: string) =>
  isMockMode()
    ? later(() => mock.get(analysisId))
    : request<RiskAnalysis>('GET', `/risk-analyses/${id(analysisId)}`).then(readAnalysis)

/** 제목만, 작성자만(403) */
export const renameRiskAnalysis = (analysisId: string, title: string) =>
  isMockMode()
    ? later(() => mock.rename(analysisId, title))
    : request<RiskAnalysis>('PATCH', `/risk-analyses/${id(analysisId)}`, { title }).then(
        readAnalysis,
      )

/** 작성자 · 프로젝트 관리자 · 시스템 관리자(403) */
export const deleteRiskAnalysis = (analysisId: string) =>
  isMockMode()
    ? later(() => mock.remove(analysisId))
    : request<void>('DELETE', `/risk-analyses/${id(analysisId)}`)

import { mockDeltas, postSse, settle } from '@/api/chat'
import { id, mockError, request } from '@/api/client'
import { later, memberOf, mockDb, requireManager, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { mockCreateRiskDraft } from '@/api/riskAnalyses'
import { mockRiskSummary, RISK_AS_OF, riskReports } from '@/fixtures'
import { collectRefs } from '@/lib/chat'
import { DEFAULT_RISK_SETTINGS, pickRiskSettings, riskSettingsProblems } from '@/lib/risk'
import type {
  ChatEvent,
  ChatRef,
  DecisionRiskReport,
  RiskLevel,
  RiskSettings,
  RiskSummaryInput,
} from '@/types/domain'

/** AI 리스크 분석에 실을 수 있는 id 수 — 종류마다 (docs/api/risk-dashboard.md) */
export const MAX_RISK_SUMMARY_IDS = 100

/* 결정 병목 리스크 (docs/api/risk.md). 읽기는 프로젝트 멤버 누구나, 기준 바꾸기는 프로젝트 관리자 · 시스템 관리자.
   목업 갈래는 계산하지 않는다 — 굳혀 둔 보고서에 지금 기준(settings)과 그 기준의 등급만 맞춰 낸다 */

const settingsOf = (projectId: string): RiskSettings => ({
  ...DEFAULT_RISK_SETTINGS,
  ...structuredClone(mockDb().riskSettings[projectId]),
})

/** 작업 · 테스트 리스크(2026-11-06) 전의 서버가 낸 모양도 받는다 — 없는 칸은 빈 값으로 */
const readReport = (r: DecisionRiskReport): DecisionRiskReport => ({
  ...r,
  settings: { ...DEFAULT_RISK_SETTINGS, ...r.settings },
  agendas: r.agendas ?? [],
  tasks: r.tasks ?? [],
  tests: r.tests ?? [],
  owners: (r.owners ?? []).map((o) => ({
    ...o,
    riskyTasks: o.riskyTasks ?? 0,
    riskyTests: o.riskyTests ?? 0,
  })),
})

const levelOf = (score: number, s: RiskSettings): RiskLevel =>
  score >= s.highScore ? 'high' : score >= s.mediumScore ? 'medium' : 'low'

const mock = {
  report(projectId: string): DecisionRiskReport {
    requireProject(requireMe(), projectId)
    const settings = settingsOf(projectId)
    const fixed = riskReports[projectId]
    if (!fixed) return { asOf: RISK_AS_OF, settings, agendas: [], tasks: [], tests: [], owners: [] }
    const report = structuredClone(fixed)
    return {
      ...report,
      settings,
      agendas: report.agendas.map((t) => ({ ...t, level: levelOf(t.score, settings) })),
      tasks: report.tasks.map((t) => ({ ...t, level: levelOf(t.score, settings) })),
      tests: report.tests.map((t) => ({ ...t, level: levelOf(t.score, settings) })),
    }
  },
  settings(projectId: string): RiskSettings {
    requireProject(requireMe(), projectId)
    return settingsOf(projectId)
  },
  put(projectId: string, input: RiskSettings): RiskSettings {
    requireManager(projectId)
    const problems = riskSettingsProblems(input)
    if (Object.keys(problems).length > 0)
      throw mockError(
        422,
        'VALIDATION_ERROR',
        '입력값이 올바르지 않습니다.',
        problems as Record<string, string>,
      )
    const saved = pickRiskSettings(input)
    mockDb().riskSettings[projectId] = saved
    return structuredClone(saved)
  },
  /** 서버처럼 다시 계산한 보고서를 보낸 id 로 거르고(모르는 id 는 버린다) 정해 둔 문구를 만든다.
      다 흘린 뒤 임시 분석을 남기는 데 쓸 재료(draft)도 같이 낸다 — 거른 뒤 비면 Claude 를 안 부른 것이라 null */
  summary(projectId: string, input: Partial<RiskSummaryInput>) {
    /* 옛 화면 호환 — taskIds · testIds 가 없으면 [] 로 본다 */
    const lists = [input.agendaIds, input.taskIds ?? [], input.testIds ?? []]
    if (lists.some((ids) => !Array.isArray(ids) || ids.length > MAX_RISK_SUMMARY_IDS))
      throw mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.')
    const [agendaIds, taskIds, testIds] = lists as string[][]
    const me = requireMe()
    const report = mock.report(projectId)
    const agendas = report.agendas.filter((t) => agendaIds.includes(t.agendaId))
    const tasks = report.tasks.filter((t) => taskIds.includes(t.taskId))
    const tests = report.tests.filter((t) => testIds.includes(t.testId))
    const text = mockRiskSummary(
      { ...report, agendas, tasks, tests },
      (memberId) => (memberId && memberOf(memberId)?.name) || '담당자 없음',
    )
    const refs: ChatRef[] = collectRefs(text)
    const draft =
      agendas.length + tasks.length + tests.length > 0
        ? {
            projectId,
            me,
            asOf: report.asOf,
            settings: report.settings,
            agendas,
            tasks,
            tests,
            body: text,
            refs,
          }
        : null
    return { text, refs, draft }
  },
}

/** 그 프로젝트의 지금 기준으로 계산한 보고서. 멤버가 아니면 403 · 없는 프로젝트는 404 */
export const fetchRisks = (projectId: string) =>
  isMockMode()
    ? later(() => mock.report(projectId))
    : request<DecisionRiskReport>('GET', `/projects/${id(projectId)}/risks`).then(readReport)

/** 지금 기준. 바꾼 적이 없으면 기본값이다 — 404 를 내지 않는다 */
export const fetchRiskSettings = (projectId: string) =>
  isMockMode()
    ? later(() => mock.settings(projectId))
    : request<RiskSettings>('GET', `/projects/${id(projectId)}/risk-settings`)

/** 일곱 값을 통째로. 범위 밖 · highScore <= mediumScore 는 422 VALIDATION_ERROR (detail 에 필드 이름) */
export const putRiskSettings = (projectId: string, settings: RiskSettings) =>
  isMockMode()
    ? later(() => mock.put(projectId, settings))
    : request<RiskSettings>(
        'PUT',
        `/projects/${id(projectId)}/risk-settings`,
        pickRiskSettings(settings),
      )

async function* mockSummaryEvents(
  projectId: string,
  input: Partial<RiskSummaryInput>,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const { text, refs, draft } = await later(() => mock.summary(projectId, input))
  for await (const event of mockDeltas(text, signal, refs)) {
    /* 끝까지 흘렸을 때만 임시 분석을 남긴다 — 멈추면 sleep 이 AbortError 로 끝내 여기까지 안 온다 */
    if (event.type === 'done' && draft) yield { ...event, analysisId: mockCreateRiskDraft(draft) }
    else yield event
  }
}

/**
 * 보이는 줄(안건 · 작업 · 테스트)의 AI 리스크 분석. 챗봇과 같은 SSE(delta · done · error)다 — 멈추면 AbortError(DOMException)로 끝난다.
 * 사람이 누를 때만 부른다. 끝까지 받으면 서버가 임시로 남기고 done 에 analysisId 를 싣는다 — [저장] 전에는 어디에도 안 보인다
 */
export async function* streamRiskSummary(
  projectId: string,
  input: RiskSummaryInput,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  /* 셋 다 늘 싣는다 — 빠진 배열은 [] (서버도 그렇게 본다) */
  const body: RiskSummaryInput = {
    agendaIds: [...input.agendaIds],
    taskIds: [...(input.taskIds ?? [])],
    testIds: [...(input.testIds ?? [])],
  }
  if (isMockMode()) yield* settle(mockSummaryEvents(projectId, body, signal))
  else yield* settle(postSse(`/projects/${id(projectId)}/risks/summary`, body, signal))
}

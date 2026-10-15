import { mockDeltas, postSse, settle } from '@/api/chat'
import { id, mockError, request } from '@/api/client'
import { later, memberOf, mockDb, requireManager, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { mockRiskSummary, RISK_AS_OF, riskReports } from '@/fixtures'
import { DEFAULT_RISK_SETTINGS, riskSettingsProblems } from '@/lib/risk'
import type {
  ChatEvent,
  ChatRef,
  DecisionRiskReport,
  RiskLevel,
  RiskSettings,
  RiskSummaryInput,
} from '@/types/domain'

/** AI 요약에 실을 수 있는 id 수 — 배열마다 (docs/api/risk.md 'AI 요약') */
export const MAX_RISK_SUMMARY_IDS = 100

/* 결정 병목 리스크 (docs/api/risk.md). 읽기는 프로젝트 멤버 누구나, 기준 바꾸기는 프로젝트 관리자 · 시스템 관리자.
   목업 갈래는 계산하지 않는다 — 굳혀 둔 보고서에 지금 기준(settings)과 그 기준의 등급만 맞춰 낸다 */

const settingsOf = (projectId: string): RiskSettings =>
  structuredClone(mockDb().riskSettings[projectId] ?? DEFAULT_RISK_SETTINGS)

const levelOf = (score: number, s: RiskSettings): RiskLevel =>
  score >= s.highScore ? 'high' : score >= s.mediumScore ? 'medium' : 'low'

const mock = {
  report(projectId: string): DecisionRiskReport {
    requireProject(requireMe(), projectId)
    const settings = settingsOf(projectId)
    const fixed = riskReports[projectId]
    if (!fixed) return { asOf: RISK_AS_OF, settings, threads: [], tasks: [], owners: [] }
    const report = structuredClone(fixed)
    return {
      ...report,
      settings,
      threads: report.threads.map((t) => ({ ...t, level: levelOf(t.score, settings) })),
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
    const saved: RiskSettings = {
      dueSoonDays: input.dueSoonDays,
      deferCount: input.deferCount,
      staleDays: input.staleDays,
      highScore: input.highScore,
      mediumScore: input.mediumScore,
    }
    mockDb().riskSettings[projectId] = saved
    return structuredClone(saved)
  },
  /** 서버처럼 다시 계산한 보고서를 보낸 id 로 거르고(모르는 id 는 버린다) 정해 둔 문구를 만든다 */
  summary(projectId: string, input: RiskSummaryInput): { text: string; refs: ChatRef[] } {
    if (
      !Array.isArray(input.threadIds) ||
      !Array.isArray(input.taskIds) ||
      input.threadIds.length > MAX_RISK_SUMMARY_IDS ||
      input.taskIds.length > MAX_RISK_SUMMARY_IDS
    )
      throw mockError(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.')
    const report = mock.report(projectId)
    const threads = report.threads.filter((t) => input.threadIds.includes(t.threadId))
    const tasks = report.tasks.filter((t) => input.taskIds.includes(t.taskId))
    const text = mockRiskSummary(
      { ...report, threads, tasks },
      (memberId) => (memberId && memberOf(memberId)?.name) || '담당자 없음',
    )
    const refs: ChatRef[] = []
    for (const m of text.matchAll(/\[\[(thread|task):([^\]\s]+)\]\]/g)) {
      const kind = m[1] as ChatRef['kind']
      if (!refs.some((r) => r.kind === kind && r.id === m[2])) refs.push({ kind, id: m[2] })
    }
    return { text, refs }
  },
}

/** 그 프로젝트의 지금 기준으로 계산한 보고서. 멤버가 아니면 403 · 없는 프로젝트는 404 */
export const fetchRisks = (projectId: string) =>
  isMockMode()
    ? later(() => mock.report(projectId))
    : request<DecisionRiskReport>('GET', `/projects/${id(projectId)}/risks`)

/** 지금 기준. 바꾼 적이 없으면 기본값이다 — 404 를 내지 않는다 */
export const fetchRiskSettings = (projectId: string) =>
  isMockMode()
    ? later(() => mock.settings(projectId))
    : request<RiskSettings>('GET', `/projects/${id(projectId)}/risk-settings`)

/** 다섯 값을 통째로. 범위 밖 · highScore <= mediumScore 는 422 VALIDATION_ERROR (detail 에 필드 이름) */
export const putRiskSettings = (projectId: string, settings: RiskSettings) =>
  isMockMode()
    ? later(() => mock.put(projectId, settings))
    : request<RiskSettings>('PUT', `/projects/${id(projectId)}/risk-settings`, settings)

async function* mockSummaryEvents(
  projectId: string,
  input: RiskSummaryInput,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const { text, refs } = await later(() => mock.summary(projectId, input))
  yield* mockDeltas(text, signal, refs)
}

/**
 * 보이는 줄의 AI 요약. 챗봇과 같은 SSE(delta · done · error)다 — 멈추면 AbortError(DOMException)로 끝난다.
 * 사람이 [AI 요약] 을 누를 때만 부른다. 서버는 남기지 않는다
 */
export async function* streamRiskSummary(
  projectId: string,
  input: RiskSummaryInput,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const body: RiskSummaryInput = { threadIds: [...input.threadIds], taskIds: [...input.taskIds] }
  if (isMockMode()) yield* settle(mockSummaryEvents(projectId, body, signal))
  else yield* settle(postSse(`/projects/${id(projectId)}/risks/summary`, body, signal))
}

import { id, mockError, request } from '@/api/client'
import { later, mockDb, requireManager, requireMe, requireProject } from '@/api/mockAuth'
import { isMockMode } from '@/api/mode'
import { RISK_AS_OF, riskReports } from '@/fixtures'
import { DEFAULT_RISK_SETTINGS, riskSettingsProblems } from '@/lib/risk'
import type { DecisionRiskReport, RiskLevel, RiskSettings } from '@/types/domain'

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

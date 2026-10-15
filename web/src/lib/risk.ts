import type { RiskSettings, TaskRiskSignal, ThreadRiskSignal } from '@/types/domain'

/* 결정 병목 리스크의 화면 말과 기준 검사 (docs/api/risk.md). 계산은 서버 몫이라 여기 없다 */

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  dueSoonDays: 3,
  deferCount: 2,
  staleDays: 7,
  highScore: 6,
  mediumScore: 3,
}

export type RiskSettingKey = keyof RiskSettings

/** 대화 상자의 칸 순서 · 이름 · 범위. 범위는 서버 검사와 같다 */
export const RISK_SETTING_FIELDS: {
  key: RiskSettingKey
  label: string
  unit: string
  min: number
  max: number
}[] = [
  { key: 'dueSoonDays', label: '기한 임박', unit: '일', min: 1, max: 30 },
  { key: 'deferCount', label: '여러 번 미룸', unit: '번', min: 1, max: 10 },
  { key: 'staleDays', label: '오래 멈춤', unit: '일', min: 1, max: 90 },
  { key: 'highScore', label: 'high 점수', unit: '점', min: 2, max: 30 },
  { key: 'mediumScore', label: 'medium 점수', unit: '점', min: 1, max: 29 },
]

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

/** 화면 위의 기준 한 줄 */
export const riskSettingsLine = (s: RiskSettings) =>
  `기한 임박 ${s.dueSoonDays}일 · 미룸 ${s.deferCount}번 · 멈춤 ${s.staleDays}일 · high ${s.highScore}점 · medium ${s.mediumScore}점`

export const THREAD_SIGNAL_LABEL: Record<ThreadRiskSignal, string> = {
  overdue: '기한 지남',
  dueSoon: '기한 임박',
  deferredRepeatedly: '여러 번 미룸',
  stale: '오래 멈춤',
  blocking: '작업을 막는 중',
  decisionAfterTaskDue: '작업 기한이 먼저',
  noOwner: '담당자 없음',
  noDueDate: '기한 없음',
}

export const TASK_SIGNAL_LABEL: Record<TaskRiskSignal, string> = {
  decidedButBlocked: '풀어도 됨',
  blockedWithoutThread: '막힌 이유 없음',
  dueBeforeDecision: '결정이 기한보다 늦음',
}

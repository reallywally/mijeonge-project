import { AGENDA_SIGNAL_LABEL } from '@/lib/risk'
import type { DecisionRiskReport } from '@/types/domain'

/*
 * 결정 병목 리스크 보고서 — 서버가 계산해 줄 값을 굳혀 둔 것이다(계산은 서버 몫, docs/api/risk.md).
 * agendas.ts · tasks.ts 의 안건 · 작업 id 를 써서 줄을 누르면 상세가 열린다. 숫자는 서버 시드 보고서
 * (server/tests/test_risk.py 의 test_seed_report_as_of_2026_10_15)와 같다. 기준을 바꾸면 목업 갈래가 settings 와 level 만 맞춘다.
 */

export type MockRiskReport = Omit<DecisionRiskReport, 'settings'>

const p1: MockRiskReport = {
  asOf: '2026-10-15',
  agendas: [
    {
      agendaId: 't5',
      title: '보험료 산출 기간계 API 호출 in · out 정의',
      state: 'open',
      ownerId: 'u4',
      partId: 'pt3',
      dueDate: '2026-10-19',
      overdueDays: 0,
      /* 마지막으로 손댄 날 — 이행이 채운 '결정내용' 이력 줄(9월 10일) */
      idleDays: 35,
      blockedTaskIds: ['k18'],
      waitingTaskIds: [],
      impactTaskCount: 1,
      nearestTaskDue: null,
      signals: ['stale', 'blocking'],
      score: 5,
      level: 'medium',
    },
    {
      agendaId: 't3',
      title: '사내망에서 외부 모델 호출 허용 범위',
      state: 'open',
      ownerId: 'u1',
      partId: 'pt2',
      dueDate: '2026-09-30',
      overdueDays: 15,
      idleDays: 36,
      blockedTaskIds: [],
      waitingTaskIds: [],
      impactTaskCount: 0,
      nearestTaskDue: null,
      signals: ['overdue', 'stale'],
      score: 4,
      level: 'medium',
    },
    {
      agendaId: 't8',
      title: 'AI 심사 학습 데이터 범위',
      state: 'queued',
      ownerId: 'u1',
      partId: 'pt2',
      dueDate: null,
      overdueDays: 0,
      idleDays: 33,
      blockedTaskIds: [],
      waitingTaskIds: ['k13'],
      impactTaskCount: 0,
      nearestTaskDue: '2026-09-30',
      signals: ['stale', 'decisionAfterTaskDue', 'noDueDate'],
      score: 4,
      level: 'medium',
    },
    {
      agendaId: 't9',
      title: '공통 코드 체계 확정',
      state: 'queued',
      ownerId: 'u2',
      partId: null,
      dueDate: null,
      overdueDays: 0,
      idleDays: 30,
      blockedTaskIds: [],
      waitingTaskIds: ['k3'],
      impactTaskCount: 0,
      nearestTaskDue: '2026-09-22',
      signals: ['stale', 'decisionAfterTaskDue', 'noDueDate'],
      score: 4,
      level: 'medium',
    },
    {
      agendaId: 't4',
      title: '개발 서버 백업 주기',
      state: 'queued',
      ownerId: null,
      partId: 'pt1',
      dueDate: null,
      overdueDays: 0,
      idleDays: 35,
      blockedTaskIds: [],
      waitingTaskIds: [],
      impactTaskCount: 0,
      nearestTaskDue: null,
      signals: ['stale', 'noOwner'],
      score: 2,
      level: 'low',
    },
    {
      agendaId: 't7',
      title: '가상비서 tool 만드는 순서',
      state: 'queued',
      ownerId: 'u4',
      partId: 'pt2',
      dueDate: null,
      overdueDays: 0,
      idleDays: 33,
      blockedTaskIds: [],
      waitingTaskIds: [],
      impactTaskCount: 0,
      nearestTaskDue: null,
      signals: ['stale'],
      score: 1,
      level: 'low',
    },
  ],
  owners: [
    { memberId: 'u4', openAgendas: 2, overdueAgendas: 0, blockedTasks: 1, blockingImpact: 1 },
    { memberId: 'u1', openAgendas: 2, overdueAgendas: 1, blockedTasks: 0, blockingImpact: 0 },
    { memberId: 'u2', openAgendas: 1, overdueAgendas: 0, blockedTasks: 0, blockingImpact: 0 },
    { memberId: 'u3', openAgendas: 0, overdueAgendas: 0, blockedTasks: 1, blockingImpact: 0 },
    { memberId: null, openAgendas: 1, overdueAgendas: 0, blockedTasks: 0, blockingImpact: 0 },
  ],
}

const p2: MockRiskReport = {
  asOf: '2026-10-15',
  agendas: [
    {
      agendaId: 't10',
      title: '이관 범위 확정',
      state: 'queued',
      ownerId: 'u2',
      partId: null,
      dueDate: null,
      overdueDays: 0,
      idleDays: 29,
      blockedTaskIds: [],
      waitingTaskIds: [],
      impactTaskCount: 0,
      nearestTaskDue: null,
      signals: ['stale'],
      score: 1,
      level: 'low',
    },
  ],
  owners: [
    { memberId: 'u2', openAgendas: 1, overdueAgendas: 0, blockedTasks: 0, blockingImpact: 0 },
  ],
}

/** 프로젝트별 보고서. 여기 없는 프로젝트는 리스크가 하나도 없다 */
export const riskReports: Record<string, MockRiskReport> = { p1, p2 }

export const RISK_AS_OF = '2026-10-15'

/** 거른 뒤 비면 서버가 Claude 를 부르지 않고 내는 한 줄 (docs/api/risk.md 'AI 요약') */
export const RISK_SUMMARY_EMPTY = '지금 짚을 리스크가 없습니다.'

/**
 * 목업 AI 요약 — 계약의 '답의 모양' 칸 순서를 지킨 고정 문구. 받은 보고서(보이는 줄로 거른 것)의 숫자 · 신호만 옮긴다.
 * 근거는 그 보고서의 안건 id 와 그 안건이 막는 작업 id 로 단다 — 화면이 칩으로 바꾼다
 */
export function mockRiskSummary(
  report: Omit<DecisionRiskReport, 'owners'>,
  nameOf: (memberId: string | null) => string,
): string {
  const { agendas, settings } = report
  const top = agendas[0]
  if (!top) return RISK_SUMMARY_EMPTY

  const out: string[] = [
    `한 줄 총평 — 지금 가장 큰 병목은 [[agenda:${top.agendaId}]] 입니다(${top.score}점 · ${top.level}).`,
    '',
    '먼저 정할 것',
  ]
  agendas.slice(0, 3).forEach((t, i) => {
    const why = t.signals.map((s) => AGENDA_SIGNAL_LABEL[s]).join(' · ')
    const waiting = [...t.blockedTaskIds, ...t.waitingTaskIds]
    const blocks =
      waiting.length > 0
        ? `작업 ${waiting.length}건(${waiting.map((id) => `[[task:${id}]]`).join(' ')})이 기다립니다`
        : '막힌 작업은 아직 없습니다'
    const next = '다음 회의에 올려 결정내용을 적는다'
    out.push(
      `${i + 1}. [[agenda:${t.agendaId}]] — ${why} · ${blocks} · ${next} · ${nameOf(t.ownerId)}`,
    )
  })

  const stale = agendas.filter((t) => t.signals.includes('stale')).length
  if (agendas.length > 1 && stale * 2 > agendas.length) {
    out.push(
      '',
      '눈에 띄는 점',
      `- 안건 ${agendas.length}건 중 ${stale}건이 '오래 멈춤' 입니다 — 기준(멈춤 ${settings.staleDays}일)이 회의 주기보다 짧을 수 있습니다.`,
    )
  }
  return out.join('\n')
}

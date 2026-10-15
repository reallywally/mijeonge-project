import { THREAD_SIGNAL_LABEL } from '@/lib/risk'
import type { DecisionRiskReport } from '@/types/domain'

/*
 * 결정 병목 리스크 보고서 — 서버가 계산해 줄 값을 굳혀 둔 것이다(계산은 서버 몫, docs/api/risk.md).
 * threads.ts · tasks.ts 의 안건 · 작업 id 를 써서 줄을 누르면 상세가 열린다. 숫자는 서버 시드 보고서
 * (server/tests/test_risk.py 의 test_seed_report_as_of_2026_10_15)와 같다. 기준을 바꾸면 목업 갈래가 settings 와 level 만 맞춘다.
 */

export type MockRiskReport = Omit<DecisionRiskReport, 'settings'>

const p1: MockRiskReport = {
  asOf: '2026-10-15',
  threads: [
    {
      threadId: 't5',
      title: '보험료 산출 기간계 API 호출 in · out 정의',
      state: 'open',
      ownerId: 'u4',
      partId: 'pt3',
      dueDate: '2026-10-19',
      overdueDays: 0,
      deferCount: 2,
      lastDeferNote: '두 번째 미룸이다. 다음에는 기간계 담당자를 회의에 부르기로 했다.',
      idleDays: 31,
      blockedTaskIds: ['k18'],
      waitingTaskIds: [],
      impactTaskCount: 1,
      nearestTaskDue: null,
      signals: ['deferredRepeatedly', 'stale', 'blocking'],
      score: 7,
      level: 'high',
    },
    {
      threadId: 't3',
      title: '사내망에서 외부 모델 호출 허용 범위',
      state: 'open',
      ownerId: 'u1',
      partId: 'pt2',
      dueDate: '2026-09-30',
      overdueDays: 15,
      deferCount: 1,
      lastDeferNote: '정보보안팀 확인이 먼저다. 다음 회의 후보로 올려 둔다.',
      idleDays: 35,
      blockedTaskIds: [],
      waitingTaskIds: [],
      impactTaskCount: 0,
      nearestTaskDue: null,
      signals: ['overdue', 'stale'],
      score: 4,
      level: 'medium',
    },
    {
      threadId: 't8',
      title: 'AI 심사 학습 데이터 범위',
      state: 'queued',
      ownerId: 'u1',
      partId: 'pt2',
      dueDate: null,
      overdueDays: 0,
      deferCount: 0,
      lastDeferNote: '',
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
      threadId: 't9',
      title: '공통 코드 체계 확정',
      state: 'queued',
      ownerId: 'u2',
      partId: null,
      dueDate: null,
      overdueDays: 0,
      deferCount: 0,
      lastDeferNote: '',
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
      threadId: 't4',
      title: '개발 서버 백업 주기',
      state: 'queued',
      ownerId: null,
      partId: 'pt1',
      dueDate: null,
      overdueDays: 0,
      deferCount: 0,
      lastDeferNote: '',
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
      threadId: 't7',
      title: '가상비서 tool 만드는 순서',
      state: 'queued',
      ownerId: 'u4',
      partId: 'pt2',
      dueDate: null,
      overdueDays: 0,
      deferCount: 0,
      lastDeferNote: '',
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
  tasks: [
    {
      taskId: 'k22',
      key: 'HW-22',
      title: '스테이징 DB 구성',
      status: 'blocked',
      ownerId: 'u3',
      partId: 'pt1',
      due: '2026-10-20',
      threadIds: ['t2'],
      signal: 'decidedButBlocked',
    },
    {
      taskId: 'k3',
      key: 'HW-3',
      title: '프로그램 설계',
      status: 'doing',
      ownerId: 'u2',
      partId: null,
      due: '2026-09-22',
      threadIds: ['t9'],
      signal: 'dueBeforeDecision',
    },
    {
      taskId: 'k13',
      key: 'HW-13',
      title: '모델링',
      status: 'todo',
      ownerId: 'u1',
      partId: 'pt2',
      due: '2026-09-30',
      threadIds: ['t8'],
      signal: 'dueBeforeDecision',
    },
  ],
  owners: [
    { memberId: 'u4', openThreads: 2, overdueThreads: 0, blockedTasks: 1, blockingImpact: 1 },
    { memberId: 'u1', openThreads: 2, overdueThreads: 1, blockedTasks: 0, blockingImpact: 0 },
    { memberId: 'u2', openThreads: 1, overdueThreads: 0, blockedTasks: 0, blockingImpact: 0 },
    { memberId: 'u3', openThreads: 0, overdueThreads: 0, blockedTasks: 1, blockingImpact: 0 },
    { memberId: null, openThreads: 1, overdueThreads: 0, blockedTasks: 0, blockingImpact: 0 },
  ],
}

const p2: MockRiskReport = {
  asOf: '2026-10-15',
  threads: [
    {
      threadId: 't10',
      title: '이관 범위 확정',
      state: 'queued',
      ownerId: 'u2',
      partId: null,
      dueDate: null,
      overdueDays: 0,
      deferCount: 0,
      lastDeferNote: '',
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
  tasks: [],
  owners: [
    { memberId: 'u2', openThreads: 1, overdueThreads: 0, blockedTasks: 0, blockingImpact: 0 },
  ],
}

/** 프로젝트별 보고서. 여기 없는 프로젝트는 리스크가 하나도 없다 */
export const riskReports: Record<string, MockRiskReport> = { p1, p2 }

export const RISK_AS_OF = '2026-10-15'

/** 거른 뒤 둘 다 비면 서버가 Claude 를 부르지 않고 내는 한 줄 (docs/api/risk.md 'AI 요약') */
export const RISK_SUMMARY_EMPTY = '지금 짚을 리스크가 없습니다.'

/**
 * 목업 AI 요약 — 계약의 '답의 모양' 칸 순서를 지킨 고정 문구. 받은 보고서(보이는 줄로 거른 것)의 숫자 · 신호만 옮긴다.
 * 근거는 그 보고서의 안건 · 작업 id 로 단다 — 화면이 칩으로 바꾼다
 */
export function mockRiskSummary(
  report: Omit<DecisionRiskReport, 'owners'>,
  nameOf: (memberId: string | null) => string,
): string {
  const { threads, tasks, settings } = report
  if (threads.length === 0 && tasks.length === 0) return RISK_SUMMARY_EMPTY

  const out: string[] = []
  const top = threads[0]
  out.push(
    top
      ? `한 줄 총평 — 지금 가장 큰 병목은 [[thread:${top.threadId}]] 입니다(${top.score}점 · ${top.level}).`
      : `한 줄 총평 — 안 정해진 안건 리스크는 없고, 안건과 어긋난 작업 ${tasks.length}건이 있습니다.`,
  )

  if (threads.length > 0) {
    out.push('', '먼저 정할 것')
    threads.slice(0, 3).forEach((t, i) => {
      const why = t.signals.map((s) => THREAD_SIGNAL_LABEL[s]).join(' · ')
      const waiting = [...t.blockedTaskIds, ...t.waitingTaskIds]
      const blocks =
        waiting.length > 0
          ? `작업 ${waiting.length}건(${waiting.map((id) => `[[task:${id}]]`).join(' ')})이 기다립니다`
          : '막힌 작업은 아직 없습니다'
      const next = t.lastDeferNote
        ? `마지막 미룸 사유 "${t.lastDeferNote}" 를 풀어 다음 회의에 올린다`
        : '후보를 좁혀 다음 회의에 올린다'
      out.push(
        `${i + 1}. [[thread:${t.threadId}]] — ${why} · ${blocks} · ${next} · ${nameOf(t.ownerId)}`,
      )
    })
  }

  const loose = tasks.filter((t) => t.signal !== 'dueBeforeDecision')
  if (loose.length > 0) {
    out.push('', '바로 풀 수 있는 것')
    for (const t of loose)
      out.push(
        t.signal === 'decidedButBlocked'
          ? `- [[task:${t.taskId}]] — 근거 안건이 정해졌으니 막힘을 풀고 진행 중으로 돌린다 · ${nameOf(t.ownerId)}`
          : `- [[task:${t.taskId}]] — 막힌 이유를 안건으로 올리거나 상태를 되돌린다 · ${nameOf(t.ownerId)}`,
      )
  }

  const stale = threads.filter((t) => t.signals.includes('stale')).length
  if (threads.length > 1 && stale * 2 > threads.length) {
    out.push(
      '',
      '눈에 띄는 점',
      `- 안건 ${threads.length}건 중 ${stale}건이 '오래 멈춤' 입니다 — 기준(멈춤 ${settings.staleDays}일)이 회의 주기보다 짧을 수 있습니다.`,
    )
  }
  return out.join('\n')
}

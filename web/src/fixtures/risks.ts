import { agendaRow, CHURN_SIGNALS, mixRiskRows, signalLabel, taskRow, testRow } from '@/lib/risk'
import type {
  DecisionRiskReport,
  OwnerLoad,
  RiskLevel,
  TaskRisk,
  TestRisk,
  TestStatus,
} from '@/types/domain'

/*
 * 리스크 보고서 — 서버가 계산해 줄 값을 굳혀 둔 것이다(계산은 서버 몫, docs/api/risk.md · risk-dashboard.md).
 * agendas.ts · tasks.ts · tests.ts 의 id 를 써서 줄을 누르면 상세가 열린다. 안건 숫자는 서버 시드 보고서
 * (server/tests/test_risk.py 의 test_seed_report_as_of_2026_10_15)와 같다. 작업 · 테스트 줄은 오늘 2026-10-15 · 기본 기준으로
 * 계약 규칙대로 센 값이고 서버 시드 표(risk-dashboard.md '시드 p1')와 같다 — 흔들림 신호는 history.ts 의 시연 줄(k21 · k3 · k22 · tc3 · tc2)이 근거다.
 * 기준을 바꾸면 목업 갈래가 settings 와 level 만 맞춘다.
 */

export type MockRiskReport = Omit<DecisionRiskReport, 'settings'>

/** 기본 기준(high 6 · medium 3)의 등급 — 목업 갈래가 지금 기준으로 다시 단다 */
const levelOf = (score: number): RiskLevel => (score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low')

const owner = (
  memberId: string | null,
  openAgendas: number,
  overdueAgendas: number,
  blockedTasks: number,
  blockingImpact: number,
  riskyTasks: number,
  riskyTests: number,
): OwnerLoad => ({
  memberId,
  openAgendas,
  overdueAgendas,
  blockedTasks,
  blockingImpact,
  riskyTasks,
  riskyTests,
})

type TaskNumbers = Pick<
  TaskRisk,
  'overdueDays' | 'statusDays' | 'plannedDays' | 'signals' | 'score'
> &
  Partial<TaskRisk>

function task(
  taskId: string,
  key: string,
  title: string,
  status: TaskRisk['status'],
  ownerId: string | null,
  partId: string | null,
  start: string | null,
  due: string | null,
  n: TaskNumbers,
): TaskRisk {
  return {
    taskId,
    key,
    title,
    status,
    ownerId,
    partId,
    start,
    due,
    slipCount: 0,
    dueFlow: [],
    contentChanges: 0,
    ownerChanges: 0,
    openAgendaIds: [],
    ...n,
    level: levelOf(n.score),
  }
}

/* 작업 — 서버 시드 표(risk-dashboard.md '시드 p1') 그대로, 그 순서. 기한 넘김(3) · 오래 막힘(3) · 오래 걸림(2) · 기한 거듭 미룸(2) · 시작 안 함(1) · 내용 자주 바뀜(1) · 담당자 자주 바뀜(1),
   기한을 4일 넘게 넘기면 +1. 오래 걸림은 진행 중이 계획(due − start + 1)의 1.5배를 넘긴 것 */
const P1_TASKS: TaskRisk[] = [
  task('k3', 'HW-3', '프로그램 설계', 'doing', 'u2', null, '2026-09-15', '2026-09-22', {
    overdueDays: 23,
    statusDays: 30,
    plannedDays: 8,
    ownerChanges: 2,
    openAgendaIds: ['t9'],
    signals: ['overdue', 'longRunning', 'ownerChurn'],
    score: 7,
  }),
  task(
    'k20',
    'HW-20',
    'DB 설치와 초기 스키마 반영',
    'doing',
    'u3',
    'pt1',
    '2026-09-10',
    '2026-09-12',
    {
      overdueDays: 33,
      statusDays: 7,
      plannedDays: 3,
      signals: ['overdue', 'longRunning'],
      score: 6,
    },
  ),
  task('k4', 'HW-4', '개발 환경 설정', 'doing', 'u3', 'pt1', '2026-09-08', '2026-09-15', {
    overdueDays: 30,
    statusDays: 37,
    plannedDays: 8,
    signals: ['overdue', 'longRunning'],
    score: 6,
  }),
  task('k21', 'HW-21', '개발자 계정 배포', 'todo', 'u1', 'pt1', '2026-09-12', '2026-09-15', {
    overdueDays: 30,
    statusDays: 33,
    plannedDays: 4,
    slipCount: 2,
    dueFlow: ['2026-09-13', '2026-09-14', '2026-09-15'],
    signals: ['overdue', 'dueSlipped'],
    score: 6,
  }),
  task('k9', 'HW-9', 'tool02', 'doing', 'u4', 'pt2', '2026-09-19', '2026-09-21', {
    overdueDays: 24,
    statusDays: 26,
    plannedDays: 3,
    signals: ['overdue', 'longRunning'],
    score: 6,
  }),
  task('k1', 'HW-1', '설계', 'doing', null, null, '2026-09-07', '2026-09-22', {
    overdueDays: 23,
    statusDays: 38,
    plannedDays: 16,
    signals: ['overdue', 'longRunning'],
    score: 6,
  }),
  task('k7', 'HW-7', '가상비서', 'doing', 'u4', 'pt2', '2026-09-16', '2026-09-25', {
    overdueDays: 20,
    statusDays: 29,
    plannedDays: 10,
    signals: ['overdue', 'longRunning'],
    score: 6,
  }),
  task('k10', 'HW-10', 'tool03', 'todo', null, 'pt2', '2026-09-22', '2026-09-23', {
    overdueDays: 22,
    statusDays: 23,
    plannedDays: 2,
    signals: ['overdue'],
    score: 4,
  }),
  task('k11', 'HW-11', 'tool04', 'todo', null, 'pt2', '2026-09-24', '2026-09-25', {
    overdueDays: 20,
    statusDays: 21,
    plannedDays: 2,
    signals: ['overdue'],
    score: 4,
  }),
  task('k15', 'HW-15', '기존 상품 분석', 'todo', 'u2', 'pt2', '2026-09-26', '2026-09-29', {
    overdueDays: 16,
    statusDays: 19,
    plannedDays: 4,
    signals: ['overdue'],
    score: 4,
  }),
  task('k12', 'HW-12', 'AI 심사', 'todo', null, 'pt2', '2026-09-23', '2026-09-30', {
    overdueDays: 15,
    statusDays: 22,
    plannedDays: 8,
    signals: ['overdue'],
    score: 4,
  }),
  task('k13', 'HW-13', '모델링', 'todo', 'u1', 'pt2', '2026-09-23', '2026-09-30', {
    overdueDays: 15,
    statusDays: 22,
    plannedDays: 8,
    openAgendaIds: ['t8'],
    signals: ['overdue'],
    score: 4,
  }),
  task('k5', 'HW-5', '개발', 'todo', null, null, '2026-09-16', '2026-10-04', {
    overdueDays: 11,
    statusDays: 29,
    plannedDays: 19,
    signals: ['overdue'],
    score: 4,
  }),
  task('k6', 'HW-6', 'AI Biz', 'todo', null, 'pt2', '2026-09-16', '2026-10-04', {
    overdueDays: 11,
    statusDays: 29,
    plannedDays: 19,
    signals: ['overdue'],
    score: 4,
  }),
  task('k14', 'HW-14', '상품 추천', 'todo', null, 'pt2', '2026-09-26', '2026-10-04', {
    overdueDays: 11,
    statusDays: 19,
    plannedDays: 9,
    signals: ['overdue'],
    score: 4,
  }),
  task('k17', 'HW-17', '챗봇', 'todo', null, null, '2026-09-28', '2026-10-04', {
    overdueDays: 11,
    statusDays: 17,
    plannedDays: 7,
    signals: ['overdue'],
    score: 4,
  }),
  task('k16', 'HW-16', '모델링', 'todo', null, 'pt2', '2026-09-30', '2026-10-04', {
    overdueDays: 11,
    statusDays: 15,
    plannedDays: 5,
    signals: ['overdue'],
    score: 4,
  }),
  task('k18', 'HW-18', '보험료 산출 기간계 API 개발', 'blocked', 'u4', 'pt3', null, null, {
    overdueDays: 0,
    statusDays: 41,
    plannedDays: null,
    openAgendaIds: ['t5'],
    signals: ['longBlocked'],
    score: 3,
  }),
  task('k22', 'HW-22', '스테이징 DB 구성', 'blocked', 'u3', 'pt1', '2026-10-13', '2026-10-20', {
    overdueDays: 0,
    statusDays: 2,
    plannedDays: 8,
    contentChanges: 5,
    signals: ['contentChurn'],
    score: 1,
  }),
]

type TestNumbers = Pick<TestRisk, 'overdueDays' | 'statusDays' | 'signals' | 'score'> &
  Partial<TestRisk>

function test(
  no: number,
  title: string,
  status: TestStatus,
  ownerId: string,
  partId: string | null,
  due: string | null,
  n: TestNumbers,
): TestRisk {
  return {
    testId: `tc${no}`,
    key: `HW-T${no}`,
    title,
    status,
    ownerId,
    partId,
    due,
    slipCount: 0,
    flips: 0,
    refs: [],
    ...n,
    level: levelOf(n.score),
  }
}

/* 테스트 — 서버 시드 표 그대로. 지금 테스트 목록의 신호(test.md) + 결과 뒤집힘 · 기한 거듭 미룸. 묶음(T1 · T5)과 신호 없는 T8 은 없다 */
const P1_TESTS: TestRisk[] = [
  test(3, '비밀번호 5회 틀림 잠금', 'testing', 'u2', null, '2026-10-08', {
    overdueDays: 7,
    statusDays: 12,
    slipCount: 2,
    refs: [{ kind: 'agenda', id: 't3' }],
    signals: ['overdue', 'longRunning', 'dueSlipped'],
    score: 8,
  }),
  test(4, '비밀번호 변경 주기', 'ready', 'u4', null, '2026-10-17', {
    overdueDays: 0,
    statusDays: 14,
    refs: [{ kind: 'agenda', id: 't2' }],
    signals: ['basisChanged', 'notStarted'],
    score: 3,
  }),
  test(6, '개발자 계정 일괄 생성', 'blocked', 'u3', 'pt1', null, {
    overdueDays: 0,
    statusDays: 13,
    refs: [{ kind: 'task', id: 'k21' }],
    signals: ['longBlocked'],
    score: 3,
  }),
  test(7, '권한 없는 계정 접근 차단', 'fail', 'u1', 'pt1', '2026-10-20', {
    overdueDays: 0,
    statusDays: 10,
    signals: ['failedIdle'],
    score: 3,
  }),
  /* 성공한 테스트는 결과 뒤집힘만 본다 — 기간이 지났어도 overdueDays 0 */
  test(2, '올바른 계정으로 로그인', 'pass', 'u2', null, '2026-10-10', {
    overdueDays: 0,
    statusDays: 5,
    flips: 2,
    refs: [{ kind: 'task', id: 'k4' }],
    signals: ['flaky'],
    score: 2,
  }),
]

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
  tasks: P1_TASKS,
  tests: P1_TESTS,
  /* 정렬 — blockingImpact ↓ → overdueAgendas ↓ → riskyTasks + riskyTests ↓ (같으면 앞 순서 그대로) */
  owners: [
    owner('u4', 2, 0, 1, 1, 3, 1),
    owner('u1', 2, 1, 0, 0, 2, 1),
    owner(null, 1, 0, 0, 0, 9, 0),
    owner('u2', 1, 0, 0, 0, 2, 1),
    owner('u3', 0, 0, 1, 0, 2, 1),
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
  tasks: [
    task('x1', 'PAS-1', '현행 분석', 'doing', 'u2', null, '2026-09-14', '2026-09-30', {
      overdueDays: 15,
      statusDays: 31,
      plannedDays: 17,
      signals: ['overdue', 'longRunning'],
      score: 6,
    }),
    task('x2', 'PAS-2', '이관 대상 목록 만들기', 'todo', 'u2', null, '2026-09-21', '2026-09-30', {
      overdueDays: 15,
      statusDays: 24,
      plannedDays: 10,
      signals: ['overdue'],
      score: 4,
    }),
  ],
  tests: [],
  owners: [owner('u2', 1, 0, 0, 0, 2, 0)],
}

/** 프로젝트별 보고서. 여기 없는 프로젝트는 리스크가 하나도 없다 */
export const riskReports: Record<string, MockRiskReport> = { p1, p2 }

export const RISK_AS_OF = '2026-10-15'

/** 거른 뒤 비면 서버가 Claude 를 부르지 않고 내는 한 줄 (docs/api/risk.md 'AI 요약') */
export const RISK_SUMMARY_EMPTY = '지금 짚을 리스크가 없습니다.'

/** 목업 AI 리스크 분석의 '다음 할 일' — 종류마다 정해 둔 한 마디 */
const NEXT: Record<'agenda' | 'task' | 'test', string> = {
  agenda: '다음 회의에 올려 결정내용을 적는다',
  task: '기한을 다시 잡거나 나눌지 정한다',
  test: '원인을 조치 내역에 적고 다시 돌린다',
}

/**
 * 목업 AI 리스크 분석 — 계약의 '답의 모양' 칸 순서를 지킨 고정 문구(risk-dashboard.md). 받은 보고서(보이는 줄로 거른 것)의 숫자 · 신호만 옮긴다.
 * 먼저 손쓸 것은 세 종류를 섞어 점수 순 4개, 근거는 그 줄의 id — 화면이 칩으로 바꾼다
 */
export function mockRiskSummary(
  report: Omit<DecisionRiskReport, 'owners'>,
  nameOf: (memberId: string | null) => string,
): string {
  const { agendas, tasks, tests } = report
  const rows = mixRiskRows([
    agendas.map((a) => agendaRow(a, report.asOf)),
    tasks.map((t) => taskRow(t, report.asOf)),
    tests.map(testRow),
  ])
  const top = rows[0]
  if (!top) return RISK_SUMMARY_EMPTY

  const counts = `안건 ${agendas.length} · 작업 ${tasks.length} · 테스트 ${tests.length}건`
  const out: string[] = [
    `한 줄 총평 — ${counts} 중 가장 급한 것은 [[${top.kind}:${top.id}]] 입니다(${top.score}점 · ${top.level}).`,
    '',
    '먼저 손쓸 것',
  ]
  rows.slice(0, 4).forEach((r, i) => {
    const why = r.signals.map((s) => signalLabel(s, r.kind)).join(' · ')
    out.push(
      `${i + 1}. [[${r.kind}:${r.id}]] — ${why}(${r.metric}) · ${NEXT[r.kind]} · ${nameOf(r.ownerId)}`,
    )
  })

  const shaky = rows.filter((r) => r.signals.some((s) => CHURN_SIGNALS.includes(s)))
  if (shaky.length > 0) {
    const names = shaky
      .slice(0, 3)
      .map((r) => `[[${r.kind}:${r.id}]]`)
      .join(' ')
    out.push(
      '',
      '흔들리는 일',
      `- ${names} — 기한 · 내용 · 결과가 거듭 바뀌었습니다. 범위가 아직 덜 정해진 것으로 보임.`,
    )
  }
  return out.join('\n')
}

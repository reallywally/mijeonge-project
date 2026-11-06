import { describe, expect, it } from 'vitest'
import {
  agendaRow,
  DEFAULT_RISK_SETTINGS,
  filterRiskRows,
  mixRiskRows,
  readCompare,
  readFacts,
  riskCards,
  riskSettingsLine,
  riskSettingsProblems,
  signalBars,
  signalLabel,
  taskRow,
  testRow,
  type RiskRow,
} from '@/lib/risk'
import type { AgendaRisk, TaskRisk, TestRisk } from '@/types/domain'

/* 리스크 대시보드의 순수 셈 — 섞기 · 거르기 · 카드 · 막대 · 핵심 숫자 · 기준 일곱 · 옛 compare 읽기 (risk-dashboard.md) */

const AS_OF = '2026-10-15'

const agenda = (over: Partial<AgendaRisk>): AgendaRisk => ({
  agendaId: 't1',
  title: '안건',
  state: 'open',
  ownerId: null,
  partId: null,
  dueDate: null,
  overdueDays: 0,
  idleDays: 0,
  blockedTaskIds: [],
  waitingTaskIds: [],
  impactTaskCount: 0,
  nearestTaskDue: null,
  signals: [],
  score: 0,
  level: 'low',
  ...over,
})

const task = (over: Partial<TaskRisk>): TaskRisk => ({
  taskId: 'k1',
  key: 'HW-1',
  title: '작업',
  status: 'doing',
  ownerId: null,
  partId: null,
  start: null,
  due: null,
  overdueDays: 0,
  statusDays: 0,
  plannedDays: null,
  slipCount: 0,
  dueFlow: [],
  contentChanges: 0,
  ownerChanges: 0,
  openAgendaIds: [],
  signals: [],
  score: 0,
  level: 'low',
  ...over,
})

const test = (over: Partial<TestRisk>): TestRisk => ({
  testId: 'tc1',
  key: 'HW-T1',
  title: '테스트',
  status: 'testing',
  ownerId: null,
  partId: null,
  due: null,
  overdueDays: 0,
  statusDays: 0,
  slipCount: 0,
  flips: 0,
  refs: [],
  signals: [],
  score: 0,
  level: 'low',
  ...over,
})

describe('기준 일곱', () => {
  it('기본값 · 범위 · 대소', () => {
    expect(DEFAULT_RISK_SETTINGS).toEqual({
      dueSoonDays: 3,
      staleDays: 7,
      highScore: 6,
      mediumScore: 3,
      churnDays: 14,
      churnCount: 5,
      slipCount: 2,
    })
    expect(riskSettingsProblems(DEFAULT_RISK_SETTINGS)).toEqual({})
    expect(
      riskSettingsProblems({
        ...DEFAULT_RISK_SETTINGS,
        churnDays: 91,
        churnCount: 1,
        slipCount: 0,
      }),
    ).toEqual({
      churnDays: '1 ~ 90 사이로 넣어 주세요.',
      churnCount: '2 ~ 50 사이로 넣어 주세요.',
      slipCount: '1 ~ 10 사이로 넣어 주세요.',
    })
    expect(
      riskSettingsProblems({ ...DEFAULT_RISK_SETTINGS, churnCount: Number.NaN }).churnCount,
    ).toBe('정수를 넣어 주세요.')
  })

  it('기준 한 줄에 흔들림 셋 — 옛 기준(넷)이면 붙이지 않는다', () => {
    expect(riskSettingsLine(DEFAULT_RISK_SETTINGS)).toBe(
      '기한 임박 3일 · 멈춤 7일 · high 6점 · medium 3점 · 흔들림 14일 안 내용 5번 · 미룸 2번',
    )
    const { churnDays: _a, churnCount: _b, slipCount: _c, ...four } = DEFAULT_RISK_SETTINGS
    void [_a, _b, _c]
    expect(riskSettingsLine(four as never)).toBe('기한 임박 3일 · 멈춤 7일 · high 6점 · medium 3점')
  })
})

describe('줄 만들기 — 핵심 숫자는 가장 큰 신호 하나', () => {
  it('안건', () => {
    expect(
      agendaRow(agenda({ signals: ['overdue', 'stale'], overdueDays: 15 }), AS_OF).metric,
    ).toBe('기한 넘김 15일')
    expect(
      agendaRow(agenda({ signals: ['stale', 'blocking'], blockedTaskIds: ['k18'] }), AS_OF).metric,
    ).toBe('막힌 작업 1건')
    expect(agendaRow(agenda({ signals: ['stale'], idleDays: 33 }), AS_OF).metric).toBe(
      '33일째 멈춤',
    )
    expect(agendaRow(agenda({ signals: ['dueSoon'], dueDate: '2026-10-17' }), AS_OF).metric).toBe(
      'D-2',
    )
  })

  it('작업', () => {
    const row = taskRow(task({ signals: ['overdue', 'longRunning'], overdueDays: 33 }), AS_OF)
    expect(row).toMatchObject({ kind: 'task', id: 'k1', key: 'HW-1', metric: '기한 넘김 33일' })
    expect(taskRow(task({ signals: ['longBlocked'], statusDays: 41 }), AS_OF).metric).toBe(
      '41일째 막힘',
    )
    expect(
      taskRow(task({ signals: ['longRunning'], statusDays: 7, plannedDays: 3 }), AS_OF).metric,
    ).toBe('7일째 · 계획 3일')
    expect(
      taskRow(task({ signals: ['dueSlipped', 'notStarted'], slipCount: 2 }), AS_OF).metric,
    ).toBe('미룸 2번')
    expect(taskRow(task({ signals: ['notStarted'], start: '2026-09-30' }), AS_OF).metric).toBe(
      '시작 15일 늦음',
    )
    expect(taskRow(task({ signals: ['contentChurn'], contentChanges: 5 }), AS_OF).metric).toBe(
      '내용 5번 바뀜',
    )
    expect(taskRow(task({ signals: ['ownerChurn'], ownerChanges: 2 }), AS_OF).metric).toBe(
      '담당 2번 바뀜',
    )
  })

  it('테스트', () => {
    expect(testRow(test({ signals: ['failedIdle', 'dueSlipped'], statusDays: 10 })).metric).toBe(
      '10일째 실패',
    )
    expect(testRow(test({ signals: ['flaky'], flips: 2 })).metric).toBe('뒤집힘 2번')
  })

  it('신호의 화면 말은 종류마다 — 모르는 이름은 그대로', () => {
    expect(signalLabel('overdue', 'agenda')).toBe('기한 지남')
    expect(signalLabel('overdue', 'task')).toBe('기한 넘김')
    expect(signalLabel('overdue', 'test')).toBe('기간 지남')
    expect(signalLabel('flaky', 'test')).toBe('결과 뒤집힘')
    expect(signalLabel('nope', 'task')).toBe('nope')
  })
})

describe('섞기 · 거르기 · 세기', () => {
  const rows: RiskRow[] = mixRiskRows([
    [agendaRow(agenda({ agendaId: 'a1', score: 5, level: 'medium', signals: ['stale'] }), AS_OF)],
    [
      taskRow(
        task({ taskId: 'k1', score: 6, level: 'high', overdueDays: 3, signals: ['overdue'] }),
        AS_OF,
      ),
      taskRow(
        task({ taskId: 'k2', score: 5, level: 'medium', signals: ['dueSlipped', 'notStarted'] }),
        AS_OF,
      ),
    ],
    [
      testRow(
        test({ testId: 'tc1', score: 6, level: 'high', overdueDays: 7, signals: ['overdue'] }),
      ),
      testRow(test({ testId: 'tc2', score: 2, level: 'low', signals: ['flaky'] })),
    ],
  ])

  it('점수 ↓ → 기한 넘긴 날 ↓ → 작업 · 안건 · 테스트', () => {
    expect(rows.map((r) => r.id)).toEqual(['tc1', 'k1', 'k2', 'a1', 'tc2'])
  })

  it('종류 · 등급(여럿) · 신호(하나라도)', () => {
    expect(
      filterRiskRows(rows, { kind: 'task', levels: [], signals: [] }).map((r) => r.id),
    ).toEqual(['k1', 'k2'])
    expect(
      filterRiskRows(rows, { kind: null, levels: ['high', 'low'], signals: [] }).map((r) => r.id),
    ).toEqual(['tc1', 'k1', 'tc2'])
    expect(
      filterRiskRows(rows, { kind: null, levels: [], signals: ['flaky', 'dueSlipped'] }).map(
        (r) => r.id,
      ),
    ).toEqual(['k2', 'tc2'])
  })

  it('카드 — 종류별 등급 수 · 지연', () => {
    expect(riskCards(rows)).toEqual({
      kinds: {
        agenda: { high: 0, medium: 1, low: 0 },
        task: { high: 1, medium: 1, low: 0 },
        test: { high: 1, medium: 0, low: 1 },
      },
      delay: { overdue: 2, longBlocked: 0, longRunning: 0 },
    })
  })

  it('막대 — 같은 이름은 종류를 넘어 하나로 쌓고, 흔들림은 따로', () => {
    const bars = signalBars(rows)
    expect(bars.main.map((b) => [b.signal, b.total, b.byKind])).toEqual([
      ['overdue', 2, { agenda: 0, task: 1, test: 1 }],
      ['notStarted', 1, { agenda: 0, task: 1, test: 0 }],
      ['stale', 1, { agenda: 1, task: 0, test: 0 }],
    ])
    expect(bars.churn.map((b) => [b.signal, b.total])).toEqual([
      ['flaky', 1],
      ['dueSlipped', 1],
    ])
  })
})

describe('저장한 분석 — 옛 compare 모양도 읽는다', () => {
  it('문자열 = 안건 id, agendaId 모양, 새 { kind, id } 모양이 섞여도', () => {
    expect(
      readCompare({
        previousId: 'ra1',
        previousTitle: '앞',
        previousSavedAt: '2026-10-08T01:12:00Z',
        added: ['t8', { kind: 'task', id: 'k20' }],
        removed: [{ agendaId: 't6' }],
        kept: [
          { agendaId: 't3', levelFrom: 'high', levelTo: 'medium' },
          { kind: 'test', id: 'tc3', levelFrom: 'high', levelTo: 'high' },
        ],
      }),
    ).toEqual({
      previousId: 'ra1',
      previousTitle: '앞',
      previousSavedAt: '2026-10-08T01:12:00Z',
      added: [
        { kind: 'agenda', id: 't8' },
        { kind: 'task', id: 'k20' },
      ],
      removed: [{ kind: 'agenda', id: 't6' }],
      kept: [
        { kind: 'agenda', id: 't3', levelFrom: 'high', levelTo: 'medium' },
        { kind: 'test', id: 'tc3', levelFrom: 'high', levelTo: 'high' },
      ],
    })
    expect(readCompare(null)).toBeNull()
  })

  it('facts 에 tasks · tests 가 없으면 []', () => {
    const got = readFacts({
      asOf: AS_OF,
      settings: DEFAULT_RISK_SETTINGS,
      agendas: [],
      compare: null,
    })
    expect(got).toMatchObject({ tasks: [], tests: [], compare: null })
  })
})

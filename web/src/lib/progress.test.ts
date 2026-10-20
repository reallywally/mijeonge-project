import { describe, expect, it } from 'vitest'
import { entries, taskDependencies, tasks, taskThreadLinks, threads } from '@/fixtures'
import { DEFAULT_RISK_SETTINGS } from '@/lib/risk'
import {
  ATTENTION_LIMIT,
  daysBetween,
  progressFacts,
  reportPeriod,
  reportPeriodLabel,
  roundRate,
  statusSpan,
  type ProgressInput,
} from '@/lib/progress'
import type { Task, TaskDependency, TaskThreadLink, Thread } from '@/types/domain'

/* 리포트의 규칙 계산 — 신호마다 · 점수 · 정렬 · 30개 · KST 날 수 · previous (docs/api/report.md '규칙이 세는 것') */

const TODAY = '2026-10-20'

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p1',
    key: `T-${id}`,
    title: id,
    parentId: null,
    body: [],
    status: 'todo',
    ownerId: null,
    start: null,
    due: null,
    priority: 'normal',
    partId: null,
    createdAt: '2026-09-01T00:00:00Z',
    commentCount: 0,
    minutesId: null,
    statusChangedAt: '2026-10-20T00:00:00Z',
    statusSinceBackfill: false,
    ...over,
  }
}

function thread(id: string, state: Thread['state']): Thread {
  return {
    id,
    projectId: 'p1',
    title: id,
    description: '',
    options: [],
    dueDate: null,
    state,
    ownerId: null,
    parentThreadId: null,
    partId: null,
    ccIds: [],
    createdAt: '2026-09-01T00:00:00Z',
    minutesId: null,
  }
}

function facts(
  ts: Task[],
  more: {
    deps?: TaskDependency[]
    links?: TaskThreadLink[]
    threads?: Thread[]
  } & Partial<ProgressInput> = {},
) {
  return progressFacts({
    tasks: ts,
    threads: more.threads ?? [],
    entries: more.entries ?? [],
    links: more.links ?? [],
    dependencies: more.deps ?? [],
    settings: more.settings ?? DEFAULT_RISK_SETTINGS,
    today: more.today ?? TODAY,
    previous: more.previous ?? null,
    riskyThreadIds: more.riskyThreadIds ?? [],
  })
}

const signalsOf = (f: ReturnType<typeof facts>, id: string) =>
  f.attention.find((a) => a.taskId === id)?.signals ?? []

describe('기간 · 날 수', () => {
  it('만드는 날(KST)을 끝으로 7일', () => {
    expect(reportPeriod(TODAY)).toEqual({ periodStart: '2026-10-14', periodEnd: '2026-10-20' })
    expect(reportPeriodLabel(TODAY)).toBe('지난 7일 · 10월 14일 ~ 10월 20일')
    expect(reportPeriod('2026-03-02').periodStart).toBe('2026-02-24')
  })

  it('날 수는 KST 날짜끼리 — UTC 15시는 다음 날이다', () => {
    expect(daysBetween('2026-10-08T00:00:00Z', TODAY)).toBe(12)
    expect(daysBetween('2026-10-19T15:00:00Z', TODAY)).toBe(0)
    expect(daysBetween('2026-10-19T14:59:59Z', TODAY)).toBe(1)
  })

  it('완료율은 소수 셋째 자리에서 반올림, 작업이 없으면 0', () => {
    expect(roundRate(3, 22)).toBe(0.14)
    expect(roundRate(1, 3)).toBe(0.33)
    expect(roundRate(1, 8)).toBe(0.13)
    expect(roundRate(29, 200)).toBe(0.15)
    expect(roundRate(0, 0)).toBe(0)
    expect(facts([]).progress.doneRate).toBe(0)
  })

  it('상태 며칠째 — backfill 이면 N일 이상, 0 이면 오늘부터', () => {
    expect(statusSpan({ statusDays: 12, statusSinceBackfill: false })).toBe('12일째')
    expect(statusSpan({ statusDays: 12, statusSinceBackfill: true })).toBe('12일 이상')
    expect(statusSpan({ statusDays: 0, statusSinceBackfill: true })).toBe('오늘부터')
  })
})

describe('신호', () => {
  it('waitingOnPredecessor — 안 끝난 선행이 있고 시작일이 dueSoonDays 안이거나 지났다', () => {
    const pred = task('a', { status: 'doing' })
    const deps = [
      { taskId: 'soon', dependsOnId: 'a' },
      { taskId: 'far', dependsOnId: 'a' },
      { taskId: 'nostart', dependsOnId: 'a' },
      { taskId: 'predDone', dependsOnId: 'd' },
    ]
    const f = facts(
      [
        pred,
        task('d', { status: 'done' }),
        task('soon', { start: '2026-10-23' }),
        task('far', { start: '2026-10-24' }),
        task('nostart'),
        task('predDone', { start: '2026-10-21' }),
      ],
      { deps },
    )
    expect(signalsOf(f, 'soon')).toEqual(['waitingOnPredecessor'])
    expect(signalsOf(f, 'far')).toEqual([])
    expect(signalsOf(f, 'nostart')).toEqual([])
    expect(signalsOf(f, 'predDone')).toEqual([])
    expect(f.attention.find((a) => a.taskId === 'soon')!.waitingOnTaskIds).toEqual(['a'])
  })

  it('lateBlocker — 기다리는 작업이 있는데 늦다(기한 지남 · 시작 지난 해야 할 일 · 오래 걸림)', () => {
    const deps = [
      { taskId: 'b1', dependsOnId: 'overdue' },
      { taskId: 'b2', dependsOnId: 'late' },
      { taskId: 'b3', dependsOnId: 'ontime' },
    ]
    const f = facts(
      [
        task('overdue', { status: 'doing', due: '2026-10-19' }),
        task('late', { start: '2026-10-19' }),
        task('ontime', { status: 'doing', start: '2026-10-20', due: '2026-10-30' }),
        task('b1', { start: '2026-11-30' }),
        task('b2', { start: '2026-11-30' }),
        task('b3', { start: '2026-11-30' }),
      ],
      { deps },
    )
    expect(signalsOf(f, 'overdue')).toEqual(['lateBlocker', 'overdue'])
    expect(signalsOf(f, 'late')).toEqual(['lateBlocker', 'notStarted'])
    expect(signalsOf(f, 'ontime')).toEqual([])
  })

  it('longRunning — 계획의 1.5배를 넘음, 계획이 없으면 staleDays 를 넘음', () => {
    const f = facts([
      /* 계획 4일 → 6일까지는 괜찮고 7일째부터 */
      task('six', {
        status: 'doing',
        start: '2026-10-14',
        due: '2026-10-17',
        statusChangedAt: '2026-10-14T00:00:00Z',
      }),
      task('seven', {
        status: 'doing',
        start: '2026-10-13',
        due: '2026-10-16',
        statusChangedAt: '2026-10-13T00:00:00Z',
      }),
      task('noPlan7', { status: 'doing', statusChangedAt: '2026-10-13T00:00:00Z' }),
      task('noPlan8', { status: 'doing', statusChangedAt: '2026-10-12T00:00:00Z' }),
    ])
    expect(signalsOf(f, 'six')).toEqual(['overdue'])
    expect(signalsOf(f, 'seven')).toEqual(['longRunning', 'overdue'])
    expect(signalsOf(f, 'noPlan7')).toEqual([])
    expect(signalsOf(f, 'noPlan8')).toEqual(['longRunning'])
    expect(f.attention.find((a) => a.taskId === 'seven')!.plannedDays).toBe(4)
  })

  it('longBlocked — 막힘인 날 수가 staleDays 를 넘음', () => {
    const f = facts([
      task('seven', { status: 'blocked', statusChangedAt: '2026-10-13T00:00:00Z' }),
      task('eight', { status: 'blocked', statusChangedAt: '2026-10-12T00:00:00Z' }),
    ])
    expect(signalsOf(f, 'seven')).toEqual([])
    expect(signalsOf(f, 'eight')).toEqual(['longBlocked'])
  })

  it('overdue · notStarted — 같이 날 수 있고, 기한 임박한 해야 할 일도 notStarted', () => {
    const f = facts([
      task('both', { start: '2026-10-01', due: '2026-10-10' }),
      task('soon', { due: '2026-10-23' }),
      task('later', { due: '2026-10-24' }),
      task('doingLate', { status: 'doing', due: '2026-10-19' }),
    ])
    expect(signalsOf(f, 'both')).toEqual(['overdue', 'notStarted'])
    expect(signalsOf(f, 'soon')).toEqual(['notStarted'])
    expect(signalsOf(f, 'later')).toEqual([])
    expect(signalsOf(f, 'doingLate')).toEqual(['overdue'])
  })

  it('decidedButBlocked — 막힘인데 걸린 안건이 있고 전부 결정됨', () => {
    const f = facts(
      [task('all'), task('some'), task('none')].map((t) => ({ ...t, status: 'blocked' as const })),
      {
        threads: [thread('d1', 'decided'), thread('d2', 'decided'), thread('o1', 'open')],
        links: [
          { taskId: 'all', threadId: 'd1' },
          { taskId: 'all', threadId: 'd2' },
          { taskId: 'some', threadId: 'd1' },
          { taskId: 'some', threadId: 'o1' },
        ],
      },
    )
    expect(signalsOf(f, 'all')).toEqual(['decidedButBlocked'])
    expect(signalsOf(f, 'some')).toEqual([])
    expect(signalsOf(f, 'none')).toEqual([])
    expect(f.attention.find((a) => a.taskId === 'all')!.weight.threadCount).toBe(2)
  })

  it('완료 작업에는 신호를 내지 않는다', () => {
    const f = facts([task('d', { status: 'done', due: '2026-10-01', start: '2026-09-01' })])
    expect(f.attention).toEqual([])
  })
})

describe('막는 작업 · 무게 · 점수 · 정렬', () => {
  it('blockingTaskIds 는 몇 단계 건너도 중복 없이, 끝난 작업에서 멈춘다', () => {
    const deps = [
      { taskId: 'b', dependsOnId: 'a' },
      { taskId: 'c', dependsOnId: 'b' },
      { taskId: 'c', dependsOnId: 'a' },
      { taskId: 'e', dependsOnId: 'd' },
      { taskId: 'f', dependsOnId: 'e' },
    ]
    const f = facts(
      [
        task('a', { due: '2026-10-01' }),
        task('b'),
        task('c'),
        task('d', { due: '2026-10-01' }),
        task('e', { status: 'done' }),
        task('f'),
      ],
      { deps },
    )
    const a = f.attention.find((x) => x.taskId === 'a')!
    expect(a.blockingTaskIds).toEqual(['b', 'c'])
    expect(a.score).toBe(3 + 2 + 1 + 2)
    expect(f.attention.find((x) => x.taskId === 'd')!.blockingTaskIds).toEqual([])
  })

  it('무게 — 안 끝난 자손 · 체크리스트 줄(불릿은 안 셈) · 우선순위', () => {
    const f = facts([
      task('p', {
        due: '2026-10-01',
        priority: 'high',
        body: [
          { id: 'l1', kind: 'check', text: '', done: true, level: 0 },
          { id: 'l2', kind: 'check', text: '', done: false, level: 0 },
          { id: 'l3', kind: 'bullet', text: '', done: false, level: 0 },
        ],
      }),
      task('c1', { parentId: 'p', status: 'done' }),
      task('c2', { parentId: 'p', status: 'doing' }),
      task('g1', { parentId: 'c2' }),
    ])
    expect(f.attention.find((a) => a.taskId === 'p')!.weight).toEqual({
      openChildren: 2,
      openLines: 1,
      totalLines: 2,
      threadCount: 0,
      priority: 'high',
    })
  })

  it('막는 작업 가산은 3까지', () => {
    const deps = ['b', 'c', 'd', 'e', 'f'].map((id) => ({ taskId: id, dependsOnId: 'a' }))
    const f = facts(
      [task('a', { due: '2026-10-01' }), ...['b', 'c', 'd', 'e', 'f'].map((id) => task(id))],
      {
        deps,
      },
    )
    expect(f.attention[0]).toMatchObject({ taskId: 'a', score: 3 + 2 + 1 + 3 })
  })

  it('정렬 — score 내림차순 → 기한 이른 순(없으면 뒤) → 등록 순, 30개까지', () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      task(`m${i}`, { start: '2026-10-01', due: i % 2 === 0 ? null : '2026-10-30' }),
    )
    const top = task('top', { due: '2026-10-01', start: '2026-10-01' })
    const f = facts([...many, top])
    expect(f.attention).toHaveLength(ATTENTION_LIMIT)
    expect(f.attention[0].taskId).toBe('top')
    expect(f.attention.slice(1, 4).map((a) => a.taskId)).toEqual(['m1', 'm3', 'm5'])
    expect(f.attention.at(-1)!.taskId).toBe('m22')
  })
})

describe('진척 · 결정 · 사람 · previous', () => {
  it('기간 안에 그 상태가 된 · 등록된 작업과 기간 안 이력의 안건', () => {
    const f = facts(
      [
        task('done1', { status: 'done', statusChangedAt: '2026-10-14T00:00:00Z' }),
        task('doneOld', { status: 'done', statusChangedAt: '2026-10-13T14:59:00Z' }),
        task('doing1', { status: 'doing', statusChangedAt: '2026-10-19T00:00:00Z' }),
        task('doingBackfill', {
          status: 'doing',
          statusChangedAt: '2026-10-19T00:00:00Z',
          statusSinceBackfill: true,
        }),
        task('new1', { createdAt: '2026-10-20T10:00:00Z' }),
      ],
      {
        threads: [thread('t1', 'decided'), thread('t2', 'open')],
        entries: [
          {
            id: 'e1',
            threadId: 't1',
            kind: 'decide',
            text: '',
            detail: [],
            note: '',
            ownerId: null,
            createdAt: '2026-10-15T00:00:00Z',
            minutesId: null,
          },
          {
            id: 'e2',
            threadId: 't2',
            kind: 'defer',
            text: '',
            detail: [],
            note: '',
            ownerId: null,
            createdAt: '2026-10-16T00:00:00Z',
            minutesId: null,
          },
          {
            id: 'e3',
            threadId: 't2',
            kind: 'change',
            text: '',
            detail: [],
            note: '',
            ownerId: null,
            createdAt: '2026-10-01T00:00:00Z',
            minutesId: null,
          },
        ],
        riskyThreadIds: Array.from({ length: 12 }, (_, i) => `r${i}`),
      },
    )
    expect(f.progress).toMatchObject({
      todo: 1,
      doing: 2,
      blocked: 0,
      done: 2,
      doneRate: 0.4,
      completedTaskIds: ['done1'],
      startedTaskIds: ['doing1'],
      createdTaskIds: ['new1'],
    })
    expect(f.decisions.decidedThreadIds).toEqual(['t1'])
    expect(f.decisions.deferredThreadIds).toEqual(['t2'])
    expect(f.decisions.riskyThreadIds).toHaveLength(10)
  })

  it('사람별 — 담당 작업이 있는 사람만, 손쓸 작업이 많은 순, 담당자 없음은 뒤', () => {
    const f = facts([
      task('a', { ownerId: 'u2', status: 'doing' }),
      task('b', { ownerId: 'u1', status: 'blocked', statusChangedAt: '2026-10-01T00:00:00Z' }),
      task('c', { ownerId: null, due: '2026-10-01' }),
      task('d', { ownerId: 'u1', status: 'done', statusChangedAt: '2026-10-18T00:00:00Z' }),
    ])
    expect(f.people).toEqual([
      { memberId: 'u1', doing: 0, blocked: 1, overdue: 0, completed: 1, attentionTaskIds: ['b'] },
      { memberId: null, doing: 0, blocked: 0, overdue: 1, completed: 0, attentionTaskIds: ['c'] },
      { memberId: 'u2', doing: 1, blocked: 0, overdue: 0, completed: 0, attentionTaskIds: [] },
    ])
  })

  it('previous 는 받은 그대로 싣는다', () => {
    const previous = { reportId: 'rp1', periodEnd: '2026-10-13', doneRate: 0.1, blocked: 3 }
    expect(facts([], { previous }).previous).toEqual(previous)
    expect(facts([]).previous).toBeNull()
  })
})

describe('시드 (p1, 2026-10-20 기본 기준)', () => {
  const p1 = tasks.filter((t) => t.projectId === 'p1')
  const f = progressFacts({
    tasks: p1,
    threads: threads.filter((t) => t.projectId === 'p1'),
    entries,
    links: taskThreadLinks,
    dependencies: taskDependencies,
    settings: DEFAULT_RISK_SETTINGS,
    today: TODAY,
    previous: null,
    riskyThreadIds: ['t5', 't3', 't8', 't9'],
  })

  it('k20 — 진행 중 12일째(계획 3일) · 기한 지남 · k21 · k22 를 막는 중, 맨 위', () => {
    expect(f.attention[0]).toMatchObject({
      taskId: 'k20',
      signals: ['lateBlocker', 'longRunning', 'overdue'],
      statusDays: 12,
      plannedDays: 3,
      waitingOnTaskIds: [],
      blockingTaskIds: ['k21', 'k22'],
      score: 9,
    })
  })

  it('k22 — 선행 대기 · 풀어도 됨(막힌 지 7일이라 오래 막힘은 아직)', () => {
    expect(f.attention.find((a) => a.taskId === 'k22')).toMatchObject({
      signals: ['waitingOnPredecessor', 'decidedButBlocked'],
      statusDays: 7,
      waitingOnTaskIds: ['k20'],
      score: 4,
    })
  })

  it('진척 숫자', () => {
    expect(f.progress).toMatchObject({ todo: 11, doing: 6, blocked: 2, done: 3, doneRate: 0.14 })
    expect(f.attention).toHaveLength(19)
  })
})

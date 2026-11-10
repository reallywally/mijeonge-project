import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import {
  applyAgendaImpact,
  fetchAgendaImpact,
  streamAgendaImpact,
  toImpactEvent,
} from '@/api/impacts'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import type { AgendaImpact, ImpactEvent } from '@/types/domain'

/* AI 영향도 분석 — 목업 갈래가 계약과 같은 규칙으로 고르고 · 남기고 · 반영 검사를 같은 순서로 보는지, SSE 읽기 (docs/api/impact.md) */
afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  resetMockAuth()
  await login({ email: 'u1@inno-ax.com', password: MOCK_PASSWORD })
})

async function failure(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(ApiError)
  return e as ApiError
}

/** 끝까지 받고 이벤트를 낸다 */
async function streamed(agendaId: string) {
  vi.useFakeTimers()
  const events: ImpactEvent[] = []
  const run = (async () => {
    for await (const e of streamAgendaImpact(agendaId, new AbortController().signal)) events.push(e)
  })()
  /* 스트림 전 오류는 타이머를 돌리는 사이에 난다 — 미리 받아 둔다 */
  const settled = run.then(
    () => null,
    (e: unknown) => e,
  )
  await vi.runAllTimersAsync()
  const error = await settled
  vi.useRealTimers()
  if (error) throw error
  return events
}

const impactOf = (events: ImpactEvent[]) =>
  (events.find((e) => e.type === 'impact') as { impact: AgendaImpact }).impact

describe('분석 스트림 (목업)', () => {
  it('t2 — 진행 줄 셋 뒤 결과 하나 · done. 연결 작업 · 닿는 테스트 · 다른 결정 안건을 같은 규칙으로 고른다', async () => {
    const events = await streamed('t2')
    expect(events.map((e) => e.type)).toEqual(['tool', 'tool', 'tool', 'impact', 'done'])
    expect(
      events.filter((e) => e.type === 'tool').map((e) => (e as { label: string }).label),
    ).toEqual(['연결 작업 읽는 중', '다른 결정 비교 중', '고칠 안 만드는 중'])
    const impact = impactOf(events)
    expect(impact).toMatchObject({
      agendaId: 't2',
      projectId: 'p1',
      decisionRev: 1,
      createdBy: 'u1',
    })
    /* 이행 줄의 from 이 빈 글이라 처음 결정 */
    expect(impact.decisionBefore).toBeNull()
    expect(impact.decisionAfter).toContain('mysql 을 쓴다')
    /* 연결 작업 k4 · k22 (seq 순) — 본문이 있는 k4 의 첫 줄을 고친 안 */
    expect(impact.tasks.map((t) => [t.taskId, t.verdict])).toEqual([
      ['k4', 'update'],
      ['k22', 'ok'],
    ])
    const k4 = impact.tasks[0]
    expect(k4.title).toBeUndefined()
    expect(k4.body![0].text).toBe(`${k4.before.body[0].text} — mysql 을 쓴다 기준`)
    expect(k4.body!.slice(1)).toEqual(k4.before.body.slice(1))
    /* k4 를 태그한 tc2 · t2 를 태그한 tc4 */
    expect(impact.tests.map((t) => [t.testId, t.verdict])).toEqual([
      ['tc2', 'update'],
      ['tc4', 'ok'],
    ])
    expect(impact.tests[0].content).toContain('바뀐 결정 확인: mysql 을 쓴다')
    /* 다른 결정 안건 — 결정 시각 최신 순 첫 것을 check */
    expect(impact.conflicts).toEqual([
      expect.objectContaining({ agendaId: 't6', verdict: 'check' }),
    ])
    expect(impact.summary.length).toBeGreaterThan(0)
    expect(mockDb().impacts.map((r) => r.id)).toEqual([impact.id])
  })

  it('GET — 가장 최근 분석과 세는 것, 분석 전에는 latest null', async () => {
    expect(await fetchAgendaImpact('t2')).toEqual({
      latest: null,
      taskCount: 2,
      testCount: 2,
      decidedAgendaCount: 2,
    })
    const first = impactOf(await streamed('t2'))
    const second = impactOf(await streamed('t2'))
    expect(second.id).not.toBe(first.id)
    expect((await fetchAgendaImpact('t2')).latest!.id).toBe(second.id)
  })

  it('결정내용이 비면 409 IMPACT_NO_DECISION, 못 보는 안건은 404 — 스트림 전에', async () => {
    const empty = await failure(streamed('t3'))
    expect([empty.status, empty.code]).toEqual([409, 'IMPACT_NO_DECISION'])
    const missing = await failure(streamed('없는안건'))
    expect([missing.status, missing.code]).toEqual([404, 'AGENDA_NOT_FOUND'])
    expect(mockDb().impacts).toEqual([])
  })

  it('멈추면 아무것도 남지 않는다', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const run = (async () => {
      for await (const e of streamAgendaImpact('t2', controller.signal))
        if (e.type === 'tool') controller.abort()
    })()
    const caught = run.catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    expect(await caught).toBeInstanceOf(DOMException)
    expect(mockDb().impacts).toEqual([])
  })
})

describe('반영 (목업)', () => {
  it('고른 줄만 반영 — 작업은 바뀐 사본, 테스트는 목업 서버에서 고치고 이력이 남고, appliedAt 이 찍힌다', async () => {
    const impact = impactOf(await streamed('t2'))
    const body = impact.tasks[0].body!
    const res = await applyAgendaImpact(impact.id, {
      tasks: [{ taskId: 'k4', body }],
      tests: [{ testId: 'tc2', content: '손으로 고친 내용' }],
    })
    expect(res.tasks.map((t) => [t.id, t.body.map((l) => l.text)])).toEqual([
      ['k4', body.map((l) => l.text)],
    ])
    expect(res.tests.map((t) => [t.id, t.content])).toEqual([['tc2', '손으로 고친 내용']])
    expect(mockDb().tests.find((t) => t.id === 'tc2')!.content).toBe('손으로 고친 내용')
    expect(res.impact.tasks[0].appliedAt).not.toBeNull()
    expect(res.impact.tests[0].appliedAt).not.toBeNull()
    /* 반영한 값이 고친 안으로 남는다 — 같은 자리의 줄은 기존 id 를 이어 쓴다 */
    expect(res.impact.tests[0].content).toBe('손으로 고친 내용')
    expect(res.tasks[0].body.map((l) => l.id).slice(0, 2)).toEqual(['l1', 'l2'])
    expect(
      mockDb()
        .taskHistory.k4.at(-1)!
        .changes.map((c) => c.field),
    ).toEqual(['body'])
    expect(
      mockDb()
        .testHistory.tc2.at(-1)!
        .changes.map((c) => c.field),
    ).toEqual(['content'])
    /* 이미 반영한 줄을 다시 보내면 대상 바뀜 */
    const again = await failure(
      applyAgendaImpact(impact.id, { tasks: [], tests: [{ testId: 'tc2', content: 'x' }] }),
    )
    expect([again.status, again.code, again.detail]).toEqual([
      409,
      'IMPACT_TARGET_CHANGED',
      { 'tests.0': expect.any(String) },
    ])
  })

  it('검사 순서 — 404 → 422 → 409 결정 바뀜 → 409 대상 바뀜', async () => {
    const impact = impactOf(await streamed('t2'))
    const missing = await failure(applyAgendaImpact('없는분석', { tasks: [], tests: [] }))
    expect([missing.status, missing.code]).toEqual([404, 'IMPACT_NOT_FOUND'])

    const empty = await failure(applyAgendaImpact(impact.id, { tasks: [], tests: [] }))
    expect([empty.status, empty.code]).toEqual([422, 'VALIDATION_ERROR'])
    const notUpdate = await failure(
      applyAgendaImpact(impact.id, { tasks: [{ taskId: 'k22', title: '새 제목' }], tests: [] }),
    )
    expect(notUpdate.detail).toEqual({ 'tasks.0.taskId': expect.any(String) })
    const blank = await failure(
      applyAgendaImpact(impact.id, { tasks: [], tests: [{ testId: 'tc2', title: '  ' }] }),
    )
    expect(blank.detail).toEqual({ 'tests.0.title': expect.any(String) })
    /* 분석 때와 같은 값뿐이면 반영할 것이 없다 · 같은 줄 두 번 */
    const same = await failure(
      applyAgendaImpact(impact.id, {
        tasks: [{ taskId: 'k4', body: impact.tasks[0].before.body }],
        tests: [
          { testId: 'tc2', content: 'a' },
          { testId: 'tc2', content: 'b' },
        ],
      }),
    )
    expect(same.detail).toEqual({
      'tasks.0': '지금 값과 다른 칸이 없습니다.',
      'tests.1.testId': '같은 테스트가 두 번 있습니다.',
    })

    /* 대상이 바뀐 것보다 결정이 바뀐 것을 먼저 본다 */
    mockDb().tests.find((t) => t.id === 'tc2')!.content = '그사이 고침'
    const fixture = (await import('@/fixtures')).agendas.find((t) => t.id === 't2')!
    fixture.decisionRev += 1
    try {
      const stale = await failure(
        applyAgendaImpact(impact.id, { tasks: [], tests: [{ testId: 'tc2', content: 'x' }] }),
      )
      expect([stale.status, stale.code]).toEqual([409, 'IMPACT_STALE'])
    } finally {
      fixture.decisionRev -= 1
    }
    const moved = await failure(
      applyAgendaImpact(impact.id, { tasks: [], tests: [{ testId: 'tc2', content: 'x' }] }),
    )
    expect([moved.status, moved.code, moved.detail]).toEqual([
      409,
      'IMPACT_TARGET_CHANGED',
      { 'tests.0': expect.any(String) },
    ])
  })

  it('권한 — 작업은 작성자 · 담당자 · 관리자만(403, detail tasks.N), 결정 바뀜보다 먼저', async () => {
    resetMockAuth()
    await login({ email: 'u2@inno-ax.com', password: MOCK_PASSWORD })
    /* t5 의 연결 작업 k18 — 등록 이도현 · 담당 정하늘이라 박지훈은 못 고친다 */
    const impact = impactOf(await streamed('t5'))
    expect(impact.tasks.map((t) => [t.taskId, t.verdict])).toEqual([['k18', 'update']])
    expect(impact.tasks[0].title).toContain('보험료 산출 기간계 API 개발')
    const denied = await failure(
      applyAgendaImpact(impact.id, {
        tasks: [{ taskId: 'k18', title: impact.tasks[0].title }],
        tests: [],
      }),
    )
    expect([denied.status, denied.code, denied.detail]).toEqual([
      403,
      'FORBIDDEN',
      { 'tasks.0': expect.any(String) },
    ])
  })
})

describe('SSE 읽기', () => {
  const impact: AgendaImpact = {
    id: 'ai1',
    projectId: 'p1',
    agendaId: 't2',
    decisionRev: 2,
    decisionBefore: 'mysql',
    decisionAfter: 'postgresql',
    summary: '바뀜',
    tasks: [
      {
        taskId: 'k4',
        verdict: 'update',
        reason: '근거',
        body: [{ kind: 'check', text: 'a', done: false, level: 0 }],
        before: { title: '개발 환경 설정', body: [] },
        appliedAt: null,
      },
    ],
    tests: [
      {
        testId: 'tc2',
        verdict: 'ok',
        reason: '상관없음',
        before: { title: 't', content: '', testData: '' },
        appliedAt: null,
      },
    ],
    conflicts: [{ agendaId: 't1', verdict: 'conflict', reason: '부딪힘', decision: '우분투' }],
    createdBy: 'u1',
    createdAt: '2026-11-10T00:00:00Z',
  }

  it('impact · tool · done · error 를 읽고, 모르는 event 는 건너뛴다', () => {
    expect(toImpactEvent({ event: 'impact', data: JSON.stringify({ impact }) })).toEqual({
      type: 'impact',
      impact,
    })
    expect(
      toImpactEvent({ event: 'tool', data: '{"name":"x","label":"연결 작업 읽는 중"}' }),
    ).toEqual({ type: 'tool', name: 'x', label: '연결 작업 읽는 중' })
    expect(toImpactEvent({ event: 'done', data: '{}' })).toEqual({ type: 'done' })
    expect(
      toImpactEvent({ event: 'error', data: '{"code":"IMPACT_FAILED","message":"m"}' }),
    ).toEqual({ type: 'error', code: 'IMPACT_FAILED', message: 'm' })
    expect(toImpactEvent({ event: 'delta', data: '{"text":"x"}' })).toBeNull()
  })

  it('모양이 아닌 결과는 깨진 스트림이다', () => {
    const broken = { ...impact, tasks: [{ ...impact.tasks[0], verdict: 'maybe' }] }
    expect(() =>
      toImpactEvent({ event: 'impact', data: JSON.stringify({ impact: broken }) }),
    ).toThrow(ApiError)
    expect(() => toImpactEvent({ event: 'impact', data: '{' })).toThrow(ApiError)
  })
})

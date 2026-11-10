import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import {
  applyAgendaImpact,
  fetchAgendaImpact,
  streamAgendaImpact,
  toImpactEvent,
} from '@/api/impacts'
import { recordMockHistory } from '@/api/history'
import { mockDb, provideMockWorld, resetMockAuth, type MockWorld } from '@/api/mockAuth'
import { agendas, MOCK_PASSWORD, taskAgendaLinks, tasks } from '@/fixtures'
import { change } from '@/lib/history'
import type { AgendaImpact, ImpactEvent } from '@/types/domain'

/* AI 영향도 분석 — 목업 갈래가 계약과 같은 규칙으로 고르고 · 남기고 · 반영 검사를 같은 순서로 보는지, SSE 읽기 (docs/api/impact.md) */
afterEach(() => {
  vi.useRealTimers()
  provideMockWorld(null)
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
        linked: true,
        linkedOnApply: false,
      },
    ],
    tests: [
      {
        testId: 'tc2',
        verdict: 'ok',
        reason: '상관없음',
        before: { title: 't', content: '', testData: '' },
        appliedAt: null,
        linked: false,
        linkedOnApply: true,
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

/**
 * 숨은 영향 — 서버 OS 결정(t1)을 '우분투' 에서 '록키' 로 바꾸고, 연결 안 된 작업 HW-19 의 본문 · 닿지 않는 테스트 tc1 의
 * 내용에 '우분투' 를 적는다. 픽스처를 물들이지 않게 사본 세계를 쓴다
 */
function hiddenWorld(): MockWorld {
  const world: MockWorld = {
    agendas: structuredClone(agendas),
    tasks: structuredClone(tasks),
    taskAgendas: structuredClone(taskAgendaLinks),
  }
  const t1 = world.agendas.find((t) => t.id === 't1')!
  recordMockHistory('agenda', 't1', [change('decision', t1.decision, '록키 최신 버전으로 한다')])
  t1.decision = '록키 최신 버전으로 한다'
  t1.decisionRev = 2
  world.tasks.find((t) => t.id === 'k19')!.body = [
    { id: 'h1', kind: 'check', text: '서버 발급', done: true, level: 0 },
    { id: 'h2', kind: 'check', text: 'OS 를 우분투로 설치한다', done: false, level: 0 },
  ]
  mockDb().tests.find((t) => t.id === 'tc1')!.content = '서버 OS: 우분투 최신'
  provideMockWorld(() => world)
  return world
}

describe('숨은 영향 — 연결 안 된 작업 · 테스트 (목업)', () => {
  it('바뀐 낱말의 옛 값으로 찾는다 — 찾기 · 읽기 진행 줄, 연결 안 된 작업은 update(옛 낱말 → 새 낱말) · 테스트는 check', async () => {
    hiddenWorld()
    const events = await streamed('t1')
    expect(
      events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name),
    ).toEqual([
      'read_tasks',
      'compare_decisions',
      'search_tasks',
      'search_tests',
      'get_task',
      'propose_impact',
    ])
    expect(
      events.filter((e) => e.type === 'tool').map((e) => (e as { label: string }).label),
    ).toContain('관련 작업 · 테스트 찾는 중')
    expect(
      events.filter((e) => e.type === 'tool').map((e) => (e as { label: string }).label),
    ).toContain('관련 작업 · 테스트 읽는 중')
    const impact = impactOf(events)
    expect(impact.decisionBefore).toBe('우분투 최신 버전으로 한다')
    /* 넣어 준 줄 다음에 찾은 줄 */
    expect(impact.tasks.map((t) => [t.taskId, t.verdict, t.linked])).toEqual([
      ['k4', 'update', true],
      ['k19', 'update', false],
    ])
    const k19 = impact.tasks[1]
    expect(k19.body!.map((l) => l.text)).toEqual(['서버 발급', 'OS 를 록키로 설치한다'])
    expect(k19.title).toBeUndefined()
    expect(k19.reason).toContain('우분투')
    expect(k19.linkedOnApply).toBe(false)
    expect(impact.tests.map((t) => [t.testId, t.verdict, t.linked])).toEqual([
      ['tc2', 'update', true],
      ['tc1', 'check', false],
    ])
    expect(impact.tests[1].content).toBeUndefined()
    /* 알림 줄의 숫자는 그대로 — 연결 작업 · 닿는 테스트만 */
    expect(await fetchAgendaImpact('t1')).toMatchObject({ taskCount: 1, testCount: 1 })
  })

  it('결정 전이 없거나(처음 결정) 걸리는 것이 없으면 찾기만 하고 연결 안 된 줄은 없다', async () => {
    const plain = await streamed('t2')
    expect(plain.filter((e) => e.type === 'tool')).toHaveLength(3)
    expect(impactOf(plain).tasks.every((t) => t.linked)).toBe(true)

    const world = hiddenWorld()
    world.tasks.find((t) => t.id === 'k19')!.body = []
    mockDb().tests.find((t) => t.id === 'tc1')!.content = ''
    const events = await streamed('t1')
    expect(
      events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name),
    ).toEqual(['read_tasks', 'compare_decisions', 'search_tasks', 'search_tests', 'propose_impact'])
    expect(impactOf(events).tasks.map((t) => t.taskId)).toEqual(['k4'])
  })

  it('반영 + 연결 — 작업 ↔ 안건 링크를 links 로 내고(링크는 스토어가 더한다) 테스트는 안건 태그, 줄에 linkedOnApply', async () => {
    const world = hiddenWorld()
    const impact = impactOf(await streamed('t1'))
    const k19 = impact.tasks.find((t) => t.taskId === 'k19')!
    const res = await applyAgendaImpact(impact.id, {
      tasks: [{ taskId: 'k19', body: k19.body, link: true }],
      tests: [{ testId: 'tc1', link: true }],
    })
    expect(res.links).toEqual([{ taskId: 'k19', agendaId: 't1' }])
    expect(res.tasks.map((t) => [t.id, t.body[1].text])).toEqual([['k19', 'OS 를 록키로 설치한다']])
    /* 연결만 한 테스트는 글을 덮어쓰지 않는다 */
    expect(res.tests.map((t) => [t.id, t.content])).toEqual([['tc1', '서버 OS: 우분투 최신']])
    expect(res.tests[0].refs).toContainEqual({ kind: 'agenda', id: 't1' })
    expect(mockDb().tests.find((t) => t.id === 'tc1')!.refs).toContainEqual({
      kind: 'agenda',
      id: 't1',
    })
    const rows = res.impact
    expect(rows.tasks.find((t) => t.taskId === 'k19')).toMatchObject({ linkedOnApply: true })
    expect(rows.tasks.find((t) => t.taskId === 'k19')!.appliedAt).not.toBeNull()
    expect(rows.tests.find((t) => t.testId === 'tc1')).toMatchObject({ linkedOnApply: true })
    /* 고친 칸 한 줄 · 연결 한 줄 — 일반 수정 · 링크 걸기와 같다 */
    expect(
      mockDb()
        .taskHistory.k19.slice(-2)
        .map((h) => h.changes.map((c) => c.field)),
    ).toEqual([['body'], ['agenda']])
    /* 이미 걸려 있으면 그대로 — 새 링크가 없다(멱등) */
    world.taskAgendas.push({ taskId: 'k19', agendaId: 't1' })
    const second = impactOf(await streamed('t1'))
    expect(second.tasks.find((t) => t.taskId === 'k19')!.linked).toBe(true)
  })

  it('연결만 하는 줄은 분석 뒤 바뀜을 보지 않는다 — 지운 대상만 409', async () => {
    const world = hiddenWorld()
    const impact = impactOf(await streamed('t1'))
    world.tasks.find((t) => t.id === 'k19')!.title = '그사이 고친 제목'
    mockDb().tests.find((t) => t.id === 'tc1')!.content = '그사이 고친 내용'
    const res = await applyAgendaImpact(impact.id, {
      tasks: [{ taskId: 'k19', link: true }],
      tests: [{ testId: 'tc1', link: true }],
    })
    expect(res.links).toEqual([{ taskId: 'k19', agendaId: 't1' }])
    expect(res.tasks[0].title).toBe('그사이 고친 제목')
    expect(res.tests[0].content).toBe('그사이 고친 내용')
    /* 연결만 해도 반영한 값을 남기는 규칙 그대로 — 안 보낸 고친 안 칸은 빠진다 */
    expect(res.impact.tasks.find((t) => t.taskId === 'k19')!.body).toBeUndefined()

    const again = impactOf(await streamed('t1'))
    world.tasks.splice(
      world.tasks.findIndex((t) => t.id === 'k4'),
      1,
    )
    const gone = await failure(
      applyAgendaImpact(again.id, { tasks: [{ taskId: 'k4', title: '새 제목' }], tests: [] }),
    )
    expect([gone.status, gone.code, gone.detail]).toEqual([
      409,
      'IMPACT_TARGET_CHANGED',
      { 'tasks.0': '분석 뒤에 지워졌습니다.' },
    ])
  })

  it('422 — 걸린 줄에 연결 · 확인 필요 줄에 고칠 칸 · 연결 없는 확인 필요 줄 · 고칠 칸도 연결도 없는 줄', async () => {
    hiddenWorld()
    const impact = impactOf(await streamed('t1'))
    const k4 = impact.tasks.find((t) => t.taskId === 'k4')!
    const bad = await failure(
      applyAgendaImpact(impact.id, {
        tasks: [
          { taskId: 'k4', body: k4.body, link: true },
          { taskId: 'k19', link: false },
        ],
        tests: [{ testId: 'tc1', content: '고친 내용', link: true }],
      }),
    )
    expect([bad.status, bad.code]).toEqual([422, 'VALIDATION_ERROR'])
    expect(bad.detail).toEqual({
      'tasks.0.link': expect.stringContaining('이미 이 안건에 연결된'),
      'tasks.1': '고칠 칸(title · body)도 연결(link)도 없습니다.',
      'tests.0': expect.stringContaining('확인 필요 줄은 고칠 안이 없습니다'),
    })
    const noLink = await failure(
      applyAgendaImpact(impact.id, { tasks: [], tests: [{ testId: 'tc1' }] }),
    )
    expect(noLink.detail).toEqual({ 'tests.0.link': '확인 필요 줄은 연결(link)로만 고릅니다.' })
    /* 아무것도 안 바뀐다 */
    expect(mockDb().tests.find((t) => t.id === 'tc1')!.refs).toEqual([])
  })

  it('테스트 태그가 다 차 있으면 태그 걸기의 400 TEST_REF_LIMIT 을 그 줄 자리로 — 아무것도 안 바뀐다', async () => {
    hiddenWorld()
    const impact = impactOf(await streamed('t1'))
    const tc1 = mockDb().tests.find((t) => t.id === 'tc1')!
    tc1.refs = Array.from({ length: 20 }, (_, n) => ({ kind: 'task' as const, id: `z${n}` }))
    const k19 = impact.tasks.find((t) => t.taskId === 'k19')!
    const historyBefore = mockDb().taskHistory.k19?.length ?? 0
    const full = await failure(
      applyAgendaImpact(impact.id, {
        tasks: [{ taskId: 'k19', body: k19.body, link: true }],
        tests: [{ testId: 'tc1', link: true }],
      }),
    )
    expect([full.status, full.code, Object.keys(full.detail ?? {})]).toEqual([
      400,
      'TEST_REF_LIMIT',
      ['tests.0.link'],
    ])
    expect(
      mockDb()
        .impacts.at(-1)!
        .tasks.every((t) => t.appliedAt === null),
    ).toBe(true)
    expect(mockDb().taskHistory.k19).toHaveLength(historyBefore)
  })

  it('연결 권한은 작업 고치기 권한 — 403 tasks.N', async () => {
    resetMockAuth()
    await login({ email: 'u2@inno-ax.com', password: MOCK_PASSWORD })
    hiddenWorld()
    const impact = impactOf(await streamed('t1'))
    /* HW-19 — 담당 이도현, 등록한 사람 없음. 박지훈은 못 고친다 */
    const denied = await failure(
      applyAgendaImpact(impact.id, { tasks: [{ taskId: 'k19', link: true }], tests: [] }),
    )
    expect([denied.status, denied.code, denied.detail]).toEqual([
      403,
      'FORBIDDEN',
      { 'tasks.0': expect.any(String) },
    ])
  })

  it('1단계에서 남긴 분석(linked 칸 없음)은 연결된 줄 · 연결 안 함으로 읽는다', async () => {
    const impact = impactOf(await streamed('t2'))
    const row = mockDb().impacts.find((r) => r.id === impact.id)!
    for (const r of [...row.tasks, ...row.tests]) {
      const loose = r as { linked?: boolean; linkedOnApply?: boolean }
      delete loose.linked
      delete loose.linkedOnApply
    }
    const latest = (await fetchAgendaImpact('t2')).latest!
    expect(latest.tasks.every((t) => t.linked && !t.linkedOnApply)).toBe(true)
    expect(latest.tests.every((t) => t.linked && !t.linkedOnApply)).toBe(true)

    const { linked: _l, linkedOnApply: _o, ...old } = impact.tasks[0]
    void _l
    void _o
    const read = toImpactEvent({
      event: 'impact',
      data: JSON.stringify({ impact: { ...impact, tasks: [old] } }),
    }) as { impact: AgendaImpact }
    expect(read.impact.tasks[0]).toMatchObject({ linked: true, linkedOnApply: false })
  })
})

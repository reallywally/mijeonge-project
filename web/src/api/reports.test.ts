import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError, isUnreachable } from '@/api/client'
import { resetMockAuth, writeMockSession } from '@/api/mockAuth'
import { deleteReport, fetchReport, fetchReports, streamCreateReport } from '@/api/reports'
import { MOCK_PASSWORD, REPORT_EMPTY } from '@/fixtures'
import type { ProgressFacts, ReportEvent } from '@/types/domain'

/* 리포트 api — 목업은 같은 계산 → facts → 고정 글 → 저장 → done, 서버는 SSE (docs/api/report.md) */
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function collect(stream: AsyncIterable<ReportEvent>, onEvent?: (e: ReportEvent) => void) {
  const events: ReportEvent[] = []
  const run = (async () => {
    for await (const e of stream) {
      events.push(e)
      onEvent?.(e)
    }
  })().then(
    () => null,
    (e: unknown) => e,
  )
  await vi.runAllTimersAsync()
  return { events, error: await run }
}

const textOf = (events: ReportEvent[]) =>
  events.map((e) => (e.type === 'delta' ? e.text : '')).join('')

const rejected = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  )

describe('목업 갈래', () => {
  beforeEach(async () => {
    resetMockAuth()
    await login({ email: 'u2@innoflow.local', password: MOCK_PASSWORD })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
  })

  it('facts → 글 조각 → done 순서, 저장하고 목록 · 읽기에 나온다', async () => {
    const { events, error } = await collect(streamCreateReport('p1', new AbortController().signal))
    expect(error).toBeNull()
    expect(events[0].type).toBe('facts')
    const facts = (events[0] as { facts: ProgressFacts }).facts
    expect([facts.periodStart, facts.periodEnd]).toEqual(['2026-10-14', '2026-10-20'])
    expect(facts.attention[0].taskId).toBe('k20')
    expect(facts.decisions.riskyThreadIds).toEqual(['t5', 't3', 't8', 't9'])
    expect(facts.previous).toBeNull()

    const text = textOf(events)
    expect(text.startsWith('한 줄 총평 — ')).toBe(true)
    for (const head of ['이번 주 진척', '결정', '먼저 손쓸 것', '사람', '다음 주 볼 것'])
      expect(text).toContain(`\n\n${head}\n`)
    expect(text).toContain('1. [[task:k20]] — 진행 중이 된 지 12일째(계획 3일)')
    expect(text).toContain('HW-21 개발자 계정 배포 · HW-22 스테이징 DB 구성')

    const done = events.at(-1)!
    expect(done.type).toBe('done')
    if (done.type !== 'done') return
    expect(done.refs).toEqual([
      { kind: 'thread', id: 't3' },
      { kind: 'task', id: 'k20' },
      { kind: 'task', id: 'k22' },
    ])
    expect(done.report).toMatchObject({
      id: 'rp1',
      projectId: 'p1',
      periodStart: '2026-10-14',
      periodEnd: '2026-10-20',
      createdBy: 'u2',
      doneRate: 0.14,
      attentionCount: 19,
    })

    expect(await fetchReports('p1')).toEqual([done.report])
    const saved = await fetchReport('rp1')
    expect(saved.body).toBe(text)
    expect(saved.facts).toEqual(facts)
  })

  it('두 번째 리포트는 바로 앞 리포트를 previous 로, 목록은 최근 것 먼저', async () => {
    await collect(streamCreateReport('p1', new AbortController().signal))
    const { events } = await collect(streamCreateReport('p1', new AbortController().signal))
    const facts = (events[0] as { facts: ProgressFacts }).facts
    expect(facts.previous).toEqual({
      reportId: 'rp1',
      periodEnd: '2026-10-20',
      doneRate: 0.14,
      blocked: 2,
    })
    expect(textOf(events)).toContain('(지난 리포트 14%)')
    expect((await fetchReports('p1')).map((r) => r.id)).toEqual(['rp2', 'rp1'])
  })

  it('멈추면 저장하지 않는다', async () => {
    const stop = new AbortController()
    const { events, error } = await collect(streamCreateReport('p1', stop.signal), (e) => {
      if (e.type === 'delta') stop.abort()
    })
    expect(events.map((e) => e.type)).toEqual(['facts', 'delta'])
    expect(error).toBeInstanceOf(DOMException)
    expect(await fetchReports('p1')).toEqual([])
  })

  it('작업이 없는 프로젝트는 한 줄로 끝내고 저장한다', async () => {
    writeMockSession('u1')
    const { events } = await collect(streamCreateReport('p3', new AbortController().signal))
    expect(textOf(events)).toBe(REPORT_EMPTY)
    expect(events.at(-1)).toMatchObject({ type: 'done', refs: [], report: { attentionCount: 0 } })
    expect(await fetchReports('p3')).toHaveLength(1)
  })

  it('부여받지 않은 프로젝트는 만들기 · 읽기 모두 404', async () => {
    writeMockSession('u1')
    await collect(streamCreateReport('p3', new AbortController().signal))
    writeMockSession('u2')
    const { error } = await collect(streamCreateReport('p3', new AbortController().signal))
    expect(error).toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' })
    expect(await rejected(fetchReport('rp1'))).toMatchObject({
      status: 404,
      code: 'REPORT_NOT_FOUND',
    })
    expect(await rejected(fetchReport('없음'))).toMatchObject({ code: 'REPORT_NOT_FOUND' })
  })

  it('지우기는 만든 사람 · 프로젝트 관리자 · 시스템 관리자만, 그 밖은 403', async () => {
    await collect(streamCreateReport('p1', new AbortController().signal))
    await collect(streamCreateReport('p1', new AbortController().signal))

    writeMockSession('u3')
    const e = await rejected(deleteReport('rp1'))
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 403, code: 'FORBIDDEN' })

    writeMockSession('u2')
    await deleteReport('rp1')
    writeMockSession('u1')
    await deleteReport('rp2')
    expect(await fetchReports('p1')).toEqual([])
    expect(await rejected(deleteReport('rp2'))).toMatchObject({ status: 404 })
  })
})

describe('서버 갈래', () => {
  beforeEach(() => vi.stubEnv('VITE_USE_MOCK', 'false'))

  const encoder = new TextEncoder()
  const sse = (event: ReportEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const streamOf = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(text))
          c.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  const serve = (res: Response) => {
    const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(res),
    )
    vi.stubGlobal('fetch', fake)
    return fake
  }
  async function read(stream: AsyncIterable<ReportEvent>) {
    const events: ReportEvent[] = []
    try {
      for await (const e of stream) events.push(e)
      return { events, error: null as unknown }
    } catch (error) {
      return { events, error }
    }
  }

  const facts: ProgressFacts = {
    periodStart: '2026-10-14',
    periodEnd: '2026-10-20',
    settings: { dueSoonDays: 3, deferCount: 2, staleDays: 7, highScore: 6, mediumScore: 3 },
    progress: {
      todo: 0,
      doing: 0,
      blocked: 0,
      done: 0,
      doneRate: 0,
      completedTaskIds: [],
      startedTaskIds: [],
      createdTaskIds: [],
    },
    previous: null,
    decisions: { decidedThreadIds: [], deferredThreadIds: [], riskyThreadIds: [] },
    attention: [],
    people: [],
  }
  const item = {
    id: 'r1',
    projectId: 'p1',
    periodStart: '2026-10-14',
    periodEnd: '2026-10-20',
    createdBy: 'u1',
    createdAt: '2026-10-20T03:00:00Z',
    doneRate: 0,
    attentionCount: 0,
  }

  it('경로 — 목록은 프로젝트 아래, 읽기 · 지우기는 /reports/{id}', async () => {
    const fake = serve(new Response(JSON.stringify([]), { status: 200 }))
    await fetchReports('p 1')
    await fetchReport('r1').catch(() => {})
    await deleteReport('r1').catch(() => {})
    expect(fake.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['GET', '/api/projects/p%201/reports'],
      ['GET', '/api/reports/r1'],
      ['DELETE', '/api/reports/r1'],
    ])
  })

  it('POST 는 본문 없이, facts · delta · done 을 읽는다', async () => {
    const fake = serve(
      streamOf(
        sse({ type: 'facts', facts }) +
          sse({ type: 'delta', text: '한 줄 총평' }) +
          sse({ type: 'done', report: item, refs: [{ kind: 'task', id: 'k20' }] }),
      ),
    )
    const { events, error } = await read(streamCreateReport('p1', new AbortController().signal))
    expect(error).toBeNull()
    expect(fake.mock.calls[0][0]).toBe('/api/projects/p1/reports')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: undefined })
    expect(events).toEqual([
      { type: 'facts', facts },
      { type: 'delta', text: '한 줄 총평' },
      { type: 'done', report: item, refs: [{ kind: 'task', id: 'k20' }] },
    ])
  })

  it('스트림 중 error 는 그 code 의 ApiError, done 없이 끝나면 끊긴 것', async () => {
    serve(
      streamOf(
        sse({ type: 'facts', facts }) +
          sse({ type: 'error', code: 'CHAT_REFUSED', message: '쓸 수 없습니다.' }),
      ),
    )
    const refused = await read(streamCreateReport('p1', new AbortController().signal))
    expect(refused.events.map((e) => e.type)).toEqual(['facts'])
    expect(refused.error).toMatchObject({ status: 200, code: 'CHAT_REFUSED' })

    serve(streamOf(sse({ type: 'facts', facts }) + sse({ type: 'delta', text: '반쯤' })))
    const cut = await read(streamCreateReport('p1', new AbortController().signal))
    expect(isUnreachable(cut.error)).toBe(true)
  })

  it('모양이 아닌 facts 는 깨진 스트림, 열리기 전 429 는 code 로', async () => {
    serve(streamOf(`event: facts\ndata: ${JSON.stringify({ type: 'facts', facts: {} })}\n\n`))
    expect(
      isUnreachable((await read(streamCreateReport('p1', new AbortController().signal))).error),
    ).toBe(true)

    serve(
      new Response(JSON.stringify({ code: 'CHAT_RATE_LIMITED', message: '잠시 뒤에' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { error } = await read(streamCreateReport('p1', new AbortController().signal))
    expect(error).toMatchObject({ status: 429, code: 'CHAT_RATE_LIMITED' })
  })
})

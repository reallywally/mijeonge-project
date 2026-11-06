import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { resetMockAuth } from '@/api/mockAuth'
import { streamRiskSummary } from '@/api/risk'
import { MOCK_PASSWORD, RISK_SUMMARY_EMPTY } from '@/fixtures'
import type { ChatEvent } from '@/types/domain'

/* AI 리스크 분석 스트림 — 챗봇과 같은 SSE 모양 · 끝맺음을 따르는지 본다 (docs/api/risk.md 'AI 요약' · risk-dashboard.md) */
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function collect(stream: AsyncIterable<ChatEvent>) {
  const events: ChatEvent[] = []
  const run = (async () => {
    for await (const e of stream) events.push(e)
  })().then(
    () => null,
    (e: unknown) => e,
  )
  await vi.runAllTimersAsync()
  return { events, error: await run }
}

const textOf = (events: ChatEvent[]) =>
  events.map((e) => (e.type === 'delta' ? e.text : '')).join('')

describe('목업 갈래', () => {
  beforeEach(async () => {
    resetMockAuth()
    await login({ email: 'u1@inno-ax.com', password: MOCK_PASSWORD })
    vi.useFakeTimers()
  })

  it('답의 모양대로 흘리고, done 의 refs 는 본문의 근거 · analysisId 는 저장할 임시 분석', async () => {
    const { events, error } = await collect(
      streamRiskSummary(
        'p1',
        { agendaIds: ['t5', 't3'], taskIds: ['k20'], testIds: ['tc7'] },
        new AbortController().signal,
      ),
    )
    expect(error).toBeNull()
    const text = textOf(events)
    /* 세 종류를 섞어 점수 순 */
    expect(
      text.startsWith(
        '한 줄 총평 — 안건 2 · 작업 1 · 테스트 1건 중 가장 급한 것은 [[task:k20]] 입니다(6점 · high).',
      ),
    ).toBe(true)
    expect(text).toContain('먼저 손쓸 것\n1. [[task:k20]] — 기한 넘김 · 오래 걸림(기한 넘김 33일)')
    expect(text).toContain('2. [[agenda:t5]]')
    expect(text).toContain('4. [[test:tc7]] — 실패 그대로(10일째 실패)')
    expect(text).not.toContain('흔들리는 일')
    expect(events.at(-1)).toEqual({
      type: 'done',
      refs: [
        { kind: 'task', id: 'k20' },
        { kind: 'agenda', id: 't5' },
        { kind: 'agenda', id: 't3' },
        { kind: 'test', id: 'tc7' },
      ],
      analysisId: expect.any(String),
    })
  })

  it('흔들림 신호가 있으면 흔들리는 일 칸을 단다', async () => {
    const { events } = await collect(
      streamRiskSummary(
        'p1',
        { agendaIds: [], taskIds: ['k22'], testIds: ['tc2'] },
        new AbortController().signal,
      ),
    )
    const text = textOf(events)
    expect(text).toContain('1. [[test:tc2]] — 결과 뒤집힘(뒤집힘 2번)')
    expect(text).toContain('2. [[task:k22]] — 내용 자주 바뀜(내용 5번 바뀜)')
    expect(text).toContain('흔들리는 일\n- [[test:tc2]] [[task:k22]]')
  })

  it('agendaIds 만 넘겨도 taskIds · testIds 는 [] 로 싣는다', async () => {
    const { events, error } = await collect(
      streamRiskSummary('p1', { agendaIds: ['t5'] } as never, new AbortController().signal),
    )
    expect(error).toBeNull()
    expect(textOf(events)).toContain('안건 1 · 작업 0 · 테스트 0건')
  })

  it('보고서에 없는 id 는 조용히 버리고, 거른 뒤 비면 한 줄로 끝낸다', async () => {
    const { events } = await collect(
      streamRiskSummary(
        'p1',
        { agendaIds: ['t1', 'zz'], taskIds: ['k2'], testIds: ['tc8'] },
        new AbortController().signal,
      ),
    )
    expect(textOf(events)).toBe(RISK_SUMMARY_EMPTY)
    /* Claude 를 안 부른 것이라 남기지 않는다 — analysisId 가 없다 */
    expect(events.at(-1)).toEqual({ type: 'done', refs: [] })
  })

  it('어느 배열이든 100개를 넘으면 422', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `x${i}`)
    for (const input of [
      { agendaIds: many, taskIds: [], testIds: [] },
      { agendaIds: [], taskIds: many, testIds: [] },
      { agendaIds: [], taskIds: [], testIds: many },
    ]) {
      const { error } = await collect(streamRiskSummary('p1', input, new AbortController().signal))
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    }
  })
})

describe('서버 갈래', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  const sse = (event: ChatEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

  it('POST .../risks/summary 로 보이는 id 를 싣고 delta → done 을 낸다', async () => {
    const wire = [sse({ type: 'delta', text: '한 줄 총평' }), sse({ type: 'done', refs: [] })]
    const fake = vi.fn(
      () =>
        new Response(new TextEncoder().encode(wire.join('')), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    )
    vi.stubGlobal('fetch', fake)
    const controller = new AbortController()

    const events: ChatEvent[] = []
    for await (const e of streamRiskSummary(
      'p 1',
      { agendaIds: ['t5'], taskIds: ['k20'], testIds: ['tc3'] },
      controller.signal,
    ))
      events.push(e)

    expect(fake).toHaveBeenCalledWith('/api/projects/p%201/risks/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ agendaIds: ['t5'], taskIds: ['k20'], testIds: ['tc3'] }),
      signal: controller.signal,
    })
    expect(events).toEqual([
      { type: 'delta', text: '한 줄 총평' },
      { type: 'done', refs: [] },
    ])
  })

  it('done 의 analysisId 를 읽는다 — 없으면 싣지 않는다', async () => {
    const wire = [
      sse({ type: 'delta', text: '한 줄 총평' }),
      `event: done\ndata: ${JSON.stringify({ refs: [], analysisId: 'ra9' })}\n\n`,
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(new TextEncoder().encode(wire.join('')), { status: 200 })),
    )
    const events: ChatEvent[] = []
    for await (const e of streamRiskSummary(
      'p1',
      { agendaIds: ['t5'], taskIds: [], testIds: [] },
      new AbortController().signal,
    ))
      events.push(e)
    expect(events.at(-1)).toEqual({ type: 'done', refs: [], analysisId: 'ra9' })
  })

  it('스트림 중 error 는 챗봇과 같은 ApiError 다', async () => {
    const wire = sse({
      type: 'error',
      code: 'CHAT_UNAVAILABLE',
      message: '답을 만들지 못했습니다.',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(new TextEncoder().encode(wire), { status: 200 })),
    )
    const error = await (async () => {
      for await (const e of streamRiskSummary(
        'p1',
        { agendaIds: ['t5'], taskIds: [], testIds: [] },
        new AbortController().signal,
      ))
        void e
    })().catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 200, code: 'CHAT_UNAVAILABLE' })
  })
})

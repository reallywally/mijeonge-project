import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { resetMockAuth } from '@/api/mockAuth'
import { streamRiskSummary } from '@/api/risk'
import { MOCK_PASSWORD, RISK_SUMMARY_EMPTY } from '@/fixtures'
import type { ChatEvent } from '@/types/domain'

/* AI 요약 스트림 — 챗봇과 같은 SSE 모양 · 끝맺음을 따르는지 본다 (docs/api/risk.md 'AI 요약') */
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
    await login({ email: 'u1@innoflow.local', password: MOCK_PASSWORD })
    vi.useFakeTimers()
  })

  it('답의 모양대로 흘리고, done 의 refs 는 본문의 근거다', async () => {
    const { events, error } = await collect(
      streamRiskSummary(
        'p1',
        { threadIds: ['t5', 't3'], taskIds: ['k22'] },
        new AbortController().signal,
      ),
    )
    expect(error).toBeNull()
    const text = textOf(events)
    expect(text.startsWith('한 줄 총평 — 지금 가장 큰 병목은 [[thread:t5]]')).toBe(true)
    expect(text).toContain('먼저 정할 것\n1. [[thread:t5]]')
    expect(text).toContain('바로 풀 수 있는 것\n- [[task:k22]]')
    expect(events.at(-1)).toEqual({
      type: 'done',
      refs: [
        { kind: 'thread', id: 't5' },
        { kind: 'task', id: 'k18' },
        { kind: 'thread', id: 't3' },
        { kind: 'task', id: 'k22' },
      ],
    })
  })

  it('보고서에 없는 id 는 조용히 버리고, 거른 뒤 비면 한 줄로 끝낸다', async () => {
    const { events } = await collect(
      streamRiskSummary(
        'p1',
        { threadIds: ['t1', 'zz'], taskIds: ['k1'] },
        new AbortController().signal,
      ),
    )
    expect(textOf(events)).toBe(RISK_SUMMARY_EMPTY)
    expect(events.at(-1)).toEqual({ type: 'done', refs: [] })
  })

  it('배열이 100개를 넘으면 422', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `x${i}`)
    const { error } = await collect(
      streamRiskSummary('p1', { threadIds: many, taskIds: [] }, new AbortController().signal),
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
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
      { threadIds: ['t5'], taskIds: ['k22'] },
      controller.signal,
    ))
      events.push(e)

    expect(fake).toHaveBeenCalledWith('/api/projects/p%201/risks/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ threadIds: ['t5'], taskIds: ['k22'] }),
      signal: controller.signal,
    })
    expect(events).toEqual([
      { type: 'delta', text: '한 줄 총평' },
      { type: 'done', refs: [] },
    ])
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
        { threadIds: ['t5'], taskIds: [] },
        new AbortController().signal,
      ))
        void e
    })().catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 200, code: 'CHAT_UNAVAILABLE' })
  })
})

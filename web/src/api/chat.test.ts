import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isUnreachable } from '@/api/client'
import { isAbort, settle, streamChat } from '@/api/chat'
import { CHAT_MOCK_ERROR_KEYWORD, chatFallback, chatReplies } from '@/fixtures/chat'
import type { ChatEvent } from '@/types/domain'

/* 목업 스트림이 계약의 ChatEvent 모양 · 순서 그대로 흐르는지 본다 — 7-2 에서 서버 스트림으로 갈아 끼운다 */
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const ask = (text: string) => [{ role: 'user' as const, text }]

/** 타이머를 돌려 가며 스트림을 끝까지 모은다. 던지면 그 오류를 같이 낸다 */
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

async function* from(events: ChatEvent[]) {
  for (const e of events) yield e
}

describe('목업 스트림', () => {
  it('tool → delta 조각들 → done 순서로 흐르고, 조각을 이으면 답 전체다', async () => {
    const { events, error } = await collect(
      streamChat('p1', ask('서버 OS 뭐로 정했지?'), new AbortController().signal),
    )
    const os = chatReplies[0]

    expect(error).toBeNull()
    expect(events.map((e) => e.type)).toEqual([
      ...os.tools.map(() => 'tool'),
      ...events.filter((e) => e.type === 'delta').map(() => 'delta'),
      'done',
    ])
    expect(events[0]).toEqual({ type: 'tool', ...os.tools[0] })
    const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('')
    expect(text).toBe(os.answer)
    expect(events.at(-1)).toEqual({ type: 'done', refs: [] })
  })

  it('모르는 질문은 못 찾았다고 답한다', async () => {
    const { events } = await collect(
      streamChat('p1', ask('점심 메뉴'), new AbortController().signal),
    )
    const text = events.map((e) => (e.type === 'delta' ? e.text : '')).join('')
    expect(text).toBe(chatFallback.answer)
  })

  it('마지막 user 질문으로 답을 고른다', async () => {
    const messages = [
      { role: 'user' as const, text: '서버 OS 뭐로 정했지?' },
      { role: 'assistant' as const, text: '우분투' },
      { role: 'user' as const, text: '막힌 작업 알려줘' },
    ]
    const { events } = await collect(streamChat('p1', messages, new AbortController().signal))
    expect(events[0]).toMatchObject({ type: 'tool', label: '막힌 작업 찾는 중' })
  })

  it('스트림 중 error 이벤트는 status 200 의 ApiError 로 던진다', async () => {
    const { events, error } = await collect(
      streamChat('p1', ask(CHAT_MOCK_ERROR_KEYWORD), new AbortController().signal),
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, code: 'CHAT_UNAVAILABLE' })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('멈추면 그 자리에서 AbortError 로 끝나고 더 흐르지 않는다', async () => {
    const controller = new AbortController()
    const events: ChatEvent[] = []
    const run = (async () => {
      for await (const e of streamChat('p1', ask('서버 OS 뭐로 정했지?'), controller.signal)) {
        events.push(e)
        if (e.type === 'delta') controller.abort()
      }
    })().catch((e: unknown) => e)

    await vi.runAllTimersAsync()
    const error = await run
    expect(isAbort(error)).toBe(true)
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('서버 모드는 7-2 전까지 붙지 않았다는 오류다', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false')
    const { error } = await collect(streamChat('p1', ask('OS'), new AbortController().signal))
    expect(error).toMatchObject({ code: 'CHAT_UNAVAILABLE' })
  })
})

describe('스트림 끝맺음', () => {
  it('done 뒤에 온 것은 버린다', async () => {
    const { events } = await collect(
      settle(
        from([
          { type: 'done', refs: [] },
          { type: 'delta', text: '뒤' },
        ]),
      ),
    )
    expect(events).toEqual([{ type: 'done', refs: [] }])
  })

  it('done 도 error 도 없이 끝나면 끊긴 것이다', async () => {
    const { error } = await collect(settle(from([{ type: 'delta', text: '반쯤' }])))
    expect(isUnreachable(error)).toBe(true)
  })
})

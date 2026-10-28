import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isUnreachable } from '@/api/client'
import { isAbort, parseSse, streamChat, toChatEvent } from '@/api/chat'
import type { ChatEvent, ProposedTask } from '@/types/domain'

/* 서버 갈래 — fetch 를 가짜로 바꿔 SSE 바이트를 흘린다. 실제 서버 · Claude 는 부르지 않는다 */
beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK', 'false')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const encoder = new TextEncoder()
const ask = [{ role: 'user' as const, text: '서버 OS 뭐로 하기로 했지?' }]

/** 서버(server/app/api/chat.py 의 _sse)가 쓰는 모양 그대로 — event 줄, type 을 같이 실은 한 줄 JSON data, 빈 줄 */
const sse = (event: ChatEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

const TOOL: ChatEvent = { type: 'tool', name: 'search_threads', label: '"OS" 안건 찾는 중' }
const DONE: ChatEvent = { type: 'done', refs: [{ kind: 'thread', id: 't1' }] }
const deltas = (...texts: string[]) => texts.map((text) => sse({ type: 'delta', text }))

/** 조각마다 한 번씩 pull 에 응한다. open 이면 다 내고도 닫지 않고 기다린다 — 멈추기를 보려고 */
function body(parts: (string | Uint8Array)[], { open = false, fail = false } = {}) {
  const cancel = vi.fn()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < parts.length) {
        const part = parts[i++]
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part)
      } else if (fail) controller.error(new TypeError('network'))
      else if (!open) controller.close()
      else return new Promise<void>(() => undefined)
    },
    cancel,
  })
  return { stream, cancel }
}

function serve(res: Response | ((signal: AbortSignal) => Promise<Response>)) {
  const fake = vi.fn((_url: string, init: RequestInit) =>
    typeof res === 'function' ? res(init.signal as AbortSignal) : Promise.resolve(res),
  )
  vi.stubGlobal('fetch', fake)
  return fake
}

const streamOk = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

async function collect(stream: AsyncIterable<ChatEvent>) {
  const events: ChatEvent[] = []
  try {
    for await (const e of stream) events.push(e)
    return { events, error: null as unknown }
  } catch (error) {
    return { events, error }
  }
}

/** 바이트 배열을 n 바이트씩 — 한글(3바이트)이 조각 사이에서 잘린다 */
function split(text: string, n: number) {
  const bytes = encoder.encode(text)
  const parts: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += n) parts.push(bytes.slice(i, i + n))
  return parts
}

async function messagesOf(parts: Uint8Array[]) {
  async function* from() {
    for (const p of parts) yield p
  }
  const out = []
  for await (const m of parseSse(from())) out.push(m)
  return out
}

describe('SSE 읽기', () => {
  const wire = sse(TOOL) + deltas('우분투로 ', '정했습니다.').join('') + sse(DONE)

  it('조각을 어디서 잘라도 같은 이벤트가 나온다 — 한 바이트씩 · 세 바이트씩 · 통째', async () => {
    const whole = await messagesOf([encoder.encode(wire)])
    expect(whole.map((m) => m.event)).toEqual(['tool', 'delta', 'delta', 'done'])
    expect(JSON.parse(whole[1].data)).toEqual({ type: 'delta', text: '우분투로 ' })

    for (const n of [1, 2, 3, 5, 7]) expect(await messagesOf(split(wire, n))).toEqual(whole)
  })

  it('줄 끝이 \\r\\n 이거나 \\r 이어도 같다 — \\r 과 \\n 이 다른 조각에 걸려도', async () => {
    const whole = await messagesOf([encoder.encode(wire)])
    const crlf = wire.replaceAll('\n', '\r\n')
    expect(await messagesOf(split(crlf, 1))).toEqual(whole)
    expect(await messagesOf(split(crlf, 4))).toEqual(whole)
    expect(await messagesOf(split(wire.replaceAll('\n', '\r'), 3))).toEqual(whole)
  })

  it(': 로 시작하는 줄 · 모르는 필드는 건너뛰고, data 여러 줄은 \\n 으로 잇는다', async () => {
    const text = ': keep-alive\n\nid: 1\nevent:delta\ndata: {"text":\ndata: "가"}\nretry: 10\n\n'
    expect(await messagesOf([encoder.encode(text)])).toEqual([
      { event: 'delta', data: '{"text":\n"가"}' },
    ])
  })

  it('빈 줄 없이 끝난 마지막 덩어리는 버린다', async () => {
    const text = sse(TOOL) + 'event: delta\ndata: {"text":"반"}'
    expect((await messagesOf([encoder.encode(text)])).map((m) => m.event)).toEqual(['tool'])
  })

  it('event 줄이 type 이다 — data 에 type 이 없어도 되고, 모르는 event 는 건너뛴다', () => {
    expect(toChatEvent({ event: 'delta', data: '{"text":"가"}' })).toEqual({
      type: 'delta',
      text: '가',
    })
    expect(toChatEvent({ event: 'done', data: '{}' })).toEqual({ type: 'done', refs: [] })
    expect(toChatEvent({ event: 'ping', data: '{}' })).toBeNull()
    expect(toChatEvent({ event: 'message', data: 'x' })).toBeNull()
  })

  it('아는 event 의 data 가 모양이 아니면 끊긴 것으로 본다', () => {
    expect(isUnreachable(catchOf(() => toChatEvent({ event: 'delta', data: '{"text":' })))).toBe(
      true,
    )
    expect(isUnreachable(catchOf(() => toChatEvent({ event: 'delta', data: '{"t":1}' })))).toBe(
      true,
    )
  })
})

describe('작업 초안 이벤트', () => {
  const task: ProposedTask = {
    tempId: 't1',
    parentTempId: null,
    parentId: null,
    title: '간담회 준비',
    ownerId: 'u1',
    start: '2026-10-13',
    due: null,
    priority: 'normal',
  }
  const proposalOf = (proposal: unknown) =>
    toChatEvent({ event: 'proposal', data: JSON.stringify({ type: 'proposal', proposal }) })

  it('proposal 은 계약의 칸만 옮겨 낸다 — 모르는 칸은 떼어 다음 질문에 안 실린다', () => {
    expect(
      proposalOf({
        tasks: [
          { ...task, extra: 1 },
          { ...task, tempId: 't2', parentTempId: 't1' },
        ],
      }),
    ).toEqual({
      type: 'proposal',
      proposal: { tasks: [task, { ...task, tempId: 't2', parentTempId: 't1' }] },
    })
  })

  it('초안 모양이 아니면 끊긴 것으로 본다 — 빈 목록 · 빠진 칸 · 모르는 우선순위', () => {
    for (const bad of [
      null,
      { tasks: [] },
      { tasks: [{ ...task, title: undefined }] },
      { tasks: [{ ...task, priority: 'urgent' }] },
      { tasks: [{ ...task, start: 3 }] },
    ])
      expect(isUnreachable(catchOf(() => proposalOf(bad)))).toBe(true)
  })

  it('스트림에서 done 앞에 온 proposal 을 그대로 낸다', async () => {
    const PROPOSAL: ChatEvent = {
      type: 'proposal',
      proposal: { tasks: [task] },
    }
    const { stream } = body([
      sse({ type: 'tool', name: 'propose_tasks', label: '작업 초안 만드는 중' }),
      sse(PROPOSAL),
      ...deltas('아래처럼 등록할까요?'),
      sse(DONE),
    ])
    serve(streamOk(stream))
    const { events, error } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(error).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['tool', 'proposal', 'delta', 'done'])
    expect(events[1]).toEqual(PROPOSAL)
  })
})

function catchOf(fn: () => unknown) {
  try {
    fn()
    return null
  } catch (e) {
    return e
  }
}

describe('서버 스트림', () => {
  it('POST 로 대화를 싣고, tool → delta → done 을 그대로 낸다', async () => {
    const { stream } = body([
      sse(TOOL),
      ...deltas('우분투로 ', '정했습니다. [[thread:t1]]'),
      sse(DONE),
    ])
    const fake = serve(streamOk(stream))
    const controller = new AbortController()

    const { events, error } = await collect(streamChat('p 1', ask, controller.signal))

    expect(error).toBeNull()
    expect(fake).toHaveBeenCalledWith('/api/projects/p%201/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: ask }),
      signal: controller.signal,
    })
    expect(events).toEqual([
      TOOL,
      { type: 'delta', text: '우분투로 ' },
      { type: 'delta', text: '정했습니다. [[thread:t1]]' },
      DONE,
    ])
  })

  it('조각이 이벤트 중간에서 잘려 와도 같다', async () => {
    const wire = sse(TOOL) + deltas('우분투 최신 버전').join('') + sse(DONE)
    serve(streamOk(body(split(wire.replaceAll('\n', '\r\n'), 3)).stream))
    const { events, error } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(error).toBeNull()
    expect(events).toEqual([TOOL, { type: 'delta', text: '우분투 최신 버전' }, DONE])
  })

  it('done 에서 멈추고 연결을 닫는다', async () => {
    const { stream, cancel } = body([sse(DONE), ...deltas('뒤')], { open: true })
    serve(streamOk(stream))
    const { events } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(events).toEqual([DONE])
    expect(cancel).toHaveBeenCalled()
  })

  it.each([
    [404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.'],
    [422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.'],
    [429, 'CHAT_RATE_LIMITED', '질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요.'],
    [503, 'CHAT_UNAVAILABLE', 'AI 챗봇이 아직 설정되지 않았습니다.'],
  ])('열리기 전 %i 는 본문의 code 그대로 ApiError 다', async (status, code, message) => {
    serve(json(status, { code, message }))
    const { events, error } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(events).toEqual([])
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code, message })
  })

  it('모양이 아닌 5xx 와 닿지 못한 fetch 는 SERVER_UNREACHABLE 이다', async () => {
    serve(new Response('<html>Bad Gateway</html>', { status: 502 }))
    let { error } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(isUnreachable(error)).toBe(true)
    expect(error).toMatchObject({ status: 502 })

    serve(() => Promise.reject(new TypeError('Failed to fetch')))
    ;({ error } = await collect(streamChat('p1', ask, new AbortController().signal)))
    expect(isUnreachable(error)).toBe(true)
    expect(error).toMatchObject({ status: 0 })
  })

  it.each(['CHAT_REFUSED', 'INTERNAL_ERROR', 'CHAT_RATE_LIMITED', 'CHAT_UNAVAILABLE'])(
    '스트림 중 error 이벤트(%s)는 status 200 의 ApiError 로 던지고, 앞의 조각은 이미 나갔다',
    async (code) => {
      const message = '이 질문에는 답할 수 없습니다.'
      serve(streamOk(body([...deltas('반쯤'), sse({ type: 'error', code, message })]).stream))
      const { events, error } = await collect(streamChat('p1', ask, new AbortController().signal))
      expect(events).toEqual([{ type: 'delta', text: '반쯤' }])
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 200, code, message })
    },
  )

  it('done 도 error 도 없이 닫히거나 읽다가 끊기면 SERVER_UNREACHABLE 이다', async () => {
    serve(streamOk(body(deltas('반쯤')).stream))
    let { events, error } = await collect(streamChat('p1', ask, new AbortController().signal))
    expect(events).toHaveLength(1)
    expect(isUnreachable(error)).toBe(true)
    expect(error).toMatchObject({ status: 200 })

    serve(streamOk(body(deltas('반쯤'), { fail: true }).stream))
    ;({ events, error } = await collect(streamChat('p1', ask, new AbortController().signal)))
    expect(events).toHaveLength(1)
    expect(isUnreachable(error)).toBe(true)
  })

  it('받는 중에 멈추면 AbortError 로 끝나고 연결을 닫는다', async () => {
    const { stream, cancel } = body([sse(TOOL), ...deltas('우분투')], { open: true })
    serve(streamOk(stream))
    const controller = new AbortController()
    const events: ChatEvent[] = []

    const error = await (async () => {
      for await (const e of streamChat('p1', ask, controller.signal)) {
        events.push(e)
        if (e.type === 'delta') setTimeout(() => controller.abort(), 0)
      }
    })().catch((e: unknown) => e)

    expect(isAbort(error)).toBe(true)
    expect(events).toEqual([TOOL, { type: 'delta', text: '우분투' }])
    expect(cancel).toHaveBeenCalled()
  })

  it('응답이 오기 전에 멈춰도 AbortError 다 — 닿지 못한 것으로 보지 않는다', async () => {
    serve(
      (signal) =>
        new Promise<Response>((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    )
    const controller = new AbortController()
    const run = collect(streamChat('p1', ask, controller.signal))
    controller.abort()
    expect(isAbort((await run).error)).toBe(true)
  })
})

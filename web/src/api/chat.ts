import { ApiError, errorOf, id, unreachable } from '@/api/client'
import { isMockMode } from '@/api/mode'
import { CHAT_MOCK_ERROR_KEYWORD, chatFallback, chatMockError, chatReplies } from '@/fixtures/chat'
import { collectRefs } from '@/lib/chat'
import type {
  ChatEvent,
  ChatInput,
  ChatMessage,
  ChatRef,
  ProposedTask,
  TaskProposal,
} from '@/types/domain'

/** 목업 스트림이 조각 사이에 쉬는 시간 — 받는 중 · 멈추기를 눈으로 보려고 늦춘다 */
export const MOCK_STEP_MS = 40
const CHUNK = 4

/** fetch 가 끊길 때 내는 것과 같은 모양 — 스토어가 멈춤을 한 가지로만 알아보게 */
const aborted = () => new DOMException('요청을 멈췄습니다.', 'AbortError')

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted())
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(aborted())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 서버가 흘릴 것과 같은 순서로 흘린다 — tool → proposal → delta 조각들 → done (오류 낱말이면 error) */
async function* mockEvents(
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const question = messages.at(-1)?.text ?? ''
  const reply =
    chatReplies.find((r) => r.keywords.some((k) => question.includes(k))) ?? chatFallback

  for (const tool of reply.tools) {
    await sleep(MOCK_STEP_MS * 3, signal)
    yield { type: 'tool', ...tool }
  }
  if (reply.proposal) yield { type: 'proposal', proposal: structuredClone(reply.proposal) }

  const chars = Array.from(reply.answer)
  for (let i = 0; i < chars.length; i += CHUNK) {
    if (question.includes(CHAT_MOCK_ERROR_KEYWORD) && i >= CHUNK * 3) {
      yield { type: 'error', ...chatMockError }
      return
    }
    await sleep(MOCK_STEP_MS, signal)
    yield { type: 'delta', text: chars.slice(i, i + CHUNK).join('') }
  }

  await sleep(MOCK_STEP_MS, signal)
  yield { type: 'done', refs: collectRefs(reply.answer) }
}

/**
 * 계약의 끝맺음을 지킨다 — error 이벤트는 ApiError 로 던지고, done 에서 멈추고,
 * done 도 error 도 없이 끝나면 끊긴 것(SERVER_UNREACHABLE)으로 본다. 서버 스트림(7-2)도 이걸 거친다.
 */
export async function* settle(events: AsyncIterable<ChatEvent>, status = 200) {
  for await (const event of events) {
    if (event.type === 'error')
      /* 스트림이 열린 뒤라 status 는 200 이다 — 화면은 code 로만 가른다 */
      throw new ApiError(status, { code: event.code, message: event.message })
    yield event
    if (event.type === 'done') return
  }
  throw unreachable(status)
}

/** SSE 한 덩어리 — event 줄 하나와 data 줄들(여럿이면 \n 으로 잇는다) */
export interface SseMessage {
  event: string
  data: string
}

/**
 * 바이트 조각을 SSE 덩어리로. 조각 경계에서 줄 · 한글 글자가 잘려도, 줄 끝이 \r\n · \r 이어도 맞게 읽는다.
 * 빈 줄 없이 끝난 마지막 덩어리는 버린다 — 다 오지 않은 것이다(SSE 규칙).
 */
export async function* parseSse(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []

  function* drain(final: boolean): Generator<SseMessage> {
    for (;;) {
      const i = buffer.search(/[\r\n]/)
      if (i < 0) return
      /* \r 로 조각이 끝나면 다음 조각의 \n 과 한 줄 끝일 수 있어 기다린다 */
      if (buffer[i] === '\r' && i === buffer.length - 1 && !final) return
      const line = buffer.slice(0, i)
      buffer = buffer.slice(buffer[i] === '\r' && buffer[i + 1] === '\n' ? i + 2 : i + 1)

      if (line === '') {
        if (data.length > 0) yield { event: event || 'message', data: data.join('\n') }
        event = ''
        data = []
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    yield* drain(false)
  }
  buffer += decoder.decode()
  yield* drain(true)
}

/** 응답 본문을 조각으로. 멈추면 읽던 것을 끊고 AbortError 로 끝낸다 — fetch 구현이 끊김을 어떻게 내든 같게 */
async function* chunksOf(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader()
  const onAbort = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) throw aborted()
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch {
        if (signal.aborted) throw aborted()
        throw unreachable(200)
      }
      if (signal.aborted) throw aborted()
      if (result.done) return
      yield result.value
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    /* done 에서 일찍 멈춰도 연결을 닫는다 */
    void reader.cancel().catch(() => undefined)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isDayOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

/** 초안 한 항목. 아는 칸만 옮긴다 — 다음 질문에 그대로 돌려보내므로 모르는 칸을 싣지 않는다 */
function toProposedTask(v: unknown): ProposedTask | null {
  if (!isRecord(v)) return null
  const { tempId, parentTempId, title, ownerId, start, due, priority } = v
  /* parentId 는 나중에 늘어난 칸이다 — 없으면 null 로 본다 */
  const parentId = v.parentId ?? null
  if (typeof tempId !== 'string' || typeof title !== 'string') return null
  if (parentTempId !== null && typeof parentTempId !== 'string') return null
  if (parentId !== null && typeof parentId !== 'string') return null
  if (ownerId !== null && typeof ownerId !== 'string') return null
  if (!isDayOrNull(start) || !isDayOrNull(due)) return null
  if (priority !== 'low' && priority !== 'normal' && priority !== 'high') return null
  return { tempId, parentTempId, parentId, title, ownerId, start, due, priority }
}

function toProposal(v: unknown): TaskProposal | null {
  if (!isRecord(v) || !Array.isArray(v.tasks) || v.tasks.length === 0) return null
  const tasks = v.tasks.map(toProposedTask)
  return tasks.every((t): t is ProposedTask => t !== null) ? { tasks } : null
}

/** event 줄이 type 이다. 모르는 event 는 건너뛰고(null), 아는 event 의 data 가 모양이 아니면 깨진 스트림이다 */
export function toChatEvent({ event, data }: SseMessage, status = 200): ChatEvent | null {
  if (!['delta', 'tool', 'proposal', 'done', 'error'].includes(event)) return null
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    throw unreachable(status)
  }
  if (isRecord(body)) {
    if (event === 'delta' && typeof body.text === 'string')
      return { type: 'delta', text: body.text }
    if (event === 'tool' && typeof body.label === 'string')
      return {
        type: 'tool',
        name: body.name as Extract<ChatEvent, { type: 'tool' }>['name'],
        label: body.label,
      }
    if (event === 'proposal') {
      const proposal = toProposal(body.proposal)
      if (proposal) return { type: 'proposal', proposal }
    }
    if (event === 'done')
      return { type: 'done', refs: Array.isArray(body.refs) ? (body.refs as ChatRef[]) : [] }
    if (event === 'error' && typeof body.code === 'string' && typeof body.message === 'string')
      return { type: 'error', code: body.code, message: body.message }
  }
  throw unreachable(status)
}

/**
 * JSON 을 POST 하고 SSE 를 ChatEvent 로 읽는다. 챗봇과 리스크 AI 요약(api/risk.ts)이 같은 스트림 모양이라 같이 쓴다.
 * 끝맺음 판정은 하지 않는다 — settle 을 거친다
 */
export async function* postSse(
  path: string,
  input: unknown,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    })
  } catch {
    if (signal.aborted) throw aborted()
    throw unreachable(0)
  }

  /* 열리기 전 실패는 request 와 같은 판정 — 404 · 422 · 429 · 503 은 code 로, 모양 아닌 5xx 는 SERVER_UNREACHABLE */
  if (!res.ok) {
    const error = await errorOf(res)
    if (signal.aborted) throw aborted()
    throw error
  }
  if (!res.body) throw unreachable(res.status)

  for await (const message of parseSse(chunksOf(res.body, signal))) {
    const event = toChatEvent(message, res.status)
    if (event) yield event
  }
}

/** 목업 갈래가 정해 둔 글을 서버처럼 흘린다 — delta 조각들 → done */
export async function* mockDeltas(
  text: string,
  signal: AbortSignal,
  refs: ChatRef[] = [],
): AsyncGenerator<ChatEvent> {
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i += CHUNK) {
    await sleep(MOCK_STEP_MS, signal)
    yield { type: 'delta', text: chars.slice(i, i + CHUNK).join('') }
  }
  await sleep(MOCK_STEP_MS, signal)
  yield { type: 'done', refs }
}

function serverEvents(projectId: string, messages: ChatMessage[], signal: AbortSignal) {
  const input: ChatInput = { messages }
  return postSse(`/projects/${id(projectId)}/chat`, input, signal)
}

/** 질문을 보내고 ChatEvent 를 하나씩 낸다. 멈추면 AbortError(DOMException)로 끝난다 */
export async function* streamChat(
  projectId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  if (isMockMode()) yield* settle(mockEvents(messages, signal))
  else yield* settle(serverEvents(projectId, messages, signal))
}

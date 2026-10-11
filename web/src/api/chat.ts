import { ApiError, unreachable } from '@/api/client'
import { isMockMode } from '@/api/mode'
import { CHAT_MOCK_ERROR_KEYWORD, chatFallback, chatMockError, chatReplies } from '@/fixtures/chat'
import type { ChatEvent, ChatMessage } from '@/types/domain'

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

/** 서버가 흘릴 것과 같은 순서로 흘린다 — tool → delta 조각들 → done (오류 낱말이면 error) */
async function* mockEvents(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<ChatEvent> {
  const question = messages.at(-1)?.text ?? ''
  const reply = chatReplies.find((r) => r.keywords.some((k) => question.includes(k))) ?? chatFallback

  for (const tool of reply.tools) {
    await sleep(MOCK_STEP_MS * 3, signal)
    yield { type: 'tool', ...tool }
  }

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
  yield { type: 'done', refs: [] }
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

/**
 * 질문을 보내고 ChatEvent 를 하나씩 낸다. 멈추면 AbortError(DOMException)로 끝난다.
 * 서버 연결은 7-2 — 그전까지 서버 모드에서는 붙지 않았다는 오류를 낸다.
 */
export async function* streamChat(
  projectId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  if (!isMockMode()) {
    void projectId
    throw new ApiError(0, {
      code: 'CHAT_UNAVAILABLE',
      message: '챗봇은 아직 서버에 붙지 않았습니다. 목업 모드에서만 답합니다.',
    })
  }
  yield* settle(mockEvents(messages, signal))
}

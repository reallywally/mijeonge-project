import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { chatErrorText, MAX_CHAT_MESSAGES, toChatMessages } from '@/lib/chat'
import type { ChatLine } from '@/types/domain'

let seq = 0
const l = (role: ChatLine['role'], text: string, status: ChatLine['status'] = 'done'): ChatLine => {
  seq += 1
  return { id: `l${seq}`, role, text, status, tool: '', error: '' }
}

describe('다음 질문에 실을 대화', () => {
  it('빈 대화면 질문 하나다', () => {
    expect(toChatMessages([], '안녕')).toEqual([{ role: 'user', text: '안녕' }])
  })

  it('done 으로 끝난 턴만 싣고, 실패 · 멈춘 턴은 user 까지 뺀다', () => {
    const lines = [
      l('user', 'a'),
      l('assistant', 'A'),
      l('user', 'b'),
      l('assistant', '', 'error'),
      l('user', 'c'),
      l('assistant', '반쯤', 'stopped'),
    ]
    expect(toChatMessages(lines, 'd')).toEqual([
      { role: 'user', text: 'a' },
      { role: 'assistant', text: 'A' },
      { role: 'user', text: 'd' },
    ])
  })

  it('넘치면 오래된 것부터 버리고 첫 줄은 user 다', () => {
    const lines = Array.from({ length: 15 }, (_, i) => [
      l('user', `q${i}`),
      l('assistant', `a${i}`),
    ]).flat()
    const messages = toChatMessages(lines, '마지막')

    expect(messages.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES)
    expect(messages[0]).toEqual({ role: 'user', text: 'q6' })
    expect(messages.at(-1)).toEqual({ role: 'user', text: '마지막' })
  })
})

describe('챗봇 오류 문구', () => {
  const e = (status: number, code: string, message = '') => new ApiError(status, { code, message })

  it('챗봇 code 는 서버 문구를 그대로 쓰고, 비었으면 정해 둔 말로 채운다', () => {
    expect(chatErrorText(e(429, 'CHAT_RATE_LIMITED', '질문이 너무 잦습니다.'))).toBe(
      '질문이 너무 잦습니다.',
    )
    expect(chatErrorText(e(200, 'CHAT_REFUSED'))).toBe(
      '이 질문에는 답할 수 없습니다. 질문을 바꿔 다시 물어 주세요.',
    )
    expect(chatErrorText(e(503, 'CHAT_UNAVAILABLE'))).toContain('응답하지 않습니다')
  })

  it('끊김은 열리기 전인지 받는 중인지로 말을 가른다', () => {
    expect(chatErrorText(e(0, 'SERVER_UNREACHABLE', '서버에 연결할 수 없습니다.'))).toContain(
      '연결할 수 없습니다',
    )
    expect(chatErrorText(e(200, 'SERVER_UNREACHABLE', '서버에 연결할 수 없습니다.'))).toContain(
      '끊겼습니다',
    )
  })

  it('422 는 공통 문구 대신 무엇이 길었는지 말한다', () => {
    expect(chatErrorText(e(422, 'VALIDATION_ERROR', '입력값이 올바르지 않습니다.'))).toContain(
      '너무 길어',
    )
  })
})

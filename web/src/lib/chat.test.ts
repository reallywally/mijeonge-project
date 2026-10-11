import { describe, expect, it } from 'vitest'
import { MAX_CHAT_MESSAGES, toChatMessages } from '@/lib/chat'
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

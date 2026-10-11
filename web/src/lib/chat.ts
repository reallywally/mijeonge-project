import type { ChatLine, ChatMessage } from '@/types/domain'

/** 계약의 messages 상한 (API.md '## AI 챗봇') */
export const MAX_CHAT_MESSAGES = 20

/**
 * 다음 질문에 실어 보낼 대화. done 으로 끝난 턴(user + assistant)만 싣는다 — 실패 · 멈춘 턴을 실으면
 * 빈 assistant(422)나 user 가 둘 잇따르는 일이 생긴다. 넘치면 오래된 것부터 버리고 첫 줄이 user 가 되게 자른다.
 */
export function toChatMessages(lines: ChatLine[], question: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let i = 0; i < lines.length - 1; i += 1) {
    const ask = lines[i]
    const answer = lines[i + 1]
    if (ask.role === 'user' && answer.role === 'assistant' && answer.status === 'done') {
      messages.push({ role: 'user', text: ask.text }, { role: 'assistant', text: answer.text })
      i += 1
    }
  }
  messages.push({ role: 'user', text: question })

  const kept = messages.slice(-MAX_CHAT_MESSAGES)
  while (kept[0]?.role !== 'user') kept.shift()
  return kept
}

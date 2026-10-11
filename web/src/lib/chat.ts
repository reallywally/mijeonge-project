import type { ApiError } from '@/api/client'
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

/* 서버의 챗봇 message 는 사람이 읽으라고 쓴 한국어 한 줄이라 그대로 띄운다. 비었을 때만 이것을 쓴다 */
const CHAT_ERROR_FALLBACK: Record<string, string> = {
  CHAT_UNAVAILABLE: 'AI 가 지금 응답하지 않습니다. 잠시 뒤에 다시 물어 주세요.',
  CHAT_RATE_LIMITED: '질문이 너무 잦습니다. 잠시 뒤에 다시 물어 주세요.',
  CHAT_REFUSED: '이 질문에는 답할 수 없습니다. 질문을 바꿔 다시 물어 주세요.',
  INTERNAL_ERROR: '서버에서 오류가 발생했습니다.',
}

/** 답 줄에 달 오류 한 줄. 화면은 status 가 아니라 code 로 가른다 — 스트림 중 오류는 status 가 200 이다 */
export function chatErrorText(error: ApiError): string {
  switch (error.code) {
    /* 공통 문구('입력값이 올바르지 않습니다.')로는 무엇을 고칠지 모른다. 질문 · 앞선 답의 길이 말고는 화면이 막아 둔다 */
    case 'VALIDATION_ERROR':
      return '질문이나 앞선 답이 너무 길어 보내지 못했습니다. 질문을 줄이거나 창을 닫았다 열어 다시 물어 주세요.'
    case 'SERVER_UNREACHABLE':
      return error.status === 200
        ? '답을 받다가 연결이 끊겼습니다. 다시 물어 주세요.'
        : '서버에 연결할 수 없습니다. 잠시 뒤에 다시 물어 주세요.'
    default:
      return error.message || CHAT_ERROR_FALLBACK[error.code] || '답을 받지 못했습니다.'
  }
}

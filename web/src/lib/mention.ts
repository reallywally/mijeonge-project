import type { Task } from '@/types/domain'

/*
 * 챗봇 질문 속 작업 언급 — 입력칸에서 '@' 를 치면 작업을 골라 '@HW-4' 로 넣는다.
 * 서버가 질문의 '@HW-4' 를 그 프로젝트의 작업으로 찾아 Claude 에게 넘긴다 (server/app/services/chat.py).
 */

export const MENTION_LIMIT = 8

export interface MentionQuery {
  /** '@' 의 자리 */
  start: number
  /** '@' 뒤에 친 글 — 키나 제목 일부 */
  query: string
}

/* 앞이 영숫자 · '.' · '@' 면 이메일 같은 것이라 언급으로 보지 않는다 — 서버의 MENTION_PATTERN 과 같다 */
const QUERY_BEFORE_CARET = /(?:^|[^A-Za-z0-9_.@])@([^\s@]{0,30})$/

/** 커서 바로 앞이 '@…' 를 치는 중이면 그 자리와 친 글. 아니면 null */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = QUERY_BEFORE_CARET.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1]
  return { start: caret - query.length - 1, query }
}

/** 키가 친 글로 시작하는 것을 먼저, 그다음 키 · 제목에 친 글이 든 것. 각각 원래 순서대로 */
export function mentionCandidates(tasks: Task[], query: string, limit = MENTION_LIMIT): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return tasks.slice(0, limit)
  const byKey: Task[] = []
  const rest: Task[] = []
  for (const t of tasks) {
    const key = t.key.toLowerCase()
    if (key.startsWith(q)) byKey.push(t)
    else if (key.includes(q) || t.title.toLowerCase().includes(q)) rest.push(t)
  }
  return [...byKey, ...rest].slice(0, limit)
}

/** '@…' 를 '@HW-4 ' 로 바꾼 글과 그 뒤 커서 자리 */
export function insertMention(
  text: string,
  at: MentionQuery,
  key: string,
): { text: string; caret: number } {
  const end = at.start + 1 + at.query.length
  const after = text.slice(end)
  const token = `@${key}${after.startsWith(' ') ? '' : ' '}`
  return { text: text.slice(0, at.start) + token + after, caret: at.start + token.length }
}

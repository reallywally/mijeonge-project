import { taskStatusLabel } from '@/lib/task'
import { testStatusLabel } from '@/lib/testcase'
import type { Task, TestCase } from '@/types/domain'

/*
 * 챗봇 질문 속 작업 · 테스트 언급 — 입력칸에서 '@' 를 치면 골라 '@HW-4' · '@HW-T3' 로 넣는다.
 * 서버가 질문의 '@키' 를 그 프로젝트의 작업 · 테스트로 찾아 Claude 에게 넘긴다 (server/app/services/chat.py).
 */

export const MENTION_LIMIT = 8

export interface MentionQuery {
  /** '@' 의 자리 */
  start: number
  /** '@' 뒤에 친 글 — 키나 제목 일부 */
  query: string
}

/** 고르는 목록의 한 줄 — 작업 · 테스트를 한 모양으로 */
export interface MentionCandidate {
  kind: 'task' | 'test'
  id: string
  key: string
  title: string
  statusLabel: string
}

/** 작업 먼저, 그다음 테스트 — 각각 받은 순서대로 */
export function mentionItems(tasks: Task[], tests: TestCase[]): MentionCandidate[] {
  return [
    ...tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      key: t.key,
      title: t.title,
      statusLabel: taskStatusLabel(t.status),
    })),
    ...tests.map((t) => ({
      kind: 'test' as const,
      id: t.id,
      key: t.key,
      title: t.title,
      statusLabel: testStatusLabel(t.status),
    })),
  ]
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
export function mentionCandidates<T extends Pick<MentionCandidate, 'key' | 'title'>>(
  items: T[],
  query: string,
  limit = MENTION_LIMIT,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.slice(0, limit)
  const byKey: T[] = []
  const rest: T[] = []
  for (const t of items) {
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

import type { CheckRequest } from '@/types/domain'

/** 한 줄의 최대 글자 수 — 앞뒤 공백을 뗀 뒤 센다 (docs/api/check.md) */
export const CHECK_TEXT_MAX = 29
/** 한 번에 보낼 수 있는 사람 수 */
export const CHECK_RECIPIENTS_MAX = 20

/** 서버처럼 코드 포인트로 센다 — 서로게이트 쌍 하나를 두 글자로 세지 않게 */
export const checkTextLength = (text: string) => [...text.trim()].length

export function checkTextProblem(text: string): string | null {
  const n = checkTextLength(text)
  if (n === 0) return '내용을 적어 주세요.'
  if (n > CHECK_TEXT_MAX) return `내용은 ${CHECK_TEXT_MAX}자까지 적을 수 있습니다.`
  return null
}

export const isPending = (c: CheckRequest) => c.confirmedAt === null

/* 시각이 같으면 들어온 순서(seq)대로 — 한 번에 보낸 줄이 받는 사람 순서 그대로 선다 */
const bySeq = (rows: CheckRequest[]) => rows.map((row, seq) => ({ row, seq }))

/** 받은 것 — 대기 먼저(오래된 순), 그다음 확인(최근 확인 순) */
export function sortReceived(rows: CheckRequest[]): CheckRequest[] {
  return bySeq(rows)
    .sort((a, b) => {
      const pa = isPending(a.row)
      const pb = isPending(b.row)
      if (pa !== pb) return pa ? -1 : 1
      if (pa) return a.row.createdAt.localeCompare(b.row.createdAt) || a.seq - b.seq
      return b.row.confirmedAt!.localeCompare(a.row.confirmedAt!) || a.seq - b.seq
    })
    .map((x) => x.row)
}

/** 보낸 것 — 최근 순 */
export function sortSent(rows: CheckRequest[]): CheckRequest[] {
  return bySeq(rows)
    .sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt) || a.seq - b.seq)
    .map((x) => x.row)
}

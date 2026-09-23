/** 2026-03-12 → 3월 12일. 연도는 프로젝트 안에서 거의 겹치지 않아 떼어 둔다. */
export function monthDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

/** 2026-09-08 → 9/8. 표의 기간 칸처럼 좁은 자리에 쓴다. */
export function slashDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 2026-03-21T10:14 → 3월 21일 10:14. 요청 댓글처럼 같은 날 여러 번 오가는 곳에 쓴다. */
export function dayTime(iso: string) {
  const [date, time = ''] = iso.split('T')
  return time ? `${monthDay(date)} ${time.slice(0, 5)}` : monthDay(date)
}

/** 오늘 날짜를 YYYY-MM-DD 로. 목업이 만든 레코드가 쓴다. */
export function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Date → 2026-09-08. toISOString 은 UTC 라 한국 시간대에서 하루가 밀린다. */
export function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 2026-09-08 → Date. 간트가 Date 를 받는다. */
export function dayToDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 날짜를 하루 단위로 민다 */
export function shiftDays(d: Date, days: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

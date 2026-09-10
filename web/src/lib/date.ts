/** 2026-03-12 → 3월 12일. 연도는 프로젝트 안에서 거의 겹치지 않아 떼어 둔다. */
export function monthDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}월 ${Number(d)}일`
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

/* 계약(API.md 공통 규칙)에서 createdAt 은 ISO 8601 UTC 고 늘 Z 로 끝난다.
   사람이 고른 날짜(Thread.dueDate · Task.start · Task.due)만 YYYY-MM-DD 다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 2026-09-08T22:00:00Z → 2026-09-09. 날짜뿐인 문자열은 그대로 통과한다. */
export function localDay(iso: string) {
  if (!iso.endsWith('Z')) return iso.split('T')[0]
  /* 브라우저 시간대에 맡기면 UTC 로 도는 검사와 화면이 갈린다 — 한국 시간으로 못박는다 */
  const t = Date.parse(iso)
  return Number.isNaN(t) ? iso : new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 2026-03-12 → 3월 12일. 연도는 프로젝트 안에서 거의 겹치지 않아 떼어 둔다. */
export function monthDay(iso: string) {
  const [, m, d] = localDay(iso).split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

/** 2026-09-08 → 9/8. 표의 기간 칸처럼 좁은 자리에 쓴다. */
export function slashDay(iso: string) {
  const [, m, d] = localDay(iso).split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 2026-03-21T10:14 → 3월 21일 10:14. 요청 댓글처럼 같은 날 여러 번 오가는 곳에 쓴다. */
export function dayTime(iso: string) {
  const t = Date.parse(iso)
  const local =
    iso.endsWith('Z') && !Number.isNaN(t)
      ? new Date(t + KST_OFFSET_MS).toISOString().slice(0, 19)
      : iso
  const [date, time = ''] = local.split('T')
  return time ? `${monthDay(date)} ${time.slice(0, 5)}` : monthDay(date)
}

/** 지금을 createdAt 모양으로 — ISO 8601 UTC. 밀리초는 읽기 나쁘기만 해서 뗀다. */
export function nowIso() {
  return `${new Date().toISOString().slice(0, 19)}Z`
}

/** 한국 시간의 오늘을 YYYY-MM-DD 로. 기한 지남처럼 서버와 같은 답이 나와야 하는 판정이 쓴다.
    now 를 받는 건 테스트가 오늘을 고정하려고다. */
export function kstToday(now: Date = new Date()) {
  return localDay(`${now.toISOString().slice(0, 19)}Z`)
}

/** 오늘 날짜를 YYYY-MM-DD 로. 날짜를 고르는 칸의 기본값이 쓴다. */
export function today() {
  return isoDay(new Date())
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

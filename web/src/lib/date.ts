/** 2026-03-12 → 3월 12일. 연도는 프로젝트 안에서 거의 겹치지 않아 떼어 둔다. */
export function monthDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}월 ${Number(d)}일`
}

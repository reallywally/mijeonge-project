import type { LocationQuery, LocationQueryValue } from 'vue-router'

/** 담당자 고르기의 '담당자 없음' — 주소에도 이 말로 남는다 (`?owner=u2,none`) */
export const NO_OWNER = 'none'

/** `?owner=u2,u3` → ['u2', 'u3'] — 빈 칸 · 겹친 값은 버리고 적힌 순서를 지킨다 */
export function parseOwnerQuery(raw: LocationQueryValue | LocationQueryValue[] | undefined) {
  const values = Array.isArray(raw) ? raw : [raw]
  const ids = values
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(ids)]
}

/** 고른 값을 주소 쿼리 조각으로 — 고른 게 없으면 owner 를 아예 안 단다 */
export const ownerQueryOf = (ids: string[]): { owner?: string } =>
  ids.length > 0 ? { owner: ids.join(',') } : {}

/** 지금 쿼리에서 owner 만 바꾼 쿼리 — 다른 쿼리(view · part …)는 그대로 둔다 */
export function withOwnerQuery(query: LocationQuery, ids: string[]): LocationQuery {
  const rest = { ...query }
  delete rest.owner
  return { ...rest, ...ownerQueryOf(ids) }
}

/** 하나 넣고 빼기 — 넣을 때는 맨 뒤로(버튼의 '김봉석 외 1' 은 먼저 고른 사람이 앞에 선다) */
export const toggleOwnerPick = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

/**
 * 고른 담당자에 드는지 — 작업 · 테스트의 간트와 목록이 같이 쓴다.
 * 담당자가 고른 사람 중 하나, 'none' 이면 담당자 없는 것. extra 는 담당 말고도 그 사람의 것으로 칠 사람들
 * (테스트의 참조 · 작업의 '나' 가 등록한 것)
 */
export function matchesOwnerPick(
  picked: ReadonlySet<string>,
  ownerId: string | null,
  extra: (string | null)[] = [],
) {
  if (picked.size === 0) return true
  if (ownerId === null ? picked.has(NO_OWNER) : picked.has(ownerId)) return true
  return extra.some((id) => id !== null && picked.has(id))
}

/** 버튼에 적는 말 — '김봉석' · '김봉석 외 1'. 나는 '나' */
export function ownerPickLabel(
  ids: string[],
  meId: string | null,
  nameOf: (id: string) => string | null,
) {
  if (ids.length === 0) return '담당자'
  const first = ids[0]
  const label =
    first === NO_OWNER ? '담당자 없음' : first === meId ? '나' : (nameOf(first) ?? '알 수 없음')
  return ids.length > 1 ? `${label} 외 ${ids.length - 1}` : label
}

import { describe, expect, it } from 'vitest'
import {
  matchesOwnerPick,
  ownerPickLabel,
  parseOwnerQuery,
  toggleOwnerPick,
  withOwnerQuery,
} from './ownerPick'

describe('담당자 고르기 — 주소 쿼리', () => {
  it('?owner=u2,u3,none 을 읽고 다시 쓴다 — 순서는 지키고 빈 칸 · 겹친 값은 버린다', () => {
    const ids = parseOwnerQuery('u2, u3,,none,u2')
    expect(ids).toEqual(['u2', 'u3', 'none'])
    expect(withOwnerQuery({}, ids)).toEqual({ owner: 'u2,u3,none' })
    expect(parseOwnerQuery(withOwnerQuery({}, ids).owner as string)).toEqual(ids)
  })

  it('없거나 여러 번 적힌 쿼리도 받는다', () => {
    expect(parseOwnerQuery(undefined)).toEqual([])
    expect(parseOwnerQuery(null)).toEqual([])
    expect(parseOwnerQuery(['u2', 'u3,u4', null])).toEqual(['u2', 'u3', 'u4'])
  })

  it('다른 쿼리는 그대로 두고, 다 풀면 owner 를 아예 뺀다', () => {
    expect(withOwnerQuery({ view: 'list', part: 'pt1', owner: 'u2' }, ['u3'])).toEqual({
      view: 'list',
      part: 'pt1',
      owner: 'u3',
    })
    expect(withOwnerQuery({ view: 'list', owner: 'u2' }, [])).toEqual({ view: 'list' })
  })
})

describe('담당자 고르기 — 거르기 · 버튼 말', () => {
  it('고른 게 없으면 다 맞고, none 은 담당자 없는 것, extra(참조 · 등록)도 본다', () => {
    expect(matchesOwnerPick(new Set(), 'u2')).toBe(true)
    expect(matchesOwnerPick(new Set(['u2']), 'u2')).toBe(true)
    expect(matchesOwnerPick(new Set(['u2']), 'u3')).toBe(false)
    expect(matchesOwnerPick(new Set(['none']), null)).toBe(true)
    expect(matchesOwnerPick(new Set(['none']), 'u2')).toBe(false)
    expect(matchesOwnerPick(new Set(['u3']), null, ['u3'])).toBe(true)
    expect(matchesOwnerPick(new Set(['u3']), 'u2', [null, 'u4'])).toBe(false)
  })

  it('넣고 빼기 — 넣은 것은 맨 뒤', () => {
    expect(toggleOwnerPick(['u2'], 'u3')).toEqual(['u2', 'u3'])
    expect(toggleOwnerPick(['u2', 'u3'], 'u2')).toEqual(['u3'])
  })

  it("버튼에는 먼저 고른 사람과 '외 N' — 나는 '나'", () => {
    const name = (id: string) => ({ u2: '박지훈', u3: '이도현' })[id] ?? null
    expect(ownerPickLabel([], 'u1', name)).toBe('담당자')
    expect(ownerPickLabel(['u2'], 'u1', name)).toBe('박지훈')
    expect(ownerPickLabel(['u2', 'u3'], 'u1', name)).toBe('박지훈 외 1')
    expect(ownerPickLabel(['u1', 'none', 'u3'], 'u1', name)).toBe('나 외 2')
    expect(ownerPickLabel(['none'], 'u1', name)).toBe('담당자 없음')
  })
})

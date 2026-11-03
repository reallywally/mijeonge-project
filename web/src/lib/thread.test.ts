import { describe, expect, it } from 'vitest'
import { threadStateOf } from '@/lib/thread'

describe('남은 이력 줄로 다시 잰 안건 상태', () => {
  it('결정 · 변경이 있으면 결정됨, 줄만 있으면 논의중, 없으면 대기', () => {
    expect(threadStateOf([{ kind: 'defer' }, { kind: 'change' }])).toBe('decided')
    expect(threadStateOf([{ kind: 'decide' }])).toBe('decided')
    expect(threadStateOf([{ kind: 'defer' }, { kind: 'refine' }])).toBe('open')
    expect(threadStateOf([])).toBe('queued')
  })
})

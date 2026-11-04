import { describe, expect, it } from 'vitest'
import { itemTitleProblem, threadStateOf } from '@/lib/thread'

const items = [{ id: 'a' }, { id: 'b' }]

describe('이력으로 다시 잰 안건 상태', () => {
  it('항목이 전부 정해져야 결정됨 — 하나라도 남으면 논의중', () => {
    expect(
      threadStateOf(items, [
        { kind: 'decide', itemId: 'a' },
        { kind: 'change', itemId: 'b' },
      ]),
    ).toBe('decided')
    expect(threadStateOf(items, [{ kind: 'decide', itemId: 'a' }])).toBe('open')
  })

  it('세부 추가 · 미룸은 항목을 정하지 않는다', () => {
    expect(
      threadStateOf(
        [{ id: 'a' }],
        [
          { kind: 'refine', itemId: 'a' },
          { kind: 'defer', itemId: 'a' },
        ],
      ),
    ).toBe('open')
  })

  it('항목만 있고 줄이 하나도 없으면 대기', () => {
    expect(threadStateOf(items, [])).toBe('queued')
  })

  it('항목이 없으면 결정됨이 될 수 없다 — 줄만 있으면 논의중, 없으면 대기', () => {
    expect(threadStateOf([], [{ kind: 'defer', itemId: null }])).toBe('open')
    expect(threadStateOf([], [])).toBe('queued')
  })

  it('지운 항목의 결정은 세지 않는다 — 남은 항목이 다 정해졌으면 결정됨', () => {
    const entries = [
      { kind: 'decide' as const, itemId: 'gone' },
      { kind: 'decide' as const, itemId: 'a' },
    ]
    expect(threadStateOf([{ id: 'a' }], entries)).toBe('decided')
    expect(threadStateOf([], entries)).toBe('open')
  })
})

describe('항목 이름', () => {
  it('앞뒤 공백을 떼고 1 ~ 200자', () => {
    expect(itemTitleProblem('  ')).not.toBe('')
    expect(itemTitleProblem(' 세션 길이 ')).toBe('')
    expect(itemTitleProblem('가'.repeat(200))).toBe('')
    expect(itemTitleProblem('가'.repeat(201))).not.toBe('')
  })
})

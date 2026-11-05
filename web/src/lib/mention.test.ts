import { describe, expect, it } from 'vitest'
import { insertMention, mentionCandidates, mentionItems, mentionQuery } from '@/lib/mention'
import type { Task, TestCase } from '@/types/domain'

const task = (key: string, title: string) => ({ id: key, key, title, status: 'todo' }) as Task
const test = (key: string, title: string) => ({ id: key, key, title, status: 'fail' }) as TestCase

describe('mentionQuery', () => {
  it('커서 앞에서 치는 중인 @ 를 찾는다', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('이거 @hw-1', 8)).toEqual({ start: 3, query: 'hw-1' })
    expect(mentionQuery('(@설계', 4)).toEqual({ start: 1, query: '설계' })
  })

  it('띄어 쓰고 지나갔거나, 이메일 · 커서 밖이면 아니다', () => {
    expect(mentionQuery('@HW-1 다음', 9)).toBeNull()
    expect(mentionQuery('a@b', 3)).toBeNull()
    expect(mentionQuery('@HW 끝', 6)).toBeNull()
    expect(mentionQuery('질문', 2)).toBeNull()
  })
})

describe('mentionCandidates', () => {
  const tasks = [task('HW-1', '설계'), task('HW-2', '데이터 설계'), task('HW-12', '배포 hw 점검')]

  it('키가 친 글로 시작하는 것이 먼저, 그다음 제목에 든 것', () => {
    expect(mentionCandidates(tasks, 'hw-1').map((t) => t.key)).toEqual(['HW-1', 'HW-12'])
    expect(mentionCandidates(tasks, '설계').map((t) => t.key)).toEqual(['HW-1', 'HW-2'])
    expect(mentionCandidates(tasks, 'hw').map((t) => t.key)).toEqual(['HW-1', 'HW-2', 'HW-12'])
  })

  it('빈 글이면 앞에서부터, 상한까지만', () => {
    expect(mentionCandidates(tasks, '', 2).map((t) => t.key)).toEqual(['HW-1', 'HW-2'])
    expect(mentionCandidates(tasks, '없는것')).toEqual([])
  })
})

describe('mentionItems · 작업과 테스트를 한 목록으로', () => {
  const items = mentionItems(
    [task('HW-1', '로그인 화면'), task('HW-3', '배포')],
    [test('HW-T3', '로그인 잠금'), test('HW-T1', '배포 점검')],
  )

  it('작업 먼저, 그다음 테스트 — 상태는 각자의 이름으로', () => {
    expect(items.map((c) => `${c.kind}:${c.key}`)).toEqual([
      'task:HW-1',
      'task:HW-3',
      'test:HW-T3',
      'test:HW-T1',
    ])
    expect(items[0].statusLabel).toBe('해야 할 일')
    expect(items[2].statusLabel).toBe('실패')
  })

  it('키로 시작하는 것 먼저 — 각 묶음 안에서는 작업이 테스트보다 앞', () => {
    expect(mentionCandidates(items, 'hw-t').map((c) => c.key)).toEqual(['HW-T3', 'HW-T1'])
    expect(mentionCandidates(items, 'hw-3').map((c) => c.key)).toEqual(['HW-3'])
    expect(mentionCandidates(items, '로그인').map((c) => c.key)).toEqual(['HW-1', 'HW-T3'])
    expect(mentionCandidates(items, 't3').map((c) => c.key)).toEqual(['HW-T3'])
    expect(mentionCandidates(items, '', 3).map((c) => c.key)).toEqual(['HW-1', 'HW-3', 'HW-T3'])
  })
})

describe('insertMention', () => {
  it('친 글을 키로 바꾸고 한 칸 띄운다', () => {
    expect(insertMention('이거 @설 봐줘', { start: 3, query: '설' }, 'HW-1')).toEqual({
      text: '이거 @HW-1 봐줘',
      caret: 8,
    })
    expect(insertMention('@h', { start: 0, query: 'h' }, 'HW-2')).toEqual({
      text: '@HW-2 ',
      caret: 6,
    })
    expect(insertMention('@hw-t', { start: 0, query: 'hw-t' }, 'HW-T3')).toEqual({
      text: '@HW-T3 ',
      caret: 7,
    })
  })
})

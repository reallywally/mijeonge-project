import { describe, expect, it } from 'vitest'
import { insertMention, mentionCandidates, mentionQuery } from '@/lib/mention'
import type { Task } from '@/types/domain'

const task = (key: string, title: string) => ({ id: key, key, title }) as Task

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
  })
})

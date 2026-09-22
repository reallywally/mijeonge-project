import { describe, expect, it } from 'vitest'
import { parseTaskBody } from './task'

describe('작업 내용 옮기기', () => {
  it('[] 로 시작하면 체크박스, - 로 시작하면 불릿이다', () => {
    const lines = parseTaskBody('[] 서버 신청서 제출\n[x] 우분투 설치\n- 방화벽은 따로 신청')
    expect(lines.map((l) => l.kind)).toEqual(['check', 'check', 'bullet'])
    expect(lines.map((l) => l.done)).toEqual([false, true, false])
    expect(lines.map((l) => l.text)).toEqual([
      '서버 신청서 제출',
      '우분투 설치',
      '방화벽은 따로 신청',
    ])
  })

  it('앞의 두 칸이 한 단계다', () => {
    const lines = parseTaskBody('[] 서버 신청\n  - 보안팀 확인\n\t- 탭도 한 단계')
    expect(lines.map((l) => l.level)).toEqual([0, 1, 1])
  })

  it('빈 줄과 표시만 있는 줄은 버린다', () => {
    expect(parseTaskBody('\n[] \n   \n- 남는 줄')).toHaveLength(1)
  })

  it('표시가 없는 줄도 불릿으로 둔다', () => {
    const [line] = parseTaskBody('그냥 적은 줄')
    expect(line.kind).toBe('bullet')
    expect(line.text).toBe('그냥 적은 줄')
  })
})

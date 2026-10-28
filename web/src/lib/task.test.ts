import { describe, expect, it } from 'vitest'
import { tasks } from '@/fixtures'
import { parseTaskBody, statusDays, statusSinceLabel } from './task'

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

describe('상태가 된 지 며칠', () => {
  const now = new Date('2026-10-20T03:00:00Z')

  it('한국 시간 날짜끼리 뺀다', () => {
    expect(statusDays('2026-10-08T00:00:00Z', now)).toBe(12)
    /* 10/19 15:30Z 는 한국 시간 10/20 00:30 — 오늘이다 */
    expect(statusDays('2026-10-19T15:30:00Z', now)).toBe(0)
    expect(statusDays('2026-10-19T14:30:00Z', now)).toBe(1)
    /* 시계가 어긋나 앞날이어도 음수는 없다 */
    expect(statusDays('2026-10-25T00:00:00Z', now)).toBe(0)
  })

  it("'진행 중 · 12일째', backfill 이면 '12일 이상'", () => {
    const k20 = { status: 'doing' as const, statusChangedAt: '2026-10-08T00:00:00Z' }
    expect(statusSinceLabel({ ...k20, statusSinceBackfill: false }, now)).toBe('진행 중 · 12일째')
    expect(statusSinceLabel({ ...k20, statusSinceBackfill: true }, now)).toBe('진행 중 · 12일 이상')
    expect(
      statusSinceLabel(
        { status: 'blocked', statusChangedAt: '2026-10-20T01:00:00Z', statusSinceBackfill: false },
        now,
      ),
    ).toBe('막힘 · 오늘부터')
  })

  it('픽스처의 상태 시각 — 계약의 시드 그대로', () => {
    const at = (id: string) => tasks.find((t) => t.id === id)!
    expect(at('k20').statusChangedAt).toBe('2026-10-08T00:00:00Z')
    expect(at('k22').statusChangedAt).toBe('2026-10-13T00:00:00Z')
    expect(at('k19').statusChangedAt).toBe('2026-09-08T00:00:00Z')
    /* 기간 없는 작업은 등록 시각 */
    expect(at('k18').statusChangedAt).toBe(at('k18').createdAt)
    expect(tasks.every((t) => t.statusSinceBackfill === false)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { tasks } from '@/fixtures'
import {
  batchDepthProblems,
  hiddenDoneIds,
  MAX_TASK_DEPTH,
  parseTaskBody,
  statusDays,
  statusSinceLabel,
  subtreeHeights,
  taskDepths,
} from './task'

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

describe('작업 계층 깊이 (Q64)', () => {
  const p1 = tasks.filter((t) => t.projectId === 'p1')

  it('최상위가 1단 — 개발 › AI Biz › 가상비서 › tool01 이 4단이다. 시드는 4단을 넘지 않는다', () => {
    const depths = taskDepths(p1)
    expect([depths.k5, depths.k6, depths.k7, depths.k8]).toEqual([1, 2, 3, 4])
    expect(Math.max(...Object.values(depths))).toBe(MAX_TASK_DEPTH)
  })

  it('하위 높이는 자기까지 센다 — 하위가 없으면 1', () => {
    const heights = subtreeHeights(p1)
    expect([heights.k5, heights.k7, heights.k8, heights.k4]).toEqual([4, 2, 1, 2])
  })

  it('상위가 목록에 없거나 고리가 있어도 멈춘다', () => {
    const depths = taskDepths([
      { id: 'a', parentId: 'gone' },
      { id: 'b', parentId: 'c' },
      { id: 'c', parentId: 'b' },
    ])
    expect(depths.a).toBe(1)
    expect(Number.isFinite(depths.b)).toBe(true)
  })

  it('한 번에 등록에서 4단을 넘는 자리를 짚는다 — 임시 상위면 parentTempId, 있는 상위면 parentId', () => {
    const d = (tempId: string, parentTempId: string | null, parentId: string | null = null) => ({
      tempId,
      parentTempId,
      parentId,
    })
    expect(batchDepthProblems([d('t1', null, 'k7'), d('t2', 't1')], taskDepths(p1))).toEqual({
      'tasks.1.parentTempId': '작업은 4단까지만 쌓을 수 있습니다.',
    })
    expect(batchDepthProblems([d('t1', null, 'k8')], taskDepths(p1))).toEqual({
      'tasks.0.parentId': '작업은 4단까지만 쌓을 수 있습니다.',
    })
    expect(
      batchDepthProblems([d('t1', null), d('t2', 't1'), d('t3', 't2'), d('t4', 't3')], {}),
    ).toEqual({})
  })
})

describe('완료 숨기기 (Q64)', () => {
  type Node = { id: string; parentId: string | null; status: 'todo' | 'doing' | 'blocked' | 'done' }
  const n = (id: string, parentId: string | null, status: Node['status']): Node => ({
    id,
    parentId,
    status,
  })

  it('하위가 다 끝난 완료는 숨는다', () => {
    expect(hiddenDoneIds([n('a', null, 'done'), n('b', 'a', 'done')])).toEqual(new Set(['a', 'b']))
  })

  it('안 끝난 하위가 있는 완료 상위는 위로 끝까지 남는다', () => {
    const hidden = hiddenDoneIds([
      n('a', null, 'done'),
      n('b', 'a', 'done'),
      n('c', 'b', 'doing'),
      n('d', 'a', 'done'),
    ])
    expect(hidden).toEqual(new Set(['d']))
  })

  it('완료가 아니면 숨지 않는다', () => {
    expect(hiddenDoneIds([n('a', null, 'blocked'), n('b', 'a', 'todo')]).size).toBe(0)
  })
})

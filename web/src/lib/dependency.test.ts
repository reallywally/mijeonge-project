import { describe, expect, it } from 'vitest'
import { taskDependencies, tasks } from '@/fixtures'
import {
  DEPENDENCY_ERRORS,
  DEPENDENCY_LIMIT,
  dependencyChoices,
  dependencyProblem,
  statusDays,
  statusSinceLabel,
} from './dependency'

/* 서버 계약의 '검사'(docs/api/task-flow.md) — 목업 api 와 화면의 고르기 목록이 같은 함수를 쓴다 */
const p1 = tasks.filter((t) => t.projectId === 'p1')
const problem = (taskId: string, dependsOnId: string, deps = taskDependencies) =>
  dependencyProblem(p1, deps, taskId, dependsOnId)

describe('선행 작업 검사', () => {
  it('자기 자신 · 조상 · 자손은 상하위로 거절한다', () => {
    expect(problem('k20', 'k20')).toBe('hierarchy')
    /* k20 은 개발 환경 설정(k4) 아래 */
    expect(problem('k20', 'k4')).toBe('hierarchy')
    expect(problem('k4', 'k20')).toBe('hierarchy')
    /* 몇 단을 건너도 — tool01(k8) 은 개발(k5) 의 손자의 자식 */
    expect(problem('k8', 'k5')).toBe('hierarchy')
    expect(problem('k5', 'k8')).toBe('hierarchy')
  })

  it('몇 단계를 건너도 서로 기다리게 되면 순환이다', () => {
    /* k21 ← k20 ← k19 — k19 가 k21 을 기다리면 고리가 된다 */
    expect(problem('k19', 'k20')).toBe('cycle')
    expect(problem('k19', 'k21')).toBe('cycle')
    expect(DEPENDENCY_ERRORS.cycle).toMatchObject({ status: 409, code: 'TASK_DEPENDENCY_CYCLE' })
  })

  it('형제 · 사촌끼리는 걸린다', () => {
    expect(problem('k21', 'k19')).toBeNull()
    expect(problem('k16', 'k15')).toBeNull()
    expect(problem('k18', 'k3')).toBeNull()
  })

  it('이미 있는 쌍을 다시 걸어도 걸리지 않는다 (멱등)', () => {
    expect(problem('k20', 'k19')).toBeNull()
  })

  it(`한 작업의 선행은 ${DEPENDENCY_LIMIT}개까지`, () => {
    const many = Array.from({ length: DEPENDENCY_LIMIT }, (_, i) => ({
      taskId: 'k18',
      dependsOnId: `z${i}`,
    }))
    expect(problem('k18', 'k3', many)).toBe('limit')
    /* 이미 걸린 것 중 하나를 다시 거는 것은 넘는 것이 아니다 */
    expect(problem('k18', 'z0', many)).toBeNull()
    expect(DEPENDENCY_ERRORS.limit).toMatchObject({ status: 400, code: 'TASK_DEPENDENCY_LIMIT' })
  })
})

describe('고르기 목록', () => {
  it('자기 · 조상 · 자손 · 이미 건 것을 빼고, 순환이 되는 것은 까닭과 함께 둔다', () => {
    const choices = dependencyChoices(p1, taskDependencies, 'k19')
    const ids = choices.map((c) => c.task.id)
    expect(ids).not.toContain('k19')
    expect(ids).not.toContain('k4')
    expect(choices.find((c) => c.task.id === 'k20')!.problem).toBe('cycle')
    expect(choices.find((c) => c.task.id === 'k22')!.problem).toBe('cycle')
    expect(choices.find((c) => c.task.id === 'k1')!.problem).toBeNull()

    const k20 = dependencyChoices(p1, taskDependencies, 'k20').map((c) => c.task.id)
    expect(k20).not.toContain('k19')
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
})

describe('픽스처', () => {
  it('계약의 시드 그대로 — 선행 셋, 상태 시각', () => {
    expect(taskDependencies).toEqual([
      { taskId: 'k20', dependsOnId: 'k19' },
      { taskId: 'k21', dependsOnId: 'k20' },
      { taskId: 'k22', dependsOnId: 'k20' },
    ])
    const at = (id: string) => tasks.find((t) => t.id === id)!
    expect(at('k20').statusChangedAt).toBe('2026-10-08T00:00:00Z')
    expect(at('k22').statusChangedAt).toBe('2026-10-13T00:00:00Z')
    expect(at('k19').statusChangedAt).toBe('2026-09-08T00:00:00Z')
    /* 기간 없는 작업은 등록 시각 */
    expect(at('k18').statusChangedAt).toBe(at('k18').createdAt)
    expect(tasks.every((t) => t.statusSinceBackfill === false)).toBe(true)
  })
})

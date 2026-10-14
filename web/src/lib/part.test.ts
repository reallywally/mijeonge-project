import { describe, expect, it } from 'vitest'
import { partMembers, tasks, taskThreadLinks, threads } from '@/fixtures'
import {
  defaultPartScope,
  inheritedPartId,
  partChoices,
  partNameProblem,
  sortParts,
  visibleInMyParts,
} from './part'
import type { Part, Task, Thread } from '@/types/domain'

/* 시드(docs/api/part.md '시드 · 목업')로 '내 파트' 를 사람마다 따라가 본다.
   pt1 인프라 = u3, pt2 AI = u1 · u4, pt3 기간계 연동 = u2 */
const p1Tasks = tasks.filter((t) => t.projectId === 'p1')
const p1Threads = threads.filter((t) => t.projectId === 'p1')

function seen(memberId: string) {
  const mine = new Set(partMembers.filter((pm) => pm.memberId === memberId).map((pm) => pm.partId))
  const r = visibleInMyParts({
    tasks: p1Tasks,
    threads: p1Threads,
    links: taskThreadLinks,
    memberId,
    myPartIds: mine,
  })
  const sorted = (ids: Set<string>) =>
    [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  return {
    tasks: sorted(r.taskIds),
    context: sorted(r.contextTaskIds),
    threads: sorted(r.threadIds),
  }
}

describe('내 파트 — 시드로 사람마다', () => {
  it('인프라(u3) 는 공통 · 인프라 작업을 보고, AI · 기간계 작업은 안 본다', () => {
    const u3 = seen('u3')
    expect(u3.tasks).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k17', 'k19', 'k20', 'k21'])
    expect(u3.context).toEqual([])
    /* 서버 OS · DB · 백업(인프라) + 공통 둘(t6 · t9). AI 안건과 기간계 안건은 안 보인다 */
    expect(u3.threads).toEqual(['t1', 't2', 't4', 't6', 't9'])
  })

  it('기간계(u2) 는 담당한 AI 작업(k15)도 보고, 그 조상은 길을 잇느라 흐리게 선다', () => {
    const u2 = seen('u2')
    expect(u2.tasks).toEqual(['k1', 'k2', 'k3', 'k5', 'k6', 'k14', 'k15', 'k17', 'k18'])
    /* k5(개발)는 공통이라 스스로 보인다 — 흐리게 서는 것은 AI 파트의 조상 둘뿐이다 */
    expect(u2.context).toEqual(['k6', 'k14'])
    /* 같은 묶음 아래의 다른 AI 작업은 안 보인다 */
    expect(u2.tasks).not.toContain('k16')
    expect(u2.threads).toEqual(['t5', 't6', 't9'])
  })

  it('AI(u4) 는 담당한 기간계 작업(k18)과, 그 작업을 막은 기간계 안건(t5)을 본다', () => {
    const u4 = seen('u4')
    expect(u4.tasks).toContain('k18')
    expect(u4.tasks).not.toContain('k4')
    expect(u4.threads).toContain('t5')
    expect(u4.threads).not.toContain('t1')
    expect(u4.threads).toEqual(['t3', 't5', 't6', 't7', 't8', 't9'])
  })

  it('다른 파트 작업을 하나 맡아도(u1 · k21) 경로로 선 조상의 안건은 안 딸려 온다', () => {
    const u1 = seen('u1')
    expect(u1.tasks).toContain('k21')
    expect(u1.context).toEqual(['k4'])
    /* k4(개발 환경 설정)는 경로를 잇느라 선 조상일 뿐이라, 거기 걸린 서버 OS · DB 결정은 안 끌어온다 */
    expect(u1.threads).toEqual(['t3', 't6', 't7', 't8', 't9'])
    expect(u1.threads).not.toContain('t1')
  })
})

describe('내 파트 — 규칙 하나씩', () => {
  const task = (id: string, over: Partial<Task> = {}) => ({
    id,
    parentId: null,
    partId: null,
    ownerId: null,
    ...over,
  })
  const thread = (id: string, over: Partial<Thread> = {}) => ({
    id,
    partId: null,
    ownerId: null,
    ...over,
  })
  const run = (
    t: ReturnType<typeof task>[],
    th: ReturnType<typeof thread>[] = [],
    links: { taskId: string; threadId: string }[] = [],
    mine: string[] = [],
    memberId: string | null = 'me',
  ) =>
    visibleInMyParts({
      tasks: t,
      threads: th,
      links,
      memberId,
      myPartIds: new Set(mine),
    })

  it('공통(null)은 누구에게나 보인다', () => {
    const r = run(
      [task('a'), task('b', { partId: 'x' })],
      [thread('t'), thread('u', { partId: 'x' })],
    )
    expect([...r.taskIds]).toEqual(['a'])
    expect([...r.threadIds]).toEqual(['t'])
  })

  it('보관한 파트라도 내가 속해 있으면 그 파트의 옛 작업은 계속 보인다', () => {
    const r = run([task('a', { partId: 'old' })], [], [], ['old'])
    expect(r.taskIds.has('a')).toBe(true)
  })

  it('조상은 몇 단이든 올라가고, 스스로 맞는 조상은 흐리게 치지 않는다', () => {
    const r = run([
      task('root', { partId: 'x' }),
      task('mid', { partId: null, parentId: 'root' }),
      task('leaf', { partId: 'x', parentId: 'mid', ownerId: 'me' }),
    ])
    expect([...r.taskIds].sort()).toEqual(['leaf', 'mid', 'root'])
    expect([...r.contextTaskIds]).toEqual(['root'])
  })

  it('보이는 작업의 자식이라고 따라 보이지는 않는다 — 조상만 올라간다', () => {
    const r = run([task('p'), task('c', { partId: 'x', parentId: 'p' })])
    expect(r.taskIds.has('c')).toBe(false)
  })

  it('안 보이는 작업에 걸린 다른 파트 안건은 안 보인다', () => {
    const r = run(
      [task('a', { partId: 'x' })],
      [thread('t', { partId: 'x' })],
      [{ taskId: 'a', threadId: 't' }],
    )
    expect(r.threadIds.size).toBe(0)
  })

  it('안건 담당자면 다른 파트 안건도 보인다', () => {
    const r = run([], [thread('t', { partId: 'x', ownerId: 'me' })])
    expect(r.threadIds.has('t')).toBe(true)
  })

  it('로그인한 사람이 없으면 담당 규칙은 아무것도 고르지 않는다 — 담당자 없는 작업이 다 보이지 않게', () => {
    const r = run([task('a', { partId: 'x', ownerId: null })], [], [], [], null)
    expect(r.taskIds.size).toBe(0)
  })

  it('부모가 고리를 이뤄도 멈춘다', () => {
    const r = run([
      task('a', { partId: null, parentId: 'b' }),
      task('b', { partId: 'x', parentId: 'a' }),
    ])
    expect([...r.taskIds].sort()).toEqual(['a', 'b'])
  })

  it('목록에 없는 부모를 가리켜도 거기서 멈춘다', () => {
    const r = run([task('a', { parentId: 'gone' })])
    expect([...r.taskIds]).toEqual(['a'])
  })
})

describe('기본 보기 · 고르기 · 상속', () => {
  it('일반 사용자는 내 파트, 프로젝트 관리자 · 시스템 관리자는 전체로 시작한다', () => {
    expect(defaultPartScope('user')).toBe('mine')
    expect(defaultPartScope('projectAdmin')).toBe('all')
    expect(defaultPartScope('systemAdmin')).toBe('all')
    expect(defaultPartScope(null)).toBe('all')
  })

  const parts: Part[] = [
    { id: 'b', projectId: 'p', name: '인프라', active: true },
    { id: 'a', projectId: 'p', name: 'AI', active: true },
    { id: 'z', projectId: 'p', name: '옛 파트', active: false },
  ]

  it('이름 순으로 놓는다', () => {
    expect(sortParts(parts).map((p) => p.id)).toEqual(['a', 'z', 'b'])
  })

  it('고를 수 있는 것은 활성 파트 — 이미 달린 보관 파트는 그 자리에서만 보인다', () => {
    expect(partChoices(parts, null).map((p) => p.id)).toEqual(['a', 'b'])
    expect(partChoices(parts, 'z').map((p) => p.id)).toEqual(['a', 'z', 'b'])
  })

  it('작업 등록에서 안 보내면 상위를 따르고, null 을 보내면 공통이다', () => {
    expect(inheritedPartId(undefined, { partId: 'a' })).toBe('a')
    expect(inheritedPartId(undefined, null)).toBeNull()
    expect(inheritedPartId(null, { partId: 'a' })).toBeNull()
    expect(inheritedPartId('b', { partId: 'a' })).toBe('b')
  })

  it('파트 이름은 앞뒤 공백을 떼고 1 ~ 50자', () => {
    expect(partNameProblem('   ')).not.toBeNull()
    expect(partNameProblem(' 인프라 ')).toBeNull()
    expect(partNameProblem('가'.repeat(50))).toBeNull()
    expect(partNameProblem('가'.repeat(51))).not.toBeNull()
  })
})

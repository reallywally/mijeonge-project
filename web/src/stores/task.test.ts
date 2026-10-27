import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from './data'
import { useTaskStore } from './task'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('작업 목록', () => {
  it('고른 프로젝트의 작업만 선다', () => {
    const task = useTaskStore()
    const data = useDataStore()
    expect(task.rows.every((r) => r.task.projectId === 'p1')).toBe(true)

    data.setProject('p2')
    expect(task.rows.map((r) => r.task.key)).toEqual(['PAS-1', 'PAS-2'])
  })

  it('계층 없이 한 줄씩 — 건 연관 작업의 키를 제목 아래 글로 적는다', () => {
    const task = useTaskStore()
    const row = (key: string) => task.rows.find((r) => r.task.key === key)!

    expect(row('HW-8').relatedLabel).toBe('연관 HW-7')
    expect(row('HW-1').relatedLabel).toBe('')
    /* 한 방향 — HW-7 을 건 작업이 있어도 HW-7 쪽에는 안 적힌다 */
    expect(row('HW-7').relatedLabel).toBe('연관 HW-6')
  })

  it('기간이 둘 다 없는 작업만 기간 미정이다', () => {
    const task = useTaskStore()
    const undated = task.rows.filter((r) => r.undated)
    expect(undated.map((r) => r.task.key)).toEqual(['HW-18'])
    expect(task.undatedCount).toBe(1)
    expect(undated[0].periodLabel).toBe('')
  })

  it('기간은 좁은 칸에 맞춰 슬래시로 적는다', () => {
    const task = useTaskStore()
    expect(task.rows.find((r) => r.task.key === 'HW-4')!.periodLabel).toBe('9/8 ~ 9/15')
  })

  it('상태별 수를 센다', () => {
    const task = useTaskStore()
    expect(task.statusCounts.all).toBe(22)
    expect(task.statusCounts.blocked).toBe(2)
    expect(task.blockedCount).toBe(2)
  })
})

describe('작업 상세', () => {
  it('걸린 안건에 지금까지 정해진 내용이 따라온다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k4')!

    expect(detail.task.title).toBe('개발 환경 설정')
    expect(detail.threads.map((t) => t.thread.title)).toEqual(['서버 OS 결정', 'DB 결정'])
    expect(detail.threads[0].line).toBe('우분투 최신 버전으로 한다')
    expect(detail.threads[0].where).toBe('9월 9일에 정해짐')
    expect(detail.threads[1].line).toBe('mysql 을 쓴다')
  })

  it('걸린 안건이 몇 번 미뤄졌는지도 함께 온다 — 안건 목록과 같은 배지를 쓴다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k18')!
    expect(detail.threads.map((t) => t.deferCount)).toEqual([2])
  })

  it('건 연관 작업이 건 순서로 따라온다 — 한 방향이라 걸린 쪽에는 없다', () => {
    const task = useTaskStore()
    expect(task.taskDetail('k20')!.related.map((r) => r.task.key)).toEqual(['HW-4'])
    expect(task.taskDetail('k4')!.related).toEqual([])
  })

  it('아직 못 정한 안건은 마지막 기록과 그 날짜를 보여준다', () => {
    const task = useTaskStore()
    const row = task.taskDetail('k18')!.threads[0]
    expect(row.line).toBe('여전히 업무 정의가 없어 또 미룬다')
    expect(row.where).toBe('마지막 기록 · 9월 14일')
  })

  it('기록이 하나도 없는 안건은 그렇다고 적는다', () => {
    const task = useTaskStore()
    const row = task.taskDetail('k13')!.threads[0]
    expect(row.line).toBe('아직 아무 기록이 없습니다.')
    expect(row.where).toBe('기록 없음')
  })
})

describe('맵핑', () => {
  it('안건을 걸고 뗀다. 같은 것을 두 번 걸어도 하나다', () => {
    const task = useTaskStore()
    task.linkThread('k4', 't4')
    task.linkThread('k4', 't4')
    expect(task.threadsOfTask('k4').map((t) => t.id)).toEqual(['t1', 't2', 't4'])

    task.unlinkThread('k4', 't4')
    expect(task.threadsOfTask('k4').map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('안건 쪽에서는 어느 작업에 걸렸는지 읽을 수 있다', () => {
    const task = useTaskStore()
    expect(task.tasksOfThread('t5').map((r) => r.task.key)).toEqual(['HW-18'])
  })
})

describe('작업 추가', () => {
  const input = (title: string) => ({
    title,
    body: [],
    status: 'todo' as const,
    ownerId: null,
    start: null,
    due: null,
    priority: 'normal' as const,
    threadIds: [],
  })

  it('키는 그 프로젝트의 접두사로 선다 — 다른 프로젝트에 HW 가 붙지 않는다', async () => {
    const task = useTaskStore()
    const data = useDataStore()
    data.setProject('p2')

    const id = await task.addTask(input('이관 도구 고르기'))
    expect(task.rows.find((r) => r.task.id === id)!.task.key).toBe('PAS-3')
  })

  it('번호를 들고 세므로 목록에서 빠진 번호를 다시 쓰지 않는다', async () => {
    const task = useTaskStore()
    const data = useDataStore()

    const first = await task.addTask(input('CI 러너 늘리기'))
    expect(data.allTasks.find((t) => t.id === first)!.key).toBe('HW-23')

    data.allTasks = data.allTasks.filter((t) => t.id !== first)
    const second = await task.addTask(input('배포 스크립트 정리'))
    expect(data.allTasks.find((t) => t.id === second)!.key).toBe('HW-24')
  })
})

describe('상태 바꾸기', () => {
  it('막힘에서 진행 중으로 옮기면 목록의 수도 따라 바뀐다', () => {
    const task = useTaskStore()
    expect(task.blockedCount).toBe(2)
    task.setStatus('k18', 'doing')
    expect(task.blockedCount).toBe(1)
    expect(task.rows.find((r) => r.task.key === 'HW-18')!.task.status).toBe('doing')
  })

  it('본문의 체크박스를 켜고 끈다', () => {
    const task = useTaskStore()
    const line = () => task.taskDetail('k4')!.task.body.find((l) => l.id === 'l3')!
    expect(line().done).toBe(false)
    task.toggleBodyLine('k4', 'l3')
    expect(line().done).toBe(true)
  })

  it('불릿은 체크가 되지 않는다', () => {
    const task = useTaskStore()
    task.toggleBodyLine('k4', 'l5')
    expect(task.taskDetail('k4')!.task.body.find((l) => l.id === 'l5')!.done).toBe(false)
  })
})

describe('기간 바꾸기', () => {
  it('간트에서 막대를 끌면 기간이 바뀐다', () => {
    const task = useTaskStore()
    task.setPeriod('k4', '2026-09-10', '2026-09-18')

    const row = task.rows.find((r) => r.task.key === 'HW-4')!
    expect(row.task.start).toBe('2026-09-10')
    expect(row.task.due).toBe('2026-09-18')
    expect(row.periodLabel).toBe('9/10 ~ 9/18')
    expect(row.undated).toBe(false)
  })

  it('기간을 지우면 다시 기간 미정이 된다 — 한쪽만 아는 기간은 기간으로 치지 않는다', () => {
    const task = useTaskStore()
    task.setPeriod('k4', null, null)
    expect(task.rows.find((r) => r.task.key === 'HW-4')!.undated).toBe(true)

    task.setPeriod('k4', '2026-09-10', null)
    const row = task.rows.find((r) => r.task.key === 'HW-4')!
    expect(row.task.start).toBeNull()
    expect(row.undated).toBe(true)
  })

  it('기간 미정이던 작업에 기간을 잡아 주면 그 수가 준다', () => {
    const task = useTaskStore()
    expect(task.undatedCount).toBe(1)
    task.setPeriod('k18', '2026-09-28', '2026-10-02')
    expect(task.undatedCount).toBe(0)
  })
})

describe('연관 작업', () => {
  const keys = (task: ReturnType<typeof useTaskStore>, id: string) =>
    task.taskDetail(id)!.related.map((r) => r.task.key)

  it('더 걸 수 있는 것은 같은 프로젝트에서 자기 · 이미 건 것을 뺀 것이다', () => {
    const task = useTaskStore()
    const ids = task.relatedOptionsFor('k20').map((t) => t.id)
    expect(ids).not.toContain('k20')
    expect(ids).not.toContain('k4')
    expect(ids).not.toContain('x1')
    expect(ids).toHaveLength(20)
  })

  it('통째로 갈아끼운다 — 중복은 한 번, [] 는 비우기', () => {
    const task = useTaskStore()
    task.setRelated('k20', ['k19', 'k21', 'k19'])
    expect(task.taskDetail('k20')!.task.relatedIds).toEqual(['k19', 'k21'])
    expect(keys(task, 'k20')).toEqual(['HW-19', 'HW-21'])

    task.setRelated('k20', [])
    expect(keys(task, 'k20')).toEqual([])
  })

  it('여럿을 더 걸면 건 순서 뒤에 붙고, 하나씩 뗀다', () => {
    const task = useTaskStore()
    task.addRelated('k20', ['k19', 'k4', 'k21'])
    expect(keys(task, 'k20')).toEqual(['HW-4', 'HW-19', 'HW-21'])

    task.removeRelated('k20', 'k4')
    expect(keys(task, 'k20')).toEqual(['HW-19', 'HW-21'])
  })

  it('자기 자신 · 다른 프로젝트의 작업 · 20개 넘게는 받지 않는다 (목업도 서버처럼)', () => {
    const task = useTaskStore()
    task.setRelated('k20', ['k20'])
    task.setRelated('k20', ['x1'])
    task.setRelated(
      'k20',
      task.tasks.filter((t) => t.id !== 'k20').map((t) => t.id),
    )
    expect(task.taskDetail('k20')!.task.relatedIds).toEqual(['k4'])
  })

  it('새 작업은 연관 없이, 파트를 안 보내면 공통으로 선다', async () => {
    const task = useTaskStore()
    const id = await task.addTask({
      title: '새 작업',
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    const made = task.taskDetail(id!)!.task
    expect(made.relatedIds).toEqual([])
    expect(made.partId).toBeNull()
  })
})

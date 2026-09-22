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

  it('계층을 펼치지 않는 대신 경로를 글로 적는다', () => {
    const task = useTaskStore()
    const row = (key: string) => task.rows.find((r) => r.task.key === key)!

    expect(row('HW-8').pathLabel).toBe('개발 › AI Biz › 가상비서')
    expect(row('HW-5').pathLabel).toBe('최상위 작업 · 하위 3건')
    expect(row('HW-2').pathLabel).toBe('설계')
  })

  it('상위 작업을 고르는 자리는 자기까지 포함한 경로를 적는다', () => {
    const task = useTaskStore()
    const label = (key: string) =>
      task.parentOptions.find((o) => o.id === task.rows.find((r) => r.task.key === key)!.task.id)!
        .label

    expect(label('HW-8')).toBe('개발 › AI Biz › 가상비서 › tool01')
    expect(label('HW-1')).toBe('설계')
    expect(task.parentOptions).toHaveLength(21)
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
    expect(task.statusCounts.all).toBe(21)
    expect(task.statusCounts.blocked).toBe(1)
    expect(task.blockedCount).toBe(1)
  })
})

describe('작업 상세', () => {
  it('걸린 안건에 지금까지 정해진 내용이 따라온다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k4')!

    expect(detail.task.title).toBe('개발 환경 설정')
    expect(detail.threads.map((t) => t.thread.title)).toEqual(['서버 OS 결정', 'DB 결정'])
    expect(detail.threads[0].line).toBe('우분투 최신 버전으로 한다')
    /* 회의 없이 담당자 확인으로 정한 줄이라 회의 이름이 없다 */
    expect(detail.threads[0].where).toContain('담당자 확인')
    expect(detail.threads[1].line).toBe('mysql 을 쓴다')
  })

  it('걸린 안건이 몇 번 미뤄졌는지도 함께 온다 — 안건 목록과 같은 배지를 쓴다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k18')!
    expect(detail.threads.map((t) => t.deferCount)).toEqual([2])
  })

  it('하위 작업과 끝난 수를 센다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k4')!
    expect(detail.children.map((c) => c.task.key)).toEqual(['HW-19', 'HW-20', 'HW-21'])
    expect(detail.doneChildCount).toBe(1)
  })

  it('걸린 회의를 보여준다', () => {
    const task = useTaskStore()
    expect(task.taskDetail('k4')!.meetings.map((m) => m.title)).toEqual(['개발 환경 확정 회의'])
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

  it('회의를 거는 쪽과 작업을 거는 쪽이 같은 링크다', () => {
    const task = useTaskStore()
    task.linkMeeting('k4', 'm6')
    expect(task.meetingsOfTask('k4').map((m) => m.id)).toEqual(['m3', 'm6'])
    task.unlinkMeeting('k4', 'm6')
    expect(task.meetingsOfTask('k4').map((m) => m.id)).toEqual(['m3'])
  })

  it('안건 쪽에서는 어느 작업에 걸렸는지 읽을 수 있다', () => {
    const task = useTaskStore()
    expect(task.tasksOfThread('t5').map((r) => r.task.key)).toEqual(['HW-18'])
  })
})

describe('상태 바꾸기', () => {
  it('막힘에서 진행 중으로 옮기면 목록의 수도 따라 바뀐다', () => {
    const task = useTaskStore()
    expect(task.blockedCount).toBe(1)
    task.setStatus('k18', 'doing')
    expect(task.blockedCount).toBe(0)
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

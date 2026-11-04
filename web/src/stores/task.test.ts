import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTaskHistory } from '@/api/history'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { change } from '@/lib/history'
import { toastError } from '@/lib/notify'
import { useAuthStore } from './auth'
import { useDataStore } from './data'
import { useTaskStore } from './task'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 고치기는 작성자 · 담당자 · 관리자만이다 — 계산을 보는 검사들이라 프로젝트 관리자(u1)로 들어온다 */
beforeEach(async () => {
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  resetMockAuth()
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
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
    expect(task.parentOptions).toHaveLength(22)
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

  it('하위 작업과 끝난 수를 센다', () => {
    const task = useTaskStore()
    const detail = task.taskDetail('k4')!
    expect(detail.children.map((c) => c.task.key)).toEqual(['HW-19', 'HW-20', 'HW-21', 'HW-22'])
    expect(detail.doneChildCount).toBe(1)
  })

  it('아직 못 정한 안건은 마지막 기록과 그 날짜를 보여준다', () => {
    const task = useTaskStore()
    const row = task.taskDetail('k18')!.threads[0]
    expect(row.line).toBe('여전히 업무 정의가 없어 또 미룬다')
    /* 항목이 둘 이상이면 몇 개 정했는지도 */
    expect(row.where).toBe('마지막 기록 · 9월 14일 · 결정 1/2 정함')
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
    parentId: null,
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

describe('상태 기록', () => {
  beforeEach(async () => {
    resetMockAuth()
    await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
  })

  it('상태가 바뀌면 statusChangedAt 이 지금으로, backfill 은 false 로', () => {
    const data = useDataStore()
    const k20 = data.allTasks.find((t) => t.id === 'k20')!
    k20.statusSinceBackfill = true
    useTaskStore().setStatus('k20', 'done')
    expect(Date.now() - Date.parse(k20.statusChangedAt)).toBeLessThan(5_000)
    expect(k20.statusSinceBackfill).toBe(false)
  })

  it('그대로인 상태는 기록하지 않는다', () => {
    const k22 = useDataStore().allTasks.find((t) => t.id === 'k22')!
    useTaskStore().setStatus('k22', 'blocked')
    expect(k22.statusChangedAt).toBe('2026-10-13T00:00:00Z')
  })

  it('목업으로 만든 작업도 만든 시각부터다', async () => {
    const task = useTaskStore()
    const id = await task.addTask({
      title: '새 작업',
      parentId: null,
      body: [],
      status: 'doing',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    const made = useDataStore().allTasks.find((t) => t.id === id)!
    expect(made.statusChangedAt).toBe(made.createdAt)
    expect(made.statusSinceBackfill).toBe(false)

    const batch = await task.addTaskBatch([
      {
        tempId: 't1',
        parentTempId: null,
        parentId: null,
        title: '초안',
        ownerId: null,
        start: null,
        due: null,
        priority: 'normal',
      },
    ])
    expect(batch!.tasks[0].statusChangedAt).toBe(batch!.tasks[0].createdAt)
  })
})

describe('4단 제한 (Q64)', () => {
  const reason = (choices: { id: string; disabledReason?: string }[], id: string) =>
    choices.find((c) => c.id === id)?.disabledReason
  const codeOfLastToast = () =>
    (vi.mocked(toastError).mock.calls.at(-1)?.[0] as { code?: string } | undefined)?.code

  it('등록 — 4단 작업은 상위로 못 고른다. 이유가 붙는다', () => {
    const task = useTaskStore()
    expect(reason(task.parentOptions, 'k8')).toBe('5단이 됩니다 · 4단까지')
    expect(reason(task.parentOptions, 'k7')).toBeUndefined()
    expect(task.canAddChild('k8')).toBe(false)
    expect(task.canAddChild('k7')).toBe(true)
  })

  it('수정 — 옮기는 작업의 하위 높이까지 센다. 지금 상위는 막지 않는다', () => {
    const task = useTaskStore()
    /* 가상비서(k7)는 하위까지 2단 — 3단 작업(AI 심사 k12) 밑으로 가면 5단이다 */
    const choices = task.parentOptionsFor('k7')
    expect(reason(choices, 'k12')).toBe('5단이 됩니다 · 4단까지')
    expect(reason(choices, 'k17')).toBe(undefined)
    expect(reason(choices, 'k6')).toBeUndefined()
    /* 하위가 없는 tool01(k8)은 3단 밑까지 갈 수 있다 */
    expect(reason(task.parentOptionsFor('k8'), 'k12')).toBeUndefined()
    expect(reason(task.parentOptionsFor('k8'), 'k13')).toBe('5단이 됩니다 · 4단까지')
  })

  it('목업은 서버처럼 400 TASK_DEPTH_EXCEEDED 로 막는다 — 등록 · 상위 바꾸기', async () => {
    const task = useTaskStore()
    const data = useDataStore()
    const before = data.allTasks.length
    const id = await task.addTask({
      title: '다섯째 단',
      parentId: 'k8',
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    expect(id).toBeNull()
    expect(data.allTasks).toHaveLength(before)
    expect(codeOfLastToast()).toBe('TASK_DEPTH_EXCEEDED')

    vi.mocked(toastError).mockClear()
    task.setParent('k7', 'k12')
    expect(data.allTasks.find((t) => t.id === 'k7')!.parentId).toBe('k6')
    expect(codeOfLastToast()).toBe('TASK_DEPTH_EXCEEDED')

    vi.mocked(toastError).mockClear()
    task.setParent('k7', 'k5')
    expect(data.allTasks.find((t) => t.id === 'k7')!.parentId).toBe('k5')
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('완료 숨기기 (Q64)', () => {
  it('처음은 켜짐 — 하위가 다 끝난 완료만 숨고, 수 · 리포트용 집계는 그대로다', () => {
    const task = useTaskStore()
    expect(task.hideDone).toBe(true)
    expect([...task.doneHiddenIds].sort()).toEqual(['k19', 'k2', 'k8'])
    expect(task.shownRows).toHaveLength(19)
    expect(task.statusCounts.done).toBe(3)
    expect(task.statusCounts.all).toBe(22)
  })

  it('안 끝난 하위가 있는 완료 상위는 남는다', () => {
    const task = useTaskStore()
    task.setStatus('k1', 'done')
    expect(task.doneHiddenIds.has('k1')).toBe(false)
    task.setStatus('k3', 'done')
    expect(task.doneHiddenIds.has('k1')).toBe(true)
  })

  it('끄면 다 보인다', () => {
    const task = useTaskStore()
    task.setHideDone(false)
    expect(task.doneHiddenIds.size).toBe(0)
    expect(task.shownRows).toHaveLength(22)
  })
})

describe('고치기 · 지우기 권한', () => {
  const asU2 = async () => {
    resetMockAuth()
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
  }

  it('목업에서 등록하면 등록한 사람이 찍힌다', async () => {
    const task = useTaskStore()
    const id = await task.addTask({
      title: '새 작업',
      parentId: null,
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    expect(useDataStore().allTasks.find((t) => t.id === id)!.creatorId).toBe('u1')
  })

  it('못 고치는 사람이 고치면 목업도 403 FORBIDDEN 으로 알리고 그대로 둔다', async () => {
    await asU2()
    const task = useTaskStore()
    const k18 = useDataStore().allTasks.find((t) => t.id === 'k18')!
    task.setTitle('k18', '바꾼 제목')
    task.setPeriod('k18', '2026-10-01', '2026-10-02')
    task.linkThread('k18', 't1')
    expect(k18.title).toBe('보험료 산출 기간계 API 개발')
    expect(k18.start).toBeNull()
    expect(task.threadsOfTask('k18').map((t) => t.id)).toEqual(['t5'])
    expect(vi.mocked(toastError)).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    )
    expect(task.canEdit(k18)).toBe(false)
    expect(task.canDelete(k18)).toBe(false)
  })

  it('지우면 작업과 그 안건 연결을 뺀다. 하위가 있으면 ApiError 409 를 던지고 남긴다', async () => {
    const task = useTaskStore()
    const data = useDataStore()
    await expect(task.deleteTask('k4')).rejects.toMatchObject({ code: 'TASK_HAS_CHILDREN' })
    expect(data.allTasks.some((t) => t.id === 'k4')).toBe(true)

    await task.deleteTask('k22')
    expect(data.allTasks.some((t) => t.id === 'k22')).toBe(false)
    expect(data.taskThreads.some((l) => l.taskId === 'k22')).toBe(false)
    expect(task.taskDetail('k4')!.children.map((c) => c.task.key)).not.toContain('HW-22')
  })
})

describe('줄 끌어 옮기기', () => {
  /* 형제를 order 로 세운 키 — 간트 · 하위 목록이 보는 순서 */
  const keysUnder = (parentId: string | null) =>
    useDataStore()
      .allTasks.filter((t) => t.projectId === 'p1' && t.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((t) => `${t.key}:${t.order}`)
  const lastCode = () =>
    (vi.mocked(toastError).mock.calls.at(-1)?.[0] as { code?: string } | undefined)?.code

  it('픽스처는 같은 상위 안에서 배열 순서대로 0, 1, 2…', () => {
    expect(keysUnder(null)).toEqual(['HW-1:0', 'HW-4:1', 'HW-5:2'])
    expect(keysUnder('k4')).toEqual(['HW-19:0', 'HW-20:1', 'HW-21:2', 'HW-22:3'])
  })

  it('같은 상위 안에서 순서만 바꾼다 — 0..n 으로 다시 매기고 이력은 안 남긴다', async () => {
    const task = useTaskStore()
    /* 목업 이력은 검사 사이에 안 비워진다 — 전 · 후 줄 수를 견준다 */
    const logged = (await fetchTaskHistory('k22')).length
    task.moveTask('k22', 'k4', 'k20')
    expect(keysUnder('k4')).toEqual(['HW-19:0', 'HW-22:1', 'HW-20:2', 'HW-21:3'])
    expect(await fetchTaskHistory('k22')).toHaveLength(logged)
    /* 하위 목록도 같은 순서다 */
    expect(task.taskDetail('k4')!.children.map((c) => c.task.key)).toEqual([
      'HW-19',
      'HW-22',
      'HW-20',
      'HW-21',
    ])

    task.moveTask('k19', 'k4', null)
    expect(keysUnder('k4')).toEqual(['HW-22:0', 'HW-20:1', 'HW-21:2', 'HW-19:3'])
  })

  it('다른 상위로 — 옛 형제도 다시 매기고 parentId 이력이 한 줄', async () => {
    const task = useTaskStore()
    task.moveTask('k20', 'k1', 'k3')
    expect(keysUnder('k1')).toEqual(['HW-2:0', 'HW-20:1', 'HW-3:2'])
    expect(keysUnder('k4')).toEqual(['HW-19:0', 'HW-21:1', 'HW-22:2'])
    const lines = (await fetchTaskHistory('k20')).map((e) => e.changes)
    expect(lines.filter((c) => c.some((x) => x.field === 'parentId'))).toEqual([
      [change('parentId', 'k4', 'k1')],
    ])
  })

  it('최상위로 — beforeId 가 null 이면 맨 끝', () => {
    const task = useTaskStore()
    task.moveTask('k6', null, 'k4')
    expect(keysUnder(null)).toEqual(['HW-1:0', 'HW-6:1', 'HW-4:2', 'HW-5:3'])
    task.moveTask('k17', null, null)
    expect(keysUnder(null)).toEqual(['HW-1:0', 'HW-6:1', 'HW-4:2', 'HW-5:3', 'HW-17:4'])
    expect(keysUnder('k5')).toEqual(['HW-18:0'])
  })

  it('같은 자리면 아무것도 안 바뀐다', async () => {
    const task = useTaskStore()
    const before = JSON.stringify(useDataStore().allTasks)
    task.moveTask('k20', 'k4', 'k21')
    expect(JSON.stringify(useDataStore().allTasks)).toBe(before)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('4단을 넘으면 400 TASK_DEPTH_EXCEEDED · 자기 아래는 TASK_PARENT_DESCENDANT — 그대로 둔다', () => {
    const task = useTaskStore()
    const before = JSON.stringify(useDataStore().allTasks)
    /* 가상비서(k7)는 하위까지 2단 — 3단 작업(AI 심사 k12) 밑으로 가면 5단이다 */
    expect(task.canMove('k7', 'k12')).toBe(false)
    task.moveTask('k7', 'k12', null)
    expect(lastCode()).toBe('TASK_DEPTH_EXCEEDED')
    expect(task.canMove('k5', 'k7')).toBe(false)
    task.moveTask('k5', 'k7', null)
    expect(lastCode()).toBe('TASK_PARENT_DESCENDANT')
    task.moveTask('k20', 'k4', 'k2')
    expect(lastCode()).toBe('TASK_BEFORE_NOT_SIBLING')
    expect(JSON.stringify(useDataStore().allTasks)).toBe(before)

    expect(task.canMove('k8', 'k12')).toBe(true)
  })

  it('못 고치는 작업은 403 FORBIDDEN 으로 알리고 그대로 둔다', async () => {
    resetMockAuth()
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    const task = useTaskStore()
    /* HW-18: 담당 정하늘(u4) · 등록 이도현(u3) */
    expect(task.canMove('k18', null)).toBe(false)
    task.moveTask('k18', null, null)
    expect(lastCode()).toBe('FORBIDDEN')
    expect(useDataStore().allTasks.find((t) => t.id === 'k18')!.parentId).toBe('k5')
  })

  it('새 작업은 그 상위의 맨 끝이다', async () => {
    const task = useTaskStore()
    const id = await task.addTask({
      title: '새 하위',
      parentId: 'k4',
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: [],
    })
    expect(useDataStore().allTasks.find((t) => t.id === id)!.order).toBe(4)
  })

  it('상위 바꾸기(PATCH)도 새 상위의 맨 끝으로 간다', () => {
    useTaskStore().setParent('k20', 'k1')
    expect(keysUnder('k1')).toEqual(['HW-2:0', 'HW-3:1', 'HW-20:2'])
  })
})

describe('내 작업만 (간트)', () => {
  it('내가 등록했거나 담당인 작업과 그 조상만 남기고, 내 것이 아닌 조상은 흐리게 둔다', () => {
    const task = useTaskStore()
    const me = useAuthStore().me!.id
    task.setHideDone(false)
    const all = task.shownRows.map((r) => r.task)
    expect(task.mineOnly).toBe(false)

    task.setMineOnly(true)
    const mine = all.filter((t) => t.creatorId === me || t.ownerId === me)
    expect(mine.length).toBeGreaterThan(0)
    const byId = new Map(all.map((t) => [t.id, t]))
    const ancestors = new Set<string>()
    for (const t of mine) {
      for (let at = t.parentId; at && byId.has(at); at = byId.get(at)!.parentId) ancestors.add(at)
    }
    const expected = all.filter((t) => mine.includes(t) || ancestors.has(t.id)).map((t) => t.id)

    expect(task.shownRows.map((r) => r.task.id)).toEqual(expected)
    expect(task.mineShownCount).toBe(mine.length)
    for (const id of ancestors) expect(task.isMineContext(id)).toBe(!mine.some((t) => t.id === id))
    for (const t of mine) expect(task.isMineContext(t.id)).toBe(false)

    task.setMineOnly(false)
    expect(task.shownRows.map((r) => r.task.id)).toEqual(all.map((t) => t.id))
  })

  it('완료 숨기기와 같이 걸린다 — 숨긴 완료는 내 것이어도 안 선다', () => {
    const task = useTaskStore()
    task.setHideDone(true)
    task.setMineOnly(true)
    expect(task.shownRows.some((r) => r.task.status === 'done' && !r.childCount)).toBe(false)
  })
})

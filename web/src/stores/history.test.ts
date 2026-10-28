import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTaskHistory } from '@/api/history'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { change } from '@/lib/history'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { useTaskStore } from '@/stores/task'
import { useTestStore } from '@/stores/test'

/* 목업의 작업 쓰기가 계약의 칸 규칙대로 이력을 남기고, 쓰기가 끝나면 이력 칸에 알린다 (docs/api/history.md) */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

beforeEach(async () => {
  resetMockAuth()
  setActivePinia(createPinia())
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
})

afterEach(() => {
  vi.useRealTimers()
})

const lines = async (taskId: string) => (await fetchTaskHistory(taskId)).slice(1)

describe('목업 작업 쓰기의 이력', () => {
  it('PATCH 는 바뀐 칸만 — 같은 값이면 줄이 없다. 바꾼 사람은 로그인한 사람', async () => {
    const tasks = useTaskStore()
    tasks.setStatus('k4', 'doing')
    tasks.setPriority('k4', 'normal')
    expect(await lines('k4')).toEqual([])

    tasks.setStatus('k4', 'done')
    tasks.setOwner('k4', 'u1')
    tasks.setPeriod('k4', '2026-09-08', '2026-09-20')
    const got = await lines('k4')
    expect(got.map((e) => e.changes)).toEqual([
      [change('status', 'doing', 'done')],
      [change('ownerId', 'u3', 'u1')],
      [change('due', '2026-09-15', '2026-09-20')],
    ])
    expect(got.every((e) => e.changedBy === 'u1' && !e.backfilled)).toBe(true)
  })

  it('체크는 lineDone(줄 글), 본문은 이어 고친 것을 한 줄로', async () => {
    const tasks = useTaskStore()
    tasks.toggleBodyLine('k4', 'l3')
    const body = tasks.taskDetail('k4')!.task.body
    tasks.setBody('k4', [{ ...body[0], text: '서버 신청서 제출 (공유)' }, ...body.slice(1)])
    tasks.setBody('k4', [{ ...body[0], text: '서버 신청서 제출 (공유함)' }, ...body.slice(1)])
    expect((await lines('k4')).map((e) => e.changes)).toEqual([
      [change('lineDone', false, true, 'mysql 설치와 계정 발급')],
      [change('body', null, null)],
    ])
  })

  it('안건 링크는 새로 걸 때 · 있던 것을 뗄 때만', async () => {
    const tasks = useTaskStore()
    tasks.linkThread('k4', 't1')
    tasks.linkThread('k3', 't1')
    tasks.unlinkThread('k3', 't1')
    tasks.unlinkThread('k3', 't1')
    expect(await lines('k4')).toEqual([])
    expect((await lines('k3')).map((e) => e.changes)).toEqual([
      [change('thread', null, 't1')],
      [change('thread', 't1', null)],
    ])
  })

  it('추가하면 등록 한 줄 — 같이 건 안건은 따로 줄을 안 만든다', async () => {
    const id = await useTaskStore().addTask({
      title: '새 작업',
      parentId: null,
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: ['t1'],
      partId: null,
    })
    expect((await fetchTaskHistory(id!)).map((e) => e.changes)).toEqual([
      [change('created', null, null)],
    ])
  })
})

describe('이력 칸에 알리기', () => {
  it('작업 · 테스트 쓰기가 끝나면 revision 이 오른다', async () => {
    const history = useHistoryStore()
    useTaskStore().setStatus('k4', 'done')
    expect(history.revisionOf('task', 'k4')).toBe(1)

    const tests = useTestStore()
    await tests.load()
    await tests.setStatus('tc3', { status: 'pass' })
    expect(history.revisionOf('test', 'tc3')).toBe(1)
    await tests.patch('tc3', { title: '잠금' })
    expect(history.revisionOf('test', 'tc3')).toBe(2)
  })

  it('load 는 마지막 요청만 받는다', async () => {
    const history = useHistoryStore()
    await Promise.all([history.load('task', 'k20'), history.load('task', 'k20')])
    expect(history.statusOf('task', 'k20')).toBe('ready')
    expect(history.entriesOf('task', 'k20')).toHaveLength(2)
  })
})

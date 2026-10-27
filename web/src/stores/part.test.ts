// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { TaskInput } from '@/types/domain'

/* 파트 — 목업 갈래로 로그인해서 [내 파트 | 전체] 와 파트 관리가 서버처럼 도는지 본다.
   보기 규칙 자체는 lib/part.test.ts 가 꼼꼼히 본다. 여기는 스토어 · 목업 서버에 닿는지 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

const lastError = () => vi.mocked(toastError).mock.calls.at(-1)?.[0]

const blankTask = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: '새 작업',
  body: [],
  status: 'todo',
  ownerId: null,
  start: null,
  due: null,
  priority: 'normal',
  threadIds: [],
  ...over,
})

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
})

describe('[내 파트 | 전체]', () => {
  it('일반 사용자(u3 · 인프라)는 내 파트로 시작한다 — 목록 · 수가 같이 줄어든다', async () => {
    await signedIn('u3@innoflow.local')
    const part = usePartStore()
    const task = useTaskStore()
    const thread = useThreadStore()

    expect(part.canNarrow).toBe(true)
    expect(part.scope).toBe('mine')
    expect(task.visibleRows.map((r) => r.task.key)).not.toContain('HW-7')
    expect(task.visibleRows.map((r) => r.task.key)).toContain('HW-4')
    expect(task.statusCounts.all).toBe(10)
    expect(task.undatedCount).toBe(0)
    expect(thread.visibleRows.map((r) => r.thread.id).sort()).toEqual([
      't1',
      't2',
      't4',
      't6',
      't9',
    ])
    /* 원본 행은 그대로다 — 상세 · 챗봇은 거르지 않는다 */
    expect(task.rows).toHaveLength(22)
    expect(task.taskDetail('k7')).not.toBeNull()
  })

  it('전체로 바꾸면 다 보이고, 그 값은 프로젝트마다 브라우저에 남는다', async () => {
    await signedIn('u3@innoflow.local')
    const part = usePartStore()
    part.setScope('all')
    expect(useTaskStore().visibleRows).toHaveLength(22)
    expect(localStorage.getItem('innoflow.partScope.u3.p1')).toBe('all')

    /* 새로 들어와도(스토어를 새로 세워도) 기억한 값으로 선다 */
    setActivePinia(createPinia())
    await signedIn('u3@innoflow.local')
    expect(usePartStore().scope).toBe('all')
  })

  it('프로젝트 관리자(u1)는 전체로 시작하고, 내 파트로 바꿀 수 있다', async () => {
    await signedIn('u1@innoflow.local')
    const part = usePartStore()
    expect(part.scope).toBe('all')
    part.setScope('mine')
    const ids = useTaskStore().visibleRows.map((r) => r.task.id)
    expect(ids).toContain('k21')
    /* k21 이 연관으로 건 HW-4(기반 파트 · 남의 담당)는 끌려오지 않는다 (Q61) */
    expect(ids).not.toContain('k4')
  })

  it('속한 파트가 없으면 전환이 숨고 전체다 — 시스템 관리자 · 파트 없는 프로젝트', async () => {
    await signedIn('admin@innoflow.local', MOCK_ADMIN_PASSWORD)
    expect(usePartStore().canNarrow).toBe(false)
    expect(usePartStore().scope).toBe('all')

    setActivePinia(createPinia())
    await signedIn('u2@innoflow.local')
    const data = useDataStore()
    expect(usePartStore().scope).toBe('mine')
    data.setProject('p2')
    expect(usePartStore().parts).toEqual([])
    expect(usePartStore().canNarrow).toBe(false)
    expect(useTaskStore().visibleRows.map((r) => r.task.key)).toEqual(['PAS-1', 'PAS-2'])
  })

  it('파트를 빼면 그 자리에서 내 파트가 다시 계산된다', async () => {
    await signedIn('u1@innoflow.local')
    const part = usePartStore()
    expect(part.myPartIds.has('pt2')).toBe(true)
    expect(await part.leavePart('pt2', 'u1')).toBe(true)
    expect(part.canNarrow).toBe(false)
  })
})

describe('작업 · 안건의 partId (목업 서버)', () => {
  it('작업 등록에서 partId 를 안 보내거나 null 이면 공통이다 — 따를 상위가 없다 (Q61)', async () => {
    await signedIn('u1@innoflow.local')
    const task = useTaskStore()
    const data = useDataStore()
    const unsent = await task.addTask(blankTask())
    const common = await task.addTask(blankTask({ partId: null }))
    const placed = await task.addTask(blankTask({ partId: 'pt2' }))
    const byId = (id: string | null) => data.allTasks.find((t) => t.id === id)!
    expect(byId(unsent).partId).toBeNull()
    expect(byId(common).partId).toBeNull()
    expect(byId(placed).partId).toBe('pt2')
  })

  it('다른 프로젝트 · 없는 파트는 PART_NOT_FOUND, 보관 파트를 새로 달면 PART_ARCHIVED', async () => {
    await signedIn('u1@innoflow.local')
    const task = useTaskStore()
    const part = usePartStore()

    expect(await task.addTask(blankTask({ partId: 'nope' }))).toBeNull()
    expect(lastError()).toMatchObject({ status: 400, code: 'PART_NOT_FOUND' })

    await part.setPartActive('pt1', false)
    expect(await task.addTask(blankTask({ partId: 'pt1' }))).toBeNull()
    expect(lastError()).toMatchObject({ code: 'PART_ARCHIVED' })

    /* 이미 달린 보관 파트를 그대로 두는 수정은 막지 않는다 — 다른 칸은 고쳐진다 */
    task.setPart('k1', 'pt1')
    expect(useDataStore().allTasks.find((t) => t.id === 'k1')!.partId).toBeNull()
    task.setTitle('k4', '개발 환경 설정 2')
    expect(useDataStore().allTasks.find((t) => t.id === 'k4')!.partId).toBe('pt1')
  })

  it('작업의 파트를 바꿔도 그 작업을 연관으로 건 작업은 따라 바뀌지 않는다', async () => {
    await signedIn('u1@innoflow.local')
    const task = useTaskStore()
    const data = useDataStore()
    task.setPart('k4', 'pt2')
    expect(data.allTasks.find((t) => t.id === 'k4')!.partId).toBe('pt2')
    expect(data.allTasks.find((t) => t.id === 'k19')!.partId).toBe('pt1')
  })

  it('안건은 안 보내면 공통이고, 수정으로 파트를 바꾼다', async () => {
    await signedIn('u1@innoflow.local')
    const thread = useThreadStore()
    const data = useDataStore()
    const id = await thread.addThread({ title: '배포 창구' })
    expect(data.allThreads.find((t) => t.id === id)!.partId).toBeNull()
    const placed = await thread.addThread({ title: 'GPU 신청', partId: 'pt2' })
    expect(data.allThreads.find((t) => t.id === placed)!.partId).toBe('pt2')

    expect(thread.updateThread('t6', { partId: 'pt3' })).toBe(true)
    expect(data.allThreads.find((t) => t.id === 't6')!.partId).toBe('pt3')
    expect(thread.updateThread('t6', { partId: 'nope' })).toBe(false)
    expect(lastError()).toMatchObject({ code: 'PART_NOT_FOUND' })
  })
})

describe('파트 관리 (목업 서버)', () => {
  it('만들면 이름 순으로 서고, 같은 이름(보관 포함)은 PART_NAME_TAKEN', async () => {
    await signedIn('u1@innoflow.local')
    const part = usePartStore()
    expect(await part.createPart('  디자인  ')).toBe(true)
    expect(part.parts.map((p) => p.name)).toEqual(['AI', '기간계 연동', '디자인', '인프라'])

    await part.setPartActive('pt1', false)
    expect(await part.createPart('인프라')).toBe(false)
    expect(lastError()).toMatchObject({ status: 409, code: 'PART_NAME_TAKEN' })
    expect(await part.renamePart('pt2', '기간계 연동')).toBe(false)
    expect(lastError()).toMatchObject({ code: 'PART_NAME_TAKEN' })
  })

  it('이름 바꾸기 · 보관 · 되살리기 — 보관하면 고를 수 있는 목록에서 빠진다', async () => {
    await signedIn('u1@innoflow.local')
    const part = usePartStore()
    expect(await part.renamePart('pt1', '인프라 · 보안')).toBe(true)
    expect(part.partName('pt1')).toBe('인프라 · 보안')

    await part.setPartActive('pt1', false)
    expect(part.choicesFor(null).map((p) => p.id)).toEqual(['pt2', 'pt3'])
    expect(part.choicesFor('pt1').map((p) => p.id)).toContain('pt1')
    await part.setPartActive('pt1', true)
    expect(part.choicesFor(null).map((p) => p.id)).toContain('pt1')
  })

  it('일반 사용자는 못 만든다 — FORBIDDEN', async () => {
    await signedIn('u3@innoflow.local')
    expect(await usePartStore().createPart('디자인')).toBe(false)
    expect(lastError()).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('프로젝트에 부여되지 않은 사람은 파트에 못 넣는다 — MEMBER_NOT_IN_PROJECT. 넣기는 멱등', async () => {
    await signedIn('u1@innoflow.local')
    const part = usePartStore()
    expect(await part.joinPart('pt1', 'u0')).toBe(false)
    expect(lastError()).toMatchObject({ status: 400, code: 'MEMBER_NOT_IN_PROJECT' })

    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(await part.joinPart('pt1', 'u2')).toBe(true)
    expect(part.membersOf('pt1')).toEqual(['u3', 'u2'])
    expect(await part.joinPart('nope', 'u2')).toBe(false)
    expect(lastError()).toMatchObject({ status: 404, code: 'PART_NOT_FOUND' })
  })

  it('프로젝트에서 사람을 빼면 그 사람의 파트 소속도 같이 걷힌다', async () => {
    await signedIn('u1@innoflow.local')
    const data = useDataStore()
    const part = usePartStore()
    expect(part.partIdsOf('u4').has('pt2')).toBe(true)
    expect(await data.revokeMember('p1', 'u4')).toBe(true)
    expect(part.partIdsOf('u4').size).toBe(0)
    expect(part.membersOf('pt2')).toEqual(['u1'])
    /* 다시 부여해도 파트는 비어 있다 — 목업 서버에서도 지워졌다 */
    await data.grantMember('p1', 'u4', 'user')
    expect(await part.joinPart('pt2', 'u4')).toBe(true)
  })
})

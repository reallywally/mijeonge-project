import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isUnreachable } from '@/api'
import {
  entries,
  members,
  partMembers,
  parts,
  projectGrants,
  projects,
  tasks,
  taskThreadLinks,
  threads,
} from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useDataStore } from '@/stores/data'
import { usePartStore } from '@/stores/part'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'
import type { Me, ProjectSnapshot, Task } from '@/types/domain'

/* 서버 모드 — fetch 를 가짜로 바꿔 부팅 순서 · 늦게 온 응답 · 실패 되돌리기를 본다.
   계산은 목업 모드 테스트(task · thread)가 보니 여기서는 오가는 것만 본다. */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

type Reply = Response | Promise<Response>
const routes = new Map<string, (body: unknown) => Reply>()
const calls: { route: string; body: unknown }[] = []

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function on(route: string, reply: (body: unknown) => Reply) {
  routes.set(route, reply)
}

/** 손으로 풀어 주는 응답 — 순서 없이 도착하는 경우를 만든다 */
function later() {
  let resolve!: (res: Response) => void
  const promise = new Promise<Response>((r) => (resolve = r))
  return { promise, resolve }
}

const snapshotOf = (projectId: string): ProjectSnapshot => ({
  project: projects.find((p) => p.id === projectId)!,
  threads: threads.filter((t) => t.projectId === projectId),
  entries: entries.filter((e) =>
    threads.some((t) => t.id === e.threadId && t.projectId === projectId),
  ),
  tasks: tasks.filter((t) => t.projectId === projectId),
  taskThreadLinks: taskThreadLinks.filter((l) =>
    tasks.some((t) => t.id === l.taskId && t.projectId === projectId),
  ),
  parts: parts.filter((p) => p.projectId === projectId),
  partMembers: partMembers.filter((pm) =>
    parts.some((p) => p.id === pm.partId && p.projectId === projectId),
  ),
})

/** 시스템 관리자로 들어와 있다 — 프로젝트 셋을 다 본다 */
const me: Me = {
  id: 'u0',
  name: '관리자',
  email: 'admin@inno-ax.com',
  systemRole: 'admin',
  projectRoles: {},
}

const membersOf = (projectId: string) =>
  projectGrants
    .filter((g) => g.projectId === projectId)
    .map(({ memberId, role }) => ({ memberId, role }))

const flush = () => new Promise((r) => setTimeout(r, 0))

async function booted() {
  const data = useDataStore()
  await data.boot()
  return data
}

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK', 'false')
  routes.clear()
  calls.length = 0
  vi.mocked(toastError).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const route = `${init?.method ?? 'GET'} ${url}`
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ route, body })
      const reply = routes.get(route)
      if (!reply) throw new Error(`안 정한 요청: ${route}`)
      return reply(body)
    }),
  )
  on('GET /api/auth/me', () => json(me))
  on('GET /api/projects', () => json(projects))
  on('GET /api/members', () => json(members))
  for (const p of projects) {
    on(`GET /api/projects/${p.id}/snapshot`, () => json(snapshotOf(p.id)))
    on(`GET /api/projects/${p.id}/members`, () => json(membersOf(p.id)))
  }
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('부팅', () => {
  it('나를 먼저 받고, 프로젝트 · 멤버를 같이 받고, 고른 프로젝트의 스냅샷 · 멤버를 받는다', async () => {
    const data = useDataStore()
    expect(data.status).toBe('loading')
    expect(data.allTasks).toEqual([])

    await data.boot()

    expect(calls.map((c) => c.route)).toEqual([
      'GET /api/auth/me',
      'GET /api/projects',
      'GET /api/members',
      'GET /api/projects/p1/snapshot',
      'GET /api/projects/p1/members',
    ])
    expect(data.status).toBe('ready')
    expect(data.currentMemberId).toBe('u0')
    expect(data.projectMembers.p1).toEqual(membersOf('p1'))
    expect(data.currentProjectId).toBe('p1')
    expect(data.allMembers).toHaveLength(members.length)
    expect(data.allTasks).toHaveLength(snapshotOf('p1').tasks.length)
    expect(data.taskThreads).toHaveLength(snapshotOf('p1').taskThreadLinks.length)
  })

  it('로그인 전이면(401) 나머지는 받지 않고 anonymous 로 선다', async () => {
    on('GET /api/auth/me', () =>
      json({ code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' }, 401),
    )
    const data = await booted()

    expect(data.status).toBe('anonymous')
    expect(data.bootError).toBeNull()
    expect(calls.map((c) => c.route)).toEqual(['GET /api/auth/me'])
  })

  it('프로젝트가 하나도 없으면 스냅샷 없이 뜬다 — 등록 화면으로 갈 자리다', async () => {
    on('GET /api/projects', () => json([]))
    const data = await booted()

    expect(data.status).toBe('ready')
    expect(data.currentProject).toBeNull()
    expect(calls.some((c) => c.route.includes('snapshot'))).toBe(false)
  })

  it('서버에 못 붙으면 오류로 서고, 다시 시도하면 붙는다', async () => {
    on('GET /api/projects', () => {
      throw new TypeError('Failed to fetch')
    })
    const data = await booted()
    expect(data.status).toBe('error')
    expect(isUnreachable(data.bootError)).toBe(true)

    on('GET /api/projects', () => json(projects))
    await data.retry()
    expect(data.status).toBe('ready')
    expect(data.bootError).toBeNull()
  })
})

describe('프로젝트 바꾸기', () => {
  it('늦게 온 옛 스냅샷은 버린다', async () => {
    const data = await booted()
    const slow = later()
    on('GET /api/projects/p2/snapshot', () => slow.promise)

    data.setProject('p2')
    data.setProject('p3')
    await flush()
    expect(data.loadedProjectId).toBe('p3')

    slow.resolve(json(snapshotOf('p2')))
    await flush()
    expect(data.currentProjectId).toBe('p3')
    expect(data.loadedProjectId).toBe('p3')
    expect(data.allTasks.every((t) => t.projectId === 'p3')).toBe(true)
    expect(data.syncing).toBe(false)
  })
})

describe('바로 저장하는 수정', () => {
  it('화면에 먼저 반영하고, 응답 레코드로 갈아끼운다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const k4 = data.allTasks.find((t) => t.id === 'k4')!
    on('PATCH /api/tasks/k4', (body) =>
      json({ ...k4, ...(body as object), title: '서버가 고친 제목' }),
    )

    task.setStatus('k4', 'done')
    expect(data.allTasks.find((t) => t.id === 'k4')!.status).toBe('done')
    expect(calls.at(-1)).toEqual({ route: 'PATCH /api/tasks/k4', body: { status: 'done' } })

    await flush()
    expect(data.allTasks.find((t) => t.id === 'k4')!.title).toBe('서버가 고친 제목')
  })

  it('실패하면 알리고 스냅샷을 다시 받아 서버 상태로 되돌린다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const before = data.allTasks.find((t) => t.id === 'k4')!.status
    on('PATCH /api/tasks/k4', () =>
      json(
        { code: 'TASK_PARENT_DESCENDANT', message: '하위 작업을 상위로 고를 수 없습니다.' },
        400,
      ),
    )

    task.setStatus('k4', before === 'done' ? 'todo' : 'done')
    await flush()

    expect(toastError).toHaveBeenCalledOnce()
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'TASK_PARENT_DESCENDANT' })
    expect(calls.slice(-2).map((c) => c.route)).toEqual([
      'GET /api/projects/p1/snapshot',
      'GET /api/projects/p1/members',
    ])
    expect(data.allTasks.find((t) => t.id === 'k4')!.status).toBe(before)
  })

  it('같은 레코드에 겹친 요청은 마지막에 보낸 것의 응답만 반영한다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const k4 = data.allTasks.find((t) => t.id === 'k4')!
    const slow = later()
    on('PATCH /api/tasks/k4', () => slow.promise)
    task.setOwner('k4', 'u1')
    on('PATCH /api/tasks/k4', () => json({ ...k4, ownerId: 'u2' }))
    task.setOwner('k4', 'u2')
    await flush()

    slow.resolve(json({ ...k4, ownerId: 'u1' }))
    await flush()
    expect(data.allTasks.find((t) => t.id === 'k4')!.ownerId).toBe('u2')
  })

  it('안건 수정도 보낸 필드만 실어 보내고 응답으로 갈아끼운다', async () => {
    const data = await booted()
    const thread = useThreadStore()
    const t3 = data.allThreads.find((t) => t.id === 't3')!
    on('PATCH /api/threads/t3', (body) => json({ ...t3, ...(body as object) }))

    thread.updateThread('t3', { options: [' 사내 모델만 ', ''] })
    expect(calls.at(-1)!.body).toEqual({ options: ['사내 모델만'] })
    await flush()
    expect(data.allThreads.find((t) => t.id === 't3')!.options).toEqual(['사내 모델만'])
  })

  it('본문은 모아서 보내고, 새 줄은 서버가 붙인 id 로 다음에 실어 보낸다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const k4 = data.allTasks.find((t) => t.id === 'k4')!
    vi.useFakeTimers()
    on('PATCH /api/tasks/k4', (body) => {
      const lines = (body as { body: Task['body'] }).body
      return json({ ...k4, body: lines.map((l) => (l.id === 'tmp1' ? { ...l, id: 'srv1' } : l)) })
    })

    const line = { id: 'tmp1', kind: 'check' as const, text: '서버', done: false, level: 0 }
    task.setBody('k4', [line])
    task.setBody('k4', [{ ...line, text: '서버 OS' }])
    expect(calls.some((c) => c.route === 'PATCH /api/tasks/k4')).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    const sent = calls.filter((c) => c.route === 'PATCH /api/tasks/k4')
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ body: [{ ...line, text: '서버 OS' }] })
    expect(data.allTasks.find((t) => t.id === 'k4')!.body[0].id).toBe('srv1')

    /* 편집기는 여전히 tmp1 을 들고 있다 — 다음에 보낼 때 서버 id 로 바뀌어 같은 줄로 남는다 */
    task.setBody('k4', [{ ...line, text: '서버 OS 결정', done: true }])
    await vi.advanceTimersByTimeAsync(500)
    expect(calls.at(-1)!.body).toEqual({
      body: [{ ...line, id: 'srv1', text: '서버 OS 결정', done: true }],
    })
  })
})

describe('만드는 것', () => {
  it('작업은 응답을 기다렸다가 넣고, id · key 는 서버 것을 쓴다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const made: Task = {
      ...data.allTasks[0],
      id: 'srv-task',
      key: 'HW-99',
      title: 'CI 러너 늘리기',
      parentId: null,
    }
    on('POST /api/projects/p1/tasks', () => json(made, 201))

    const pending = task.addTask({
      title: 'CI 러너 늘리기',
      parentId: null,
      body: [],
      status: 'todo',
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal',
      threadIds: ['t1'],
    })
    expect(data.allTasks.some((t) => t.id === 'srv-task')).toBe(false)

    expect(await pending).toBe('srv-task')
    expect(data.allTasks.find((t) => t.id === 'srv-task')!.key).toBe('HW-99')
    expect(data.taskThreads).toContainEqual({ taskId: 'srv-task', threadId: 't1' })
  })

  it('만들기가 실패하면 알리고 null 이다 — 아무것도 들어가지 않는다', async () => {
    const data = await booted()
    const thread = useThreadStore()
    const before = data.allThreads.length
    on('POST /api/projects/p1/threads', () =>
      json({ code: 'VALIDATION_ERROR', message: '제목을 적어 주세요.' }, 422),
    )

    expect(await thread.addThread({ title: '배포 창구' })).toBeNull()
    expect(toastError).toHaveBeenCalledOnce()
    expect(data.allThreads).toHaveLength(before)
  })

  it('이력 한 줄은 응답의 줄을 넣고 안건을 갈아끼운다', async () => {
    const data = await booted()
    const thread = useThreadStore()
    const t4 = data.allThreads.find((t) => t.id === 't4')!
    on('POST /api/threads/t4/entries', (body) =>
      json(
        {
          entry: {
            id: 'srv-e',
            threadId: 't4',
            ...(body as object),
            createdAt: '2026-10-11T01:00:00Z',
          },
          thread: { ...t4, state: 'decided', ownerId: 'u1' },
        },
        201,
      ),
    )

    expect(await thread.addEntry('t4', 'decide', '주 1회 백업', '', 'u1')).toBe(true)
    expect(calls.at(-1)!.body).toEqual({
      kind: 'decide',
      text: '주 1회 백업',
      detail: [],
      note: '',
      ownerId: 'u1',
    })
    expect(data.allEntries.at(-1)!.id).toBe('srv-e')
    expect(data.allThreads.find((t) => t.id === 't4')!.state).toBe('decided')
  })

  it('프로젝트를 만들면 그 프로젝트로 옮겨 스냅샷을 받는다', async () => {
    const data = await booted()
    const made = { id: 'p9', name: '새 프로젝트', taskKeyPrefix: 'K7QX' }
    on('POST /api/projects', () => json(made, 201))
    on('GET /api/projects/p9/snapshot', () =>
      json({
        project: made,
        threads: [],
        entries: [],
        tasks: [],
        taskThreadLinks: [],
        parts: [],
        partMembers: [],
      }),
    )
    on('GET /api/projects/p9/members', () => json([]))

    expect(await data.addProject('새 프로젝트', '')).toBe('p9')
    expect(calls.find((c) => c.route === 'POST /api/projects')!.body).toEqual({
      name: '새 프로젝트',
      taskKeyPrefix: '',
    })
    await flush()
    expect(data.currentProjectId).toBe('p9')
    expect(data.loadedProjectId).toBe('p9')
    expect(data.allTasks).toEqual([])
  })
})

describe('파트 (서버 갈래)', () => {
  it('스냅샷의 parts · partMembers 를 그대로 든다', async () => {
    const data = await booted()
    expect(data.parts).toEqual(snapshotOf('p1').parts)
    expect(data.partMembers).toEqual(snapshotOf('p1').partMembers)
  })

  it('만들기 · 이름 · 보관 · 넣기 · 빼기는 계약의 경로로 가고 응답으로 갈아끼운다', async () => {
    await booted()
    const part = usePartStore()
    const data = useDataStore()
    const made = { id: 'srv-pt', projectId: 'p1', name: '디자인', active: true }
    on('POST /api/projects/p1/parts', () => json(made, 201))
    on('PATCH /api/parts/srv-pt', (body) => json({ ...made, ...(body as object) }))
    on('PUT /api/parts/srv-pt/members/u2', () => json({ partId: 'srv-pt', memberId: 'u2' }))
    on('DELETE /api/parts/srv-pt/members/u2', () => new Response(null, { status: 204 }))

    expect(await part.createPart(' 디자인 ')).toBe(true)
    expect(calls.at(-1)).toEqual({ route: 'POST /api/projects/p1/parts', body: { name: '디자인' } })
    expect(part.partName('srv-pt')).toBe('디자인')

    await part.setPartActive('srv-pt', false)
    expect(calls.at(-1)!.body).toEqual({ active: false })
    expect(data.parts.find((p) => p.id === 'srv-pt')!.active).toBe(false)

    await part.joinPart('srv-pt', 'u2')
    /* 본문 없는 쓰기 — Content-Type 도 싣지 않는다 (Q29) */
    expect(calls.at(-1)).toEqual({ route: 'PUT /api/parts/srv-pt/members/u2', body: undefined })
    expect(part.membersOf('srv-pt')).toEqual(['u2'])
    await part.leavePart('srv-pt', 'u2')
    expect(part.membersOf('srv-pt')).toEqual([])
  })

  it('서버가 거절하면(PART_NAME_TAKEN) 알리고 아무것도 넣지 않는다', async () => {
    const data = await booted()
    on('POST /api/projects/p1/parts', () =>
      json({ code: 'PART_NAME_TAKEN', message: '같은 이름의 파트가 이미 있습니다.' }, 409),
    )
    const before = data.parts.length
    expect(await usePartStore().createPart('인프라')).toBe(false)
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'PART_NAME_TAKEN' })
    expect(data.parts).toHaveLength(before)
  })

  it('작업 등록은 partId 를 고른 그대로 싣고, 안 고르면 키째로 빼서 상위를 따르게 한다', async () => {
    const data = await booted()
    const task = useTaskStore()
    const made: Task = { ...data.allTasks[0], id: 'srv-k', key: 'HW-99', partId: 'pt2' }
    on('POST /api/projects/p1/tasks', () => json(made, 201))
    const input = {
      title: '하위',
      parentId: 'k7',
      body: [],
      status: 'todo' as const,
      ownerId: null,
      start: null,
      due: null,
      priority: 'normal' as const,
      threadIds: [],
    }

    await task.addTask(input)
    expect(calls.at(-1)!.body).not.toHaveProperty('partId')
    await task.addTask({ ...input, partId: null })
    expect(calls.at(-1)!.body).toMatchObject({ partId: null })
  })

  it('파트를 바꾸면 그 필드만 PATCH 한다', async () => {
    const data = await booted()
    const k4 = data.allTasks.find((t) => t.id === 'k4')!
    on('PATCH /api/tasks/k4', (body) => json({ ...k4, ...(body as object) }))
    useTaskStore().setPart('k4', null)
    expect(calls.at(-1)).toEqual({ route: 'PATCH /api/tasks/k4', body: { partId: null } })
  })

  it('프로젝트에서 사람을 빼면 그 사람의 파트 소속도 스토어에서 걷는다', async () => {
    const data = await booted()
    on('DELETE /api/projects/p1/members/u4', () => new Response(null, { status: 204 }))
    expect(await data.revokeMember('p1', 'u4')).toBe(true)
    expect(data.partMembers.some((pm) => pm.memberId === 'u4')).toBe(false)
    expect(data.partMembers.some((pm) => pm.memberId === 'u1')).toBe(true)
  })
})

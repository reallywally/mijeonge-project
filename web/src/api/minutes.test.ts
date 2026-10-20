import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '@/api/auth'
import { ApiError, isUnreachable } from '@/api/client'
import { isAbort } from '@/api/chat'
import { resetMockAuth } from '@/api/mockAuth'
import { mockDb, writeMockSession } from '@/api/mockAuth'
import {
  applyMinutes,
  createMinutes,
  deleteMinutes,
  fetchMinutes,
  fetchMinutesList,
  patchMinutes,
  resetMockMinutes,
  streamMinutesDraft,
} from '@/api/minutes'
import {
  MINUTES_EXAMPLE,
  minutesRows,
  MOCK_PASSWORD,
  mockMinutesDraft,
  taskThreadLinks,
} from '@/fixtures'
import { toMinutesApplyInput } from '@/lib/minutes'
import type { MinutesApplyInput, MinutesEvent, MinutesInput } from '@/types/domain'

/* 회의록 api — 게시판 CRUD · 권한, 목업 갈래의 스트림 · 검사 · 생성 순서 · 출처, 서버 갈래의 경로 · SSE 읽기 (docs/api/minutes.md) */
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function collect(stream: AsyncIterable<MinutesEvent>) {
  const events: MinutesEvent[] = []
  const run = (async () => {
    for await (const e of stream) events.push(e)
  })().then(
    () => null,
    (e: unknown) => e,
  )
  await vi.runAllTimersAsync()
  return { events, error: await run }
}

/** 처음 로그인은 u1 로, 사람을 바꿀 때는 목업 세션만 바꾼다 — 목업 저장소를 비우지 않게 */
const signIn = async (who: string) => {
  resetMockAuth()
  await login({ email: `${who}@innoflow.local`, password: MOCK_PASSWORD })
}
const switchTo = (memberId: string) => writeMockSession(memberId)

/** 초안 전부를 고른 그대로 */
const fullInput = (): MinutesApplyInput =>
  toMinutesApplyInput(
    structuredClone(mockMinutesDraft),
    Object.fromEntries(
      [...mockMinutesDraft.threads, ...mockMinutesDraft.entries, ...mockMinutesDraft.tasks].map(
        (r) => [r.tempId, true],
      ),
    ),
  )

async function rejected(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return e as ApiError
  }
  throw new Error('거절되지 않았다')
}

describe('픽스처', () => {
  it('quote 는 예시 회의록에서 글자 그대로 옮긴 것이다', () => {
    const d = mockMinutesDraft
    for (const r of [...d.threads, ...d.entries, ...d.tasks])
      expect(MINUTES_EXAMPLE, r.tempId).toContain(r.quote)
  })

  it('시드 회의록 m1 — p1 · u1 · 본문은 예시 글 그대로 · 요약 없음', () => {
    expect(minutesRows).toEqual([
      expect.objectContaining({
        id: 'm1',
        projectId: 'p1',
        authorId: 'u1',
        title: '10월 셋째 주 주간 회의',
        meetingDate: '2026-10-16',
        body: MINUTES_EXAMPLE,
        summary: '',
      }),
    ])
  })

  it('계약대로 — 새 안건 2(하나는 미룸) · t3 에 미룸 1 · 작업 3(n1 · t2 · ownerHint 만)', () => {
    const d = mockMinutesDraft
    expect(d.threads.map((t) => t.entry?.kind ?? null)).toEqual([null, 'defer'])
    expect(d.entries.map((e) => [e.threadId, e.kind])).toEqual([['t3', 'defer']])
    expect(d.tasks.map((t) => [t.threadTempIds, t.threadIds, t.ownerId, t.ownerHint])).toEqual([
      [['n1'], [], 'u4', ''],
      [[], ['t2'], 'u3', ''],
      [[], [], null, '최 선임'],
    ])
  })
})

describe('목업 게시판', () => {
  beforeEach(async () => {
    await signIn('u1')
  })

  it('목록은 본문 · 요약 없이, 회의 날짜 내림차순(없으면 맨 뒤) → 나중에 쓴 것 먼저', async () => {
    await createMinutes('p1', { title: '날짜 없는 메모', meetingDate: null, body: '메모' })
    await createMinutes('p1', { title: '9월 회의', meetingDate: '2026-09-30', body: '글' })
    await createMinutes('p1', { title: '같은 날 두 번째', meetingDate: '2026-10-16', body: '글' })
    const list = await fetchMinutesList('p1')
    expect(list.map((m) => m.title)).toEqual([
      '같은 날 두 번째',
      '10월 셋째 주 주간 회의',
      '9월 회의',
      '날짜 없는 메모',
    ])
    expect(list[0]).not.toHaveProperty('body')
    expect(list[0]).not.toHaveProperty('summary')
    expect(await fetchMinutesList('p2')).toEqual([])
  })

  it('쓰기 — 작성자는 로그인한 사람, 앞뒤 공백을 뗀다. 읽기는 본문 · 요약까지', async () => {
    const m = await createMinutes('p1', {
      title: '  주간 회의  ',
      meetingDate: '2026-10-23',
      body: '\n본문\n',
    })
    expect(m).toMatchObject({ title: '주간 회의', body: '본문', summary: '', authorId: 'u1' })
    expect(m.createdAt).toBe(m.updatedAt)
    expect(await fetchMinutes(m.id)).toEqual(m)
    /* 회의 날짜가 빠지면 null */
    const bare = await createMinutes('p1', { title: '날짜 없음', body: '글' } as MinutesInput)
    expect(bare.meetingDate).toBeNull()
  })

  it('422 — 빈 제목 · 200자 넘는 제목 · 빈 본문 · 60,000자 넘는 본문 · 날짜 모양', async () => {
    const e = await rejected(createMinutes('p1', { title: ' ', meetingDate: '10/16', body: '   ' }))
    expect(e).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(Object.keys(e.detail!).sort()).toEqual(['body', 'meetingDate', 'title'])
    const long = await rejected(
      createMinutes('p1', { title: 'a'.repeat(201), meetingDate: null, body: 'a'.repeat(60_001) }),
    )
    expect(Object.keys(long.detail!).sort()).toEqual(['body', 'title'])
    /* 앞뒤 공백을 뗀 뒤 센다 */
    await createMinutes('p1', {
      title: 'a'.repeat(200),
      meetingDate: null,
      body: ` ${'a'.repeat(60_000)} `,
    })
  })

  it('남의 프로젝트 · 없는 회의록은 404 MINUTES_NOT_FOUND', async () => {
    expect(await rejected(fetchMinutes('zz'))).toMatchObject({
      status: 404,
      code: 'MINUTES_NOT_FOUND',
    })
    mockDb().minutes.push({ ...minutesRows[0], id: 'm9', projectId: 'p3' })
    switchTo('u2')
    expect(await rejected(fetchMinutes('m9'))).toMatchObject({ code: 'MINUTES_NOT_FOUND' })
    expect(await rejected(fetchMinutesList('p3'))).toMatchObject({ code: 'PROJECT_NOT_FOUND' })
  })

  it('고치기는 작성자만 — 보낸 칸만 바꾸고 고친 시각을 올린다', async () => {
    const m = await patchMinutes('m1', { title: '주간 회의(고침)' })
    expect(m).toMatchObject({
      title: '주간 회의(고침)',
      meetingDate: '2026-10-16',
      body: MINUTES_EXAMPLE,
    })
    expect(m.updatedAt > minutesRows[0].updatedAt).toBe(true)
    expect(await rejected(patchMinutes('m1', { body: '' }))).toMatchObject({ status: 422 })

    /* title · body 의 null 은 422, meetingDate 의 null 은 비우기, 보낸 칸이 없으면 고친 시각 그대로 */
    const nulls = await rejected(
      patchMinutes('m1', { title: null, body: null } as unknown as Partial<MinutesInput>),
    )
    expect(Object.keys(nulls.detail!).sort()).toEqual(['body', 'title'])
    const cleared = await patchMinutes('m1', { meetingDate: null })
    expect(cleared.meetingDate).toBeNull()
    expect((await patchMinutes('m1', {})).updatedAt).toBe(cleared.updatedAt)

    /* 시스템 관리자 · 같은 프로젝트 멤버도 남의 회의록은 못 고친다 */
    for (const who of ['u0', 'u2']) {
      switchTo(who)
      expect(await rejected(patchMinutes('m1', { title: '남이 고침' }))).toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      })
    }
  })

  it('지우기는 작성자 · 프로젝트 관리자 · 시스템 관리자 — 그 밖은 403', async () => {
    switchTo('u2')
    const mine = await createMinutes('p1', { title: 'u2 의 회의록', meetingDate: null, body: '글' })
    expect(await rejected(deleteMinutes('m1'))).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    /* 작성자 */
    await deleteMinutes(mine.id)
    /* 시스템 관리자 */
    switchTo('u0')
    const other = mockDb().minutes.length
    mockDb().minutes.push({ ...minutesRows[0], id: 'm8', authorId: 'u3' })
    await deleteMinutes('m8')
    expect(mockDb().minutes).toHaveLength(other)
    /* 프로젝트 관리자(u1 은 p1 관리자) — 남이 쓴 것도 */
    switchTo('u1')
    mockDb().minutes.push({ ...minutesRows[0], id: 'm7', authorId: 'u3' })
    await deleteMinutes('m7')
    expect(await rejected(fetchMinutes('m7'))).toMatchObject({ status: 404 })
  })
})

describe('목업 draft', () => {
  beforeEach(async () => {
    await signIn('u1')
    vi.useFakeTimers()
  })

  it('회의록과 상관없이 진행 줄 둘 → 초안 → done', async () => {
    const { events, error } = await collect(streamMinutesDraft('m1', new AbortController().signal))
    expect(error).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['tool', 'tool', 'draft', 'done'])
    expect(events.slice(0, 2).map((e) => (e.type === 'tool' ? e.label : ''))).toEqual([
      '"대화 로그" 기존 안건 찾는 중',
      '멤버 확인 중',
    ])
    const draft = events[2]
    expect(draft.type === 'draft' && draft.draft).toEqual(mockMinutesDraft)
  })

  it('없는 회의록 · 볼 수 없는 회의록은 스트림 전에 404', async () => {
    const { events, error } = await collect(streamMinutesDraft('zz', new AbortController().signal))
    expect(events).toEqual([])
    expect(error).toMatchObject({ status: 404, code: 'MINUTES_NOT_FOUND' })
  })

  it('멈추면 AbortError 로 끝나고 초안은 오지 않는다', async () => {
    const controller = new AbortController()
    const events: MinutesEvent[] = []
    const run = (async () => {
      for await (const e of streamMinutesDraft('m1', controller.signal)) {
        events.push(e)
        controller.abort()
      }
    })().catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    expect(isAbort(await run)).toBe(true)
    expect(events.map((e) => e.type)).toEqual(['tool'])
  })
})

describe('목업 apply', () => {
  beforeEach(async () => {
    resetMockMinutes()
    await signIn('u1')
  })

  it('새 안건 → 그 이력 → 기존 안건 이력 → 작업 → 링크 순으로 만든다', async () => {
    const r = await applyMinutes('m1', fullInput())

    expect(r.threads.map((t) => [t.title, t.state, t.partId, t.ownerId])).toEqual([
      ['가상비서 대화 로그 보관 기간', 'queued', null, 'u4'],
      /* 미룸 이력이 붙어 논의중으로 */
      ['기간계 테스트 데이터 마스킹 범위', 'open', null, 'u2'],
    ])
    expect(r.threadIdByTempId).toEqual({ n1: r.threads[0].id, n2: r.threads[1].id })
    /* 새 안건 것 먼저, 그다음 기존 안건 것 */
    expect(r.entries.map((e) => [e.threadId, e.kind])).toEqual([
      [r.threads[1].id, 'defer'],
      ['t3', 'defer'],
    ])
    /* t3 는 이미 논의중이라 미룸으로 바뀌지 않는다 */
    expect(r.updatedThreads).toEqual([])
    expect(r.tasks.map((t) => [t.key, t.title, t.status, t.body, t.ownerId, t.due])).toEqual([
      ['HW-23', '가상비서 대화 로그 현황 조사', 'todo', [], 'u4', '2026-10-22'],
      ['HW-24', '운영 DB 계정 · 권한 표 작성', 'todo', [], 'u3', '2026-10-21'],
      ['HW-25', '통합 테스트 시나리오 초안 공유', 'todo', [], null, '2026-10-28'],
    ])
    expect(r.taskIdByTempId).toEqual({ t1: r.tasks[0].id, t2: r.tasks[1].id, t3: r.tasks[2].id })
    expect(r.links).toEqual([
      { taskId: r.tasks[0].id, threadId: r.threads[0].id },
      { taskId: r.tasks[1].id, threadId: 't2' },
    ])
    /* 데이터를 고치지 않는다 — 넣는 것은 스토어 몫 */
    expect(taskThreadLinks.some((l) => l.taskId === r.tasks[0].id)).toBe(false)
  })

  it('만든 안건 · 이력 · 작업에 출처를 달고, 회의록 요약을 저장한다', async () => {
    const r = await applyMinutes('m1', { ...fullInput(), summary: '  고친 요약  ' })
    expect([...r.threads, ...r.entries, ...r.tasks].map((x) => x.minutesId)).toEqual(
      Array(2 + 2 + 3).fill('m1'),
    )
    const saved = await fetchMinutes('m1')
    expect(saved.summary).toBe('고친 요약')
    /* 요약은 사람이 고친 것이 아니다 — 고친 시각은 그대로 */
    expect(saved.updatedAt).toBe(minutesRows[0].updatedAt)

    /* 기존 안건 자체에는 붙이지 않는다 */
    const input = fullInput()
    input.entries[0] = { ...input.entries[0], kind: 'decide' }
    /* null 은 안 보낸 것과 같다 */
    const again = await applyMinutes('m1', {
      ...input,
      summary: null,
    } as unknown as MinutesApplyInput)
    expect(again.updatedThreads.map((t) => [t.id, t.minutesId])).toEqual([['t3', null]])
    /* 요약을 안 보내면 그대로 */
    expect((await fetchMinutes('m1')).summary).toBe('고친 요약')
  })

  it('없는 회의록은 404, 틀리면 요약도 저장하지 않는다', async () => {
    expect(await rejected(applyMinutes('zz', fullInput()))).toMatchObject({
      status: 404,
      code: 'MINUTES_NOT_FOUND',
    })
    const input = { ...fullInput(), summary: '남으면 안 된다' }
    input.tasks[0].title = ''
    await rejected(applyMinutes('m1', input))
    expect((await fetchMinutes('m1')).summary).toBe('')

    const long = await rejected(applyMinutes('m1', { ...fullInput(), summary: 'a'.repeat(60_001) }))
    expect(long).toMatchObject({ status: 422, detail: { summary: expect.any(String) } })
  })

  it('결정 이력은 기존 안건을 결정됨으로, 처리한 사람을 담당자로 바꿔 updatedThreads 에 싣는다', async () => {
    const input = fullInput()
    input.entries[0] = { ...input.entries[0], kind: 'decide', ownerId: 'u2' }
    const r = await applyMinutes('m1', input)
    expect(r.updatedThreads.map((t) => [t.id, t.state, t.ownerId])).toEqual([
      ['t3', 'decided', 'u2'],
    ])
  })

  it('422 — detail 이 보낸 줄의 자리를 짚는다', async () => {
    const input = fullInput()
    input.threads[0].title = '  '
    input.threads[1].entry!.text = ''
    input.entries.push({ ...input.entries[0], tempId: 'e2' })
    input.tasks[0].threadTempIds = ['n9']
    input.tasks[1].start = '2026-10-30'
    input.tasks[2].parentTempId = 't9'
    input.tasks[2].tempId = 'n1'
    const e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
    expect(e.detail).toEqual({
      'threads.0.title': expect.any(String),
      'threads.1.entry.text': expect.any(String),
      'entries.1.threadId': '한 안건에 이력은 하나까지입니다.',
      'tasks.0.threadTempIds.0': '이 초안의 새 안건이 아닙니다.',
      'tasks.1.due': expect.any(String),
      'tasks.2.parentTempId': expect.any(String),
      'tasks.2.tempId': '임시 이름이 겹칩니다.',
    })
  })

  it('하나도 안 고르면 422(자리는 `요청`) · 작업 31개면 422(자리는 `tasks`)', async () => {
    const none = await rejected(applyMinutes('m1', { threads: [], entries: [], tasks: [] }))
    expect(none).toMatchObject({ status: 422 })
    expect(Object.keys(none.detail!)).toEqual(['요청'])
    const task = fullInput().tasks[2]
    const many = Array.from({ length: 31 }, (_, i) => ({ ...task, tempId: `t${i + 1}` }))
    const over = await rejected(applyMinutes('m1', { threads: [], entries: [], tasks: many }))
    expect(over.detail).toEqual({ tasks: '작업은 30개까지입니다.' })
  })

  it('새 안건 tempId 를 작업의 parentTempId 로 쓰면 422, 담당자가 있는 줄의 ownerHint 는 오류가 아니다', async () => {
    const input = fullInput()
    input.tasks[2] = { ...input.tasks[2], ownerId: 'u2', ownerHint: '최 선임' }
    expect((await applyMinutes('m1', input)).tasks[2].ownerId).toBe('u2')

    input.tasks[2].parentTempId = 'n1'
    const e = await rejected(applyMinutes('m1', input))
    expect(e.detail).toEqual({ 'tasks.2.parentTempId': expect.any(String) })
  })

  it('400 THREAD_NOT_FOUND — 없는 안건 · 다른 프로젝트 안건의 자리', async () => {
    const input = fullInput()
    input.entries[0].threadId = 't10'
    input.tasks[1].threadIds = ['t2', 'zz']
    /* 400 이 여럿 걸려도 앞 순서의 하나만 낸다 */
    input.tasks[0].ownerId = 'u5'
    const e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({ status: 400, code: 'THREAD_NOT_FOUND' })
    expect(e.detail).toEqual({
      'entries.0.threadId': '안건을 찾을 수 없습니다.',
      'tasks.1.threadIds.1': '안건을 찾을 수 없습니다.',
    })
  })

  it('담당자는 안건 → 이력 → 작업 순으로 따로 코드를 낸다', async () => {
    const input = fullInput()
    input.threads[1].ownerId = 'u5' // 비활성
    input.entries[0].ownerId = 'u0' // 부여 안 됨
    input.tasks[0].ownerId = 'u5'
    let e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({
      code: 'THREAD_OWNER_NOT_FOUND',
      detail: { 'threads.1.ownerId': expect.any(String) },
    })

    input.threads[1].ownerId = 'u2'
    e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({ code: 'ENTRY_OWNER_NOT_FOUND' })
    expect(e.detail).toEqual({ 'entries.0.ownerId': '담당자를 찾을 수 없습니다.' })

    input.entries[0].ownerId = 'u1'
    e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({
      code: 'TASK_OWNER_NOT_FOUND',
      detail: { 'tasks.0.ownerId': expect.any(String) },
    })
  })

  it('400 TASK_PARENT_NOT_FOUND — 다른 프로젝트의 작업 밑에는 못 붙인다. 있는 작업이면 파트를 따른다', async () => {
    const input = fullInput()
    input.tasks[2].parentId = 'x1'
    const e = await rejected(applyMinutes('m1', input))
    expect(e).toMatchObject({
      code: 'TASK_PARENT_NOT_FOUND',
      detail: { 'tasks.2.parentId': expect.any(String) },
    })

    input.tasks[2].parentId = 'k4'
    const r = await applyMinutes('m1', input)
    expect([r.tasks[2].parentId, r.tasks[2].partId]).toEqual(['k4', 'pt1'])
  })
})

describe('서버 갈래', () => {
  beforeEach(() => vi.stubEnv('VITE_USE_MOCK', 'false'))

  const encoder = new TextEncoder()
  const sse = (event: MinutesEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const streamOf = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(text))
          c.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  const serve = (res: Response) => {
    const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(res),
    )
    vi.stubGlobal('fetch', fake)
    return fake
  }
  async function read(stream: AsyncIterable<MinutesEvent>) {
    const events: MinutesEvent[] = []
    try {
      for await (const e of stream) events.push(e)
      return { events, error: null as unknown }
    } catch (error) {
      return { events, error }
    }
  }

  it('게시판 경로 — 목록 · 쓰기는 프로젝트 아래, 읽기 · 고치기 · 지우기는 /minutes/{id}', async () => {
    const fake = serve(new Response(JSON.stringify({}), { status: 200 }))
    const input = { title: '회의', meetingDate: null, body: '글' }
    await fetchMinutesList('p 1')
    await createMinutes('p1', input).catch(() => {})
    await fetchMinutes('m1').catch(() => {})
    await patchMinutes('m1', { title: '고침' }).catch(() => {})
    await deleteMinutes('m1').catch(() => {})
    expect(fake.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['GET', '/api/projects/p%201/minutes'],
      ['POST', '/api/projects/p1/minutes'],
      ['GET', '/api/minutes/m1'],
      ['PATCH', '/api/minutes/m1'],
      ['DELETE', '/api/minutes/m1'],
    ])
    expect(JSON.parse(fake.mock.calls[3][1].body as string)).toEqual({ title: '고침' })
  })

  it('POST /minutes/{id}/draft 는 본문 없이 보내고 tool · draft · done 을 읽는다', async () => {
    const fake = serve(
      streamOf(
        sse({ type: 'tool', name: 'search_threads', label: '기존 안건 찾는 중' }) +
          sse({ type: 'draft', draft: mockMinutesDraft }) +
          sse({ type: 'done' }),
      ),
    )
    const { events, error } = await read(streamMinutesDraft('m1', new AbortController().signal))
    expect(error).toBeNull()
    expect(fake.mock.calls[0][0]).toBe('/api/minutes/m1/draft')
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: undefined })
    expect(events.map((e) => e.type)).toEqual(['tool', 'draft', 'done'])
    const draft = events[1]
    expect(draft.type === 'draft' && draft.draft).toEqual(mockMinutesDraft)
  })

  it('스트림 중 error 는 그 code 의 ApiError, 초안 없이 done 이면 끊긴 것', async () => {
    serve(
      streamOf(
        sse({ type: 'tool', name: 'search_threads', label: '찾는 중' }) +
          sse({
            type: 'error',
            code: 'MINUTES_EMPTY',
            message: '회의록에서 정할 것 · 할 일을 찾지 못했습니다',
          }),
      ),
    )
    const empty = await read(streamMinutesDraft('m1', new AbortController().signal))
    expect(empty.error).toBeInstanceOf(ApiError)
    expect(empty.error).toMatchObject({ status: 200, code: 'MINUTES_EMPTY' })

    serve(streamOf(sse({ type: 'done' })))
    const bare = await read(streamMinutesDraft('m1', new AbortController().signal))
    expect(isUnreachable(bare.error)).toBe(true)
  })

  it('모양이 아닌 초안은 깨진 스트림이다', async () => {
    const broken = { ...mockMinutesDraft, tasks: [{ tempId: 't1' }] }
    serve(streamOf(`event: draft\ndata: ${JSON.stringify({ type: 'draft', draft: broken })}\n\n`))
    const { error } = await read(streamMinutesDraft('m1', new AbortController().signal))
    expect(isUnreachable(error)).toBe(true)
  })

  it('열리기 전 실패는 request 와 같은 판정 — 429 는 code 로', async () => {
    serve(
      new Response(JSON.stringify({ code: 'CHAT_RATE_LIMITED', message: '잠시 뒤에' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { error } = await read(streamMinutesDraft('m1', new AbortController().signal))
    expect(error).toMatchObject({ status: 429, code: 'CHAT_RATE_LIMITED' })
  })

  it('apply 는 POST /minutes/{id}/apply 에 고른 것과 요약을 그대로', async () => {
    const fake = serve(new Response(JSON.stringify({ threads: [] }), { status: 201 }))
    await applyMinutes('m1', fullInput())
    expect(fullInput().summary).toBe(mockMinutesDraft.summary)
    expect(fake.mock.calls[0][0]).toBe('/api/minutes/m1/apply')
    expect(fake.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fake.mock.calls[0][1].body as string)).toEqual(fullInput())
  })
})

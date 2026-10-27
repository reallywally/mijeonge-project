import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import * as api from '@/api'
import { ApiError } from '@/api'
import { CHAT_MOCK_ERROR_KEYWORD, chatReplies } from '@/fixtures/chat'
import { toastError } from '@/lib/notify'
import { useChatStore } from '@/stores/chat'
import { useDataStore } from '@/stores/data'

vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

/* 대화 상태 — 목업 스트림을 그대로 흘려 받는다. 타이머는 가짜라 조각 사이를 손으로 넘긴다 */
beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const step = (n = 1) => vi.advanceTimersByTimeAsync(api.MOCK_STEP_MS * n)

describe('챗봇 대화', () => {
  it('묻으면 user 줄과 받는 중인 assistant 줄이 서고, 끝나면 답 전체가 남는다', async () => {
    const chat = useChatStore()
    const done = chat.ask('  서버 OS 뭐로 정했지?  ')

    expect(chat.receiving).toBe(true)
    expect(chat.lines.map((l) => [l.role, l.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'streaming'],
    ])
    expect(chat.lines[0].text).toBe('서버 OS 뭐로 정했지?')

    await step(3)
    expect(chat.lines[1].tool).toBe(chatReplies[0].tools[0].label)

    await vi.runAllTimersAsync()
    await expect(done).resolves.toBe(true)
    expect(chat.receiving).toBe(false)
    expect(chat.lines[1]).toMatchObject({ status: 'done', text: chatReplies[0].answer, tool: '' })
  })

  it('받는 중에는 또 보내지 않고, 빈 글도 보내지 않는다', async () => {
    const chat = useChatStore()
    void chat.ask('OS')
    await expect(chat.ask('막힌 작업')).resolves.toBe(false)
    await expect(useChatStore().ask('   ')).resolves.toBe(false)
    expect(chat.lines).toHaveLength(2)
  })

  it('다음 질문에는 끝난 턴을 같이 싣는다', async () => {
    const chat = useChatStore()
    const spy = vi.spyOn(api, 'streamChat')
    void chat.ask('서버 OS 뭐로 정했지?')
    await vi.runAllTimersAsync()
    void chat.ask('막힌 작업 알려줘')

    expect(spy.mock.calls[1][0]).toBe('p1')
    expect(spy.mock.calls[1][1]).toEqual([
      { role: 'user', text: '서버 OS 뭐로 정했지?' },
      { role: 'assistant', text: chatReplies[0].answer },
      { role: 'user', text: '막힌 작업 알려줘' },
    ])
    await vi.runAllTimersAsync()
  })

  it('멈추면 받은 데까지 남기고 곧바로 다시 물을 수 있다', async () => {
    const chat = useChatStore()
    const done = chat.ask('서버 OS 뭐로 정했지?')
    await step(3 * chatReplies[0].tools.length + 2)
    const partial = chat.lines[1].text
    expect(partial.length).toBeGreaterThan(0)

    chat.stop()
    expect(chat.receiving).toBe(false)
    expect(chat.lines[1].status).toBe('stopped')

    await vi.runAllTimersAsync()
    await expect(done).resolves.toBe(false)
    expect(chat.lines[1].text).toBe(partial)
    expect(chat.lastError).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('스트림 중 오류는 그 줄에 달고 마지막 오류로 남긴다. 다시 묻기는 같은 질문을 새로 보낸다', async () => {
    const chat = useChatStore()
    void chat.ask(CHAT_MOCK_ERROR_KEYWORD)
    await vi.runAllTimersAsync()

    expect(chat.lines[1].status).toBe('error')
    expect(chat.lines[1].error).toBe('답을 만들지 못했습니다. 잠시 뒤 다시 물어 주세요.')
    expect(chat.lastError?.code).toBe('CHAT_UNAVAILABLE')
    expect(chat.receiving).toBe(false)

    const spy = vi.spyOn(api, 'streamChat')
    void chat.retry(chat.lines[1].id)
    expect(spy.mock.calls[0][1]).toEqual([{ role: 'user', text: CHAT_MOCK_ERROR_KEYWORD }])
    expect(chat.lines).toHaveLength(2)
    expect(chat.lastError).toBeNull()
    await vi.runAllTimersAsync()
  })

  it('비우면 받는 중인 요청을 끊고, 늦게 끝난 옛 요청이 새 대화를 건드리지 않는다', async () => {
    const chat = useChatStore()
    const old = chat.ask('서버 OS 뭐로 정했지?')
    await step(5)
    chat.reset()
    expect(chat.lines).toEqual([])
    expect(chat.receiving).toBe(false)

    void chat.ask('막힌 작업 알려줘')
    await vi.runAllTimersAsync()
    await old
    expect(chat.lines).toHaveLength(2)
    expect(chat.lines[1].text).toBe(chatReplies[2].answer)
  })

  it('프로젝트를 바꾸면 대화를 비운다', async () => {
    const chat = useChatStore()
    const data = useDataStore()
    void chat.ask('서버 OS 뭐로 정했지?')
    await step(5)

    data.setProject(data.allProjects[1].id)
    await nextTick()
    expect(chat.lines).toEqual([])
    expect(chat.receiving).toBe(false)
    await vi.runAllTimersAsync()
    expect(chat.lines).toEqual([])
  })
})

describe('작업 초안', () => {
  const MAKE = '간담회 준비 작업 만들어줘. 김서연한테 일정체크, 박지훈한테 준비물 체크'
  const FIX = '박지훈 말고 정하늘로 바꿔줘'

  async function asked(text: string) {
    const chat = useChatStore()
    void chat.ask(text)
    await vi.runAllTimersAsync()
    return chat.lines[chat.lines.length - 1]
  }

  it('초안은 답이 끝나면 그 답 줄에 대기 중으로 붙고, 저장은 하지 않는다', async () => {
    const data = useDataStore()
    const before = data.allTasks.length
    const answer = await asked(MAKE)

    expect(answer.status).toBe('done')
    expect(answer.proposal?.status).toBe('pending')
    expect(answer.proposal?.tasks.map((t) => t.title)).toEqual([
      '간담회 준비',
      '일정 체크',
      '준비물 체크',
    ])
    expect(data.allTasks).toHaveLength(before)
  })

  it('새 초안이 오면 앞의 대기 중 카드는 cancelled 로 접는다 — 대기 중은 늘 하나다', async () => {
    const first = await asked(MAKE)
    const second = await asked(FIX)
    expect(first.proposal?.status).toBe('cancelled')
    expect(second.proposal?.status).toBe('pending')
    expect(second.proposal?.tasks[2].ownerId).toBe('u4')
  })

  it('다음 질문에 그 답의 초안을 결과째로 싣는다', async () => {
    const chat = useChatStore()
    await asked(MAKE)
    const spy = vi.spyOn(api, 'streamChat')
    void chat.ask(FIX)
    const sent = spy.mock.calls[0][1]
    expect(sent[1]).toEqual({
      role: 'assistant',
      text: chatReplies.find((r) => r.keywords.includes('만들어'))!.answer,
      proposal: {
        ...chatReplies.find((r) => r.keywords.includes('만들어'))!.proposal,
        status: 'pending',
      },
    })
    expect(sent[0]).not.toHaveProperty('proposal')
    await vi.runAllTimersAsync()
  })

  it('등록하면 작업을 한 번에 넣고 registered · keyByTempId 가 찬다. 다음 질문에도 그대로 실린다', async () => {
    const chat = useChatStore()
    const data = useDataStore()
    const answer = await asked(MAKE)
    const nextKey = data.takeTaskKey('p1')
    const no = Number(nextKey.split('-')[1]) + 1

    const done = chat.register(answer.id)
    expect(chat.registering).toBe(answer.id)
    await expect(chat.register(answer.id)).resolves.toBe(false)
    await expect(done).resolves.toBe(true)

    expect(chat.registering).toBeNull()
    expect(answer.proposal?.status).toBe('registered')
    expect(answer.proposal?.keyByTempId).toEqual({
      t1: `HW-${no}`,
      t2: `HW-${no + 1}`,
      t3: `HW-${no + 2}`,
    })
    const made = data.allTasks.slice(-3)
    expect(made.map((t) => t.key)).toEqual([`HW-${no}`, `HW-${no + 1}`, `HW-${no + 2}`])
    expect(made[1]).toMatchObject({ relatedIds: [], ownerId: 'u1', status: 'todo' })
    expect(made.every((t) => t.relatedIds.length === 0)).toBe(true)

    await expect(chat.register(answer.id)).resolves.toBe(false)
    expect(data.allTasks.slice(-3)).toEqual(made)

    const spy = vi.spyOn(api, 'streamChat')
    void chat.ask('방금 만든 것에 하나 더')
    expect(spy.mock.calls[0][1][1].proposal).toMatchObject({
      status: 'registered',
      keyByTempId: answer.proposal?.keyByTempId,
    })
    await vi.runAllTimersAsync()
  })

  it('등록에 실패하면 알리고 대기 중으로 남는다 — 다시 누를 수 있다', async () => {
    const chat = useChatStore()
    const data = useDataStore()
    const answer = await asked(MAKE)
    const before = data.allTasks.length
    const error = new ApiError(400, {
      code: 'TASK_OWNER_NOT_FOUND',
      message: '담당자를 찾을 수 없습니다.',
    })
    vi.spyOn(api, 'createTasksBatch').mockRejectedValueOnce(error)

    await expect(chat.register(answer.id)).resolves.toBe(false)
    expect(toastError).toHaveBeenCalledWith(error)
    expect(answer.proposal?.status).toBe('pending')
    expect(chat.registering).toBeNull()
    expect(data.allTasks).toHaveLength(before)

    await expect(chat.register(answer.id)).resolves.toBe(true)
    expect(answer.proposal?.status).toBe('registered')
  })

  it('등록하는 동안에는 새 질문을 보내지 않는다', async () => {
    const chat = useChatStore()
    const answer = await asked(MAKE)
    const done = chat.register(answer.id)
    await expect(chat.ask(FIX)).resolves.toBe(false)
    await done
    expect(chat.lines).toHaveLength(2)
  })

  it('취소하면 접히고 등록할 수 없다', async () => {
    const chat = useChatStore()
    const answer = await asked(MAKE)
    chat.cancelProposal(answer.id)
    expect(answer.proposal?.status).toBe('cancelled')
    await expect(chat.register(answer.id)).resolves.toBe(false)
  })

  it('실패 · 멈춘 답에는 초안을 붙이지 않는다', async () => {
    const chat = useChatStore()
    void chat.ask(MAKE)
    await step(3 * 2 + 2)
    chat.stop()
    await vi.runAllTimersAsync()
    expect(chat.lines[1].status).toBe('stopped')
    expect(chat.lines[1].proposal).toBeUndefined()
  })
})

describe('챗봇 대화 — 서버 갈래', () => {
  const encoder = new TextEncoder()
  const sse = (type: string, payload: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`

  /** 내보낼 조각을 손으로 밀어 넣는 가짜 서버. 끊기면 signal 과 cancel 로 알 수 있다 */
  function server() {
    let push: (text: string) => void = () => undefined
    let close: () => void = () => undefined
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text))
        close = () => controller.close()
      },
      cancel,
    })
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetch)
    return {
      push: (text: string) => push(text),
      close: () => close(),
      cancel,
      fetch,
      signal: () => fetch.mock.calls[0][1]?.signal as AbortSignal,
    }
  }

  const settle = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    vi.useRealTimers()
    vi.stubEnv('VITE_USE_MOCK', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('tool 이면 찾는 중 한 줄, delta 는 이어 붙이고, done 에서 끝난다', async () => {
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('서버 OS 뭐로 하기로 했지?')

    s.push(sse('tool', { name: 'search_threads', label: '"OS" 안건 찾는 중' }))
    await settle()
    expect(chat.lines[1]).toMatchObject({ status: 'streaming', tool: '"OS" 안건 찾는 중' })

    s.push(sse('delta', { text: '우분투로 ' }) + sse('delta', { text: '정했습니다.' }).slice(0, 9))
    await settle()
    expect(chat.lines[1]).toMatchObject({ text: '우분투로 ', tool: '' })

    s.push(sse('delta', { text: '정했습니다.' }).slice(9) + sse('done', { refs: [] }))
    await expect(done).resolves.toBe(true)
    expect(chat.lines[1]).toMatchObject({ status: 'done', text: '우분투로 정했습니다.' })
    expect(chat.receiving).toBe(false)
  })

  it('스트림 중 CHAT_REFUSED 는 서버 문구를 그 줄에 달고, 다시 묻기를 할 수 있다', async () => {
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('아무거나')
    s.push(
      sse('error', {
        code: 'CHAT_REFUSED',
        message: '이 질문에는 답할 수 없습니다. 질문을 바꿔 다시 물어 주세요.',
      }),
    )
    await expect(done).resolves.toBe(false)
    expect(chat.lines[1]).toMatchObject({
      status: 'error',
      error: '이 질문에는 답할 수 없습니다. 질문을 바꿔 다시 물어 주세요.',
    })
    expect(chat.lastError).toMatchObject({ status: 200, code: 'CHAT_REFUSED' })
  })

  it('done 없이 닫히면 끊겼다고 그 줄에 단다', async () => {
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('OS')
    s.push(sse('delta', { text: '반쯤' }))
    s.close()
    await expect(done).resolves.toBe(false)
    expect(chat.lines[1]).toMatchObject({
      status: 'error',
      text: '반쯤',
      error: '답을 받다가 연결이 끊겼습니다. 다시 물어 주세요.',
    })
  })

  it('창을 닫으면(reset) 받는 중인 요청을 끊고 비운다', async () => {
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('OS')
    s.push(sse('delta', { text: '반쯤' }))
    await settle()

    chat.reset()
    expect(s.signal().aborted).toBe(true)
    await expect(done).resolves.toBe(false)
    expect(s.cancel).toHaveBeenCalled()
    expect(chat.lines).toEqual([])
    expect(chat.lastError).toBeNull()
  })

  it('프로젝트를 바꾸면 받는 중인 요청을 끊고 비운다', async () => {
    /* 프로젝트 목록은 목업으로 세워 두고 챗봇만 서버로 보낸다 — 스냅샷까지 가짜로 만들 일이 아니다 */
    vi.stubEnv('VITE_USE_MOCK', 'true')
    const data = useDataStore()
    vi.stubEnv('VITE_USE_MOCK', 'false')
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('OS')
    await settle()

    data.setProject(data.allProjects[1].id)
    await nextTick()
    expect(s.signal().aborted).toBe(true)
    await expect(done).resolves.toBe(false)
    expect(chat.lines).toEqual([])
  })

  it('멈추면 끊고 받은 데까지 남긴다', async () => {
    const s = server()
    const chat = useChatStore()
    const done = chat.ask('OS')
    s.push(sse('delta', { text: '반쯤' }))
    await settle()

    chat.stop()
    expect(s.signal().aborted).toBe(true)
    await expect(done).resolves.toBe(false)
    expect(chat.lines[1]).toMatchObject({ status: 'stopped', text: '반쯤' })
    expect(chat.lastError).toBeNull()
  })
})

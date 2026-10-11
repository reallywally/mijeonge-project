import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import * as api from '@/api'
import { CHAT_MOCK_ERROR_KEYWORD, chatReplies } from '@/fixtures/chat'
import { useChatStore } from '@/stores/chat'
import { useDataStore } from '@/stores/data'

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

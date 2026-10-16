// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { chatReplies } from '@/fixtures/chat'
import { useChatStore } from '@/stores/chat'
import { useDataStore } from '@/stores/data'
import ChatWidget from './ChatWidget.vue'

/* 여닫기 · 입력 키 · 멈추기가 화면에서 스토어까지 닿는지 본다 */
enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

/* 칩이 주소로 가는지 보려고 이름 있는 두 경로만 둔다 */
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/threads/:id', name: 'thread', component: { template: '<div />' } },
      { path: '/tasks/:id', name: 'task', component: { template: '<div />' } },
      { path: '/:any(.*)*', component: { template: '<div />' } },
    ],
  })
}

async function opened(router = makeRouter()) {
  const w = mount(ChatWidget, { attachTo: document.body, global: { plugins: [router] } })
  await w.get('button[aria-label="AI 도우미 열기"]').trigger('click')
  await nextTick()
  return w
}

const textarea = (w: ReturnType<typeof mount>) => w.get('textarea')

describe('챗봇 창', () => {
  it('버튼을 누르면 창이 열리고 입력칸에 포커스가 간다. 빈 대화면 예시 질문 셋이 선다', async () => {
    const w = await opened()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(document.activeElement).toBe(textarea(w).element)
    for (const q of ['서버 OS 뭐로 정했지?', '아직 안 정해진 안건 뭐 있어?', '막힌 작업 알려줘'])
      expect(w.text()).toContain(q)
  })

  it('예시 질문을 누르면 그 질문을 보낸다', async () => {
    const w = await opened()
    const example = w.findAll('button').find((b) => b.text() === '서버 OS 뭐로 정했지?')!
    await example.trigger('click')
    await vi.runAllTimersAsync()

    expect(w.text()).toContain(chatReplies[0].answer.split('\n')[0])
  })

  it('Enter 는 보내고, Shift+Enter 와 한글 조합 중 Enter 는 보내지 않는다', async () => {
    const w = await opened()
    const chat = useChatStore()
    await textarea(w).setValue('막힌 작업')

    await textarea(w).trigger('keydown', { key: 'Enter', shiftKey: true })
    await textarea(w).trigger('keydown', { key: 'Enter', isComposing: true })
    await textarea(w).trigger('keydown', { key: 'Enter', keyCode: 229 })
    expect(chat.lines).toHaveLength(0)

    await textarea(w).trigger('keydown', { key: 'Enter' })
    expect(chat.lines[0]?.text).toBe('막힌 작업')
    expect((textarea(w).element as HTMLTextAreaElement).value).toBe('')
    await vi.runAllTimersAsync()
  })

  it('받는 중에는 보내기 대신 멈추기가 서고, 누르면 멈춘다', async () => {
    const w = await opened()
    await textarea(w).setValue('서버 OS 뭐로 정했지?')
    await textarea(w).trigger('keydown', { key: 'Enter' })

    expect(w.find('button[aria-label="보내기"]').exists()).toBe(false)
    await w.get('button[aria-label="멈추기"]').trigger('click')

    expect(useChatStore().receiving).toBe(false)
    expect(w.text()).toContain('멈췄습니다.')
    expect(w.find('button[aria-label="보내기"]').exists()).toBe(true)
    await vi.runAllTimersAsync()
  })

  it('Esc 로 닫으면 대화가 지워진다 — 다시 열면 빈 대화다', async () => {
    const w = await opened()
    await textarea(w).setValue('서버 OS 뭐로 정했지?')
    await textarea(w).trigger('keydown', { key: 'Enter' })

    await w.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(useChatStore().lines).toEqual([])
    expect(useChatStore().receiving).toBe(false)

    await w.get('button[aria-label="AI 도우미 열기"]').trigger('click')
    expect(w.text()).toContain('막힌 작업 알려줘')
    await vi.runAllTimersAsync()
  })

  it('@ 를 치면 작업 목록이 뜨고, 화살표 · Enter 로 골라 @키 로 넣는다', async () => {
    const w = await opened()
    const el = textarea(w).element as HTMLTextAreaElement
    await textarea(w).setValue('@설계')
    el.setSelectionRange(3, 3)
    await textarea(w).trigger('input')

    const options = () => w.findAll('[role="option"]')
    expect(options().length).toBeGreaterThan(1)
    expect(options()[0].text()).toContain('HW-1')
    expect(textarea(w).attributes('aria-expanded')).toBe('true')

    await textarea(w).trigger('keydown', { key: 'ArrowDown' })
    expect(options()[1].attributes('aria-selected')).toBe('true')
    await textarea(w).trigger('keydown', { key: 'ArrowUp' })
    await textarea(w).trigger('keydown', { key: 'Enter' })
    await nextTick()

    /* Enter 는 고르기만 하고 보내지 않는다 */
    expect(el.value).toBe('@HW-1 ')
    expect(useChatStore().lines).toHaveLength(0)
    expect(w.find('[role="listbox"]').exists()).toBe(false)
  })

  it('목록이 떠 있을 때 Esc 는 목록만 닫고 창은 그대로다', async () => {
    const w = await opened()
    const el = textarea(w).element as HTMLTextAreaElement
    await textarea(w).setValue('@')
    el.setSelectionRange(1, 1)
    await textarea(w).trigger('input')
    expect(w.find('[role="listbox"]').exists()).toBe(true)

    await textarea(w).trigger('keydown', { key: 'Escape' })
    expect(w.find('[role="listbox"]').exists()).toBe(false)
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('목록을 누르면 그 작업이 들어간다', async () => {
    const w = await opened()
    const el = textarea(w).element as HTMLTextAreaElement
    await textarea(w).setValue('이거 @hw-2 봐줘')
    el.setSelectionRange(8, 8)
    await textarea(w).trigger('input')

    await w.findAll('[role="option"]')[0].trigger('mousedown')
    await nextTick()
    expect(el.value).toBe('이거 @HW-2 봐줘')
  })

  it('답은 HTML 로 그리지 않는다', async () => {
    const w = await opened()
    const chat = useChatStore()
    chat.lines.push({
      id: 'x',
      role: 'assistant',
      text: '<b>굵게</b>\n둘째 줄',
      status: 'done',
      tool: '',
      error: '',
    })
    await nextTick()
    expect(w.find('b').exists()).toBe(false)
    expect(w.text()).toContain('<b>굵게</b>')
  })
})

describe('챗봇 창 — 작업 초안', () => {
  it('답 안에 초안 카드가 서고, [등록] 을 누르면 작업 칩으로 바뀐다', async () => {
    const w = await opened()
    await textarea(w).setValue('간담회 준비 작업 만들어줘')
    await textarea(w).trigger('keydown', { key: 'Enter' })
    await vi.runAllTimersAsync()

    expect(w.findAll('[data-proposed-task]')).toHaveLength(3)
    await w
      .findAll('button')
      .find((b) => b.text() === '등록')!
      .trigger('click')
    await vi.runAllTimersAsync()

    const made = useDataStore().allTasks.slice(-3)
    expect(w.findAll('a').map((a) => a.attributes('href'))).toEqual(
      made.map((t) => `/tasks/${t.id}`),
    )
    expect(w.text()).toContain('작업 3건을 등록했습니다')
  })
})

describe('챗봇 창 — 근거 칩', () => {
  const answer = (text: string, status: 'streaming' | 'done' = 'done') => ({
    id: 'a',
    role: 'assistant' as const,
    text,
    status,
    tool: '',
    error: '',
  })

  it('목업 답의 근거가 칩으로 선다 — 안건은 제목 + 상태 배지, 작업은 key + 제목', async () => {
    const w = await opened()
    await textarea(w).setValue('서버 OS 뭐로 정했지?')
    await textarea(w).trigger('keydown', { key: 'Enter' })
    await vi.runAllTimersAsync()

    const chip = w.get('[data-ref-thread="t1"]')
    expect(chip.text()).toContain('서버 OS 결정')
    expect(chip.text()).toContain('결정됨')
    expect(w.get('[data-answer-text]').text()).not.toContain('[[')

    useChatStore().lines.push(answer('막힌 작업은 [[task:k18]] 하나입니다.'))
    await nextTick()
    const task = w.get('[data-ref-task="k18"]')
    expect(task.text()).toContain('HW-18')
    expect(task.text()).toContain('보험료 산출 기간계 API 개발')
  })

  it('미룬 안건 칩에는 미룬 횟수가 같이 선다', async () => {
    const w = await opened()
    useChatStore().lines.push(answer('[[thread:t5]] 가 아직입니다.'))
    await nextTick()
    expect(w.get('[data-ref-thread="t5"]').text()).toContain('2번 미뤄짐')
  })

  it('스냅샷에 없는 id 는 칩도 글자도 그리지 않는다', async () => {
    const w = await opened()
    useChatStore().lines.push(answer('근거: [[thread:nope]] · [[task:k999]] 끝'))
    await nextTick()
    expect(w.find('[data-ref-thread]').exists()).toBe(false)
    expect(w.find('[data-ref-task]').exists()).toBe(false)
    const text = w.get('[data-answer-text]').text()
    expect(text).not.toContain('nope')
    expect(text).not.toContain('[[')
    expect(text).toContain('끝')
  })

  it('칩을 누르면 그 주소로 가고 창은 열린 채 대화가 남는다', async () => {
    const router = makeRouter()
    const w = await opened(router)
    useChatStore().lines.push(answer('[[thread:t1]] · [[task:k18]]'))
    await nextTick()

    await w.get('[data-ref-thread="t1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/threads/t1')

    await w.get('[data-ref-task="k18"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/k18')

    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(useChatStore().lines).toHaveLength(1)
  })

  it('받는 중 끝에 걸린 덜 온 표시는 닫힐 때까지 비치지 않는다', async () => {
    const w = await opened()
    const chat = useChatStore()
    chat.lines.push(answer('정했습니다. [[thread:t', 'streaming'))
    await nextTick()
    expect(w.get('[data-answer-text]').text()).toBe('정했습니다.')
    expect(w.find('[data-ref-thread]').exists()).toBe(false)

    chat.lines[0].text += '1]]'
    await nextTick()
    expect(w.find('[data-ref-thread="t1"]').exists()).toBe(true)
  })

  it('사용자가 친 글은 칩으로 바꾸지 않는다', async () => {
    const w = await opened()
    useChatStore().lines.push({ ...answer('[[thread:t1]] 이거 뭐야'), role: 'user' })
    await nextTick()
    expect(w.find('[data-ref-thread]').exists()).toBe(false)
    expect(w.text()).toContain('[[thread:t1]] 이거 뭐야')
  })
})

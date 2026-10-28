// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useHistoryStore } from '@/stores/history'
import { useTaskStore } from '@/stores/task'
import TaskDetailDialog from './TaskDetailDialog.vue'

/* 작업 상세의 선행 작업 · 상태가 된 지 며칠 (docs/api/task-flow.md '화면') */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const section = () => $('[data-task-dependencies]')!

async function mountDetail(taskId: string) {
  const w = mount(TaskDetailDialog, { props: { taskId, open: true }, attachTo: document.body })
  await flushPromises()
  return w
}

async function search(text: string) {
  const input = section().querySelector<HTMLInputElement>('input[role="combobox"]')!
  input.dispatchEvent(new FocusEvent('focus'))
  input.value = text
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

const options = () => [...section().querySelectorAll<HTMLElement>('[role="option"]')]

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
  await useAuthStore().login('u1@innoflow.local', MOCK_PASSWORD)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('작업 상세 — 선행 작업', () => {
  it("상태 옆에 '진행 중 · 12일째', backfill 이면 '12일 이상'", async () => {
    await mountDetail('k20')
    expect($('[data-status-since]')!.textContent).toContain('진행 중 · 12일째')

    useDataStore().allTasks.find((t) => t.id === 'k20')!.statusSinceBackfill = true
    await flushPromises()
    expect($('[data-status-since]')!.textContent).toContain('진행 중 · 12일 이상')
  })

  it('선행은 칩으로, 안 끝난 선행에는 상태 점. 기다리는 작업은 읽기만', async () => {
    const w = await mountDetail('k21')
    const chips = $$('[data-depends-on]')
    expect(chips.map((c) => c.textContent)).toEqual([expect.stringContaining('HW-20')])
    /* k20 은 진행 중 — 아직 안 끝났다 */
    expect(chips[0].querySelector('[data-unfinished]')!.getAttribute('aria-label')).toBe(
      '아직 안 끝남 — 진행 중',
    )
    expect(section().textContent).toContain('아직 안 끝난 선행 작업이 1건')

    await w.setProps({ taskId: 'k20' })
    await flushPromises()
    /* k19 는 완료라 점이 없다 */
    const done = $$('[data-depends-on]').at(-1)!
    expect(done.textContent).toContain('HW-19')
    expect(done.querySelector('[data-unfinished]')).toBeNull()
    const waiting = $$('[data-dependent]').map((c) => c.textContent?.replace(/\s+/g, '').trim())
    expect(waiting).toEqual(['HW-21개발자계정배포', 'HW-22스테이징DB구성'])
    /* 기다리는 작업은 그 작업의 상세에서 건다 — 여기에는 빼기가 없다 */
    expect($$('[data-dependent] [aria-label$="빼기"]')).toHaveLength(0)
  })

  it('고르기 — 자기 · 상위 · 이미 건 것은 없고, 순환이 되는 것은 흐리게 까닭과 함께 못 고른다', async () => {
    await mountDetail('k20')
    await search('HW-')
    const texts = options().map((o) => o.textContent ?? '')
    expect(texts.some((t) => t.includes('HW-20 '))).toBe(false)
    expect(texts.some((t) => t.includes('HW-4 '))).toBe(false)
    expect(texts.some((t) => t.includes('HW-19 '))).toBe(false)

    await search('계정 배포')
    const [k21] = options()
    expect(k21.getAttribute('aria-disabled')).toBe('true')
    expect(k21.textContent).toContain('이미 이 작업을 기다림')
    k21.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(useDataStore().taskDependencies).not.toContainEqual({
      taskId: 'k20',
      dependsOnId: 'k21',
    })
  })

  it('고르면 바로 걸리고, X 로 뗀다', async () => {
    await mountDetail('k21')
    await search('프로그램 설계')
    options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect($$('[data-depends-on]').map((c) => c.textContent)).toEqual([
      expect.stringContaining('HW-20'),
      expect.stringContaining('HW-3'),
    ])

    $('[aria-label="프로그램 설계 선행에서 빼기"]')!.click()
    await flushPromises()
    expect($$('[data-depends-on]')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('작업 상세 — 변경 이력', () => {
  const entries = () => $$('[data-history-entry]')
  const entryText = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  it('접어 두었다가 펼치면 부르고, 최근 것부터 사람 · 언제 · 칸 이름: 전 → 후', async () => {
    await mountDetail('k20')
    expect(entries()).toHaveLength(0)
    expect(useHistoryStore().statusOf('task', 'k20')).toBe('idle')

    $('[data-history-toggle]')!.click()
    await flushPromises()
    expect(useHistoryStore().statusOf('task', 'k20')).toBe('ready')
    const [status, created] = entries()
    expect(entryText(status)).toContain('이도현')
    expect(entryText(status)).toContain('상태: 해야 할 일 → 진행 중')
    /* 일주일이 넘으면 날짜로, 가리키면 KST 일시 */
    expect(status.querySelector('time')!.getAttribute('title')).toBe('10월 8일 09:00')
    expect(entryText(created)).toContain('등록')
  })

  it('펼친 채로 바꾸면 다시 불러 새 줄이 맨 위에 선다', async () => {
    await mountDetail('k20')
    $('[data-history-toggle]')!.click()
    await flushPromises()
    expect(entries()).toHaveLength(2)

    useTaskStore().setStatus('k20', 'done')
    useTaskStore().setOwner('k20', 'u1')
    await flushPromises()
    expect(entries()).toHaveLength(4)
    expect(entryText(entries()[0])).toContain('담당자: 이도현 → 김서연')
    expect(entryText(entries()[1])).toContain('상태: 진행 중 → 완료')
  })

  it('다른 작업으로 옮기면 다시 접힌다', async () => {
    const w = await mountDetail('k20')
    $('[data-history-toggle]')!.click()
    await flushPromises()
    await w.setProps({ taskId: 'k21' })
    await flushPromises()
    expect($('[data-history-toggle]')!.getAttribute('aria-expanded')).toBe('false')
    expect(entries()).toHaveLength(0)
  })
})

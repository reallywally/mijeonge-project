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

/* 작업 상세의 상태가 된 지 며칠 · 변경 이력 (docs/api/task-flow.md '화면') */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]

async function mountDetail(taskId: string) {
  const w = mount(TaskDetailDialog, { props: { taskId, open: true }, attachTo: document.body })
  await flushPromises()
  return w
}

enableAutoUnmount(afterEach)

beforeEach(async () => {
  resetMockAuth()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'))
  await useAuthStore().login('u1@inno-ax.com', MOCK_PASSWORD)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('작업 상세 — 상태 기록', () => {
  it("상태 옆에 '진행 중 · 12일째', backfill 이면 '12일 이상'", async () => {
    await mountDetail('k20')
    expect($('[data-status-since]')!.textContent).toContain('진행 중 · 12일째')

    useDataStore().allTasks.find((t) => t.id === 'k20')!.statusSinceBackfill = true
    await flushPromises()
    expect($('[data-status-since]')!.textContent).toContain('진행 중 · 12일 이상')
  })

  it('선행 작업 칸은 없다 (Q63)', async () => {
    await mountDetail('k20')
    expect(document.body.textContent).not.toContain('선행 작업')
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

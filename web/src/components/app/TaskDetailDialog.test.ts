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

describe('작업 상세 — 고치기 권한', () => {
  /* 박지훈(u2)은 p1 의 일반 사용자다. HW-18 은 담당 정하늘 · 등록 이도현이라 못 고치고,
     HW-4 는 자기가 등록해(담당은 이도현) 고친다 */
  const asU2 = async () => {
    resetMockAuth()
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
  }

  it('못 고치면 안내가 서고 제목 · 속성 · 본문 · 안건 연결이 잠긴다 — 댓글은 그대로 쓴다', async () => {
    await asU2()
    await mountDetail('k18')
    expect($('[data-task-readonly]')!.textContent).toContain(
      '작성자 · 담당자 · 관리자만 고칠 수 있습니다',
    )
    expect(document.body.textContent).not.toContain('고치면 바로 저장됩니다')
    expect($('textarea[aria-label="제목"]')!.hasAttribute('readonly')).toBe(true)
    for (const label of ['상태', '담당자'])
      expect($(`[aria-label="${label}"]`)!.hasAttribute('disabled'), label).toBe(true)
    expect($('input[aria-label="시작 날짜"]')!.hasAttribute('disabled')).toBe(true)
    expect($('button[aria-label="상위 작업"]')!.hasAttribute('disabled')).toBe(true)
    expect($$('button[aria-pressed]').every((b) => b.hasAttribute('disabled'))).toBe(true)
    expect($('[data-readonly]')).not.toBeNull()
    /* 안건 찾기 칸 · 연결 해제가 없다 */
    expect($('input[placeholder="안건 제목으로 찾기"]')).toBeNull()
    expect($$('button[title="연결 해제"]')).toHaveLength(0)
    /* 완료 버튼도 없다 */
    expect($$('button').some((b) => b.textContent?.trim() === '완료')).toBe(false)
    /* 댓글은 열려 있다 */
    const comment = $('textarea[placeholder="댓글을 남기세요"]')
    expect(comment).not.toBeNull()
    expect(comment!.hasAttribute('disabled')).toBe(false)
  })

  it('잠긴 제목을 고쳐 벗어나도 들어가지 않는다', async () => {
    await asU2()
    await mountDetail('k18')
    const title = $('textarea[aria-label="제목"]') as HTMLTextAreaElement
    title.value = '바꾼 제목'
    title.dispatchEvent(new Event('input'))
    title.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(useDataStore().allTasks.find((t) => t.id === 'k18')!.title).toBe(
      '보험료 산출 기간계 API 개발',
    )
  })

  it('등록한 사람은 담당이 아니어도 고친다 · 작성자 칸에 등록한 사람', async () => {
    await asU2()
    await mountDetail('k4')
    expect($('[data-task-readonly]')).toBeNull()
    expect($('textarea[aria-label="제목"]')!.hasAttribute('readonly')).toBe(false)
    expect($('[data-task-creator]')!.textContent).toBe('박지훈')
  })

  it("등록한 사람을 모르는 옛 작업은 작성자가 '—'", async () => {
    await mountDetail('k2')
    expect($('[data-task-creator]')!.textContent).toBe('—')
  })
})

describe('작업 상세 — 지우기', () => {
  const deleteButton = () => $('[data-task-delete]') as HTMLButtonElement | null

  it('등록한 사람 · 관리자에게만 보인다 — 담당자에게는 없다', async () => {
    /* u1 은 p1 관리자 */
    let w = await mountDetail('k21')
    expect(deleteButton()).not.toBeNull()
    w.unmount()

    /* 이도현(u3)은 HW-20 의 담당 · 등록, HW-19 는 담당만 */
    resetMockAuth()
    await useAuthStore().login('u3@inno-ax.com', MOCK_PASSWORD)
    w = await mountDetail('k20')
    expect(deleteButton()).not.toBeNull()
    w.unmount()
    await mountDetail('k19')
    expect(deleteButton()).toBeNull()
    /* 담당이라 고치기는 된다 */
    expect($('[data-task-readonly]')).toBeNull()
  })

  it('하위 작업이 있으면 버튼이 꺼지고 이유가 선다', async () => {
    await mountDetail('k4')
    expect(deleteButton()!.disabled).toBe(true)
    expect($('[data-delete-reason]')!.textContent).toContain('하위 작업이 있어 지울 수 없습니다')
  })

  it('확인을 받고 지우면 스토어에서 빠지고 팝업이 닫힌다 — 안건 연결도 같이', async () => {
    const data = useDataStore()
    data.taskAgendas.push({ taskId: 'k21', agendaId: 't1' })
    const w = await mountDetail('k21')
    deleteButton()!.click()
    await flushPromises()
    expect(document.body.textContent).toContain('HW-21 작업을 지울까요?')
    expect(document.body.textContent).toContain(
      '본문 · 댓글 · 안건 연결도 함께 지워지고 되돌릴 수 없습니다.',
    )

    $('[data-delete-confirm]')!.click()
    await flushPromises()
    expect(data.allTasks.some((t) => t.id === 'k21')).toBe(false)
    expect(data.taskAgendas.some((l) => l.taskId === 'k21')).toBe(false)
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('취소하면 그대로 남는다', async () => {
    await mountDetail('k21')
    deleteButton()!.click()
    await flushPromises()
    $$('button')
      .find((b) => b.textContent?.trim() === '취소')!
      .click()
    await flushPromises()
    expect(useDataStore().allTasks.some((t) => t.id === 'k21')).toBe(true)
  })

  it('그사이 하위가 생겨 409 가 오면 이유를 띄우고 지우지 않는다', async () => {
    const data = useDataStore()
    const w = await mountDetail('k21')
    deleteButton()!.click()
    await flushPromises()
    /* 확인을 띄운 뒤 다른 사람이 밑에 하위를 달았다 */
    data.allTasks.push({
      ...data.allTasks.find((t) => t.id === 'k21')!,
      id: 'k99',
      key: 'HW-99',
      parentId: 'k21',
    })
    $('[data-delete-confirm]')!.click()
    await flushPromises()
    expect($('[data-delete-error]')!.textContent).toContain('하위 작업이 있어 지울 수 없습니다')
    expect(data.allTasks.some((t) => t.id === 'k21')).toBe(true)
    expect(w.emitted('update:open')).toBeUndefined()
    expect(toastError).not.toHaveBeenCalled()
  })
})

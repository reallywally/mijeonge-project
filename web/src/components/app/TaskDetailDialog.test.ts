// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { TASK_READONLY_HINT } from '@/lib/task'
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
  /* HW-18 은 기간계 연동 작업(담당 정하늘 · 등록 이도현) — 이도현(u3)은 그 파트 소속이 아니라 등록했어도 못 고친다.
     HW-4 는 인프라 작업(담당 이도현 · 등록 박지훈) — 박지훈(u2)은 인프라 소속이 아니라 못 고친다 */
  const as = async (email: string) => {
    resetMockAuth()
    await useAuthStore().login(email, MOCK_PASSWORD)
  }

  it('못 고치면 안내가 서고 제목 · 속성 · 본문 · 안건 연결이 잠긴다 — 댓글은 그대로 쓴다', async () => {
    await as('u3@inno-ax.com')
    await mountDetail('k18')
    expect($('[data-task-readonly]')!.textContent).toContain(TASK_READONLY_HINT)
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
    await as('u3@inno-ax.com')
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

  it('공통 작업은 등록한 사람이 담당이 아니어도 고친다. 파트 작업은 그 파트의 수정 권한이 있어야 한다', async () => {
    await as('u2@inno-ax.com')
    const w = await mountDetail('k4')
    expect($('[data-task-readonly]')).not.toBeNull()
    w.unmount()
    useDataStore().allTasks.find((t) => t.id === 'k4')!.partId = null
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

  it('관리자 · 공통 작업을 등록한 사람 · 그 파트의 삭제 권한에게만 보인다 — 담당자라서 서지는 않는다', async () => {
    /* u1 은 p1 관리자 */
    let w = await mountDetail('k21')
    expect(deleteButton()).not.toBeNull()
    w.unmount()

    /* 이도현(u3)은 인프라의 삭제 권한이 있다 — 담당만 한 HW-19 도 지운다 */
    resetMockAuth()
    await useAuthStore().login('u3@inno-ax.com', MOCK_PASSWORD)
    w = await mountDetail('k19')
    expect(deleteButton()).not.toBeNull()
    w.unmount()
    /* 삭제 권한을 끄면 등록 · 담당한 HW-20 도 못 지운다 — 담당이라 고치기는 된다 */
    useDataStore().partMembers.find((pm) => pm.memberId === 'u3')!.canDelete = false
    await mountDetail('k20')
    expect(deleteButton()).toBeNull()
    expect($('[data-task-readonly]')).toBeNull()
  })

  it('하위가 있어도 버튼은 켜지고, 확인에 지워질 하위 수 · 키 · 제목과 외 N개가 선다', async () => {
    await mountDetail('k5')
    expect(deleteButton()!.disabled).toBe(false)
    expect($('[data-delete-reason]')).toBeNull()
    deleteButton()!.click()
    await flushPromises()
    /* HW-5 아래 손자까지 13개 — 앞의 5개만 늘어놓는다 */
    expect($('[data-delete-descendant-count]')!.textContent).toContain(
      '하위 작업 13개도 함께 지워집니다.',
    )
    const listed = $$('[data-delete-descendants] li').map((li) =>
      li.children.length
        ? [...li.children].map((c) => c.textContent!.trim()).join(' ')
        : li.textContent!.trim(),
    )
    expect(listed).toEqual([
      'HW-6 AI Biz',
      'HW-7 가상비서',
      'HW-8 tool01',
      'HW-9 tool02',
      'HW-10 tool03',
      '외 8개',
    ])
    expect($('[data-delete-confirm]')!.textContent).toContain('하위까지 지우기')
  })

  it('하위가 없으면 하위 문구 없이 그냥 지우기', async () => {
    await mountDetail('k21')
    deleteButton()!.click()
    await flushPromises()
    expect($('[data-delete-descendants]')).toBeNull()
    expect($('[data-delete-descendant-count]')).toBeNull()
    expect($('[data-delete-confirm]')!.textContent!.trim()).toBe('지우기')
  })

  it('확인하면 후손까지 스토어에서 빠진다', async () => {
    const data = useDataStore()
    const w = await mountDetail('k4')
    deleteButton()!.click()
    await flushPromises()
    expect($('[data-delete-descendant-count]')!.textContent).toContain('하위 작업 4개도')
    $('[data-delete-confirm]')!.click()
    await flushPromises()
    expect(data.allTasks.filter((t) => ['k4', 'k19', 'k20', 'k21', 'k22'].includes(t.id))).toEqual(
      [],
    )
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('못 지우는 후손이 있으면 버튼이 꺼지고 이유가 선다', async () => {
    /* 이도현(u3)은 인프라 작업 HW-4 를 지운다 — 하위 HW-22 를 기간계 연동으로 옮겨 두면 그것을 못 지운다 */
    resetMockAuth()
    await useAuthStore().login('u3@inno-ax.com', MOCK_PASSWORD)
    useDataStore().allTasks.find((t) => t.id === 'k22')!.partId = 'pt3'
    await mountDetail('k4')
    expect(deleteButton()!.disabled).toBe(true)
    expect($('[data-delete-reason]')!.textContent).toContain(
      '지울 수 없는 하위 작업이 있어 지울 수 없습니다',
    )
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

  it('그사이 못 지우는 하위가 생겨 403 이 오면 이유를 띄우고 지우지 않는다', async () => {
    /* 이도현(u3)은 인프라의 삭제 권한이 있다 */
    resetMockAuth()
    await useAuthStore().login('u3@inno-ax.com', MOCK_PASSWORD)
    const data = useDataStore()
    const reload = vi.spyOn(data, 'reloadSnapshot').mockResolvedValue()
    const w = await mountDetail('k20')
    deleteButton()!.click()
    await flushPromises()
    /* 확인을 띄운 뒤 다른 사람이 밑에 하위를 달았다 */
    data.allTasks.push({
      ...data.allTasks.find((t) => t.id === 'k20')!,
      id: 'k99',
      key: 'HW-99',
      parentId: 'k20',
      creatorId: 'u1',
      partId: 'pt3',
    })
    $('[data-delete-confirm]')!.click()
    await flushPromises()
    expect($('[data-delete-error]')!.textContent).toContain('지울 권한이 없는 하위 작업')
    expect(data.allTasks.some((t) => t.id === 'k20')).toBe(true)
    expect(reload).toHaveBeenCalled()
    expect(w.emitted('update:open')).toBeUndefined()
    expect(toastError).not.toHaveBeenCalled()
  })
})

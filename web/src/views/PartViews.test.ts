// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { Select } from '@/components/ui/select'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import TasksView from './TasksView.vue'
import ThreadListView from './ThreadListView.vue'

/* 파트가 화면까지 닿는지 — [내 파트 | 전체] · 파트 칩 · 파트 거르기(?part= 포함) · 고르기.
   파트 관리 화면은 ProjectAdminViews.test 가 본다.
   간트는 이 파일에서 띄우지 않는다(TasksView.test 가 스텁으로 본다) */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))
vi.mock('dhtmlx-gantt', () => ({
  Gantt: { getGanttInstance: () => ({}) },
  escapeHTML: (value: string) => value,
}))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/tasks', component: TasksView },
      { path: '/tasks/new', component: TasksView },
      { path: '/tasks/:id', component: TasksView },
      { path: '/threads', component: ThreadListView },
      { path: '/threads/:id', component: ThreadListView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const view = path.startsWith('/threads') ? ThreadListView : TasksView
  const w = mount(view, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return w
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

async function click(el: Element | undefined | null) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

const scopeButton = (key: 'mine' | 'all') =>
  document.body.querySelector<HTMLButtonElement>(`[aria-label="보기 범위"] [data-scope="${key}"]`)
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('작업 화면의 [내 파트 | 전체]', () => {
  it('인프라(u3)는 내 파트로 열리고, 전체로 바꾸면 22건이 다 선다', async () => {
    await signedIn('u3@innoflow.local')
    const w = await mountAt('/tasks?view=list')

    expect(scopeButton('mine')!.getAttribute('aria-pressed')).toBe('true')
    expect(w.text()).toContain('총 10건 중 1–8건')
    expect(w.text()).not.toContain('가상비서')

    await click(scopeButton('all'))
    expect(w.text()).toContain('총 22건 중 1–8건')
  })

  it('파트 칩은 파트가 있는 행에만 붙는다 — 공통은 안 그린다', async () => {
    await signedIn('u3@innoflow.local')
    const w = await mountAt('/tasks?view=list')
    const row = (key: string) => w.findAll('tbody tr').find((r) => r.text().includes(key))!
    expect(row('HW-4').find('[data-part-chip]').text()).toBe('인프라')
    expect(row('HW-1').find('[data-part-chip]').exists()).toBe(false)
  })

  it('조회 조건의 파트로 한 번 더 좁힌다', async () => {
    await signedIn('u1@innoflow.local')
    const w = await mountAt('/tasks?view=list')
    const picker = w
      .findAllComponents(Select)
      .find((s) => s.find('[aria-label="파트 거르기"]').exists())!
    picker.vm.$emit('update:modelValue', 'pt3')
    await flushPromises()
    expect(w.text()).toContain('총 1건 중 1–1건')
    expect(w.text()).toContain('보험료 산출 기간계 API 개발')

    picker.vm.$emit('update:modelValue', 'common')
    await flushPromises()
    expect(w.text()).toContain('총 5건')
  })

  it('?part= 로 들어오면 그 파트로 걸러진 채 열린다. 이 프로젝트에 없는 파트면 거르지 않는다', async () => {
    await signedIn('u1@innoflow.local')
    const w = await mountAt('/tasks?view=list&part=pt1')
    expect(w.text()).toContain('총 5건')

    const other = await mountAt('/tasks?view=list&part=pt9')
    expect(other.text()).toContain('총 22건')
  })

  it('시스템 관리자는 속한 파트가 없어 전환이 없다', async () => {
    await signedIn('admin@innoflow.local', MOCK_ADMIN_PASSWORD)
    const w = await mountAt('/tasks?view=list')
    expect(scopeButton('mine')).toBeNull()
    expect(w.text()).toContain('총 22건')
  })

  it("'내 파트' 에서 안 보이는 작업도 주소로 열면 열린다", async () => {
    await signedIn('u3@innoflow.local')
    await mountAt('/tasks/k7?view=list')
    expect(document.body.textContent).toContain('가상비서')
    expect(document.body.querySelector('[aria-label="파트"]')!.textContent).toContain('AI')
  })

  it('하위 작업 추가는 상위의 파트가 골라진 채 열리고, 그대로 만들어진다', async () => {
    await signedIn('u1@innoflow.local')
    await mountAt('/tasks/new?parent=k7&view=list')
    expect(document.body.querySelector('[aria-label="파트"]')!.textContent).toContain('AI')

    const title = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="제목"]')!
    title.value = 'tool05'
    title.dispatchEvent(new Event('input'))
    await flushPromises()
    await click(bodyButton('만들기'))
    const made = useDataStore().allTasks.find((t) => t.title === 'tool05')!
    expect(made.parentId).toBe('k7')
    expect(made.partId).toBe('pt2')
  })
})

describe('안건 목록의 [내 파트 | 전체]', () => {
  it('기간계(u2)는 공통 둘과 기간계 안건만 보고, 전체로 바꾸면 다 본다', async () => {
    await signedIn('u2@innoflow.local')
    const w = await mountAt('/threads')
    expect(w.text()).toContain('총 3건')
    expect(w.text()).not.toContain('서버 OS 결정')

    await click(scopeButton('all'))
    expect(w.text()).toContain('총 9건')
    const row = w.findAll('tbody tr').find((r) => r.text().includes('서버 OS 결정'))!
    expect(row.find('[data-part-chip]').text()).toBe('인프라')
  })

  it('?part= 로 들어오면 그 파트로 걸러진 채 열리고, 초기화하면 풀린다', async () => {
    await signedIn('u1@innoflow.local')
    const w = await mountAt('/threads?part=pt1')
    expect(w.text()).toContain('총 3건')
    expect(w.text()).toContain('서버 OS 결정')

    await click(bodyButton('초기화'))
    expect(w.text()).toContain('총 9건')
  })
})

// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import ProjectsView from './ProjectsView.vue'

/* 프로젝트 목록의 종료 표시 · 기간 · 설명과 등록 팝업의 새 칸(설명 · 기간). 팝업은 teleport 로 body 에 나간다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/projects', component: ProjectsView },
      { path: '/projects/new', component: ProjectsView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(ProjectsView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

async function type(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

const saveButton = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent?.trim() === '저장',
  )!

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('프로젝트 목록', () => {
  it('진행 → 준비 → 종료 순이고 준비 · 종료 배지가 붙는다. 기간 · 설명 한 줄이 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/projects')
    const rows = () => w.findAll('tr[data-project-row]')

    expect(rows().map((r) => r.attributes('data-project-row'))).toEqual(['p1', 'p2', 'p3'])
    expect(rows()[2].attributes('data-closed')).toBe('true')
    expect(rows()[2].get('[data-status-badge]').text()).toBe('종료')
    expect(rows()[1].get('[data-status-badge]').attributes('data-status-badge')).toBe('planned')
    expect(rows()[1].get('[data-status-badge]').text()).toBe('준비')
    expect(rows()[0].find('[data-status-badge]').exists()).toBe(false)

    expect(rows()[0].get('[data-project-period]').text()).toBe('2026-03-02 ~ 2026-12-31')
    expect(rows()[1].get('[data-project-period]').text()).toBe('2026-12-01 ~')
    expect(rows()[2].get('[data-project-period]').text()).toBe('—')
    expect(rows()[0].get('[data-project-description]').text()).toContain('한화손해보험')
    expect(rows()[1].find('[data-project-description]').exists()).toBe(false)

    /* 화면에서 상태를 바꾸면 받은 순서와 상관없이 다시 줄 선다 */
    await useDataStore().updateProject('p1', { status: 'closed' })
    await flushPromises()
    expect(rows().map((r) => r.attributes('data-project-row'))).toEqual(['p2', 'p1', 'p3'])
    expect(rows()[1].get('[data-status-badge]').text()).toBe('종료')

    /* 같은 준비끼리는 받은 순서 그대로 */
    await useDataStore().updateProject('p1', { status: 'planned' })
    await flushPromises()
    expect(rows().map((r) => r.attributes('data-project-row'))).toEqual(['p1', 'p2', 'p3'])
    expect(rows()[0].get('[data-status-badge]').text()).toBe('준비')
  })
})

describe('프로젝트 등록 팝업', () => {
  it('설명 · 기간을 선택으로 받는다 — 거꾸로 된 기간은 막고, 고치면 저장된다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { router } = await mountAt('/projects/new')
    const data = useDataStore()

    await type('[role="dialog"] input[aria-label="프로젝트 이름"]', '신한라이프 이관')
    await type('#project-create-description', '보험 계약 이관\n두 번째 줄')
    await type('[role="dialog"] input[aria-label="시작일"]', '2026-12-01')
    await type('[role="dialog"] input[aria-label="종료일"]', '2026-11-01')
    expect(
      document.body.querySelector('[role="dialog"] [data-range-error]')?.textContent,
    ).toContain('종료일이 시작일보다 앞섭니다')
    expect(saveButton().disabled).toBe(true)

    await type('[role="dialog"] input[aria-label="종료일"]', '2027-06-30')
    expect(document.body.querySelector('[role="dialog"] [data-range-error]')).toBeNull()
    expect(saveButton().disabled).toBe(false)
    saveButton().click()
    await flushPromises()

    expect(data.currentProject).toMatchObject({
      name: '신한라이프 이관',
      description: '보험 계약 이관\n두 번째 줄',
      startDate: '2026-12-01',
      endDate: '2027-06-30',
      status: 'active',
    })
    expect(router.currentRoute.value.path).toBe('/tasks')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('설명 · 기간을 비우면 싣지 않는다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    await mountAt('/projects/new')

    await type('[role="dialog"] input[aria-label="프로젝트 이름"]', '빈 사업')
    saveButton().click()
    await flushPromises()
    expect(useDataStore().currentProject).toMatchObject({
      name: '빈 사업',
      description: null,
      startDate: null,
      endDate: null,
    })
  })
})

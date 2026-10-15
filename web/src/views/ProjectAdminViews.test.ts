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
import { usePartStore } from '@/stores/part'
import ProjectPartsView from './ProjectPartsView.vue'
import ProjectSettingsView from './ProjectSettingsView.vue'

/* 프로젝트 관리 · 파트 관리 두 화면이 목업 갈래로 떠서 스토어까지 닿는지 본다.
   멤버 부여 · 역할 · 빼기 · 이름은 AdminViews.test 가 본다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/projects/:projectId/settings', component: ProjectSettingsView },
      { path: '/projects/:projectId/parts', component: ProjectPartsView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const view = path.includes('/parts') ? ProjectPartsView : ProjectSettingsView
  const w = mount(view, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
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

describe('프로젝트 관리 화면', () => {
  it('프로젝트 정보 — 작업 키 접두사는 읽기만 되고, 한눈 정보를 센다', async () => {
    await signedIn('u1@innoflow.local')
    const { w } = await mountAt('/projects/p1/settings')

    expect(w.get('[data-task-key-prefix]').text()).toBe('HW')
    expect(w.find('input[aria-label="작업 키 접두사"]').exists()).toBe(false)
    expect(w.get('[data-stat="tasks"]').text()).toContain('22')
    expect(w.get('[data-stat="threads"]').text()).toContain('9')
    expect(w.get('[data-stat="parts"]').text()).toContain('3')
    expect(w.get('[data-stat="members"]').text()).toContain('4')
    expect(w.get('[data-stat="members"]').text()).toContain('관리자 1')
  })

  it('사람 표의 파트는 읽기 전용 칩이고, 누르면 파트 관리의 그 파트로 간다', async () => {
    await signedIn('u1@innoflow.local')
    const { w, router } = await mountAt('/projects/p1/settings')

    const chips = w.get('tr[data-member-id="u3"]').findAll('[data-part-chip]')
    expect(chips.map((c) => c.text())).toEqual(['인프라'])
    expect(w.get('tr[data-member-id="u3"]').find('button[aria-pressed]').exists()).toBe(false)

    await click(chips[0].element)
    expect(router.currentRoute.value.fullPath).toBe('/projects/p1/parts?part=pt1')
  })
})

describe('파트 관리 화면', () => {
  it('파트를 안 고르고 들어오면 첫 활성 파트를 주소에 싣는다. 없는 파트여도 같다', async () => {
    await signedIn('u1@innoflow.local')
    const { w, router } = await mountAt('/projects/p1/parts')
    expect(router.currentRoute.value.fullPath).toBe('/projects/p1/parts?part=pt2')
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt2')

    const other = await mountAt('/projects/p1/parts?part=pt9')
    expect(other.router.currentRoute.value.query.part).toBe('pt2')
  })

  it('왼쪽 목록은 이름 · 사람 수 · 작업/안건 수, 고르면 주소와 오른쪽이 따른다', async () => {
    await signedIn('u1@innoflow.local')
    const { w, router } = await mountAt('/projects/p1/parts?part=pt1')

    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt1')
    expect((w.get('input[aria-label="파트 이름"]').element as HTMLInputElement).value).toBe(
      '인프라',
    )
    const ai = w.get('button[data-part-id="pt2"]')
    expect(ai.text()).toContain('AI')
    expect(ai.text()).toContain('2명 · 작업 11 · 안건 3')
    expect(w.get('button[data-part-id="pt1"]').attributes('aria-current')).toBe('true')

    await click(ai.element)
    expect(router.currentRoute.value.query.part).toBe('pt2')
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt2')
    expect(w.findAll('[aria-label="이 파트의 사람"] li[data-member-id]').length).toBe(2)

    /* 주소가 바뀌어도(뒤로가기 · 공유 링크) 따른다 */
    await router.push('/projects/p1/parts?part=pt3')
    await flushPromises()
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt3')
  })

  it('작업 · 안건 목록으로 가는 링크는 그 파트로 걸러진 주소다', async () => {
    await signedIn('u1@innoflow.local')
    const { w } = await mountAt('/projects/p1/parts?part=pt1')
    expect(w.get('a[data-link="tasks"]').attributes('href')).toBe('/tasks?part=pt1')
    expect(w.get('a[data-link="tasks"]').text()).toContain('작업 5건')
    expect(w.get('a[data-link="threads"]').attributes('href')).toBe('/threads?part=pt1')
    expect(w.get('a[data-link="threads"]').text()).toContain('안건 3건')
  })

  it('찾아서 여럿을 골라 한 번에 더하고, 한 사람씩 뺀다', async () => {
    await signedIn('u1@innoflow.local')
    const { w } = await mountAt('/projects/p1/parts?part=pt1')
    const part = usePartStore()

    /* 프로젝트에 부여된 활성 멤버 중 아직 없는 사람만 — 관리자(u0) · 비활성(u5)은 없다 */
    const candidateIds = () =>
      w.findAll('[data-candidate-id]').map((c) => c.attributes('data-candidate-id'))
    expect(candidateIds()).toEqual(['u1', 'u2', 'u4'])

    await w.get('input[aria-label="더할 사람 찾기"]').setValue('정하')
    expect(candidateIds()).toEqual(['u4'])
    await click(document.body.querySelector('button[aria-label="정하늘 고르기"]'))
    await w.get('input[aria-label="더할 사람 찾기"]').setValue('')
    await click(document.body.querySelector('button[aria-label="박지훈 고르기"]'))
    expect(w.text()).toContain('2명 고름')

    await click(bodyButton('2명 더하기'))
    expect([...part.membersOf('pt1')].sort()).toEqual(['u2', 'u3', 'u4'])
    expect(candidateIds()).toEqual(['u1'])
    expect(w.get('button[data-part-id="pt1"]').text()).toContain('3명')

    await click(w.get('button[aria-label="이도현 빼기"]').element)
    expect([...part.membersOf('pt1')].sort()).toEqual(['u2', 'u4'])
    expect(w.find('[aria-label="이 파트의 사람"] li[data-member-id="u3"]').exists()).toBe(false)
  })

  it('이름을 바꾸고, 겹치면 서버의 message 를 알리고 되돌린다', async () => {
    await signedIn('u1@innoflow.local')
    const { w } = await mountAt('/projects/p1/parts?part=pt1')
    const field = w.get('input[aria-label="파트 이름"]')

    await field.setValue('인프라 · 보안')
    await click(bodyButton('이름 바꾸기'))
    expect(usePartStore().partName('pt1')).toBe('인프라 · 보안')
    expect(w.get('button[data-part-id="pt1"]').text()).toContain('인프라 · 보안')

    await field.setValue('AI')
    await click(bodyButton('이름 바꾸기'))
    expect(vi.mocked(toastError).mock.calls.at(-1)![0]).toMatchObject({ code: 'PART_NAME_TAKEN' })
    expect((field.element as HTMLInputElement).value).toBe('인프라 · 보안')
  })

  it('보관하면 아래로 접히고 사람 더하기가 닫힌다. 되살리면 돌아온다', async () => {
    await signedIn('u1@innoflow.local')
    const { w } = await mountAt('/projects/p1/parts?part=pt1')
    const part = usePartStore()

    await click(bodyButton('보관'))
    expect(part.parts.find((p) => p.id === 'pt1')!.active).toBe(false)
    expect(w.text()).toContain('보관한 파트 1개')
    expect(w.text()).toContain('보관됨')
    expect(w.find('[aria-label="사람 더하기"]').exists()).toBe(false)
    /* 사람은 그대로 남는다 */
    expect(part.membersOf('pt1')).toEqual(['u3'])

    await click(bodyButton('되살리기'))
    expect(part.parts.find((p) => p.id === 'pt1')!.active).toBe(true)
    expect(w.find('[aria-label="사람 더하기"]').exists()).toBe(true)
  })

  it('새 파트를 만들면 그 파트가 골라진다', async () => {
    await signedIn('u1@innoflow.local')
    const { w, router } = await mountAt('/projects/p1/parts?part=pt1')

    await w.get('input[aria-label="새 파트 이름"]').setValue('디자인')
    await click(w.get('button[aria-label="파트 만들기"]').element)
    const design = usePartStore().parts.find((p) => p.name === '디자인')!
    expect(design).toBeTruthy()
    expect(router.currentRoute.value.query.part).toBe(design.id)
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe(design.id)
  })

  it('파트가 없는 프로젝트는 빈 안내를 보인다', async () => {
    await signedIn('admin@innoflow.local', MOCK_ADMIN_PASSWORD)
    const { w, router } = await mountAt('/projects/p2/parts')
    expect(router.currentRoute.value.query.part).toBeUndefined()
    expect(w.text()).toContain('파트가 없습니다')
    expect(w.find('[data-selected-part]').exists()).toBe(false)
  })
})

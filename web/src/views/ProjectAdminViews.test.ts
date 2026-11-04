// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { toast } from 'vue-sonner'
import { mockDb, resetMockAuth } from '@/api/mockAuth'
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
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/admin/projects/:projectId/settings', component: ProjectSettingsView },
      { path: '/admin/projects/:projectId/parts', component: ProjectPartsView },
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
  it('프로젝트 정보 — 작업 키 접두사는 읽기만 되고, 한눈 정보(수 세기) 칸은 없다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')

    expect(w.get('[data-task-key-prefix]').text()).toBe('HW')
    expect(w.find('input[aria-label="작업 키 접두사"]').exists()).toBe(false)
    expect(w.find('[data-stat]').exists()).toBe(false)
    expect(w.find('section[aria-label="프로젝트 상태"]').exists()).toBe(false)
    /* 멤버 목록은 그대로 */
    expect(w.findAll('section[aria-label="프로젝트 멤버"] tr[data-member-id]')).toHaveLength(4)
  })

  it('사람 표의 파트는 읽기 전용 칩이고, 누르면 파트 관리의 그 파트로 간다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w, router } = await mountAt('/admin/projects/p1/settings')

    const chips = w.get('tr[data-member-id="u3"]').findAll('[data-part-chip]')
    expect(chips.map((c) => c.text())).toEqual(['인프라'])
    expect(w.get('tr[data-member-id="u3"]').find('button[aria-pressed]').exists()).toBe(false)

    await click(chips[0].element)
    expect(router.currentRoute.value.fullPath).toBe('/admin/projects/p1/parts?part=pt1')
  })
})

describe('프로젝트 관리 — 기본 정보(상태 포함) · 삭제', () => {
  const field = (selector: string) => document.body.querySelector<HTMLInputElement>(selector)!

  it('이름 · 설명 · 기간을 한 번에 저장하고, 비운 칸은 지운다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    const data = useDataStore()

    expect(field('input[aria-label="시작일"]').value).toBe('2026-03-02')
    expect(field('input[aria-label="종료일"]').value).toBe('2026-12-31')
    expect(
      (w.get('textarea[aria-label="프로젝트 설명"]').element as HTMLTextAreaElement).value,
    ).toContain('한화손해보험')
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeDefined()

    await w.get('input[aria-label="프로젝트 이름"]').setValue('한화손보 차세대 2기')
    await w.get('textarea[aria-label="프로젝트 설명"]').setValue('  ')
    await w.get('input[aria-label="종료일"]').setValue('')
    await w.get('input[aria-label="시작일"]').setValue('2026-04-01')
    await click(w.get('button[data-save-info]').element)

    expect(data.currentProject).toMatchObject({
      name: '한화손보 차세대 2기',
      description: null,
      startDate: '2026-04-01',
      endDate: null,
    })
    expect(w.get('h1').text()).toContain('한화손보 차세대 2기')
    /* 저장한 값이 새 기준 — 다시 저장할 것이 없다 */
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeDefined()
  })

  it('기간이 거꾸로면 화면에서 먼저 막는다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')

    await w.get('input[aria-label="시작일"]').setValue('2027-01-10')
    expect(w.get('[data-range-error]').text()).toContain('종료일이 시작일보다 앞섭니다')
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeDefined()

    await w.get('input[aria-label="종료일"]').setValue('')
    expect(w.find('[data-range-error]').exists()).toBe(false)
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeUndefined()
  })

  it('그사이 서버 쪽 기간이 바뀌어 서버가 막으면 그 message 를 기간 칸 아래에 띄운다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    /* 다른 사람이 종료일을 당겨 놓았다 — 화면은 아직 옛 종료일을 들고 있다 */
    mockDb().projects.find((p) => p.id === 'p1')!.endDate = '2026-04-30'

    await w.get('input[aria-label="시작일"]').setValue('2026-05-01')
    await click(w.get('button[data-save-info]').element)

    expect(w.get('[data-range-error]').text()).toContain('종료일이 시작일보다 앞섭니다')
    expect(useDataStore().currentProject!.startDate).toBe('2026-03-02')
    expect(vi.mocked(toastError)).not.toHaveBeenCalled()

    /* 날짜를 고치면 옛 서버 말은 걷힌다 */
    await w.get('input[aria-label="시작일"]').setValue('2026-04-01')
    expect(w.find('[data-range-error]').exists()).toBe(false)
  })

  it('상태는 프로젝트 정보 안에서 고르고, 같은 저장으로 status 만 보낸다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    const data = useDataStore()
    const option = (status: string) => w.get(`button[data-status-option="${status}"]`)

    expect(w.findAll('[data-status-option]').map((b) => b.text())).toEqual(['준비', '진행', '종료'])
    expect(option('active').attributes('aria-pressed')).toBe('true')
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeDefined()

    await option('planned').trigger('click')
    expect(option('planned').attributes('aria-pressed')).toBe('true')
    const spy = vi.spyOn(data, 'updateProject')
    await click(w.get('button[data-save-info]').element)

    expect(spy).toHaveBeenCalledWith('p1', { status: 'planned' })
    expect(toast.success).toHaveBeenCalledWith('저장이 완료되었습니다.')
    expect(data.currentProject).toMatchObject({ status: 'planned', closedAt: null })
    expect(w.find('[data-closed-at]').exists()).toBe(false)
    expect(w.get('button[data-save-info]').attributes('disabled')).toBeDefined()
  })

  it('종료로 저장하면 종료 시각이 칸 옆에 작게 보이고, 진행으로 되돌리면 걷힌다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    const data = useDataStore()

    await w.get('button[data-status-option="closed"]').trigger('click')
    /* 저장 전에는 시각이 없다 — 아직 닫지 않았다 */
    expect(w.find('[data-closed-at]').exists()).toBe(false)
    await click(w.get('button[data-save-info]').element)

    expect(data.currentProject!.status).toBe('closed')
    expect(data.currentProject!.closedAt).toBeTruthy()
    expect(w.get('[data-closed-at]').text()).toContain('종료')

    await w.get('button[data-status-option="active"]').trigger('click')
    await click(w.get('button[data-save-info]').element)
    expect(data.currentProject).toMatchObject({ status: 'active', closedAt: null })
    expect(w.find('[data-closed-at]').exists()).toBe(false)
  })

  it('이미 종료한 프로젝트를 열면 종료가 골라져 있고 종료 시각이 보인다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/projects/p3/settings')

    expect(w.get('button[data-status-option="closed"]').attributes('aria-pressed')).toBe('true')
    expect(w.get('[data-closed-at]').text()).toMatch(/에 종료$/)
  })

  it('위험 구역은 시스템 관리자에게만 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    expect(w.find('[aria-label="위험 구역"]').exists()).toBe(false)
    expect(bodyButton('프로젝트 삭제')).toBeUndefined()
  })

  it('삭제는 이름을 그대로 쳐야 켜지고, 지우면 남은 프로젝트로 옮겨 관리자 페이지로 간다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w, router } = await mountAt('/admin/projects/p1/settings')
    const data = useDataStore()

    await click(w.get('[aria-label="위험 구역"]').find('button').element)
    const confirm = () => document.body.querySelector<HTMLButtonElement>('[data-delete-confirm]')!
    expect(confirm().disabled).toBe(true)

    const typed = field('input[aria-label="지울 프로젝트 이름"]')
    typed.value = '한화손보'
    typed.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirm().disabled).toBe(true)

    typed.value = '한화손보 차세대'
    typed.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirm().disabled).toBe(false)

    await click(confirm())
    expect(data.allProjects.map((p) => p.id)).toEqual(['p2', 'p3'])
    expect(data.currentProjectId).toBe('p2')
    expect(mockDb().deletedProjectIds).toEqual(['p1'])
    expect(router.currentRoute.value.path).toBe('/admin')
  })

  it('남은 프로젝트가 없으면 빈 상태의 첫 화면(등록)으로 간다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const data = useDataStore()
    expect(await data.deleteProject('p2')).toBe(true)
    expect(await data.deleteProject('p3')).toBe(true)
    const { router } = await mountAt('/admin/projects/p1/settings')

    await click(dangerButton())
    const typed = field('input[aria-label="지울 프로젝트 이름"]')
    typed.value = '한화손보 차세대'
    typed.dispatchEvent(new Event('input'))
    await flushPromises()
    await click(document.body.querySelector('[data-delete-confirm]'))

    expect(data.allProjects).toEqual([])
    expect(data.currentProjectId).toBe('')
    expect(router.currentRoute.value.path).toBe('/projects/new')
  })
})

const dangerButton = () =>
  document.body.querySelector('[aria-label="위험 구역"] button') ?? undefined

describe('파트 관리 화면', () => {
  it('파트를 안 고르고 들어오면 첫 활성 파트를 주소에 싣는다. 없는 파트여도 같다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w, router } = await mountAt('/admin/projects/p1/parts')
    expect(router.currentRoute.value.fullPath).toBe('/admin/projects/p1/parts?part=pt2')
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt2')

    const other = await mountAt('/admin/projects/p1/parts?part=pt9')
    expect(other.router.currentRoute.value.query.part).toBe('pt2')
  })

  it('왼쪽 목록은 이름 · 사람 수 · 작업/안건 수, 고르면 주소와 오른쪽이 따른다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w, router } = await mountAt('/admin/projects/p1/parts?part=pt1')

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
    await router.push('/admin/projects/p1/parts?part=pt3')
    await flushPromises()
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe('pt3')
  })

  it('작업 · 안건 목록으로 가는 링크는 그 파트로 걸러진 주소다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/parts?part=pt1')
    expect(w.get('a[data-link="tasks"]').attributes('href')).toBe('/tasks?view=list&part=pt1')
    expect(w.get('a[data-link="tasks"]').text()).toContain('작업 5건')
    expect(w.get('a[data-link="agendas"]').attributes('href')).toBe('/agendas?part=pt1')
    expect(w.get('a[data-link="agendas"]').text()).toContain('안건 3건')
  })

  it('찾아서 여럿을 골라 한 번에 더하고, 한 사람씩 뺀다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/parts?part=pt1')
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
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/parts?part=pt1')
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
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/parts?part=pt1')
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
    await signedIn('u1@inno-ax.com')
    const { w, router } = await mountAt('/admin/projects/p1/parts?part=pt1')

    await w.get('input[aria-label="새 파트 이름"]').setValue('디자인')
    await click(w.get('button[aria-label="파트 만들기"]').element)
    const design = usePartStore().parts.find((p) => p.name === '디자인')!
    expect(design).toBeTruthy()
    expect(router.currentRoute.value.query.part).toBe(design.id)
    expect(w.get('[data-selected-part]').attributes('data-selected-part')).toBe(design.id)
  })

  it('파트가 없는 프로젝트는 빈 안내를 보인다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w, router } = await mountAt('/admin/projects/p2/parts')
    expect(router.currentRoute.value.query.part).toBeUndefined()
    expect(w.text()).toContain('파트가 없습니다')
    expect(w.find('[data-selected-part]').exists()).toBe(false)
  })
})

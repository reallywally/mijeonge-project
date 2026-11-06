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
import AdminMembersView from './AdminMembersView.vue'
import ProjectSettingsView from './ProjectSettingsView.vue'

/* 관리 화면 둘이 목업 갈래로 떠서 스토어 · 목업 서버까지 닿는지 본다. 팝업은 teleport 로 body 에 나간다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))

const Blank = defineComponent({ template: '<div />' })

async function mountAt(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/admin/members', component: AdminMembersView },
      { path: '/admin/projects/:projectId/settings', component: ProjectSettingsView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const view = path === '/admin/members' ? AdminMembersView : ProjectSettingsView
  const w = mount(view, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

const bodyButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

async function type(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement>(selector)
  expect(el, `${selector} 를 못 찾았다`).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function click(el: Element | undefined) {
  expect(el, '누를 것을 못 찾았다').toBeTruthy()
  ;(el as HTMLElement).click()
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  vi.mocked(toastError).mockClear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('사용자 관리 화면', () => {
  it('비활성까지 다 놓고 역할 · 활성 · 비밀번호 없음이 보인다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/members')

    expect(w.findAll('tr[data-member-id]')).toHaveLength(6)
    expect(w.get('tr[data-member-id="u0"]').text()).toContain('시스템 관리자')
    expect(w.get('tr[data-member-id="u5"]').text()).toContain('비활성')
    expect(w.get('tr[data-member-id="u4"]').text()).toContain('비밀번호 없음')
    expect(w.text()).toContain('마지막 로그인')
  })

  it('맨 앞 열은 사용자 번호이고 번호 순으로 선다 — uuid 는 목록에 없다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/members')

    expect(w.findAll('th')[0].text()).toBe('번호')
    const rows = w.findAll('tr[data-member-id]')
    expect(rows.map((r) => r.get('[data-member-no]').text())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
    expect(rows.map((r) => r.attributes('data-member-id'))).toEqual([
      'u0',
      'u1',
      'u2',
      'u3',
      'u4',
      'u5',
    ])
    expect(w.find('[data-id-cell]').exists()).toBe(false)

    /* 수정 팝업 제목에 번호가 서고, uuid 복사는 거기 남는다 */
    await w.get('button[aria-label="김서연 수정"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('사용자 수정 — 2번 · 김서연')
    expect(document.body.querySelector('[data-id-cell]')?.getAttribute('title')).toBe('u1')
  })

  it('등록하면 표에 서고, 이메일이 겹치면 서버의 message 를 알리고 팝업을 지킨다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/members')

    await click(bodyButton('사용자 등록'))
    await type('#account-name', '최유진')
    await type('#account-email', 'u2@inno-ax.com')
    await type('#account-password', 'first-password')
    await click(bodyButton('등록'))
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'EMAIL_TAKEN' })
    expect(document.body.querySelector('#account-name')).toBeTruthy()

    await type('#account-email', 'yujin@inno-ax.com')
    await click(bodyButton('등록'))
    expect(document.body.querySelector('#account-name')).toBeNull()
    expect(w.text()).toContain('최유진')
    /* 새 사람은 다음 번호를 받아 맨 아래에 선다 */
    const last = w.findAll('tr[data-member-id]').at(-1)!
    expect(last.text()).toContain('최유진')
    expect(last.get('[data-member-no]').text()).toBe('7')
    /* 담당자 이름을 찍는 멤버 목록에도 바로 선다 */
    expect(useDataStore().allMembers.some((m) => m.name === '최유진')).toBe(true)
  })

  it('나를 끄려 하면 마지막 시스템 관리자라 거절된다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/members')

    await w.get('button[aria-label="관리자 수정"]').trigger('click')
    await flushPromises()
    await click(document.body.querySelector('button[aria-label="활성"]')!)
    await click(bodyButton('저장'))
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'LAST_SYSTEM_ADMIN' })
  })

  it('사진이 있는 사람만 [사진 지우기] — 한 번 더 묻고 지우면 멤버 목록에서도 걷힌다', async () => {
    const photo = 'data:image/png;base64,iVBORw0KGgo='
    await useAuthStore().login('u2@inno-ax.com', MOCK_PASSWORD)
    await useAuthStore().uploadAvatar(photo)
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const { w } = await mountAt('/admin/members')

    const row = () => w.get('tr[data-member-id="u2"]')
    expect(row().get('[data-avatar] img').attributes('src')).toBe(photo)
    expect(w.findAll('[data-avatar-remove]')).toHaveLength(1)
    expect(w.get('tr[data-member-id="u1"]').find('[data-avatar-remove]').exists()).toBe(false)

    await row().get('[data-avatar-remove]').trigger('click')
    await row().get('[data-avatar-remove-confirm]').trigger('click')
    await flushPromises()
    expect(useDataStore().memberAvatar('u2')).toBeNull()
    expect(row().find('[data-avatar] img').exists()).toBe(false)
    expect(row().get('[data-avatar]').text()).toBe('박')
    expect(w.find('[data-avatar-remove]').exists()).toBe(false)
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('프로젝트 관리 화면', () => {
  it('부여된 사람과 역할이 서고, 프로젝트 관리자가 맨 위다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')

    const rows = w.findAll('tr[data-member-id]')
    expect(rows.map((r) => r.attributes('data-member-id'))).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(rows[0].text()).toContain('프로젝트 관리자')
    expect(rows[0].text()).toContain('나')
  })

  it('역할을 바꾸고, 빼면 한 번 더 묻고 뺀다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')

    /* reka-ui 셀렉트는 jsdom 에서 열리지 않으므로 고른 값만 흘려 넣는다 */
    const roleOf = (memberId: string) =>
      w
        .findAllComponents(Select)
        .find((s) => (s.element as HTMLElement)?.closest?.(`[data-member-id="${memberId}"]`))
    roleOf('u2')!.vm.$emit('update:modelValue', 'admin')
    await flushPromises()
    expect(useDataStore().projectMembers.p1.find((p) => p.memberId === 'u2')!.role).toBe('admin')

    await w.get('button[aria-label="이도현 빼기"]').trigger('click')
    expect(w.text()).toContain('뺄까요?')
    await click(
      w
        .get('tr[data-member-id="u3"]')
        .findAll('button')
        .find((b) => b.text() === '빼기')!.element,
    )
    expect(w.find('tr[data-member-id="u3"]').exists()).toBe(false)
  })

  it('활성 멤버 중 아직 없는 사람만 더할 수 있고, 더하면 표에 선다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')

    const picker = w.findAllComponents(Select)[1]
    picker.vm.$emit('update:modelValue', 'u0')
    await flushPromises()
    await click(bodyButton('더하기'))
    expect(w.find('tr[data-member-id="u0"]').exists()).toBe(true)
  })

  it('프로젝트 이름을 고친다', async () => {
    await signedIn('u1@inno-ax.com')
    const { w } = await mountAt('/admin/projects/p1/settings')
    await w.get('input[aria-label="프로젝트 이름"]').setValue('한화손보 차세대 2기')
    await click(bodyButton('저장'))
    expect(useDataStore().currentProject?.name).toBe('한화손보 차세대 2기')
    expect(w.get('h1').text()).toContain('한화손보 차세대 2기')
  })
})

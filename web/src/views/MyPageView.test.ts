// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { accountOf, resetMockAuth } from '@/api/mockAuth'
import AccountMenu from '@/components/app/AccountMenu.vue'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { AvatarPrepError, prepareAvatar } from '@/lib/avatar'
import { toastError } from '@/lib/notify'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import MyPageView from './MyPageView.vue'

/* 마이페이지가 목업 갈래로 떠서 사진 올리기 · 지우기 · 비밀번호 바꾸기가 스토어 · 목업 서버까지 닿는지 본다.
   캔버스가 없는 jsdom 이라 줄이기(prepareAvatar)는 바꿔 끼운다 */
vi.mock('@/lib/notify', () => ({ toastError: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/avatar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/avatar')>()),
  prepareAvatar: vi.fn(),
}))

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='
const Blank = defineComponent({ template: '<div />' })

function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/me', component: MyPageView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
}

async function mountPage() {
  const router = makeRouter()
  router.push('/me')
  await router.isReady()
  const w = mount(MyPageView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return w
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

async function pickFile(w: ReturnType<typeof mount>) {
  const input = w.get<HTMLInputElement>('[data-avatar-input]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['x'], 'me.png', { type: 'image/png' })],
  })
  await input.trigger('change')
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  vi.mocked(toastError).mockClear()
  vi.mocked(prepareAvatar).mockReset()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('마이페이지', () => {
  it('이름 · 이메일 · 시스템 역할과 부여받은 프로젝트의 역할을 읽기로 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountPage()
    expect(w.get('[data-profile-name]').text()).toBe('김서연')
    expect(w.get('[data-profile-email]').text()).toBe('u1@inno-ax.com')
    expect(w.get('[data-profile-role]').text()).toBe('일반 사용자')

    const roles = useAuthStore().me!.projectRoles
    const rows = w.findAll('[data-my-project]')
    expect(rows.map((r) => r.attributes('data-my-project')).sort()).toEqual(
      Object.keys(roles).sort(),
    )
    for (const r of rows) {
      const role = roles[r.attributes('data-my-project')!]
      expect(r.get('[data-my-project-role]').text()).toBe(role === 'admin' ? '관리자' : '멤버')
    }
    /* 사진이 없으면 큰 동그라미는 첫 글자, 지우기는 없다 */
    expect(w.get('[data-profile] [data-avatar]').text()).toBe('김')
    expect(w.find('[data-avatar-remove]').exists()).toBe(false)
  })

  it('사진을 올리면 나와 멤버 목록의 내 줄이 그 자리에서 바뀌고, 지우면 첫 글자로 돌아간다', async () => {
    await signedIn('u1@inno-ax.com')
    vi.mocked(prepareAvatar).mockResolvedValue(PHOTO)
    const w = await mountPage()

    await pickFile(w)
    expect(prepareAvatar).toHaveBeenCalledOnce()
    expect(useAuthStore().me!.avatarUrl).toBe(PHOTO)
    expect(useDataStore().memberAvatar('u1')).toBe(PHOTO)
    expect(w.get('[data-profile] [data-avatar] img').attributes('src')).toBe(PHOTO)
    expect(w.get('[data-avatar-upload]').text()).toContain('사진 바꾸기')

    await w.get('[data-avatar-remove]').trigger('click')
    await flushPromises()
    expect(useAuthStore().me!.avatarUrl).toBeNull()
    expect(useDataStore().memberAvatar('u1')).toBeNull()
    expect(w.get('[data-profile] [data-avatar]').text()).toBe('김')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('서버(목업)가 막은 사진은 알리고 그대로 둔다', async () => {
    await signedIn('u1@inno-ax.com')
    vi.mocked(prepareAvatar).mockResolvedValue('data:image/png;base64,/9j/4A==')
    const w = await mountPage()
    await pickFile(w)
    expect(toastError).toHaveBeenCalledOnce()
    expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({ code: 'AVATAR_INVALID' })
    expect(useAuthStore().me!.avatarUrl).toBeNull()
  })

  it('못 읽는 파일은 보내지 않고 그 말을 띄운다', async () => {
    const { toast } = await import('vue-sonner')
    await signedIn('u1@inno-ax.com')
    vi.mocked(prepareAvatar).mockRejectedValue(new AvatarPrepError('사진을 읽을 수 없습니다.'))
    const w = await mountPage()
    await pickFile(w)
    expect(toast.error).toHaveBeenCalledWith('사진을 읽을 수 없습니다.')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('비밀번호를 페이지 안에서 바꾼다 — 칸이 다 맞아야 버튼이 선다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountPage()
    const button = () => w.get<HTMLButtonElement>('[data-password-submit]')
    expect(button().element.disabled).toBe(true)

    await w.get('#pw-page-current').setValue(MOCK_PASSWORD)
    await w.get('#pw-page-next').setValue('new-password-1')
    await w.get('#pw-page-confirm').setValue('new-password-2')
    expect(w.text()).toContain('새 비밀번호가 서로 다릅니다.')
    expect(button().element.disabled).toBe(true)

    await w.get('#pw-page-confirm').setValue('new-password-1')
    expect(button().element.disabled).toBe(false)
    await button().trigger('click')
    await flushPromises()
    expect(accountOf('u1')!.password).toBe('new-password-1')
    expect(w.get<HTMLInputElement>('#pw-page-current').element.value).toBe('')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('현재 비밀번호가 틀리면 서버의 말을 띄운다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountPage()
    await w.get('#pw-page-current').setValue('wrong-password')
    await w.get('#pw-page-next').setValue('new-password-1')
    await w.get('#pw-page-confirm').setValue('new-password-1')
    await w.get('[data-password-form]').trigger('submit')
    await flushPromises()
    expect(toastError).toHaveBeenCalledOnce()
    expect(accountOf('u1')!.password).toBe(MOCK_PASSWORD)
  })

  it('부여받은 프로젝트가 없는 시스템 관리자도 열린다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const w = await mountPage()
    expect(w.get('[data-profile-role]').text()).toBe('시스템 관리자')
    expect(w.findAll('[data-my-project]')).toHaveLength(0)
    expect(w.get('[data-my-projects]').text()).toContain('부여받은 프로젝트가 없습니다')
  })
})

describe('내 이름 메뉴', () => {
  it("'마이페이지' 가 비밀번호 바꾸기 · 로그아웃 위에 있고 /me 로 간다", async () => {
    await signedIn('u1@inno-ax.com')
    const router = makeRouter()
    router.push('/tasks')
    await router.isReady()
    const w = mount(AccountMenu, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    await w.get('[aria-label="내 메뉴"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((e) =>
      e.textContent?.trim(),
    )
    expect(items).toEqual(['마이페이지', '비밀번호 바꾸기', '로그아웃'])

    ;(document.body.querySelector('[data-my-page]') as HTMLElement).click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/me')
  })

  it('내 사진이 있으면 메뉴의 동그라미도 사진이다', async () => {
    await signedIn('u1@inno-ax.com')
    await useAuthStore().uploadAvatar(PHOTO)
    const router = makeRouter()
    router.push('/tasks')
    await router.isReady()
    const w = mount(AccountMenu, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()
    expect(w.get('[aria-label="내 메뉴"] [data-avatar] img').attributes('src')).toBe(PHOTO)
  })
})

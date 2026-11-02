// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import AdminShell from '@/components/app/AdminShell.vue'
import AppShell from '@/components/app/AppShell.vue'
import { MOCK_ADMIN_PASSWORD, MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 업무 화면 사이드바의 '관리자 페이지' 링크와 관리자 페이지 사이드바의 묶음이 권한에 따라 서고 숨는지 본다 */
const Blank = defineComponent({ template: '<div />' })

async function mountShell(shell: typeof AppShell | typeof AdminShell) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:rest(.*)', component: Blank }],
  })
  router.push('/tasks')
  await router.isReady()
  const w = mount(shell, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return w
}

async function signedIn(email: string, password = MOCK_PASSWORD) {
  await useAuthStore().login(email, password)
  await useDataStore().retry()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  localStorage.clear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('업무 화면 사이드바', () => {
  it('관리 묶음 없이, 관리 권한이 있는 사람에게만 관리자 페이지 링크 하나를 둔다', async () => {
    await signedIn('u2@inno-ax.com')
    const plain = await mountShell(AppShell)
    expect(plain.find('[data-admin-link]').exists()).toBe(false)
    expect(plain.text()).not.toContain('프로젝트 관리')
    expect(plain.text()).not.toContain('사용자 관리')
  })

  it('프로젝트 관리자는 지금 프로젝트를 못 다뤄도 링크가 보인다', async () => {
    await signedIn('u1@inno-ax.com')
    useDataStore().setProject('p2')
    const w = await mountShell(AppShell)
    expect(w.get('a[data-admin-link]').attributes('href')).toBe('/admin')
    expect(w.text()).not.toContain('파트 관리')
  })

  it('시스템 관리자도 링크가 보인다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const w = await mountShell(AppShell)
    expect(w.get('a[data-admin-link]').attributes('href')).toBe('/admin')
  })
})

describe('관리자 페이지 사이드바', () => {
  it('업무 화면으로 돌아가는 길이 있고, 대메뉴는 없다', async () => {
    await signedIn('u1@inno-ax.com')
    const w = await mountShell(AdminShell)
    expect(w.get('a[data-back-link]').attributes('href')).toBe('/tasks')
    expect(w.text()).not.toContain('안건')
  })

  it('프로젝트 관리자는 프로젝트 묶음만 — 지금 프로젝트를 관리할 수 있을 때 두 링크가 선다', async () => {
    await signedIn('u1@inno-ax.com')
    const data = useDataStore()
    data.setProject('p1')
    const w = await mountShell(AdminShell)
    expect(w.find('[data-admin-group="project"]').exists()).toBe(true)
    expect(w.find('[data-admin-group="system"]').exists()).toBe(false)
    expect(w.get('a[data-admin-link="settings"]').attributes('href')).toBe(
      '/admin/projects/p1/settings',
    )
    expect(w.get('a[data-admin-link="parts"]').attributes('href')).toBe('/admin/projects/p1/parts')

    data.setProject('p2')
    await flushPromises()
    expect(w.find('a[data-admin-link="settings"]').exists()).toBe(false)
    expect(w.find('a[data-admin-link="parts"]').exists()).toBe(false)
  })

  it('시스템 관리자는 프로젝트 묶음과 시스템 묶음을 다 본다', async () => {
    await signedIn('admin@inno-ax.com', MOCK_ADMIN_PASSWORD)
    const w = await mountShell(AdminShell)
    expect(w.find('[data-admin-group="project"]').exists()).toBe(true)
    expect(w.get('a[data-admin-link="members"]').attributes('href')).toBe('/admin/members')
  })
})

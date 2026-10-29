// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { resetMockAuth } from '@/api/mockAuth'
import { MOCK_PASSWORD } from '@/fixtures'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import LoginView from './LoginView.vue'

/* 로그인 화면 — 맞으면 가려던 곳으로, 틀리면 서버의 message 를 그대로 띄우고 비밀번호를 비운다 */
const Blank = defineComponent({ template: '<div />' })

async function mountLogin(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/:rest(.*)', component: Blank },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body })
  return { w, router }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetMockAuth()
  sessionStorage.clear()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('로그인 화면', () => {
  it('맞으면 들어가고 ?next= 의 주소로 돌아간다', async () => {
    const { w, router } = await mountLogin('/login?next=/tasks/k4')
    await w.get('#login-email').setValue('u2@inno-ax.com')
    await w.get('#login-password').setValue(MOCK_PASSWORD)
    await w.get('form').trigger('submit')
    await flushPromises()

    expect(useAuthStore().me?.id).toBe('u2')
    expect(useDataStore().status).toBe('ready')
    expect(router.currentRoute.value.fullPath).toBe('/tasks/k4')
  })

  it('앱 밖의 주소는 따르지 않고 첫 화면으로 간다', async () => {
    const { w, router } = await mountLogin('/login?next=//evil.example')
    await w.get('#login-email').setValue('u2@inno-ax.com')
    await w.get('#login-password').setValue(MOCK_PASSWORD)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('틀리면 이유를 가르지 않는 한 줄을 띄우고 비밀번호를 비운다', async () => {
    const { w, router } = await mountLogin('/login')
    await w.get('#login-email').setValue('u2@inno-ax.com')
    await w.get('#login-password').setValue('wrong-password')
    await w.get('form').trigger('submit')
    await flushPromises()

    expect(w.get('[role="alert"]').text()).toBe('이메일 또는 비밀번호가 맞지 않습니다.')
    expect((w.get('#login-password').element as HTMLInputElement).value).toBe('')
    expect(useAuthStore().me).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('이메일 · 비밀번호를 다 적기 전에는 보내지 않는다', async () => {
    const { w } = await mountLogin('/login')
    const button = w.get('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    await w.get('#login-email').setValue('u2@inno-ax.com')
    expect(button.attributes('disabled')).toBeDefined()
    await w.get('#login-password').setValue('x')
    expect(button.attributes('disabled')).toBeUndefined()
  })
})

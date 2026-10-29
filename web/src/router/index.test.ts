// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api'
import { members, projectGrants, projects } from '@/fixtures'
import router, { loginLocation } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import type { Me, ProjectSnapshot } from '@/types/domain'

/* 라우터 가드 · 401 리다이렉트 — 서버 모드로 fetch 를 가짜로 세워 진짜 라우터를 돌린다.
   화면 컴포넌트는 늦게 받으므로 가볍게 바꿔 둔다(작업 화면은 dhtmlx 를 끌고 온다) */
vi.mock('@/views/TasksView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/ThreadListView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/ProjectsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/LoginView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/AdminMembersView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/ProjectSettingsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/ProjectPartsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/RiskView.vue', () => ({ default: { template: '<div />' } }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unauthenticated = () =>
  json({ code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' }, 401)

const user: Me = {
  id: 'u2',
  name: '박지훈',
  email: 'u2@inno-ax.com',
  systemRole: 'user',
  projectRoles: { p1: 'user', p2: 'user' },
}

const snapshot = (projectId: string): ProjectSnapshot => ({
  project: projects.find((p) => p.id === projectId)!,
  threads: [],
  entries: [],
  tasks: [],
  taskThreadLinks: [],
  parts: [],
  partMembers: [],
})

let me: Me | null = user
let visible = projects.filter((p) => p.id !== 'p3')
let sessionAlive = true

beforeEach(async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false')
  me = user
  visible = projects.filter((p) => p.id !== 'p3')
  sessionAlive = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!sessionAlive) return unauthenticated()
      if (url === '/api/auth/me') return me ? json(me) : unauthenticated()
      if (url === '/api/projects') return json(visible)
      if (url === '/api/members') return json(members)
      const m = /^\/api\/projects\/(\w+)\/(snapshot|members)$/.exec(url)
      if (m && m[2] === 'snapshot') return json(snapshot(m[1]))
      if (m)
        return json(
          projectGrants
            .filter((g) => g.projectId === m[1])
            .map(({ memberId, role }) => ({ memberId, role })),
        )
      throw new Error(`안 정한 요청: ${url}`)
    }),
  )
  setActivePinia(createPinia())
  /* 앞 테스트의 자리에서 벗어나 둔다 — 같은 주소로 가면 가드가 다시 돌지 않는다.
     로그인해 있으면 여기서 첫 화면(/tasks)으로 넘어가므로 테스트는 /tasks 로 바로 가지 않는다 */
  await router.replace('/login?reset=' + Math.random())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const path = () => router.currentRoute.value.fullPath

describe('로그인 전', () => {
  it('어느 화면이든 /login?next=<가려던 주소> 로 보낸다', async () => {
    me = null
    setActivePinia(createPinia())
    await router.push('/threads/t3?x=1')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/threads/t3?x=1')
  })

  it('첫 화면으로 가던 것이면 next 를 달지 않는다', () => {
    expect(loginLocation('/')).toEqual({ name: 'login' })
    expect(loginLocation('/tasks')).toEqual({ name: 'login', query: { next: '/tasks' } })
  })
})

describe('쓰다가 세션이 끝나면', () => {
  it('아무 요청에서나 401 이 오면 비우고 지금 주소를 달아 로그인으로 보낸다', async () => {
    await router.push('/threads/t3')
    expect(path()).toBe('/threads/t3')
    const data = useDataStore()
    expect(data.status).toBe('ready')

    sessionAlive = false
    await api.fetchMembers().catch(() => null)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))

    expect(router.currentRoute.value.query.next).toBe('/threads/t3')
    expect(useAuthStore().me).toBeNull()
    expect(data.status).toBe('anonymous')
    expect(data.allProjects).toEqual([])
  })
})

describe('권한 가드', () => {
  it('일반 사용자는 사용자 관리 · 프로젝트 등록 · 프로젝트 관리 · 파트 관리에 못 들어간다', async () => {
    await router.push('/admin/members')
    expect(path()).toBe('/tasks')
    await router.push('/projects/new')
    expect(path()).toBe('/projects')
    await router.push('/projects/p1/settings')
    expect(path()).toBe('/tasks')
    await router.push('/projects/p1/parts?part=pt1')
    expect(path()).toBe('/tasks')
    /* 옛 주소도 넘긴 뒤 같은 가드에 걸린다 */
    await router.push('/projects/p1/members')
    expect(path()).toBe('/tasks')
  })

  it('프로젝트 관리자는 그 프로젝트의 관리 화면 둘만 연다', async () => {
    me = { ...user, projectRoles: { p1: 'admin', p2: 'user' } }
    setActivePinia(createPinia())
    await router.push('/projects/p1/settings')
    expect(path()).toBe('/projects/p1/settings')
    await router.push('/projects/p1/parts?part=pt1')
    expect(path()).toBe('/projects/p1/parts?part=pt1')
    await router.push('/projects/p2/settings')
    expect(path()).toBe('/tasks')
    await router.push('/projects/p2/parts')
    expect(path()).toBe('/tasks')
  })

  it('옛 멤버 주소(/projects/:id/members)는 프로젝트 관리로 넘긴다', async () => {
    me = { ...user, projectRoles: { p1: 'admin', p2: 'user' } }
    setActivePinia(createPinia())
    await router.push('/projects/p1/members')
    expect(path()).toBe('/projects/p1/settings')
    expect(router.currentRoute.value.name).toBe('project-settings')
  })

  it('시스템 관리자는 다 연다', async () => {
    me = { ...user, systemRole: 'admin', projectRoles: {} }
    setActivePinia(createPinia())
    await router.push('/admin/members')
    expect(path()).toBe('/admin/members')
    await router.push('/projects/p2/settings')
    expect(path()).toBe('/projects/p2/settings')
    await router.push('/projects/p2/parts')
    expect(path()).toBe('/projects/p2/parts')
  })

  it('부여받은 프로젝트가 없으면 일반 사용자는 프로젝트 목록(안내)으로, 시스템 관리자는 등록으로', async () => {
    visible = []
    setActivePinia(createPinia())
    await router.push('/threads')
    expect(path()).toBe('/projects')

    me = { ...user, systemRole: 'admin', projectRoles: {} }
    setActivePinia(createPinia())
    await router.push('/threads')
    expect(path()).toBe('/projects/new')
  })

  it('로그인해 있으면 로그인 화면을 거치지 않고 next 로 간다', async () => {
    await router.push('/login?next=/threads')
    expect(path()).toBe('/threads')
  })
})

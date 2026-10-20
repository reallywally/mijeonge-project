import { createRouter, createWebHistory } from 'vue-router'
import { setUnauthenticatedHandler } from '@/api'
import { canOpen, emptyProjectsHome, safeNext, type RouteAccess } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { clearSession } from '@/stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    /** 들어가려면 필요한 권한. 메뉴를 숨기는 판단과 같은 함수(lib/access)로 본다 */
    access?: RouteAccess
    /** 로그인 전에도 열리는 화면 */
    public?: boolean
  }
}

/* 목록 위에 뜨는 상세 팝업도 주소를 갖는다 — 새로고침과 뒤로가기가 살아 있어야 한다.
   /tasks/new · /threads/new · /minutes/new 는 각각 /:id 보다 먼저 둔다. */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectsView.vue'),
    },
    {
      path: '/projects/new',
      name: 'project-new',
      component: () => import('@/views/ProjectsView.vue'),
      meta: { access: 'systemAdmin' },
    },
    {
      path: '/projects/:projectId/settings',
      name: 'project-settings',
      component: () => import('@/views/ProjectSettingsView.vue'),
      meta: { access: 'projectAdmin' },
    },
    {
      path: '/projects/:projectId/parts',
      name: 'project-parts',
      component: () => import('@/views/ProjectPartsView.vue'),
      meta: { access: 'projectAdmin' },
    },
    /* 옛 주소 — 멤버는 프로젝트 관리로 옮겼다. 걸어 둔 링크가 살게 넘긴다 */
    {
      path: '/projects/:projectId/members',
      redirect: (to) => ({ path: `/projects/${String(to.params.projectId)}/settings` }),
    },
    {
      path: '/admin/members',
      name: 'admin-members',
      component: () => import('@/views/AdminMembersView.vue'),
      meta: { access: 'systemAdmin' },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/TasksView.vue'),
    },
    {
      path: '/tasks/new',
      name: 'task-new',
      component: () => import('@/views/TasksView.vue'),
    },
    {
      path: '/tasks/:id',
      name: 'task',
      component: () => import('@/views/TasksView.vue'),
    },
    {
      path: '/threads',
      name: 'threads',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/threads/new',
      name: 'thread-new',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/threads/:id',
      name: 'thread',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/risks',
      name: 'risks',
      component: () => import('@/views/RiskView.vue'),
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('@/views/ReportsView.vue'),
    },
    {
      path: '/reports/:reportId',
      name: 'report',
      component: () => import('@/views/ReportDetailView.vue'),
    },
    {
      path: '/checks',
      name: 'checks',
      component: () => import('@/views/ChecksView.vue'),
    },
    {
      path: '/minutes',
      name: 'minutes',
      component: () => import('@/views/MinutesView.vue'),
    },
    {
      path: '/minutes/new',
      name: 'minutes-new',
      component: () => import('@/views/MinutesEditView.vue'),
    },
    {
      path: '/minutes/:minutesId/edit',
      name: 'minutes-edit',
      component: () => import('@/views/MinutesEditView.vue'),
    },
    {
      path: '/minutes/:minutesId',
      name: 'minutes-detail',
      component: () => import('@/views/MinutesDetailView.vue'),
    },
  ],
})

/** 로그인 화면 주소 — 돌아올 곳이 첫 화면이면 next 를 달지 않는다 */
export const loginLocation = (next: string) =>
  next === '/' || safeNext(next) === '/'
    ? { name: 'login' as const }
    : { name: 'login' as const, query: { next } }

/* 부팅은 로그인한 사람(GET /api/auth/me)이 먼저다. 로그인 전이면 /login 으로 보낸다.
   그다음 프로젝트 목록을 받아야 어디로 갈지 안다 — 볼 프로젝트가 하나도 없으면 다른 화면은 보여 줄 것이 없다.
   받다가 실패하면 그대로 두고 App 이 다시 시도 화면을 띄운다 */
router.beforeEach(async (to) => {
  const data = useDataStore()
  const auth = useAuthStore()
  await data.boot()

  if (to.meta.public) {
    /* 이미 로그인했으면 로그인 화면을 거치지 않는다 */
    return data.status === 'ready' && auth.me ? safeNext(to.query.next) : true
  }
  if (data.status === 'anonymous') return loginLocation(to.fullPath)
  if (data.status !== 'ready') return true

  const projectId = typeof to.params.projectId === 'string' ? to.params.projectId : ''
  if (!canOpen(auth.me, to.meta.access, projectId))
    return to.name === 'project-new' ? '/projects' : '/'

  if (to.path.startsWith('/projects') || to.path.startsWith('/admin')) return true
  return data.allProjects.length > 0 ? true : emptyProjectsHome(auth.me)
})

/* 쓰다가 세션이 끝났으면(다른 곳에서 비밀번호를 바꿈 · 비활성화 · 만료) 들고 있던 것을 비우고 로그인으로 보낸다.
   로그인 전의 401(부팅 때 /auth/me)은 가드가 맡으므로 여기서는 로그인해 있던 경우만 본다 */
setUnauthenticatedHandler(() => {
  if (!useAuthStore().me) return
  const here = router.currentRoute.value
  clearSession()
  if (here.name !== 'login') void router.replace(loginLocation(here.fullPath))
})

export default router

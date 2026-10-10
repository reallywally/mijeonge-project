import { createRouter, createWebHistory } from 'vue-router'
import { useDataStore } from '@/stores/data'

/* 목록 위에 뜨는 상세 팝업도 주소를 갖는다 — 새로고침과 뒤로가기가 살아 있어야 한다.
   /tasks/new · /threads/new 는 각각 /:id 보다 먼저 둔다. */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectsView.vue'),
    },
    {
      path: '/projects/new',
      name: 'project-new',
      component: () => import('@/views/ProjectsView.vue'),
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
  ],
})

/* 프로젝트 목록을 받아야 어디로 갈지 안다. 프로젝트가 하나도 없으면 다른 화면은 보여 줄 것이 없다 —
   등록으로 보낸다 (API.md Q18). 받다가 실패하면 그대로 두고 App 이 다시 시도 화면을 띄운다 */
router.beforeEach(async (to) => {
  const data = useDataStore()
  await data.boot()
  if (data.status !== 'ready' || to.path.startsWith('/projects')) return true
  return data.allProjects.length > 0 ? true : '/projects/new'
})

export default router

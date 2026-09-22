import { createRouter, createWebHistory } from 'vue-router'

/* 목록 위에 뜨는 상세 팝업도 주소를 갖는다 — 새로고침과 뒤로가기가 살아 있어야 한다.
   /meetings/new 는 /meetings/:id 보다 먼저 둔다. */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/TasksView.vue'),
    },
    {
      path: '/threads',
      name: 'threads',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/threads/:id',
      name: 'thread',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/meetings/new',
      name: 'meeting-new',
      component: () => import('@/views/NewMeetingView.vue'),
    },
    {
      path: '/meetings',
      name: 'meetings',
      component: () => import('@/views/MeetingListView.vue'),
    },
    {
      path: '/meetings/:id',
      name: 'meeting',
      component: () => import('@/views/MeetingListView.vue'),
    },
  ],
})

export default router

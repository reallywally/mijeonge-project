import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/threads' },
    {
      path: '/threads',
      name: 'threads',
      component: () => import('@/views/ThreadListView.vue'),
    },
    {
      path: '/meetings/new',
      name: 'meeting-new',
      component: () => import('@/views/NewMeetingView.vue'),
    },
  ],
})

export default router

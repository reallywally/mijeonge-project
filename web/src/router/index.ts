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
  ],
})

export default router

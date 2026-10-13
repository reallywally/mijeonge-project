<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppBootScreen from '@/components/app/AppBootScreen.vue'
import ChatWidget from '@/components/app/ChatWidget.vue'
import { Toaster } from '@/components/ui/sonner'
import { emptyProjectsHome } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

const data = useDataStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

void data.boot()

/* 처음 뜰 때 실패했다가 다시 붙은 경우 — 라우터 가드는 이미 지나갔으니 갈 곳을 여기서 정한다 (API.md Q18) */
async function retry() {
  await data.retry()
  if (data.status === 'anonymous') {
    await router.replace({ name: 'login', query: { next: route.fullPath } })
    return
  }
  if (
    data.status === 'ready' &&
    data.allProjects.length === 0 &&
    !route.path.startsWith('/projects') &&
    !route.path.startsWith('/admin')
  )
    await router.replace(emptyProjectsHome(auth.me))
}
</script>

<template>
  <!-- 로그인 화면은 부팅(프로젝트 · 스냅샷)과 상관없이 선다 -->
  <RouterView v-if="route.meta.public" />
  <template v-else-if="data.status === 'ready'">
    <RouterView />
    <!-- 화면마다 두지 않는다 — 옮겨 다녀도 같은 대화가 이어진다 -->
    <ChatWidget />
  </template>
  <AppBootScreen v-else @retry="retry" />
  <!-- 오른쪽 아래는 챗봇 자리다 (API.md Q28) -->
  <Toaster position="top-right" />
</template>

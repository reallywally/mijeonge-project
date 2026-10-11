<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppBootScreen from '@/components/app/AppBootScreen.vue'
import ChatWidget from '@/components/app/ChatWidget.vue'
import { Toaster } from '@/components/ui/sonner'
import { useDataStore } from '@/stores/data'

const data = useDataStore()
const route = useRoute()
const router = useRouter()

void data.boot()

/* 처음 뜰 때 실패했다가 다시 붙은 경우 — 라우터 가드는 이미 지나갔으니 빈 상태 처리를 여기서 한다 (API.md Q18) */
async function retry() {
  await data.retry()
  if (
    data.status === 'ready' &&
    data.allProjects.length === 0 &&
    !route.path.startsWith('/projects')
  )
    await router.replace('/projects/new')
}
</script>

<template>
  <template v-if="data.status === 'ready'">
    <RouterView />
    <!-- 화면마다 두지 않는다 — 옮겨 다녀도 같은 대화가 이어진다 -->
    <ChatWidget />
  </template>
  <AppBootScreen v-else @retry="retry" />
  <!-- 오른쪽 아래는 챗봇 자리다 (API.md Q28) -->
  <Toaster position="top-right" />
</template>

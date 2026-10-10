<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppBootScreen from '@/components/app/AppBootScreen.vue'
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
  <RouterView v-if="data.status === 'ready'" />
  <AppBootScreen v-else @retry="retry" />
  <Toaster position="bottom-right" />
</template>

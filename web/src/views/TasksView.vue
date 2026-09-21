<script setup lang="ts">
import AppShell from '@/components/app/AppShell.vue'
import { useTaskStore } from '@/stores/task'

/* 작업 화면(목록 · 간트차트 · 칸반보드)은 2단계에서 붙인다. 지금은 대메뉴가 서고
   프로젝트를 바꾸면 데이터가 갈리는지 보여주는 자리다. */
const taskStore = useTaskStore()
</script>

<template>
  <AppShell>
    <div class="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 pt-5">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-xl font-semibold tracking-tight">작업</h1>
        <p class="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          목록 · 간트차트 · 칸반보드 세 탭이 여기 붙습니다. 세 탭 모두 같은 작업을 보는 방식만
          다릅니다.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 text-sm">
        <span class="rounded-md border border-border px-3 py-1.5">
          작업 {{ taskStore.rows.length }}건
        </span>
        <span class="rounded-md border border-border px-3 py-1.5">
          기간 미정 {{ taskStore.undatedCount }}건
        </span>
        <span class="rounded-md border border-border px-3 py-1.5">
          막힘 {{ taskStore.blockedCount }}건
        </span>
      </div>
    </div>
  </AppShell>
</template>

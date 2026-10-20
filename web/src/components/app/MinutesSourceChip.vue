<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { NotebookPen } from 'lucide-vue-next'
import { useMinutesStore } from '@/stores/minutes'

/* 출처 칩 — 회의록 [AI 정리] 로 등록한 안건 · 이력 · 작업에 붙는다. 누르면 그 회의록 상세.
   제목은 회의록 목록에서 찾고, 아직 모르면 '회의록' 으로 둔다 */
const props = defineProps<{ minutesId: string }>()

const minutes = useMinutesStore()
onMounted(() => minutes.ensureLoaded())

const title = computed(() => minutes.titleOf(props.minutesId) ?? '회의록')
</script>

<template>
  <RouterLink
    :to="`/minutes/${minutesId}`"
    class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
    :title="`회의록에서 — ${title}`"
    :data-minutes-source="minutesId"
  >
    <NotebookPen class="size-3 shrink-0 text-muted-foreground" />
    <span class="shrink-0 text-muted-foreground">회의록에서</span>
    <span class="truncate">{{ title }}</span>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/app/AppShell.vue'
import { canManageProject } from '@/lib/access'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'

/* 프로젝트 관리 · 파트 관리가 같이 쓰는 틀. 주소의 프로젝트가 곧 고른 프로젝트다 —
   옆의 프로젝트 선택을 바꾸면 그 프로젝트의 같은 관리 화면으로 옮기고,
   나를 내리거나 뺐으면 이 화면에 있을 수 없다 */
const props = defineProps<{
  section: 'settings' | 'parts'
  label: string
  /** 머리 줄 오른쪽에 붙이는 짧은 숫자 */
  meta?: string
}>()

const data = useDataStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const projectId = computed(() => String(route.params.projectId ?? ''))
const project = computed(() => data.allProjects.find((p) => p.id === projectId.value) ?? null)

watch(
  projectId,
  (id) => {
    if (id && id !== data.currentProjectId && data.allProjects.some((p) => p.id === id))
      data.setProject(id)
  },
  { immediate: true },
)

watch(
  () => data.currentProjectId,
  (id) => {
    if (id === projectId.value) return
    void router.replace(
      id && canManageProject(auth.me, id) ? `/projects/${id}/${props.section}` : '/tasks',
    )
  },
)

watch(
  () => canManageProject(auth.me, projectId.value),
  (can) => {
    if (!can) void router.replace('/tasks')
  },
)
</script>

<template>
  <AppShell>
    <div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-card px-6">
      <span class="text-xs font-medium text-muted-foreground">{{ label }}</span>
      <span v-if="meta" class="text-xs text-muted-foreground">{{ meta }}</span>
    </div>

    <div class="flex min-h-0 grow justify-center overflow-y-auto px-[26px] pt-[26px]">
      <div v-if="!project" class="pt-10 text-sm text-muted-foreground">
        프로젝트를 찾을 수 없습니다.
      </div>
      <slot v-else :project="project" />
    </div>
  </AppShell>
</template>

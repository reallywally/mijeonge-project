<script setup lang="ts">
import { CalendarDays, ChevronRight, FolderClosed, ListTree, SquareKanban } from 'lucide-vue-next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDataStore } from '@/stores/data'
import { useMeetingStore } from '@/stores/meeting'
import { useTaskStore } from '@/stores/task'
import { useThreadStore } from '@/stores/thread'

/* 대메뉴는 memo 대로 작업 · 안건 · 회의 셋이다. 위에서 프로젝트를 고르면
   세 화면 모두 그 프로젝트 안에서만 돈다. */
const data = useDataStore()
const taskStore = useTaskStore()
const threadStore = useThreadStore()
const meetingStore = useMeetingStore()
</script>

<template>
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header class="flex h-[58px] shrink-0 items-center gap-3 border-b border-border px-[22px]">
      <div class="flex items-center gap-2.5">
        <div class="size-[19px] rounded-sm border-[1.5px] border-foreground" />
        <span class="text-lg font-semibold">innoFlow</span>
      </div>
      <ChevronRight class="size-3.5 text-muted-foreground" />
      <div class="flex items-center gap-2 text-sm">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span>{{ data.currentProject.name }}</span>
      </div>
      <div class="grow" />
      <slot name="actions" />
    </header>

    <div class="flex min-h-0 grow">
      <aside
        class="flex w-60 shrink-0 flex-col gap-5 overflow-hidden border-r border-border bg-muted/50 px-4 py-[22px]"
      >
        <label class="flex flex-col gap-1.5">
          <span class="px-1 text-xs font-medium text-muted-foreground">프로젝트</span>
          <Select
            :model-value="data.currentProjectId"
            @update:model-value="(id) => data.setProject(String(id))"
          >
            <SelectTrigger class="h-11 w-full bg-card text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in data.allProjects" :key="p.id" :value="p.id">
                {{ p.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <nav class="flex flex-col gap-[3px]">
          <RouterLink
            to="/tasks"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <SquareKanban class="size-4 shrink-0" />
            <span class="grow">작업</span>
            <span class="text-xs text-muted-foreground">{{ taskStore.rows.length }}</span>
          </RouterLink>
          <RouterLink
            to="/threads"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <ListTree class="size-4 shrink-0" />
            <span class="grow">안건</span>
            <span class="text-xs text-muted-foreground">{{ threadStore.rows.length }}</span>
          </RouterLink>
          <RouterLink
            to="/meetings"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent font-medium text-accent-foreground"
          >
            <CalendarDays class="size-4 shrink-0" />
            <span class="grow">회의</span>
            <span class="text-xs text-muted-foreground">{{ meetingStore.rows.length }}</span>
          </RouterLink>
        </nav>

        <slot name="aside" />
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden">
        <slot />
      </main>
    </div>
  </div>
</template>

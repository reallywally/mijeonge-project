<script setup lang="ts">
import { CalendarDays, ChevronRight, ChevronsUpDown, FolderClosed, ListTree } from 'lucide-vue-next'
import { useMijeongeStore } from '@/stores/mijeonge'

const store = useMijeongeStore()
</script>

<template>
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header class="flex h-[58px] shrink-0 items-center gap-3 border-b border-border px-[22px]">
      <div class="flex items-center gap-2.5">
        <div class="size-[19px] rounded-[2px] border-[1.5px] border-foreground" />
        <span class="font-serif text-[18px] font-bold tracking-[-0.01em]">회의록</span>
      </div>
      <ChevronRight class="size-3.5 text-subtle" />
      <div class="flex items-center gap-2 text-[13.5px]">
        <FolderClosed class="size-3.5 text-muted-foreground" />
        <span>{{ store.currentProject.name }}</span>
      </div>
      <div class="grow" />
      <slot name="actions" />
    </header>

    <div class="flex min-h-0 grow">
      <aside class="flex w-60 shrink-0 flex-col gap-5 overflow-hidden border-r border-border bg-panel px-4 py-[22px]">
        <button
          type="button"
          class="flex min-h-[52px] items-center gap-2.5 rounded-md border border-line-strong bg-card px-[11px] py-2.5 text-left"
        >
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="text-[11px] font-semibold tracking-[0.09em] text-muted-foreground">프로젝트</span>
            <span class="text-sm font-semibold">{{ store.currentProject.name }}</span>
          </span>
          <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
        </button>

        <nav class="flex flex-col gap-[3px]">
          <RouterLink
            to="/threads"
            class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm"
            active-class="border border-line-strong bg-card font-semibold"
          >
            <ListTree class="size-4 shrink-0" />
            <span class="grow">안건</span>
            <span class="text-[11.5px] text-brand">{{ store.rows.filter((r) => r.thread.state === 'open').length }}</span>
          </RouterLink>
          <span class="flex min-h-12 items-center gap-2.5 rounded-md px-3 py-[11px] text-sm text-muted-foreground">
            <CalendarDays class="size-4 shrink-0" />
            <span class="grow">일정관리</span>
          </span>
        </nav>

        <slot name="aside" />
      </aside>

      <main class="flex min-w-0 grow flex-col overflow-hidden">
        <slot />
      </main>
    </div>
  </div>
</template>
